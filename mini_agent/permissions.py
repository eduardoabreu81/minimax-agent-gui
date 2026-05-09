"""Permission system for agent tool execution.

Classifies tools by risk and decides whether to auto-execute, ask for
approval, or reject based on mode and policy.
"""

from __future__ import annotations

import logging
from typing import Any

_logger = logging.getLogger(__name__)

AUTO = "auto"
ASK = "ask"
REJECT = "reject"

READ_TOOLS = {"read_file", "readfile", "read"}
WRITE_TOOLS = {"write_file", "writefile", "write", "edit_file", "editfile", "edit"}
SHELL_TOOLS = {"bash", "bash_command", "run_shell", "shell", "run_shell_command"}
MEDIA_TOOLS = {
    "image_generate",
    "imagegenerate",
    "generate_image",
    "music_generate",
    "musicgenerate",
    "generate_music",
    "tts",
    "text_to_speech",
    "video_generate",
    "videogenerate",
    "generate_video",
}
BUILTIN_SAFE = {"web_search", "understand_image", "websearch", "understandimage"}


def classify_tool(tool_name: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
    """Classify a tool by name into category, risk, and default policy."""
    name_lower = tool_name.lower()

    if name_lower.startswith("mcp_"):
        return {
            "tool_name": tool_name,
            "category": "mcp",
            "risk": "high",
            "default_policy": ASK,
            "reason": "External MCP tool from user-configured server",
        }

    if name_lower in READ_TOOLS:
        return {
            "tool_name": tool_name,
            "category": "read",
            "risk": "low",
            "default_policy": AUTO,
            "reason": "Read-only file access",
        }

    if name_lower in WRITE_TOOLS:
        return {
            "tool_name": tool_name,
            "category": "write",
            "risk": "medium",
            "default_policy": ASK,
            "reason": "File write or edit operation",
        }

    if name_lower in SHELL_TOOLS or "bash" in name_lower or "shell" in name_lower:
        return {
            "tool_name": tool_name,
            "category": "shell",
            "risk": "high",
            "default_policy": ASK,
            "reason": "Shell command execution",
        }

    if name_lower in MEDIA_TOOLS:
        return {
            "tool_name": tool_name,
            "category": "media",
            "risk": "medium",
            "default_policy": AUTO,
            "reason": "Media generation",
        }

    if name_lower in BUILTIN_SAFE:
        return {
            "tool_name": tool_name,
            "category": "builtin",
            "risk": "low",
            "default_policy": AUTO,
            "reason": "Built-in MiniMax tool",
        }

    # Safer fallback heuristics — avoid overly permissive substring matches.
    # Only classify when the tool name clearly indicates the intent via
    # prefix patterns. Suffix patterns are intentionally omitted because
    # names like "spreadsheet_write" or "credential_reader" should NOT
    # be auto-classified. When in doubt, classify as unknown/ask.

    if name_lower.startswith("read_"):
        return {
            "tool_name": tool_name,
            "category": "read",
            "risk": "low",
            "default_policy": AUTO,
            "reason": "Read-only file access",
        }

    if name_lower.startswith("write_"):
        return {
            "tool_name": tool_name,
            "category": "write",
            "risk": "medium",
            "default_policy": ASK,
            "reason": "File write operation",
        }

    if name_lower.startswith("edit_"):
        return {
            "tool_name": tool_name,
            "category": "write",
            "risk": "medium",
            "default_policy": ASK,
            "reason": "File edit operation",
        }

    if name_lower.startswith("run_"):
        return {
            "tool_name": tool_name,
            "category": "shell",
            "risk": "high",
            "default_policy": ASK,
            "reason": "Command execution",
        }

    # Media: only when the name clearly indicates generation intent
    media_patterns = ("generate_image", "image_generate", "generate_music", "music_generate",
                      "generate_video", "video_generate", "text_to_speech")
    if any(p in name_lower for p in media_patterns):
        return {
            "tool_name": tool_name,
            "category": "media",
            "risk": "medium",
            "default_policy": AUTO,
            "reason": "Media generation",
        }

    return {
        "tool_name": tool_name,
        "category": "unknown",
        "risk": "medium",
        "default_policy": ASK,
        "reason": "Unknown tool — approval required by default",
    }


def decide_permission(
    tool_name: str,
    arguments: dict[str, Any] | None,
    mode: str,
    config_policy: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Decide whether to auto-run, ask, or reject a tool execution.

    Args:
        tool_name: Name of the tool being called.
        arguments: Tool arguments dict.
        mode: One of "agent", "plan", "yolo".
        config_policy: Optional per-category overrides, e.g.
            {"shell": "ask", "write": "ask", "mcp": "ask"}

    Returns:
        Dict with "decision" (auto/ask/reject) and "classification".
    """
    classification = classify_tool(tool_name, arguments)
    category = classification["category"]
    default_policy = classification["default_policy"]

    # YOLO mode auto-approves everything except explicit reject in config
    if mode == "yolo":
        if config_policy and config_policy.get(category) == REJECT:
            decision = REJECT
        else:
            decision = AUTO
        return {"decision": decision, "classification": classification}

    # Agent / Plan modes: start from classification default
    decision = default_policy

    # Config policy override by category
    if config_policy:
        override = config_policy.get(category)
        if override:
            decision = override
        # Also allow per-tool override
        tool_override = config_policy.get(tool_name)
        if tool_override:
            decision = tool_override

    return {"decision": decision, "classification": classification}
