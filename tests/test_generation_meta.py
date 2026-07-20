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
sys.path.insert(0, str(ROOT / "web" / "backend"))

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

    original_write_text = Path.write_text

    def boom(self, *a, **kw):
        # Only raise for the sidecar path; let other writes through.
        if self.suffix == ".tmp" or ".meta.json" in self.name or ".json.tmp" in self.name:
            raise OSError("disk full")
        return original_write_text(self, *a, **kw)

    monkeypatch.setattr(Path, "write_text", boom)
    # Must not raise.
    _main._write_media_meta(img, {"version": 1})
