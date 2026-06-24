// Vitest for the WorkspaceSidebar's Live Todo integration (PR C).
//
// The previous TodosPanel was hardcoded demo data. This test
// verifies the new live version:
//   - renders LiveTodoProgress
//   - passes websocket + sessionId to useLiveTodos
//   - shows the "No tasks yet" hint when there are no tasks
//   - shows tasks when the WS event stream adds them
//   - tabs work (Todos tab shows the live component)

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import WorkspaceSidebar from "./WorkspaceSidebar.jsx";

// Mock useLiveTodos so we can control the task list without
// driving the real WS
vi.mock("../../hooks/useLiveTodos", () => ({
  useLiveTodos: vi.fn(),
}));

// Mock useAgentActivity (used by other tabs)
vi.mock("../../context/AgentActivityContext", () => ({
  useAgentActivity: () => ({
    plan: { items: [], sourcePrompt: "" },
    steps: [],
    toolResults: [],
    hasNewActivity: false,
    acknowledgeActivity: vi.fn(),
    updatePlanItem: vi.fn(),
  }),
}));

// Mock useSelectedModel
vi.mock("../../hooks/useSelectedModel", () => ({
  useSelectedModel: () => [null, vi.fn()],
}));

// Mock react-i18next so the missing key doesn't break render
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k) => k }),
}));

import { useLiveTodos } from "../../hooks/useLiveTodos";
const mockUseLiveTodos = useLiveTodos;

const makeTask = (overrides = {}) => ({
  id: `task-${Math.random()}`,
  title: "Sample task",
  status: "pending",
  priority: "medium",
  order: 0,
  created_at: "2026-06-24T00:00:00Z",
  updated_at: "2026-06-24T00:00:00Z",
  source_session_id: "coding-abc",
  ...overrides,
});

const makeWsMock = () => ({
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  send: vi.fn(),
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("WorkspaceSidebar — Live Todo integration", () => {
  it("renders the Todos tab with the live component", () => {
    mockUseLiveTodos.mockReturnValue({
      tasks: [],
      addTask: vi.fn(),
      updateTask: vi.fn(),
    });
    render(
      <WorkspaceSidebar
        visible={true}
        onToggle={vi.fn()}
        websocket={makeWsMock()}
        sessionId="coding-abc"
      />
    );
    // Default tab is "tasks" — switch to "todos"
    fireEvent.click(screen.getByRole("button", { name: /Todos/ }));
    // LiveTodoProgress is rendered with the "No tasks yet" hint
    expect(screen.getByText("No tasks yet")).toBeInTheDocument();
  });

  it("passes websocket + sessionId to useLiveTodos", () => {
    mockUseLiveTodos.mockReturnValue({
      tasks: [],
      addTask: vi.fn(),
      updateTask: vi.fn(),
    });
    const ws = makeWsMock();
    render(
      <WorkspaceSidebar
        visible={true}
        onToggle={vi.fn()}
        websocket={ws}
        sessionId="coding-xyz"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /Todos/ }));
    // Verify the hook was called with the right args
    expect(mockUseLiveTodos).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "coding-xyz",
        websocket: ws,
      })
    );
  });

  it("renders the live tasks when useLiveTodos returns them", () => {
    mockUseLiveTodos.mockReturnValue({
      tasks: [
        makeTask({ id: "1", title: "First", status: "in-progress" }),
        makeTask({ id: "2", title: "Second", status: "pending" }),
      ],
      addTask: vi.fn(),
      updateTask: vi.fn(),
    });
    render(
      <WorkspaceSidebar
        visible={true}
        onToggle={vi.fn()}
        websocket={makeWsMock()}
        sessionId="coding-abc"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /Todos/ }));
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
    // Counter reflects 0/2 (no done tasks)
    expect(screen.getByTestId("live-todo-counter")).toHaveTextContent("0/2");
  });

  it("reflects done count in the counter", () => {
    mockUseLiveTodos.mockReturnValue({
      tasks: [
        makeTask({ id: "1", status: "done" }),
        makeTask({ id: "2", status: "done" }),
        makeTask({ id: "3", status: "pending" }),
      ],
      addTask: vi.fn(),
      updateTask: vi.fn(),
    });
    render(
      <WorkspaceSidebar
        visible={true}
        onToggle={vi.fn()}
        websocket={makeWsMock()}
        sessionId="coding-abc"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /Todos/ }));
    expect(screen.getByTestId("live-todo-counter")).toHaveTextContent("2/3");
  });

  it("falls back gracefully when no sessionId is provided (skip fetch)", () => {
    mockUseLiveTodos.mockReturnValue({
      tasks: [],
      addTask: vi.fn(),
      updateTask: vi.fn(),
    });
    render(
      <WorkspaceSidebar
        visible={true}
        onToggle={vi.fn()}
        websocket={null}
        sessionId={null}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /Todos/ }));
    // skipFetch is true so the hook won't try to fetch
    expect(mockUseLiveTodos).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: null, skipFetch: true })
    );
  });
});
