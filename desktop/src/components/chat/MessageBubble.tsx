import { useState } from "react";
import { ChevronDown, ChevronRight, Brain, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ThinkingBlock({ content }: { content: string }) {
  const [open, setOpen] = useState(false);
  if (!content) return null;
  return (
    <div className="my-2 rounded-md border border-border/60 bg-muted/30">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <Brain className="h-3.5 w-3.5" />
        <span>Thinking</span>
      </button>
      {open && (
        <div className="border-t border-border/40 px-3 py-2 text-xs text-muted-foreground">
          <pre className="whitespace-pre-wrap font-mono leading-relaxed">{content}</pre>
        </div>
      )}
    </div>
  );
}

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // ignore
        }
      }}
      aria-label="Copy message"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
    </Button>
  );
}

interface MessageBubbleProps {
  role: "user" | "assistant" | "system";
  content: string;
  thinking?: string;
  streaming?: boolean;
  toolNames?: string[];
}

export function MessageBubble({ role, content, thinking, streaming, toolNames }: MessageBubbleProps) {
  if (role === "system") {
    return (
      <div className="my-2 flex justify-center">
        <div className="rounded-full border border-border/40 bg-muted/30 px-3 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          {content}
        </div>
      </div>
    );
  }

  const isUser = role === "user";
  return (
    <div className={cn("group flex w-full gap-3", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[80%] rounded-lg border px-4 py-2.5 text-sm shadow-sm",
          isUser
            ? "border-primary/30 bg-primary/10 text-foreground"
            : "border-border bg-card text-foreground"
        )}
      >
        {!isUser && thinking && <ThinkingBlock content={thinking} />}
        <div className="whitespace-pre-wrap leading-relaxed">
          {content}
          {streaming && (
            <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-foreground align-middle" />
          )}
        </div>
        {toolNames && toolNames.length > 0 && !isUser && (
          <div className="mt-2 flex flex-wrap gap-1">
            {toolNames.map((t) => (
              <span
                key={t}
                className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
              >
                🔧 {t}
              </span>
            ))}
          </div>
        )}
        {!streaming && !isUser && content && (
          <div className="mt-1 flex justify-end">
            <CopyButton text={content} />
          </div>
        )}
      </div>
    </div>
  );
}
