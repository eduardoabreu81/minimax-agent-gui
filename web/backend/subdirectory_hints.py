"""Progressive subdirectory discovery for project context files.

Implements the Hermes spec for project context files that get loaded
progressively as the agent navigates into subdirectories. The CWD's
AGENTS.md / CLAUDE.md / .cursorrules is the canonical project context;
subdirectory AGENTS.md / CLAUDE.md / .cursorrules files get appended
to the relevant tool result so the model sees the project conventions
naturally as it reads files or runs shell commands deeper in the tree.

Spec reference:
  https://hermes-agent.nousresearch.com/docs/user-guide/features/context-files
  (section "Progressive Subdirectory Discovery")

Key invariants (per spec):
- First match per directory: AGENTS.md > CLAUDE.md > .cursorrules
- Each directory is checked at most once per session (in-memory cache)
- Discovery walks up to 5 parent directories (stops at workspace root)
- Truncation: 8,000 chars per file (head/tail split)
- Same security scan as the rest of the agent context pipeline
- `.cursorrules` is CWD-only (Hermes spec) — handled by the caller; this
  module's `hint_for_path` treats all three files equivalently on lookup
  so it works in any subdirectory the agent navigates to.

This module is intentionally pure (no I/O outside of `Path.read_text`)
so it's trivially testable with pytest's `tmp_path` fixture. Wiring
into the agent loop is the session_manager's job (see main.py).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


# --- Constants (per Hermes spec) ---

MAX_HINT_CHARS = 8_000
MAX_PARENT_DEPTH = 5
CANDIDATE_FILES: tuple[str, ...] = ("AGENTS.md", "CLAUDE.md", ".cursorrules")

# Head / tail split for truncation (Hermes spec).
HEAD_RATIO = 0.70
TAIL_RATIO = 0.20


# --- Security scan ---

# Pattern set is aligned with mini_agent/tools/memory_tool.py so the
# same context files and the same memory writes go through the same
# injection checks. Adding a pattern here means adding it there too
# (and vice versa) — keep the two in sync.
_INJECTION_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"ignore\s+(?:all\s+)?previous\s+instructions", re.IGNORECASE),
    re.compile(r"disregard\s+your\s+(?:rules|instructions)", re.IGNORECASE),
    re.compile(r"system\s+prompt\s+override", re.IGNORECASE),
    re.compile(r"do\s+not\s+tell\s+the\s+user", re.IGNORECASE),
    re.compile(r"<!--\s*ignore", re.IGNORECASE),
    re.compile(r"<div\s+style\s*=\s*[\"']display\s*:\s*none", re.IGNORECASE),
    re.compile(r"curl\s+.*?\$\{?API_KEY", re.IGNORECASE),
    re.compile(r"cat\s+\.env", re.IGNORECASE),
    # Invisible unicode: zero-width, bidi overrides, word joiner
    re.compile(
        r"[\u200b\u200c\u200d\u2060\ufeff"
        r"\u200e\u200f\u202a-\u202e\u2066-\u2069]"
    ),
)


def scan_for_injection(content: str) -> str | None:
    """Return the regex pattern that matched, or None if content is safe.

    The label returned is the raw regex pattern — caller decides how
    to surface this (typically: log a warning, return a blocked
    ProjectContextFile with a placeholder body).
    """
    for pattern in _INJECTION_PATTERNS:
        if pattern.search(content):
            return pattern.pattern
    return None


# --- Helper: load a single project context file ---

@dataclass(frozen=True)
class ProjectContextFile:
    """One project context file discovered in a directory.

    Frozen snapshot — content is read once. `blocked=True` means the
    security scan refused the bytes; in that case `content` is a
    short placeholder so the model can see the file exists but the
    raw bytes never reach the prompt.
    """

    directory: Path
    filename: str
    content: str
    blocked: bool = False
    block_reason: str | None = None


def _load_project_context_file(
    directory: Path,
    *,
    max_chars: int = MAX_HINT_CHARS,
) -> ProjectContextFile | None:
    """Load the first matching context file in `directory`, or None.

    Per Hermes priority: AGENTS.md > CLAUDE.md > .cursorrules.
    The security scan is applied to the raw bytes; if blocked, the
    returned ProjectContextFile carries a placeholder content (the
    raw bytes are NOT included). Truncation to `max_chars` uses
    Hermes' head/tail split (70% head, 20% tail, 10% marker).
    """
    if not directory.is_dir():
        return None
    for filename in CANDIDATE_FILES:
        path = directory / filename
        if not path.is_file():
            continue
        try:
            raw = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        threat = scan_for_injection(raw)
        if threat is not None:
            return ProjectContextFile(
                directory=directory,
                filename=filename,
                content=(
                    f"[BLOCKED: {filename} contained potential prompt "
                    f"injection. Content not loaded.]"
                ),
                blocked=True,
                block_reason=threat,
            )
        content = _truncate(raw, max_chars)
        return ProjectContextFile(
            directory=directory,
            filename=filename,
            content=content,
        )
    return None


def _truncate(content: str, max_chars: int) -> str:
    """Head/tail truncation per Hermes spec (70% head, 20% tail, 10% marker).

    The marker is padded (or truncated) so the returned string is
    *exactly* `max_chars` long. The full count info
    ("kept X+Y of Z chars") is included when the budget allows;
    otherwise the marker is trimmed down to fit.
    """
    if len(content) <= max_chars:
        return content
    head_chars = int(max_chars * HEAD_RATIO)
    tail_chars = int(max_chars * TAIL_RATIO)
    marker_budget = max_chars - head_chars - tail_chars
    full_marker = (
        f"[...truncated: kept {head_chars}+{tail_chars} of "
        f"{len(content)} chars. Use file tools to read the full file.]"
    )
    if len(full_marker) <= marker_budget:
        marker = full_marker + " " * (marker_budget - len(full_marker))
    else:
        # Not enough room for the count info; trim the marker itself.
        marker = full_marker[:marker_budget]
    head = content[:head_chars]
    tail = content[-tail_chars:]
    return head + marker + tail


# --- Tracker: progressive subdirectory discovery ---

@dataclass
class SubdirectoryHintTracker:
    """Watches tool call arguments and surfaces project context hints.

    Per Hermes spec: as the agent navigates into subdirectories during
    a session, the relevant project context file is discovered and
    appended to the tool result so the model sees the conventions
    naturally.

    The tracker holds a per-session cache (`visited_dirs`) so each
    directory is checked at most once. Use `hint_for_tool_call()` after
    every tool execution; if a hint is returned, append it to the tool
    result before it becomes a message in the agent's history.

    One tracker instance per Agent (session). Not thread-safe — the
    agent loop is single-threaded per session.
    """

    workspace_dir: Path
    max_ancestors: int = MAX_PARENT_DEPTH
    max_chars: int = MAX_HINT_CHARS
    visited_dirs: set[Path] = field(default_factory=set)

    def __post_init__(self) -> None:
        self.workspace_dir = Path(self.workspace_dir).resolve()

    # --- Public API ---

    def hint_for_tool_call(
        self,
        tool_name: str,
        arguments: dict[str, Any],
    ) -> list[ProjectContextFile]:
        """Inspect a tool call's arguments for file paths; return context hints.

        Returns one ProjectContextFile per newly-discovered directory
        (may be empty if all paths were already visited or had no
        context file).
        """
        paths = self._extract_paths(tool_name, arguments)
        hints: list[ProjectContextFile] = []
        for path in paths:
            hints.extend(self.hint_for_path(path))
        return hints

    def hint_for_path(self, file_path: Path | str) -> list[ProjectContextFile]:
        """Walk up from `file_path` and return hints for any new dirs.

        Walks up to `max_ancestors` parent directories (stopping at the
        workspace root). For each directory not yet visited, attempts
        to load the project context file; if found, the directory is
        marked as visited AND the hint is added to the result.

        Returns the hints in walk-up order (most specific first).
        """
        try:
            target = Path(file_path).resolve()
        except (OSError, ValueError):
            return []
        if not target.is_absolute():
            target = (self.workspace_dir / target).resolve()
        starting_dir = target if target.is_dir() else target.parent
        # Build the candidate list (most specific → least specific).
        candidates: list[Path] = []
        current: Path | None = starting_dir
        for _ in range(self.max_ancestors + 1):
            if current is None:
                break
            try:
                current_resolved = current.resolve()
            except (OSError, ValueError):
                break
            if (
                self.workspace_dir != current_resolved
                and self.workspace_dir not in current_resolved.parents
            ):
                # Walked above the workspace root — stop.
                break
            candidates.append(current_resolved)
            if current_resolved == self.workspace_dir:
                break
            current = current_resolved.parent
        hints: list[ProjectContextFile] = []
        for directory in candidates:
            if directory in self.visited_dirs:
                continue
            self.visited_dirs.add(directory)
            loaded = _load_project_context_file(directory, max_chars=self.max_chars)
            if loaded is not None:
                hints.append(loaded)
        return hints

    # --- Internal helpers ---

    @staticmethod
    def _extract_paths(tool_name: str, arguments: dict[str, Any]) -> list[Path]:
        """Pull candidate file paths from a tool call's arguments.

        Best-effort per tool type:
        - read_file / write_file / edit_file: ``path`` arg
        - bash / terminal: extract path-like tokens from ``command``
        - search_files / glob / list_dir: ``path`` or ``directory`` arg
        - default fallback: scan string values for path-like tokens
        """
        out: list[Path] = []
        if not isinstance(arguments, dict):
            return out
        if tool_name in {"read_file", "write_file", "edit_file"}:
            for key in ("path", "file_path", "filepath"):
                v = arguments.get(key)
                if isinstance(v, str) and v:
                    out.append(Path(v))
        elif tool_name in {"bash", "terminal"}:
            cmd = arguments.get("command", "")
            if isinstance(cmd, str):
                # Split on whitespace + quotes; keep tokens that look
                # like paths. Skip flags (start with -) and obviously
                # non-path tokens (no slash, no leading dot).
                tokens = re.findall(r"[^\s\"']+", cmd)
                for tok in tokens:
                    if tok.startswith("-"):
                        continue
                    if tok.startswith((".", "/", "~")) or "/" in tok or "\\" in tok:
                        out.append(Path(tok))
        elif tool_name in {"search_files", "glob", "list_dir"}:
            for key in ("path", "directory", "dir", "pattern"):
                v = arguments.get(key)
                if isinstance(v, str) and v:
                    out.append(Path(v))
        else:
            # Generic fallback: scan string values for path-like tokens.
            for v in arguments.values():
                if isinstance(v, str) and ("/" in v or "\\" in v):
                    out.append(Path(v))
        return out


# --- Hint rendering for the model ---

def format_hints_for_model(hints: list[ProjectContextFile]) -> str:
    """Render hints as a single string block ready to append to a tool result.

    Empty list → empty string. Each hint gets a header so the model
    can tell which directory and which file the hint came from.
    """
    if not hints:
        return ""
    parts: list[str] = []
    for hint in hints:
        header = f"\n\n--- Project context: {hint.directory / hint.filename} ---"
        parts.append(header + "\n" + hint.content)
    return "".join(parts)
