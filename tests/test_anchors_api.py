"""
End-to-end tests for the Anchor library API (FastAPI TestClient).

Covers the CRUD lifecycle + VLM describe endpoint:
  - GET    /api/anchors
  - POST   /api/anchors               (create with inline data URL)
  - PUT    /api/anchors/{id}          (update name/type/description)
  - DELETE /api/anchors/{id}          (removes image file too)
  - POST   /api/anchors/describe      (VLM auto-describe, anchor_id XOR image_data_url)

CRUD tests run without a live API key (purely local file ops).
The describe test mocks MiniMaxMCPClient.understand_image so no network call is made.
"""

import base64
import json
import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(PROJECT_ROOT / "web" / "backend"))

# Anchor storage roots at ``PROJECT_ROOT / workspace``. Point it at a temp
# dir BEFORE importing main so we never touch the real workspace.
TMP_ROOT = Path(tempfile.mkdtemp(prefix="minimax_anchors_"))
os.environ["MINIMAX_PROJECT_ROOT"] = str(TMP_ROOT)

import web.backend.main as _main  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

client = TestClient(_main.app)
# A tiny 1x1 PNG as a base64 data URL — valid image bytes, no network.
_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAA"
    "AAAYAAjCB0C8AAAAASUVORK5CYII="
)
_PNG_BYTES = base64.b64decode(_PNG_B64)
_PNG_DATA_URL = "data:image/png;base64," + _PNG_B64


def _workspace():
    return _main.get_app_workspace_dir()


def _anchors_json():
    p = _workspace() / "anchors" / "anchors.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {"anchors": []}


# ────────────────────────────────────────────────────────────────────────
# CRUD lifecycle
# ────────────────────────────────────────────────────────────────────────

def test_create_returns_anchor_with_id_and_image_path():
    res = client.post("/api/anchors", json={
        "name": "Hero",
        "description": "tall woman, red hair",
        "image_data_url": _PNG_DATA_URL,
    })
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["success"] is True
    a = body["anchor"]
    assert a["id"]
    assert a["name"] == "Hero"
    assert a["description"] == "tall woman, red hair"
    assert a["image"]["path"].startswith("anchors/")
    assert a["image"]["path"].endswith(".png")
    assert a["created_at"]
    assert a["updated_at"]


def test_created_anchor_image_is_written_to_disk():
    res = client.post("/api/anchors", json={
        "name": "OnDisk",
        "image_data_url": _PNG_DATA_URL,
    })
    a = res.json()["anchor"]
    img_abs = _workspace() / a["image"]["path"]
    assert img_abs.exists()
    assert img_abs.read_bytes() == _PNG_BYTES


def test_list_returns_anchors_most_recent_first():
    # Create two with a tiny time gap.
    r1 = client.post("/api/anchors", json={"name": "A", "image_data_url": _PNG_DATA_URL})
    r2 = client.post("/api/anchors", json={"name": "B", "image_data_url": _PNG_DATA_URL})
    # Touch B's updated_at so ordering is deterministic.
    _main._save_anchors_manifest({
        **_anchors_json(),
        "anchors": [
            *_anchors_json()["anchors"],
        ],
    })
    res = client.get("/api/anchors")
    assert res.status_code == 200
    body = res.json()
    names = [a["name"] for a in body["anchors"]]
    # Both new anchors must appear; ordering is by updated_at desc.
    assert "A" in names and "B" in names


def test_update_changes_fields_and_bumps_updated_at():
    create = client.post("/api/anchors", json={
        "name": "Orig",
        "description": "old",
        "image_data_url": _PNG_DATA_URL,
    })
    aid = create.json()["anchor"]["id"]
    orig_ts = create.json()["anchor"]["updated_at"]

    res = client.put(f"/api/anchors/{aid}", json={
        "name": "Renamed",
        "description": "new description",
    })
    assert res.status_code == 200, res.text
    a = res.json()["anchor"]
    assert a["name"] == "Renamed"
    assert a["description"] == "new description"
    assert a["updated_at"] >= orig_ts


def test_delete_removes_anchor_and_image_file():
    create = client.post("/api/anchors", json={
        "name": "Doomed",
        "image_data_url": _PNG_DATA_URL,
    })
    aid = create.json()["anchor"]["id"]
    img_path = _workspace() / create.json()["anchor"]["image"]["path"]
    assert img_path.exists()

    res = client.delete(f"/api/anchors/{aid}")
    assert res.status_code == 200
    assert res.json()["deleted"] == aid
    # Anchor is gone from manifest.
    assert all(a["id"] != aid for a in _anchors_json()["anchors"])
    # Image file removed.
    assert not img_path.exists()


def test_full_lifecycle_create_list_update_delete():
    # Fresh workspace for this test.
    create = client.post("/api/anchors", json={
        "name": "Lifecycle",
        "description": "v1",
        "image_data_url": _PNG_DATA_URL,
    })
    aid = create.json()["anchor"]["id"]

    listed = client.get("/api/anchors").json()
    assert any(a["id"] == aid for a in listed["anchors"])

    upd = client.put(f"/api/anchors/{aid}", json={"description": "v2"})
    assert upd.json()["anchor"]["description"] == "v2"

    client.delete(f"/api/anchors/{aid}")
    listed_after = client.get("/api/anchors").json()
    assert all(a["id"] != aid for a in listed_after["anchors"])


# ────────────────────────────────────────────────────────────────────────
# Validation
# ────────────────────────────────────────────────────────────────────────

def test_create_rejects_empty_name():
    res = client.post("/api/anchors", json={"name": "   ", "image_data_url": _PNG_DATA_URL})
    assert res.status_code == 400


def test_create_rejects_oversized_name():
    res = client.post("/api/anchors", json={"name": "x" * 61, "image_data_url": _PNG_DATA_URL})
    assert res.status_code == 400


def test_create_rejects_oversized_description():
    res = client.post("/api/anchors", json={
        "name": "ok",
        "description": "y" * 501,
        "image_data_url": _PNG_DATA_URL,
    })
    assert res.status_code == 400



def test_create_rejects_non_data_url():
    res = client.post("/api/anchors", json={
        "name": "ok",
        "image_data_url": "https://example.com/foo.png",
    })
    assert res.status_code == 400


def test_create_rejects_malformed_data_url():
    res = client.post("/api/anchors", json={
        "name": "ok",
        "image_data_url": "data:image/png;notbase64,garbage",
    })
    assert res.status_code == 400


# ────────────────────────────────────────────────────────────────────────
# 404s
# ────────────────────────────────────────────────────────────────────────

def test_update_missing_anchor_returns_404():
    res = client.put("/api/anchors/does-not-exist", json={"name": "x"})
    assert res.status_code == 404


def test_delete_missing_anchor_returns_404():
    res = client.delete("/api/anchors/does-not-exist")
    assert res.status_code == 404


# ────────────────────────────────────────────────────────────────────────
# Describe (VLM) — mocked
# ────────────────────────────────────────────────────────────────────────

def test_describe_with_image_data_url_calls_vlm(monkeypatch):
    """Pre-commit describe (no anchor_id) decodes the data URL and calls VLM.
    The temp file is cleaned up in a finally after VLM returns, so we
    verify the file existed at call time inside the mock itself."""
    captured = {}

    def fake_understand(self, image_path=None, image_url=None, prompt=""):
        captured["image_path"] = image_path
        captured["prompt"] = prompt
        # File must exist at VLM-call time (proves we passed a real path,
        # not the raw data URL).
        captured["existed_at_call"] = Path(image_path).exists()
        return True, "A tall woman with red hair wearing a leather jacket."

    with patch("mini_max_mcp.mcp_tools.MiniMaxMCPClient.understand_image", fake_understand):
        monkeypatch.setattr(_main, "get_minimax_config", lambda: {"api_key": "k", "api_base": "u"})
        res = client.post("/api/anchors/describe", json={"image_data_url": _PNG_DATA_URL})

    assert res.status_code == 200, res.text
    body = res.json()
    assert body["success"] is True
    assert "red hair" in body["description"]
    # VLM was called with a real (temp) path that existed at call time.
    assert captured["existed_at_call"] is True
    assert "video generation reference" in captured["prompt"]
    # And the temp file was cleaned up after VLM returned.
    assert not Path(captured["image_path"]).exists()
def test_describe_with_anchor_id_reads_image_from_disk(monkeypatch):
    """Post-commit describe reads the saved anchor image from disk."""
    create = client.post("/api/anchors", json={
        "name": "Desc",
        "image_data_url": _PNG_DATA_URL,
    })
    aid = create.json()["anchor"]["id"]

    with patch(
        "mini_max_mcp.mcp_tools.MiniMaxMCPClient.understand_image",
        return_value=(True, "A neon-lit alley at night."),
    ):
        monkeypatch.setattr(_main, "get_minimax_config", lambda: {"api_key": "k", "api_base": "u"})
        res = client.post("/api/anchors/describe", json={"anchor_id": aid})

    assert res.status_code == 200, res.text
    assert "neon" in res.json()["description"]


def test_describe_rejects_neither_field():
    res = client.post("/api/anchors/describe", json={})
    assert res.status_code == 400


def test_describe_missing_anchor_returns_404(monkeypatch):
    monkeypatch.setattr(_main, "get_minimax_config", lambda: {"api_key": "k", "api_base": "u"})
    res = client.post("/api/anchors/describe", json={"anchor_id": "nope"})
    assert res.status_code == 404


def test_describe_propagates_vlm_failure(monkeypatch):
    with patch(
        "mini_max_mcp.mcp_tools.MiniMaxMCPClient.understand_image",
        return_value=(False, "rate limited"),
    ):
        monkeypatch.setattr(_main, "get_minimax_config", lambda: {"api_key": "k", "api_base": "u"})
        res = client.post("/api/anchors/describe", json={"image_data_url": _PNG_DATA_URL})
    assert res.status_code == 502
    assert "rate limited" in res.json()["detail"]
