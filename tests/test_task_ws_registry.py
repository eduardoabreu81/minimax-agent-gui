"""Tests for the WS registry + broadcast_task_event helper.

The registry is a small but critical piece: it determines which
WebSockets receive task_updated events. We test:
  - Register / unregister round-trip
  - Broadcast to the matching source_session_id
  - Broadcast to all sessions when source_session_id is None
  - Dead WS in the bucket is skipped (no error propagates)
"""

import asyncio
import sys
import types
from pathlib import Path

import pytest

# Same import dance as test_context_refs_endpoint.py
ROOT = Path(__file__).parent.parent
BACKEND_DIR = ROOT / "web" / "backend"
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(BACKEND_DIR))
_mcp_stub = types.ModuleType("mcp_runtime")
_mcp_stub.test_mcp_server = lambda *a, **kw: None
sys.modules.setdefault("mcp_runtime", _mcp_stub)

import importlib.util
_spec = importlib.util.spec_from_file_location("main", BACKEND_DIR / "main.py")
backend_main = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(backend_main)

register_ws = backend_main.register_ws
unregister_ws = backend_main.unregister_ws
broadcast_task_event = backend_main.broadcast_task_event


class _FakeWS:
    """Minimal stand-in for a FastAPI WebSocket. Records sends."""

    def __init__(self):
        self.sent: list[dict] = []
        self.closed = False

    async def send_json(self, payload):
        if self.closed:
            raise RuntimeError("WS closed")
        self.sent.append(payload)


class TestRegistry:
    def test_register_and_unregister(self):
        ws = _FakeWS()
        register_ws("sess-1", ws)
        # Inspect internal state via the broadcast helper
        # (the registry itself is private — broadcast is the public API)
        assert "sess-1" in backend_main._ws_registry
        assert ws in backend_main._ws_registry["sess-1"]

        unregister_ws("sess-1", ws)
        # Bucket removed when empty
        assert "sess-1" not in backend_main._ws_registry

    def test_unregister_unknown_session_is_safe(self):
        ws = _FakeWS()
        # Should NOT raise
        unregister_ws("never-registered", ws)

    def test_register_multiple_ws_same_session(self):
        a, b, c = _FakeWS(), _FakeWS(), _FakeWS()
        register_ws("sess-1", a)
        register_ws("sess-1", b)
        register_ws("sess-1", c)
        assert len(backend_main._ws_registry["sess-1"]) == 3
        unregister_ws("sess-1", b)
        assert backend_main._ws_registry["sess-1"] == {a, c}


class TestBroadcast:
    async def test_broadcast_targets_matching_session(self):
        ws_in = _FakeWS()
        ws_out = _FakeWS()
        register_ws("sess-1", ws_in)
        register_ws("sess-2", ws_out)
        try:
            task = {"id": "t1", "title": "X", "source_session_id": "sess-1"}
            await broadcast_task_event(task, "create")
            # ws_in received the event; ws_out did not
            assert len(ws_in.sent) == 1
            assert len(ws_out.sent) == 0
            payload = ws_in.sent[0]
            assert payload["type"] == "task_updated"
            assert payload["action"] == "create"
            assert payload["task"]["id"] == "t1"
        finally:
            unregister_ws("sess-1", ws_in)
            unregister_ws("sess-2", ws_out)

    async def test_broadcast_no_source_goes_to_all(self):
        ws_a, ws_b = _FakeWS(), _FakeWS()
        register_ws("sess-1", ws_a)
        register_ws("sess-2", ws_b)
        try:
            task = {"id": "t1", "title": "X", "source_session_id": None}
            await broadcast_task_event(task, "create")
            # Both received (TaskBoard-created tasks show in every panel)
            assert len(ws_a.sent) == 1
            assert len(ws_b.sent) == 1
        finally:
            unregister_ws("sess-1", ws_a)
            unregister_ws("sess-2", ws_b)

    async def test_dead_ws_does_not_break_broadcast(self):
        ws_dead = _FakeWS()
        ws_dead.closed = True  # send_json will raise
        ws_alive = _FakeWS()
        register_ws("sess-1", ws_dead)
        register_ws("sess-1", ws_alive)
        try:
            task = {"id": "t1", "title": "X", "source_session_id": "sess-1"}
            # Must not raise — the dead WS is silently skipped
            await broadcast_task_event(task, "create")
            # The alive one still got the event
            assert len(ws_alive.sent) == 1
        finally:
            unregister_ws("sess-1", ws_dead)
            unregister_ws("sess-1", ws_alive)

    async def test_no_listeners_is_safe(self):
        # No WS registered for any session → broadcast is a no-op
        task = {"id": "t1", "title": "X", "source_session_id": "nobody"}
        await broadcast_task_event(task, "create")  # should not raise
