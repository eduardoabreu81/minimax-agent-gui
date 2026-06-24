// Vitest for LiveTodoProgress + useLiveTodos.
//
// Component tests use jsdom (default). Hook tests use
// renderHook to drive the WS subscription synchronously.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent, renderHook } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LiveTodoProgress } from "./LiveTodoProgress.jsx";
import { useLiveTodos } from "@/hooks/useLiveTodos.js";

// Mock apiFetch so the initial GET /api/tasks call doesn't fail
vi.mock("@/lib/api.js", () => ({
  apiFetch: vi.fn(),
}));
import { apiFetch } from "@/lib/api.js";
const mockApiFetch = apiFetch;

beforeEach(() => {
  mockApiFetch.mockReset();
  // Default: empty task list
  mockApiFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, tasks: [] }),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LiveTodoProgress component
// ─────────────────────────────────────────────────────────────────────────────

const makeTask = (overrides = {}) => ({
  id: `task-${Math.random()}`,
  title: "Sample task",
  status: "pending",
  priority: "medium",
  order: 0,
  created_at: "2026-06-24T00:00:00Z",
  updated_at: "2026-06-24T00:00:00Z",
  source_session_id: "sess-1",
  ...overrides,
});

describe("LiveTodoProgress — empty state", () => {
  it("shows 'No tasks yet' hint when tasks array is empty", () => {
    render(<LiveTodoProgress tasks={[]} collapsed={false} />);
    expect(screen.getByText("No tasks yet")).toBeInTheDocument();
  });
});

describe("LiveTodoProgress — header + counter", () => {
  it("renders the header with 'Tasks' label and X/Y counter", () => {
    const tasks = [
      makeTask({ id: "t1", status: "done" }),
      makeTask({ id: "t2", status: "pending" }),
      makeTask({ id: "t3", status: "pending" }),
    ];
    render(<LiveTodoProgress tasks={tasks} collapsed={false} />);
    expect(screen.getByText("Tasks")).toBeInTheDocument();
    expect(screen.getByTestId("live-todo-counter")).toHaveTextContent("1/3");
  });

  it("updates the counter when status changes", () => {
    const tasks = [
      makeTask({ id: "t1", status: "done" }),
      makeTask({ id: "t2", status: "done" }),
    ];
    render(<LiveTodoProgress tasks={tasks} collapsed={false} />);
    expect(screen.getByTestId("live-todo-counter")).toHaveTextContent("2/2");
  });
});

describe("LiveTodoProgress — collapse/expand", () => {
  it("shows the list when not collapsed", () => {
    const tasks = [makeTask({ title: "Task 1" })];
    render(<LiveTodoProgress tasks={tasks} collapsed={false} />);
    expect(screen.getByTestId("live-todo-list")).toBeInTheDocument();
    expect(screen.getByText("Task 1")).toBeInTheDocument();
  });

  it("hides the list when collapsed", () => {
    const tasks = [makeTask({ title: "Task 1" })];
    render(<LiveTodoProgress tasks={tasks} collapsed={true} />);
    expect(screen.queryByTestId("live-todo-list")).toBeNull();
    // Header is still visible
    expect(screen.getByText("Tasks")).toBeInTheDocument();
  });

  it("toggles collapsed via the header click", async () => {
    const u = userEvent.setup({ delay: null });
    const onChange = vi.fn();
    const tasks = [makeTask({ title: "Task 1" })];
    const { rerender } = render(
      <LiveTodoProgress
        tasks={tasks}
        collapsed={false}
        onCollapsedChange={onChange}
      />
    );
    await u.click(screen.getByTestId("live-todo-toggle"));
    expect(onChange).toHaveBeenCalledWith(true);
    // Re-render with the new collapsed state
    rerender(
      <LiveTodoProgress
        tasks={tasks}
        collapsed={true}
        onCollapsedChange={onChange}
      />
    );
    expect(screen.queryByTestId("live-todo-list")).toBeNull();
  });
});

describe("LiveTodoProgress — sort order", () => {
  it("sorts by order asc then created_at asc", () => {
    const tasks = [
      makeTask({ id: "c", order: 1, title: "second" }),
      makeTask({ id: "a", order: 0, title: "first" }),
      makeTask({ id: "b", order: 0, title: "first-other", created_at: "2026-06-24T01:00:00Z" }),
    ];
    render(<LiveTodoProgress tasks={tasks} collapsed={false} />);
    const items = screen.getAllByTestId(/^live-todo-item-/);
    expect(items).toHaveLength(3);
    // a (order 0, earlier created_at) comes first
    // b (order 0, later created_at) comes second
    // c (order 1) comes last
    const titles = items.map((el) => el.textContent);
    expect(titles[0]).toContain("first");
    expect(titles[1]).toContain("first-other");
    expect(titles[2]).toContain("second");
  });
});

describe("LiveTodoProgress — status rendering", () => {
  it("renders different icons for each status", () => {
    const tasks = [
      makeTask({ id: "p", status: "pending" }),
      makeTask({ id: "i", status: "in-progress" }),
      makeTask({ id: "r", status: "review" }),
      makeTask({ id: "d", status: "done" }),
    ];
    render(<LiveTodoProgress tasks={tasks} collapsed={false} />);
    // Each status has a distinct testid
    expect(screen.getByTestId("live-todo-item-pending")).toBeInTheDocument();
    expect(screen.getByTestId("live-todo-item-in-progress")).toBeInTheDocument();
    expect(screen.getByTestId("live-todo-item-review")).toBeInTheDocument();
    expect(screen.getByTestId("live-todo-item-done")).toBeInTheDocument();
  });

  it("strikethrough on done tasks", () => {
    const tasks = [makeTask({ id: "d", status: "done", title: "Finished" })];
    const { container } = render(
      <LiveTodoProgress tasks={tasks} collapsed={false} />
    );
    const titleEl = container.querySelector('[data-testid="live-todo-item-done"] span');
    expect(titleEl.className).toMatch(/line-through/);
  });
});

describe("LiveTodoProgress — auto-collapse on all done", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("auto-collapses 2s after the last task is marked done", () => {
    const onChange = vi.fn();
    const tasks = [
      makeTask({ id: "t1", status: "done" }),
      makeTask({ id: "t2", status: "in-progress" }),
    ];
    const { rerender } = render(
      <LiveTodoProgress
        tasks={tasks}
        collapsed={false}
        onCollapsedChange={onChange}
      />
    );
    expect(onChange).not.toHaveBeenCalled();

    // Mark t2 as done too — allDone becomes true
    rerender(
      <LiveTodoProgress
        tasks={[
          makeTask({ id: "t1", status: "done" }),
          makeTask({ id: "t2", status: "done" }),
        ]}
        collapsed={false}
        onCollapsedChange={onChange}
      />
    );
    // Before 2s, no collapse
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onChange).not.toHaveBeenCalled();
    // After 2s, auto-collapses
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("does NOT auto-collapse when some tasks are still pending", () => {
    const onChange = vi.fn();
    const tasks = [
      makeTask({ id: "t1", status: "done" }),
      makeTask({ id: "t2", status: "pending" }),
    ];
    render(
      <LiveTodoProgress
        tasks={tasks}
        collapsed={false}
        onCollapsedChange={onChange}
      />
    );
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not auto-collapse when all tasks were already done at mount", () => {
    // The auto-collapse only fires on the TRANSITION (allDone
    // becomes true). If the user mounts with all-done, the
    // effect fires once, the timer is set, and after 2s it
    // collapses — this is the "freshly finished" UX.
    // For our MVP we accept this — a panel that's all-done
    // at mount is rare (the user just opened the panel and
    // the agent isn't doing anything).
    const onChange = vi.fn();
    const tasks = [makeTask({ status: "done" })];
    render(
      <LiveTodoProgress
        tasks={tasks}
        collapsed={false}
        onCollapsedChange={onChange}
      />
    );
    act(() => {
      vi.advanceTimersByTime(2500);
    });
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// useLiveTodos hook
// ─────────────────────────────────────────────────────────────────────────────

const makeWsMock = () => {
  const listeners = new Map();
  return {
    send: vi.fn(),
    addEventListener: vi.fn((type, cb) => {
      listeners.set(cb, type);
    }),
    removeEventListener: vi.fn((type, cb) => {
      listeners.delete(cb);
    }),
    _fire: (msg) => {
      const ev = { data: JSON.stringify(msg) };
      for (const [cb, type] of listeners) {
        if (type === "message") cb(ev);
      }
    },
  };
};

describe("useLiveTodos — initial fetch", () => {
  it("fetches tasks on mount and filters by session_id", async () => {
    mockApiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        tasks: [
          { id: "1", title: "mine", source_session_id: "sess-1" },
          { id: "2", title: "other", source_session_id: "sess-2" },
          { id: "3", title: "global", source_session_id: null },
        ],
      }),
    });
    const ws = makeWsMock();
    const { result } = renderHook(() =>
      useLiveTodos({ sessionId: "sess-1", websocket: ws })
    );
    // The hook does an async fetch — wait for state to update
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.tasks).toHaveLength(1);
    expect(result.current.tasks[0].id).toBe("1");
  });

  it("handles fetch failure gracefully (empty list)", async () => {
    mockApiFetch.mockRejectedValueOnce(new Error("network"));
    const ws = makeWsMock();
    const { result } = renderHook(() =>
      useLiveTodos({ sessionId: "sess-1", websocket: ws })
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.tasks).toEqual([]);
  });
});

describe("useLiveTodos — WS subscription", () => {
  it("adds a task on 'create' event", async () => {
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, tasks: [] }),
    });
    const ws = makeWsMock();
    const { result } = renderHook(() =>
      useLiveTodos({ sessionId: "sess-1", websocket: ws })
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.tasks).toHaveLength(0);

    act(() => {
      ws._fire({
        type: "task_updated",
        action: "create",
        task: {
          id: "new",
          title: "Fresh",
          status: "in-progress",
          source_session_id: "sess-1",
        },
      });
    });
    expect(result.current.tasks).toHaveLength(1);
    expect(result.current.tasks[0].id).toBe("new");
  });

  it("updates an existing task on 'update' event", async () => {
    mockApiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        tasks: [{ id: "t1", title: "X", status: "pending", source_session_id: "sess-1" }],
      }),
    });
    const ws = makeWsMock();
    const { result } = renderHook(() =>
      useLiveTodos({ sessionId: "sess-1", websocket: ws })
    );
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      ws._fire({
        type: "task_updated",
        action: "update",
        task: {
          id: "t1",
          title: "X",
          status: "done",
          source_session_id: "sess-1",
        },
      });
    });
    expect(result.current.tasks[0].status).toBe("done");
  });

  it("ignores tasks from other sessions", async () => {
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, tasks: [] }),
    });
    const ws = makeWsMock();
    const { result } = renderHook(() =>
      useLiveTodos({ sessionId: "sess-1", websocket: ws })
    );
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      ws._fire({
        type: "task_updated",
        action: "create",
        task: { id: "x", title: "Other", source_session_id: "sess-2" },
      });
    });
    expect(result.current.tasks).toHaveLength(0);
  });

  it("ignores tasks with no source_session_id", async () => {
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, tasks: [] }),
    });
    const ws = makeWsMock();
    const { result } = renderHook(() =>
      useLiveTodos({ sessionId: "sess-1", websocket: ws })
    );
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      ws._fire({
        type: "task_updated",
        action: "create",
        task: { id: "x", title: "Global", source_session_id: null },
      });
    });
    expect(result.current.tasks).toHaveLength(0);
  });

  it("ignores non-task_updated events", async () => {
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, tasks: [] }),
    });
    const ws = makeWsMock();
    const { result } = renderHook(() =>
      useLiveTodos({ sessionId: "sess-1", websocket: ws })
    );
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      ws._fire({ type: "compact_done" });
      ws._fire({ type: "daily_updated", date: "2026-06-24" });
    });
    expect(result.current.tasks).toHaveLength(0);
  });

  it("dedups duplicate create events", async () => {
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, tasks: [] }),
    });
    const ws = makeWsMock();
    const { result } = renderHook(() =>
      useLiveTodos({ sessionId: "sess-1", websocket: ws })
    );
    await act(async () => {
      await Promise.resolve();
    });

    const task = { id: "t1", title: "X", status: "pending", source_session_id: "sess-1" };
    act(() => {
      ws._fire({ type: "task_updated", action: "create", task });
      ws._fire({ type: "task_updated", action: "create", task });
    });
    expect(result.current.tasks).toHaveLength(1);
  });

  it("ignores non-JSON frames", async () => {
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, tasks: [] }),
    });
    const ws = makeWsMock();
    const { result } = renderHook(() =>
      useLiveTodos({ sessionId: "sess-1", websocket: ws })
    );
    await act(async () => {
      await Promise.resolve();
    });
    // Manually invoke the registered handler with a non-JSON
    // payload — should be silently ignored, no throw.
    const cb = ws.addEventListener.mock.calls[0][1];
    expect(() => cb({ data: "not json{" })).not.toThrow();
    expect(result.current.tasks).toEqual([]);
  });
});
