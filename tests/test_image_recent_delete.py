"""Tests for DELETE /api/generations/image.

Covers:
  - happy path (file removed)
  - idempotent on missing file
  - path traversal blocked
  - paths outside generations/images/ blocked
  - missing path returns 400
"""
import os
import sys
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "web" / "backend"))

# Point MINIMAX_PROJECT_ROOT at a temp dir BEFORE importing main.
TMP_ROOT = Path(tempfile.mkdtemp(prefix="minimax_imgdel_"))
os.environ["MINIMAX_PROJECT_ROOT"] = str(TMP_ROOT)

import web.backend.main as _main  # noqa: E402

client = TestClient(_main.app)


def _write_image(name: str = "image_test.png") -> str:
    p = TMP_ROOT / "workspace" / "generations" / "images" / name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(b"\x89PNG\r\n\x1a\n")
    return f"generations/images/{name}"


def test_delete_removes_file_and_returns_path():
    rel = _write_image()
    img_path = TMP_ROOT / "workspace" / "generations" / "images" / "image_test.png"
    assert img_path.exists()

    res = client.delete(f"/api/generations/image?path={rel}")
    assert res.status_code == 200, res.text
    assert res.json() == {"success": True, "deleted": rel}
    assert not img_path.exists()


def test_delete_missing_file_is_idempotent():
    res = client.delete("/api/generations/image?path=generations/images/ghost.png")
    assert res.status_code == 200, res.text
    assert res.json()["success"] is True


def test_delete_rejects_path_outside_workspace():
    res = client.delete("/api/generations/image?path=../../etc/passwd")
    assert res.status_code in (400, 403)


def test_delete_rejects_path_outside_images_dir():
    # music file is a sibling dir; must NOT be deletable through this endpoint
    music = TMP_ROOT / "workspace" / "generations" / "music" / "track.mp3"
    music.parent.mkdir(parents=True, exist_ok=True)
    music.write_bytes(b"mp3")

    res = client.delete("/api/generations/image?path=generations/music/track.mp3")
    assert res.status_code == 403
    assert music.exists(), "file must NOT be removed"


def test_delete_rejects_empty_path():
    res = client.delete("/api/generations/image?path=")
    assert res.status_code == 400
