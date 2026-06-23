"""Agent context loader — reads the four .agent/*.md files + today's daily
into a frozen snapshot that gets injected into the system prompt.

Per spec:
- Five files live in workspace/.agent/: SOUL.md, IDENTITY.md, USER.md,
  MEMORY.md, daily/YYYY-MM-DD.md
- Snapshot is captured once at session start, doesn't change
  mid-session (preserves LLM prefix cache, Hermes pattern)
- Graceful degradation: empty/missing files work; banner / wizard
  surface what needs filling, but never block startup
- Char limits (Hermes): SOUL 2.000, IDENTITY 2.000, USER 1.375, MEMORY 2.200
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

_logger = logging.getLogger(__name__)


# --- Char limits (Hermes parity) ---
CHAR_LIMIT_SOUL = 2_000
CHAR_LIMIT_IDENTITY = 2_000
CHAR_LIMIT_USER = 1_375
CHAR_LIMIT_MEMORY = 2_200

CHAR_LIMITS = {
    "soul": CHAR_LIMIT_SOUL,
    "identity": CHAR_LIMIT_IDENTITY,
    "user": CHAR_LIMIT_USER,
    "memory": CHAR_LIMIT_MEMORY,
}


# Threshold for "user has actually filled this in" vs "still just a scaffold".
# Our shipped scaffolds are ~250 chars (header + Hermes link + a hint line);
# real user content is typically much longer. Anything below this counts
# as empty for the banner/wizard purposes.
MIN_CONTENT_CHARS = 500


@dataclass
class FileStatus:
    """One file's load state."""

    path: Path
    exists: bool
    readable: bool
    content: str | None  # None if missing or corrupt
    corrupt_reason: str | None = None
    char_count: int = 0
    over_limit: bool = False
    limit: int = 0

    @property
    def id(self) -> str:
        """Stable id (e.g. 'soul', 'memory', 'daily/2026-06-23').

        Matches the keys in CHAR_LIMITS for the four single files
        (lowercase stem). Daily logs use the date from the filename.
        """
        stem = self.path.stem.lower()
        if "daily" in self.path.parts:
            # daily/{date}.md → "daily/{date}"
            return f"daily/{self.path.stem}"
        return stem


@dataclass
class AgentContext:
    """Frozen snapshot of all four files + today's daily.

    Built once per session by `load_agent_context()`. Never mutated
    after that point — see SPEC §2.1.
    """

    soul: FileStatus
    identity: FileStatus
    user: FileStatus
    memory: FileStatus
    daily: FileStatus  # today's daily; missing/corrupt if no turns today yet

    @property
    def is_complete(self) -> bool:
        """All four single files exist + readable + meaningfully filled.

        "Meaningfully filled" = content beyond the scaffold placeholder
        (~500 char threshold). The scaffolds we ship contain header +
        link + a hint line — meta-information, not actual personality.
        Below the threshold, the banner/wizard still prompt the user.
        """
        return all(
            f.exists and f.readable and f.char_count >= MIN_CONTENT_CHARS
            for f in (self.soul, self.identity, self.user, self.memory)
        )

    @property
    def missing_files(self) -> list[str]:
        """Files that are missing, unreadable, OR still just a scaffold."""
        out = []
        for f in (self.soul, self.identity, self.user, self.memory):
            if not f.exists or not f.readable:
                out.append(f.id)
                continue
            if f.char_count < MIN_CONTENT_CHARS:
                out.append(f.id)
        return out

    @property
    def corrupt_files(self) -> list[str]:
        return [
            f.id for f in (self.soul, self.identity, self.user, self.memory)
            if f.exists and not f.readable
        ]

    def to_incomplete_flag(self) -> dict:
        """The `incomplete_context` payload returned by `/api/config`.

        Empty dict means "all good, hide the banner".
        """
        return {
            "missing": self.missing_files,
            "corrupt": self.corrupt_files,
            # Helper: any banner needs to show when at least one file is gone.
            "banner_visible": bool(self.missing_files or self.corrupt_files),
        }

    def to_prompt_sections(self) -> dict[str, str]:
        """Render the four files + daily into prompt sections.

        Empty content is rendered as empty string — the slot still
        appears in the prompt but with no text. This keeps the prompt
        shape stable across sessions.
        """
        return {
            "soul": (self.soul.content or "").strip(),
            "identity": (self.identity.content or "").strip(),
            "user": (self.user.content or "").strip(),
            "memory": (self.memory.content or "").strip(),
            "daily": (self.daily.content or "").strip(),
        }


# --- Loaders ---

def _load_one(path: Path, limit: int, *, allow_missing: bool = True) -> FileStatus:
    """Load a single file with status reporting.

    Missing files: FileStatus(exists=False, content=None) unless
    allow_missing=False (raises).
    """
    status = FileStatus(path=path, exists=False, readable=False, content=None, limit=limit)

    if not path.exists():
        if not allow_missing:
            raise FileNotFoundError(f"Required context file missing: {path}")
        return status

    status.exists = True
    try:
        content = path.read_text(encoding="utf-8")
    except OSError as e:
        status.corrupt_reason = f"read error: {e}"
        return status
    except UnicodeDecodeError as e:
        status.corrupt_reason = f"encoding error: {e}"
        return status

    status.readable = True
    status.content = content
    status.char_count = len(content)
    if len(content) > limit:
        status.over_limit = True
        # Don't truncate — caller decides. Log it.
        _logger.warning(
            f"Context file {path} is over the char limit "
            f"({len(content)} > {limit}). Will be truncated at prompt time."
        )
    return status


def _today_daily_path(agent_dir: Path) -> Path:
    """Path to today's daily log. No file = empty content (lazy creation)."""
    return agent_dir / "daily" / f"{date.today().isoformat()}.md"


def load_agent_context(agent_dir: Path) -> AgentContext:
    """Load all four .agent/*.md files + today's daily log.

    Graceful: returns a complete AgentContext even if files are missing
    or unreadable. Caller checks `is_complete`, `missing_files`,
    `corrupt_files`, `to_incomplete_flag()`.

    Daily log is read-only here — creation happens on the first agent
    turn of the day (see `append_daily_turn()`).
    """
    agent_dir = Path(agent_dir)

    return AgentContext(
        soul=_load_one(agent_dir / "SOUL.md", CHAR_LIMIT_SOUL),
        identity=_load_one(agent_dir / "IDENTITY.md", CHAR_LIMIT_IDENTITY),
        user=_load_one(agent_dir / "USER.md", CHAR_LIMIT_USER),
        memory=_load_one(agent_dir / "MEMORY.md", CHAR_LIMIT_MEMORY),
        daily=_load_one(_today_daily_path(agent_dir), limit=10_000_000),  # no real limit on daily
    )


# --- Render helpers for the system prompt ---

def render_memory_prompt(content: str, used: int, limit: int = CHAR_LIMIT_MEMORY) -> str:
    """Hermes-style memory header + entries.

    Per spec §5.1: usage header line + flat entries separated by `§`,
    no `##` sections (Hermes pattern, more LLM-friendly).
    """
    if not content.strip():
        return ""
    pct = round(100 * used / limit) if limit else 0
    header = f"══════════════════════════════════════════════\nMEMORY (agent notes) [{pct}% — {used}/{limit} chars]\n══════════════════════════════════════════════"
    # Split on § separator (Hermes pattern); keep entries as-is.
    parts = [p.strip() for p in content.split("§") if p.strip()]
    body = "\n§\n".join(parts)
    return f"{header}\n{body}"


def render_simple_prompt(content: str, label: str) -> str:
    """SOUL / IDENTITY / USER — just the content (no header)."""
    return content.strip() if content else ""


# --- Daily append ---

def append_daily_turn(
    agent_dir: Path,
    role: str,           # "user" | "assistant" | "system"
    content: str,        # the turn's message text
    *,
    thinking: str | None = None,
    ts: str | None = None,  # HH:MM:SS; default now()
) -> Path:
    """Append one block to today's daily log.

    Per spec §5.2:
        ## HH:MM:SS — role
        "message text"
        ## HH:MM:SS — assistant
        thinking: ...
        "message text"
        ---

    Creates the daily file + directory on first call of the day.
    Returns the path written.
    """
    from datetime import datetime

    agent_dir = Path(agent_dir)
    daily_dir = agent_dir / "daily"
    daily_dir.mkdir(parents=True, exist_ok=True)
    path = daily_dir / f"{date.today().isoformat()}.md"

    if ts is None:
        ts = datetime.now().strftime("%H:%M:%S")

    block_lines = [f"## {ts} — {role}"]
    if thinking and thinking.strip():
        block_lines.append(f"thinking: {thinking.strip()}")
    block_lines.append(content.strip() if content else "")
    block_lines.append("---")

    # Create header on first write of the day
    if not path.exists():
        path.write_text(
            f"# Daily log — {date.today().isoformat()}\n\n"
            "Append-only. Generated by the agent on each turn.\n\n",
            encoding="utf-8",
        )

    with path.open("a", encoding="utf-8") as f:
        f.write("\n".join(block_lines) + "\n")

    return path


def list_recent_dailies(agent_dir: Path, n: int = 7) -> list[Path]:
    """Return the N most recent daily log files, newest first."""
    agent_dir = Path(agent_dir)
    daily_dir = agent_dir / "daily"
    if not daily_dir.exists():
        return []
    files = sorted(daily_dir.glob("*.md"), key=lambda p: p.name, reverse=True)
    return files[:n]


# --- Validation ---

def validate_over_limit(content: str, file_id: str) -> tuple[bool, int, int]:
    """Returns (over_limit, used, limit) for a file id ('soul', 'memory', ...)."""
    limit = CHAR_LIMITS.get(file_id, 0)
    used = len(content or "")
    if limit <= 0:
        # Unknown file id → no limit to enforce.
        return (False, used, 0)
    return (used > limit, used, limit)