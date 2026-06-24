// useContextRefs — frontend state for the @file / @folder / @diff /
// @staged / @git:N / @url: syntax in the composer.
//
// Responsibilities:
//   - Parse the draft text for refs on every change (cheap)
//   - For path-valued refs (file/folder), debounce-call
//     POST /api/context-refs/expand to get per-ref preview chips
//   - For typed autocomplete (when user is in the middle of typing
//     "@file:foo"), debounce-call POST /api/context-refs/list to
//     get path suggestions
//   - Aggregate the soft/hard limit flags so the composer can show
//     a banner or refuse to send
//
// This hook is intentionally pure-React. It owns the live state
// but does NOT mutate the draft text — the parent composer is the
// source of truth for the text itself. The hook just observes it
// and surfaces per-ref state.

import { useEffect, useMemo, useState } from "react";
import { parseRefs, partialRefAt } from "./parseRefs.js";
import { apiFetch } from "@/lib/api.js";

const EMPTY_REPORT = {
  results: [],
  total_bytes: 0,
  soft_warning: "",
  refused: false,
  refusal_reason: "",
  parsed_refs: [],
};

/**
 * @param {Object} opts
 * @param {string} opts.draft
 * @param {number} opts.cursor
 * @param {string} opts.sessionId
 * @param {number} [opts.expandDebounceMs=400]
 * @param {number} [opts.listDebounceMs=150]
 */
export function useContextRefs(opts) {
  const { draft, cursor, sessionId } = opts;
  const expandDebounceMs = opts.expandDebounceMs ?? 400;
  const listDebounceMs = opts.listDebounceMs ?? 150;

  // Parse refs synchronously on every text change (cheap).
  const parsed = useMemo(() => parseRefs(draft), [draft]);

  // Partial ref at cursor — drives the autocomplete popover.
  const partial = useMemo(() => partialRefAt(draft, cursor), [draft, cursor]);

  // Expansion report — populated by the debounced expand call.
  const [report, setReport] = useState(EMPTY_REPORT);
  const [isExpanding, setIsExpanding] = useState(false);

  // Autocomplete suggestions — populated by the debounced list call.
  const [suggestions, setSuggestions] = useState([]);
  const [isListing, setIsListing] = useState(false);

  // Debounced expand call
  useEffect(() => {
    if (parsed.length === 0) {
      setReport(EMPTY_REPORT);
      return;
    }
    const timer = setTimeout(async () => {
      setIsExpanding(true);
      try {
        const res = await apiFetch("/api/context-refs/expand", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: sessionId, message: draft }),
        });
        if (res.ok) {
          const body = await res.json();
          setReport(body);
        }
      } catch {
        // Silent — the chips just won't show preview until next change
      } finally {
        setIsExpanding(false);
      }
    }, expandDebounceMs);
    return () => clearTimeout(timer);
  }, [parsed, draft, sessionId, expandDebounceMs]);

  // Debounced list (autocomplete) call — only when user is typing
  // a partial ref that wants a path suggestion.
  useEffect(() => {
    if (!partial || (partial.type !== "file" && partial.type !== "folder")) {
      setSuggestions([]);
      return;
    }
    const prefix = partial.value;
    const timer = setTimeout(async () => {
      setIsListing(true);
      try {
        const res = await apiFetch("/api/context-refs/list", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: sessionId,
            prefix,
            max_entries: 200,
          }),
        });
        if (res.ok) {
          const body = await res.json();
          setSuggestions(body.entries || []);
        }
      } catch {
        setSuggestions([]);
      } finally {
        setIsListing(false);
      }
    }, listDebounceMs);
    return () => clearTimeout(timer);
  }, [partial, sessionId, listDebounceMs]);

  return {
    parsed,
    partial,
    report,
    isExpanding,
    suggestions,
    isListing,
  };
}
