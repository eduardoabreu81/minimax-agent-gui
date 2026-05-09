"""MCP external tool wrapper for agent integration.

Loads tools from user-configured MCP servers and exposes them as normal
agent Tool instances with prefixed names to avoid collisions.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
from typing import Any

from mcp import ClientSession
from mcp.client.stdio import stdio_client, StdioServerParameters
from mcp.client.sse import sse_client

# Import from project root (main.py adds it to sys.path)
from mini_agent.tools.base import Tool, ToolResult

_logger = logging.getLogger(__name__)

# Timeout for a single tool execution through MCP
EXEC_TIMEOUT_SECONDS = 30


def _sanitize(text: str) -> str:
    """Replace non-alphanumeric chars with underscores."""
    return re.sub(r"[^a-zA-Z0-9]", "_", text)


def _make_safe_tool_name(server_id: str, tool_name: str) -> str:
    """Create a unique, safe tool name: mcp_{server_id}_{tool_name}."""
    safe_server = _sanitize(server_id)
    safe_tool = _sanitize(tool_name)
    name = f"mcp_{safe_server}_{safe_tool}"
    # Cap length to keep LLM tool names reasonable
    if len(name) > 64:
        name = name[:64]
    return name


def _deduplicate_names(tools: list[Tool]) -> list[Tool]:
    """Append numeric suffixes if any tool names still collide."""
    seen: dict[str, int] = {}
    for tool in tools:
        original = tool.name
        count = seen.get(original, 0)
        if count > 0:
            # This shouldn't happen often because of server_id prefix,
            # but handle edge cases (same server, same tool name after sanitization)
            new_name = f"{original}_{count}"
            tool._name_override = new_name  # type: ignore[attr-defined]
            _logger.warning(f"MCP tool name collision resolved: {original} -> {new_name}")
        seen[original] = count + 1
    return tools


class ExternalMCPTool(Tool):
    """Wraps an MCP tool as an agent Tool.

    Opens a fresh connection per execution (simple and robust for MVP).
    """

    def __init__(
        self,
        server_id: str,
        server_config: dict[str, Any],
        tool_metadata: dict[str, Any],
    ):
        self._server_id = server_id
        self._server_config = server_config
        self._original_name = tool_metadata["name"]
        self._tool_description = tool_metadata.get("description", "")
        self._input_schema = tool_metadata.get("input_schema") or {"type": "object", "properties": {}}

        self._safe_name = _make_safe_tool_name(server_id, self._original_name)
        self._name_override: str | None = None

    @property
    def name(self) -> str:
        return self._name_override or self._safe_name

    @property
    def description(self) -> str:
        server_name = self._server_config.get("name", self._server_id)
        original = self._original_name
        desc = self._tool_description
        return f"MCP tool from {server_name}: {original}. {desc}"

    @property
    def parameters(self) -> dict[str, Any]:
        return self._input_schema

    async def execute(self, **kwargs: Any) -> ToolResult:
        """Execute the MCP tool via a fresh connection."""
        transport = self._server_config.get("transport", "stdio")
        try:
            if transport == "stdio":
                return await self._execute_stdio(kwargs)
            if transport == "sse":
                return await self._execute_sse(kwargs)
            return ToolResult(
                success=False,
                error=f"Transport '{transport}' not supported for MCP tool execution.",
            )
        except asyncio.TimeoutError:
            return ToolResult(
                success=False,
                error=f"MCP tool '{self._original_name}' timed out after {EXEC_TIMEOUT_SECONDS}s.",
            )
        except Exception as exc:
            _logger.warning(f"MCP tool '{self._original_name}' execution error: {exc}")
            return ToolResult(success=False, error=str(exc))

    async def _execute_stdio(self, arguments: dict[str, Any]) -> ToolResult:
        command = self._server_config.get("command")
        if not command:
            return ToolResult(success=False, error="Missing 'command' for stdio transport.")

        env = {**os.environ, **self._server_config.get("env", {})}
        params = StdioServerParameters(
            command=command,
            args=self._server_config.get("args", []),
            env=env,
        )

        async def _call() -> ToolResult:
            async with stdio_client(params) as (read, write):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    result = await session.call_tool(
                        self._original_name,
                        arguments=arguments or {},
                    )
                    return self._parse_result(result)

        return await asyncio.wait_for(_call(), timeout=EXEC_TIMEOUT_SECONDS)

    async def _execute_sse(self, arguments: dict[str, Any]) -> ToolResult:
        url = self._server_config.get("url")
        if not url:
            return ToolResult(success=False, error="Missing 'url' for sse transport.")

        headers = self._server_config.get("headers", {})

        async def _call() -> ToolResult:
            async with sse_client(url, headers=headers, timeout=EXEC_TIMEOUT_SECONDS) as (read, write):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    result = await session.call_tool(
                        self._original_name,
                        arguments=arguments or {},
                    )
                    return self._parse_result(result)

        return await asyncio.wait_for(_call(), timeout=EXEC_TIMEOUT_SECONDS)

    def _parse_result(self, result: Any) -> ToolResult:
        """Parse MCP CallToolResult into ToolResult."""
        if getattr(result, "isError", False):
            texts = []
            for item in getattr(result, "content", []):
                if hasattr(item, "text"):
                    texts.append(item.text)
            return ToolResult(success=False, error="\n".join(texts) or "MCP tool returned an error.")

        texts = []
        for item in getattr(result, "content", []):
            if hasattr(item, "text"):
                texts.append(item.text)
        return ToolResult(success=True, content="\n".join(texts))


async def discover_mcp_tools(
    server_id: str,
    server_config: dict[str, Any],
    timeout_seconds: int = 10,
) -> list[dict[str, Any]]:
    """Discover tools from a single MCP server. Returns list of tool metadata dicts."""
    from mcp_runtime import test_mcp_server

    server = {"id": server_id, **server_config}
    result = await test_mcp_server(server, timeout_seconds=timeout_seconds)
    if result.get("success"):
        return result.get("tools", [])
    _logger.warning(f"MCP discovery failed for '{server_id}': {result.get('error')}")
    return []


async def load_mcp_tools_for_agent(cfg: dict[str, Any]) -> list[Tool]:
    """Load all enabled MCP server tools as agent Tool instances.

    Args:
        cfg: The full config dict (should contain 'mcp_servers').

    Returns:
        List of ExternalMCPTool instances ready to pass to Agent.
    """
    servers = cfg.get("mcp_servers", {})
    if not isinstance(servers, dict):
        return []

    all_tools: list[Tool] = []
    for server_id, server_config in servers.items():
        if not isinstance(server_config, dict):
            continue
        if not server_config.get("enabled", True):
            continue

        try:
            tools_meta = await discover_mcp_tools(server_id, server_config)
            if tools_meta:
                for meta in tools_meta:
                    all_tools.append(
                        ExternalMCPTool(
                            server_id=server_id,
                            server_config=server_config,
                            tool_metadata=meta,
                        )
                    )
                _logger.info(
                    f"MCP server '{server_id}' loaded {len(tools_meta)} tool(s) into agent"
                )
            else:
                _logger.info(f"MCP server '{server_id}' has no tools or discovery failed")
        except Exception as exc:
            _logger.warning(f"MCP server '{server_id}' tool loading failed: {exc}")
            # Continue — broken server must not break the agent

    _deduplicate_names(all_tools)
    return all_tools
