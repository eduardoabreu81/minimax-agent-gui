"""Task Board Tools - Let the agent create, list, and update user tasks.

The agent uses these tools to maintain the user's task board in the Tasks
panel. The storage is shared with the frontend (`workspace/tasks.json`),
so user-visible mutations and agent mutations hit the same file.

**Guardrails** (intentional, do NOT add a delete tool):
- The agent can CREATE, LIST, and UPDATE tasks only.
- DELETION is reserved for the user — the agent is a guest, not an owner.
  This mirrors the codebase's general "agent never destroys user data"
  policy.
- `status` and `priority` are validated server-side. Invalid values from
  the model return HTTP 400, which the wrapper translates to a friendly
  ToolResult error so the agent self-corrects.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Any

from .base import Tool, ToolResult

_logger = logging.getLogger(__name__)

# Mirrors the backend constants in web/backend/main.py. Kept as a constant
# so the agent's parameter schema documents the valid options inline.
VALID_STATUSES = ["pending", "in-progress", "review", "done"]
VALID_PRIORITIES = ["high", "medium", "low"]


class TasksBaseTool(Tool):
    """Shared helper — talks to the task storage file directly.

    The agent runs in-process with the FastAPI backend during dev, so we
    hit the JSON file directly instead of going through HTTP. This keeps
    the tool fast and avoids an httpx dependency for an internal API.

    Optional ``on_change`` callback — when set, the tool fires it after
    a successful write with ``(task_dict, action_string)``. The FastAPI
    backend wires this to the WebSocket broadcast so the frontend's
    Live Todo Progress component can update in real-time when the
    agent creates/updates tasks during a turn. Signature:

        on_change(task: dict, action: Literal["create", "update"]) -> None
    """

    def __init__(
        self,
        tasks_file: str = "./workspace/tasks.json",
        on_change=None,
    ):
        self.tasks_file = Path(tasks_file)
        # Callable or None. If None, the tool writes silently (no
        # broadcast). The backend sets this when instantiating the
        # agent's tools.
        self._on_change = on_change

    def _load(self) -> list:
        if not self.tasks_file.exists():
            return []
        try:
            data = json.loads(self.tasks_file.read_text(encoding="utf-8"))
            return data if isinstance(data, list) else []
        except Exception:
            return []

    def _save(self, tasks: list):
        self.tasks_file.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.tasks_file.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(tasks, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(self.tasks_file)

    def _next_order(self, tasks: list) -> int:
        if not tasks:
            return 0
        return max((t.get("order", 0) for t in tasks), default=-1) + 1

    def _generate_id(self) -> str:
        import time
        import uuid as _uuid
        return f"task-{int(time.time() * 1000)}-{_uuid.uuid4().hex[:6]}"

    def _fire_change(self, task: dict, action: str) -> None:
        """Notify the on_change callback (if set) that a task changed.

        The callback signature is ``(task_dict, action_string)``
        where action is one of "create" or "update". Errors from
        the callback are logged but don't fail the tool — the
        write to disk already succeeded, the broadcast is a
        best-effort notification.
        """
        if self._on_change is None:
            return
        try:
            self._on_change(task, action)
        except Exception as e:
            # Broadcast failures must NOT roll back the disk write
            # — the task is already saved. Just log so we can
            # investigate if the WS path breaks.
            _logger.warning(
                f"tasks_tool on_change callback raised (action={action}): {e}"
            )


class TasksCreateTool(TasksBaseTool):
    """Create a new task on the user's task board."""

    @property
    def name(self) -> str:
        return "tasks_create"

    @property
    def description(self) -> str:
        return (
            "Create a new task on the user's task board (visible in the Tasks panel). "
            "Use this when the user asks to add a task, todo, reminder, or any trackable "
            "item. The task appears immediately in the UI with an 'agent' badge so the "
            "user can tell it was created by you. Always returns the new task ID."
        )

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "title": {
                    "type": "string",
                    "description": "Short, action-oriented task title (max ~80 chars).",
                },
                "description": {
                    "type": "string",
                    "description": "Optional longer description with context, acceptance criteria, or links.",
                },
                "status": {
                    "type": "string",
                    "enum": VALID_STATUSES,
                    "description": "Initial status. Defaults to 'pending'. Use 'in-progress' if you're already working on it.",
                },
                "priority": {
                    "type": "string",
                    "enum": VALID_PRIORITIES,
                    "description": "Initial priority. Defaults to 'medium'. Use 'high' only when the user emphasizes urgency.",
                },
            },
            "required": ["title"],
        }

    async def execute(
        self,
        title: str,
        description: str = "",
        status: str = "pending",
        priority: str = "medium",
        source_session_id: str | None = None,
        **_: Any,
    ) -> ToolResult:
        title = title.strip()
        if not title:
            return ToolResult(success=False, error="Task title cannot be empty.")
        if status not in VALID_STATUSES:
            return ToolResult(
                success=False,
                error=f"Invalid status '{status}'. Must be one of {VALID_STATUSES}.",
            )
        if priority not in VALID_PRIORITIES:
            return ToolResult(
                success=False,
                error=f"Invalid priority '{priority}'. Must be one of {VALID_PRIORITIES}.",
            )

        try:
            tasks = self._load()
            now = datetime.now().isoformat()
            new_task = {
                "id": self._generate_id(),
                "title": title,
                "description": description.strip() if description else "",
                "status": status,
                "priority": priority,
                "subtasks": [],
                "order": self._next_order(tasks),
                "created_at": now,
                "updated_at": now,
                "created_by": "agent",
                "source_session_id": source_session_id,
            }
            tasks.append(new_task)
            self._save(tasks)
            _logger.info(f"tasks_create: id={new_task['id']} title={title!r}")
            # Notify listeners (WebSocket broadcast, audit log, etc.)
            self._fire_change(new_task, "create")
            return ToolResult(
                success=True,
                content=(
                    f"Created task #{new_task['id']}: '{title}' "
                    f"(status={status}, priority={priority})"
                ),
            )
        except Exception as e:
            return ToolResult(success=False, error=f"Failed to create task: {e}")


class TasksListTool(TasksBaseTool):
    """List tasks on the user's task board, with optional filters."""

    @property
    def name(self) -> str:
        return "tasks_list"

    @property
    def description(self) -> str:
        return (
            "List tasks on the user's task board. Supports filtering by status and "
            "priority. Returns task IDs (which you'll need for tasks_update), titles, "
            "statuses, and priorities. Use this BEFORE tasks_update to find the ID "
            "of the task you want to change."
        )

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "status": {
                    "type": "string",
                    "enum": VALID_STATUSES + ["all"],
                    "description": "Filter by status. 'all' or omitted returns everything.",
                },
                "priority": {
                    "type": "string",
                    "enum": VALID_PRIORITIES + ["all"],
                    "description": "Filter by priority. 'all' or omitted returns everything.",
                },
            },
        }

    async def execute(
        self,
        status: str = "all",
        priority: str = "all",
        **_: Any,
    ) -> ToolResult:
        try:
            tasks = self._load()
        except Exception as e:
            return ToolResult(success=False, error=f"Failed to read tasks: {e}")

        if status and status != "all":
            tasks = [t for t in tasks if t.get("status") == status]
        if priority and priority != "all":
            tasks = [t for t in tasks if t.get("priority") == priority]

        if not tasks:
            return ToolResult(
                success=True,
                content="No tasks match the given filters.",
            )

        # Render a compact text table the agent (and the user, via the chat
        # transcript) can scan quickly.
        lines = [f"{len(tasks)} task(s):"]
        for t in tasks:
            tid = t.get("id", "?")
            title = t.get("title", "(untitled)")
            st = t.get("status", "pending")
            pr = t.get("priority", "medium")
            who = t.get("created_by", "user")
            lines.append(f"  [{tid}] ({pr}/{st}, by {who}) {title}")
        return ToolResult(success=True, content="\n".join(lines))


class TasksUpdateTool(TasksBaseTool):
    """Update an existing task's title, description, status, or priority."""

    @property
    def name(self) -> str:
        return "tasks_update"

    @property
    def description(self) -> str:
        return (
            "Update an existing task by ID. Only the fields you provide are changed; "
            "others are preserved. Typical use: mark a task as 'done', bump priority to "
            "'high', or refine the title. To find the task ID, call tasks_list first."
        )

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "task_id": {
                    "type": "string",
                    "description": "The task ID to update (e.g. 'task-1719000000000-a1b2c3').",
                },
                "title": {
                    "type": "string",
                    "description": "New title (omit to keep current).",
                },
                "description": {
                    "type": "string",
                    "description": "New description (omit to keep current).",
                },
                "status": {
                    "type": "string",
                    "enum": VALID_STATUSES,
                    "description": "New status (omit to keep current).",
                },
                "priority": {
                    "type": "string",
                    "enum": VALID_PRIORITIES,
                    "description": "New priority (omit to keep current).",
                },
            },
            "required": ["task_id"],
        }

    async def execute(
        self,
        task_id: str,
        title: str | None = None,
        description: str | None = None,
        status: str | None = None,
        priority: str | None = None,
        **_: Any,
    ) -> ToolResult:
        if status is not None and status not in VALID_STATUSES:
            return ToolResult(
                success=False,
                error=f"Invalid status '{status}'. Must be one of {VALID_STATUSES}.",
            )
        if priority is not None and priority not in VALID_PRIORITIES:
            return ToolResult(
                success=False,
                error=f"Invalid priority '{priority}'. Must be one of {VALID_PRIORITIES}.",
            )
        if title is not None and not title.strip():
            return ToolResult(success=False, error="Task title cannot be empty.")

        try:
            tasks = self._load()
            target = next((t for t in tasks if t.get("id") == task_id), None)
            if not target:
                return ToolResult(
                    success=False,
                    error=f"Task '{task_id}' not found. Call tasks_list to find valid IDs.",
                )

            changes = []
            if title is not None:
                target["title"] = title.strip()
                changes.append("title")
            if description is not None:
                target["description"] = description.strip()
                changes.append("description")
            if status is not None:
                target["status"] = status
                changes.append("status")
            if priority is not None:
                target["priority"] = priority
                changes.append("priority")

            if not changes:
                return ToolResult(
                    success=True,
                    content=f"No changes provided for task #{task_id}.",
                )

            target["updated_at"] = datetime.now().isoformat()
            self._save(tasks)
            _logger.info(f"tasks_update: id={task_id} fields={changes}")
            # Notify listeners (WebSocket broadcast, audit log, etc.)
            self._fire_change(target, "update")
            return ToolResult(
                success=True,
                content=f"Updated task #{task_id} ({', '.join(changes)}): '{target['title']}'",
            )
        except Exception as e:
            return ToolResult(success=False, error=f"Failed to update task: {e}")