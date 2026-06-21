import { useState, useRef, useEffect } from "react";
import { Send, Paperclip, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ComposerProps {
  onSend: (text: string, attachment?: { name: string; path: string; type: string }) => void;
  disabled?: boolean;
  status: "idle" | "thinking" | "streaming" | "error";
  expertLabel: string;
}

export function Composer({ onSend, disabled, status, expertLabel }: ComposerProps) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText("");
  };

  const isBusy = status === "thinking" || status === "streaming";

  return (
    <div className="border-t border-border p-4">
      <div className="mx-auto max-w-3xl">
        <div
          className={cn(
            "flex items-end gap-2 rounded-lg border border-input bg-background p-2 transition-shadow",
            "focus-within:border-foreground/30 focus-within:shadow-sm"
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
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={isBusy ? `Waiting for ${expertLabel}…` : `Message ${expertLabel}…`}
            disabled={disabled}
            rows={1}
            className="flex-1 resize-none border-0 bg-transparent py-1.5 text-sm outline-none placeholder:text-muted-foreground focus:ring-0 disabled:opacity-50"
          />
          <Button
            size="icon"
            className="h-8 w-8"
            disabled={!text.trim() || disabled}
            onClick={submit}
            aria-label="Send"
          >
            {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
        <p className="mt-2 text-center text-[10px] text-muted-foreground">
          MiniMax Agent can make mistakes. Verify critical info.
        </p>
      </div>
    </div>
  );
}
