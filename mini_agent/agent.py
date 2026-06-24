"""Core Agent implementation."""

import asyncio
import json
import logging
import re
import uuid
from pathlib import Path
from time import perf_counter
from typing import Optional

import tiktoken

from .llm import LLMClient
from .logger import AgentLogger
from .permissions import decide_permission
from .schema import Message
from .tools.base import Tool, ToolResult
from .utils import calculate_display_width

_logger = logging.getLogger(__name__)


# ANSI color codes
class Colors:
    """Terminal color definitions"""

    RESET = "\033[0m"
    BOLD = "\033[1m"
    DIM = "\033[2m"

    # Foreground colors
    RED = "\033[31m"
    GREEN = "\033[32m"
    YELLOW = "\033[33m"
    BLUE = "\033[34m"
    MAGENTA = "\033[35m"
    CYAN = "\033[36m"

    # Bright colors
    BRIGHT_BLACK = "\033[90m"
    BRIGHT_RED = "\033[91m"
    BRIGHT_GREEN = "\033[92m"
    BRIGHT_YELLOW = "\033[93m"
    BRIGHT_BLUE = "\033[94m"
    BRIGHT_MAGENTA = "\033[95m"
    BRIGHT_CYAN = "\033[96m"
    BRIGHT_WHITE = "\033[97m"


class Agent:
    """Single agent with basic tools and MCP support."""

    def __init__(
        self,
        llm_client: LLMClient,
        system_prompt: str,
        tools: list[Tool],
        max_steps: int = 50,
        workspace_dir: str = "./workspace",
        token_limit: int = 80000,  # Legacy absolute-token floor (kept for back-compat)
        auto_compact: bool = True,
        compact_at_pct: float = 0.8,
        force_compact_at_pct: float = 0.9,
        session_id: Optional[str] = None,
    ):
        self.llm = llm_client
        self.tools = {tool.name: tool for tool in tools}
        self.max_steps = max_steps
        self.token_limit = token_limit
        self.auto_compact = auto_compact
        self.compact_at_pct = compact_at_pct
        self.force_compact_at_pct = force_compact_at_pct
        # Optional session identifier — used for structured logging of
        # auto-compact events so we can correlate them with the WS
        # session. Set externally by SessionManager (main.py) when the
        # agent is bound to a WebSocket.
        self.session_id = session_id
        # Resolve the model's context window from the LLM client so pct
        # checks are model-aware. Falls back to token_limit if the client
        # doesn't expose the map (e.g. OpenAI client — it doesn't track
        # this yet, default 200K is a safe over-estimate).
        limits_map = getattr(llm_client, "MODEL_CONTEXT_LIMITS", {}) or {}
        self.model_context_limit = (
            limits_map.get(llm_client.model)
            or getattr(llm_client, "DEFAULT_CONTEXT_LIMIT", 200_000)
        )
        self.workspace_dir = Path(workspace_dir)
        # Cancellation event for interrupting agent execution (set externally, e.g., by Esc key)
        self.cancel_event: Optional[asyncio.Event] = None

        # Ensure workspace exists
        self.workspace_dir.mkdir(parents=True, exist_ok=True)

        # Inject workspace information into system prompt if not already present
        if "Current Workspace" not in system_prompt:
            workspace_info = f"\n\n## Current Workspace\nYou are currently working in: `{self.workspace_dir.absolute()}`\nAll relative paths will be resolved relative to this directory."
            system_prompt = system_prompt + workspace_info

        self.system_prompt = system_prompt

        # Initialize message history
        self.messages: list[Message] = [Message(role="system", content=system_prompt)]

        # Initialize logger
        self.logger = AgentLogger()

        # Token usage from last API response (updated after each LLM call)
        self.api_total_tokens: int = 0
        # Full per-turn usage block from the most recent LLM call.
        # Surfaced to the WebSocket so the StatusBar's context-window chip
        # can show real numbers instead of guessing. Reset to None between
        # turns so callers can tell "no usage recorded yet" from "zero".
        self.last_usage: dict | None = None
        # Flag to skip token check right after summary (avoid consecutive triggers)
        self._skip_next_token_check: bool = False

    def add_user_message(self, content: str):
        """Add a user message to history."""
        self.messages.append(Message(role="user", content=content))

    def _check_cancelled(self) -> bool:
        """Check if agent execution has been cancelled.

        Returns:
            True if cancelled, False otherwise.
        """
        if self.cancel_event is not None and self.cancel_event.is_set():
            return True
        return False

    def _cleanup_incomplete_messages(self):
        """Remove the incomplete assistant message and its partial tool results.

        This ensures message consistency after cancellation by removing
        only the current step's incomplete messages, preserving completed steps.
        """
        # Find the index of the last assistant message
        last_assistant_idx = -1
        for i in range(len(self.messages) - 1, -1, -1):
            if self.messages[i].role == "assistant":
                last_assistant_idx = i
                break

        if last_assistant_idx == -1:
            # No assistant message found, nothing to clean
            return

        # Remove the last assistant message and all tool results after it
        removed_count = len(self.messages) - last_assistant_idx
        if removed_count > 0:
            self.messages = self.messages[:last_assistant_idx]
            _logger.debug(f"Cleaned up {removed_count} incomplete message(s)")

    def _estimate_tokens(self) -> int:
        """Accurately calculate token count for message history using tiktoken

        Uses cl100k_base encoder (GPT-4/Claude/M2 compatible)
        """
        try:
            # Use cl100k_base encoder (used by GPT-4 and most modern models)
            encoding = tiktoken.get_encoding("cl100k_base")
        except Exception:
            # Fallback: if tiktoken initialization fails, use simple estimation
            return self._estimate_tokens_fallback()

        total_tokens = 0

        for msg in self.messages:
            # Count text content
            if isinstance(msg.content, str):
                total_tokens += len(encoding.encode(msg.content))
            elif isinstance(msg.content, list):
                for block in msg.content:
                    if isinstance(block, dict):
                        # Convert dict to string for calculation
                        total_tokens += len(encoding.encode(str(block)))

            # Count thinking
            if msg.thinking:
                total_tokens += len(encoding.encode(msg.thinking))

            # Count tool_calls
            if msg.tool_calls:
                total_tokens += len(encoding.encode(str(msg.tool_calls)))

            # Metadata overhead per message (approximately 4 tokens)
            total_tokens += 4

        return total_tokens

    def _estimate_tokens_fallback(self) -> int:
        """Fallback token estimation method (when tiktoken is unavailable)"""
        total_chars = 0
        for msg in self.messages:
            if isinstance(msg.content, str):
                total_chars += len(msg.content)
            elif isinstance(msg.content, list):
                for block in msg.content:
                    if isinstance(block, dict):
                        total_chars += len(str(block))

            if msg.thinking:
                total_chars += len(msg.thinking)

            if msg.tool_calls:
                total_chars += len(str(msg.tool_calls))

        # Rough estimation: average 2.5 characters = 1 token
        return int(total_chars / 2.5)

    def estimate_by_source(self) -> dict:
        """Estimate the current context window breakdown by source.

        Returns a dict with token counts (approximate, ~2.5 chars/token
        fallback OR tiktoken cl100k_base when available). Categories
        (matches the StatusBar popover breakdown UI):

          - messages:            user/assistant/tool message history
                                 (messages[1:]).
          - skills:              Skills metadata block in the system
                                 prompt (sections whose header mentions
                                 "skill").
          - memory_files:        USER.md + MEMORY.md + SOUL.md content
                                 (sections whose header references one
                                 of those filenames, or the Hermes
                                 "MEMORY (agent notes)" header).
          - custom_agents:       IDENTITY.md content ("Current Role
                                 (IDENTITY.md)" and similar).
          - system_prompt:       Base preamble (default identity +
                                 "Today's Session Log" + everything
                                 not bucketed elsewhere).
          - mcp_tools:           Currently-loaded MCP tool schemas +
                                 the "## MCP Servers" section header.
                                 Sums tool-definition tokens from
                                 self.tools (only ExternalMCPTool
                                 entries).
          - mcp_deferred:        Always 0 today (TODO — heuristic for
                                 deferred MCP tools). The Token Plan
                                 dashboard print shows ~2.8% MCP
                                 deferred, but that requires a
                                 relevance-based deferral strategy
                                 that isn't implemented yet.
          - system_tools_deferred: Always 0 today (placeholder for
                                 future "core tools not in this turn"
                                 attribution).
          - total:               Sum of all categorized tokens (matches
                                 ``self._estimate_tokens()`` approx).
          - limit:               The model's context window (echo of
                                 ``self.model_context_limit``).

        Plus a ``details`` sub-dict with three lists used by the
        expandable sub-sections in the StatusBar popover:

          - details.mcp_tools_list:    per-server summary of loaded
                                       MCP tools — ``{server_id, name,
                                       tool_count, tokens}``.
          - details.memory_files_list: per-file memory-file summary —
                                       ``{file, tokens}``.
          - details.custom_agents_list: per-agent (IDENTITY.md) summary
                                        — ``{agent, tokens}``.

        Attribution is best-effort: sections whose header doesn't
        match a known keyword fall into ``system_prompt``. Numbers
        are an *approximation* — exact attribution would require
        tokenizing the API's request payload, which we don't have
        on the client side. Use this for the UI breakdown and for
        dashboards, not for billing math.
        """
        empty = {
            "messages": 0, "skills": 0, "memory_files": 0,
            "custom_agents": 0, "system_prompt": 0, "mcp_tools": 0,
            "mcp_deferred": 0, "system_tools_deferred": 0,
            "total": 0, "limit": self.model_context_limit,
            "details": {
                "mcp_tools_list": [],
                "memory_files_list": [],
                "custom_agents_list": [],
            },
        }
        if not self.messages:
            return empty

        # Pick the same tokenizer as ``_estimate_tokens`` for consistency.
        try:
            encoding = tiktoken.get_encoding("cl100k_base")
            count = lambda s: len(encoding.encode(s)) if s else 0
        except Exception:
            count = lambda s: int(len(s) / 2.5) if s else 0

        # ---- System prompt (messages[0]) ----
        system_msg = self.messages[0]
        if isinstance(system_msg.content, str):
            system_content = system_msg.content
        else:
            system_content = str(system_msg.content)

        # Split the system prompt into sections by ``## `` headers.
        # The first chunk (before the first ``## ``) is the base
        # preamble (default identity). Subsequent chunks are named
        # sections, each starting with their header line.
        chunks = re.split(r"^## ", system_content, flags=re.MULTILINE)
        preamble = chunks[0] if chunks else system_content
        named = []
        for raw in chunks[1:]:
            header, _, body = raw.partition("\n")
            named.append((header.strip().lower(), body))

        # Bucket accumulators + per-section detail records (so the
        # expandable sub-sections have something to render).
        by_source = {
            "messages": 0, "skills": 0, "memory_files": 0,
            "custom_agents": 0, "system_prompt": 0, "mcp_tools": 0,
            "mcp_deferred": 0, "system_tools_deferred": 0,
        }
        memory_files_list: list[dict] = []
        custom_agents_list: list[dict] = []

        # The MEMORY block (rendered by render_memory_prompt in
        # web/backend/agent_context.py) doesn't use `## ` headers —
        # it's a Hermes-style "═════... MEMORY (agent notes) ═════"
        # block. If the preamble (or trailing content after the
        # last `## ` section) contains that marker, peel it off into
        # memory_files before bucketing the rest.
        mem_marker = "MEMORY (agent notes)"
        mem_idx = preamble.find(mem_marker)
        if mem_idx >= 0:
            mem_block = preamble[mem_idx:]
            preamble = preamble[:mem_idx]
            by_source["memory_files"] += count(mem_block)
            memory_files_list.append({
                "file": "MEMORY.md",
                "tokens": count(mem_block),
            })

        # Base preamble is always system_prompt (default identity + setup).
        by_source["system_prompt"] += count(preamble)

        # Categorize each named section by its header. Headers we recognize
        # explicitly; anything else falls into ``system_prompt``.
        # Match on lowercase header substring. Order matters — more
        # specific matches first (IDENTITY.md before any generic
        # "current role" match).
        for header, body in named:
            text = "## " + header + "\n" + body if body else "## " + header
            tokens = count(text)

            if "skill" in header:
                by_source["skills"] += tokens
            elif "identity.md" in header or "current role" in header:
                # IDENTITY.md section = the user's chosen role.
                by_source["custom_agents"] += tokens
                custom_agents_list.append({
                    "agent": header,
                    "tokens": tokens,
                })
            elif any(k in header for k in ("user.md", "memory.md", "soul.md")) \
                    or "memory (agent notes)" in header:
                # USER.md + MEMORY.md + SOUL.md → memory_files bucket.
                # The Hermes MEMORY header doesn't start with `##` but
                # its body still appears between the marker block, so
                # we catch it here too.
                by_source["memory_files"] += tokens
                memory_files_list.append({
                    "file": header,
                    "tokens": tokens,
                })
            elif "mcp server" in header or "mcp tool" in header \
                    or "external mcp" in header:
                by_source["mcp_tools"] += tokens
            else:
                # SOUL/IDENTITY sections we don't catch, the daily
                # log, "Today's Session Log", "Current Workspace",
                # and any future un-bucketed sections land here.
                by_source["system_prompt"] += tokens

        # ---- MCP tool schemas (the actual tool definitions sent in
        # the API request) ----
        # Group loaded ExternalMCPTool instances by server_id so the
        # popover's "Ferramentas MCP" expandable row can list each
        # server with its tool count. Built-in tools (ReadTool,
        # WriteTool, BashTool, etc.) are not ExternalMCPTool — they
        # don't have server_id and stay out of this bucket.
        mcp_tools_list: list[dict] = []
        per_server_tokens: dict[str, int] = {}
        per_server_name: dict[str, str] = {}
        for tool in (self.tools or {}).values():
            sid = getattr(tool, "server_id", None)
            if not sid:
                continue
            # Tool definitions are sent in the API request's `tools`
            # array — tokenize the JSON shape the LLM actually sees
            # (name + description + input_schema).
            try:
                schema = tool.to_anthropic_schema() if hasattr(tool, "to_anthropic_schema") else None
                if schema is None:
                    # Fallback — stringify whatever attributes we have.
                    schema = {
                        "name": getattr(tool, "name", "unknown"),
                        "description": getattr(tool, "description", ""),
                    }
                text = json.dumps(schema, ensure_ascii=False)
            except Exception:
                text = (getattr(tool, "name", "") + " " +
                       getattr(tool, "description", ""))
            per_server_tokens[sid] = per_server_tokens.get(sid, 0) + count(text)
            # Prefer the server_config.name over the raw server_id for display.
            cfg = getattr(tool, "server_config", None) or {}
            display = (cfg.get("name") if isinstance(cfg, dict) else None) or sid
            per_server_name[sid] = display
        for sid, tokens in sorted(per_server_tokens.items()):
            # Count tools per server: how many entries in self.tools have
            # this server_id (cheap, runs once per WS usage event).
            tool_count = sum(
                1 for t in (self.tools or {}).values()
                if getattr(t, "server_id", None) == sid
            )
            mcp_tools_list.append({
                "server_id": sid,
                "name": per_server_name.get(sid, sid),
                "tool_count": tool_count,
                "tokens": tokens,
            })
        by_source["mcp_tools"] += sum(per_server_tokens.values())

        # ---- History (messages[1:]) ----
        for msg in self.messages[1:]:
            if isinstance(msg.content, str):
                by_source["messages"] += count(msg.content)
            elif isinstance(msg.content, list):
                for block in msg.content:
                    if isinstance(block, dict):
                        by_source["messages"] += count(str(block))
            if msg.thinking:
                by_source["messages"] += count(msg.thinking)
            if msg.tool_calls:
                by_source["messages"] += count(str(msg.tool_calls))
            # Per-message metadata overhead (same as _estimate_tokens).
            by_source["messages"] += 4

        # ---- mcp_deferred + system_tools_deferred placeholders ----
        # TODO(minimax-m3): implement relevance-based deferral. For
        # now both are 0 — the "loaded" set covers all tools the
        # agent has access to. Honest reporting (0) keeps the
        # popover rows truthful.

        total = sum(by_source.values())
        limit = self.model_context_limit or 0

        return {
            **by_source,
            "total": total,
            "limit": limit,
            "details": {
                "mcp_tools_list": mcp_tools_list,
                "memory_files_list": memory_files_list,
                "custom_agents_list": custom_agents_list,
            },
        }

    async def _summarize_messages(self):
        """Message history summarization: summarize conversations between user messages when tokens exceed limit

        Strategy (Agent mode):
        - Keep all user messages (these are user intents)
        - Summarize content between each user-user pair (agent execution process)
        - If last round is still executing (has agent/tool messages but no next user), also summarize
        - Structure: system -> user1 -> summary1 -> user2 -> summary2 -> user3 -> summary3 (if executing)

        Summary is triggered when ANY of:
        - API reported total_tokens / model_context_limit >= compact_at_pct
          AND auto_compact is enabled (user toggle in advanced settings)
        - API reported total_tokens / model_context_limit >= force_compact_at_pct
          (90% safety net — ALWAYS triggers, even if user disabled the toggle)
        - Legacy absolute-token floor (token_limit=80K default) for back-compat

        Emits structured log events via `_log_compact_event` (JSON-encoded,
        one line per state transition) so we can dashboard / post-process
        compact history without grep-parsing f-strings. Each call gets a
        unique `compact_id` shared by the `started` and `completed` (or
        `failed`) events for correlation.
        """
        # Skip check if we just completed a summary (wait for next LLM call to update api_total_tokens)
        if self._skip_next_token_check:
            self._skip_next_token_check = False
            return

        estimated_tokens = self._estimate_tokens()
        limit = self.model_context_limit or 1
        api_pct = self.api_total_tokens / limit if limit > 0 else 0
        estimated_pct = estimated_tokens / limit if limit > 0 else 0

        # 90% safety net — never overridable by user toggle
        force_compact = (
            api_pct >= self.force_compact_at_pct
            or estimated_pct >= self.force_compact_at_pct
        )

        # Auto-compact at user-configured threshold — respects toggle
        auto_compact_due = (
            self.auto_compact
            and (
                api_pct >= self.compact_at_pct
                or estimated_pct >= self.compact_at_pct
            )
        )

        # Legacy back-compat floor (token_limit=80K default from old code)
        legacy_floor = (
            estimated_tokens > self.token_limit
            or self.api_total_tokens > self.token_limit
        )

        should_summarize = force_compact or auto_compact_due or legacy_floor

        # If neither exceeded, no summary needed — no log either, so
        # silent sessions don't generate noise.
        if not should_summarize:
            return

        # Determine *which* trigger fired so the log explains the reason
        # (force wins over auto wins over legacy when multiple are true).
        if force_compact:
            compact_reason = "force"
        elif auto_compact_due:
            compact_reason = "auto"
        else:
            compact_reason = "legacy"

        # Capture pre-summary state for the log + delta math.
        before_tokens = self.api_total_tokens
        pct_before = api_pct
        compact_id = uuid.uuid4().hex[:12]

        self._log_compact_event(
            "started",
            compact_id=compact_id,
            triggered_by="backend",
            compact_reason=compact_reason,
            before_tokens=before_tokens,
            pct_before=round(pct_before, 4),
            model_context_limit=limit,
        )

        # Find all user message indices (skip system prompt)
        user_indices = [i for i, msg in enumerate(self.messages) if msg.role == "user" and i > 0]

        # Need at least 1 user message to perform summary
        if len(user_indices) < 1:
            _logger.warning("Insufficient messages, cannot summarize")
            self._log_compact_event(
                "skipped",
                compact_id=compact_id,
                triggered_by="backend",
                reason="insufficient_messages",
            )
            return

        # Build new message list
        new_messages = [self.messages[0]]  # Keep system prompt
        summary_count = 0

        try:
            # Iterate through each user message and summarize the execution process after it
            for i, user_idx in enumerate(user_indices):
                # Add current user message
                new_messages.append(self.messages[user_idx])

                # Determine message range to summarize
                # If last user, go to end of message list; otherwise to before next user
                if i < len(user_indices) - 1:
                    next_user_idx = user_indices[i + 1]
                else:
                    next_user_idx = len(self.messages)

                # Extract execution messages for this round
                execution_messages = self.messages[user_idx + 1 : next_user_idx]

                # If there are execution messages for this round, summarize them
                if execution_messages:
                    summary_text = await self._create_summary(execution_messages, i + 1)
                    if summary_text:
                        summary_message = Message(
                            role="user",
                            content=f"[Assistant Execution Summary]\n\n{summary_text}",
                        )
                        new_messages.append(summary_message)
                        summary_count += 1

            # Replace message list
            self.messages = new_messages

            # Skip next token check to avoid consecutive summary triggers
            # (api_total_tokens will be updated after next LLM call)
            self._skip_next_token_check = True

            after_tokens = self.api_total_tokens
            pct_after = (after_tokens / limit) if limit > 0 else 0
            self._log_compact_event(
                "completed",
                compact_id=compact_id,
                triggered_by="backend",
                compact_reason=compact_reason,
                before_tokens=before_tokens,
                after_tokens=after_tokens,
                pct_before=round(pct_before, 4),
                pct_after=round(pct_after, 4),
                delta_tokens=before_tokens - after_tokens,
                delta_pct=round(pct_before - pct_after, 4),
                summaries_created=summary_count,
            )

            new_tokens = self._estimate_tokens()
            _logger.debug(f"Structure: system + {len(user_indices)} user messages + {summary_count} summaries")
            _logger.debug("Note: API token count will update on next LLM call")
            _logger.debug(f"Local tokens: {estimated_tokens} → {new_tokens}")
        except Exception as exc:
            self._log_compact_event(
                "failed",
                compact_id=compact_id,
                triggered_by="backend",
                compact_reason=compact_reason,
                before_tokens=before_tokens,
                pct_before=round(pct_before, 4),
                error=str(exc),
                error_type=type(exc).__name__,
            )
            raise

    def _log_compact_event(self, event, **fields):
        """Emit a structured compact log line (JSON-encoded, one line).

        The frontend (WS `compact` handler in main.py) and the backend
        (this method's auto-compact path) both trigger summarization. This
        helper unifies the log format so dashboards can ingest compact
        history without grep-parsing f-strings. `event` is one of
        ``started`` / ``completed`` / ``failed`` / ``skipped``.
        ``compact_id`` is always echoed (when present) so the two events
        for the same call can be correlated downstream.
        """
        payload = {
            "event": event,
            "session_id": self.session_id,
            "model": getattr(self.llm, "model", None),
            **{k: v for k, v in fields.items() if k != "event"},
        }
        _logger.info(json.dumps(payload))

    async def _create_summary(self, messages: list[Message], round_num: int) -> str:
        """Create summary for one execution round

        Args:
            messages: List of messages to summarize
            round_num: Round number

        Returns:
            Summary text
        """
        if not messages:
            return ""

        # Build summary content
        summary_content = f"Round {round_num} execution process:\n\n"
        for msg in messages:
            if msg.role == "assistant":
                content_text = msg.content if isinstance(msg.content, str) else str(msg.content)
                summary_content += f"Assistant: {content_text}\n"
                if msg.tool_calls:
                    tool_names = [tc.function.name for tc in msg.tool_calls]
                    summary_content += f"  → Called tools: {', '.join(tool_names)}\n"
            elif msg.role == "tool":
                result_preview = msg.content if isinstance(msg.content, str) else str(msg.content)
                summary_content += f"  ← Tool returned: {result_preview}...\n"

        # Call LLM to generate concise summary
        try:
            summary_prompt = f"""Please provide a concise summary of the following Agent execution process:

{summary_content}

Requirements:
1. Focus on what tasks were completed and which tools were called
2. Keep key execution results and important findings
3. Be concise and clear, within 1000 words
4. Use English
5. Do not include "user" related content, only summarize the Agent's execution process"""

            summary_msg = Message(role="user", content=summary_prompt)
            response = await self.llm.generate(
                messages=[
                    Message(
                        role="system",
                        content="You are an assistant skilled at summarizing Agent execution processes.",
                    ),
                    summary_msg,
                ]
            )

            summary_text = response.content
            _logger.info(f"Summary for round {round_num} generated successfully")
            return summary_text

        except Exception as e:
            _logger.error(f"Summary generation failed for round {round_num}: {e}")
            # Use simple text summary on failure
            return summary_content

    async def run(
        self,
        cancel_event: Optional[asyncio.Event] = None,
        tool_callback: Optional[callable] = None,
        permission_mode: str = "agent",
        permission_callback: Optional[callable] = None,
        permission_policy: Optional[dict] = None,
        model_override: str | None = None,
        thinking_override: bool | None = None,
        stream_callback: Optional[callable] = None,
    ) -> str:
        """Execute agent loop until task is complete or max steps reached.

        Args:
            cancel_event: Optional asyncio.Event that can be set to cancel execution.
                          When set, the agent will stop at the next safe checkpoint
                          (after completing the current step to keep messages consistent).
            tool_callback: Optional callback function(tool_name, arguments, result) called
                          after each tool execution. Used for real-time UI updates.
            permission_mode: One of "agent", "plan", "yolo". Controls tool approval behavior.
            permission_callback: Optional async callback for "ask" decisions.
                                 Receives {"tool_name", "arguments", "classification"}
                                 and must return "approved" or "rejected".
            permission_policy: Optional dict with per-category or per-tool overrides.
            model_override: Optional model to use for THIS run, overriding the
                            client default. Per-turn model picker in the UI.
            thinking_override: Optional thinking toggle for THIS run.
                                True = force on, False = force off, None = auto.
            stream_callback: Optional async callback(kind, content) invoked for
                              every content_block_delta (thinking or text) as
                              the model generates. Enables real-time streaming
                              of both reasoning and response to the client.

        Returns:
            The final response content, or error message (including cancellation message).
        """
        # Set cancellation event (can also be set via self.cancel_event before calling run())
        if cancel_event is not None:
            self.cancel_event = cancel_event

        # Start new run, initialize log file
        self.logger.start_new_run()
        _logger.debug(f"Log file: {self.logger.get_log_file_path()}")

        step = 0
        run_start_time = perf_counter()

        while step < self.max_steps:
            # Check for cancellation at start of each step
            if self._check_cancelled():
                self._cleanup_incomplete_messages()
                cancel_msg = "Task cancelled by user."
                _logger.warning(f"[CANCEL] {cancel_msg}")
                return cancel_msg

            # Notify step start via callback
            if tool_callback:
                try:
                    await tool_callback("__step_start__", {"step": step + 1, "max_steps": self.max_steps}, None)
                except Exception:
                    pass

            step_start_time = perf_counter()
            # Check and summarize message history to prevent context overflow
            await self._summarize_messages()

            # Step header with proper width calculation
            BOX_WIDTH = 58
            step_text = f"{Colors.BOLD}{Colors.BRIGHT_CYAN}💭 Step {step + 1}/{self.max_steps}{Colors.RESET}"
            step_display_width = calculate_display_width(step_text)
            padding = max(0, BOX_WIDTH - 1 - step_display_width)  # -1 for leading space

            _logger.debug(f"Step {step}: {step_text}")

            # Get tool list for LLM call
            tool_list = list(self.tools.values())

            # Log LLM request and call LLM with Tool objects directly
            self.logger.log_request(messages=self.messages, tools=tool_list)

            try:
                response = await self.llm.generate(
                    messages=self.messages,
                    tools=tool_list,
                    model=model_override,
                    thinking=thinking_override,
                    on_delta=stream_callback,
                )
            except Exception as e:
                # Check if it's a retry exhausted error
                from .retry import RetryExhaustedError

                if isinstance(e, RetryExhaustedError):
                    error_msg = f"LLM call failed after {e.attempts} retries. Last error: {str(e.last_exception)}"
                    _logger.error(f"Retry failed: {error_msg}")
                else:
                    error_msg = f"LLM call failed: {str(e)}"
                    _logger.error(f"Error: {error_msg}")
                return error_msg

            # Accumulate API reported token usage + store the full block
            # so the WebSocket can forward it to the StatusBar's
            # context-window chip. response.usage is a TokenUsage
            # (mini_agent.schema) — it carries prompt_tokens /
            # completion_tokens / total_tokens (provider-agnostic shape).
            # The Anthropic client folds cache_read + cache_creation
            # into prompt_tokens, so input_tokens here means "total
            # tokens billed as input", which is what the StatusBar chip
            # actually displays. Cache fields are 0 in this shape —
            # acceptable cosmetic gap until TokenUsage grows cache slots.
            if response.usage:
                self.api_total_tokens = response.usage.total_tokens
                usage = response.usage
                self.last_usage = {
                    "input_tokens": getattr(usage, "prompt_tokens", 0) or 0,
                    "output_tokens": getattr(usage, "completion_tokens", 0) or 0,
                    "cache_read_input_tokens": 0,
                    "cache_creation_input_tokens": 0,
                }

            # Stream the model's reasoning (M3 extended thinking, etc.)
            # to the WebSocket so the UI can render the thinking block
            # in real-time alongside the streamed response. Without
            # this, the thinking is silently captured into the agent's
            # internal message log but never reaches the client.
            if response.thinking and tool_callback:
                try:
                    await tool_callback(
                        "__thinking__",
                        {"thinking": response.thinking},
                        None,
                    )
                except Exception:
                    pass

            # Log LLM response
            self.logger.log_response(
                content=response.content,
                thinking=response.thinking,
                tool_calls=response.tool_calls,
                finish_reason=response.finish_reason,
            )

            # Add assistant message
            assistant_msg = Message(
                role="assistant",
                content=response.content,
                thinking=response.thinking,
                tool_calls=response.tool_calls,
            )
            self.messages.append(assistant_msg)

            # Log thinking if present
            if response.thinking:
                _logger.debug(f"Thinking: {response.thinking}")

            # Log assistant response
            if response.content:
                _logger.debug(f"Assistant: {response.content}")

            # Check if task is complete (no tool calls)
            if not response.tool_calls:
                step_elapsed = perf_counter() - step_start_time
                total_elapsed = perf_counter() - run_start_time
                _logger.debug(f"Step {step + 1} completed in {step_elapsed:.2f}s (total: {total_elapsed:.2f}s)")
                return response.content

            # Check for cancellation before executing tools
            if self._check_cancelled():
                self._cleanup_incomplete_messages()
                cancel_msg = "Task cancelled by user."
                _logger.warning(f"[CANCEL] {cancel_msg}")
                return cancel_msg

            # Execute tool calls
            for tool_call in response.tool_calls:
                tool_call_id = tool_call.id
                function_name = tool_call.function.name
                arguments = tool_call.function.arguments

                _logger.debug(f"Tool call: {function_name}")
                # Truncate each argument value to avoid overly long output
                truncated_args = {}
                for key, value in arguments.items():
                    value_str = str(value)
                    if len(value_str) > 200:
                        truncated_args[key] = value_str[:200] + "..."
                    else:
                        truncated_args[key] = value
                args_json = json.dumps(truncated_args, indent=2, ensure_ascii=False)
                _logger.debug(f"Tool arguments: {args_json}")

                # Permission check before executing tool
                perm = decide_permission(
                    tool_name=function_name,
                    arguments=arguments,
                    mode=permission_mode,
                    config_policy=permission_policy,
                )
                decision = perm["decision"]
                classification = perm["classification"]

                if decision == "reject":
                    result = ToolResult(
                        success=False,
                        content="",
                        error=f"Tool execution rejected by permission policy: {classification['reason']}",
                    )
                elif decision == "ask":
                    if permission_callback:
                        try:
                            approval = await permission_callback(
                                {
                                    "tool_name": function_name,
                                    "arguments": arguments,
                                    "classification": classification,
                                }
                            )
                        except Exception as e:
                            _logger.warning(f"Permission callback error: {e}")
                            approval = "rejected"
                        if approval == "approved":
                            decision = "auto"
                        else:
                            result = ToolResult(
                                success=False,
                                content="",
                                error=f"Tool '{function_name}' was rejected by user.",
                            )
                    else:
                        result = ToolResult(
                            success=False,
                            content="",
                            error=f"Tool '{function_name}' requires approval but no permission callback is available.",
                        )

                if decision == "auto":
                    # Execute tool
                    if function_name not in self.tools:
                        result = ToolResult(
                            success=False,
                            content="",
                            error=f"Unknown tool: {function_name}",
                        )
                    else:
                        try:
                            tool = self.tools[function_name]
                            result = await tool.execute(**arguments)
                        except Exception as e:
                            # Catch all exceptions during tool execution, convert to failed ToolResult
                            import traceback

                            error_detail = f"{type(e).__name__}: {str(e)}"
                            error_trace = traceback.format_exc()
                            result = ToolResult(
                                success=False,
                                content="",
                                error=f"Tool execution failed: {error_detail}\n\nTraceback:\n{error_trace}",
                            )

                # Log tool execution result
                self.logger.log_tool_result(
                    tool_name=function_name,
                    arguments=arguments,
                    result_success=result.success,
                    result_content=result.content if result.success else None,
                    result_error=result.error if not result.success else None,
                )

                # Print result
                if result.success:
                    result_text = result.content
                    if len(result_text) > 300:
                        result_text = result_text[:300] + "..."
                    _logger.debug(f"Tool result: {result_text}")
                else:
                    _logger.error(f"Tool error: {result.error}")

                # Emit tool callback for UI
                if tool_callback:
                    try:
                        await tool_callback(function_name, arguments, result)
                    except Exception:
                        pass

                # Add tool result message
                tool_msg = Message(
                    role="tool",
                    content=result.content if result.success else f"Error: {result.error}",
                    tool_call_id=tool_call_id,
                    name=function_name,
                )
                self.messages.append(tool_msg)

                # Check for cancellation after each tool execution
                if self._check_cancelled():
                    self._cleanup_incomplete_messages()
                    cancel_msg = "Task cancelled by user."
                    _logger.warning(f"[CANCEL] {cancel_msg}")
                    return cancel_msg

            step_elapsed = perf_counter() - step_start_time
            total_elapsed = perf_counter() - run_start_time
            _logger.debug(f"Step {step + 1} completed in {step_elapsed:.2f}s (total: {total_elapsed:.2f}s)")

            step += 1

        error_msg = f"Task couldn't be completed after {self.max_steps} steps."
        _logger.warning(f"{error_msg}")
        return error_msg

    def get_history(self) -> list[Message]:
        """Get message history."""
        return self.messages.copy()
