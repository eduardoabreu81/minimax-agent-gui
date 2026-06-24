"""Tests for _build_mcp_section() — the unified MCP Servers block
that gets injected into the agent's system prompt.

The section shape mirrors the Settings panel: a top-level
``## MCP Servers`` header with two sub-blocks:
  - ``### MiniMax (built-in)`` — always present, lists the 2
    MiniMax servers
  - ``### Custom (user-configured)`` — only emitted when at
    least one user-configured MCP server produced tools

We test the pure function (not the full session bootstrap) so
the assertions don't need a real LLM client, real config
file, or real WebSocket connection.
"""

import sys

# Path setup — same shape as the other test files in this repo.
sys.path.insert(0, r"C:\Users\Eduardo\OneDrive\Documentos\GitHub\minimax-agent-gui")
sys.path.insert(0, r"C:\Users\Eduardo\OneDrive\Documentos\GitHub\minimax-agent-gui\web\backend")

import pytest

import main as backend_main
from main import _build_mcp_section


# ─────────────────────────────────────────────────────────────────────────────
# Stubs for ExternalMCPTool
# ─────────────────────────────────────────────────────────────────────────────


class _StubMcpTool:
    """Minimal ExternalMCPTool stub — only the attributes the section
    builder reads (server_id, server_config)."""

    def __init__(self, server_id, server_config, name="stub"):
        self.server_id = server_id
        self.server_config = server_config
        self.name = name
        self.description = f"stub tool for {server_id}"


# ─────────────────────────────────────────────────────────────────────────────
# Shape — the section header + MiniMax sub-block are always present
# ─────────────────────────────────────────────────────────────────────────────


def test_section_starts_with_unified_header():
    result = _build_mcp_section([])
    assert result.startswith("\n\n## MCP Servers\n")


def test_section_always_contains_minimax_subblock():
    result = _build_mcp_section([])
    assert "### MiniMax (built-in)" in result
    # Both MiniMax servers documented
    assert "**web_search**" in result
    assert "**understand_image**" in result


def test_section_explains_minimax_endpoint_inheritance():
    result = _build_mcp_section([])
    assert "MiniMax coding-plan endpoint" in result
    # And explains the toggle-off behavior so the agent
    # doesn't get confused if a tool is missing.
    assert "toggled one off" in result


# ─────────────────────────────────────────────────────────────────────────────
# Custom sub-block — only present when at least one tool is loaded
# ─────────────────────────────────────────────────────────────────────────────


def test_no_custom_subblock_when_mcp_tools_empty():
    result = _build_mcp_section([])
    assert "### Custom (user-configured)" not in result
    # The MiniMax sub-block IS still there
    assert "### MiniMax (built-in)" in result


def test_no_custom_subblock_when_all_tools_lack_server_id():
    # Defensive: if every tool has server_id == None (or empty
    # string) we treat the list as effectively empty and don't
    # emit the Custom sub-block. Guards against a malformed
    # loader returning a list of useless stubs.
    no_id = _StubMcpTool(server_id=None, server_config={"name": "x"})
    blank_id = _StubMcpTool(server_id="", server_config={"name": "y"})
    result = _build_mcp_section([no_id, blank_id])
    assert "### Custom (user-configured)" not in result


def test_custom_subblock_emitted_when_server_has_tools():
    filesystem = _StubMcpTool(
        server_id="filesystem",
        server_config={"name": "Local Filesystem"},
        name="read_file",
    )
    result = _build_mcp_section([filesystem])
    assert "### Custom (user-configured)" in result
    assert "**filesystem**" in result
    assert "Local Filesystem" in result
    assert "1 tool(s)" in result


def test_custom_subblock_groups_tools_per_server():
    fs1 = _StubMcpTool("filesystem", {"name": "Local FS"}, "read_file")
    fs2 = _StubMcpTool("filesystem", {"name": "Local FS"}, "write_file")
    fs3 = _StubMcpTool("filesystem", {"name": "Local FS"}, "list_dir")
    gh1 = _StubMcpTool("github", {"name": "GitHub API"}, "create_issue")
    gh2 = _StubMcpTool("github", {"name": "GitHub API"}, "list_repos")
    result = _build_mcp_section([fs1, fs2, fs3, gh1, gh2])
    assert "**filesystem** (Local FS) — 3 tool(s)" in result
    assert "**github** (GitHub API) — 2 tool(s)" in result


def test_custom_subblock_falls_back_to_server_id_when_name_missing():
    """If the user config didn't supply a `name` for the server,
    fall back to the server_id (matches Settings panel behavior)."""
    tool = _StubMcpTool(
        server_id="anon-server",
        server_config={},  # no name
    )
    result = _build_mcp_section([tool])
    # Should NOT show "(None)" or "(anon-server)" — just the id alone
    assert "**anon-server** (anon-server)" not in result
    assert "**anon-server**" in result


def test_custom_subblock_documents_tool_name_prefix():
    """The agent should know how custom tool names are prefixed
    so it can call them correctly."""
    tool = _StubMcpTool("filesystem", {"name": "Local FS"}, "read_file")
    result = _build_mcp_section([tool])
    assert "mcp_{server_id}_" in result
    assert "Use them when relevant" in result


def test_custom_subblock_warns_about_failed_servers():
    """If a server is listed but no tools come back at call time,
    the section tells the agent to report the failure rather
    than retrying blindly."""
    tool = _StubMcpTool("filesystem", {"name": "Local FS"}, "read_file")
    result = _build_mcp_section([tool])
    assert "failed to start" in result
    assert "report the failure" in result


# ─────────────────────────────────────────────────────────────────────────────
# Defensive — bad input shouldn't crash
# ─────────────────────────────────────────────────────────────────────────────


def test_handles_none_mcp_tools_argument():
    result = _build_mcp_section(None)
    # Behaves like empty list: no Custom sub-block, but the
    # MiniMax sub-block IS still there.
    assert "### Custom (user-configured)" not in result
    assert "### MiniMax (built-in)" in result


def test_handles_tool_without_server_config_attribute():
    class _BareTool:
        server_id = "bare-server"
    result = _build_mcp_section([_BareTool()])
    assert "**bare-server**" in result
    # No name attribute → falls back to the server_id
    assert "**bare-server** (bare-server)" not in result


# ─────────────────────────────────────────────────────────────────────────────
# Sanity — the function is the one main.py actually calls
# ─────────────────────────────────────────────────────────────────────────────


def test_function_is_exported_from_backend_main():
    """If main.py renames or refactors _build_mcp_section, the
    test should fail loudly so we don't ship a broken system
    prompt builder."""
    assert hasattr(backend_main, "_build_mcp_section")
    assert callable(backend_main._build_mcp_section)
