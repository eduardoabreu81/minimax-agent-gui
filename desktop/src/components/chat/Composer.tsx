import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Paperclip, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useContextRefs } from "@/components/context-refs/useContextRefs.js";
import { ContextRefChips } from "@/components/context-refs/ContextRefChips.jsx";
import { ContextRefAutocomplete } from "@/components/context-refs/ContextRefAutocomplete.jsx";
import { buildAttachedContext } from "@/components/context-refs/buildAttachedContext.js";
import { apiFetch } from "@/lib/api.js";

// NOTE: This component is currently a "clean reference" — it is NOT
// wired into the ChatPanel. As of 2026-06-24, the @-ref integration
// is wired in-place inside ChatPanel.jsx (around the existing inline
// textarea that has the `/skill` slash menu and the paperclip
// attachment button — features the Composer doesn't have yet).
//
// This file is kept as the spec/clean version we can revive when
// (a) CodingPanel also wants @-refs and shares a unified Composer,
// or (b) we want to consolidate the ChatPanel input into a single
// reusable component. Until then, treat this as documentation.

interface ComposerProps {
  onSend: (text: string, attachment?: { name: string; path: string; type: string }) => void;
  disabled?: boolean;
  status: "idle" | "thinking" | "streaming" | "error";
  expertLabel: string;
  /** Session ID — used to resolve the workspace for @file:/@folder: refs. */
  sessionId: string;
}

export function Composer({ onSend, disabled, status, expertLabel, sessionId }: ComposerProps) {
  const [text, setText] = useState("");
  const [cursor, setCursor] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [autocompleteOpen, setAutocompleteOpen] = useState(false);

  const { parsed, partial, report, isExpanding, suggestions, isListing } = useContextRefs({
    draft: text,
    cursor,
    sessionId,
  });

  // Auto-grow textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  // The autocomplete popover is open when the user has a partial
  // ref at the cursor. We close it explicitly when they type
  // whitespace (the partial helper returns null in that case) OR
  // when they hit Escape (handled in onKeyDown).
  useEffect(() => {
    if (partial) setAutocompleteOpen(true);
    else setAutocompleteOpen(false);
  }, [partial]);

  const submit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;

    // Re-run expand right before send so the attached context is
    // fresh (the debounced report might be stale if the user typed
    // fast and hit Enter before the 400ms timer fired).
    let attached = "";
    try {
      const res = await apiFetch("/api/context-refs/expand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, message: trimmed }),
      });
      if (res.ok) {
        const body = await res.json();
        if (body.refused) {
          // Hard limit — refuse the send and surface the reason.
          alert(`Context too large to send: ${body.refusal_reason}`);
          return;
        }
        attached = buildAttachedContext(body);
      }
    } catch {
      // Network error — just send without attached context. The
      // agent will still see the user's message with the @-refs
      // in plain text, which is no worse than the pre-PR-A flow.
    }

    const finalText = attached
      ? `${trimmed}\n\n${attached}`
      : trimmed;

    onSend(finalText);
    setText("");
    setCursor(0);
  }, [text, disabled, sessionId, onSend]);

  const isBusy = status === "thinking" || status === "streaming";

  // When the user picks an item from the autocomplete popover,
  // replace the partial @-ref in the text with the inserted
  // string (which already includes the "@type:" prefix).
  const handleAutocompleteSelect = useCallback((insertion: string) => {
    if (!partial) return;
    setText((prev) => {
      const before = prev.slice(0, partial.start);
      const after = prev.slice(partial.end);
      const next = before + insertion + after;
      // Move cursor to just after the inserted text
      const newCursor = before.length + insertion.length;
      // Use setTimeout to ensure the textarea re-renders with the
      // new value before we set the cursor
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(newCursor, newCursor);
        }
      }, 0);
      return next;
    });
    setAutocompleteOpen(false);
  }, [partial]);

  // Hard-limit refusal: disable send when the most recent report
  // says we're over 50% of context. The server also enforces this
  // on the next expand call, but disabling the button gives faster
  // feedback in the UI.
  const sendDisabled = !text.trim() || disabled || report.refused;

  return (
    <div className="border-t border-border p-4">
      <div className="mx-auto max-w-3xl">
        <ContextRefChips parsed={parsed} report={report} isExpanding={isExpanding} />
        <div
          className={cn(
            "flex items-end gap-2 rounded-lg border border-input bg-background p-2 transition-shadow",
            "focus-within:border-foreground/30 focus-within:shadow-sm",
            report.refused && "border-red-400"
          )}
        >
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label="Attach file"
            disabled={disabled}
          >
            <Paperclip className="h-4 w-4" />
          </Button>
          <div className="relative flex-1">
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setCursor(e.target.selectionStart ?? e.target.value.length);
              }}
              onSelect={(e) => {
                const t = e.currentTarget;
                setCursor(t.selectionStart ?? t.value.length);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape" && autocompleteOpen) {
                  e.preventDefault();
                  setAutocompleteOpen(false);
                  return;
                }
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder={isBusy ? `Waiting for ${expertLabel}…` : `Message ${expertLabel}…`}
              disabled={disabled}
              rows={1}
              data-testid="composer-textarea"
              className="w-full resize-none border-0 bg-transparent py-1.5 text-sm outline-none placeholder:text-muted-foreground focus:ring-0 disabled:opacity-50"
            />
            {autocompleteOpen && partial && (
              <ContextRefAutocomplete
                partial={partial}
                suggestions={suggestions}
                isLoading={isListing}
                onSelect={handleAutocompleteSelect}
                onClose={() => setAutocompleteOpen(false)}
                anchorRef={textareaRef}
              />
            )}
          </div>
          <Button
            size="icon"
            className="h-8 w-8"
            disabled={sendDisabled}
            onClick={submit}
            aria-label="Send"
            data-testid="composer-send"
          >
            {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
        {report.refused && (
          <p className="mt-2 text-center text-[10.5px] text-red-600" data-testid="hard-limit-error">
            {report.refusal_reason}
          </p>
        )}
        <p className="mt-2 text-center text-[10px] text-muted-foreground">
          MiniMax Agent can make mistakes. Verify critical info.
        </p>
      </div>
    </div>
  );
}
