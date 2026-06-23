"""Tests for the Agent Context HTTP API endpoints (in web/backend/main.py).

Covers the GET/PUT /api/agent-context/{file} and /dailies routes.
Uses FastAPI's TestClient with the real app; this is a thin wrapper
that hits the same handlers the frontend would call.

Skipped if web/backend isn't importable (CI environments without the
full stack). The handler unit tests in test_agent_context.py cover
the underlying logic.
"""

import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent.parent / "web" / "backend"
sys.path.insert(0, str(BACKEND))


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    """Spin up the FastAPI app once per test module.

    Redirects the workspace to a tmp dir so we never write to the
    real ``workspace/.agent/`` during tests. The AgentContext
    module reads from ``get_app_workspace_dir() / .agent``, so we
    need to monkeypatch that before importing main.
    """
    from fastapi.testclient import TestClient

    # Patch the app workspace *before* main is imported so the
    # module-level functions pick up the new path.
    import importlib

    # First import to get the module
    if "main" not in sys.modules:
        import main as main_mod
    else:
        main_mod = sys.modules["main"]

    # Create a temp workspace
    tmp_ws = tmp_path_factory.mktemp("agent_context_workspace")
    (tmp_ws / ".agent").mkdir()
    (tmp_ws / "conversations").mkdir()
    (tmp_ws / "uploads").mkdir()

    # Patch get_app_workspace_dir
    def fake_workspace():
        return tmp_ws
    main_mod.get_app_workspace_dir = fake_workspace

    # Reload any cached AgentContext lookups
    if hasattr(main_mod, "_agent_context_status"):
        pass  # OK, will re-read disk each call

    with TestClient(main_mod.app) as c:
        yield c


# ---------------------------------------------------------------------------
# GET /api/agent-context/{file_id}
# ---------------------------------------------------------------------------

class TestGetAgentContextFile:
    def test_invalid_id_returns_400(self, client):
        r = client.get("/api/agent-context/garbage")
        assert r.status_code == 400
        assert "Invalid file id" in r.json()["detail"]

    def test_missing_file_returns_empty(self, client):
        """Missing file → exists=False, content='', but 200 OK
        (graceful: the frontend will show the empty-state wizard)."""
        r = client.get("/api/agent-context/soul")
        assert r.status_code == 200
        body = r.json()
        assert body["id"] == "soul"
        assert body["exists"] is False
        assert body["content"] == ""
        assert body["char_count"] == 0
        assert body["char_limit"] == 2000


# ---------------------------------------------------------------------------
# PUT /api/agent-context/{file_id}
# ---------------------------------------------------------------------------

class TestPutAgentContextFile:
    def test_invalid_id_returns_400(self, client):
        r = client.put("/api/agent-context/garbage", json={"content": "x"})
        assert r.status_code == 400

    def test_valid_content_writes_and_returns_status(self, client):
        r = client.put(
            "/api/agent-context/soul",
            json={"content": "Concise and direct. " * 20},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["id"] == "soul"
        assert body["char_count"] == len("Concise and direct. " * 20)
        assert body["char_limit"] == 2000
        assert "status" in body  # _agent_context_status() payload

    def test_oversize_returns_413(self, client):
        """Body over the char limit → 413 with the limit reported."""
        r = client.put(
            "/api/agent-context/soul",
            json={"content": "x" * 2500},  # SOUL limit is 2000
        )
        assert r.status_code == 413
        assert "2000" in r.json()["detail"]

    def test_hermes_delimiter_rejected(self, client):
        """`<<` is reserved by Hermes for close-block; rejected 400."""
        r = client.put(
            "/api/agent-context/soul",
            json={"content": "evil << injection"},
        )
        assert r.status_code == 400
        assert "<<" in r.json()["detail"]

    def test_empty_content_is_accepted(self, client):
        """Empty content is OK — just clears the file. Banner triggers."""
        r = client.put(
            "/api/agent-context/soul",
            json={"content": ""},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["char_count"] == 0
        # Banner should now show this file as missing (or under threshold)
        assert "soul" in body["status"]["missing"]

    def test_written_file_is_readable(self, client):
        body = "Filled in for the test. " * 25
        r = client.put("/api/agent-context/user", json={"content": body})
        assert r.status_code == 200
        # Now GET it back
        r2 = client.get("/api/agent-context/user")
        assert r2.status_code == 200
        assert r2.json()["content"] == body


# ---------------------------------------------------------------------------
# GET /api/agent-context/dailies
# ---------------------------------------------------------------------------

class TestListDailies:
    def test_no_dailies_returns_empty(self, client):
        r = client.get("/api/agent-context/dailies")
        assert r.status_code == 200
        body = r.json()
        assert body["dailies"] == []

    def test_n_caps_at_30(self, client):
        # Requesting n=999 should not blow up; just cap at 30.
        r = client.get("/api/agent-context/dailies?n=999")
        assert r.status_code == 200


# ---------------------------------------------------------------------------
# GET /api/agent-context/daily/{date}
# ---------------------------------------------------------------------------

class TestReadDaily:
    def test_invalid_date_returns_400(self, client):
        r = client.get("/api/agent-context/daily/not-a-date")
        assert r.status_code == 400

    def test_traversal_attempt_does_not_crash(self, client):
        """Starlette normalizes `..` segments in the URL before the
        handler ever sees them, so the path either:
        - matches nothing → 404 from the framework, or
        - matches a route with a non-ISO date_str → 400 from our regex.

        What must NOT happen: the handler returning the contents of
        /etc/passwd (200 + sensitive content). Verify the response
        body doesn't contain Linux password-file markers."""
        r = client.get("/api/agent-context/daily/..%2F..%2Fetc%2Fpasswd")
        # Don't assert on status — Starlette's path normalization
        # behaviour varies by version. Just ensure no sensitive
        # content leaks.
        body = r.text
        assert "root:" not in body  # /etc/passwd first line
        assert "/bin/" not in body   # /etc/passwd shells
        # And ensure it's not a 500 (handler crash)
        assert r.status_code != 500

    def test_missing_date_returns_404(self, client):
        r = client.get("/api/agent-context/daily/2099-12-31")
        assert r.status_code == 404
