"""Tests for POST /api/style-sheets/draft.

Covers the natural-language brief path, the two image-source paths,
request validation, workspace traversal rejection, model-output
normalization, name collision, locale-agnostic validation, and the
read-only guarantee (no STYLE.md is written).
"""

import base64
import json
import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(PROJECT_ROOT / "web" / "backend"))
os.environ.setdefault("MINIMAX_PROJECT_ROOT", str(PROJECT_ROOT))

import web.backend.main as _main  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

TMP_ROOT = Path(tempfile.mkdtemp(prefix="minimax_style_draft_"))
os.environ["MINIMAX_PROJECT_ROOT"] = str(TMP_ROOT)
TMP_STYLE_DIR = TMP_ROOT / "sheets"
TMP_STYLE_DIR.mkdir(parents=True, exist_ok=True)
TMP_WS = _main.get_app_workspace_dir()
(TMP_WS / "generations" / "images").mkdir(parents=True, exist_ok=True)

_patch = patch.object(_main, "_style_sheets_user_dir", return_value=TMP_STYLE_DIR)
_patch.start()

client = TestClient(_main.app)

# 1x1 PNG.
_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAA"
    "AAAYAAjCB0C8AAAAASUVORK5CYII="
)
_PNG_DATA_URL = "data:image/png;base64," + _PNG_B64


def _cfg_ok():
    return {"api_key": "k", "api_base": "u"}


def _make_llm_return(fragment: str, name: str = "warm-cel-anime", desc: str = "Warm cel"):
    """Build a fake LLMResponse-shaped object with the JSON we expect the
    server to parse out of response.content."""
    payload = {"name": name, "description": desc, "style_fragment": fragment}
    class _Resp:
        content = json.dumps(payload)
        thinking = None
        tool_calls = None
        finish_reason = "stop"
        usage = None
    return _Resp()


# ─── natural-language draft ─────────────────────────────────────────────────


def test_description_draft_returns_valid_draft(monkeypatch):
    monkeypatch.setattr(_main, "get_minimax_config", _cfg_ok)
    fake = _make_llm_return("1990s Japanese cel animation, warm sunset palette")
    with patch.object(_main.LLMClient, "generate", new=AsyncMock(return_value=fake)):
        res = client.post("/api/style-sheets/draft", json={
            "mode": "description",
            "brief": "1990s Japanese animation, cel shading, warm sunset light",
        })
    assert res.status_code == 200, res.text
    draft = res.json()["draft"]
    assert draft["body"].startswith("{prompt}, ")
    assert "cel animation" in draft["body"]
    assert draft["description"]
    # name passes schema
    assert _main._validate_name(draft["name"]) == draft["name"]


def test_description_draft_normalizes_uppercase_name(monkeypatch):
    monkeypatch.setattr(_main, "get_minimax_config", _cfg_ok)
    fake = _make_llm_return("film grain, 35mm", name="Cinematic Dark", desc="d")
    with patch.object(_main.LLMClient, "generate", new=AsyncMock(return_value=fake)):
        res = client.post("/api/style-sheets/draft", json={"mode": "description", "brief": "x"})
    assert res.status_code == 200
    name = res.json()["draft"]["name"]
    assert name == "cinematic-dark"


def test_description_draft_appends_suffix_on_collision(monkeypatch):
    monkeypatch.setattr(_main, "get_minimax_config", _cfg_ok)
    # Pre-populate the temp user dir.
    client.post("/api/style-sheets", json={"name": "warm-cel-anime", "description": "x", "body": "b"})
    fake = _make_llm_return("cel animation", name="warm-cel-anime", desc="d")
    with patch.object(_main.LLMClient, "generate", new=AsyncMock(return_value=fake)):
        res = client.post("/api/style-sheets/draft", json={"mode": "description", "brief": "x"})
    assert res.status_code == 200
    got = res.json()["draft"]["name"]
    assert got.startswith("warm-cel-anime")
    assert got != "warm-cel-anime"


def test_description_draft_502_on_malformed_json(monkeypatch):
    monkeypatch.setattr(_main, "get_minimax_config", _cfg_ok)
    class _Bad:
        content = "not json at all"
        thinking = None; tool_calls = None; finish_reason = "stop"; usage = None
    with patch.object(_main.LLMClient, "generate", new=AsyncMock(return_value=_Bad())):
        res = client.post("/api/style-sheets/draft", json={"mode": "description", "brief": "x"})
    assert res.status_code == 502


def test_description_draft_502_when_missing_fields(monkeypatch):
    monkeypatch.setattr(_main, "get_minimax_config", _cfg_ok)
    class _Partial:
        content = json.dumps({"name": "x"})  # missing description + fragment
        thinking = None; tool_calls = None; finish_reason = "stop"; usage = None
    with patch.object(_main.LLMClient, "generate", new=AsyncMock(return_value=_Partial())):
        res = client.post("/api/style-sheets/draft", json={"mode": "description", "brief": "x"})
    assert res.status_code == 502


def test_description_draft_400_on_blank_brief(monkeypatch):
    monkeypatch.setattr(_main, "get_minimax_config", _cfg_ok)
    res = client.post("/api/style-sheets/draft", json={"mode": "description", "brief": "   "})
    assert res.status_code == 400


def test_description_draft_400_on_oversized_brief(monkeypatch):
    monkeypatch.setattr(_main, "get_minimax_config", _cfg_ok)
    res = client.post("/api/style-sheets/draft", json={"mode": "description", "brief": "x" * 600})
    assert res.status_code == 400


def test_description_draft_400_without_api_key(monkeypatch):
    monkeypatch.setattr(_main, "get_minimax_config", lambda: {"api_key": "", "api_base": "u"})
    res = client.post("/api/style-sheets/draft", json={"mode": "description", "brief": "x"})
    assert res.status_code == 400


def test_description_draft_truncates_oversized_fragment(monkeypatch):
    monkeypatch.setattr(_main, "get_minimax_config", _cfg_ok)
    big = "x" * 1500
    fake = _make_llm_return(big, name="big", desc="d")
    with patch.object(_main.LLMClient, "generate", new=AsyncMock(return_value=fake)):
        res = client.post("/api/style-sheets/draft", json={"mode": "description", "brief": "x"})
    assert res.status_code == 200
    body = res.json()["draft"]["body"]
    # body = "{prompt}, <fragment>" and must be ≤ BODY_MAX (1000).
    assert body.count("{prompt}") == 1
    assert len(body) <= 1000


# ─── image draft (both sources) ──────────────────────────────────────────────


def _vlm_ok(fragment="oil painting, thick impasto strokes", name="impasto-oil", desc="Impasto oil"):
    payload = {"name": name, "description": desc, "style_fragment": fragment}
    return True, json.dumps(payload)


def test_image_draft_from_data_url_calls_vlm(monkeypatch):
    monkeypatch.setattr(_main, "get_minimax_config", _cfg_ok)
    captured = {}
    def fake_understand(self, image_path=None, image_url=None, prompt=""):
        captured["path"] = image_path
        captured["existed"] = Path(image_path).exists()
        return _vlm_ok()
    with patch("mini_max_mcp.mcp_tools.MiniMaxMCPClient.understand_image", fake_understand):
        res = client.post("/api/style-sheets/draft", json={
            "mode": "image", "image_data_url": _PNG_DATA_URL,
        })
    assert res.status_code == 200, res.text
    body = res.json()["draft"]["body"]
    assert body.startswith("{prompt}, ")
    assert "impasto" in body
    assert captured["existed"] is True
    # Temp file cleaned up.
    assert not Path(captured["path"]).exists()


def test_image_draft_from_workspace_path_calls_vlm(monkeypatch):
    monkeypatch.setattr(_main, "get_minimax_config", _cfg_ok)
    img_rel = "generations/images/sample.png"
    img_abs = _main.get_app_workspace_dir() / img_rel
    img_abs.parent.mkdir(parents=True, exist_ok=True)
    img_abs.write_bytes(base64.b64decode(_PNG_B64))
    captured = {}
    def fake_understand(self, image_path=None, image_url=None, prompt=""):
        captured["path"] = image_path
        return _vlm_ok()
    with patch("mini_max_mcp.mcp_tools.MiniMaxMCPClient.understand_image", fake_understand):
        res = client.post("/api/style-sheets/draft", json={
            "mode": "image", "image_path": img_rel,
        })
    assert res.status_code == 200
    assert res.json()["draft"]["body"].startswith("{prompt}, ")
    assert captured["path"] == str(img_abs)


def test_image_draft_rejects_both_sources(monkeypatch):
    monkeypatch.setattr(_main, "get_minimax_config", _cfg_ok)
    res = client.post("/api/style-sheets/draft", json={
        "mode": "image",
        "image_path": "generations/images/x.png",
        "image_data_url": _PNG_DATA_URL,
    })
    assert res.status_code == 400


def test_image_draft_rejects_neither_source(monkeypatch):
    monkeypatch.setattr(_main, "get_minimax_config", _cfg_ok)
    res = client.post("/api/style-sheets/draft", json={"mode": "image"})
    assert res.status_code == 400


def test_image_draft_403_on_traversal(monkeypatch):
    monkeypatch.setattr(_main, "get_minimax_config", _cfg_ok)
    res = client.post("/api/style-sheets/draft", json={
        "mode": "image", "image_path": "../../etc/passwd",
    })
    assert res.status_code == 403


def test_image_draft_404_on_missing_file(monkeypatch):
    monkeypatch.setattr(_main, "get_minimax_config", _cfg_ok)
    res = client.post("/api/style-sheets/draft", json={
        "mode": "image", "image_path": "generations/images/ghost.png",
    })
    assert res.status_code == 404


def test_image_draft_400_on_unsupported_mime(monkeypatch):
    monkeypatch.setattr(_main, "get_minimax_config", _cfg_ok)
    res = client.post("/api/style-sheets/draft", json={
        "mode": "image", "image_data_url": "data:image/bmp;base64,AAAA",
    })
    assert res.status_code == 400


def test_image_draft_400_on_malformed_data_url(monkeypatch):
    monkeypatch.setattr(_main, "get_minimax_config", _cfg_ok)
    res = client.post("/api/style-sheets/draft", json={
        "mode": "image", "image_data_url": "data:image/png;notbase64,garbage",
    })
    assert res.status_code == 400


def test_image_draft_502_on_vlm_failure(monkeypatch):
    monkeypatch.setattr(_main, "get_minimax_config", _cfg_ok)
    with patch(
        "mini_max_mcp.mcp_tools.MiniMaxMCPClient.understand_image",
        return_value=(False, "rate limited"),
    ):
        res = client.post("/api/style-sheets/draft", json={
            "mode": "image", "image_data_url": _PNG_DATA_URL,
        })
    assert res.status_code == 502


def test_image_draft_502_on_non_json_vlm(monkeypatch):
    monkeypatch.setattr(_main, "get_minimax_config", _cfg_ok)
    with patch(
        "mini_max_mcp.mcp_tools.MiniMaxMCPClient.understand_image",
        return_value=(True, "not json"),
    ):
        res = client.post("/api/style-sheets/draft", json={
            "mode": "image", "image_data_url": _PNG_DATA_URL,
        })
    assert res.status_code == 502


# ─── read-only guarantee ─────────────────────────────────────────────────────


def test_draft_does_not_persist(monkeypatch):
    monkeypatch.setattr(_main, "get_minimax_config", _cfg_ok)
    fake = _make_llm_return("watercolor, soft washes", name="wc-draft", desc="d")
    before = set(p.name for p in TMP_STYLE_DIR.glob("*") if p.is_dir())
    with patch.object(_main.LLMClient, "generate", new=AsyncMock(return_value=fake)):
        client.post("/api/style-sheets/draft", json={"mode": "description", "brief": "x"})
    after = set(p.name for p in TMP_STYLE_DIR.glob("*") if p.is_dir())
    assert before == after
