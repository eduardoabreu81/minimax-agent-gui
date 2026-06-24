"""Tests for Agent.estimate_by_source() — the per-source token
breakdown that drives the StatusBar popover "Breakdown by source"
section.

The estimator splits the system prompt by ``## `` headers and
categorizes each section by keyword (skills / tools / default →
system). These tests exercise each branch with a hand-crafted
system prompt and assert on the resulting dict shape.

Uses the same stub LLM as test_compact_logging.py so we don't
need a real API key. A separate test exercises the tiktoken
fallback path (no encoding available) by patching tiktoken.
"""

import sys
import unittest.mock as mock
from pathlib import Path

# Same path setup as test_compact_logging — keep imports stable
# for the hermes venv.
sys.path.insert(0, r"C:\Users\Eduardo\OneDrive\Documentos\GitHub\minimax-agent-gui")

import pytest

from mini_agent.agent import Agent
from mini_agent.schema import Message


class _StubLLM:
    """Minimal LLM stub. MODEL_CONTEXT_LIMITS exposes the M3
    1M-context limit so the Agent init resolves it."""

    model = "MiniMax-M3"
    MODEL_CONTEXT_LIMITS = {"MiniMax-M3": 1_000_000, "MiniMax-M2.7": 200_000}
    DEFAULT_CONTEXT_LIMIT = 200_000

    def generate(self, *args, **kwargs):  # pragma: no cover
        raise NotImplementedError

    async def aclose(self):  # pragma: no cover
        pass


def _make_agent(system_prompt: str = "default system"):
    return Agent(
        llm_client=_StubLLM(),
        system_prompt="ignored — we override messages directly",
        tools=[],
        max_steps=1,
        workspace_dir=Path.cwd().as_posix(),
    ).__class__  # placeholder, replaced below


@pytest.fixture
def agent():
    """Build an Agent with no messages yet; tests can set messages directly."""
    return Agent(
        llm_client=_StubLLM(),
        system_prompt="ignored",
        tools=[],
        max_steps=1,
        workspace_dir=Path.cwd().as_posix(),
    )


# ─────────────────────────────────────────────────────────────────────────────
# Shape and basic invariants
# ─────────────────────────────────────────────────────────────────────────────


def test_estimate_by_source_returns_known_keys(agent):
    result = agent.estimate_by_source()
    assert set(result.keys()) == {
        "system", "skills", "tools", "messages", "mcp_deferred", "total",
    }


def test_estimate_by_source_empty_messages_returns_zero(agent):
    # Agent.__init__ auto-injects a system message with the workspace
    # path, so we need to clear messages first to exercise the
    # truly-empty branch.
    agent.messages = []
    result = agent.estimate_by_source()
    assert result["system"] == 0
    assert result["skills"] == 0
    assert result["tools"] == 0
    assert result["messages"] == 0
    assert result["mcp_deferred"] == 0
    assert result["total"] == 0


def test_total_equals_sum_of_parts(agent):
    agent.messages = [
        Message(role="system", content="base prompt."),
        Message(role="user", content="hello world"),
    ]
    result = agent.estimate_by_source()
    assert result["total"] == (
        result["system"] + result["skills"] + result["tools"]
        + result["messages"] + result["mcp_deferred"]
    )


# ─────────────────────────────────────────────────────────────────────────────
# Categorization by section header
# ─────────────────────────────────────────────────────────────────────────────


def test_system_prompt_base_prompt_is_categorized_as_system(agent):
    """The preamble (before any ## header) goes to `system`."""
    agent.messages = [Message(role="system", content="You are a helpful AI assistant powered by MiniMax-M3.")]
    result = agent.estimate_by_source()
    assert result["system"] > 0
    assert result["skills"] == 0
    assert result["tools"] == 0


def test_skills_section_categorized_via_header(agent):
    """A section whose header mentions 'skill' goes to `skills`."""
    prompt = (
        "You are Mini-Agent.\n\n"
        "## Available Skills\n\n"
        "- pdf — generate PDFs\n"
        "- pptx — generate slides\n"
    )
    agent.messages = [Message(role="system", content=prompt)]
    result = agent.estimate_by_source()
    assert result["skills"] > 0
    # Base preamble should still be `system`
    assert result["system"] > 0


def test_custom_mcp_tools_section_categorized_as_tools(agent):
    prompt = (
        "base preamble here.\n\n"
        "## Custom MCP Tools\n\n"
        "Additional MCP tools are available from user-configured MCP servers.\n"
    )
    agent.messages = [Message(role="system", content=prompt)]
    result = agent.estimate_by_source()
    assert result["tools"] > 0
    assert result["skills"] == 0


def test_agent_context_sections_fall_into_system(agent):
    """SOUL / IDENTITY / USER / MEMORY / daily sections all default
    to `system` (no special keyword)."""
    prompt = (
        "base\n\n"
        "## Current Role (IDENTITY.md)\n\nExpert Python dev.\n\n"
        "## About the User (USER.md)\n\nName: Edu.\n\n"
        "## Today's Session Log (daily/2026-06-24.md)\n\n- 09:00 user: hi\n"
    )
    agent.messages = [Message(role="system", content=prompt)]
    result = agent.estimate_by_source()
    # All sections fall into system
    assert result["system"] > 0
    assert result["skills"] == 0
    assert result["tools"] == 0


def test_messages_contribute_to_messages_bucket(agent):
    """messages[1:] (history) goes to `messages`."""
    agent.messages = [
        Message(role="system", content="base"),
        Message(role="user", content="hello there"),
        Message(role="assistant", content="hi back"),
    ]
    result = agent.estimate_by_source()
    assert result["messages"] > 0


# ─────────────────────────────────────────────────────────────────────────────
# Future feature: mcp_deferred (currently always 0)
# ─────────────────────────────────────────────────────────────────────────────


def test_mcp_deferred_is_zero_today(agent):
    """mcp_deferred is a TODO — heuristic not implemented yet.
    Confirm we report 0 so the UI row is honest about it."""
    prompt = (
        "base\n\n"
        "## Custom MCP Tools\n\nlots of tools\n"
    )
    agent.messages = [Message(role="system", content=prompt)]
    result = agent.estimate_by_source()
    assert result["mcp_deferred"] == 0


# ─────────────────────────────────────────────────────────────────────────────
# Fallback when tiktoken is unavailable
# ─────────────────────────────────────────────────────────────────────────────


def test_fallback_estimation_works_when_tiktoken_init_fails(agent):
    """If tiktoken.get_encoding raises, the estimator should still
    produce sensible numbers using the ~2.5 chars/token fallback."""
    agent.messages = [
        Message(role="system", content="A" * 250),  # ~100 tokens fallback
        Message(role="user", content="B" * 50),      # ~20 tokens fallback
    ]
    with mock.patch("tiktoken.get_encoding", side_effect=Exception("no encoder")):
        result = agent.estimate_by_source()
    # Numbers should be > 0 even without tiktoken
    assert result["system"] > 0
    assert result["messages"] > 0
    assert result["total"] > 0
