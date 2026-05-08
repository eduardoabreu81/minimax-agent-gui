"""MiniMax MCP Package."""

from mini_max_mcp.client import MiniMaxClient, MiniMaxSyncClient, tts_sync, image_sync, music_sync, video_sync
from mini_max_mcp.mcp_tools import MiniMaxMCPClient, web_search_sync, understand_image_sync

__all__ = [
    "MiniMaxClient",
    "MiniMaxSyncClient",
    "tts_sync",
    "image_sync",
    "music_sync",
    "video_sync",
    "MiniMaxMCPClient",
    "web_search_sync",
    "understand_image_sync"
]