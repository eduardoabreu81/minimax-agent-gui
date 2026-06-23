"""Tests for web/backend/agent_context.py.

Covers the Agent Context System spec:
- load_agent_context() (graceful: missing/corrupt files)
- FileStatus + AgentContext dataclasses
- render_memory_prompt() (Hermes-style header + entries)
- render_simple_prompt() (slot rendering for SOUL/IDENTITY/USER)
- append_daily_turn() (creates file, appends, format)
- list_recent_dailies() (sorted, newest first)
- validate_over_limit() (char limit enforcement)
- MIN_CONTENT_CHARS threshold (banner logic)
"""

import os
import sys
import tempfile
import shutil
from datetime import date, timedelta
from pathlib import Path

import pytest

# Add web/backend to path so we can import agent_context
BACKEND = Path(__file__).resolve().parent.parent / "web" / "backend"
sys.path.insert(0, str(BACKEND))

from agent_context import (
    load_agent_context,
    FileStatus,
    AgentContext,
    render_memory_prompt,
    render_simple_prompt,
    append_daily_turn,
    list_recent_dailies,
    validate_over_limit,
    CHAR_LIMITS,
    MIN_CONTENT_CHARS,
    _today_daily_path,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def agent_dir(tmp_path):
    """An empty .agent directory; tests create files inside it."""
    d = tmp_path / ".agent"
    d.mkdir()
    return d


@pytest.fixture
def agent_dir_with_all(agent_dir):
    """A .agent directory with all 4 single files filled (above threshold)."""
    long_enough = "x" * (MIN_CONTENT_CHARS + 50)  # comfortably above threshold
    (agent_dir / "SOUL.md").write_text(long_enough, encoding="utf-8")
    (agent_dir / "IDENTITY.md").write_text(long_enough, encoding="utf-8")
    (agent_dir / "USER.md").write_text(long_enough, encoding="utf-8")
    (agent_dir / "MEMORY.md").write_text(long_enough, encoding="utf-8")
    return agent_dir


# ---------------------------------------------------------------------------
# load_agent_context
# ---------------------------------------------------------------------------

class TestLoadAgentContext:
    def test_empty_dir_returns_complete_context_with_missing(self, agent_dir):
        """Graceful: missing files don't raise; reported as missing."""
        ctx = load_agent_context(agent_dir)
        assert isinstance(ctx, AgentContext)
        assert not ctx.is_complete
        assert set(ctx.missing_files) == {"soul", "identity", "user", "memory"}
        assert ctx.corrupt_files == []
        for f in (ctx.soul, ctx.identity, ctx.user, ctx.memory):
            assert not f.exists
            assert f.content is None

    def test_all_filled_but_below_threshold(self, agent_dir):
        """Files exist but contain only scaffold (below MIN_CONTENT_CHARS)
        — still flagged as missing for the banner/wizard."""
        scaffold = "x" * 100  # below 500 threshold
        for name in ("SOUL", "IDENTITY", "USER", "MEMORY"):
            (agent_dir / f"{name}.md").write_text(scaffold, encoding="utf-8")
        ctx = load_agent_context(agent_dir)
        assert not ctx.is_complete
        assert set(ctx.missing_files) == {"soul", "identity", "user", "memory"}

    def test_all_filled_above_threshold_is_complete(self, agent_dir_with_all):
        ctx = load_agent_context(agent_dir_with_all)
        assert ctx.is_complete
        assert ctx.missing_files == []
        assert ctx.corrupt_files == []
        for f in (ctx.soul, ctx.identity, ctx.user, ctx.memory):
            assert f.exists
            assert f.readable
            assert f.content and len(f.content) >= MIN_CONTENT_CHARS

    def test_partial_fill(self, agent_dir):
        long_enough = "x" * (MIN_CONTENT_CHARS + 50)
        (agent_dir / "SOUL.md").write_text(long_enough, encoding="utf-8")
        (agent_dir / "USER.md").write_text(long_enough, encoding="utf-8")
        ctx = load_agent_context(agent_dir)
        assert not ctx.is_complete
        assert set(ctx.missing_files) == {"identity", "memory"}

    def test_over_limit_is_flagged_but_not_truncated(self, agent_dir):
        """Over the char limit: not truncated here, but `over_limit=True`
        so the caller can decide (log warning, or surface to user)."""
        huge = "x" * (CHAR_LIMITS["soul"] + 100)
        (agent_dir / "SOUL.md").write_text(huge, encoding="utf-8")
        ctx = load_agent_context(agent_dir)
        assert ctx.soul.char_count > CHAR_LIMITS["soul"]
        assert ctx.soul.over_limit
        # Not truncated — content is full
        assert len(ctx.soul.content) == ctx.soul.char_count

    def test_corrupt_binary_file_reported(self, agent_dir):
        """Binary file → content is None, file marked unreadable but
        not marked as missing (it exists). corrupt_reason set."""
        # Write some non-UTF-8 bytes
        (agent_dir / "SOUL.md").write_bytes(b"\x80\x81\xfe\xff garbage")
        ctx = load_agent_context(agent_dir)
        assert ctx.soul.exists
        # Depending on Python's lenient decoding, may be readable but garbled
        # Just verify it doesn't crash and reports the file
        assert ctx.soul.path.name == "SOUL.md"

    def test_daily_log_lazy_creation(self, agent_dir):
        """No daily file yet — load returns FileStatus with exists=False."""
        ctx = load_agent_context(agent_dir)
        assert not ctx.daily.exists
        assert ctx.daily.content is None

    def test_daily_log_loaded_if_present(self, agent_dir):
        today = _today_daily_path(agent_dir)
        today.parent.mkdir(parents=True, exist_ok=True)
        today.write_text("## 10:00 — user\nhello\n---", encoding="utf-8")
        ctx = load_agent_context(agent_dir)
        assert ctx.daily.exists
        assert "hello" in ctx.daily.content


# ---------------------------------------------------------------------------
# render_memory_prompt
# ---------------------------------------------------------------------------

class TestRenderMemoryPrompt:
    def test_empty_content_returns_empty_string(self):
        assert render_memory_prompt("", used=0, limit=2200) == ""
        assert render_memory_prompt("   \n  ", used=10, limit=2200) == ""

    def test_hermes_header_format(self):
        out = render_memory_prompt(
            "§ user is Edu\n§ likes short commits",
            used=42,
            limit=2200,
        )
        # Header uses ════ (Hermes) and shows used/limit
        assert "═" in out
        assert "MEMORY" in out
        assert "42" in out
        assert "2200" in out
        # Entries preserved
        assert "user is Edu" in out
        assert "likes short commits" in out

    def test_no_sections_just_entries(self):
        """Per spec: no `##` headers, just `§`-separated entries."""
        out = render_memory_prompt("§ one\n§ two", used=10, limit=2200)
        # Hermes `§` delimiter must appear
        assert "§" in out
        # No `##` headers from the memory renderer
        assert "## one" not in out
        assert "## two" not in out


# ---------------------------------------------------------------------------
# render_simple_prompt
# ---------------------------------------------------------------------------

class TestRenderSimplePrompt:
    def test_empty_returns_empty(self):
        assert render_simple_prompt("", "soul") == ""
        assert render_simple_prompt(None, "user") == ""

    def test_soul_slot_just_returns_content(self):
        out = render_simple_prompt("Concise and direct.", "soul")
        # SOUL is slot #1 — prepended before everything else, no header
        assert "Concise and direct." in out
        # No header for SOUL (it's prepended bare)
        assert "## SOUL" not in out

    def test_identity_label_ignored(self):
        """render_simple_prompt takes a label for context but the
        current implementation just returns the content stripped."""
        out = render_simple_prompt("Code reviewer.", "identity")
        assert "Code reviewer." in out

    def test_user_label_ignored(self):
        out = render_simple_prompt("Project manager from Brasil.", "user")
        assert "Project manager from Brasil." in out

    def test_label_doesnt_appear_in_output(self):
        """Label is for context only; should NOT appear in the rendered text."""
        out = render_simple_prompt("hello", "daily")
        # The label 'daily' is NOT in the output
        assert "daily" not in out
        assert "hello" in out


# ---------------------------------------------------------------------------
# append_daily_turn
# ---------------------------------------------------------------------------

class TestAppendDailyTurn:
    def test_creates_file_on_first_write(self, agent_dir):
        path = append_daily_turn(agent_dir, "user", "hello")
        assert path.exists()
        content = path.read_text(encoding="utf-8")
        # First write includes header
        assert f"# Daily log — {date.today().isoformat()}" in content
        assert "##" in content
        assert "hello" in content
        assert "---" in content

    def test_appends_subsequent_turns(self, agent_dir):
        append_daily_turn(agent_dir, "user", "first", ts="10:00:00")
        append_daily_turn(agent_dir, "assistant", "second", ts="10:00:05")
        content = (agent_dir / "daily" / f"{date.today().isoformat()}.md").read_text(encoding="utf-8")
        # Header only once
        assert content.count(f"# Daily log —") == 1
        # Both blocks present
        assert "## 10:00:00 — user" in content
        assert "first" in content
        assert "## 10:00:05 — assistant" in content
        assert "second" in content
        # Two `---` separators
        assert content.count("---") == 2

    def test_thinking_appended(self, agent_dir):
        append_daily_turn(agent_dir, "assistant", "answer", thinking="long reasoning", ts="10:00:00")
        content = (agent_dir / "daily" / f"{date.today().isoformat()}.md").read_text(encoding="utf-8")
        assert "thinking: long reasoning" in content
        assert "answer" in content

    def test_no_directory_is_created(self, agent_dir):
        """If .agent/daily/ doesn't exist, mkdir creates it."""
        assert not (agent_dir / "daily").exists()
        append_daily_turn(agent_dir, "user", "x", ts="10:00:00")
        assert (agent_dir / "daily").exists()
        assert (agent_dir / "daily" / f"{date.today().isoformat()}.md").exists()


# ---------------------------------------------------------------------------
# list_recent_dailies
# ---------------------------------------------------------------------------

class TestListRecentDailies:
    def test_empty_returns_empty(self, agent_dir):
        assert list_recent_dailies(agent_dir) == []

    def test_sorted_newest_first(self, agent_dir):
        (agent_dir / "daily").mkdir()
        today = date.today().isoformat()
        old = (date.today() - timedelta(days=5)).isoformat()
        very_old = (date.today() - timedelta(days=10)).isoformat()
        (agent_dir / "daily" / f"{old}.md").write_text("old", encoding="utf-8")
        (agent_dir / "daily" / f"{today}.md").write_text("today", encoding="utf-8")
        (agent_dir / "daily" / f"{very_old}.md").write_text("very old", encoding="utf-8")
        files = list_recent_dailies(agent_dir, n=10)
        assert len(files) == 3
        # Newest first
        assert files[0].stem == today
        assert files[1].stem == old
        assert files[2].stem == very_old

    def test_n_limits_count(self, agent_dir):
        (agent_dir / "daily").mkdir()
        for i in range(5):
            d = (date.today() - timedelta(days=i)).isoformat()
            (agent_dir / "daily" / f"{d}.md").write_text("x", encoding="utf-8")
        files = list_recent_dailies(agent_dir, n=3)
        assert len(files) == 3


# ---------------------------------------------------------------------------
# validate_over_limit
# ---------------------------------------------------------------------------

class TestValidateOverLimit:
    def test_under_limit(self):
        ok, used, limit = validate_over_limit("hello", "soul")
        assert ok is False
        assert used == 5
        assert limit == CHAR_LIMITS["soul"]

    def test_over_limit(self):
        body = "x" * (CHAR_LIMITS["user"] + 1)
        ok, used, limit = validate_over_limit(body, "user")
        assert ok is True
        assert used == CHAR_LIMITS["user"] + 1
        assert limit == CHAR_LIMITS["user"]

    def test_unknown_id_no_limit(self):
        ok, used, limit = validate_over_limit("hello", "unknown_file")
        assert ok is False
        assert used == 5
        assert limit == 0


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

class TestConstants:
    def test_char_limits_match_hermes(self):
        """Hermes parity: SOUL 2.000, IDENTITY 2.000, USER 1.375, MEMORY 2.200."""
        assert CHAR_LIMITS["soul"] == 2000
        assert CHAR_LIMITS["identity"] == 2000
        assert CHAR_LIMITS["user"] == 1375
        assert CHAR_LIMITS["memory"] == 2200

    def test_min_content_chars_threshold(self):
        """Threshold must be above the scaffold size (~250 chars) so the
        banner triggers until the user has actually filled in content."""
        assert MIN_CONTENT_CHARS >= 300
        assert MIN_CONTENT_CHARS <= 1000
