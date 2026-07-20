# Inline Style Sheet Creation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users author, AI-draft, and image-extract image style sheets without leaving the Image panel, using one shared editor backed by a single new read-only draft endpoint.

**Architecture:** A new `POST /api/style-sheets/draft` endpoint produces an editable `{name, description, body}` draft from either a natural-language brief or a workspace image. The frontend extracts the existing editor inside `StyleSheetsTab.jsx` into a shared `StyleSheetEditor` + `StyleSheetModal` and adds a `desktop/src/lib/styleSheets.js` API client. `ImagePanel` gains a `+` button that opens the shared editor; `RecentGenerations` gains an optional "Save as style" callback. Storage, validation, CRUD routes, and `/api/image` prompt combination are unchanged.

**Tech Stack:** FastAPI + Pydantic (backend), `mini_agent.tools.style_sheet_loader` (validation/storage), `mini_agent.llm.LLMClient` (LLM draft), `mini_max_mcp.mcp_tools.MiniMaxMCPClient.understand_image` (VLM), React 18 + `react-i18next` + Tailwind (frontend), Vitest + jsdom (frontend tests), pytest + FastAPI TestClient (backend tests).

## Global Constraints

- Existing style sheet storage, validation, CRUD routes (`GET/POST/PUT/DELETE /api/style-sheets[/{name}]`), and `/api/image` prompt combination are never modified.
- Name schema: `^[a-z0-9][a-z0-9-]{0,63}$`; description 1–1024 chars; body 1–1000 chars; body contains `{prompt}` zero or one times. These are enforced by `mini_agent/tools/style_sheet_loader.py`.
- Draft API is read-only: it must never call `write_style_sheet`, create a directory, or otherwise persist.
- Final draft body is always constructed by the server as `"{prompt}, <validated style_fragment>"` — never authored by the model.
- Workspace image paths resolve only under `get_app_workspace_dir()` via `_safe_join`; traversal → 403.
- Inline image data: supported MIME only (`png`, `jpeg`, `webp`, `gif`); decoded size ≤ 10 MiB; temporary file removed in `finally`.
- Frontend tests run via `cd desktop && npm test` (Vitest, jsdom). Backend tests via `pytest -q tests/test_style_sheets.py tests/test_style_sheet_draft_api.py`.
- Six i18n languages: `en.json`, `ko.json`, `ja.json`, `zh-CN.json`, `es.json`, `pt-BR.json`. English keys are the source of truth; other languages fall back to English.
- No source image bytes or paths are written into `STYLE.md`.

---

## File Structure

### Backend

| File | Responsibility |
|---|---|
| `web/backend/main.py` (modify) | Add `StyleSheetDraftRequest` model, `_style_sheet_normalize_draft`, `_style_sheet_resolve_image_path`, `STYLE_DRAFT_LLM_PROMPT`, `STYLE_DRAFT_VLM_PROMPT`, and `POST /api/style-sheets/draft` route |
| `mini_agent/tools/style_sheet_loader.py` (modify) | Add `suggest_unique_name(user_dir, proposal) -> str` and `kebab_slugify(text) -> str` helpers |
| `tests/test_style_sheet_draft_api.py` (create) | Backend coverage for the draft endpoint |
| `tests/test_style_sheets.py` (modify) | Add loader tests for the new helpers |

### Frontend

| File | Responsibility |
|---|---|
| `desktop/src/lib/styleSheets.js` (create) | API client: `listStyleSheets`, `getStyleSheet`, `createStyleSheet`, `updateStyleSheet`, `deleteStyleSheet`, `draftStyleSheetFromBrief`, `draftStyleSheetFromImage` |
| `desktop/src/components/style-sheets/StyleSheetModal.jsx` (create) | Shared modal shell (overlay, title, close, scroll) |
| `desktop/src/components/style-sheets/StyleSheetEditor.jsx` (create) | Shared editor with three start modes + shared form, save lifecycle |
| `desktop/src/components/style-sheets/index.js` (create) | Barrel exports |
| `desktop/src/components/settings/StyleSheetsTab.jsx` (modify) | Replace inline editor with shared `StyleSheetEditor`; keep toolbar/list/view/delete |
| `desktop/src/components/media/ImagePanel.jsx` (modify) | Add `+` and edit buttons, modal state, save-and-apply merge/select |
| `desktop/src/components/media/RecentGenerations.jsx` (modify) | Add optional `onSaveAsStyle(item)` callback for image cards |
| `desktop/src/components/style-sheets/StyleSheetEditor.test.jsx` (create) | Frontend editor tests |
| `desktop/src/lib/styleSheets.test.js` (create) | Frontend API client tests |
| `desktop/src/components/media/ImagePanel.style-create.test.jsx` (create) | ImagePanel `+` button integration test |
| `desktop/src/i18n/*.json` (modify, 6 files) | New keys under `styleSheets.*` and `image.*` |

---

## Task 1: Loader helpers — slugify and unique-name suggestion

**Files:**
- Modify: `mini_agent/tools/style_sheet_loader.py` (add at end of "Convenience" section, after `get_default_user_dir`)
- Test: `tests/test_style_sheets.py` (append new tests)

**Interfaces:**
- Produces:
  - `kebab_slugify(text: str, max_len: int = 64) -> str` — lowercase, ASCII-only, `[a-z0-9-]`, collapse separators, strip leading/trailing hyphens, default-fill to `"style-1"` if empty.
  - `suggest_unique_name(user_dir: Path, proposal: str) -> str` — returns a name passing `_validate_name` that does not collide with an existing sheet directory; appends `-2`, `-3`, … while staying within 64 chars; falls back to `"style"`, `"style-2"`, … if the proposal slugs to empty or to `"style"` collision chain.

- [ ] **Step 1: Write failing tests** — append to `tests/test_style_sheets.py`:

```python
from mini_agent.tools.style_sheet_loader import (  # noqa: E402
    kebab_slugify,
    suggest_unique_name,
)


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
```

- [ ] **Step 2: Run the tests to confirm failure**

Run: `pytest -q tests/test_style_sheets.py -k "kebab_slugify or suggest_unique_name"`
Expected: `ImportError: cannot import name 'kebab_slugify' ...`

- [ ] **Step 3: Implement the helpers** — append to `mini_agent/tools/style_sheet_loader.py` after `get_default_user_dir`:

```python
import re as _re
import unicodedata as _unicodedata


_SLUG_RE = _re.compile(r"[^a-z0-9]+")


def kebab_slugify(text: str, max_len: int = NAME_MAX) -> str:
    """Slugify ``text`` into a name passing ``_validate_name``.

    - lowercase ASCII only (accents stripped via NFKD decomposition);
    - non-``[a-z0-9]`` runs collapse to a single ``-``;
    - leading/trailing hyphens stripped;
    - truncated to ``max_len`` (then trailing hyphen re-stripped);
    - falls back to ``"style-1"`` if the result would be empty or
      start with a hyphen after stripping.
    """
    raw = (text or "").strip().lower()
    # Decompose accents and drop combining marks, then drop non-ASCII.
    decomposed = _unicodedata.normalize("NFKD", raw)
    ascii_only = "".join(c for c in decomposed if ord(c) < 128)
    slug = _SLUG_RE.sub("-", ascii_only).strip("-")
    if len(slug) > max_len:
        slug = slug[:max_len].rstrip("-")
    if not slug:
        return "style-1"
    return slug


def suggest_unique_name(user_dir: Path, proposal: str) -> str:
    """Return a name that passes ``_validate_name`` and does not collide
    with an existing sheet under ``user_dir``.

    Appends ``-2``, ``-3``, … on collision. If the slugified proposal is
    unusable, falls back to ``"style"``, ``"style-2"``, …
    """
    base = kebab_slugify(proposal)
    if base == "style-1":
        # Empty proposal — use the documented fallback stem.
        base = "style"
    existing = {p.name for p in user_dir.glob("*") if p.is_dir()} if user_dir.exists() else set()

    candidate = base
    suffix = 1
    while candidate in existing or not _re.match(r"^[a-z0-9][a-z0-9-]{0,63}$", candidate):
        suffix += 1
        suffix_str = f"-{suffix}"
        if len(base) + len(suffix_str) > NAME_MAX:
            trimmed = base[: NAME_MAX - len(suffix_str)]
            candidate = f"{trimmed}{suffix_str}"
        else:
            candidate = f"{base}{suffix_str}"
        # Safety: if suffix grows absurdly large, bail with the plain stem.
        if suffix > 10000:
            candidate = base
            break
    return candidate
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `pytest -q tests/test_style_sheets.py`
Expected: all green, no regressions in existing loader tests.

- [ ] **Step 5: Commit**

```bash
git add mini_agent/tools/style_sheet_loader.py tests/test_style_sheets.py
git commit -m "feat(style-sheets): add kebab_slugify + suggest_unique_name loader helpers"
```

---

## Task 2: Backend draft endpoint

**Files:**
- Modify: `web/backend/main.py` (insert new code immediately after the `DELETE /api/style-sheets/{name}` route, before `# --- Anchor library ...`)
- Test: `tests/test_style_sheet_draft_api.py` (create)

**Interfaces:**
- Consumes:
  - `mini_agent.tools.style_sheet_loader.{kebab_slugify, suggest_unique_name, _validate_name, _validate_description, BODY_MAX, NAME_MAX, DESCRIPTION_MAX}` (from Task 1)
  - `mini_max_mcp.mcp_tools.MiniMaxMCPClient.understand_image(image_path: str, prompt: str) -> (bool, str)` (existing)
  - `mini_agent.llm.LLMClient` + `mini_agent.schema.schema.{Message, LLMProvider}` (existing)
  - `web.backend.main.{_safe_join, get_app_workspace_dir, get_minimax_config, _style_sheets_user_dir, _serialize_style_sheet, HTTPException}` (existing)
- Produces:
  - `POST /api/style-sheets/draft` accepting `StyleSheetDraftRequest`, returning `{"success": True, "draft": {"name": str, "description": str, "body": str}}`. Draft body is exactly `"{prompt}, <fragment>"`.

- [ ] **Step 1: Write the failing test file** — `tests/test_style_sheet_draft_api.py`:

```python
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
```

- [ ] **Step 2: Run the tests to confirm failure**

Run: `pytest -q tests/test_style_sheet_draft_api.py`
Expected: FAIL (404 on every route — route doesn't exist yet).

- [ ] **Step 3: Add request model + helpers + route** — insert into `web/backend/main.py` immediately after the existing `DELETE /api/style-sheets/{name}` route (before the `# --- Anchor library ...` banner):

```python
class StyleSheetDraftRequest(BaseModel):
    """Body for ``POST /api/style-sheets/draft``.

    ``mode`` is either ``"description"`` (uses ``brief``) or ``"image"``
    (uses exactly one of ``image_path`` / ``image_data_url``). The route
    is read-only with respect to style-sheet storage — it returns a draft
    only; persistence happens later through ``POST /api/style-sheets``.
    """
    mode: str = "description"
    brief: Optional[str] = None
    image_path: Optional[str] = None
    image_data_url: Optional[str] = None


# Brief cap mirrors a generous user prompt; the model has ~BODY_MAX of
# real estate for the style fragment after the server prepends
# "{prompt}, " (see _build_style_draft_body).
STYLE_DRAFT_BRIEF_MAX = 500
STYLE_DRAFT_FRAGMENT_MAX = 900  # leaves room for "{prompt}, " under BODY_MAX=1000

STYLE_DRAFT_LLM_PROMPT = (
    "You propose a reusable image style sheet. From the user's brief, "
    "produce ONE JSON object and nothing else, with keys: "
    "\"name\" (lowercase kebab-case, letters/digits/hyphens, <=64 chars, "
    "leading alphanumeric), \"description\" (<=120 chars), "
    "and \"style_fragment\" (concise transferable visual style only: "
    "medium, art direction, palette, lighting, texture, line work, "
    "rendering treatment — NO subject identity, objects, scene content, "
    "logos, or visible text; <=900 chars)."
)

STYLE_DRAFT_VLM_PROMPT = (
    "Analyze ONLY the transferable visual style of this image: medium, "
    "art direction, palette and color treatment, lighting, surface "
    "texture, line work, and rendering/photographic characteristics. "
    "Do NOT identify or describe people, clothing, objects, the scene, "
    "action, logos, captions, or visible text; do NOT infer sensitive "
    "attributes. Return ONE JSON object and nothing else with keys: "
    "\"name\" (lowercase kebab-case), \"description\" (<=120 chars), "
    "and \"style_fragment\" (<=900 chars)."
)

_STYLE_DRAFT_MIME_EXT = {
    "png": "png", "jpeg": "jpg", "jpg": "jpg",
    "webp": "webp", "gif": "gif",
}


def _parse_style_draft_payload(raw: str) -> dict:
    """Parse + sanity-check the model's structured response.

    Returns ``{"name", "description", "style_fragment"}`` on success.
    Raises ``ValueError`` on any malformed/missing field; the caller
    maps that to HTTP 502.
    """
    import json as _json
    try:
        data = _json.loads(raw.strip())
    except Exception as e:
        raise ValueError(f"model output was not valid JSON: {e}")
    if not isinstance(data, dict):
        raise ValueError("model output was not a JSON object")
    name = str(data.get("name") or "").strip()
    description = str(data.get("description") or "").strip()
    fragment = str(data.get("style_fragment") or data.get("fragment") or "").strip()
    if not (name and description and fragment):
        raise ValueError("model output missing one of name/description/style_fragment")
    return {"name": name, "description": description, "style_fragment": fragment}


def _build_style_draft_body(fragment: str) -> str:
    """Construct the final draft body from a validated fragment.

    Always ``"{prompt}, <fragment>"``; truncates ``fragment`` to fit
    under ``BODY_MAX`` (leaving room for the literal prefix). Guarantees
    exactly one ``{prompt}`` occurrence.
    """
    from mini_agent.tools.style_sheet_loader import BODY_MAX
    prefix = "{prompt}, "
    room = max(0, BODY_MAX - len(prefix))
    return prefix + fragment[:room].rstrip()


def _resolve_style_draft_image_path(req: "StyleSheetDraftRequest") -> Path:
    """Resolve a workspace image path for VLM analysis.

    Returns the absolute path of an existing regular image file under the
    app workspace. Raises HTTPException(403) on traversal, (404) on
    missing, (400) on unsupported type.
    """
    root = get_app_workspace_dir()
    target = _safe_join(root, req.image_path or "")
    if not target.is_file():
        raise HTTPException(status_code=404, detail=f"Image not found: {req.image_path}")
    ext = target.suffix.lower().lstrip(".")
    if ext not in _STYLE_DRAFT_MIME_EXT:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported image type '{ext}'. Allowed: png, jpg, jpeg, webp, gif.",
        )
    return target


def _decode_style_draft_data_url(data_url: str) -> tuple[Path, bytes]:
    """Decode an inline image data URL to a temp file path + raw bytes.

    Returns ``(tmp_path, raw_bytes)``. Raises HTTPException(400) on
    malformed data URL, unsupported MIME, or decoded size > 10 MiB.
    """
    import base64 as _b64
    import re as _re
    import tempfile as _tf
    m = _re.match(r"^data:image/([a-zA-Z0-9.+-]+);base64,(.*)$", data_url, _re.DOTALL)
    if not m:
        raise HTTPException(
            status_code=400,
            detail="image_data_url must be a base64 data URL (data:image/<ext>;base64,...)",
        )
    mime_ext = m.group(1).lower()
    ext = _STYLE_DRAFT_MIME_EXT.get(mime_ext)
    if ext is None:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported image MIME '{mime_ext}'. Allowed: png, jpeg, webp, gif.",
        )
    try:
        raw = _b64.b64decode(m.group(2))
    except Exception:
        raise HTTPException(status_code=400, detail="image_data_url is not valid base64")
    if len(raw) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="image_data_url exceeds 10 MiB decoded")
    tmp = _tf.NamedTemporaryFile(suffix=f".{ext}", delete=False)
    tmp.write(raw)
    tmp.close()
    return Path(tmp.name), raw


@app.post("/api/style-sheets/draft")
async def draft_style_sheet(req: StyleSheetDraftRequest):
    """Produce an editable ``{name, description, body}`` draft from a
    natural-language brief or an image.

    Read-only: never calls ``write_style_sheet`` and never creates a
    ``STYLE.md``. The caller persists the returned draft through
    ``POST /api/style-sheets``.

    Modes:
      - ``description`` → requires non-empty ``brief`` (<=500 chars).
      - ``image`` → requires exactly one of ``image_path`` (workspace
        relative) or ``image_data_url`` (base64 data URL).
    """
    import os as _os
    import asyncio as _asyncio
    from mini_agent.tools.style_sheet_loader import (
        BODY_MAX, DESCRIPTION_MAX, NAME_MAX,
        kebab_slugify, suggest_unique_name, _validate_description, _validate_name,
    )
    from mini_max_mcp.mcp_tools import MiniMaxMCPClient

    minimax_config = get_minimax_config()
    api_key = minimax_config.get("api_key") or ""
    api_base = minimax_config.get("api_base") or ""
    if not api_key:
        raise HTTPException(status_code=400, detail="API key not configured")

    mode = (req.mode or "").strip().lower()
    if mode == "description":
        brief = (req.brief or "").strip()
        if not brief:
            raise HTTPException(status_code=400, detail="brief is required for description mode")
        if len(brief) > STYLE_DRAFT_BRIEF_MAX:
            raise HTTPException(
                status_code=400,
                detail=f"brief must be <= {STYLE_DRAFT_BRIEF_MAX} chars",
            )
        # Build the LLM call.
        from mini_agent.llm import LLMClient
        from mini_agent.schema.schema import Message
        model = config.get("agent", {}).get("model", "MiniMax-M3")
        llm = LLMClient(api_key=api_key, api_base=api_base, model=model)
        messages = [
            Message(role="system", content=STYLE_DRAFT_LLM_PROMPT),
            Message(role="user", content=f"Brief: {brief}"),
        ]
        try:
            resp = await llm.generate(messages)
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"LLM failed: {e}")
        raw_out = (resp.content or "").strip() if hasattr(resp, "content") else ""
    elif mode == "image":
        if bool(req.image_path) == bool(req.image_data_url):
            raise HTTPException(
                status_code=400,
                detail="image mode requires exactly one of image_path or image_data_url",
            )
        cleanup_path: Path | None = None
        try:
            if req.image_path:
                image_path = _resolve_style_draft_image_path(req)
            else:
                image_path, _raw = _decode_style_draft_data_url(req.image_data_url or "")
                cleanup_path = image_path
            client = MiniMaxMCPClient(api_key, api_base)
            try:
                ok, out = client.understand_image(
                    image_path=str(image_path),
                    prompt=STYLE_DRAFT_VLM_PROMPT,
                )
            finally:
                client.close()
            if not ok:
                raise HTTPException(status_code=502, detail=f"VLM failed: {out}")
            raw_out = (out or "").strip()
        finally:
            if cleanup_path is not None:
                try:
                    _os.unlink(cleanup_path)
                except OSError:
                    pass
    else:
        raise HTTPException(
            status_code=400,
            detail=f"mode must be 'description' or 'image' (got '{mode}')",
        )

    try:
        parsed = _parse_style_draft_payload(raw_out)
    except ValueError as e:
        raise HTTPException(status_code=502, detail=str(e))

    # Normalize name (slugify), then make unique against existing sheets.
    slug = kebab_slugify(parsed["name"])[:NAME_MAX]
    try:
        user_dir = _style_sheets_user_dir()
        final_name = suggest_unique_name(user_dir, slug if slug != "style-1" else parsed["name"])
    except Exception:
        final_name = slug if slug != "style-1" else "style-1"
    # Defensive: re-validate the final name.
    try:
        final_name = _validate_name(final_name)
    except Exception:
        final_name = suggest_unique_name(_style_sheets_user_dir(), "style")

    description = parsed["description"][:DESCRIPTION_MAX]
    try:
        description = _validate_description(description)
    except Exception:
        description = (parsed["description"] or "Style sheet")[:DESCRIPTION_MAX]

    body = _build_style_draft_body(parsed["style_fragment"])
    # Defensive: body must be ≤ BODY_MAX and contain exactly one {prompt}.
    if body.count("{prompt}") != 1 or len(body) > BODY_MAX:
        raise HTTPException(status_code=502, detail="model produced an unusable style fragment")

    return {"success": True, "draft": {"name": final_name, "description": description, "body": body}}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `pytest -q tests/test_style_sheet_draft_api.py tests/test_style_sheets.py`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add web/backend/main.py tests/test_style_sheet_draft_api.py
git commit -m "feat(style-sheets): add POST /api/style-sheets/draft (brief + image)"
```

---

## Task 3: Frontend API client `desktop/src/lib/styleSheets.js`

**Files:**
- Create: `desktop/src/lib/styleSheets.js`
- Test: `desktop/src/lib/styleSheets.test.js`

**Interfaces:**
- Consumes: `apiFetch` from `desktop/src/lib/api.js`
- Produces:
  - `listStyleSheets(): Promise<Array<SerializedSheet>>`
  - `getStyleSheet(name): Promise<SerializedSheet>`
  - `createStyleSheet({name, description, body}): Promise<SerializedSheet>`
  - `updateStyleSheet(name, {description?, body?}): Promise<SerializedSheet>`
  - `deleteStyleSheet(name): Promise<{deleted: string}>`
  - `draftStyleSheetFromBrief(brief): Promise<DraftSheet>`
  - `draftStyleSheetFromImage({imagePath?, imageDataUrl?}): Promise<DraftSheet>`
  - Where `DraftSheet = {name: string, description: string, body: string}`.

- [ ] **Step 1: Write failing tests** — `desktop/src/lib/styleSheets.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockApiFetch = vi.fn()
vi.mock('./api.js', () => ({
  apiFetch: (...args) => mockApiFetch(...args),
}))

import {
  listStyleSheets, getStyleSheet, createStyleSheet, updateStyleSheet,
  deleteStyleSheet, draftStyleSheetFromBrief, draftStyleSheetFromImage,
} from './styleSheets.js'

function jsonResp(payload, ok = true) {
  return { ok, json: async () => payload }
}

beforeEach(() => {
  mockApiFetch.mockReset()
})

describe('styleSheets.js', () => {
  it('listStyleSheets returns the array', async () => {
    mockApiFetch.mockResolvedValueOnce(jsonResp({ success: true, style_sheets: [{ name: 'a' }], count: 1 }))
    const out = await listStyleSheets()
    expect(mockApiFetch).toHaveBeenCalledWith('/api/style-sheets')
    expect(out).toEqual([{ name: 'a' }])
  })

  it('listStyleSheets throws on non-success payload', async () => {
    mockApiFetch.mockResolvedValueOnce(jsonResp({ success: false, error: 'boom' }, false))
    await expect(listStyleSheets()).rejects.toThrow(/boom/)
  })

  it('getStyleSheet encodes the name', async () => {
    mockApiFetch.mockResolvedValueOnce(jsonResp({ success: true, style_sheet: { name: 'a b' } }))
    await getStyleSheet('a/b')
    expect(mockApiFetch).toHaveBeenCalledWith('/api/style-sheets/a%2Fb')
  })

  it('createStyleSheet POSTs name/description/body', async () => {
    mockApiFetch.mockResolvedValueOnce(jsonResp({ success: true, style_sheet: { name: 'x' } }))
    const out = await createStyleSheet({ name: 'x', description: 'd', body: 'b' })
    expect(mockApiFetch).toHaveBeenCalledWith('/api/style-sheets', expect.objectContaining({ method: 'POST' }))
    expect(out).toEqual({ name: 'x' })
  })

  it('updateStyleSheet PUTs only provided fields', async () => {
    mockApiFetch.mockResolvedValueOnce(jsonResp({ success: true, style_sheet: { name: 'x' } }))
    await updateStyleSheet('x', { body: 'b2' })
    const [, opts] = mockApiFetch.mock.calls[0]
    expect(opts.method).toBe('PUT')
    expect(JSON.parse(opts.body)).toEqual({ body: 'b2' })
  })

  it('deleteStyleSheet DELETEs by name', async () => {
    mockApiFetch.mockResolvedValueOnce(jsonResp({ success: true, deleted: 'x' }))
    await deleteStyleSheet('x')
    const [url, opts] = mockApiFetch.mock.calls[0]
    expect(url).toBe('/api/style-sheets/x')
    expect(opts.method).toBe('DELETE')
  })

  it('deleteStyleSheet surfaces FastAPI detail on failure', async () => {
    mockApiFetch.mockResolvedValueOnce(jsonResp({ detail: 'nope' }, false))
    await expect(deleteStyleSheet('x')).rejects.toThrow(/nope/)
  })

  it('draftStyleSheetFromBrief POSTs description mode', async () => {
    mockApiFetch.mockResolvedValueOnce(jsonResp({ success: true, draft: { name: 'n', description: 'd', body: 'b' } }))
    const out = await draftStyleSheetFromBrief('cel anime')
    const [url, opts] = mockApiFetch.mock.calls[0]
    expect(url).toBe('/api/style-sheets/draft')
    expect(JSON.parse(opts.body)).toEqual({ mode: 'description', brief: 'cel anime' })
    expect(out).toEqual({ name: 'n', description: 'd', body: 'b' })
  })

  it('draftStyleSheetFromImage with path', async () => {
    mockApiFetch.mockResolvedValueOnce(jsonResp({ success: true, draft: { name: 'n', description: 'd', body: 'b' } }))
    await draftStyleSheetFromImage({ imagePath: 'generations/images/x.png' })
    expect(JSON.parse(mockApiFetch.mock.calls[0][1].body)).toEqual({
      mode: 'image', image_path: 'generations/images/x.png',
    })
  })

  it('draftStyleSheetFromImage with data URL', async () => {
    mockApiFetch.mockResolvedValueOnce(jsonResp({ success: true, draft: { name: 'n', description: 'd', body: 'b' } }))
    await draftStyleSheetFromImage({ imageDataUrl: 'data:image/png;base64,AAA' })
    expect(JSON.parse(mockApiFetch.mock.calls[0][1].body)).toEqual({
      mode: 'image', image_data_url: 'data:image/png;base64,AAA',
    })
  })

  it('draftStyleSheetFromImage rejects when neither source', async () => {
    await expect(draftStyleSheetFromImage({})).rejects.toThrow(/imagePath or imageDataUrl/)
  })

  it('draftStyleSheetFromImage rejects when both sources', async () => {
    await expect(draftStyleSheetFromImage({
      imagePath: 'x', imageDataUrl: 'y',
    })).rejects.toThrow(/exactly one/)
  })
})
```

- [ ] **Step 2: Run the tests to confirm failure**

Run: `cd desktop && npm test -- styleSheets.test.js`
Expected: FAIL (module does not exist).

- [ ] **Step 3: Implement the client** — `desktop/src/lib/styleSheets.js`:

```javascript
// src/lib/styleSheets.js
//
// Typed-by-convention API client for style sheet CRUD + draft generation.
// Every helper normalizes FastAPI `detail`, app `error`, non-JSON
// responses, and non-2xx status codes into a user-displayable Error.

import { apiFetch } from './api.js'

async function readJson(res) {
  let data = null
  try { data = await res.json() } catch { /* non-JSON body */ }
  if (!res.ok) {
    const msg = (data && (data.detail || data.error)) || `Request failed (${res.status})`
    throw new Error(msg)
  }
  if (data && data.success === false) {
    throw new Error(data.error || data.detail || 'Request failed')
  }
  return data
}

export async function listStyleSheets() {
  const res = await apiFetch('/api/style-sheets')
  const data = await readJson(res)
  return data.style_sheets || []
}

export async function getStyleSheet(name) {
  const res = await apiFetch(`/api/style-sheets/${encodeURIComponent(name)}`)
  const data = await readJson(res)
  return data.style_sheet
}

export async function createStyleSheet({ name, description, body }) {
  const res = await apiFetch('/api/style-sheets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description, body }),
  })
  const data = await readJson(res)
  return data.style_sheet
}

export async function updateStyleSheet(name, { description, body }) {
  const payload = {}
  if (description !== undefined) payload.description = description
  if (body !== undefined) payload.body = body
  const res = await apiFetch(`/api/style-sheets/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await readJson(res)
  return data.style_sheet
}

export async function deleteStyleSheet(name) {
  const res = await apiFetch(`/api/style-sheets/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  })
  const data = await readJson(res)
  return { deleted: data.deleted }
}

export async function draftStyleSheetFromBrief(brief) {
  const res = await apiFetch('/api/style-sheets/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'description', brief }),
  })
  const data = await readJson(res)
  return data.draft
}

export async function draftStyleSheetFromImage({ imagePath, imageDataUrl }) {
  if (bool(imagePath) === bool(imageDataUrl)) {
    if (imagePath && imageDataUrl) {
      throw new Error('Provide exactly one of imagePath or imageDataUrl.')
    }
    throw new Error('draftStyleSheetFromImage requires imagePath or imageDataUrl.')
  }
  const payload = { mode: 'image' }
  if (imagePath) payload.image_path = imagePath
  if (imageDataUrl) payload.image_data_url = imageDataUrl
  const res = await apiFetch('/api/style-sheets/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await readJson(res)
  return data.draft
}

function bool(x) { return !!x }
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `cd desktop && npm test -- styleSheets.test.js`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/lib/styleSheets.js desktop/src/lib/styleSheets.test.js
git commit -m "feat(desktop): add styleSheets.js API client"
```

---

## Task 4: Shared `StyleSheetModal` shell

**Files:**
- Create: `desktop/src/components/style-sheets/StyleSheetModal.jsx`
- Create: `desktop/src/components/style-sheets/index.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: default export `<StyleSheetModal onClose title subtitle maxWidth children />` — a generic overlay matching the existing `ModalShell` in `StyleSheetsTab.jsx` (so the visual is identical).

- [ ] **Step 1: Implement the modal** — `desktop/src/components/style-sheets/StyleSheetModal.jsx`:

```jsx
import { X } from 'lucide-react'

/**
 * Shared overlay shell used by both the Image panel and Settings for the
 * inline style-sheet editor. Mirrors the look of the previous
 * ModalShell in StyleSheetsTab.jsx so the visual stays identical.
 *
 * Props:
 *   onClose   — required close handler (also fires on backdrop click + X)
 *   title     — modal heading
 *   subtitle  — optional mono subtitle (e.g. file path)
 *   maxWidth  — tailwind max-width class (default 'max-w-[900px]')
 *   children  — modal body
 */
export default function StyleSheetModal({
  onClose,
  title,
  subtitle,
  maxWidth = 'max-w-[900px]',
  children,
}) {
  return (
    <div
      className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full ${maxWidth} max-h-[90vh] bg-card border border-border rounded-[14px] shadow-2xl overflow-hidden flex flex-col`}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border shrink-0">
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold truncate">{title}</h2>
            {subtitle && <p className="text-[11px] text-muted-foreground font-mono truncate">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-[6px] hover:bg-surface text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Implement the barrel** — `desktop/src/components/style-sheets/index.js`:

```javascript
export { default as StyleSheetModal } from './StyleSheetModal.jsx'
export { default as StyleSheetEditor } from './StyleSheetEditor.jsx'
```

- [ ] **Step 3: Sanity check the modal renders** — add a smoke test `desktop/src/components/style-sheets/StyleSheetModal.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import StyleSheetModal from './StyleSheetModal.jsx'

describe('StyleSheetModal', () => {
  it('renders title and children', () => {
    render(
      <StyleSheetModal onClose={() => {}} title="Hello">
        <p>body</p>
      </StyleSheetModal>,
    )
    expect(screen.getByText('Hello')).toBeTruthy()
    expect(screen.getByText('body')).toBeTruthy()
  })

  it('fires onClose on backdrop and X button', () => {
    const onClose = vi.fn()
    const { container } = render(
      <StyleSheetModal onClose={onClose} title="t">
        <p>x</p>
      </StyleSheetModal>,
    )
    fireEvent.click(container.firstChild) // backdrop
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByLabelText('Close'))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 4: Run the tests**

Run: `cd desktop && npm test -- StyleSheetModal.test.jsx`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/components/style-sheets/StyleSheetModal.jsx desktop/src/components/style-sheets/StyleSheetModal.test.jsx desktop/src/components/style-sheets/index.js
git commit -m "feat(desktop): add shared StyleSheetModal shell"
```

---

## Task 5: Shared `StyleSheetEditor`

**Files:**
- Create: `desktop/src/components/style-sheets/StyleSheetEditor.jsx`
- Create: `desktop/src/components/style-sheets/StyleSheetEditor.test.jsx`

**Interfaces:**
- Consumes:
  - `desktop/src/lib/styleSheets.js` helpers (Task 3)
  - `desktop/src/lib/api.js#readFileAsDataURL`-equivalent: implement a tiny local helper (no new lib needed)
- Produces: default export

```jsx
<StyleSheetEditor
  mode="create" | "edit"
  sheet?: SerializedSheet        // required for mode="edit"
  source?: "direct" | "image"    // initial start tab (default "direct")
  initialImagePath?: string      // workspace-relative, opens image tab pre-filled
  imagePrompt?: string           // current Image prompt for combined preview
  saveLabel?: string             // "Save and apply" or default "Create style sheet"
  onClose: () => void
  onSaved: (sheet: SerializedSheet) => void
  onError: (message: string) => void
/>
```

The editor owns direct/AI/image start-tab state, form fields, draft lifecycle, and save lifecycle. It reports the saved sheet to `onSaved`.

- [ ] **Step 1: Write failing tests** — `desktop/src/components/style-sheets/StyleSheetEditor.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockApi = {
  listStyleSheets: vi.fn(),
  getStyleSheet: vi.fn(),
  createStyleSheet: vi.fn(),
  updateStyleSheet: vi.fn(),
  deleteStyleSheet: vi.fn(),
  draftStyleSheetFromBrief: vi.fn(),
  draftStyleSheetFromImage: vi.fn(),
}
vi.mock('../../lib/styleSheets.js', () => mockApi)
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k, opts) => {
      if (opts && typeof opts === 'object') {
        let out = k
        for (const [kk, vv] of Object.entries(opts)) out = out.replace(`{{${kk}}}`, String(vv))
        return out
      }
      return k
    },
  }),
}))

import StyleSheetEditor from './StyleSheetEditor.jsx'

beforeEach(() => {
  for (const k of Object.keys(mockApi)) mockApi[k].mockReset()
})

describe('StyleSheetEditor', () => {
  it('direct mode saves via createStyleSheet', async () => {
    mockApi.createStyleSheet.mockResolvedValueOnce({ name: 'wc', description: 'd', body: '{prompt}, water' })
    render(
      <StyleSheetEditor
        mode="create"
        onClose={() => {}}
        onSaved={() => {}}
        onError={() => {}}
      />,
    )
    fireEvent.change(screen.getByPlaceholderText('watercolor-pastel'), { target: { value: 'wc' } })
    fireEvent.change(screen.getByPlaceholderText('styleSheets.descriptionPlaceholder'), { target: { value: 'd' } })
    fireEvent.change(screen.getByPlaceholderText('styleSheets.bodyPlaceholder'), { target: { value: '{placeholder}' } })
    fireEvent.click(screen.getByText('styleSheets.createSheet'))
    await waitFor(() => expect(mockApi.createStyleSheet).toHaveBeenCalled())
    const payload = mockApi.createStyleSheet.mock.calls[0][0]
    expect(payload).toMatchObject({ name: 'wc', description: 'd' })
  })

  it('AI draft fills but does not save', async () => {
    mockApi.draftStyleSheetFromBrief.mockResolvedValueOnce({
      name: 'cel-anime', description: 'Cel', body: '{prompt}, cel anime',
    })
    render(<StyleSheetEditor mode="create" onClose={() => {}} onSaved={() => {}} onError={() => {}} />)
    fireEvent.click(screen.getByText('styleSheets.startMode.ai'))
    fireEvent.change(screen.getByPlaceholderText('styleSheets.briefPlaceholder'), {
      target: { value: 'cel anime' },
    })
    fireEvent.click(screen.getByText('styleSheets.createDraft'))
    await waitFor(() => expect(mockApi.draftStyleSheetFromBrief).toHaveBeenCalledWith('cel anime'))
    // Form fields are now populated from the draft.
    await waitFor(() => expect(screen.getByDisplayValue('cel-anime')).toBeTruthy())
    expect(screen.getByDisplayValue('Cel')).toBeTruthy()
    expect(mockApi.createStyleSheet).not.toHaveBeenCalled()
  })

  it('AI draft failure preserves fields and surfaces error', async () => {
    mockApi.draftStyleSheetFromBrief.mockRejectedValueOnce(new Error('rate limited'))
    const onError = vi.fn()
    render(<StyleSheetEditor mode="create" onClose={() => {}} onSaved={() => {}} onError={onError} />)
    fireEvent.click(screen.getByText('styleSheets.startMode.ai'))
    fireEvent.change(screen.getByPlaceholderText('styleSheets.briefPlaceholder'), {
      target: { value: 'x' },
    })
    fireEvent.click(screen.getByText('styleSheets.createDraft'))
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.stringMatching(/rate limited/)))
    // Brief is still there.
    expect(screen.getByDisplayValue('x')).toBeTruthy()
  })

  it('edit mode loads the sheet then PUTs', async () => {
    mockApi.getStyleSheet.mockResolvedValueOnce({
      name: 'old', description: 'Old', body: '{prompt}, x', raw_markdown: '---\nname: old\ndescription: Old\n---\n{prompt}, x',
    })
    mockApi.updateStyleSheet.mockResolvedValueOnce({ name: 'old', description: 'New', body: '{prompt}, y' })
    render(
      <StyleSheetEditor
        mode="edit"
        sheet={{ name: 'old' }}
        onClose={() => {}}
        onSaved={() => {}}
        onError={() => {}}
      />,
    )
    await waitFor(() => expect(mockApi.getStyleSheet).toHaveBeenCalledWith('old'))
    fireEvent.change(screen.getByPlaceholderText('styleSheets.descriptionPlaceholder'), {
      target: { value: 'New' },
    })
    fireEvent.click(screen.getByText('styleSheets.saveChanges'))
    await waitFor(() => expect(mockApi.updateStyleSheet).toHaveBeenCalled())
    const [name, patch] = mockApi.updateStyleSheet.mock.calls[0]
    expect(name).toBe('old')
    expect(patch).toMatchObject({ description: 'New' })
  })

  it('image tab from initialImagePath calls draftStyleSheetFromImage', async () => {
    mockApi.draftStyleSheetFromImage.mockResolvedValueOnce({
      name: 'impasto', description: 'd', body: '{prompt}, impasto',
    })
    render(
      <StyleSheetEditor
        mode="create"
        source="image"
        initialImagePath="generations/images/x.png"
        onClose={() => {}}
        onSaved={() => {}}
        onError={() => {}}
      />,
    )
    // Image mode is active; click extract.
    fireEvent.click(screen.getByText('styleSheets.extractStyle'))
    await waitFor(() =>
      expect(mockApi.draftStyleSheetFromImage).toHaveBeenCalledWith({ imagePath: 'generations/images/x.png' }),
    )
  })
})
```

- [ ] **Step 2: Run the tests to confirm failure**

Run: `cd desktop && npm test -- StyleSheetEditor.test.jsx`
Expected: FAIL (module does not exist).

- [ ] **Step 3: Implement the editor** — `desktop/src/components/style-sheets/StyleSheetEditor.jsx`:

```jsx
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Save, Sparkles, Upload, X, Wand2, Image as ImageIcon } from 'lucide-react'
import {
  createStyleSheet,
  updateStyleSheet,
  getStyleSheet,
  draftStyleSheetFromBrief,
  draftStyleSheetFromImage,
} from '../../lib/styleSheets.js'

const PROMPT_MAX = 1500
const BODY_MAX = 1000
const PLACEHOLDER = '{prompt}'

function extractBody(raw) {
  if (!raw) return ''
  const m = String(raw).match(/^---\n.*?\n---\n?(.*)$/s)
  return m ? m[1].trim() : String(raw).trim()
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = reject
    r.readAsDataURL(file)
  })
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="text-[10.5px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">{label}</label>
      {children}
      {hint && <p className="text-[10px] text-muted-foreground mt-1">{hint}</p>}
    </div>
  )
}

/**
 * Shared editor used by both the Image panel and Settings.
 *
 * Three start tabs — direct / AI / image — feed the same shared form.
 * Drafts (AI or image) fill fields but never save. Saving goes through
 * createStyleSheet / updateStyleSheet and reports the saved sheet via
 * onSaved. Failures preserve all editor state.
 */
export default function StyleSheetEditor({
  mode = 'create',
  sheet,
  source = 'direct',
  initialImagePath = '',
  imagePrompt = '',
  saveLabel,
  onClose,
  onSaved,
  onError,
}) {
  const { t } = useTranslation()
  const isEdit = mode === 'edit'

  const [startTab, setStartTab] = useState(source === 'image' ? 'image' : 'direct')
  const [brief, setBrief] = useState('')
  const [imagePath, setImagePath] = useState(initialImagePath || '')
  const [uploadedDataUrl, setUploadedDataUrl] = useState('')
  const [uploadedName, setUploadedName] = useState('')

  const [name, setName] = useState(sheet?.name || '')
  const [description, setDescription] = useState(sheet?.description || '')
  const [body, setBody] = useState(extractBody(sheet?.raw_markdown) || '')

  const [drafting, setDrafting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [nameError, setNameError] = useState('')
  const [loadingSheet, setLoadingSheet] = useState(false)

  // Edit mode: lazily fetch the full sheet (with raw_markdown) on mount.
  useEffect(() => {
    if (!isEdit || !sheet?.name) return
    let cancelled = false
    setLoadingSheet(true)
    getStyleSheet(sheet.name)
      .then((s) => {
        if (cancelled) return
        setName(s.name || '')
        setDescription(s.description || '')
        setBody(extractBody(s.raw_markdown) || '')
      })
      .catch((e) => onError?.(e.message || 'Failed to load style sheet'))
      .finally(() => { if (!cancelled) setLoadingSheet(false) })
    return () => { cancelled = true }
  }, [isEdit, sheet?.name])

  const validateName = (raw) => {
    const v = (raw || '').trim()
    if (!v) return t('styleSheets.nameRequired')
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(v)) return t('styleSheets.nameFormat')
    return ''
  }

  const placeholderCount = useMemo(
    () => (body.match(/\{prompt\}/g) || []).length,
    [body],
  )
  const bodyTooLong = body.length > BODY_MAX
  const tooManyPlaceholders = placeholderCount > 1

  const combinedPreview = useMemo(() => {
    const userPrompt = (imagePrompt || '').trim()
    if (body.includes('{prompt}')) return body.replace('{prompt}', userPrompt)
    if (!userPrompt) return body
    if (!body.trim()) return userPrompt
    return `${userPrompt}, ${body}`
  }, [body, imagePrompt])

  const previewMarkdown = useMemo(() => {
    if (!name && !description && !body) return ''
    const fm = ['---']
    if (name) fm.push(`name: ${name}`)
    if (description) fm.push(`description: ${description}`)
    fm.push('---', '')
    return fm.join('\n') + (body || '').trim() + '\n'
  }, [name, description, body])

  const fieldsDirty = !!(name || description || body || brief || imagePath || uploadedDataUrl)

  const runDraft = async (kind) => {
    if (kind === 'ai') {
      if (!brief.trim()) { onError?.(t('styleSheets.briefRequired')); return }
    } else if (kind === 'image') {
      if (!imagePath && !uploadedDataUrl) { onError?.(t('styleSheets.imageRequired')); return }
    } else {
      return
    }
    const overwriteOk =
      !name && !description && !body
        ? true
        : window.confirm(t('styleSheets.confirmOverwriteDraft'))
    if (!overwriteOk) return
    setDrafting(true)
    try {
      const draft = kind === 'ai'
        ? await draftStyleSheetFromBrief(brief.trim())
        : await draftStyleSheetFromImage(
          imagePath ? { imagePath } : { imageDataUrl: uploadedDataUrl },
        )
      setName(draft.name || '')
      setDescription(draft.description || '')
      setBody(draft.body || '')
    } catch (e) {
      onError?.(e.message || 'Draft failed')
    } finally {
      setDrafting(false)
    }
  }

  const handleSave = async () => {
    const err = validateName(name)
    if (err) { setNameError(err); return }
    if (!description.trim()) { onError?.(t('styleSheets.descriptionRequired')); return }
    if (bodyTooLong) { onError?.(t('styleSheets.bodyTooLong', { max: BODY_MAX })); return }
    if (tooManyPlaceholders) { onError?.(t('styleSheets.tooManyPlaceholders', { placeholder: PLACEHOLDER })); return }
    setSaving(true)
    try {
      const saved = isEdit
        ? await updateStyleSheet(sheet.name, { description: description.trim(), body })
        : await createStyleSheet({ name: name.trim(), description: description.trim(), body })
      onSaved?.(saved)
    } catch (e) {
      onError?.(e.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const onPickUpload = async (file) => {
    if (!file) { setUploadedDataUrl(''); setUploadedName(''); return }
    try {
      const url = await readFileAsDataURL(file)
      setUploadedDataUrl(url)
      setUploadedName(file.name)
      setImagePath('') // uploads win over path
    } catch { /* ignore */ }
  }

  if (loadingSheet) {
    return (
      <div className="py-10 text-center text-[12px] text-muted-foreground flex items-center justify-center gap-2">
        <Loader2 size={14} className="animate-spin" /> {t('common.loading') || 'Loading…'}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Start-mode tabs (hidden in edit mode — edits only touch fields). */}
      {!isEdit && (
        <div className="flex items-center gap-1 bg-surface rounded-[10px] p-1 border border-border">
          <StartTab icon={Wand2} active={startTab === 'direct'} onClick={() => setStartTab('direct')}
            label={t('styleSheets.startMode.direct')} />
          <StartTab icon={Sparkles} active={startTab === 'ai'} onClick={() => setStartTab('ai')}
            label={t('styleSheets.startMode.ai')} />
          <StartTab icon={ImageIcon} active={startTab === 'image'} onClick={() => setStartTab('image')}
            label={t('styleSheets.startMode.image')} />
        </div>
      )}

      {/* Per-mode controls. */}
      {!isEdit && startTab === 'ai' && (
        <Field label={t('styleSheets.briefLabel')} hint={t('styleSheets.briefHint')}>
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            rows={3}
            placeholder={t('styleSheets.briefPlaceholder')}
            className="w-full bg-surface border border-border rounded-[8px] px-3 py-2 text-[12.5px] focus:outline-none focus:border-primary resize-none"
          />
          <DraftButton drafting={drafting} onClick={() => runDraft('ai')} label={t('styleSheets.createDraft')} />
        </Field>
      )}

      {!isEdit && startTab === 'image' && (
        <Field label={t('styleSheets.imageLabel')} hint={t('styleSheets.imageHint')}>
          <div className="space-y-2">
            {imagePath && (
              <div className="text-[11.5px] text-muted-foreground flex items-center gap-2">
                <ImageIcon size={12} />
                <code className="font-mono">{imagePath}</code>
                <button
                  className="ml-auto p-1 rounded hover:bg-surface"
                  onClick={() => setImagePath('')}
                  aria-label={t('common.remove') || 'Remove'}
                ><X size={11} /></button>
              </div>
            )}
            {!imagePath && (
              <ImageDropzone
                name={uploadedName}
                onPick={onPickUpload}
                placeholder={t('styleSheets.imageDropzone')}
              />
            )}
          </div>
          <DraftButton drafting={drafting} onClick={() => runDraft('image')} label={t('styleSheets.extractStyle')} />
        </Field>
      )}

      {/* Shared form. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="space-y-3">
          <Field label={t('styleSheets.nameLabel')} hint={isEdit ? t('styleSheets.nameLocked') : t('styleSheets.nameHint')}>
            <input
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); setNameError('') }}
              disabled={isEdit}
              placeholder="watercolor-pastel"
              className="w-full h-[34px] bg-surface border border-border rounded-[8px] px-3 font-mono text-[12.5px] focus:outline-none focus:border-primary disabled:opacity-50"
            />
            {nameError && <p className="text-[10.5px] text-error mt-1">{nameError}</p>}
          </Field>
          <Field label={t('styleSheets.descriptionLabel')} hint={t('styleSheets.descriptionHint')}>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder={t('styleSheets.descriptionPlaceholder')}
              className="w-full bg-surface border border-border rounded-[8px] px-3 py-2 text-[12.5px] focus:outline-none focus:border-primary resize-none"
            />
            <p className="text-[10px] text-muted-foreground mt-0.5">{description.length}/1024</p>
          </Field>
          <Field label={t('styleSheets.bodyLabel')} hint={t('styleSheets.bodyHint', { placeholder: PLACEHOLDER, max: BODY_MAX })}>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              placeholder={t('styleSheets.bodyPlaceholder', { placeholder: PLACEHOLDER })}
              className={`w-full bg-surface border rounded-[8px] px-3 py-2 font-mono text-[12px] focus:outline-none resize-none ${
                bodyTooLong || tooManyPlaceholders ? 'border-error focus:border-error' : 'border-border focus:border-primary'
              }`}
            />
            <div className="flex items-center justify-between mt-0.5 text-[10px]">
              <span className={tooManyPlaceholders ? 'text-error' : 'text-muted-foreground'}>
                {t('styleSheets.placeholderCount', { placeholder: PLACEHOLDER, count: placeholderCount })}
              </span>
              <span className={bodyTooLong ? 'text-error' : 'text-muted-foreground'}>{body.length}/{BODY_MAX}</span>
            </div>
          </Field>
        </div>
        <div className="flex flex-col">
          <div className="text-[11.5px] font-semibold text-muted-foreground mb-1.5">{t('styleSheets.combinedPreview')}</div>
          <pre className="bg-surface border border-border rounded-[8px] px-3 py-2.5 text-[11.5px] whitespace-pre-wrap break-words mb-2">{combinedPreview}</pre>
          <div className="text-[10.5px] text-muted-foreground mb-2">{combinedPreview.length} / {PROMPT_MAX}</div>
          <div className="text-[11.5px] font-semibold text-muted-foreground mb-1.5">{t('styleSheets.livePreview')}</div>
          <pre className="flex-1 min-h-[220px] bg-surface border border-border rounded-[8px] px-3 py-2.5 text-[11.5px] font-mono whitespace-pre-wrap break-words overflow-auto">
{previewMarkdown || t('styleSheets.previewEmpty')}
          </pre>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        <button onClick={onClose} className="h-[34px] px-4 rounded-[8px] border border-border text-[12px] hover:border-primary/50">
          {t('common.cancel') || 'Cancel'}
        </button>
        <button
          onClick={handleSave}
          disabled={saving || bodyTooLong || tooManyPlaceholders}
          className="flex items-center gap-1.5 h-[34px] px-4 rounded-[8px] bg-primary hover:bg-primary-hover disabled:opacity-40 text-white text-[12px] font-medium"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
          {saveLabel || (isEdit ? t('styleSheets.saveChanges') : t('styleSheets.createSheet'))}
        </button>
      </div>
    </div>
  )
}

function StartTab({ icon: Icon, active, onClick, label }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 h-[30px] rounded-[8px] text-[12px] font-medium transition-colors ${
        active ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      <Icon size={12} /> {label}
    </button>
  )
}

function DraftButton({ drafting, onClick, label }) {
  return (
    <button
      onClick={onClick}
      disabled={drafting}
      className="mt-2 flex items-center gap-1.5 h-[30px] px-3 rounded-[8px] bg-primary/10 text-primary border border-primary/20 text-[12px] font-medium hover:bg-primary/20 disabled:opacity-50"
    >
      {drafting ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
      {label}
    </button>
  )
}

function ImageDropzone({ name, onPick, placeholder }) {
  return (
    <label
      className="flex items-center justify-center gap-2 h-[96px] w-full rounded-[10px] border border-dashed border-border bg-surface cursor-pointer text-[11.5px] text-muted-foreground"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        const f = e.dataTransfer?.files?.[0]
        if (f && f.type.startsWith('image/')) onPick(f)
      }}
    >
      <input
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onPick(f)
          e.target.value = ''
        }}
      />
      {name ? (
        <span className="flex items-center gap-2">
          <Upload size={12} /> <code className="font-mono">{name}</code>
        </span>
      ) : (
        <span className="flex items-center gap-2"><Upload size={14} /> {placeholder}</span>
      )}
    </label>
  )
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `cd desktop && npm test -- StyleSheetEditor.test.jsx`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/components/style-sheets/StyleSheetEditor.jsx desktop/src/components/style-sheets/StyleSheetEditor.test.jsx
git commit -m "feat(desktop): add shared StyleSheetEditor with AI + image draft modes"
```

---

## Task 6: Wire `StyleSheetsTab` to the shared editor

**Files:**
- Modify: `desktop/src/components/settings/StyleSheetsTab.jsx`
- Modify: `desktop/src/components/settings/StyleSheetsTab.test.jsx` (if assertions break, update; otherwise leave)

**Interfaces:**
- Consumes: shared `StyleSheetEditor`, `StyleSheetModal`, `styleSheets.js` API client.
- Produces: the existing Settings UI behavior preserved (toolbar, list, view modal, delete). The local `StyleSheetEditorModal` and `ModalShell` are removed; the shared editor is rendered inside a `StyleSheetModal`.

- [ ] **Step 1: Replace the inline editor usage.** In `desktop/src/components/settings/StyleSheetsTab.jsx`:

  - At the top, replace the lucide import line with the same set minus `Save` (still used by other parts if present — leave Save in imports to avoid breaking the existing layout). Add:

```jsx
import { StyleSheetEditor, StyleSheetModal } from '../style-sheets/index.js'
import {
  listStyleSheets, createStyleSheet as apiCreate, updateStyleSheet as apiUpdate,
  deleteStyleSheet as apiDelete, getStyleSheet as apiGet,
} from '../../lib/styleSheets.js'
```

  - In `StyleSheetEditorModal`, delete the entire local editor function (`function StyleSheetEditorModal(...) { ... }`) and keep only a thin wrapper that mounts the shared editor inside a `StyleSheetModal`:

```jsx
function StyleSheetEditorModal({ mode, sheet, onClose, onSaved, onError }) {
  const { t } = useTranslation()
  const isEdit = mode === 'edit'
  return (
    <StyleSheetModal
      onClose={onClose}
      title={isEdit ? t('styleSheets.editTitle', { name: sheet?.name || '' }) : t('styleSheets.createTitle')}
      maxWidth="max-w-[1100px]"
    >
      <StyleSheetEditor
        mode={mode}
        sheet={sheet}
        onClose={onClose}
        onSaved={onSaved}
        onError={onError}
      />
    </StyleSheetModal>
  )
}
```

  - Update the `onSaved` handlers in the parent to keep the existing `fetchAll()` + toast behavior (no change needed beyond the existing closures — they already call `setCreateOpen(false); await fetchAll(); showMessage(...)`).

  - The `fetchAll` and `deleteSheet` callbacks should switch to the new client (drop the raw `apiFetch` calls): replace their bodies with `setSheets(await listStyleSheets())` and `await apiDelete(sheet.name)`. Keep the surrounding `showMessage`/`setError` logic intact.

  - The local `ModalShell` and `Field` helpers are still used by `StyleSheetViewerModal`. Leave them in place; only the editor modal is removed.

- [ ] **Step 2: Confirm existing tests still pass**

Run: `cd desktop && npm test -- StyleSheetsTab.test.jsx`
Expected: all green. If a test relies on an exact button label that moved into the shared editor, update the selector to the equivalent shared-editor label — but do not loosen any assertion.

- [ ] **Step 3: Commit**

```bash
git add desktop/src/components/settings/StyleSheetsTab.jsx desktop/src/components/settings/StyleSheetsTab.test.jsx
git commit -m "refactor(desktop): StyleSheetsTab mounts shared StyleSheetEditor"
```

---

## Task 7: `ImagePanel` inline create + edit + Save-and-Apply

**Files:**
- Modify: `desktop/src/components/media/ImagePanel.jsx`
- Create: `desktop/src/components/media/ImagePanel.style-create.test.jsx`

**Interfaces:**
- Consumes: shared `StyleSheetEditor`, `StyleSheetModal`, `listStyleSheets`, `createStyleSheet`, `updateStyleSheet`, `getStyleSheet`.
- Produces:
  - A `+` button next to the selector opens the editor in create mode.
  - An edit button (shown when a style is selected) opens the editor in edit mode.
  - On save: the returned sheet is merged into the local list, selected immediately, and persisted to `localStorage['image-style-sheet']`.

- [ ] **Step 1: Write the failing test** — `desktop/src/components/media/ImagePanel.style-create.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockApi = {
  listStyleSheets: vi.fn(),
  createStyleSheet: vi.fn(),
  updateStyleSheet: vi.fn(),
  getStyleSheet: vi.fn(),
}
vi.mock('../../lib/styleSheets.js', () => mockApi)
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k, opts) => {
      if (opts && typeof opts === 'object') {
        let out = k
        for (const [kk, vv] of Object.entries(opts)) out = out.replace(`{{${kk}}}`, String(vv))
        return out
      }
      return k
    },
  }),
}))
vi.mock('../../hooks/useSessionProtection', () => ({
  useSessionProtection: () => ({ register: () => {} }),
}))
vi.mock('../shared/MediaPanelLayout', () => ({
  default: ({ controls }) => <div>{controls}</div>,
}))
vi.mock('../shared/ModeTabBar', () => ({ default: () => null }))
vi.mock('../shared/GalleryHeader', () => ({ default: () => null }))
vi.mock('../shared/ShapePreview', () => ({ default: () => null }))
vi.mock('./RecentGenerations', () => ({ default: () => null }))

import ImagePanel from './ImagePanel.jsx'

beforeEach(() => {
  for (const k of Object.keys(mockApi)) mockApi[k].mockReset()
  mockApi.listStyleSheets.mockResolvedValue([])
  window.localStorage.clear()
})

describe('ImagePanel inline style create', () => {
  it('opens the editor on + and merges+saves+selects on save', async () => {
    mockApi.createStyleSheet.mockResolvedValueOnce({
      name: 'wc', description: 'Watercolor', body: '{prompt}, watercolor',
    })
    render(<ImagePanel />)
    await waitFor(() => expect(mockApi.listStyleSheets).toHaveBeenCalled())
    fireEvent.click(screen.getByTitle('styleSheets.create'))
    // Fill the shared editor.
    await waitFor(() => expect(screen.getByPlaceholderText('watercolor-pastel')).toBeTruthy())
    fireEvent.change(screen.getByPlaceholderText('watercolor-pastel'), { target: { value: 'wc' } })
    fireEvent.change(screen.getByPlaceholderText('styleSheets.descriptionPlaceholder'), { target: { value: 'Watercolor' } })
    fireEvent.change(screen.getByPlaceholderText('styleSheets.bodyPlaceholder'), { target: { value: '{placeholder}' } })
    fireEvent.click(screen.getByText('image.saveAndApply'))
    await waitFor(() => expect(mockApi.createStyleSheet).toHaveBeenCalled())
    // The selector now reflects the new sheet.
    await waitFor(() => expect(window.localStorage.getItem('image-style-sheet')).toBe('wc'))
  })
})
```

- [ ] **Step 2: Run the test to confirm failure**

Run: `cd desktop && npm test -- ImagePanel.style-create.test.jsx`
Expected: FAIL (no `+` button labeled `styleSheets.create`, no `image.saveAndApply` label).

- [ ] **Step 3: Add state + handlers + buttons to `ImagePanel`.**

At the top of `desktop/src/components/media/ImagePanel.jsx`:

```jsx
import { StyleSheetEditor, StyleSheetModal } from '../style-sheets/index.js'
import { listStyleSheets, createStyleSheet as apiCreate, updateStyleSheet as apiUpdate, getStyleSheet as apiGet } from '../../lib/styleSheets.js'
import { Plus as PlusIcon, Edit3 as Edit3Icon } from 'lucide-react'
```

Inside `ImagePanel`, replace the existing `useEffect` that fetches the style-sheet list with a `loadStyleSheets` helper using `listStyleSheets()`:

```jsx
const [styleEditorState, setStyleEditorState] = useState(null)
// null = closed; { mode: 'create' } | { mode: 'edit', sheet }

const loadStyleSheets = useCallback(async () => {
  try {
    const sheets = await listStyleSheets()
    setStyleSheets(sheets)
    const current = (typeof localStorage !== 'undefined' && localStorage.getItem('image-style-sheet')) || ''
    if (current && !sheets.find((s) => s.name === current)) {
      if (typeof localStorage !== 'undefined') localStorage.removeItem('image-style-sheet')
      setStyleSheet('')
    }
  } catch (e) {
    setStyleSheetsLoadError(e.message || 'Failed to load style sheets')
  }
}, [])

const [styleSheetsLoadError, setStyleSheetsLoadError] = useState(null)

useEffect(() => { loadStyleSheets() }, [loadStyleSheets])

const handleStyleSaved = useCallback(async (saved) => {
  setStyleEditorState(null)
  await loadStyleSheets()
  setStyleSheet(saved.name)
  if (typeof localStorage !== 'undefined') localStorage.setItem('image-style-sheet', saved.name)
}, [loadStyleSheets])
```

Replace the existing `<select>` row's right-side character chip block so it also renders `+` and edit buttons:

```jsx
<div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 7, gap: 8 }}>
  <label style={{ ...labelStyle, marginBottom: 0 }}>{t('image.styleSheet')}</label>
  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
    {styleSheet && (
      <button
        onClick={() => setStyleEditorState({ mode: 'edit', sheet: { name: styleSheet } })}
        title={t('styleSheets.edit')}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--app-text-2)', display: 'flex' }}
      >
        <Edit3Icon size={12} />
      </button>
    )}
    <button
      onClick={() => setStyleEditorState({ mode: 'create' })}
      title={t('styleSheets.create')}
      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'hsl(var(--primary))', display: 'flex' }}
    >
      <PlusIcon size={14} />
    </button>
    {styleSheet && (
      <span
        style={{
          fontSize: 10.5,
          color: overBudget ? 'hsl(var(--destructive))' : combinedLen > PROMPT_MAX * 0.8 ? 'hsl(var(--primary))' : 'var(--app-text-2)',
          fontVariantNumeric: 'tabular-nums',
        }}
        title={overBudget ? t('image.styleSheetOverBudget') : undefined}
      >
        {combinedLen} / {PROMPT_MAX}
      </span>
    )}
  </div>
</div>
```

Render the editor modal at the end of the returned tree (sibling of `MediaPanelLayout`):

```jsx
{styleEditorState && (
  <StyleSheetModal
    onClose={() => setStyleEditorState(null)}
    title={styleEditorState.mode === 'edit'
      ? t('styleSheets.editTitle', { name: styleEditorState.sheet?.name || '' })
      : t('image.createStyleSheetTitle')}
    maxWidth="max-w-[1100px]"
  >
    <StyleSheetEditor
      mode={styleEditorState.mode}
      sheet={styleEditorState.sheet}
      imagePrompt={prompt}
      saveLabel={t('image.saveAndApply')}
      onClose={() => setStyleEditorState(null)}
      onSaved={handleStyleSaved}
      onError={(msg) => setError(msg)}
    />
  </StyleSheetModal>
)}
```

- [ ] **Step 4: Run the tests**

Run: `cd desktop && npm test -- ImagePanel.style-create.test.jsx`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/components/media/ImagePanel.jsx desktop/src/components/media/ImagePanel.style-create.test.jsx
git commit -m "feat(image): inline style sheet create/edit with Save-and-Apply"
```

---

## Task 8: `RecentGenerations` — "Save as style" callback

**Files:**
- Modify: `desktop/src/components/media/RecentGenerations.jsx`
- Modify: `desktop/src/components/media/ImagePanel.jsx` (wire the callback)

**Interfaces:**
- Consumes: optional `onSaveAsStyle(item)` prop.
- Produces: a "Save as style" button on image cards when the prop is present. The component knows nothing about the style-sheet API.

- [ ] **Step 1: Add the prop and button.** In `desktop/src/components/media/RecentGenerations.jsx`:

  - Destructure `onSaveAsStyle` from props.
  - Import `Sparkles` (or reuse `Save`) from `lucide-react`.
  - Inside the hover overlay for image cards (next to the existing `onPromoteToAnchor` button), add:

```jsx
{onSaveAsStyle && (
  <button
    onClick={() => onSaveAsStyle(item)}
    className="p-1.5 bg-primary hover:bg-primary-hover rounded-lg transition-colors"
    title="Save as style"
  >
    <Sparkles size={12} className="text-white" />
  </button>
)}
```

- [ ] **Step 2: Wire in ImagePanel.** In `desktop/src/components/media/ImagePanel.jsx`, update the `<RecentGenerations>` usage in the `canvas` block:

```jsx
<RecentGenerations
  type="image"
  items={gallery}
  loading={galleryLoading}
  onRefresh={fetchGallery}
  emptyMessage={t('image.noGenerated')}
  onPromoteToAnchor={(item) => { /* unchanged anchor code */ }}
  onSaveAsStyle={(item) => setStyleEditorState({
    mode: 'create',
    source: 'image',
    initialImagePath: item.path,
  })}
/>
```

Update `styleEditorState` so create-with-source carries `source` and `initialImagePath`:

```jsx
{styleEditorState && (
  <StyleSheetModal ...>
    <StyleSheetEditor
      mode={styleEditorState.mode}
      sheet={styleEditorState.sheet}
      source={styleEditorState.source || 'direct'}
      initialImagePath={styleEditorState.initialImagePath || ''}
      imagePrompt={prompt}
      saveLabel={t('image.saveAndApply')}
      onClose={() => setStyleEditorState(null)}
      onSaved={handleStyleSaved}
      onError={(msg) => setError(msg)}
    />
  </StyleSheetModal>
)}
```

- [ ] **Step 3: Commit**

```bash
git add desktop/src/components/media/RecentGenerations.jsx desktop/src/components/media/ImagePanel.jsx
git commit -m "feat(image): Save-as-style action on generated image cards"
```

---

## Task 9: i18n keys (6 languages)

**Files:**
- Modify: `desktop/src/i18n/en.json`, `ko.json`, `ja.json`, `zh-CN.json`, `es.json`, `pt-BR.json`

**Interfaces:** none.

- [ ] **Step 1: Add the English keys.** In `en.json` under `image.*`:

```json
"createStyleSheetTitle": "Create style sheet",
"saveAndApply": "Save and apply",
```

Under `styleSheets.*` (add alongside existing keys):

```json
"startMode": {
  "direct": "Write",
  "ai": "AI draft",
  "image": "Extract from image"
},
"briefLabel": "Describe the style",
"briefHint": "One or two sentences — medium, palette, mood.",
"briefPlaceholder": "1990s Japanese animation, cel shading, warm sunset light",
"briefRequired": "Describe a style first.",
"createDraft": "Create draft",
"imageLabel": "Source image",
"imageHint": "We extract only the visual style — no subject or scene.",
"imageDropzone": "Drop an image or click to upload",
"imageRequired": "Pick or drop an image first.",
"extractStyle": "Extract style",
"confirmOverwriteDraft": "Replace the current draft with a new one?",
"combinedPreview": "Combined prompt preview",
"descriptionRequired": "Description is required.",
"nameRequired": "Name is required.",
"nameFormat": "Lowercase letters, digits, or hyphens only (1–64 chars, leading alphanumeric).",
"bodyTooLong": "Body must be at most {{max}} chars.",
"tooManyPlaceholders": "Body may contain {{placeholder}} at most once.",
"placeholderCount": "{{placeholder}} ×{{count}}",
"saveChanges": "Save changes",
"createSheet": "Create style sheet",
"livePreview": "STYLE.md preview",
"previewEmpty": "Fill in the fields to see the preview."
```

- [ ] **Step 2: Mirror the keys into the other five language files.** Provide localized strings where straightforward (Korean, Japanese, Chinese, Spanish, Portuguese). For any string you don't localize, copy the English value verbatim so the key always resolves (existing fallback pattern).

- [ ] **Step 3: Run frontend tests + build**

Run: `cd desktop && npm test && npm run build`
Expected: tests green; build succeeds.

- [ ] **Step 4: Commit**

```bash
git add desktop/src/i18n
git commit -m "i18n: inline style sheet creation keys"
```

---

## Task 10: End-to-end smoke check

**Files:** none (manual verification).

- [ ] **Step 1: Start the dev server**

```bash
cd desktop && npm run tauri:dev
```

- [ ] **Step 2: Direct authoring**

Open the Image panel → click `+` → Write tab → enter name `test-direct`, description `Direct test`, body `{prompt}, soft pastel` → **Save and apply**.

Expected: modal closes, selector shows `test-direct`, localStorage updated, next generate request includes `style_sheet: "test-direct"`.

- [ ] **Step 3: AI draft**

Click `+` → AI draft tab → brief `cyberpunk neon rain` → **Create draft**.

Expected: name/description/body populate; preview shows `{prompt}, <fragment>`; clicking **Save and apply** persists.

- [ ] **Step 4: Image extraction (upload)**

Click `+` → Extract from image tab → drop a PNG → **Extract style**.

Expected: draft fills from VLM; subject/scene are absent; saving works.

- [ ] **Step 5: Image extraction (generated card)**

Generate an image → hover a result card → click the **Save as style** (sparkles) button.

Expected: editor opens on the image tab with the path pre-filled; extract + save works.

- [ ] **Step 6: Edit existing**

With a style selected, click the edit (pencil) button.

Expected: editor opens in edit mode, name locked, body/description editable; saving PUTs and the selector still points at the same name.

- [ ] **Step 7: Failure recovery**

Kill the backend, trigger a draft, then restart the backend.

Expected: draft failure shows an error without clearing the brief; saving after restart works.

---

## Self-Review Notes

- **Spec coverage:**
  - Selector row + `+` + edit buttons → Task 7.
  - Shared editor with direct/AI/image tabs → Task 5.
  - Generated-image card "Save as style" → Task 8.
  - `POST /api/style-sheets/draft` (brief + image path + image data URL) → Task 2.
  - Draft invariants (name, description, body, single `{prompt}`) → Task 2 server-side + Task 5 client-side.
  - Workspace path resolution via `_safe_join` → Task 2.
  - Inline image MIME/size cap + temp-file cleanup → Task 2.
  - Read-only draft guarantee → Task 2 (`test_draft_does_not_persist`) + Task 5 (no auto-save).
  - Locale-agnostic validation → Task 2 (validation is schema-only; `STYLE_DRAFT_LLM_PROMPT` requests concise reusable text).
  - Error semantics table → Task 2 backend status codes + Task 5 preserved editor state.
  - Existing CRUD/loader/`/api/image` unchanged → Tasks 1 and 2 only *add* helpers and routes.
  - Six-language i18n → Task 9.

- **Type consistency:** `DraftSheet = {name, description, body}` matches between `styleSheets.js` (client) and the backend response; `SerializedSheet` shape matches the existing `_serialize_style_sheet` output used by CRUD. `imagePath`/`imageDataUrl` prop names match `draftStyleSheetFromImage`'s accepted fields. `styleEditorState` shape (`mode`, `sheet`, `source`, `initialImagePath`) is identical between the create-from-selector and create-from-image-card entry points.

- **No placeholders:** every step contains the exact code or command an implementer needs.
