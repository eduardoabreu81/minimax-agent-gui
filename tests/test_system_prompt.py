"""Validate the agent system prompt has the 'Task Planning & Tracking' section.

Regression guard against accidental removal of the guidance that teaches the
agent to create tasks with verifiable definitions of done (certainty) and
logically-sequenced plans (coherence).

The system prompt is loaded from `mini_agent/config/system_prompt.md` at agent
startup, so a missing section directly degrades agent behavior.
"""

import re
from pathlib import Path

import pytest


SYSTEM_PROMPT_PATH = (
    Path(__file__).resolve().parent.parent / "mini_agent" / "config" / "system_prompt.md"
)


@pytest.fixture(scope="module")
def system_prompt_text() -> str:
    return SYSTEM_PROMPT_PATH.read_text(encoding="utf-8")


def _extract_section(text: str, heading: str) -> str | None:
    """Return the body of a `### Heading` markdown section, or None."""
    pattern = re.escape(heading) + r"\s*\n(.*?)(?=\n### |\Z)"
    match = re.search(pattern, text, flags=re.DOTALL)
    return match.group(1) if match else None


def test_task_planning_section_exists(system_prompt_text: str) -> None:
    """The 'Task Planning & Tracking' section must be present."""
    assert "### Task Planning & Tracking" in system_prompt_text, (
        "Task Planning & Tracking section missing from system_prompt.md. "
        "This section teaches the agent the certainty/coherence discipline "
        "for tasks_create / tasks_update."
    )


def test_task_planning_section_mentions_both_tools(system_prompt_text: str) -> None:
    """The section must reference both tasks_create and tasks_update by name."""
    section = _extract_section(system_prompt_text, "### Task Planning & Tracking")
    assert section is not None, "Could not locate Task Planning & Tracking section"
    assert "tasks_create" in section, "Section must reference tasks_create"
    assert "tasks_update" in section, "Section must reference tasks_update"


def test_task_planning_section_defines_quality_filters(system_prompt_text: str) -> None:
    """The section must spell out the three quality filters: certainty, coherence, action-orientation."""
    section = _extract_section(system_prompt_text, "### Task Planning & Tracking")
    assert section is not None
    section_lower = section.lower()
    assert "certainty" in section_lower, "Section must mention 'certainty'"
    assert "coherence" in section_lower, "Section must mention 'coherence'"
    assert "action" in section_lower, "Section must mention action-oriented titles"


def test_task_planning_section_has_lifecycle_discipline(system_prompt_text: str) -> None:
    """The section must cover the lifecycle: in-progress transition + done verification."""
    section = _extract_section(system_prompt_text, "### Task Planning & Tracking")
    assert section is not None
    section_lower = section.lower()
    assert "in-progress" in section_lower, (
        "Section must explain the in-progress transition"
    )
    assert "verified" in section_lower or "verify" in section_lower, (
        "Section must require verification before marking done"
    )
    assert "full plan upfront" in section_lower or "before starting" in section_lower, (
        "Section must instruct the agent to create the full plan upfront"
    )


def test_task_planning_section_warns_against_done_to_move_on(
    system_prompt_text: str,
) -> None:
    """The section must explicitly warn against marking done prematurely."""
    section = _extract_section(system_prompt_text, "### Task Planning & Tracking")
    assert section is not None
    section_lower = section.lower()
    assert "move on" in section_lower, (
        "Section must explicitly warn against marking done 'to move on'"
    )
