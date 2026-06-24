// Composer — single-source-of-truth chat input.
//
// Owns the textarea, the @-ref chips, the @-ref autocomplete popover,
// the /skill slash menu, the paperclip attachment, and the hard-limit
// refusal banner. The parent (ChatPanel) only knows how to send a
// message via `onSend(text, attachment)` and how to activate a skill
// via `onActivateSkill(skillName)` — it doesn't care about the
// internal input state.
//
// Visual reference: the "single rounded card" mockup (design
// reference, lines 242-260). The slash menu + autocomplete popover
// are absolutely positioned above the textarea; attachment chip
// sits above the card; chips sit above the attachment.

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Send, Paperclip, Loader2, X, Image as ImageIcon, FileText, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import SlashMenu from "@/components/shared/SlashMenu.jsx";
import { useContextRefs } from "@/components/context-refs/useContextRefs.js";
import { ContextRefChips } from "@/components/context-refs/ContextRefChips.jsx";
import { ContextRefAutocomplete } from "@/components/context-refs/ContextRefAutocomplete.jsx";
import { buildAttachedContext } from "@/components/context-refs/buildAttachedContext.js";
import { apiFetch } from "@/lib/api.js";

interface ComposerProps {
  /** Called with the final user text (already augmented with the
   *  "--- Attached Context ---" block from @-ref expansion) and
   *  the optional attachment. */
  onSend: (text: string, attachment?: { name: string; path: string; type: string }) => void;
  /** Called when the user picks a skill from the /slash menu. The
   *  parent is responsible for the WS plumbing and any local
   *  system messages — Composer only handles the UI side
   *  (clears the input, closes the menu). */
  onActivateSkill: (skillName: string) => void;
  /** Fired whenever the input goes from empty to non-empty (or
   *  vice-versa) OR an attachment is added/removed. Parents use
   *  this for session protection (warn on tab switch with
   *  unsent content). */
  onDirtyChange?: (dirty: boolean) => void;
  /** Whether the input should be inert (e.g. WS not connected). */
  disabled?: boolean;
  /** Drives the spinner + placeholder text. */
  status: "idle" | "thinking" | "streaming" | "error";
  /** Used in the placeholder ("Message {expertLabel}…"). */
  expertLabel: string;
  /** Session ID — used to resolve the workspace for @file:/@folder: refs. */
  sessionId: string;
}

export function Composer({
  onSend,
  onActivateSkill,
  onDirtyChange,
  disabled,
  status,
  expertLabel,
  sessionId,
}: ComposerProps) {
  const { t } = useTranslation();
  // ---- Text + cursor (the @-refs hook reads these) ----
  const [text, setText] = useState("");
  const [cursor, setCursor] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [autocompleteOpen, setAutocompleteOpen] = useState(false);

  // ---- /skill slash menu state ----
  const [skills, setSkills] = useState<{ name: string; description?: string }[]>([]);
  const [showSkills, setShowSkills] = useState(false);
  const [skillIndex, setSkillIndex] = useState(0);

  // ---- Attachment state ----
  const [attachment, setAttachment] = useState<{ name: string; path: string; type: string } | null>(null);

  const { parsed, partial, report, isExpanding, suggestions, isListing } = useContextRefs({
    draft: text,
    cursor,
    sessionId,
  });

  // Filtered skills (recomputed when the input changes). Mirrors the
  // pre-Composer logic from ChatPanel so behavior is identical.
  const filteredSkills = useMemo(() => {
    if (!text.startsWith("/")) return [];
    const q = text.slice(1).toLowerCase();
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.description?.toLowerCase().includes(q) ?? false)
    );
  }, [text, skills]);

  // Auto-grow textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  // Bubble "has unsent content" up to the parent for session
  // protection. Fired when text becomes non-empty or an attachment
  // is staged; cleared on submit.
  useEffect(() => {
    onDirtyChange?.(text.trim().length > 0 || !!attachment);
  }, [text, attachment, onDirtyChange]);

  // The autocomplete popover is open when the user has a partial
  // ref at the cursor. Whitespace or cursor movement kills it.
  useEffect(() => {
    if (partial) setAutocompleteOpen(true);
    else setAutocompleteOpen(false);
  }, [partial]);

  // Fetch the skills list the first time the user opens the menu.
  const fetchSkills = useCallback(async () => {
    try {
      const res = await apiFetch("/api/skills");
      const data = await res.json();
      setSkills(data.skills || []);
    } catch {
      // Silent — the slash menu will just be empty.
    }
  }, []);

  // Handle a file picked via the hidden <input type="file">. Uploads
  // to /api/upload, stores the resulting {name, path, type} on
  // `attachment` so the parent gets it on the next send.
  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await apiFetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (data.success) {
        setAttachment({ name: file.name, path: data.path, type: file.type });
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("Upload failed:", err);
    }
    e.target.value = "";
  }, []);

  // ---- Submit ----
  const submit = useCallback(async () => {
    const trimmed = text.trim();
    if ((!trimmed && !attachment) || disabled) return;

    // Re-run expand right before send so the attached context is
    // fresh (the debounced report might be stale if the user typed
    // fast and hit Enter before the 400ms timer fired).
    let attached = "";
    if (trimmed) {
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
    }

    const finalText = attached ? `${trimmed}\n\n${attached}` : trimmed;
    onSend(finalText, attachment ?? undefined);
    setText("");
    setCursor(0);
    setAttachment(null);
  }, [text, attachment, disabled, sessionId, onSend]);

  const isBusy = status === "thinking" || status === "streaming";

  // When the user picks an item from the autocomplete popover,
  // replace the partial @-ref in the text with the inserted string
  // (which already includes the "@type:" prefix). We must update
  // BOTH the React text state AND the React cursor state together,
  // otherwise `partialRefAt` (which uses `cursor` to find the
  // partial) computes the wrong range — and the popover reopens
  // as the type picker with the cursor stuck at the old position,
  // causing the next click to duplicate the prefix instead of
  // inserting the file path.
  const handleAutocompleteSelect = useCallback(
    (insertion: string) => {
      if (!partial) return;
      let newCursor = 0;
      setText((prev) => {
        const before = prev.slice(0, partial.start);
        const after = prev.slice(partial.end);
        newCursor = before.length + insertion.length;
        return before + insertion + after;
      });
      setCursor(newCursor);
      setAutocompleteOpen(false);
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(newCursor, newCursor);
        }
      }, 0);
    },
    [partial]
  );

  // When the user picks a skill from the slash menu, hand it off to
  // the parent (which sends the WS message + adds the local system
  // message) and reset the input + close the menu.
  const handleSkillSelect = useCallback(
    (skillName: string) => {
      setText("");
      setCursor(0);
      setShowSkills(false);
      onActivateSkill(skillName);
    },
    [onActivateSkill]
  );

  // ---- Key handler: slash menu (priority), autocomplete, send ----
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Escape" && autocompleteOpen) {
        e.preventDefault();
        setAutocompleteOpen(false);
        return;
      }
      if (e.key === "Escape" && showSkills) {
        setShowSkills(false);
        return;
      }
      if (showSkills && filteredSkills.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSkillIndex((i) => (i + 1) % filteredSkills.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSkillIndex((i) => (i - 1 + filteredSkills.length) % filteredSkills.length);
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          handleSkillSelect(filteredSkills[skillIndex].name);
          return;
        }
      }
      if (e.key === "Enter" && !e.shiftKey) {
        // The autocomplete popover has its own Enter handler
        // (document-level, capture phase). When the popover is
        // open, we ALWAYS preventDefault here so the textarea
        // doesn't insert a newline — even when the popover's
        // handler is a no-op (empty-state row with insertion="",
        // or any other "nothing to select" condition). Without
        // this, pressing Enter on the empty-state row would
        // silently insert a newline and corrupt the partial.
        if (autocompleteOpen) {
          e.preventDefault();
          return;
        }
        e.preventDefault();
        submit();
      }
    },
    [autocompleteOpen, showSkills, filteredSkills, skillIndex, handleSkillSelect, submit]
  );

  // Hard-limit refusal: disable send when the most recent report
  // says we're over 50% of context. The server also enforces this
  // on the next expand call, but disabling the button gives faster
  // feedback in the UI.
  const sendDisabled = (!text.trim() && !attachment) || disabled || report.refused;

  return (
    <div className="border-t border-border p-4" data-testid="composer">
      <div className="mx-auto max-w-3xl">
        {/* @-ref preview chips (one per parsed @-ref). Renders
            nothing when there are no refs in the current draft. */}
        <ContextRefChips parsed={parsed} report={report} isExpanding={isExpanding} />

        {/* Attachment chip — shows the currently staged file above
            the card. X button clears it. */}
        {attachment && (
          <div
            className="flex items-center gap-2 mb-2 px-3 py-1.5 bg-primary/10 border border-primary/20 rounded-lg w-fit"
            data-testid="composer-attachment-chip"
          >
            {attachment.type?.startsWith("image/") ? (
              <ImageIcon size={12} className="text-primary" />
            ) : (
              <FileText size={12} className="text-primary" />
            )}
            <span className="text-xs text-primary">{attachment.name}</span>
            <button
              onClick={() => setAttachment(null)}
              className="text-primary hover:text-primary/70"
              aria-label="Remove attachment"
            >
              <X size={12} />
            </button>
          </div>
        )}

        {/* The card with the textarea + paperclip + send. Wrapped in
            a relative div so the SlashMenu can position itself above
            the card via `bottom-full left-0`. */}
        <div className="relative">
          {showSkills && filteredSkills.length > 0 && (
            <SlashMenu
              skills={filteredSkills}
              activeIndex={skillIndex}
              onSelect={handleSkillSelect}
              onHoverIndex={setSkillIndex}
              size="md"
            />
          )}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            accept="image/*,.txt,.md,.json,.js,.jsx,.ts,.tsx,.py,.html,.css"
            className="hidden"
            data-testid="composer-file-input"
          />
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
              onClick={() => fileInputRef.current?.click()}
              data-testid="composer-paperclip"
            >
              <Paperclip className="h-4 w-4" />
            </Button>
            <div className="relative flex-1">
              <textarea
                ref={textareaRef}
                value={text}
                onChange={(e) => {
                  const value = e.target.value;
                  setText(value);
                  setCursor(e.target.selectionStart ?? value.length);
                  if (value.startsWith("/")) {
                    if (!showSkills) {
                      setShowSkills(true);
                      setSkillIndex(0);
                      fetchSkills();
                    }
                  } else {
                    setShowSkills(false);
                  }
                }}
                onSelect={(e) => {
                  const t = e.currentTarget;
                  setCursor(t.selectionStart ?? t.value.length);
                }}
                onKeyDown={(e) => {
                  // Route keys through the slash-menu / autocomplete
                  // / send logic. The autocomplete popover also has a
                  // document-level capture handler (for arrow nav),
                  // but Enter / Escape are handled here so we can
                  // prevent the send-button from firing when a
                  // popover is open.
                  handleKeyDown(e);
                }}
                placeholder={isBusy ? `Waiting for ${expertLabel}…` : t("chat.placeholder")}
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
        </div>

        {report.refused && (
          <p className="mt-2 text-center text-[10.5px] text-red-600" data-testid="hard-limit-error">
            {report.refusal_reason}
          </p>
        )}
        <p className="mt-2 text-center text-[10px] text-muted-foreground">
          Enter to send · Shift+Enter for new line · / for skills · @ for context
        </p>
      </div>
    </div>
  );
}
