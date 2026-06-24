// LiveTodoProgress — compact, real-time list of the agent's
// in-progress tasks. Renders inside a side panel slot of
// CodingPanel (PR C scope). Subscribes to the chat WebSocket
// for ``task_updated`` events, filters by source_session_id,
// and shows a simple progress counter + collapsible list.
//
// Visual reference (Hermes chat screenshot):
//
//   ┌─ Tasks 0/4 ──────────────────────┐
//   │ ●  Baixar binário RTK ...        │  (in-progress, filled)
//   │ ○  Extrair e instalar no PATH   │  (pending, hollow)
//   │ ○  Rodar rtk init --agent hermes│
//   │ ○  Testar comandos e verificar   │
//   └──────────────────────────────────┘
//
// Spec details:
// - Shows tasks where source_session_id === sessionId
// - X/Y counter in the header (done / total)
// - Chevron collapses/expands the list
// - When done === total (all tasks finished), the panel
//   fades out and collapses automatically after 2s
// - Empty state: "No tasks yet" hint, panel hidden
// - Sorted by order then created_at (matches TaskBoard)

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Circle, CircleDashed, CheckCircle2, ListTodo } from "lucide-react";
import { cn } from "@/lib/utils";

const STATUSES = {
  pending:      { Icon: Circle,       label: "pending" },
  "in-progress":{ Icon: CircleDashed, label: "in-progress" },
  review:       { Icon: CircleDashed, label: "review" },
  done:         { Icon: CheckCircle2, label: "done" },
};

const FADE_OUT_MS = 2000;

export function LiveTodoProgress({
  tasks,
  collapsed,
  onCollapsedChange,
  className,
}) {
  // Sort: order asc, then created_at asc (matches TaskBoard).
  const sorted = useMemo(() => {
    return [...tasks].sort((a, b) => {
      const oa = a.order ?? 0;
      const ob = b.order ?? 0;
      if (oa !== ob) return oa - ob;
      return (a.created_at ?? "").localeCompare(b.created_at ?? "");
    });
  }, [tasks]);

  const total = sorted.length;
  const done = sorted.filter((t) => t.status === "done").length;
  const allDone = total > 0 && done === total;

  // Auto-collapse + fade-out when everything is done. The user
  // still gets the satisfying "all green" moment before the
  // panel quietly disappears. We hold a ref so the timeout
  // doesn't re-fire if the tasks change.
  const fadeTimerRef = useRef(null);
  useEffect(() => {
    if (fadeTimerRef.current) {
      clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }
    if (allDone && !collapsed) {
      fadeTimerRef.current = setTimeout(() => {
        onCollapsedChange?.(true);
      }, FADE_OUT_MS);
    }
    return () => {
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    };
  }, [allDone, collapsed, onCollapsedChange]);

  // Empty state — show a tiny hint, don't take up much space
  if (total === 0) {
    return (
      <div
        data-testid="live-todo-progress"
        className={cn(
          "px-2 py-1.5 text-[10.5px] text-muted-foreground",
          "flex items-center gap-1.5 rounded-md",
          className
        )}
      >
        <ListTodo className="h-3 w-3" />
        <span>No tasks yet</span>
      </div>
    );
  }

  return (
    <div
      data-testid="live-todo-progress"
      className={cn(
        "rounded-md border border-border bg-surface/30",
        "transition-opacity duration-700",
        allDone && "opacity-60",
        className
      )}
    >
      {/* Header — chevron + label + counter */}
      <button
        type="button"
        onClick={() => onCollapsedChange?.(!collapsed)}
        data-testid="live-todo-toggle"
        aria-expanded={!collapsed}
        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] hover:bg-surface/60 transition-colors"
      >
        {collapsed
          ? <ChevronRight className="h-3 w-3 text-muted-foreground" />
          : <ChevronDown className="h-3 w-3 text-muted-foreground" />}
        <ListTodo className="h-3 w-3 text-muted-foreground" />
        <span className="font-semibold text-foreground">Tasks</span>
        <span
          className="ml-auto text-[10px] tabular-nums text-muted-foreground"
          data-testid="live-todo-counter"
        >
          {done}/{total}
        </span>
      </button>

      {/* Task list (only when expanded) */}
      {!collapsed && (
        <ul
          className="px-2 pb-2 space-y-0.5"
          data-testid="live-todo-list"
        >
          {sorted.map((t) => {
            const cfg = STATUSES[t.status] || STATUSES.pending;
            const { Icon } = cfg;
            const isDone = t.status === "done";
            const isInProgress = t.status === "in-progress";
            return (
              <li
                key={t.id}
                data-testid={`live-todo-item-${t.status}`}
                className="flex items-start gap-1.5 text-[11px] leading-tight"
              >
                <Icon
                  className={cn(
                    "h-3 w-3 mt-0.5 shrink-0",
                    isDone && "text-emerald-500",
                    isInProgress && "text-amber-500 animate-pulse",
                    !isDone && !isInProgress && "text-muted-foreground"
                  )}
                />
                <span
                  className={cn(
                    "flex-1",
                    isDone && "line-through text-muted-foreground"
                  )}
                  title={t.title}
                >
                  {t.title}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
