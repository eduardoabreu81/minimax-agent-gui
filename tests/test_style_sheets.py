"""
Tests for the style sheet subsystem.

Mirrors tests/test_skills_crud.py + tests/test_skills_api.py, covering:
  - mini_agent/tools/style_sheet_loader.py: validation, CRUD round-trip,
    {prompt} placeholder count, combine_prompt's 4 cases.
  - web/backend/main.py /api/style-sheets/* routes: list / get / create /
    update / delete, plus 400 on validation failure and 404 on missing.
"""

import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from mini_agent.tools.style_sheet_loader import (  # noqa: E402
    BODY_MAX,
    PLACEHOLDER,
    PROMPT_MAX,
    StyleSheet,
    StyleSheetValidationError,
    combine_prompt,
    delete_style_sheet,
    get_default_user_dir,
    list_style_sheets,
    read_style_sheet_raw,
    update_style_sheet,
    write_style_sheet,
    kebab_slugify,
    suggest_unique_name,
    _validate_body,
    _validate_description,
    _validate_name,
)


# ─── Loader: validation ────────────────────────────────────────────────────


def test_validate_name_accepts_canonical():
    assert _validate_name("watercolor-pastel") == "watercolor-pastel"
    assert _validate_name("a") == "a"
    assert _validate_name("a1-b2-c3") == "a1-b2-c3"


@pytest.mark.parametrize("bad", [
    "",            # empty
    "Has-Uppercase",
    "has space",
    "has_underscore",
    "-leading-hyphen",
    "x" * 65,      # too long
    "한국어",       # non-ascii
])
def test_validate_name_rejects_invalid(bad):
    with pytest.raises(StyleSheetValidationError):
        _validate_name(bad)


def test_validate_description_rejects_empty_and_oversized():
    with pytest.raises(StyleSheetValidationError):
        _validate_description("")
    with pytest.raises(StyleSheetValidationError):
        _validate_description("   ")
    with pytest.raises(StyleSheetValidationError):
        _validate_description("x" * 1025)


def test_validate_body_enforces_max_and_placeholder_count():
    # Empty
    with pytest.raises(StyleSheetValidationError):
        _validate_body("")
    # Oversized
    with pytest.raises(StyleSheetValidationError) as exc:
        _validate_body("x" * (BODY_MAX + 1))
    assert str(BODY_MAX) in str(exc.value)
    # Two placeholders — ambiguity guard
    with pytest.raises(StyleSheetValidationError) as exc:
        _validate_body(f"{PLACEHOLDER} and {PLACEHOLDER}")
    assert "at most" in str(exc.value)
    # One placeholder — OK
    assert _validate_body(f"style of {PLACEHOLDER}") == f"style of {PLACEHOLDER}"
    # Zero placeholders — OK
    assert _validate_body("just style") == "just style"


# ─── Loader: CRUD round-trip ───────────────────────────────────────────────


def test_write_creates_directory_and_style_md():
    with tempfile.TemporaryDirectory() as d:
        user_dir = Path(d)
        sheet = write_style_sheet(user_dir, "wc", "Watercolor", "watercolor of {prompt}")
        assert isinstance(sheet, StyleSheet)
        assert sheet.name == "wc"
        assert sheet.description == "Watercolor"
        assert "{prompt}" in sheet.body
        assert sheet.path == user_dir / "wc" / "STYLE.md"
        assert sheet.path.exists()
        assert sheet.created_at == sheet.updated_at


def test_write_rejects_duplicate():
    with tempfile.TemporaryDirectory() as d:
        user_dir = Path(d)
        write_style_sheet(user_dir, "wc", "d", "b")
        with pytest.raises(StyleSheetValidationError) as exc:
            write_style_sheet(user_dir, "wc", "d", "b")
        assert "already exists" in str(exc.value)


def test_write_rejects_two_placeholders_at_creation():
    with tempfile.TemporaryDirectory() as d:
        with pytest.raises(StyleSheetValidationError):
            write_style_sheet(Path(d), "wc", "d", "{prompt} {prompt}")


def test_read_raw_roundtrip_and_missing():
    with tempfile.TemporaryDirectory() as d:
        user_dir = Path(d)
        write_style_sheet(user_dir, "wc", "Watercolor", "watercolor of {prompt}")
        fm, body, path = read_style_sheet_raw(user_dir, "wc")
        assert fm["name"] == "wc"
        assert fm["description"] == "Watercolor"
        assert "watercolor" in body
        assert path.exists()
        # Missing → None
        assert read_style_sheet_raw(user_dir, "nope") is None


def test_update_changes_body_and_preserves_description():
    with tempfile.TemporaryDirectory() as d:
        user_dir = Path(d)
        created = write_style_sheet(user_dir, "wc", "Orig", "orig body")
        updated = update_style_sheet(user_dir, "wc", body="new body")
        assert updated.body == "new body"
        assert updated.description == "Orig"  # preserved
        # created_at is preserved verbatim across updates; updated_at is a
        # fresh ISO timestamp. We don't compare the two for inequality —
        # _now_iso has second resolution and a fast update can land in the
        # same second as the create.
        assert updated.created_at == created.created_at
        assert updated.updated_at and "T" in updated.updated_at


def test_update_re_validates_placeholder_count():
    with tempfile.TemporaryDirectory() as d:
        user_dir = Path(d)
        write_style_sheet(user_dir, "wc", "d", "ok")
        with pytest.raises(StyleSheetValidationError):
            update_style_sheet(user_dir, "wc", body="{prompt} {prompt}")


def test_update_missing_sheet_raises():
    with tempfile.TemporaryDirectory() as d:
        with pytest.raises(StyleSheetValidationError):
            update_style_sheet(Path(d), "nope", body="x")


def test_delete_removes_directory_and_returns_false_for_missing():
    with tempfile.TemporaryDirectory() as d:
        user_dir = Path(d)
        write_style_sheet(user_dir, "wc", "d", "b")
        assert delete_style_sheet(user_dir, "wc") is True
        assert not (user_dir / "wc").exists()
        assert delete_style_sheet(user_dir, "wc") is False


def test_list_returns_sorted_sheets_and_empty_for_missing_dir():
    with tempfile.TemporaryDirectory() as d:
        user_dir = Path(d)
        # Empty dir → empty list
        assert list_style_sheets(user_dir) == []
        write_style_sheet(user_dir, "zebra", "Z", "z")
        write_style_sheet(user_dir, "alpha", "A", "a")
        names = [s.name for s in list_style_sheets(user_dir)]
        assert names == ["alpha", "zebra"]
        # Non-existent dir → empty list, not error
        assert list_style_sheets(user_dir / "does-not-exist") == []


def test_full_lifecycle():
    with tempfile.TemporaryDirectory() as d:
        user_dir = Path(d)
        # create
        sheet = write_style_sheet(user_dir, "life", "desc", "body of {prompt}")
        assert sheet.path.exists()
        # read
        fm, body, _ = read_style_sheet_raw(user_dir, "life")
        assert "body" in body
        # update
        update_style_sheet(user_dir, "life", description="new desc", body="new {prompt}")
        fm2, body2, _ = read_style_sheet_raw(user_dir, "life")
        assert fm2["description"] == "new desc"
        assert "new" in body2
        # delete
        assert delete_style_sheet(user_dir, "life") is True
        assert read_style_sheet_raw(user_dir, "life") is None


# ─── combine_prompt ─────────────────────────────────────────────────────────


def test_combine_prompt_substitutes_placeholder():
    assert combine_prompt("cat", "watercolor of {prompt}") == "watercolor of cat"


def test_combine_prompt_concatenates_when_no_placeholder():
    assert combine_prompt("cat", "pastel tones") == "cat, pastel tones"


def test_combine_prompt_handles_empty_user_prompt():
    assert combine_prompt("", "just style") == "just style"


def test_combine_prompt_handles_empty_body():
    assert combine_prompt("cat", "") == "cat"


def test_combine_prompt_only_replaces_first_occurrence():
    # Defensive: even though validation rejects 2 placeholders, the helper
    # itself must only substitute once (mirrors backend replace(…, 1)).
    result = combine_prompt("X", "{prompt}-{prompt}")
    assert result == "X-{prompt}"


# ─── default_user_dir ───────────────────────────────────────────────────────


def test_default_user_dir_is_under_minimax_studio():
    d = get_default_user_dir()
    assert "MiniMaxStudio" in str(d)
    assert "style-sheets" in str(d)


# ─── slugify + unique-name suggestion ────────────────────────────────────────


def test_kebab_slugify_basic():
    assert kebab_slugify("Warm Cel Anime") == "warm-cel-anime"
    assert kebab_slugify("  multiple   spaces  ") == "multiple-spaces"
    assert kebab_slugify("a/b\\c?d:e") == "a-b-c-d-e"


def test_kebab_slugify_strips_and_collapses():
    assert kebab_slugify("---leading-and-trailing---") == "leading-and-trailing"
    assert kebab_slugify("MIXED-Case_123") == "mixed-case-123"


def test_kebab_slugify_rejects_non_ascii_and_falls_back():
    # Non-ASCII letters are stripped; if nothing survives, fall back.
    assert kebab_slugify("한국어") == "style-1"
    assert kebab_slugify("!!!") == "style-1"


def test_kebab_slugify_enforces_leading_alnum():
    # Leading hyphen / digit-only leading must still pass _validate_name.
    assert kebab_slugify("-1990s") == "1990s"
    assert kebab_slugify("123") == "123"


def test_kebab_slugify_truncates_at_max_len():
    long = "a" * 80
    out = kebab_slugify(long, max_len=64)
    assert len(out) <= 64
    assert out == "a" * 64


def test_suggest_unique_name_passes_through_when_free():
    with tempfile.TemporaryDirectory() as d:
        user_dir = Path(d)
        assert suggest_unique_name(user_dir, "warm-cel-anime") == "warm-cel-anime"


def test_suggest_unique_name_appends_suffix_on_collision():
    with tempfile.TemporaryDirectory() as d:
        user_dir = Path(d)
        write_style_sheet(user_dir, "warm-cel-anime", "d", "b")
        write_style_sheet(user_dir, "warm-cel-anime-2", "d", "b")
        got = suggest_unique_name(user_dir, "warm-cel-anime")
        assert got == "warm-cel-anime-3"
        # Even after many collisions the result stays schema-valid and ≤64.
        for i in range(3, 12):
            write_style_sheet(user_dir, f"warm-cel-anime-{i}", "d", "b")
        got2 = suggest_unique_name(user_dir, "warm-cel-anime")
        assert _validate_name(got2) == got2
        assert len(got2) <= 64


def test_suggest_unique_name_truncates_overlong_proposal():
    long = "a" * 100
    with tempfile.TemporaryDirectory() as d:
        user_dir = Path(d)
        got = suggest_unique_name(user_dir, long)
        assert _validate_name(got) == got
        assert len(got) <= 64


def test_suggest_unique_name_truncation_avoids_double_hyphen():
    # base slug is exactly 64 chars with an internal hyphen at the boundary;
    # a collision must not synthesize a double hyphen in the truncated candidate.
    with tempfile.TemporaryDirectory() as d:
        user_dir = Path(d)
        proposal = "a" * 61 + " bc"   # kebab_slugify -> 'a'*61 + '-bc' (64 chars)
        base = "a" * 61 + "-bc"
        write_style_sheet(user_dir, base, "d", "b")  # force collision -> suffix branch
        got = suggest_unique_name(user_dir, proposal)
        assert _validate_name(got) == got
        assert "--" not in got
        assert len(got) <= 64
        assert got != base  # actually resolved the collision

# ─── API routes ────────────────────────────────────────────────────────────
#
# We patch _style_sheets_user_dir to a temp dir so the suite never touches
# the real ~/.local/share/MiniMaxStudio/style-sheets/.

# mcp_runtime is imported as a top-level module by web.backend.main, so the
# backend dir must be on sys.path.
sys.path.insert(0, str(PROJECT_ROOT / "web" / "backend"))
os.environ.setdefault("MINIMAX_PROJECT_ROOT", str(PROJECT_ROOT))

import web.backend.main as _main  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

TMP_STYLE_ROOT = Path(tempfile.mkdtemp(prefix="minimax_style_sheets_api_"))
TMP_STYLE_DIR = TMP_STYLE_ROOT / "sheets"
TMP_STYLE_DIR.mkdir(parents=True, exist_ok=True)

# Persistent patch for the whole module — every API call lands in the temp dir.
_patch = patch.object(_main, "_style_sheets_user_dir", return_value=TMP_STYLE_DIR)
_patch.start()

client = TestClient(_main.app)


def test_api_list_empty_then_populated():
    assert client.get("/api/style-sheets").json()["style_sheets"] == []
    r = client.post("/api/style-sheets", json={
        "name": "watercolor",
        "description": "Watercolor, pastel",
        "body": "watercolor of {prompt}, pastel tones",
    })
    assert r.status_code == 200
    data = client.get("/api/style-sheets").json()
    assert data["success"] is True
    assert data["count"] == 1
    sheet = data["style_sheets"][0]
    assert sheet["name"] == "watercolor"
    assert sheet["prompt_placeholder_count"] == 1
    assert sheet["body_length"] == len("watercolor of {prompt}, pastel tones")


def test_api_get_single_and_404():
    client.post("/api/style-sheets", json={
        "name": "cinematic",
        "description": "Cinematic",
        "body": "cinematic lighting",
    })
    r = client.get("/api/style-sheets/cinematic")
    assert r.status_code == 200
    assert r.json()["style_sheet"]["name"] == "cinematic"
    assert "raw_markdown" in r.json()["style_sheet"]
    # 404
    r404 = client.get("/api/style-sheets/does-not-exist")
    assert r404.status_code == 404


def test_api_create_rejects_two_placeholders_with_400():
    r = client.post("/api/style-sheets", json={
        "name": "bad",
        "description": "d",
        "body": "{prompt} and {prompt}",
    })
    assert r.status_code == 400
    assert "at most" in r.json()["detail"]


def test_api_create_rejects_invalid_name_with_400():
    r = client.post("/api/style-sheets", json={
        "name": "INVALID UPPER",
        "description": "d",
        "body": "b",
    })
    assert r.status_code == 400


def test_api_update_then_verify():
    client.post("/api/style-sheets", json={
        "name": "to-update",
        "description": "Old",
        "body": "old body",
    })
    r = client.put("/api/style-sheets/to-update", json={
        "description": "New desc",
        "body": "new body of {prompt}",
    })
    assert r.status_code == 200
    sheet = r.json()["style_sheet"]
    assert sheet["description"] == "New desc"
    assert "{prompt}" in sheet["body"]
    # GET reflects the change
    fresh = client.get("/api/style-sheets/to-update").json()["style_sheet"]
    assert fresh["description"] == "New desc"


def test_api_update_404_for_missing():
    r = client.put("/api/style-sheets/ghost", json={"body": "x"})
    assert r.status_code == 404


def test_api_delete_then_gone():
    client.post("/api/style-sheets", json={
        "name": "doomed",
        "description": "d",
        "body": "b",
    })
    r = client.delete("/api/style-sheets/doomed")
    assert r.status_code == 200
    assert r.json()["deleted"] == "doomed"
    assert client.get("/api/style-sheets/doomed").status_code == 404


def test_api_delete_404_for_missing():
    assert client.delete("/api/style-sheets/ghost").status_code == 404
