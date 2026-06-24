"""Tests for the structured compact-event logging.

Covers:
  - Backend-trigger force (api_pct >= 90%): emits `started` with
    compact_reason=force.
  - Backend-trigger auto (api_pct >= 80%, toggle ON): emits `started`
    with compact_reason=auto.
  - Backend-trigger legacy (above token_limit but below pct thresholds):
    emits `started` with compact_reason=legacy.
  - No trigger (pct below all thresholds): emits nothing.
  - Completed event includes delta_tokens and delta_pct.
  - Failed event is emitted when _create_summary raises.
  - The helper itself emits a single JSON line via _logger.info.
  - The _log_compact_event helper in web/backend/main.py emits JSON
    for frontend-triggered events.

These tests use a stub LLM (no API key required) and capture the
``mini_agent.agent`` logger output to assert on the JSON-encoded event
lines. The frontend helper is unit-tested by mocking
``_logger.info`` directly.
"""

import json
import logging
import os
import sys
import tempfile
import unittest.mock as mock
from io import StringIO
from pathlib import Path

os.environ.setdefault(
    "MINIMAX_PROJECT_ROOT",
    r"C:\Users\Eduardo\OneDrive\Documentos\GitHub\minimax-agent-gui",
)
sys.path.insert(0, r"C:\Users\Eduardo\OneDrive\Documentos\GitHub\minimax-agent-gui")
sys.path.insert(0, r"C:\Users\Eduardo\OneDrive\Documentos\GitHub\minimax-agent-gui\web\backend")

import pytest

from mini_agent.agent import Agent
from mini_agent.schema import Message


class _StubLLM:
    """Minimal LLM stub — exposes only what Agent.__init__ / _summarize_messages
    need. Avoids loading the real LLMClient (which would require an API key)."""

    model = "MiniMax-M3"
    # MODEL_CONTEXT_LIMITS must exist on the LLM client (or the Agent
    # falls back to 200K). M3 = 1M is the realistic limit.
    MODEL_CONTEXT_LIMITS = {"MiniMax-M3": 1_000_000, "MiniMax-M2.7": 200_000}
    DEFAULT_CONTEXT_LIMIT = 200_000

    def generate(self, *args, **kwargs):  # pragma: no cover
        raise NotImplementedError

    async def aclose(self):  # pragma: no cover
        pass


def _make_agent(**overrides):
    """Build an Agent with a stub LLM and a temp workspace."""
    defaults = dict(
        llm_client=_StubLLM(),
        system_prompt="system",
        tools=[],
        max_steps=1,
        workspace_dir=tempfile.mkdtemp(prefix="compact_log_test_"),
        token_limit=80_000,
        auto_compact=True,
        compact_at_pct=0.8,
        force_compact_at_pct=0.9,
        session_id="test-session-123",
    )
    defaults.update(overrides)
    return Agent(**defaults)


def _attach_capture():
    """Return (handler, buffer) and attach the handler to the agent logger."""
    buf = StringIO()
    handler = logging.StreamHandler(buf)
    handler.setLevel(logging.INFO)
    handler.setFormatter(logging.Formatter("%(message)s"))
    root = logging.getLogger("mini_agent.agent")
    root.addHandler(handler)
    root.setLevel(logging.INFO)
    return handler, buf


def _detach_capture(handler):
    root = logging.getLogger("mini_agent.agent")
    root.removeHandler(handler)


def _parse_events(buf: StringIO) -> list[dict]:
    """Return the JSON event lines captured by the agent logger."""
    events = []
    for line in buf.getvalue().splitlines():
        line = line.strip()
        if not line or not line.startswith("{"):
            continue
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            pass
    return events


# ─────────────────────────────────────────────────────────────────────────────
# Agent._summarize_messages — backend-triggered paths
# ─────────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_force_compact_emits_started_with_force_reason():
    handler, buf = _attach_capture()
    try:
        agent = _make_agent()
        limit = agent.model_context_limit
        # 95% of the M3 context window — well above the 90% force threshold
        agent.api_total_tokens = int(limit * 0.95)
        await agent._summarize_messages()

        events = _parse_events(buf)
        started = [e for e in events if e.get("event") == "started"]
        assert len(started) == 1
        s = started[0]
        assert s["triggered_by"] == "backend"
        assert s["compact_reason"] == "force"
        assert s["before_tokens"] == int(limit * 0.95)
        assert 0.9 < s["pct_before"] < 1.0
        assert "compact_id" in s and len(s["compact_id"]) == 12
        assert s["session_id"] == "test-session-123"
        assert s["model"] == "MiniMax-M3"
    finally:
        _detach_capture(handler)


@pytest.mark.asyncio
async def test_auto_compact_emits_started_with_auto_reason():
    handler, buf = _attach_capture()
    try:
        agent = _make_agent()
        limit = agent.model_context_limit
        # 85% — above 80% auto threshold, below 90% force
        agent.api_total_tokens = int(limit * 0.85)
        await agent._summarize_messages()

        events = _parse_events(buf)
        started = [e for e in events if e.get("event") == "started"]
        assert len(started) == 1
        assert started[0]["triggered_by"] == "backend"
        assert started[0]["compact_reason"] == "auto"
    finally:
        _detach_capture(handler)


@pytest.mark.asyncio
async def test_legacy_floor_emits_started_with_legacy_reason():
    handler, buf = _attach_capture()
    try:
        # token_limit=1000 + api_total_tokens=5000 → triggers legacy
        # floor but is far below 80% of the 1M context window.
        agent = _make_agent(token_limit=1_000)
        agent.api_total_tokens = 5_000
        await agent._summarize_messages()

        events = _parse_events(buf)
        started = [e for e in events if e.get("event") == "started"]
        assert len(started) == 1
        assert started[0]["compact_reason"] == "legacy"
    finally:
        _detach_capture(handler)


@pytest.mark.asyncio
async def test_force_wins_over_auto_when_both_apply():
    handler, buf = _attach_capture()
    try:
        agent = _make_agent()
        limit = agent.model_context_limit
        # 95% — both force (90%) and auto (80%) match; force wins.
        agent.api_total_tokens = int(limit * 0.95)
        await agent._summarize_messages()

        events = _parse_events(buf)
        started = [e for e in events if e.get("event") == "started"]
        assert len(started) == 1
        assert started[0]["compact_reason"] == "force"
    finally:
        _detach_capture(handler)


@pytest.mark.asyncio
async def test_no_trigger_emits_no_started_event():
    handler, buf = _attach_capture()
    try:
        agent = _make_agent()
        agent.api_total_tokens = 100  # well below every threshold
        await agent._summarize_messages()

        events = _parse_events(buf)
        started = [e for e in events if e.get("event") == "started"]
        assert started == []
    finally:
        _detach_capture(handler)


@pytest.mark.asyncio
async def test_completed_event_has_delta_fields():
    """When the summarization loop completes, `completed` event is emitted
    with delta_tokens and delta_pct populated."""
    handler, buf = _attach_capture()
    try:
        agent = _make_agent()
        # Need user + assistant + user so the loop has execution messages
        # to summarize between them (2 consecutive users = 0 execution
        # messages, the loop skips without creating a summary).
        agent.messages.append(Message(role="user", content="hello"))
        agent.messages.append(Message(role="assistant", content="hi back"))
        agent.messages.append(Message(role="user", content="world"))
        limit = agent.model_context_limit
        before = int(limit * 0.95)
        agent.api_total_tokens = before

        # Stub _create_summary to a no-op so the loop completes quickly.
        async def _noop_summary(messages, round_num):
            return "summary text"
        agent._create_summary = _noop_summary

        await agent._summarize_messages()

        events = _parse_events(buf)
        started = next(e for e in events if e["event"] == "started")
        completed = next(e for e in events if e["event"] == "completed")

        assert completed["compact_id"] == started["compact_id"]
        assert completed["triggered_by"] == "backend"
        assert completed["compact_reason"] == "force"
        assert completed["before_tokens"] == before
        assert "after_tokens" in completed
        assert "delta_tokens" in completed
        assert "delta_pct" in completed
        assert completed["summaries_created"] == 1
    finally:
        _detach_capture(handler)


@pytest.mark.asyncio
async def test_failed_event_emitted_on_exception():
    """When the summarization loop raises, `failed` event is emitted
    with error and error_type populated, then the exception re-raises."""
    handler, buf = _attach_capture()
    try:
        agent = _make_agent()
        agent.messages.append(Message(role="user", content="hello"))
        agent.messages.append(Message(role="assistant", content="hi back"))
        agent.messages.append(Message(role="user", content="world"))
        limit = agent.model_context_limit
        agent.api_total_tokens = int(limit * 0.95)

        with mock.patch.object(
            agent, "_create_summary", side_effect=RuntimeError("boom")
        ):
            with pytest.raises(RuntimeError):
                await agent._summarize_messages()

        events = _parse_events(buf)
        started = [e for e in events if e["event"] == "started"]
        failed = [e for e in events if e["event"] == "failed"]
        completed = [e for e in events if e["event"] == "completed"]

        assert len(started) == 1
        assert len(failed) == 1
        assert completed == []  # never reached

        f = failed[0]
        assert f["compact_id"] == started[0]["compact_id"]
        assert f["triggered_by"] == "backend"
        assert f["error"] == "boom"
        assert f["error_type"] == "RuntimeError"
    finally:
        _detach_capture(handler)


@pytest.mark.asyncio
async def test_session_id_propagated_when_set():
    """When Agent.session_id is set, it appears in every emitted event."""
    handler, buf = _attach_capture()
    try:
        agent = _make_agent(session_id="abc-def-123")
        agent.messages.append(Message(role="user", content="hi"))
        limit = agent.model_context_limit
        agent.api_total_tokens = int(limit * 0.95)

        async def _noop(messages, n):
            return "ok"
        agent._create_summary = _noop

        await agent._summarize_messages()
        events = _parse_events(buf)
        for e in events:
            if e.get("event") in ("started", "completed"):
                assert e["session_id"] == "abc-def-123"
    finally:
        _detach_capture(handler)


# ─────────────────────────────────────────────────────────────────────────────
# _log_compact_event helper
# ─────────────────────────────────────────────────────────────────────────────


def test_log_compact_event_helper_emits_valid_json():
    """_log_compact_event echoes payload as a single JSON line on _logger.info."""
    agent = _make_agent()
    with mock.patch.object(logging.Logger, "info") as info_mock:
        agent._log_compact_event(
            event="completed",
            compact_id="abc123",
            triggered_by="frontend",
            before_tokens=100,
            after_tokens=50,
            delta_tokens=50,
            delta_pct=0.05,
        )
        assert info_mock.called
        # First positional arg is the JSON string
        payload = json.loads(info_mock.call_args[0][0])
        assert payload["event"] == "completed"
        assert payload["compact_id"] == "abc123"
        assert payload["session_id"] == "test-session-123"
        assert payload["model"] == "MiniMax-M3"
        assert payload["delta_tokens"] == 50


def test_log_compact_event_main_py_helper():
    """The companion helper in web/backend/main.py emits a single JSON line.
    Imported lazily because main.py has heavy top-level imports."""
    import importlib
    main = importlib.import_module("main")
    with mock.patch.object(main._logger, "info") as info_mock:
        main._log_compact_event({
            "event": "started",
            "compact_id": "xyz789",
            "session_id": "sess-42",
            "triggered_by": "frontend",
            "model": "MiniMax-M3",
            "before_tokens": 950_000,
            "pct_before": 0.95,
        })
        assert info_mock.called
        payload = json.loads(info_mock.call_args[0][0])
        assert payload["event"] == "started"
        assert payload["compact_id"] == "xyz789"
        assert payload["session_id"] == "sess-42"
        assert payload["triggered_by"] == "frontend"
        assert payload["before_tokens"] == 950_000
        assert payload["pct_before"] == 0.95
