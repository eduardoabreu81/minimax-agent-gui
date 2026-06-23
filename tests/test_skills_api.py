"""
End-to-end tests for the Skills API (FastAPI TestClient).

Covers every endpoint added in the multi-source skills migration:
  - GET  /api/skills                 (merged, grouped, scan_errors)
  - GET  /api/skills/sources         (per-source paths + counts)
  - POST /api/skills/discover        (force rescan)
  - GET  /api/skills/{name}          (full content + raw_markdown)
  - POST /api/skills                 (create; user dir only)
  - PUT  /api/skills/{name}          (update; refuses non-user sources)
  - DELETE /api/skills/{name}        (refuses non-user sources)
  - POST /api/skills/import          (GitHub URL → preview)
  - PUT  /api/config/skills          (persist skills: config block)
"""

import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

# mcp_runtime is imported as a top-level module by web.backend.main, so the
# backend dir must be on sys.path.
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(PROJECT_ROOT / "web" / "backend"))

os.environ.setdefault("MINIMAX_PROJECT_ROOT", str(PROJECT_ROOT))

import web.backend.main as _main  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402


# Use a temp config + temp user skills dir for the whole suite so we never
# touch the real ``%APPDATA%/MiniMaxStudio/skills``.
TMP_ROOT = Path(tempfile.mkdtemp(prefix="minimax_skills_api_"))
TMP_CONFIG = TMP_ROOT / "config.yaml"
TMP_CONFIG.write_text("api_key: dummy\n", encoding="utf-8")
TMP_USER_SKILLS = TMP_ROOT / "user_skills"
TMP_USER_SKILLS.mkdir(parents=True, exist_ok=True)

_main.CONFIG_PATH = TMP_CONFIG
# Force the helper to read fresh state after each test.
_main._invalidate_skills_loader()

# Pre-configure the skills block to point user_dir at TMP_USER_SKILLS so
# CRUD tests don't touch real %APPDATA%.
_cfg = _main._load_config_dict()
_cfg["skills"] = {
    "user_dir": str(TMP_USER_SKILLS),
    "extra_skill_dirs": [],
    "merge_all_available_skills": True,
}
_main._save_config_dict(_cfg)
_main._invalidate_skills_loader()

client = TestClient(_main.app)


# ─── Discovery ────────────────────────────────────────────────────────────


def test_list_skills_returns_merged_results():
    # Seed one user skill so the "user" group is non-empty (empty groups are
    # omitted from grouped by the loader).
    client.post("/api/skills", json={
        "name": "api-seeded",
        "description": "Seeded for grouped test",
        "body": "x",
    })
    r = client.get("/api/skills")
    assert r.status_code == 200
    data = r.json()
    assert data["success"] is True
    assert data["count"] > 0
    # Must include sources breakdown
    assert "grouped" in data
    # Built-in is always present (ships with the package)
    assert "builtin" in data["grouped"]
    # User is present because we just created one
    assert "user" in data["grouped"]
    assert any(s["name"] == "api-seeded" for s in data["grouped"]["user"])


def test_list_skills_includes_source_metadata():
    r = client.get("/api/skills")
    sample = r.json()["skills"][0]
    for k in ("name", "description", "source", "source_label", "read_only"):
        assert k in sample, f"missing {k} in {sample}"


def test_list_sources_includes_all_configured_paths():
    r = client.get("/api/skills/sources")
    assert r.status_code == 200
    sources = r.json()["sources"]
    labels = [s["source_label"] for s in sources]
    # Brand groups + Generic + Built-in always present
    assert "Built-in" in labels
    assert "User" in labels
    assert "Claude" in labels
    assert "Codex" in labels


def test_discover_invalidates_cache():
    r = client.post("/api/skills/discover")
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    assert body["count"] > 0
    assert "scan_errors" in body


# ─── Single skill lookup ────────────────────────────────────────────────


def test_get_skill_returns_full_content():
    # Pick first skill from list
    listing = client.get("/api/skills").json()["skills"]
    name = listing[0]["name"]
    r = client.get(f"/api/skills/{name}")
    assert r.status_code == 200
    sk = r.json()["skill"]
    assert sk["name"] == name
    assert "raw_markdown" in sk
    assert sk["raw_markdown"].startswith("---")


def test_get_unknown_skill_returns_404():
    r = client.get("/api/skills/nonexistent-skill-xyz-12345")
    assert r.status_code == 404


# ─── CRUD lifecycle ─────────────────────────────────────────────────────


def test_create_skill_in_user_dir():
    payload = {
        "name": "api-test-skill",
        "description": "Created via API test.",
        "body": "# API Test\n\nBody content.",
        "license": "MIT",
        "allowed_tools": ["read_file"],
    }
    r = client.post("/api/skills", json=payload)
    assert r.status_code == 200, r.text
    sk = r.json()["skill"]
    assert sk["source"] == "user"
    assert sk["read_only"] is False
    # File on disk
    assert (TMP_USER_SKILLS / "api-test-skill" / "SKILL.md").exists()


def test_create_duplicate_skill_returns_400():
    payload = {"name": "api-dup", "description": "first", "body": "x"}
    r1 = client.post("/api/skills", json=payload)
    assert r1.status_code == 200
    r2 = client.post("/api/skills", json=payload)
    assert r2.status_code == 400
    assert "already exists" in r2.json()["detail"]


def test_create_invalid_name_returns_400():
    r = client.post("/api/skills", json={
        "name": "INVALID NAME!",
        "description": "x",
        "body": "x",
    })
    assert r.status_code == 400


def test_create_oversized_description_returns_400():
    r = client.post("/api/skills", json={
        "name": "ok",
        "description": "x" * 1100,
        "body": "x",
    })
    assert r.status_code == 400


def test_update_user_skill():
    client.post("/api/skills", json={
        "name": "api-update",
        "description": "Original",
        "body": "Old body",
    })
    r = client.put("/api/skills/api-update", json={
        "description": "Updated",
        "body": "# New body",
    })
    assert r.status_code == 200
    sk = r.json()["skill"]
    assert sk["description"] == "Updated"
    assert "New body" in sk["raw_markdown"]


def test_update_readonly_skill_returns_403():
    """Editing a built-in skill is refused — user must 'Import to user' first."""
    listing = client.get("/api/skills").json()["skills"]
    builtin = next(s for s in listing if s["source"] == "builtin")
    r = client.put(f"/api/skills/{builtin['name']}", json={"description": "x"})
    assert r.status_code == 403
    assert "read-only" in r.json()["detail"]


def test_update_unknown_skill_returns_404():
    r = client.put("/api/skills/nope-skill", json={"description": "x"})
    assert r.status_code == 404


def test_delete_user_skill():
    client.post("/api/skills", json={"name": "api-delete", "description": "d", "body": "b"})
    r = client.delete("/api/skills/api-delete")
    assert r.status_code == 200
    assert r.json()["deleted"] == "api-delete"
    assert not (TMP_USER_SKILLS / "api-delete").exists()


def test_delete_readonly_skill_returns_403():
    listing = client.get("/api/skills").json()["skills"]
    builtin = next(s for s in listing if s["source"] == "builtin")
    r = client.delete(f"/api/skills/{builtin['name']}")
    assert r.status_code == 403


# ─── Import preview ──────────────────────────────────────────────────────


def test_import_empty_url_returns_400():
    r = client.post("/api/skills/import", json={"url": ""})
    assert r.status_code == 400


def test_import_invalid_url_returns_400():
    r = client.post("/api/skills/import", json={"url": "not-a-url"})
    assert r.status_code == 400


def test_import_normalizes_blob_url():
    """GitHub blob URLs are converted to raw.githubusercontent.com."""
    # Use httpx mock — no real network.
    import httpx

    fake_resp = httpx.Response(
        200,
        text="---\nname: imported\ndescription: Imported skill\n---\n\nbody\n",
        request=httpx.Request("GET", "https://example.com"),
    )

    with patch("httpx.AsyncClient.get", return_value=fake_resp):
        r = client.post("/api/skills/import", json={
            "url": "https://github.com/owner/repo/blob/main/path/SKILL.md",
        })
        assert r.status_code == 200
        preview = r.json()["preview"]
        assert preview["suggested_name"] == "imported"
        assert preview["suggested_description"] == "Imported skill"
        assert "raw.githubusercontent.com" in preview["source_url"]


def test_import_non_skill_url_returns_422():
    """A URL that returns content without frontmatter is rejected."""
    import httpx

    fake_resp = httpx.Response(
        200, text="Just plain text, no frontmatter.",
        request=httpx.Request("GET", "https://example.com"),
    )
    with patch("httpx.AsyncClient.get", return_value=fake_resp):
        r = client.post("/api/skills/import", json={"url": "https://example.com/raw"})
        assert r.status_code == 422


# ─── Config persistence ──────────────────────────────────────────────────


def test_update_skills_config_persists():
    r = client.put("/api/config/skills", json={
        "extra_skill_dirs": ["~/my-team-skills"],
        "merge_all_available_skills": True,
    })
    assert r.status_code == 200
    cfg = r.json()["skills"]
    assert cfg["extra_skill_dirs"] == ["~/my-team-skills"]
    # Confirm it was actually written to disk
    assert "my-team-skills" in TMP_CONFIG.read_text(encoding="utf-8")


def test_update_skills_config_invalidates_loader():
    """A config change must invalidate the cached loader (signature change)."""
    client.put("/api/config/skills", json={
        "extra_skill_dirs": ["~/first-path"],
    })
    _main._invalidate_skills_loader()  # force rebuild
    sig1 = _main._skills_signature()
    client.put("/api/config/skills", json={
        "extra_skill_dirs": ["~/second-path"],
    })
    _main._invalidate_skills_loader()
    sig2 = _main._skills_signature()
    assert sig1 != sig2


def test_user_dir_config_respected():
    """``skills.user_dir`` overrides the default APPDATA location."""
    custom_dir = TMP_ROOT / "custom_user"
    custom_dir.mkdir()
    client.put("/api/config/skills", json={"user_dir": str(custom_dir)})
    _main._invalidate_skills_loader()
    # Now a create should land in custom_dir, not TMP_USER_SKILLS
    r = client.post("/api/skills", json={
        "name": "in-custom",
        "description": "x",
        "body": "x",
    })
    assert r.status_code == 200
    assert (custom_dir / "in-custom" / "SKILL.md").exists()
    # Reset back
    client.put("/api/config/skills", json={"user_dir": str(TMP_USER_SKILLS)})
    _main._invalidate_skills_loader()
