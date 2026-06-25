"""Tests for Agent.estimate_by_source() — the per-source token
breakdown that drives the StatusBar popover "Breakdown by source"
section.

The estimator splits the system prompt by ``## `` headers and
categorizes each section by keyword (skills / memory files /
custom agents / MCP tools / default → system_prompt). These tests
exercise each branch with a hand-crafted system prompt and assert
on the resulting dict shape.

Uses the same stub LLM as test_compact_logging.py so we don't
need a real API key. A separate test exercises the tiktoken
fallback path (no encoding available) by patching tiktoken.
"""

import os
import sys
import unittest.mock as mock
from pathlib import Path

# Same path setup as test_compact_logging — keep imports stable
# for the hermes venv.
import pytest

from mini_agent.agent import Agent
from mini_agent.schema import Message

# Resolve PROJECT_ROOT from this test file's location so paths work
# cross-platform without hardcoding any developer-specific path.
PROJECT_ROOT = Path(__file__).resolve().parent.parent
os.environ.setdefault("MINIMAX_PROJECT_ROOT", str(PROJECT_ROOT))
sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(PROJECT_ROOT / "web" / "backend"))

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

class _StubMcpTool:
    """Minimal ExternalMCPTool stub. Has server_id + server_config
    so the per-server bucketing works."""

    def __init__(self, name, server_id, server_name="Test Server",
                 description="A test tool"):
        self.name = name
        self.server_id = server_id
        self.server_config = {"name": server_name}
        self.description = description

    def to_anthropic_schema(self):
        return {
            "name": self.name,
            "description": self.description,
            "input_schema": {"type": "object", "properties": {}},
        }

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
    # 8 source categories + total + limit + details sub-dict +
    # messages_bytes (raw byte size of message content, shown in
    # the StatusBar Messages row — separate from the token count
    # because the user asked for "tamanho em bytes" on Messages
    # specifically, since that's what the conversation weighs in
    # memory/disk, not tokens). free_space was removed in v0.4.x.
    expected = {
        "messages", "skills", "memory_files", "custom_agents",
        "system_prompt", "mcp_tools", "mcp_deferred",
        "system_tools_deferred", "total", "limit",
        "details", "messages_bytes",
    }
    assert set(result.keys()) == expected

def test_details_has_three_lists(agent):
    result = agent.estimate_by_source()
    assert set(result["details"].keys()) == {
        "mcp_tools_list", "memory_files_list", "custom_agents_list",
    }
    # All start as empty lists
    assert result["details"]["mcp_tools_list"] == []
    assert result["details"]["memory_files_list"] == []
    assert result["details"]["custom_agents_list"] == []

def test_estimate_by_source_empty_messages_returns_zero(agent):
    # Agent.__init__ auto-injects a system message with the workspace
    # path, so we need to clear messages first to exercise the
    # truly-empty branch.
    agent.messages = []
    result = agent.estimate_by_source()
    # All categories are zero (limit + total may still reflect the
    # model's context window).
    for key in ("messages", "skills", "memory_files", "custom_agents",
                "system_prompt", "mcp_tools", "mcp_deferred",
                "system_tools_deferred"):
        assert result[key] == 0, f"{key} should be 0 for empty messages"
    assert result["total"] == 0
    assert result["limit"] == 1_000_000  # M3 default from stub
    # free_space key no longer exists — see comment in
    # test_estimate_by_source_returns_known_keys.

def test_total_equals_sum_of_parts(agent):
    """total = sum of all categorized tokens (no free_space, no
    subtraction — total IS the consumed tokens)."""
    agent.messages = [
        Message(role="system", content="base prompt."),
        Message(role="user", content="hello world"),
    ]
    result = agent.estimate_by_source()
    consumed = (
        result["messages"] + result["skills"] + result["memory_files"]
        + result["custom_agents"] + result["system_prompt"]
        + result["mcp_tools"] + result["mcp_deferred"]
        + result["system_tools_deferred"]
    )
    assert result["total"] == consumed

def test_free_space_key_removed(agent):
    """free_space was removed from the breakdown in v0.4.x. Verify
    it's gone so any old frontend code falls back gracefully (no
    silent 10734%-style bugs from picking free_space as the
    dominant row)."""
    agent.messages = [Message(role="system", content="x" * 1000)]
    result = agent.estimate_by_source()
    assert "free_space" not in result

# ─────────────────────────────────────────────────────────────────────────────
# Categorization by section header
# ─────────────────────────────────────────────────────────────────────────────

def test_base_prompt_is_categorized_as_system_prompt(agent):
    """The preamble (before any ## header) goes to `system_prompt`."""
    agent.messages = [Message(role="system", content="You are a helpful AI assistant powered by MiniMax-M3.")]
    result = agent.estimate_by_source()
    assert result["system_prompt"] > 0
    assert result["skills"] == 0
    assert result["memory_files"] == 0

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
    # Base preamble should still be `system_prompt`
    assert result["system_prompt"] > 0

def test_mcp_servers_section_categorized_as_mcp_tools(agent):
    """The `## MCP Servers` section header goes to `mcp_tools`."""
    prompt = (
        "base preamble here.\n\n"
        "## MCP Servers\n\n"
        "Two MCP servers are always available.\n"
    )
    agent.messages = [Message(role="system", content=prompt)]
    result = agent.estimate_by_source()
    assert result["mcp_tools"] > 0

def test_identity_section_goes_to_custom_agents(agent):
    """`## Current Role (IDENTITY.md)` → custom_agents bucket."""
    prompt = (
        "base\n\n"
        "## Current Role (IDENTITY.md)\n\nExpert Python dev.\n"
    )
    agent.messages = [Message(role="system", content=prompt)]
    result = agent.estimate_by_source()
    assert result["custom_agents"] > 0
    # And the details list has an entry
    assert len(result["details"]["custom_agents_list"]) == 1

def test_user_md_section_goes_to_memory_files(agent):
    """`## About the User (USER.md)` → memory_files bucket."""
    prompt = (
        "base\n\n"
        "## About the User (USER.md)\n\nName: Edu.\n"
    )
    agent.messages = [Message(role="system", content=prompt)]
    result = agent.estimate_by_source()
    assert result["memory_files"] > 0
    assert len(result["details"]["memory_files_list"]) == 1

def test_memory_md_section_goes_to_memory_files(agent):
    """Hermes `MEMORY (agent notes)` header (no `##` prefix) is
    detected by the substring match."""
    prompt = (
        "base\n\n"
        "MEMORY (agent notes) [50% — 1000/2000 chars]\n"
        "══════════════════════════════════════════════\n"
        "§ User prefers concise commits.\n"
    )
    agent.messages = [Message(role="system", content=prompt)]
    result = agent.estimate_by_source()
    assert result["memory_files"] > 0

def test_today_session_log_falls_into_system_prompt(agent):
    """The daily log section doesn't have a special keyword — it
    falls into system_prompt (the default bucket)."""
    prompt = (
        "base\n\n"
        "## Today's Session Log (daily/2026-06-24.md)\n\n- 09:00 user: hi\n"
    )
    agent.messages = [Message(role="system", content=prompt)]
    result = agent.estimate_by_source()
    assert result["system_prompt"] > 0

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
# MCP tool details (per-server breakdown)
# ─────────────────────────────────────────────────────────────────────────────

def test_mcp_tools_in_self_tools_are_grouped_by_server(agent):
    """Tools with `server_id` are bucketed into mcp_tools_list,
    grouped by server_id. Built-in tools (no server_id) are skipped."""
    fs_tool = _StubMcpTool(name="read_file", server_id="filesystem",
                            server_name="Local FS")
    gh_tool = _StubMcpTool(name="create_issue", server_id="github",
                            server_name="GitHub API")
    # Reload agent with these tools
    agent2 = Agent(
        llm_client=_StubLLM(),
        system_prompt="base prompt",
        tools=[fs_tool, gh_tool],
        max_steps=1,
        workspace_dir=Path.cwd().as_posix(),
    )
    result = agent2.estimate_by_source()
    by_sid = {t["server_id"]: t for t in result["details"]["mcp_tools_list"]}
    assert "filesystem" in by_sid
    assert "github" in by_sid
    assert by_sid["filesystem"]["name"] == "Local FS"
    assert by_sid["filesystem"]["tool_count"] == 1
    assert by_sid["github"]["tool_count"] == 1
    # mcp_tools bucket also gets the schema tokens
    assert result["mcp_tools"] > 0

def test_builtin_tools_not_counted_in_mcp_tools(agent):
    """Built-in tools (no server_id) shouldn't appear in
    mcp_tools_list or mcp_tools bucket."""

    class _BuiltinTool:
        name = "read_file"
        # Deliberately no server_id attribute
        description = "reads a file"

        def to_anthropic_schema(self):
            return {"name": "read_file", "description": self.description}

    agent2 = Agent(
        llm_client=_StubLLM(),
        system_prompt="base",
        tools=[_BuiltinTool()],
        max_steps=1,
        workspace_dir=Path.cwd().as_posix(),
    )
    result = agent2.estimate_by_source()
    assert result["details"]["mcp_tools_list"] == []
    assert result["mcp_tools"] == 0

# ─────────────────────────────────────────────────────────────────────────────
# Future feature: mcp_deferred + system_tools_deferred (currently always 0)
# ─────────────────────────────────────────────────────────────────────────────

def test_mcp_deferred_is_zero_today(agent):
    """mcp_deferred is a TODO — heuristic not implemented yet.
    Confirm we report 0 so the UI row is honest about it."""
    prompt = (
        "base\n\n"
        "## MCP Servers\n\nlots of tools\n"
    )
    agent.messages = [Message(role="system", content=prompt)]
    result = agent.estimate_by_source()
    assert result["mcp_deferred"] == 0

def test_system_tools_deferred_is_zero_today(agent):
    """system_tools_deferred is a TODO placeholder. Same as
    mcp_deferred — always 0 today."""
    agent.messages = [Message(role="system", content="base")]
    result = agent.estimate_by_source()
    assert result["system_tools_deferred"] == 0

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
    assert result["system_prompt"] > 0
    assert result["messages"] > 0
    assert result["total"] > 0

# ─────────────────────────────────────────────────────────────────────────────
# Backwards-compat: old shape keys are gone
# ─────────────────────────────────────────────────────────────────────────────

def test_old_keys_not_present_in_new_shape(agent):
    """Bumped shape in 0.4.x — old keys `system` and `tools` were
    renamed to `system_prompt` and `mcp_tools` respectively. Verify
    the old names are NOT returned so frontend code can't silently
    fall back to the wrong bucket."""
    result = agent.estimate_by_source()
    assert "system" not in result
    assert "tools" not in result
