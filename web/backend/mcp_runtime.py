"""MCP runtime helpers for connection testing and tool discovery."""

from __future__ import annotations

import asyncio
import os
from typing import Any

from mcp import ClientSession
from mcp.client.stdio import stdio_client, StdioServerParameters
from mcp.client.sse import sse_client


async def test_mcp_server(
    server: dict[str, Any],
    timeout_seconds: int = 10,
) -> dict[str, Any]:
    """Test connectivity to an MCP server and return its tool list."""
    server_id = server.get("id", "unknown")
    transport = server.get("transport", "stdio")

    try:
        if transport == "stdio":
            return await _test_stdio_server(server, server_id, timeout_seconds)
        if transport == "sse":
            return await _test_sse_server(server, server_id, timeout_seconds)
        return {
            "success": False,
            "server_id": server_id,
            "error": f"Transport '{transport}' is not supported. Use 'stdio' or 'sse'.",
        }
    except asyncio.TimeoutError:
        return {
            "success": False,
            "server_id": server_id,
            "error": f"Connection timed out after {timeout_seconds}s.",
        }
    except Exception as exc:
        return {
            "success": False,
            "server_id": server_id,
            "error": str(exc),
        }


async def _test_stdio_server(
    server: dict[str, Any],
    server_id: str,
    timeout: int,
) -> dict[str, Any]:
    """Test an stdio-based MCP server."""
    command = server.get("command")
    if not command:
        return {"success": False, "server_id": server_id, "error": "Missing 'command' for stdio transport."}
    env = {**os.environ, **server.get("env", {})}
    params = StdioServerParameters(command=command, args=server.get("args", []), env=env)
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await asyncio.wait_for(session.initialize(), timeout=timeout)
            tools_result = await asyncio.wait_for(session.list_tools(), timeout=timeout)
            tools = [{"name": t.name, "description": t.description or "", "input_schema": t.inputSchema or {}} for t in tools_result.tools]
            return {"success": True, "server_id": server_id, "transport": "stdio", "tools": tools, "tool_count": len(tools)}


async def _test_sse_server(
    server: dict[str, Any],
    server_id: str,
    timeout: int,
) -> dict[str, Any]:
    """Test an SSE-based MCP server."""
    url = server.get("url")
    if not url:
        return {"success": False, "server_id": server_id, "error": "Missing 'url' for sse transport."}
    headers = server.get("headers", {})
    async with sse_client(url, headers=headers, timeout=timeout) as (read, write):
        async with ClientSession(read, write) as session:
            await asyncio.wait_for(session.initialize(), timeout=timeout)
            tools_result = await asyncio.wait_for(session.list_tools(), timeout=timeout)
            tools = [{"name": t.name, "description": t.description or "", "input_schema": t.inputSchema or {}} for t in tools_result.tools]
            return {"success": True, "server_id": server_id, "transport": "sse", "tools": tools, "tool_count": len(tools)}
