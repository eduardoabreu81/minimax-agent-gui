"""MCP Tool wrappers for MiniMax web_search and understand_image."""

import asyncio
from typing import Any

# Import the mini_agent base Tool
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent / "mini_agent"))
from mini_agent.tools.base import Tool, ToolResult

# Import the mcp_tools client
from .mcp_tools import MiniMaxMCPClient


class WebSearchTool(Tool):
    """Tool for web search using MiniMax API."""

    def __init__(self, api_key: str, api_base: str = "https://api.minimax.io"):
        self._client = MiniMaxMCPClient(api_key, api_base)

    @property
    def name(self) -> str:
        return "web_search"

    @property
    def description(self) -> str:
        return "Search the web for current information, facts, and answers. Use when you need to look up online data."

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query"
                },
                "recency_days": {
                    "type": "integer",
                    "description": "Filter results from last N days (0 = any time)",
                    "default": 30
                },
                "max_results": {
                    "type": "integer",
                    "description": "Maximum number of results (1-10)",
                    "default": 5
                }
            },
            "required": ["query"]
        }

    async def execute(self, query: str, recency_days: int = 30, max_results: int = 5) -> ToolResult:
        """Execute web search."""
        try:
            # Run sync client in thread pool since it's blocking
            loop = asyncio.get_event_loop()
            success, result = await loop.run_in_executor(
                None,
                self._client.web_search,
                query,
                recency_days,
                max_results
            )
            return ToolResult(success=success, content=result, error=None if success else result)
        except Exception as e:
            return ToolResult(success=False, content="", error=str(e))


class UnderstandImageTool(Tool):
    """Tool for understanding images using MiniMax API."""

    def __init__(self, api_key: str, api_base: str = "https://api.minimax.io"):
        self._client = MiniMaxMCPClient(api_key, api_base)

    @property
    def name(self) -> str:
        return "understand_image"

    @property
    def description(self) -> str:
        return "Analyze and describe an image. Use when you need to understand, describe, or extract information from an image file."

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "image_path": {
                    "type": "string",
                    "description": "Path to the image file to analyze"
                },
                "prompt": {
                    "type": "string",
                    "description": "Question or instruction about the image",
                    "default": "Describe this image in detail."
                }
            },
            "required": ["image_path"]
        }

    async def execute(self, image_path: str, prompt: str = "Describe this image in detail.") -> ToolResult:
        """Execute image understanding."""
        try:
            # Run sync client in thread pool since it's blocking
            loop = asyncio.get_event_loop()
            success, result = await loop.run_in_executor(
                None,
                self._client.understand_image,
                image_path,
                None,  # image_url
                prompt
            )
            return ToolResult(success=success, content=result, error=None if success else result)
        except Exception as e:
            return ToolResult(success=False, content="", error=str(e))
