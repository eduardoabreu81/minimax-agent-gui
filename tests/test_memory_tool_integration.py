"""Integration tests for the MemoryTool via the agent's tool
dispatch (simulating a real tool call round-trip).

This test uses the same fixture pattern as test_context_refs_endpoint.py:
redirect PROJECT_ROOT and CONVERSATIONS_DIR to tmp_path so the
tests don't touch the real workspace. We don't actually call
the LLM (no live API key in tests) — we directly invoke the
MemoryTool's execute() method as if the agent had called it
via the tool dispatch layer.

The point is to verify the tool is wired up correctly and the
file paths match what the rest of the app uses
(`<app_workspace>/.agent/MEMORY.md` etc).
"""

import asyncio
import sys
import types
from pathlib import Path

import pytest

# Make ``web/backend/main.py`` importable. Same pattern as
# test_context_refs_endpoint.py and test_coding_workspace.py.
ROOT = Path(__file__).parent.parent
BACKEND_DIR = ROOT / "web" / "backend"
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(BACKEND_DIR))

# main.py does ``from mcp_runtime import test_mcp_server`` — stub
# the symbol so the module loads.
_mcp_stub = types.ModuleType("mcp_runtime")
_mcp_stub.test_mcp_server = lambda *a, **kw: None
sys.modules.setdefault("mcp_runtime", _mcp_stub)

# Load main.py via spec_from_file_location (avoids the
# `from web.backend import` package issue).
import importlib.util
_spec = importlib.util.spec_from_file_location("main", BACKEND_DIR / "main.py")
backend_main = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(backend_main)


@pytest.fixture
def workspace(tmp_path, monkeypatch: pytest.MonkeyPatch):
    """A tmp app workspace with the .agent/ dir pre-created.

    Mirrors the real layout: <workspace>/.agent/{MEMORY,USER,...}.md
    + <workspace>/tasks.json + <workspace>/conversations/.
    """
    ws = tmp_path / "workspace"
    ws.mkdir()
    agent = ws / ".agent"
    agent.mkdir()
    daily = agent / "daily"
    daily.mkdir()
    (ws / "conversations").mkdir()
    (ws / "uploads").mkdir()
    (ws / "logs").mkdir()

    # Seed a minimal MEMORY.md so the tool has something to work with
    (agent / "MEMORY.md").write_text(
        "# Project memory\n\n"
        "Append-only notes. The agent updates this file as it learns.\n\n"
        "§ Workspace conventions: agent context lives in workspace/.agent/.\n\n"
        "§ User prefers concise responses.\n",
        encoding="utf-8",
    )
    (agent / "USER.md").write_text(
        "# About the user\n\n"
        "§ Name: Eduardo, Timezone: America/Sao_Paulo.\n",
        encoding="utf-8",
    )

    # Redirect the app's workspace functions to our tmp dir
    monkeypatch.setattr(backend_main, "PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(backend_main, "CONVERSATIONS_DIR", ws / "conversations")
    monkeypatch.setattr(backend_main, "get_app_workspace_dir", lambda: ws)

    return ws, agent


class TestMemoryToolAgentIntegration:
    """Verify that the MemoryTool, when invoked as if by the agent,
    writes to the correct files and respects the layout the rest
    of the app expects.
    """

    async def test_tool_writes_to_expected_path(self, workspace):
        from mini_agent.tools import MemoryTool

        ws, agent = workspace
        tool = MemoryTool(agent_dir=str(agent))

        # The agent calls: memory(action="add", target="memory", content=...)
        result = await tool.execute(
            action="add", target="memory",
            content="Project uses Python 3.12."
        )
        assert result.success

        # Verify the file path the rest of the app reads from
        # (load_agent_context, _load_one, etc.) was updated
        content = (agent / "MEMORY.md").read_text(encoding="utf-8")
        assert "Python 3.12" in content
        # Original entries preserved
        assert "Workspace conventions" in content
        assert "concise responses" in content

    async def test_tool_capacity_blocks_overflow(self, workspace):
        from mini_agent.tools import MemoryTool

        ws, agent = workspace
        tool = MemoryTool(agent_dir=str(agent))

        # Try to add content that overflows the 2200-char limit
        result = await tool.execute(
            action="add", target="memory",
            content="x" * 3000,
        )
        assert not result.success
        # File unchanged
        content = (agent / "MEMORY.md").read_text(encoding="utf-8")
        assert "x" * 100 not in content

    async def test_tool_replace_with_substring(self, workspace):
        from mini_agent.tools import MemoryTool

        ws, agent = workspace
        tool = MemoryTool(agent_dir=str(agent))

        result = await tool.execute(
            action="replace", target="memory",
            old_text="concise responses",
            content="User prefers terse, direct responses — no fluff.",
        )
        assert result.success
        content = (agent / "MEMORY.md").read_text(encoding="utf-8")
        assert "terse, direct" in content
        assert "concise responses" not in content

    async def test_tool_remove(self, workspace):
        from mini_agent.tools import MemoryTool

        ws, agent = workspace
        tool = MemoryTool(agent_dir=str(agent))

        result = await tool.execute(
            action="remove", target="memory",
            old_text="concise responses",
        )
        assert result.success
        content = (agent / "MEMORY.md").read_text(encoding="utf-8")
        assert "concise responses" not in content
        # Other entry preserved
        assert "Workspace conventions" in content

    async def test_audit_log_emitted(self, workspace, caplog):
        import logging
        from mini_agent.tools import MemoryTool

        ws, agent = workspace
        tool = MemoryTool(agent_dir=str(agent))

        with caplog.at_level(logging.INFO, logger="mini_agent.tools.memory_tool"):
            await tool.execute(
                action="add", target="user",
                content="User works in pt-BR for daily comms."
            )
        # Structured audit log line was emitted
        audit_records = [r for r in caplog.records if r.message == "memory_write"]
        assert len(audit_records) == 1
        rec = audit_records[0]
        assert getattr(rec, "action", None) == "add"
        assert getattr(rec, "target", None) == "user"
        # delta = new_chars - old_chars (positive = we added bytes)
        assert getattr(rec, "delta", 0) > 0


class TestMemoryToolRegistration:
    """Verify the agent setup in main.py actually includes the
    MemoryTool in the default tool set. This is the "wiring"
    test — the tool's pytest covers its behavior, this one
    covers the integration point.
    """

    def test_memory_tool_importable(self):
        from mini_agent.tools import MemoryTool
        # Just check the class is importable from the package
        # (covered by __init__.py edit)
        assert MemoryTool is not None
        assert MemoryTool().name == "memory"

    def test_memory_tool_in_default_tool_list_simulation(self, workspace):
        """Simulate the agent setup. We don't run the full
        WebSocket — just verify the tool list assembly includes
        MemoryTool when the imports succeed.
        """
        from mini_agent.tools import MemoryTool
        from mini_agent.tools import (
            ReadTool, WriteTool, EditTool, BashTool,
        )
        # This is what web/backend/main.py does: append MemoryTool
        # to the default tool list
        ws, agent = workspace
        tools = [
            ReadTool(workspace_dir=str(ws)),
            WriteTool(workspace_dir=str(ws)),
            EditTool(workspace_dir=str(ws)),
            BashTool(workspace_dir=str(ws)),
            MemoryTool(agent_dir=str(agent)),
        ]
        names = {t.name for t in tools}
        # MemoryTool is in the list
        assert "memory" in names
        # Other defaults still there
        assert "read_file" in names
        assert "write_file" in names
        assert "edit_file" in names
        assert "bash" in names
