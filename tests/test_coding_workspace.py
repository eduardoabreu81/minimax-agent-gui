"""Tests for the v0.5 coding-workspace redesign.

These tests cover the bits of the new helper surface that don't need
a running backend:

  - ``get_app_workspace_dir()`` is always an absolute path under
    PROJECT_ROOT and is created on demand.
  - ``_safe_join()`` rejects path traversal (anything that resolves
    outside the workspace root).
  - ``_add_recent_coding_workspace()`` pushes MRU entries, dedupes,
    and caps at ``RECENT_WORKSPACES_LIMIT``.

Heavier integration coverage (lock-on-first-message, conversations
attaching the workspace, files endpoint routing) lives in
``test_workspace_integration.py`` and needs the FastAPI app booted via
``TestClient`` — kept separate so the smoke tests stay fast.
"""

import os
import sys
import tempfile
import importlib.util
from pathlib import Path

import pytest

# Make sure ``web/backend/main.py`` is importable. The test runs from the
# repo root (pytest config sets cwd), so we only need the parent on
# sys.path — the module itself reads its own PROJECT_ROOT from
# ``__file__``.
ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))


def _install_mcp_runtime_stub():
    """Stub: main.py does ``from mcp_runtime import test_mcp_server``
    but the module isn't shipped with the repo. The symbol just needs
    to be importable so the module loads. We re-install it on every
    fixture invocation because the fixture purges ``mcp_*`` modules.
    """
    import types
    stub = types.ModuleType("mcp_runtime")
    stub.test_mcp_server = lambda *a, **kw: None
    sys.modules["mcp_runtime"] = stub


# Install once for any plain ``import main`` that happens during
# test collection (so the fixture's later re-import doesn't see a
# half-initialised module).
_install_mcp_runtime_stub()


@pytest.fixture
def tmp_project(tmp_path, monkeypatch):
    """Set up a clean temp project tree so the tests don't touch the
    real ``PROJECT_ROOT`` (= the repo root in dev) or the on-disk
    config.yaml. We use the ``MINIMAX_PROJECT_ROOT`` env var (which
    ``web/backend/main.py`` honours at import time) to redirect the
    backend into a temp dir, then drop ``config={}`` so recent-coding
    workspaces don't leak across tests."""
    fake_root = tmp_path / "minimax-root"
    fake_root.mkdir()
    (fake_root / "config").mkdir()
    (fake_root / "workspace").mkdir()

    # Critical order: set env BEFORE importing main, otherwise
    # PROJECT_ROOT will resolve to the real repo root.
    monkeypatch.setenv("MINIMAX_PROJECT_ROOT", str(fake_root))
    monkeypatch.chdir(fake_root)

    # Force a fresh import in case an earlier test already loaded it.
    if "main" in sys.modules:
        del sys.modules["main"]
    # Re-import the deps that main.py pulls in so they bind against
    # the fresh env too (mini_agent.config etc).
    for mod in list(sys.modules):
        if mod.startswith(("mini_agent", "mini_max_mcp", "mcp_")):
            del sys.modules[mod]

    spec = importlib.util.spec_from_file_location(
        "main", ROOT / "web" / "backend" / "main.py"
    )
    main = importlib.util.module_from_spec(spec)
    # Re-install the mcp_runtime stub *after* the module purge so the
    # import statement inside main.py finds it.
    _install_mcp_runtime_stub()
    spec.loader.exec_module(main)
    # Drop the on-disk config we may have inherited so recent-coding
    # workspaces start empty per test.
    main.config = {}
    return main, fake_root


# --- get_app_workspace_dir ----------------------------------------------------

def test_get_app_workspace_dir_returns_absolute_under_root(tmp_project):
    main, fake_root = tmp_project
    p = main.get_app_workspace_dir()
    assert p.is_absolute()
    assert p == (fake_root / "workspace").resolve()
    assert p.exists()  # creates on demand


def test_get_app_workspace_dir_is_idempotent(tmp_project):
    main, _ = tmp_project
    p1 = main.get_app_workspace_dir()
    p2 = main.get_app_workspace_dir()
    assert p1 == p2


# --- _safe_join ---------------------------------------------------------------

def test_safe_join_accepts_subpath(tmp_project):
    main, root = tmp_project
    (root / "workspace" / "src").mkdir()
    target = main._safe_join(root / "workspace", "src/main.py")
    assert target == (root / "workspace" / "src" / "main.py").resolve()


def test_safe_join_rejects_traversal(tmp_project):
    main, root = tmp_project
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        main._safe_join(root / "workspace", "../../etc/passwd")
    assert exc.value.status_code == 403


def test_safe_join_treats_empty_as_root(tmp_project):
    main, root = tmp_project
    assert main._safe_join(root / "workspace", "") == (root / "workspace").resolve()


# --- recent coding workspaces -------------------------------------------------

def test_recent_workspaces_dedupes_and_mru(tmp_project):
    main, _ = tmp_project
    a = main._add_recent_coding_workspace("/tmp/proj-a")
    b = main._add_recent_coding_workspace("/tmp/proj-b")
    # Re-adding 'a' should move it back to the top, NOT create a
    # second entry.
    a2 = main._add_recent_coding_workspace("/tmp/proj-a")
    assert a2[0]["path"].endswith("proj-a")
    assert len(a2) == 2
    assert a2[0] is not a[0]  # it's a fresh dict after re-add
    # Each entry carries a label and last_used timestamp.
    assert a2[0]["label"] == "proj-a"
    assert "last_used" in a2[0]


def test_recent_workspaces_caps_at_limit(tmp_project):
    main, _ = tmp_project
    paths = [f"/tmp/proj-{i}" for i in range(main.RECENT_WORKSPACES_LIMIT + 5)]
    for p in paths:
        main._add_recent_coding_workspace(p)
    out = main._load_recent_coding_workspaces()
    assert len(out) == main.RECENT_WORKSPACES_LIMIT
    # Newest first.
    assert out[0]["path"].endswith(f"proj-{len(paths) - 1}")


def test_recent_workspaces_handles_missing_key(tmp_project):
    main, _ = tmp_project
    # No "recent_coding_workspaces" key in config → empty list, no crash.
    assert main._load_recent_coding_workspaces() == []


def test_recent_workspaces_skips_invalid_entries(tmp_project):
    main, fake_root = tmp_project
    # Seed config with garbage entries — the loader must drop them
    # silently rather than 500'ing on read.
    cfg_path = fake_root / "config" / "config.yaml"
    import yaml
    yaml.safe_dump(
        {"recent_coding_workspaces": [
            {"path": "/tmp/ok", "label": "ok"},
            "not-a-dict",  # invalid
            {"label": "no-path"},  # missing path
            {"path": "/tmp/also-ok"},
        ]},
        open(cfg_path, "w", encoding="utf-8"),
    )
    main.config = yaml.safe_load(open(cfg_path, encoding="utf-8"))
    out = main._load_recent_coding_workspaces()
    paths = [e["path"] for e in out]
    assert "/tmp/ok" in paths
    assert "/tmp/also-ok" in paths
    assert len(out) == 2


# --- session workspace resolution --------------------------------------------

def test_get_session_workspace_dir_defaults_to_app_for_non_coding(tmp_project):
    main, fake_root = tmp_project
    p = main.get_session_workspace_dir("regular-chat-123")
    assert p == main.get_app_workspace_dir()


def test_get_session_workspace_dir_falls_back_when_no_coding_ws(tmp_project):
    main, _ = tmp_project
    p = main.get_session_workspace_dir("coding-abc")
    # No workspace set → fallback to app workspace (graceful default,
    # NOT an error — the picker will block sending the first message).
    assert p == main.get_app_workspace_dir()


# --- media output dir ---------------------------------------------------------

def test_media_output_dir_uses_outputs_for_coding(tmp_project):
    main, fake_root = tmp_project
    # Build a real folder under tmp_path (the fake_root is inside tmp_path's
    # pytest-managed temp dir, so it's safe to mutate).
    coding_ws = fake_root / "my-coding-proj"
    coding_ws.mkdir()
    main._coding_sessions["coding-xyz"] = {
        "workspace_dir": str(coding_ws),
        "locked": False,
    }
    out = main._media_output_dir("coding-xyz", "images")
    assert out == coding_ws.resolve() / "outputs" / "images"
    assert out.exists()  # created on demand


def test_media_output_dir_uses_generations_for_non_coding(tmp_project):
    main, fake_root = tmp_project
    out = main._media_output_dir("regular", "tts")
    expected = (fake_root / "workspace" / "generations" / "tts").resolve()
    assert out == expected


# --- _lock_coding_session ----------------------------------------------------

def test_lock_coding_session_is_idempotent(tmp_project):
    main, _ = tmp_project
    sid = "coding-locktest"
    main._coding_sessions[sid] = {"workspace_dir": "/x", "locked": False}
    main._lock_coding_session(sid)
    main._lock_coding_session(sid)  # second call shouldn't raise
    assert main._coding_sessions[sid]["locked"] is True


# --- attach refuses after lock ------------------------------------------------

def test_attach_after_lock_raises_409(tmp_project):
    main, _ = tmp_project
    from fastapi import HTTPException
    sid = "coding-after-lock"
    main._coding_sessions[sid] = {"workspace_dir": "/a", "locked": True}
    with pytest.raises(HTTPException) as exc:
        main._attach_coding_workspace(sid, "/b")
    assert exc.value.status_code == 409
    # Workspace unchanged.
    assert main._coding_sessions[sid]["workspace_dir"] == "/a"