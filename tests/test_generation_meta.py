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
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "web" / "backend"))

# conftest.py (tests/) sets MINIMAX_PROJECT_ROOT before any module
# imports main. We reuse that shared workspace for all file operations.

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

    original_write_text = Path.write_text

    def boom(self, *a, **kw):
        # Only raise for the sidecar path; let other writes through.
        if self.suffix == ".tmp" or ".meta.json" in self.name or ".json.tmp" in self.name:
            raise OSError("disk full")
        return original_write_text(self, *a, **kw)

    monkeypatch.setattr(Path, "write_text", boom)
    # Must not raise.
    _main._write_media_meta(img, {"version": 1})

def test_image_endpoint_writes_sidecar(monkeypatch):
    """POST /api/image must write a sidecar with prompt + params.
    Mocks image_sync so no network/API key is needed."""
    def fake_image_sync(api_key, api_base, prompt, output_path, **kw):
        Path(output_path).write_bytes(b"\x89PNG\r\n\x1a\n")
        return True, output_path

    monkeypatch.setattr(_main, "get_minimax_config",
                        lambda: {"api_key": "sk-test", "api_base": "x"})
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
    rel = body["file_path"]
    img = _workspace() / rel
    sc = _main._media_meta_sidecar_path(img)
    try:
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
    finally:
        for p in (sc, img):
            if p.exists():
                p.unlink()


def test_image_endpoint_i2i_live_mode_records_mode(monkeypatch):
    """POST /api/image with subject_reference switches to i2i-live and
    records the attached anchor IDs in the sidecar."""
    def fake_image_sync(api_key, api_base, prompt, output_path, **kw):
        Path(output_path).write_bytes(b"\x89PNG\r\n\x1a\n")
        return True, output_path

    monkeypatch.setattr(_main, "get_minimax_config",
                        lambda: {"api_key": "sk-test", "api_base": "x"})
    import mini_max_mcp.client as mc
    monkeypatch.setattr(mc, "image_sync", fake_image_sync)

    res = client.post("/api/image", json={
        "prompt": "a hero with a red cloak",
        "subject_reference": [{"type": "character", "image_file": "data:image/png;base64,xxx"}],
        "subject_reference_anchors": ["anchor-abc-123"],
    })
    assert res.status_code == 200, res.text
    img = _workspace() / res.json()["file_path"]
    sc = _main._media_meta_sidecar_path(img)
    try:
        data = json.loads(sc.read_text(encoding="utf-8"))
        assert data["params"]["mode"] == "i2i-live"
        assert data["model"] == "image-01-live"
        assert data["references"]["subject_reference"] == ["anchor-abc-123"]
    finally:
        for p in (sc, img):
            if p.exists():
                p.unlink()


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
    try:
        assert vid.exists()
        assert sc.exists()
        data = json.loads(sc.read_text(encoding="utf-8"))
        assert data["media_type"] == "video"
        assert data["prompt"] == "a cat playing piano"
        assert data["params"]["mode"] == "text2video"
        assert "created_at" in data, "server must inject created_at"
    finally:
        for p in (sc, vid):
            if p.exists():
                p.unlink()


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
    try:
        assert vid.exists()
        assert not sc.exists(), "old client must not produce a sidecar"
    finally:
        if vid.exists():
            vid.unlink()


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
        for p in (img.with_suffix(".meta.json"), img):
            if p.exists():
                p.unlink()


def test_generations_list_skips_sidecar_files_as_entries():
    """A .meta.json file must NOT appear as its own gallery entry."""
    img = _seed_image_with_sidecar("skip_sidecar.png")
    try:
        res = client.get("/api/generations")
        names = [i["name"] for i in res.json()["data"]["images"]]
        assert "skip_sidecar.png" in names
        assert "skip_sidecar.meta.json" not in names
    finally:
        for p in (img.with_suffix(".meta.json"), img):
            if p.exists():
                p.unlink()


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
        if img.exists():
            img.unlink()


def test_delete_image_removes_sidecar():
    img = _seed_image_with_sidecar("del_sidecar.png")
    sc = img.with_suffix(".meta.json")
    assert img.exists() and sc.exists()
    rel = f"generations/images/{img.name}"
    res = client.delete(f"/api/generations/image?path={rel}")
    assert res.status_code == 200
    assert not img.exists()
    assert not sc.exists(), "sidecar must be removed with the image"


def test_delete_image_missing_sidecar_is_idempotent():
    """Delete an image that has no sidecar — must still 200."""
    img = _workspace() / "generations" / "images" / "no_sc.png"
    img.parent.mkdir(parents=True, exist_ok=True)
    img.write_bytes(b"\x89PNG")
    rel = f"generations/images/{img.name}"
    res = client.delete(f"/api/generations/image?path={rel}")
    assert res.status_code == 200
    assert not img.exists()
