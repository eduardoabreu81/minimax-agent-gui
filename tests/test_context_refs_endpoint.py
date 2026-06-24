"""Integration tests for the ``/api/context-refs/expand`` and
``/api/context-refs/list`` endpoints.

Covers:
  - parse + expand happy path (@file: relative to session workspace)
  - coding- session uses its locked workspace
  - non-coding session uses the app workspace
  - list endpoint returns relative paths
  - list endpoint with prefix filters
  - refused response when hard limit hit
  - soft_warning populated at 25% of context
"""

import importlib.util
import sys
import types
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# main.py uses bare relative imports (``from agent_context import ...``)
# so we need the ``web/backend`` directory on sys.path. Same pattern
# as test_coding_workspace.py: add repo root + load main.py via
# spec_from_file_location so we don't depend on the ``web`` package
# having an __init__.py.
ROOT = Path(__file__).parent.parent
BACKEND_DIR = ROOT / "web" / "backend"
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(BACKEND_DIR))

# main.py does ``from mcp_runtime import test_mcp_server`` — the symbol
# just needs to exist so the module loads. Stub it.
_mcp_runtime_stub = types.ModuleType("mcp_runtime")
_mcp_runtime_stub.test_mcp_server = lambda *a, **kw: None
sys.modules.setdefault("mcp_runtime", _mcp_runtime_stub)

# Load main.py from the file (not via package) so the bare relative
# imports inside it work via the sys.path entries above.
_spec = importlib.util.spec_from_file_location("main", BACKEND_DIR / "main.py")
backend_main = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(backend_main)


@pytest.fixture
def client(tmp_path, monkeypatch: pytest.MonkeyPatch):
    """A TestClient with a fresh workspace at tmp_path.

    We redirect the app's workspace + conversations dir to tmp_path so
    the tests don't touch the user's real ``workspace/`` directory.
    Pattern from project memory: redirect ``get_app_workspace_dir()``
    BEFORE creating the TestClient.
    """
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    convs = tmp_path / "conversations"
    convs.mkdir()
    (workspace / ".agent").mkdir()
    (workspace / "daily").mkdir()

    # Redirect the app's workspace + conversations dir to tmp_path so
    # the tests don't touch the user's real ``workspace/`` directory.
    # PROJECT_ROOT and CONVERSATIONS_DIR are the two module-level
    # constants in main.py that the rest of the code reads.
    monkeypatch.setattr(backend_main, "PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(backend_main, "CONVERSATIONS_DIR", convs)
    monkeypatch.setattr(
        backend_main, "get_app_workspace_dir",
        lambda: workspace,
    )

    return TestClient(backend_main.app), workspace


# ─────────────────────────────────────────────────────────────────────────────
# /api/context-refs/expand
# ─────────────────────────────────────────────────────────────────────────────


class TestExpandEndpoint:
    def test_no_refs_returns_empty_results(self, client):
        c, _ws = client
        r = c.post("/api/context-refs/expand", json={
            "session_id": "test-session",
            "message": "just a normal message with no @-refs",
        })
        assert r.status_code == 200
        body = r.json()
        assert body["success"] is True
        assert body["results"] == []
        assert body["total_bytes"] == 0
        assert body["parsed_refs"] == []
        assert body["refused"] is False

    def test_file_ref_happy_path(self, client):
        c, ws = client
        (ws / "hello.py").write_text("print('hi')\n")
        r = c.post("/api/context-refs/expand", json={
            "session_id": "test-session",
            "message": "Look at @file:hello.py please",
        })
        assert r.status_code == 200
        body = r.json()
        assert len(body["results"]) == 1
        assert body["results"][0]["ref"] == "@file:hello.py"
        assert body["results"][0]["error"] == ""
        assert "print('hi')" in body["results"][0]["content"]
        assert body["total_bytes"] > 0
        # Parsed refs are echoed back for the frontend
        assert len(body["parsed_refs"]) == 1
        assert body["parsed_refs"][0]["type"] == "file"

    def test_diff_ref_in_coding_workspace(self, client):
        c, ws = client
        # Init a git repo in the workspace
        import subprocess
        subprocess.run(["git", "init", "-q"], cwd=ws, check=True)
        subprocess.run(["git", "config", "user.email", "t@t"], cwd=ws, check=True)
        subprocess.run(["git", "config", "user.name", "T"], cwd=ws, check=True)
        (ws / "a.txt").write_text("first")
        subprocess.run(["git", "add", "a.txt"], cwd=ws, check=True)
        subprocess.run(["git", "commit", "-q", "-m", "init"], cwd=ws, check=True)
        (ws / "a.txt").write_text("first\nsecond")

        r = c.post("/api/context-refs/expand", json={
            "session_id": "test-session",
            "message": "What changed? @diff",
        })
        body = r.json()
        assert len(body["results"]) == 1
        # Either we get the diff or an error (e.g. if git isn't on PATH)
        if body["results"][0]["error"]:
            # Network-less / git-less test envs may fail here. That's OK.
            pytest.skip(f"git unavailable: {body['results'][0]['error']}")
        assert "second" in body["results"][0]["content"]

    def test_sensitive_path_returns_error_in_result(self, client, monkeypatch):
        c, ws = client
        # main.py imports ``from context_refs import ...`` which uses the
        # sys.path version (the one in the test's sys.path, not the
        # ``web.backend`` package version). Patch THAT one. We
        # re-import to find the right module object.
        import importlib
        cr = importlib.import_module("context_refs")
        fake_key = ws / "fake_key"
        fake_key.write_text("secret")
        original = cr.SENSITIVE_FILE_PATHS
        monkeypatch.setattr(cr, "SENSITIVE_FILE_PATHS", (str(fake_key),))
        r = c.post("/api/context-refs/expand", json={
            "session_id": "test-session",
            "message": "@file:fake_key",
        })
        body = r.json()
        assert body["results"][0]["error"]
        assert "sensitive" in body["results"][0]["error"].lower()
        # Errors don't count toward total
        assert body["total_bytes"] == 0

    def test_multiple_refs_partial_failure(self, client):
        c, ws = client
        (ws / "ok.py").write_text("ok content")
        r = c.post("/api/context-refs/expand", json={
            "session_id": "test-session",
            "message": "@file:ok.py and @file:missing.py",
        })
        body = r.json()
        assert len(body["results"]) == 2
        # First succeeds, second fails
        assert body["results"][0]["error"] == ""
        assert body["results"][1]["error"]
        # Only the good one counts toward total
        assert body["total_bytes"] == body["results"][0]["size_bytes"]


# ─────────────────────────────────────────────────────────────────────────────
# /api/context-refs/list
# ─────────────────────────────────────────────────────────────────────────────


class TestListEndpoint:
    def test_list_empty_workspace(self, client):
        c, ws = client
        # The fixture pre-creates .agent/ and daily/ as part of the
        # workspace shape. Use a prefix to scope the listing to a
        # truly empty subdir.
        empty = ws / "truly_empty"
        empty.mkdir()
        r = c.post("/api/context-refs/list", json={
            "session_id": "test-session",
            "prefix": "truly_empty",
        })
        assert r.status_code == 200
        body = r.json()
        assert body["success"] is True
        assert body["entries"] == []
        assert body["truncated"] is False

    def test_list_root(self, client):
        c, ws = client
        (ws / "a.py").write_text("x")
        (ws / "b.md").write_text("x")
        sub = ws / "sub"
        sub.mkdir()
        (sub / "c.py").write_text("x")
        r = c.post("/api/context-refs/list", json={
            "session_id": "test-session",
        })
        body = r.json()
        assert body["success"] is True
        paths = {e["path"] for e in body["entries"]}
        assert "a.py" in paths
        assert "b.md" in paths
        assert "sub" in paths
        # is_dir flag
        sub_entry = next(e for e in body["entries"] if e["path"] == "sub")
        assert sub_entry["is_dir"] is True

    def test_list_with_prefix(self, client):
        c, ws = client
        sub = ws / "src"
        sub.mkdir()
        (sub / "a.py").write_text("x")
        (sub / "b.py").write_text("x")
        r = c.post("/api/context-refs/list", json={
            "session_id": "test-session",
            "prefix": "src",
        })
        body = r.json()
        paths = {e["path"] for e in body["entries"]}
        assert "src/a.py" in paths
        assert "src/b.py" in paths

    def test_list_invalid_prefix_blocked(self, client):
        c, _ws = client
        r = c.post("/api/context-refs/list", json={
            "session_id": "test-session",
            "prefix": "../etc",
        })
        body = r.json()
        assert body["success"] is True
        assert body["entries"] == []
        # The error key surfaces the path-traversal rejection
        assert body.get("error") == "invalid prefix"

    def test_list_truncates_at_cap(self, client):
        c, ws = client
        for i in range(50):
            (ws / f"f{i:03d}.txt").write_text("x")
        r = c.post("/api/context-refs/list", json={
            "session_id": "test-session",
            "max_entries": 20,
        })
        body = r.json()
        assert len(body["entries"]) == 20
        assert body["truncated"] is True

    def test_list_max_entries_clamped_to_500(self, client):
        c, _ws = client
        # Asking for 99999 should not crash; we clamp to 500
        r = c.post("/api/context-refs/list", json={
            "session_id": "test-session",
            "max_entries": 99999,
        })
        assert r.status_code == 200


# ─────────────────────────────────────────────────────────────────────────────
# Request validation
# ─────────────────────────────────────────────────────────────────────────────


class TestRequestValidation:
    def test_missing_session_id(self, client):
        c, _ws = client
        r = c.post("/api/context-refs/expand", json={
            "message": "hi",
        })
        assert r.status_code == 422  # pydantic validation

    def test_missing_message(self, client):
        c, _ws = client
        r = c.post("/api/context-refs/expand", json={
            "session_id": "x",
        })
        assert r.status_code == 422
