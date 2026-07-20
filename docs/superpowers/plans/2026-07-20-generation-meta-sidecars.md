# Generation Metadata Sidecars — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist a per-file `.meta.json` sidecar next to every generated image / video / music / tts file, recording the prompt + reproduction params, and surface it in RecentGenerations via a read-only modal.

**Architecture:** Per-file sidecar JSON co-located with each media file under `workspace/generations/{images,videos,music,tts}/`. Same-handler writes for image / music / single-shot TTS. Decoupled (two-endpoint) writes for video — frontend passes `meta` in the download payload. New `GenerationMetaModal` component + info button on every `RecentGenerations` card.

**Tech Stack:** Python 3.10+ / FastAPI / Pydantic v2 / pytest · React 18 / Vite / Tailwind / react-i18next / lucide-react · 6-locale i18n

**Spec:** `docs/superpowers/specs/2026-07-20-generation-meta-sidecars-design.md`

## Global Constraints

- Python ≥ 3.10, PEP 8, `snake_case`, Pydantic v2, `ToolResult(success=False, error=...)` style returns (never raise from tools).
- Frontend: React 18, function components + hooks, Tailwind classes (no CSS modules), shadcn-style via `class-variance-authority`. Markdown wrappers put `className` on the outer `<div>`, not `<ReactMarkdown>` (v9 dropped that prop).
- i18n: 6 locale files at `desktop/src/i18n/{en,ko,es,ja,zh-CN,pt-BR}.json`. Add keys to all 6 (empty string `""` is the accepted fallback for non-English locales per existing policy).
- Backend `_logger = logging.getLogger(__name__)` already imported in `web/backend/main.py` — reuse it.
- All file paths workspace-relative in API responses (same convention as `/api/generations`).
- API key never returned in any response (existing invariant).
- Test pattern: `tests/test_*.py` using `from fastapi.testclient import TestClient`. Existing reference: `tests/test_image_recent_delete.py`. The fixture pattern there sets `MINIMAX_PROJECT_ROOT` env var before importing `main`, then `TestClient(_main.app)`.

---

## File Structure

**Backend (`web/backend/main.py` — single module per existing convention):**
- Add 3 module-level helpers near `_media_output_dir` (~line 538): `_media_meta_sidecar_path`, `_write_media_meta`, `_read_media_meta`.
- 5 Case 1 handlers get a sidecar write call in their success branch: `image_generate` (4116), `image_i2i_generate` (4224), `tts_generate` (4039), `speech_synthesize` (4669), `music_generate` (5138).
- 1 Case 2 handler gets a sidecar write from request body: `video_download` (5424).
- `list_generations` (5891) gets meta-merge + sidecar-skip.
- `delete_generated_image` (5919) gets sidecar cleanup.

**New backend test:** `tests/test_generation_meta.py`.

**Frontend:**
- `desktop/src/components/media/GenerationMetaModal.jsx` — new (read-only modal).
- `desktop/src/components/media/GenerationMetaModal.test.jsx` — new (Vitest).
- `desktop/src/components/media/RecentGenerations.jsx` — modify: add `onShowMeta` prop + Info button on all 3 type branches.
- `desktop/src/components/media/ImagePanel.jsx`, `MusicPanel.jsx`, `SpeechPanel.jsx`, `VideoPanel.jsx` — modify: own modal state, pass `onShowMeta`.
- `desktop/src/components/media/VideoPanel.jsx` — modify: send `meta` in `/api/video/download` payload (line ~620).
- `desktop/src/components/media/ImagePanel.jsx` — modify: send `subject_reference_anchors` alongside `subject_reference` in `/api/image` body.
- `desktop/src/i18n/{en,ko,es,ja,zh-CN,pt-BR}.json` — 13 new keys.

**Existing patterns to follow:**
- Sidecar atomic write: same pattern as `_save_anchors_manifest` in `main.py:~5396` (tmp + `replace`).
- Modal shell: pattern from `desktop/src/components/media/AnchorEditor.jsx` (overlay + panel + close button).
- Test fixture: `tests/test_image_recent_delete.py` (TMP_ROOT + env var + TestClient).

---

### Task 1: Backend sidecar helpers + unit tests

**Files:**
- Modify: `web/backend/main.py` (insert 3 helpers after `_media_output_dir`, around line 555)
- Test: `tests/test_generation_meta.py` (new file)

**Interfaces:**
- Produces: `_media_meta_sidecar_path(media_path: Path) -> Path`, `_write_media_meta(media_path: Path, meta: dict) -> None`, `_read_media_meta(media_path: Path) -> dict | None`. All later backend tasks consume these.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_generation_meta.py`:

```python
"""Tests for the generation-metadata sidecar helpers + endpoints.

Covers:
  - _media_meta_sidecar_path / _write_media_meta / _read_media_meta
  - GET /api/generations meta merge (Task 4)
  - DELETE /api/generations/image sidecar cleanup (Task 4)
  - /api/video/download meta payload handling (Task 3)
  - /api/image sidecar write (Task 2)
"""
import json
import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

TMP_ROOT = Path(__file__).resolve().parent.parent / "workspace_test_meta"
TMP_ROOT.mkdir(exist_ok=True)
os.environ["MINIMAX_PROJECT_ROOT"] = str(TMP_ROOT)

import web.backend.main as _main  # noqa: E402

client = TestClient(_main.app)


def _workspace() -> Path:
    return _main.get_app_workspace_dir()


# ── Helpers ──────────────────────────────────────────────────────────────

def test_sidecar_path_swaps_extension():
    p = Path("workspace/generations/images/image_web_123.png")
    assert _main._media_meta_sidecar_path(p).name == "image_web_123.meta.json"


def test_write_media_meta_creates_sibling_json():
    img = _workspace() / "generations" / "images" / "unit_test.png"
    img.parent.mkdir(parents=True, exist_ok=True)
    img.write_bytes(b"\x89PNG")
    try:
        _main._write_media_meta(img, {"version": 1, "media_type": "image", "prompt": "hello"})
        sc = img.with_suffix(".meta.json")
        assert sc.exists()
        data = json.loads(sc.read_text(encoding="utf-8"))
        assert data == {"version": 1, "media_type": "image", "prompt": "hello"}
    finally:
        for p in (img.with_suffix(".meta.json"), img):
            if p.exists():
                p.unlink()


def test_read_media_meta_returns_none_when_missing():
    img = _workspace() / "generations" / "images" / "does_not_exist.png"
    assert _main._read_media_meta(img) is None


def test_read_media_meta_returns_none_on_corrupt_json():
    img = _workspace() / "generations" / "images" / "corrupt.png"
    img.parent.mkdir(parents=True, exist_ok=True)
    img.write_bytes(b"\x89PNG")
    img.with_suffix(".meta.json").write_text("{not valid json", encoding="utf-8")
    try:
        assert _main._read_media_meta(img) is None
    finally:
        for p in (img.with_suffix(".meta.json"), img):
            if p.exists():
                p.unlink()


def test_write_media_meta_does_not_raise_on_failure(tmp_path, monkeypatch):
    """Best-effort: sidecar write failure must not propagate."""
    img = tmp_path / "x.png"
    img.write_bytes(b"\x89PNG")

    def boom(*a, **kw):
        raise OSError("disk full")

    monkeypatch.setattr(Path, "write_text", boom)
    # Must not raise.
    _main._write_media_meta(img, {"version": 1})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_generation_meta.py -v -k "sidecar_path or write_media_meta or read_media_meta"`
Expected: FAIL with `AttributeError: module 'web.backend.main' has no attribute '_media_meta_sidecar_path'`.

- [ ] **Step 3: Add the helpers**

In `web/backend/main.py`, immediately after the `_media_output_dir` function (currently ending around line 554), insert:

```python
# --- Generation metadata sidecars ---------------------------------------
#
# Each generated media file gets a sibling ``<basename>.meta.json``
# recording the prompt + reproduction params. Sidecar lifecycle is 1:1
# with the media file: DELETE removes both, out-of-band file deletion
# leaves an invisible orphan (GET scans media files, not sidecars).

def _media_meta_sidecar_path(media_path: Path) -> Path:
    """image.png -> image.meta.json (same dir, same basename)."""
    return media_path.with_suffix(".meta.json")


def _write_media_meta(media_path: Path, meta: dict) -> None:
    """Atomic write (tmp + rename). Best-effort: failures are logged
    but never mask the successful media write."""
    sc = _media_meta_sidecar_path(media_path)
    sc.parent.mkdir(parents=True, exist_ok=True)
    tmp = sc.with_suffix(".json.tmp")
    try:
        tmp.write_text(
            json.dumps(meta, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        tmp.replace(sc)
    except Exception:
        try:
            if tmp.exists():
                tmp.unlink()
        except Exception:
            pass
        _logger.warning("sidecar write failed for %s", media_path)


def _read_media_meta(media_path: Path) -> dict | None:
    """Return the parsed sidecar JSON, or None if missing / corrupt."""
    sc = _media_meta_sidecar_path(media_path)
    if not sc.exists():
        return None
    try:
        return json.loads(sc.read_text(encoding="utf-8"))
    except Exception:
        return None
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_generation_meta.py -v -k "sidecar_path or write_media_meta or read_media_meta"`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add web/backend/main.py tests/test_generation_meta.py
git commit -m "feat(generation-meta): add sidecar helpers + unit tests

_media_meta_sidecar_path / _write_media_meta / _read_media_meta
in web/backend/main.py. Atomic write (tmp+rename), best-effort
failure handling, None-on-corrupt read."
```

---

### Task 2: Case 1 sidecar writes — image, i2i, music, speech-synthesize, legacy tts

**Files:**
- Modify: `web/backend/main.py` (`image_generate` ~4116, `image_i2i_generate` ~4224, `music_generate` ~5138, `speech_synthesize` ~4669, `tts_generate` ~4039)
- Test: `tests/test_generation_meta.py` (append)

**Interfaces:**
- Consumes: Task 1 helpers (`_write_media_meta`).
- Produces: each Case 1 handler now writes `<basename>.meta.json` alongside the media file. Task 4 reads them via `_read_media_meta`.

- [ ] **Step 1: Add failing test for /api/image sidecar write**

Append to `tests/test_generation_meta.py`:

```python
def test_image_endpoint_writes_sidecar(monkeypatch):
    """POST /api/image must write a sidecar with prompt + params.
    Mocks the MiniMax call so no network/API key is needed."""
    # Mock image_sync to just write the output file and return success.
    def fake_image_sync(api_key, api_base, prompt, output_path, **kw):
        Path(output_path).write_bytes(b"\x89PNG\r\n\x1a\n")
        return True, output_path

    monkeypatch.setattr(_main, "get_minimax_config",
                        lambda: {"api_key": "sk-test", "api_base": "x"})
    # The handler imports image_sync lazily inside the function:
    import sys
    import mini_max_mcp.client as mc
    monkeypatch.setattr(mc, "image_sync", fake_image_sync)

    res = client.post("/api/image", json={
        "prompt": "a red apple",
        "aspect_ratio": "1:1",
        "n": 1,
        "seed": 42,
    })
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["success"] is True
    # Locate the written file + sidecar.
    rel = body["file_path"]
    img = _workspace() / rel
    sc = _main._media_meta_sidecar_path(img)
    assert img.exists(), "media file must exist"
    assert sc.exists(), "sidecar must exist"
    data = json.loads(sc.read_text(encoding="utf-8"))
    assert data["version"] == 1
    assert data["media_type"] == "image"
    assert data["prompt"] == "a red apple"
    assert data["user_prompt"] == "a red apple"
    assert data["model"] == "image-01"
    assert data["params"]["aspect_ratio"] == "1:1"
    assert data["params"]["seed"] == 42
    assert data["params"]["mode"] == "t2i"
    assert "created_at" in data
    # cleanup
    img.unlink()
    sc.unlink()
```

- [ ] **Step 2: Run to verify it fails**

Run: `pytest tests/test_generation_meta.py::test_image_endpoint_writes_sidecar -v`
Expected: FAIL — sidecar file doesn't exist (`AssertionError`).

- [ ] **Step 3: Wire sidecar write into `/api/image`**

In `image_generate` (~4116), in the `if success:` branch, just before the `return {"success": True, ...}` block, add:

```python
        if success:
            # Return path relative to the session's workspace root ...
            out_root = _resolve_session_root(session_id or None)
            rel_path = str(Path(result).relative_to(out_root)).replace('\\', '/')

            # NEW: write the prompt+params sidecar next to the media file.
            _write_media_meta(Path(result), {
                "version": 1,
                "media_type": "image",
                "created_at": datetime.utcnow().isoformat() + "Z",
                "prompt": final_prompt,
                "user_prompt": req.prompt,
                "model": model,
                "params": {
                    "aspect_ratio": req.aspect_ratio,
                    "width": req.width,
                    "height": req.height,
                    "n": n,
                    "seed": req.seed,
                    "prompt_optimizer": req.prompt_optimizer,
                    "watermark": req.watermark,
                    "style_sheet": style_sheet_used,
                    "mode": "i2i-live" if subject_reference else "t2i",
                },
                "references": {
                    "subject_reference": list(req.subject_reference_anchors or []),
                },
            })

            cost = calculate_image_cost(n)
            return { ... existing return ... }
```

`subject_reference_anchors` is a new optional request field — add it to the `ImageRequest` Pydantic model near `subject_reference`:

```python
class ImageRequest(BaseModel):
    # ... existing fields ...
    subject_reference: list = None
    subject_reference_anchors: list = None  # NEW — parallel anchor IDs
    reference_image: str = ""
    # ...
```

- [ ] **Step 4: Run image test to verify pass**

Run: `pytest tests/test_generation_meta.py::test_image_endpoint_writes_sidecar -v`
Expected: PASS.

- [ ] **Step 5: Wire sidecar write into `/api/image/i2i`**

In `image_i2i_generate` (~4224) `if success:` branch, before the `return`:

```python
        if success:
            _write_media_meta(Path(result), {
                "version": 1,
                "media_type": "image",
                "created_at": datetime.utcnow().isoformat() + "Z",
                "prompt": req.prompt,
                "user_prompt": req.prompt,
                "model": "image-01",  # i2i variations use the default model
                "params": {
                    "aspect_ratio": req.aspect_ratio,
                    "width": req.width,
                    "height": req.height,
                    "n": n,
                    "seed": req.seed,
                    "prompt_optimizer": req.prompt_optimizer,
                    "watermark": req.watermark,
                    "mode": "i2i-variation",
                },
                "references": {
                    "reference_image": req.reference_image or None,
                },
            })
            rel_path = str(Path(result).relative_to(_resolve_session_root(session_id or None))).replace('\\', '/')
            # ... existing return ...
```

- [ ] **Step 6: Wire sidecar write into `/api/music`**

Locate `music_generate` (~5138). Inside the success branch (after `output_path` is written), call:

```python
            _write_media_meta(Path(output_path), {
                "version": 1,
                "media_type": "music",
                "created_at": datetime.utcnow().isoformat() + "Z",
                "prompt": req.prompt,
                "user_prompt": req.prompt,
                "model": req.model,
                "params": {
                    "audio_setting": audio_setting,
                    "mode": "instrumental" if req.is_instrumental else "lyrics",
                },
                "references": {
                    "cover_audio": req.audio_url or None,
                },
            })
```

(Read the handler body first to confirm the exact local variable names for `output_path`, `audio_setting`, `req.is_instrumental`, `req.audio_url` — they exist in the function. Use `req.audio_url` only when the cover flow is in use; for plain text-to-music it's empty and the value becomes `null`, which is correct.)

- [ ] **Step 7: Wire sidecar write into `/api/minimax/speech/synthesize`**

In `speech_synthesize` (~4669) success branch, after `_save_audio_hex` returns `rel_path`, the absolute path is `_resolve_session_root(session_id or None) / rel_path`. Add:

```python
        rel_path = _save_audio_hex(hex_audio, audio_setting, req.filename, session_id=session_id)
        abs_path = _resolve_session_root(session_id or None) / rel_path
        _write_media_meta(abs_path, {
            "version": 1,
            "media_type": "tts",
            "created_at": datetime.utcnow().isoformat() + "Z",
            "prompt": req.text,
            "user_prompt": req.text,
            "model": req.model,
            "params": {
                "voice_id": req.voice_id,
                "speed": req.speed,
                "vol": req.vol,
                "pitch": req.pitch,
                "audio_setting": audio_setting,
                "format": audio_setting.get("format", "mp3"),
            },
            "references": {},
        })
        return { ... existing return ... }
```

- [ ] **Step 8: Wire sidecar write into legacy `/api/tts`**

In `tts_generate` (~4039) success branch, mirror the speech_synthesize block. The legacy endpoint stores its output under `_media_output_dir(session_id, "tts")` and uses `req.prompt` as the text input and `req.settings` for voice/model. Inspect the handler body for exact names and add a sidecar write with `media_type: "tts"`, `prompt: req.prompt`, `model: req.settings.get("model", "speech-2.8-turbo")`, etc.

- [ ] **Step 9: Run full test module**

Run: `pytest tests/test_generation_meta.py -v`
Expected: 6 PASS (5 helper tests + 1 image endpoint test).

- [ ] **Step 10: Manual smoke (optional but cheap)**

Start the backend (`uvicorn web.backend.main:app --reload`) and POST to `/api/image` with a real API key. Confirm the sidecar appears next to the new image. Skip if no API key available.

- [ ] **Step 11: Commit**

```bash
git add web/backend/main.py tests/test_generation_meta.py
git commit -m "feat(generation-meta): write sidecars in Case 1 handlers

image (t2i + i2i-live), i2i-variation, music, speech-synthesize,
legacy tts — all write <basename>.meta.json alongside the media file
on success. Adds ImageRequest.subject_reference_anchors field for
anchor ID propagation."
```

---

### Task 3: Video sidecar via `/api/video/download` + VideoPanel payload

**Files:**
- Modify: `web/backend/main.py` (`video_download` ~5424)
- Modify: `desktop/src/components/media/VideoPanel.jsx` (download `fetch` call, ~line 620)
- Test: `tests/test_generation_meta.py` (append)

**Interfaces:**
- Consumes: Task 1 helpers. Frontend VideoPanel already holds `prompt`, `videoModel`, `resolution`, `duration`, `promptOptimizer`, `firstFrame`, `lastFrame`, `attachedAnchors` in component state.
- Produces: `POST /api/video/download` accepts an optional `meta` field in the request body; when present, writes the sidecar after the video file. Backwards-compatible (omitting `meta` writes no sidecar).

- [ ] **Step 1: Add failing test**

Append to `tests/test_generation_meta.py`:

```python
def test_video_download_writes_sidecar_when_meta_provided(monkeypatch):
    """POST /api/video/download with {file_id, meta} writes both the
    video file and a sidecar with the provided meta (plus server-set
    created_at)."""
    def fake_download(self, file_id, target):
        Path(target).write_bytes(b"\x00\x00\x00\x20 ftypisom")
        return True, target

    import mini_max_mcp.client as mc
    monkeypatch.setattr(mc.MiniMaxSyncClient, "video_download", fake_download)
    monkeypatch.setattr(_main, "get_minimax_config",
                        lambda: {"api_key": "sk-test", "api_base": "x"})

    res = client.post("/api/video/download", json={
        "file_id": "fake-file-id",
        "meta": {
            "media_type": "video",
            "prompt": "a cat playing piano",
            "user_prompt": "a cat playing piano",
            "model": "MiniMax-Hailuo-2.3",
            "params": {
                "duration": 6,
                "resolution": "768P",
                "prompt_optimizer": False,
                "mode": "text2video",
            },
            "references": {
                "first_frame_image": None,
                "last_frame_image": None,
                "subject_reference": [],
            },
        },
    })
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["success"] is True
    vid = _workspace() / body["path"]
    sc = _main._media_meta_sidecar_path(vid)
    assert vid.exists()
    assert sc.exists()
    data = json.loads(sc.read_text(encoding="utf-8"))
    assert data["media_type"] == "video"
    assert data["prompt"] == "a cat playing piano"
    assert data["params"]["mode"] == "text2video"
    assert "created_at" in data, "server must inject created_at"
    vid.unlink()
    sc.unlink()


def test_video_download_without_meta_writes_no_sidecar(monkeypatch):
    """Old client (no meta field) must still work — no sidecar."""
    def fake_download(self, file_id, target):
        Path(target).write_bytes(b"\x00\x00\x00\x20 ftypisom")
        return True, target

    import mini_max_mcp.client as mc
    monkeypatch.setattr(mc.MiniMaxSyncClient, "video_download", fake_download)
    monkeypatch.setattr(_main, "get_minimax_config",
                        lambda: {"api_key": "sk-test", "api_base": "x"})

    res = client.post("/api/video/download", json={"file_id": "fake"})
    assert res.status_code == 200
    body = res.json()
    vid = _workspace() / body["path"]
    sc = _main._media_meta_sidecar_path(vid)
    assert vid.exists()
    assert not sc.exists()
    vid.unlink()
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/test_generation_meta.py -k video_download -v`
Expected: FAIL on first test (no sidecar), second may already pass.

- [ ] **Step 3: Update `/api/video/download` to honor `meta`**

In `video_download` (~5424), after `target` is written and `rel` is computed, before `return {"success": True, "path": rel}`:

```python
        if success:
            rel = str(target.relative_to(get_app_workspace_dir())).replace("\\", "/")
            meta = req.get("meta")
            if isinstance(meta, dict):
                meta.setdefault("version", 1)
                meta.setdefault("created_at", datetime.utcnow().isoformat() + "Z")
                _write_media_meta(target, meta)
            return {"success": True, "path": rel}
        else:
            return {"success": False, "error": result}
```

(`datetime` is already imported at module level — verify if a fresh `from datetime import datetime` is needed.)

- [ ] **Step 4: Run backend tests to verify pass**

Run: `pytest tests/test_generation_meta.py -k video_download -v`
Expected: 2 PASS.

- [ ] **Step 5: Update VideoPanel.jsx download payload**

Open `desktop/src/components/media/VideoPanel.jsx`. Locate the download `fetch` call (around line 620, inside the polling `useEffect`). Currently:

```js
const dlRes = await apiFetch('/api/video/download', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ file_id: fileId }),
})
```

Change to include `meta`. Use the same param names the surrounding `generate()` function already uses — read state values directly:

```js
const dlRes = await apiFetch('/api/video/download', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    file_id: fileId,
    meta: {
      media_type: 'video',
      prompt,
      user_prompt: prompt,
      model: videoModel,
      params: {
        duration,
        resolution,
        prompt_optimizer: promptOptimizer,
        mode: deriveVideoMode({ firstFrame: manualFirstFrame, lastFrame: manualLastFrame, subject_reference: subjectData }),
      },
      references: {
        first_frame_image: manualFirstFrameAnchorId ?? null,
        last_frame_image: manualLastFrameAnchorId ?? null,
        subject_reference: (attachedAnchors || []).map(a => a.id),
      },
    },
  }),
})
```

Add `deriveVideoMode` helper near the top of the module (before `VideoPanel` component):

```js
// Maps the presence of frame/subject inputs to the MiniMax video mode
// taxonomy used in the meta sidecar. Pure function — easy to unit-test.
export function deriveVideoMode({ firstFrame, lastFrame, subject_reference } = {}) {
  if (subject_reference && subject_reference.length) return 's2v'
  if (firstFrame && lastFrame) return 'sef'
  if (firstFrame) return 'image2video'
  return 'text2video'
}
```

For `manualFirstFrameAnchorId` / `manualLastFrameAnchorId`: these are `null` for manual uploads in v1 (manual data URLs aren't persisted as anchor IDs). If the user attached anchors instead of manual uploads, surface the anchor ID. Read `attachedAnchors` and check whether `manualFirstFrame` came from an anchor or a raw upload — for v1, treat all manual frame uploads as `null` and only `attachedAnchors` ids are recorded as `subject_reference`. (The `first_frame_image` / `last_frame_image` fields stay `null` until anchor-attach for frames is wired, which is out of scope.)

- [ ] **Step 6: Run frontend test (optional but cheap)**

Add to `desktop/src/components/media/VideoPanel.test.jsx` (create if it doesn't exist — match `SettingsPanel.test.jsx` mocking pattern):

```js
import { deriveVideoMode } from './VideoPanel'

describe('deriveVideoMode', () => {
  it('returns text2video when no frames or subject', () => {
    expect(deriveVideoMode({})).toBe('text2video')
  })
  it('returns image2video when only firstFrame', () => {
    expect(deriveVideoMode({ firstFrame: 'x' })).toBe('image2video')
  })
  it('returns sef when both frames', () => {
    expect(deriveVideoMode({ firstFrame: 'x', lastFrame: 'y' })).toBe('sef')
  })
  it('returns s2v when subject_reference non-empty', () => {
    expect(deriveVideoMode({ subject_reference: ['x'] })).toBe('s2v')
  })
})
```

Run: `cd desktop && npx vitest run src/components/media/VideoPanel.test.jsx`
Expected: 4 PASS.

- [ ] **Step 7: Commit**

```bash
git add web/backend/main.py tests/test_generation_meta.py \
        desktop/src/components/media/VideoPanel.jsx \
        desktop/src/components/media/VideoPanel.test.jsx
git commit -m "feat(generation-meta): video sidecar via /api/video/download meta payload

Frontend VideoPanel sends prompt+params+references in the download
request body. Backend writes the sidecar when meta is present, ignores
it when absent (backward compatible). Adds deriveVideoMode() helper."
```

---

### Task 4: GET `/api/generations` meta merge + DELETE sidecar cleanup

**Files:**
- Modify: `web/backend/main.py` (`list_generations` ~5891, `delete_generated_image` ~5919)
- Test: `tests/test_generation_meta.py` (append)

**Interfaces:**
- Consumes: Task 1 helpers (`_read_media_meta`, `_media_meta_sidecar_path`).
- Produces: `GET /api/generations` items now include `meta: dict | None`. DELETE image removes both the file and its sidecar.

- [ ] **Step 1: Add failing tests**

Append to `tests/test_generation_meta.py`:

```python
def _seed_image_with_sidecar(name="gen_merge.png"):
    """Create a media file + sidecar pair under generations/images/."""
    img = _workspace() / "generations" / "images" / name
    img.parent.mkdir(parents=True, exist_ok=True)
    img.write_bytes(b"\x89PNG")
    _main._write_media_meta(img, {
        "version": 1, "media_type": "image",
        "prompt": "test", "user_prompt": "test",
        "model": "image-01", "params": {}, "references": {},
    })
    return img


def test_generations_list_includes_meta_field():
    img = _seed_image_with_sidecar("list_meta.png")
    try:
        res = client.get("/api/generations")
        assert res.status_code == 200
        images = res.json()["data"]["images"]
        match = next(i for i in images if i["name"] == "list_meta.png")
        assert match["meta"] is not None
        assert match["meta"]["prompt"] == "test"
    finally:
        img.with_suffix(".meta.json").unlink()
        img.unlink()


def test_generations_list_skips_sidecar_files_as_entries():
    """A .meta.json file must NOT appear as its own gallery entry."""
    img = _seed_image_with_sidecar("skip_sidecar.png")
    try:
        res = client.get("/api/generations")
        names = [i["name"] for i in res.json()["data"]["images"]]
        assert "skip_sidecar.png" in names
        assert "skip_sidecar.meta.json" not in names
    finally:
        img.with_suffix(".meta.json").unlink()
        img.unlink()


def test_generations_list_meta_null_when_sidecar_missing():
    """Pre-feature files (no sidecar) -> meta: null, not 500."""
    img = _workspace() / "generations" / "images" / "no_meta.png"
    img.parent.mkdir(parents=True, exist_ok=True)
    img.write_bytes(b"\x89PNG")
    try:
        res = client.get("/api/generations")
        match = next(i for i in res.json()["data"]["images"]
                     if i["name"] == "no_meta.png")
        assert match["meta"] is None
    finally:
        img.unlink()


def test_delete_image_removes_sidecar():
    img = _seed_image_with_sidecar("del_sidecar.png")
    sc = img.with_suffix(".meta.json")
    assert img.exists() and sc.exists()
    try:
        rel = f"generations/images/{img.name}"
        res = client.delete(f"/api/generations/image?path={rel}")
        assert res.status_code == 200
        assert not img.exists()
        assert not sc.exists(), "sidecar must be removed with the image"
    finally:
        for p in (sc, img):
            if p.exists():
                p.unlink()


def test_delete_image_missing_sidecar_is_idempotent():
    """Delete an image that has no sidecar — must still 200."""
    img = _workspace() / "generations" / "images" / "no_sc.png"
    img.parent.mkdir(parents=True, exist_ok=True)
    img.write_bytes(b"\x89PNG")
    rel = f"generations/images/{img.name}"
    res = client.delete(f"/api/generations/image?path={rel}")
    assert res.status_code == 200
    assert not img.exists()
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/test_generation_meta.py -k "generations_list or delete_image" -v`
Expected: FAIL on `test_generations_list_includes_meta_field` (no `meta` key in returned dict).

- [ ] **Step 3: Update `list_generations`**

In `list_generations` (~5891), modify the per-file loop. Current:

```python
    for subdir in ("images", "videos", "music", "tts"):
        folder = generations_dir / subdir
        if not folder.exists():
            continue
        for f in folder.iterdir():
            if not f.is_file():
                continue
            stat = f.stat()
            result[subdir].append({
                "name": f.name,
                "path": str(f.relative_to(get_app_workspace_dir())).replace("\\", "/"),
                "type": subdir,
                "size": stat.st_size,
                "modified_at": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                "extension": f.suffix.lower(),
            })
        result[subdir].sort(key=lambda x: x["modified_at"], reverse=True)
```

Change the `for f in folder.iterdir()` block — skip `.meta.json` files and attach `meta`:

```python
    for subdir in ("images", "videos", "music", "tts"):
        folder = generations_dir / subdir
        if not folder.exists():
            continue
        for f in folder.iterdir():
            if not f.is_file():
                continue
            # Sidecars are not gallery entries — skip them.
            if f.suffix.lower() == ".json":
                continue
            stat = f.stat()
            result[subdir].append({
                "name": f.name,
                "path": str(f.relative_to(get_app_workspace_dir())).replace("\\", "/"),
                "type": subdir,
                "size": stat.st_size,
                "modified_at": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                "extension": f.suffix.lower(),
                "meta": _read_media_meta(f),  # dict or None
            })
        result[subdir].sort(key=lambda x: x["modified_at"], reverse=True)
```

- [ ] **Step 4: Update `delete_generated_image` for sidecar cleanup**

In `delete_generated_image` (~5919), extend the existing unlink block. Current:

```python
        if target.exists() and target.is_file():
            target.unlink()
```

Change to:

```python
        if target.exists() and target.is_file():
            target.unlink()
        sc = _media_meta_sidecar_path(target)
        if sc.exists():
            try:
                sc.unlink()
            except Exception:
                pass
```

- [ ] **Step 5: Run all generation_meta tests**

Run: `pytest tests/test_generation_meta.py -v`
Expected: all tests PASS (helpers + image endpoint + video download + generations list + delete).

- [ ] **Step 6: Run the full existing test suite (regression check)**

Run: `pytest -x --timeout=60`
Expected: 0 failures. If `test_image_recent_delete.py` or others fail, investigate — most likely cause is the new `meta` field on `/api/generations` items breaking a strict-equality assertion.

- [ ] **Step 7: Commit**

```bash
git add web/backend/main.py tests/test_generation_meta.py
git commit -m "feat(generation-meta): merge meta in /api/generations + cleanup on delete

GET /api/generations now returns 'meta: dict | None' on each item and
skips .meta.json sidecars as their own entries. DELETE /api/generations/
image removes the sibling sidecar too. Backward compatible — missing
sidecar yields meta: null."
```

---

### Task 5: Frontend `GenerationMetaModal` component + test

**Files:**
- Create: `desktop/src/components/media/GenerationMetaModal.jsx`
- Create: `desktop/src/components/media/GenerationMetaModal.test.jsx`

**Interfaces:**
- Consumes: `{ item, onClose }` where `item = { name, path, type, meta }` (same shape as `/api/generations` items).
- Produces: a rendered modal. Task 6 mounts it from each panel.

- [ ] **Step 1: Write failing component test**

Create `desktop/src/components/media/GenerationMetaModal.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import GenerationMetaModal from './GenerationMetaModal'

describe('GenerationMetaModal', () => {
  it('renders empty state when meta is null', () => {
    render(<GenerationMetaModal item={{ name: 'x.png', type: 'image', meta: null }} onClose={() => {}} />)
    expect(screen.getByText(/no saved metadata/i)).toBeInTheDocument()
  })

  it('renders prompt and params when meta is populated', () => {
    const item = {
      name: 'img.png', type: 'image',
      meta: {
        media_type: 'image', prompt: 'a red apple', user_prompt: 'a red apple',
        model: 'image-01',
        params: { aspect_ratio: '16:9', seed: 42, mode: 't2i' },
        references: { subject_reference: [] },
        created_at: '2026-07-20T11:27:00Z',
      },
    }
    render(<GenerationMetaModal item={item} onClose={() => {}} />)
    expect(screen.getByText('a red apple')).toBeInTheDocument()
    expect(screen.getByText('image-01')).toBeInTheDocument()
    expect(screen.getByText('16:9')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
  })

  it('shows user_prompt separately when it differs from prompt', () => {
    const item = {
      name: 'img.png', type: 'image',
      meta: {
        media_type: 'image',
        prompt: 'a red apple, cinematic lighting, 35mm',
        user_prompt: 'a red apple',
        model: 'image-01', params: {}, references: {},
      },
    }
    render(<GenerationMetaModal item={item} onClose={() => {}} />)
    expect(screen.getByText('a red apple, cinematic lighting, 35mm')).toBeInTheDocument()
    // user prompt shown in its own section
    expect(screen.getAllByText('a red apple').length).toBeGreaterThanOrEqual(1)
  })

  it('fires onClose when close button clicked', () => {
    const onClose = vi.fn()
    render(<GenerationMetaModal item={{ name: 'x', type: 'image', meta: null }} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd desktop && npx vitest run src/components/media/GenerationMetaModal.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `GenerationMetaModal.jsx`**

Use the existing modal shell pattern from `desktop/src/components/media/AnchorEditor.jsx` (overlay + panel + close button) and `desktop/src/components/shared/CopyButton.jsx` (copy-to-clipboard). Use `react-i18next` for all visible strings.

```jsx
import { useState } from 'react'
import { X, Copy, Check, AlertCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { assetUrl } from '../../lib/api.js'

const FALLBACK = '<unset>'

/**
 * Read-only modal showing the prompt + params for one generation.
 *
 * Props:
 *   item     — { name, path, type, meta } from /api/generations
 *   onClose  — () => void
 */
export default function GenerationMetaModal({ item, onClose }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(null) // 'prompt' | 'json' | null

  const meta = item?.meta
  const mediaUrl = item?.path
    ? assetUrl(`/api/files/download?path=${encodeURIComponent(item.path)}`)
    : null

  const copy = async (which, text) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(which)
      setTimeout(() => setCopied(null), 1500)
    } catch (e) {
      // best-effort — clipboard may be unavailable in some embeds
    }
  }

  const ParamRow = ({ k, v }) => (
    <div className="flex justify-between gap-3 py-1 text-xs">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-mono text-foreground text-right break-all">
        {v === null || v === undefined ? FALLBACK : String(v)}
      </span>
    </div>
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-background border border-border rounded-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border sticky top-0 bg-background">
          <h2 className="text-sm font-semibold text-foreground">
            {t('metaModal.title', { defaultValue: 'Generation details' })}
          </h2>
          <button
            onClick={onClose}
            aria-label={t('common.close', { defaultValue: 'Close' })}
            className="p-1.5 rounded-lg hover:bg-surface text-muted-foreground hover:text-foreground"
          >
            <X size={16} />
          </button>
        </div>

        {!meta ? (
          <div className="p-6 flex flex-col items-center gap-2 text-muted-foreground">
            <AlertCircle size={20} />
            <p className="text-xs">
              {t('metaModal.empty',
                { defaultValue: 'This generation has no saved metadata.' })}
            </p>
          </div>
        ) : (
          <div className="p-4 space-y-5">
            {/* Media preview */}
            {mediaUrl && item.type === 'image' && (
              <img src={mediaUrl} alt={item.name}
                   className="w-full max-h-48 object-contain rounded-lg border border-border" />
            )}
            {mediaUrl && item.type === 'video' && (
              <video src={mediaUrl} controls className="w-full max-h-48 rounded-lg border border-border" />
            )}
            {mediaUrl && (item.type === 'music' || item.type === 'tts') && (
              <audio src={mediaUrl} controls className="w-full" />
            )}

            {/* Prompt */}
            <section>
              <div className="flex items-center justify-between mb-1.5">
                <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  {t('metaModal.promptSection', { defaultValue: 'Prompt' })}
                </h3>
                <button
                  onClick={() => copy('prompt', meta.prompt || '')}
                  className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                >
                  {copied === 'prompt' ? <Check size={11} /> : <Copy size={11} />}
                  {t('metaModal.copyPrompt', { defaultValue: 'Copy prompt' })}
                </button>
              </div>
              <div className="bg-surface border border-border rounded-lg p-3 text-xs text-foreground whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
                {meta.prompt || FALLBACK}
              </div>
            </section>

            {/* User prompt (only when differs) */}
            {meta.user_prompt && meta.user_prompt !== meta.prompt && (
              <section>
                <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">
                  {t('metaModal.userPromptSection', { defaultValue: 'User prompt' })}
                </h3>
                <div className="bg-surface border border-border rounded-lg p-3 text-xs text-foreground whitespace-pre-wrap break-words">
                  {meta.user_prompt}
                </div>
              </section>
            )}

            {/* Model + created */}
            <section className="grid grid-cols-2 gap-3">
              <ParamRow k={t('metaModal.modelLabel', { defaultValue: 'Model' })} v={meta.model} />
              <ParamRow k={t('metaModal.createdAtLabel', { defaultValue: 'Created' })}
                        v={meta.created_at ? new Date(meta.created_at).toLocaleString() : null} />
            </section>

            {/* Params */}
            {meta.params && Object.keys(meta.params).length > 0 && (
              <section>
                <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">
                  {t('metaModal.paramsSection', { defaultValue: 'Parameters' })}
                </h3>
                <div className="bg-surface border border-border rounded-lg p-3">
                  {Object.entries(meta.params).map(([k, v]) => (
                    <ParamRow key={k} k={k} v={typeof v === 'object' ? JSON.stringify(v) : v} />
                  ))}
                </div>
              </section>
            )}

            {/* References */}
            {meta.references && Object.keys(meta.references).length > 0 && (
              <section>
                <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">
                  {t('metaModal.referencesSection', { defaultValue: 'References' })}
                </h3>
                <div className="bg-surface border border-border rounded-lg p-3 space-y-1">
                  {Object.entries(meta.references).map(([k, v]) => (
                    <ParamRow key={k} k={k}
                              v={v === null ? t('metaModal.manualUpload',
                                { defaultValue: 'Manual upload — not persisted' })
                                : (Array.isArray(v) ? v.join(', ') || '—' : v)} />
                  ))}
                </div>
              </section>
            )}

            {/* Copy full JSON */}
            <div className="pt-2 border-t border-border">
              <button
                onClick={() => copy('json', JSON.stringify(meta, null, 2))}
                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
              >
                {copied === 'json' ? <Check size={11} /> : <Copy size={11} />}
                {t('metaModal.copyJson', { defaultValue: 'Copy full JSON' })}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `cd desktop && npx vitest run src/components/media/GenerationMetaModal.test.jsx`
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/components/media/GenerationMetaModal.jsx \
        desktop/src/components/media/GenerationMetaModal.test.jsx
git commit -m "feat(generation-meta): read-only GenerationMetaModal component

Renders prompt + user_prompt + model + params + references + media
preview. Copy-prompt and copy-JSON buttons. Empty state when meta is
null. Vitest covers populated, empty, user-prompt-differs, and onClose."
```

---

### Task 6: Wire info button + modal into `RecentGenerations` + panels + i18n

**Files:**
- Modify: `desktop/src/components/media/RecentGenerations.jsx`
- Modify: `desktop/src/components/media/ImagePanel.jsx`, `MusicPanel.jsx`, `SpeechPanel.jsx`, `VideoPanel.jsx`
- Modify: `desktop/src/i18n/{en,ko,es,ja,zh-CN,pt-BR}.json`

**Interfaces:**
- Consumes: Task 5 `GenerationMetaModal`. `/api/generations` item shape with `meta` field (Task 4).
- Produces: info button on every recent-generation card across image / music / tts / video lists.

- [ ] **Step 1: Update `RecentGenerations.jsx` props + add Info button**

Open `desktop/src/components/media/RecentGenerations.jsx`. Update the import line at top:

```jsx
import { RefreshCw, Save, Loader2, Anchor, Trash2, Info } from 'lucide-react'
```

Add `onShowMeta` to the destructure (around line 16):

```jsx
export default function RecentGenerations({
  title = 'Recent Generations',
  type,
  items = [],
  loading = false,
  error = null,
  onRefresh,
  emptyMessage = 'No recent generations',
  onPromoteToAnchor,
  onDeleteImage,
  onShowMeta,  // NEW: (item) => void — opens GenerationMetaModal
}) {
  const { t } = useTranslation()  // add useTranslation import at top
  // ...
}
```

(Add `import { useTranslation } from 'react-i18next'` to imports.)

In the image grid (lines ~74–125), inside the hover overlay, after the existing delete button:

```jsx
{onShowMeta && (
  <button
    type="button"
    onClick={(e) => { e.stopPropagation(); onShowMeta(item) }}
    disabled={!item.meta}
    className={`p-1.5 rounded-lg transition-colors ${
      item.meta
        ? 'bg-white/90 hover:bg-white text-black'
        : 'bg-white/40 text-black/40 cursor-not-allowed'
    }`}
    title={item.meta
      ? t('recentGenerations.showMeta', { defaultValue: 'View prompt & settings' })
      : t('recentGenerations.noMeta', { defaultValue: 'No saved metadata' })}
    aria-label={item.meta ? 'View metadata' : 'No metadata'}
  >
    <Info size={12} />
  </button>
)}
```

In the music/tts list branch (~127–155), inside the `<div className="flex items-center justify-between">` row, add an info button before the Download anchor:

```jsx
<div className="flex items-center justify-between">
  <p className="text-[10px] text-muted-foreground">{formatSize(item.size)}</p>
  <div className="flex items-center gap-2">
    {onShowMeta && (
      <button
        type="button"
        onClick={() => onShowMeta(item)}
        disabled={!item.meta}
        className={`p-1.5 rounded-lg transition-colors ${
          item.meta
            ? 'bg-surface hover:bg-surface-hover text-foreground'
            : 'bg-surface text-muted-foreground/40 cursor-not-allowed'
        }`}
        title={item.meta
          ? t('recentGenerations.showMeta', { defaultValue: 'View prompt & settings' })
          : t('recentGenerations.noMeta', { defaultValue: 'No saved metadata' })}
        aria-label={item.meta ? 'View metadata' : 'No metadata'}
      >
        <Info size={12} />
      </button>
    )}
    <a href={mediaUrl(item.path)} download={item.name}
       className="px-3 py-1 bg-primary hover:bg-primary-hover text-white text-xs rounded-lg transition-colors flex items-center gap-1">
      <Save size={10} /> Download
    </a>
  </div>
</div>
```

Repeat the same info button insertion in the video list branch (~157–185).

- [ ] **Step 2: Wire modal state into each panel**

For each of `ImagePanel.jsx`, `MusicPanel.jsx`, `SpeechPanel.jsx`, `VideoPanel.jsx`:

1. Add at top of imports: `import GenerationMetaModal from './GenerationMetaModal'`
2. Add state: `const [metaItem, setMetaItem] = useState(null)`
3. Pass `onShowMeta={setMetaItem}` to the `<RecentGenerations ...>` instance (find via the existing `RecentGenerations` usage in each file).
4. Render the modal at the end of the component's JSX (sibling to the layout wrapper):

```jsx
{metaItem && (
  <GenerationMetaModal item={metaItem} onClose={() => setMetaItem(null)} />
)}
```

For VideoPanel specifically, note it uses the `VideoHistory` subcomponent (line ~376 per earlier grep) which wraps `RecentGenerations` — propagate `onShowMeta` through it as well, or render the modal at the `VideoPanel` top level and pass `setMetaItem` down through `VideoHistory` as a prop.

- [ ] **Step 3: Add anchor-ID propagation in ImagePanel (for `/api/image` body)**

Open `desktop/src/components/media/ImagePanel.jsx`. Locate the `fetch('/api/image', ...)` call. In the request body, alongside the existing `subject_reference`, add:

```js
subject_reference_anchors: (attachedAnchors || []).map(a => a.id),
```

(Same field name the backend `ImageRequest` model added in Task 2 Step 3.)

If `attachedAnchors` isn't already tracked in ImagePanel state (it is in VideoPanel but maybe not in ImagePanel), check the panel's existing state — if absent, this can be skipped in v1 (backend tolerates `null` and stores `[]`).

- [ ] **Step 4: Add i18n keys to all 6 locale files**

For each of `desktop/src/i18n/{en,ko,es,ja,zh-CN,pt-BR}.json`, add the following keys at the top level (sibling to `image`, `music`, etc.). English values shown; other locales accept empty string `""` as the fallback per existing policy. Provide real translations for `ko.json` since the user is Korean; leave others as English or empty.

Add to `en.json`:

```json
"recentGenerations": {
  "showMeta": "View prompt & settings",
  "noMeta": "No saved metadata"
},
"metaModal": {
  "title": "Generation details",
  "promptSection": "Prompt",
  "userPromptSection": "User prompt",
  "paramsSection": "Parameters",
  "referencesSection": "References",
  "modelLabel": "Model",
  "createdAtLabel": "Created",
  "copyPrompt": "Copy prompt",
  "copyJson": "Copy full JSON",
  "empty": "This generation has no saved metadata.",
  "manualUpload": "Manual upload — not persisted"
}
```

Add to `ko.json` (real Korean translations):

```json
"recentGenerations": {
  "showMeta": "프롬프트와 설정 보기",
  "noMeta": "저장된 메타데이터 없음"
},
"metaModal": {
  "title": "생성 상세 정보",
  "promptSection": "프롬프트",
  "userPromptSection": "사용자 프롬프트",
  "paramsSection": "매개변수",
  "referencesSection": "참조",
  "modelLabel": "모델",
  "createdAtLabel": "생성 시각",
  "copyPrompt": "프롬프트 복사",
  "copyJson": "전체 JSON 복사",
  "empty": "이 결과물에는 저장된 메타데이터가 없습니다.",
  "manualUpload": "수동 업로드 — 저장되지 않음"
}
```

For `es.json`, `ja.json`, `zh-CN.json`, `pt-BR.json`: paste the same key structure with the English values as defaults (or empty strings — the i18n fallback policy accepts both; match whatever neighbouring keys do).

- [ ] **Step 5: Run frontend tests + typecheck**

Run:
```bash
cd desktop && npx vitest run src/components/media/
cd desktop && npm run build
```

Expected: existing media tests still pass; build succeeds (no syntax errors in modified panels).

- [ ] **Step 6: Manual smoke (requires dev server + API key)**

```bash
cd desktop && npm run tauri:dev
```

Generate an image. Open the image panel, click the new Info icon on the result card, confirm the modal shows the prompt + params. Click Close. Switch to Music, generate, repeat. Switch to Speech, generate, repeat. Switch to Video, generate, repeat.

If no API key available, skip — backend tests already cover the data path.

- [ ] **Step 7: Commit**

```bash
git add desktop/src/components/media/RecentGenerations.jsx \
        desktop/src/components/media/ImagePanel.jsx \
        desktop/src/components/media/MusicPanel.jsx \
        desktop/src/components/media/SpeechPanel.jsx \
        desktop/src/components/media/VideoPanel.jsx \
        desktop/src/components/media/VideoPanel.test.jsx \
        desktop/src/i18n/en.json desktop/src/i18n/ko.json \
        desktop/src/i18n/es.json desktop/src/i18n/ja.json \
        desktop/src/i18n/zh-CN.json desktop/src/i18n/pt-BR.json
git commit -m "feat(generation-meta): info button + modal in RecentGenerations

All 4 panels (image/music/tts/video) own modal state and pass
onShowMeta to RecentGenerations. Info icon grayed out when meta is null.
ImagePanel sends subject_reference_anchors with /api/image body.
13 new i18n keys across 6 locales (en + ko fully translated)."
```

---

## Summary

- **6 tasks**, each with TDD steps (failing test → impl → pass → commit).
- All backend changes localized to `web/backend/main.py` + 1 new test module.
- All frontend changes localized to `desktop/src/components/media/` + 6 i18n files.
- Backward compatible: old clients (no `meta` in video download) still work; old files (no sidecar) return `meta: null`.
- No DB migrations, no schema breakage, no new external dependencies.

## Risks

- **Music handler local var names** (Task 2 Step 6): the spec assumes `output_path`, `audio_setting`, `req.is_instrumental`, `req.audio_url`. Verify against current handler body before writing the sidecar block — fix var names from what's actually there, don't invent.
- **Speech synthesize absolute path** (Task 2 Step 7): `_save_audio_hex` returns a relative path. Construct the absolute path via `_resolve_session_root(session_id) / rel_path` for the sidecar write.
- **i18n key collisions**: `recentGenerations` might already exist as a sub-key in some locale files (it was used as a value string in some panels). If so, rename the new key to `recentGenerationsMeta` to avoid collision. Run a `grep recentGenerations desktop/src/i18n/*.json` before adding to confirm.
- **Frontend test runner**: confirm `@testing-library/react` and `vitest` are already dev-deps (they are, per `SettingsPanel.test.jsx` existence).
