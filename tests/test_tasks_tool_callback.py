"""Tests for the on_change callback hook in tasks_tool.

The hook fires after a successful create/update. The backend
uses it to broadcast task_updated events via WebSocket. We
don't test the broadcast itself (that's main.py integration),
just the hook fires with the right args + errors from the
callback don't fail the write.
"""

import json
from pathlib import Path

import pytest

from mini_agent.tools.tasks_tool import (
    TasksCreateTool,
    TasksUpdateTool,
)


@pytest.fixture
def tool_dir(tmp_path: Path) -> Path:
    d = tmp_path / "tasks"
    d.mkdir()
    return d


class TestOnChangeCreate:
    async def test_fires_on_successful_create(self, tool_dir: Path):
        changes = []

        def cb(task, action):
            changes.append((task, action))

        tool = TasksCreateTool(
            tasks_file=str(tool_dir / "tasks.json"),
            on_change=cb,
        )
        result = await tool.execute(title="Write tests", priority="high")
        assert result.success

        assert len(changes) == 1
        task, action = changes[0]
        assert action == "create"
        assert task["title"] == "Write tests"
        assert task["priority"] == "high"
        assert task["status"] == "pending"

    async def test_does_not_fire_on_invalid_input(self, tool_dir: Path):
        changes = []

        def cb(task, action):
            changes.append((task, action))

        tool = TasksCreateTool(
            tasks_file=str(tool_dir / "tasks.json"),
            on_change=cb,
        )
        # Empty title → validation error, no write, no callback
        result = await tool.execute(title="")
        assert not result.success
        assert changes == []


class TestOnChangeUpdate:
    async def test_fires_on_successful_update(self, tool_dir: Path):
        changes = []

        def cb(task, action):
            changes.append((task, action))

        create = TasksCreateTool(
            tasks_file=str(tool_dir / "tasks.json"),
        )
        created = await create.execute(title="Original")
        assert created.success

        update = TasksUpdateTool(
            tasks_file=str(tool_dir / "tasks.json"),
            on_change=cb,
        )
        result = await update.execute(
            task_id=changes[0][0]["id"] if changes else None,
            status="done",
        )
        # The first create didn't have a callback, so changes is empty.
        # Find the ID from the create's result.
        # Re-do the create with the same callback to capture the id.
        changes.clear()

        create_with_cb = TasksCreateTool(
            tasks_file=str(tool_dir / "tasks.json"),
            on_change=cb,
        )
        c2 = await create_with_cb.execute(title="Original")
        assert c2.success
        task_id = changes[-1][0]["id"]
        changes.clear()

        result = await update.execute(task_id=task_id, status="done")
        assert result.success

        assert len(changes) == 1
        task, action = changes[0]
        assert action == "update"
        assert task["status"] == "done"

    async def test_no_changes_no_callback(self, tool_dir: Path):
        changes = []

        def cb(task, action):
            changes.append((task, action))

        create = TasksCreateTool(
            tasks_file=str(tool_dir / "tasks.json"),
            on_change=cb,
        )
        c = await create.execute(title="X")
        task_id = changes[-1][0]["id"]
        changes.clear()

        update = TasksUpdateTool(
            tasks_file=str(tool_dir / "tasks.json"),
            on_change=cb,
        )
        # Pass only task_id, no other fields → no changes, no callback
        result = await update.execute(task_id=task_id)
        assert result.success
        assert "no changes" in result.content.lower()
        assert changes == []


class TestOnChangeErrorTolerance:
    async def test_callback_exception_does_not_fail_write(self, tool_dir: Path):
        def bad_cb(task, action):
            raise RuntimeError("broadcast broken")

        tool = TasksCreateTool(
            tasks_file=str(tool_dir / "tasks.json"),
            on_change=bad_cb,
        )
        # Write should STILL succeed even though the callback raises
        result = await tool.execute(title="X")
        assert result.success
        # File on disk has the task
        data = json.loads((tool_dir / "tasks.json").read_text(encoding="utf-8"))
        assert len(data) == 1
        assert data[0]["title"] == "X"

    async def test_no_callback_is_fine(self, tool_dir: Path):
        # No on_change → tool just doesn't broadcast. Write succeeds.
        tool = TasksCreateTool(tasks_file=str(tool_dir / "tasks.json"))
        result = await tool.execute(title="X")
        assert result.success
        data = json.loads((tool_dir / "tasks.json").read_text(encoding="utf-8"))
        assert data[0]["title"] == "X"
