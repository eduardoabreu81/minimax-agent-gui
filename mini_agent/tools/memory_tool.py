"""Memory tool — let the agent manage MEMORY.md and USER.md.

Hermes spec: https://hermes-agent.nousresearch.com/docs/user-guide/features/memory

The tool exposes three actions on two targets:

  Targets:
    - "memory" → MEMORY.md (2,200 chars, agent's personal notes)
    - "user"   → USER.md  (1,375 chars, user profile)

  Actions:
    - "add"     → append a new entry
    - "replace" → replace an existing entry (substring match on old_text)
    - "remove"  → remove an existing entry (substring match on old_text)

Hermes spec details (matched here):

  - Substring matching: ``old_text`` just needs to be a unique
    substring of exactly one entry. If it matches zero or more
    than one entry, the tool returns an error asking for a
    more specific match.

  - Capacity check: BEFORE any write, if (current_chars + new_chars)
    > limit, the tool returns an error with the current_entries
    list and usage string. The agent then has to consolidate
    (replace/remove) in the same turn before retrying the add.

  - Duplicate prevention: exact duplicate entries are rejected
    with success=True and "no duplicate added" message. The
    spec says "the memory system automatically rejects exact
    duplicate entries".

  - Security scan: prompt-injection patterns + invisible Unicode
    are blocked before any write. Mirrors the existing scan
    in the context-files loader.

  - Frozen snapshot pattern: the system prompt loads memory at
    session start and never changes mid-session. This tool
    writes to disk immediately but the in-memory snapshot is
    NOT refreshed — the next session will see the new state.

  - Append-only: entries are `§`-separated, no headers. Each
    entry is one chunk of text (can be multiline).

The tool is intentionally NOT exposing `read` — the agent sees
memory via the system prompt injection at session start. Only
write actions are exposed.
"""

import json
import logging
import re
import time
import unicodedata
from pathlib import Path
from typing import Any, Optional

from .base import Tool, ToolResult


logger = logging.getLogger(__name__)


# Target metadata. Mirrors the constants in
# web/backend/agent_context.py — duplicated here so the tool
# can run standalone (agent.py is a separate process from
# the FastAPI backend during dev).
TARGETS: dict[str, dict[str, Any]] = {
    "memory": {
        "file": "MEMORY.md",
        "char_limit": 2_200,
        "description": "Agent's personal notes — environment facts, conventions, things learned",
    },
    "user": {
        "file": "USER.md",
        "char_limit": 1_375,
        "description": "User profile — preferences, communication style, expectations",
    },
}

VALID_TARGETS = list(TARGETS.keys())
VALID_ACTIONS = ("add", "replace", "remove")

# Entry delimiter (Hermes spec).
ENTRY_SEP = "§"

# Hidden Unicode categories that the spec blocks. Zero-width
# joiners, bidirectional overrides, word joiners — all classic
# prompt-injection vectors.
_INVISIBLE_CHARS = {
    "\u200B",  # ZERO WIDTH SPACE
    "\u200C",  # ZERO WIDTH NON-JOINER
    "\u200D",  # ZERO WIDTH JOINER
    "\u2060",  # WORD JOINER
    "\uFEFF",  # BYTE ORDER MARK
    "\u202E",  # RIGHT-TO-LEFT OVERRIDE
    "\u202D",  # LEFT-TO-RIGHT OVERRIDE
    "\u202A",  # LEFT-TO-RIGHT EMBEDDING
    "\u202B",  # RIGHT-TO-LEFT EMBEDDING
}

# Prompt-injection patterns. The list is intentionally
# conservative — we don't try to catch every obfuscation, just
# the obvious ones. The spec says "the scanner protects against
# common injection patterns, but it's not a substitute for
# reviewing context files".
_INJECTION_PATTERNS: tuple[tuple[str, str], ...] = (
    (r"ignore (all )?previous instructions", "instruction_override"),
    (r"disregard your rules", "instruction_override"),
    (r"system prompt override", "system_prompt_override"),
    (r"do not tell the user", "deception"),
    (r"<!--\s*ignore instructions\s*-->", "hidden_html_comment"),
    (r"curl\s+[^\n]*\$\{?[A-Z_]+\}?", "credential_exfiltration"),
    (r"cat\s+(\.env|~/\.ssh|~/\.aws)", "secret_access"),
)


def _has_invisible_unicode(text: str) -> bool:
    """True if text contains any zero-width or bidi-override char."""
    return any(ch in _INVISIBLE_CHARS for ch in text)


def _scan_for_injection(text: str) -> Optional[str]:
    """Return a reason string if text matches an injection pattern,
    else None. Conservative — false positives are OK, we just
    want to block the obvious vectors.
    """
    for pattern, label in _INJECTION_PATTERNS:
        if re.search(pattern, text, re.IGNORECASE | re.DOTALL):
            return f"prompt injection ({label})"
    if _has_invisible_unicode(text):
        return "invisible Unicode characters"
    return None


def _split_entries(content: str) -> list[str]:
    """Split memory content into entries by the ``§`` separator.

    Hermes pattern: entries are `§`-separated chunks (one per
    line group, no headers). Whitespace-only chunks are dropped.
    The leading `#` header (if any) and the explanatory preamble
    are kept as a special "preamble" entry at index 0 so that
    capacity counting stays accurate — the preamble counts toward
    the char limit.
    """
    # Split on the section sign. Each chunk is a candidate entry.
    # Strip leading/trailing whitespace from each. Drop empties.
    chunks = [c.strip() for c in content.split(ENTRY_SEP)]
    return [c for c in chunks if c]


def _join_entries(preamble: str, entries: list[str]) -> str:
    """Join entries with ``§`` separators, preserving the preamble
    (the leading # header + explanation) at the top.
    """
    if not preamble:
        preamble = ""
    if entries:
        body = (ENTRY_SEP + "\n" + ENTRY_SEP + "\n").join(entries)
    else:
        body = ""
    if preamble and body:
        return preamble.rstrip() + "\n\n" + body + "\n"
    if preamble:
        return preamble.rstrip() + "\n"
    if body:
        return body + "\n"
    return ""


def _find_entry_by_substring(
    entries: list[str], old_text: str
) -> tuple[Optional[int], Optional[str]]:
    """Find a unique entry containing ``old_text`` as substring.

    Returns ``(index, error_reason)``:
    - On success: ``(i, None)`` where entries[i] contains old_text
    - On no match: ``(None, "old_text does not match any entry")``
    - On multiple matches: ``(None, "old_text matches N entries,
      please be more specific")``
    """
    matches = [i for i, e in enumerate(entries) if old_text in e]
    if len(matches) == 0:
        return None, "old_text does not match any entry"
    if len(matches) > 1:
        return None, (
            f"old_text matches {len(matches)} entries, please be "
            f"more specific (use a longer substring that uniquely "
            f"identifies one entry)"
        )
    return matches[0], None


def split_preamble(content: str) -> tuple[str, list[str]]:
    """Split content into (preamble, entries).

    The preamble is everything before the first ``§``. The
    rest are entries (the § chunks). If the file has no §,
    everything is preamble (a file with only the leading
    `#` header is still valid — it just has no entries yet).
    """
    if not content:
        return "", []
    idx = content.find(ENTRY_SEP)
    if idx < 0:
        return content, []
    preamble = content[:idx]
    rest = content[idx:]
    entries = _split_entries(rest)
    return preamble, entries


class MemoryTool(Tool):
    """Manage MEMORY.md and USER.md from the agent loop.

    Single tool with an ``action`` parameter that dispatches
    to add/replace/remove. We use a single tool (rather than
    three) because the Anthropic SDK's tool dispatch treats
    each tool as independent and three near-duplicates just
    pollute the tool list. The system prompt's tool
    description explains the three actions.

    Optional ``write_approval`` gate (Hermes spec) — when True,
    the tool returns success=False with a "pending approval"
    marker instead of writing immediately. The caller (a
    human-in-the-loop wrapper) is responsible for approving
    the staged write. We don't implement the approval queue
    in this batch — just the gate. Future batches can wire
    the actual approval flow.
    """

    def __init__(
        self,
        agent_dir: str = "./workspace/.agent",
        write_approval: bool = False,
    ):
        self.agent_dir = Path(agent_dir)
        self.write_approval = write_approval

    @property
    def name(self) -> str:
        return "memory"

    @property
    def description(self) -> str:
        return (
            "Manage your persistent memory (MEMORY.md and USER.md). "
            "Three actions: "
            "  - 'add' (target, content) — append a new entry. "
            "Auto-rejects exact duplicates. If memory is full, "
            "returns the current entries so you can consolidate. "
            "  - 'replace' (target, old_text, content) — replace an "
            "existing entry. old_text is a short unique substring "
            "of the entry to replace. "
            "  - 'remove' (target, old_text) — remove an existing "
            "entry by unique substring. "
            "MEMORY.md holds 2,200 chars of your personal notes "
            "(env facts, conventions, lessons learned). USER.md "
            "holds 1,375 chars of the user's profile (preferences, "
            "communication style, expectations). Entries are "
            "§-separated, no headers. Use 'memory' for things you "
            "learned; use 'user' for things about the user. "
            "DO NOT save trivially re-discoverable info, raw data "
            "dumps, or session-specific ephemera."
        )

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": list(VALID_ACTIONS),
                    "description": "One of 'add', 'replace', 'remove'.",
                },
                "target": {
                    "type": "string",
                    "enum": VALID_TARGETS,
                    "description": (
                        "'memory' for MEMORY.md (your personal notes), "
                        "'user' for USER.md (user profile)."
                    ),
                },
                "content": {
                    "type": "string",
                    "description": (
                        "For 'add': the new entry text. For 'replace': "
                        "the new content to swap in. NOT used by 'remove'."
                    ),
                },
                "old_text": {
                    "type": "string",
                    "description": (
                        "For 'replace' and 'remove': a short unique "
                        "substring of the entry to modify. Must match "
                        "exactly one entry (Hermes pattern)."
                    ),
                },
            },
            "required": ["action", "target"],
        }

    # ─────────────────────────────────────────────────────────────────
    # File I/O
    # ─────────────────────────────────────────────────────────────────

    def _path_for(self, target: str) -> Path:
        """Return the on-disk path for the given target."""
        if target not in TARGETS:
            raise ValueError(f"unknown target: {target}")
        return self.agent_dir / TARGETS[target]["file"]

    def _read(self, target: str) -> str:
        """Read the file (empty string if missing)."""
        p = self._path_for(target)
        if not p.exists():
            return ""
        return p.read_text(encoding="utf-8")

    def _write(self, target: str, content: str) -> None:
        """Atomic write (tmp + replace) so a crash mid-write
        doesn't leave a half-written file.
        """
        p = self._path_for(target)
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(p.suffix + ".tmp")
        tmp.write_text(content, encoding="utf-8")
        tmp.replace(p)

    def _split_preamble(self, content: str) -> tuple[str, list[str]]:
        """Instance method wrapper around the static helper."""
        return split_preamble(content)

    # Static alias for tests + direct calls.
    _split_preamble_helper = staticmethod(split_preamble)

    # ─────────────────────────────────────────────────────────────────
    # Capacity check (Hermes spec)
    # ─────────────────────────────────────────────────────────────────

    def _check_capacity(
        self,
        target: str,
        new_total_content: str,
    ) -> tuple[bool, str]:
        """True if new_total_content fits in the char limit.

        Returns (fits, error_message). On overflow, error_message
        is the spec's exact format: ``Memory at X/limit chars.
        Adding this entry (Y chars) would exceed the limit.
        Consolidate now: ...``
        """
        limit = TARGETS[target]["char_limit"]
        used = len(new_total_content)
        if used > limit:
            # Hermes spec example format (paraphrased to fit our
            # two-target shape).
            entries = self._read(target)
            current_entries = _split_entries(entries)
            return False, (
                f"Memory at {used}/{limit} chars (target={target!r}). "
                f"Consolidate now: use 'replace' to merge overlapping "
                f"entries into shorter ones or 'remove' stale or less "
                f"important entries (see current_entries below), then "
                f"retry this add — all in this turn. "
                f"current_entries={json.dumps(current_entries, ensure_ascii=False)[:2000]}"
            )
        return True, ""

    # ─────────────────────────────────────────────────────────────────
    # Main dispatch
    # ─────────────────────────────────────────────────────────────────

    async def execute(
        self,
        action: str,
        target: str,
        content: str = "",
        old_text: str = "",
        **_: Any,
    ) -> ToolResult:
        """Dispatch to add/replace/remove.

        Returns ToolResult with:
          - success: True if the write was applied (or duplicate
            detected, per spec), False otherwise
          - content: human-readable summary for the LLM
          - error: structured error string when success=False
        """
        # Validate action + target up front
        if action not in VALID_ACTIONS:
            return ToolResult(
                success=False, content="",
                error=f"Invalid action {action!r}. Must be one of {VALID_ACTIONS}.",
            )
        if target not in VALID_TARGETS:
            return ToolResult(
                success=False, content="",
                error=f"Invalid target {target!r}. Must be one of {VALID_TARGETS}.",
            )

        # Security scan on content (only — old_text is a short
        # substring of EXISTING content, which already passed
        # the scan when it was written)
        if content and (reason := _scan_for_injection(content)) is not None:
            return ToolResult(
                success=False, content="",
                error=f"Memory write blocked: {reason}. "
                       f"Rephrase the content without the flagged pattern.",
            )

        # Dispatch
        try:
            if action == "add":
                return await self._add(target, content)
            if action == "replace":
                return await self._replace(target, old_text, content)
            if action == "remove":
                return await self._remove(target, old_text)
        except Exception as e:
            logger.exception("memory tool: unexpected error")
            return ToolResult(
                success=False, content="",
                error=f"memory tool: unexpected error: {e.__class__.__name__}: {e}",
            )

        # Unreachable — exhaustive dispatch above
        return ToolResult(success=False, content="", error="unreachable")

    # ─────────────────────────────────────────────────────────────────
    # Action handlers
    # ─────────────────────────────────────────────────────────────────

    async def _add(self, target: str, content: str) -> ToolResult:
        """Append a new entry. Rejects duplicates, enforces capacity."""
        content = content.strip()
        if not content:
            return ToolResult(
                success=False, content="",
                error="content is required for 'add'",
            )

        raw = self._read(target)
        preamble, entries = self._split_preamble(raw)

        # Duplicate check (exact match — Hermes spec)
        if content in entries:
            return ToolResult(
                success=True,
                content=f"No duplicate added: {content[:80]!r} already exists in {target!r}.",
            )

        # Capacity check on the post-write content
        new_entries = entries + [content]
        new_total = _join_entries(preamble, new_entries)
        fits, err = self._check_capacity(target, new_total)
        if not fits:
            return ToolResult(success=False, content="", error=err)

        # Optional write_approval gate
        if self.write_approval:
            # Hermes spec: when write_approval is on, writes are
            # staged for review. We don't implement the staging
            # queue in this batch — the gate just refuses. The
            # caller (an approval wrapper) is responsible for
            # re-invoking with write_approval=False once the user
            # approves.
            logger.info(
                "memory_write_staged",
                extra={
                    "target": target,
                    "action": "add",
                    "preview": content[:120],
                },
            )
            return ToolResult(
                success=False, content="",
                error="Memory write is gated by write_approval. "
                      "Awaiting user approval before persisting.",
            )

        # Persist
        self._write(target, new_total)
        self._audit("add", target, old_chars=len(raw), new_chars=len(new_total))
        return ToolResult(
            success=True,
            content=f"Added to {target!r}: {content[:80]!r}. "
                    f"Memory now at {len(new_total)}/{TARGETS[target]['char_limit']} chars.",
        )

    async def _replace(
        self, target: str, old_text: str, content: str,
    ) -> ToolResult:
        """Replace an entry matched by old_text."""
        content = content.strip()
        if not old_text:
            return ToolResult(
                success=False, content="",
                error="old_text is required for 'replace'",
            )
        if not content:
            return ToolResult(
                success=False, content="",
                error="content is required for 'replace'",
            )

        raw = self._read(target)
        preamble, entries = self._split_preamble(raw)

        idx, err = _find_entry_by_substring(entries, old_text)
        if idx is None:
            return ToolResult(success=False, content="", error=err)

        # Capacity check on the post-replace content
        new_entries = list(entries)
        new_entries[idx] = content
        new_total = _join_entries(preamble, new_entries)
        fits, err = self._check_capacity(target, new_total)
        if not fits:
            return ToolResult(success=False, content="", error=err)

        if self.write_approval:
            return ToolResult(
                success=False, content="",
                error="Memory write is gated by write_approval. "
                      "Awaiting user approval before persisting.",
            )

        self._write(target, new_total)
        self._audit("replace", target, old_chars=len(raw), new_chars=len(new_total))
        return ToolResult(
            success=True,
            content=f"Replaced entry in {target!r}: "
                    f"{entries[idx][:60]!r} → {content[:60]!r}. "
                    f"Memory now at {len(new_total)}/{TARGETS[target]['char_limit']} chars.",
        )

    async def _remove(self, target: str, old_text: str) -> ToolResult:
        """Remove an entry matched by old_text."""
        if not old_text:
            return ToolResult(
                success=False, content="",
                error="old_text is required for 'remove'",
            )

        raw = self._read(target)
        preamble, entries = self._split_preamble(raw)

        idx, err = _find_entry_by_substring(entries, old_text)
        if idx is None:
            return ToolResult(success=False, content="", error=err)

        new_entries = [e for i, e in enumerate(entries) if i != idx]
        new_total = _join_entries(preamble, new_entries)

        if self.write_approval:
            return ToolResult(
                success=False, content="",
                error="Memory write is gated by write_approval. "
                      "Awaiting user approval before persisting.",
            )

        self._write(target, new_total)
        self._audit("remove", target, old_chars=len(raw), new_chars=len(new_total))
        return ToolResult(
            success=True,
            content=f"Removed entry from {target!r}: {entries[idx][:60]!r}. "
                    f"Memory now at {len(new_total)}/{TARGETS[target]['char_limit']} chars.",
        )

    # ─────────────────────────────────────────────────────────────────
    # Audit log
    # ─────────────────────────────────────────────────────────────────

    def _audit(
        self,
        action: str,
        target: str,
        *,
        old_chars: int,
        new_chars: int,
    ) -> None:
        """Structured log line for the audit trail.

        Format mirrors the existing structured logs in
        web/backend/main.py (compact JSON in the message). The
        caller can grep /usr/local/logs/agent_runs/*.log for
        ``memory_write`` events to reconstruct what the agent
        changed between sessions.
        """
        logger.info(
            "memory_write",
            extra={
                "action": action,
                "target": target,
                "old_chars": old_chars,
                "new_chars": new_chars,
                "delta": new_chars - old_chars,
                "ts": time.time(),
            },
        )
