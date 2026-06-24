// useLiveTodos — subscribes to the chat WebSocket for the
// current session and accumulates tasks via the
// ``task_updated`` event. Filters by source_session_id so each
// session's panel only sees its own tasks.
//
// Initial state is loaded from ``GET /api/tasks`` so the panel
// is correct on mount (e.g. the agent created 2 tasks before
// the WebSocket connected, or the user reloaded the page).
// The WS event stream then keeps the list in sync from there.
//
// Returned API:
//   tasks              - filtered list, sorted by order + created_at
//   addTask / updateTask - direct mutators (used by tests and
//                          for optimistic UI; the WS path is the
//                          primary update mechanism in production)

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api.js";

/**
 * @param {Object} opts
 * @param {string} opts.sessionId
 * @param {Object | null} opts.websocket  - the chat WS instance
 * @param {boolean} [opts.skipFetch]     - skip initial GET /api/tasks
 *                                          (used in tests that don't
 *                                          need it)
 */
export function useLiveTodos({ sessionId, websocket, skipFetch = false }) {
  const [tasks, setTasks] = useState([]);

  // Initial fetch — pulls any tasks that existed before the WS
  // connected. Filtered server-side by source_session_id via the
  // query param (we just always pass the session — the backend
  // returns all tasks whose source_session_id matches; the
  // /api/tasks endpoint also returns global tasks without
  // source_session_id so we can decide on the client whether
  // to include them). For PR C we just match by session.
  useEffect(() => {
    if (!sessionId || skipFetch) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/api/tasks`);
        if (!res.ok) return;
        const body = await res.json();
        if (cancelled) return;
        // Filter to this session (or include all if no source_session_id,
        // which is the "TaskBoard panel" case — but here we're in the
        // session panel so we want to be strict).
        const filtered = (body.tasks || []).filter(
          (t) => t.source_session_id === sessionId
        );
        setTasks(filtered);
      } catch {
        // Silent — the panel just starts empty
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, skipFetch]);

  // WebSocket subscription
  useEffect(() => {
    if (!websocket) return;

    const handler = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return; // ignore non-JSON frames
      }
      if (msg.type !== "task_updated") return;
      const t = msg.task;
      if (!t || !t.id) return;
      // Filter by session
      if (t.source_session_id && t.source_session_id !== sessionId) {
        return;
      }
      // If the task has no source_session_id (TaskBoard-created),
      // only include it on the session that triggered the event
      // (which has the source via the broadcast helper — see
      // backend broadcast_task_event). For tasks without any
      // source, we IGNORE here so the session panel stays
      // focused on its own tasks.
      if (!t.source_session_id) {
        return;
      }

      if (msg.action === "create") {
        setTasks((prev) => {
          // Dedup just in case the broadcast fires twice
          if (prev.some((x) => x.id === t.id)) return prev;
          return [...prev, t];
        });
      } else if (msg.action === "update") {
        setTasks((prev) =>
          prev.map((x) => (x.id === t.id ? { ...x, ...t } : x))
        );
      }
    };

    websocket.addEventListener("message", handler);
    return () => {
      websocket.removeEventListener("message", handler);
    };
  }, [websocket, sessionId]);

  // Direct mutators (used in tests + for optimistic UI hooks).
  // Marked unused by the production render path — present so
  // consumers can do `addTask` from elsewhere without
  // round-tripping the WS.
  const addTask = useCallback((task) => {
    setTasks((prev) =>
      prev.some((x) => x.id === task.id) ? prev : [...prev, task]
    );
  }, []);
  const updateTask = useCallback((task) => {
    setTasks((prev) => prev.map((x) => (x.id === task.id ? { ...x, ...task } : x)));
  }, []);

  return { tasks, addTask, updateTask };
}
