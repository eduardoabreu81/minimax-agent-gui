import { useEffect, useRef } from "react";
import { Sparkles, Square } from "lucide-react";
import { useChat } from "@/hooks/useChat";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { Composer } from "@/components/chat/Composer";
import { cn } from "@/lib/utils";

interface ChatPanelProps {
  expertLabel: string;
  backendStatus: "starting" | "running" | "stopped" | "error";
  backendMessage?: string;
  onToolActivity?: (tools: { name: string; status: "pending" | "done" | "error" }[]) => void;
}

export function ChatPanel({ expertLabel, backendStatus, backendMessage, onToolActivity }: ChatPanelProps) {
  const { state, sendMessage, newChat } = useChat();
  const bottomRef = useRef<HTMLDivElement>(null);

  // Notify WorkPanel about current tool activity
  useEffect(() => {
    onToolActivity?.(
      state.currentTools.map((t) => ({ name: t.name, status: t.status }))
    );
  }, [state.currentTools, onToolActivity]);

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state.messages]);

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Top bar */}
      <div className="flex h-14 items-center justify-between border-b border-border px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-gradient-to-br from-sky-500 to-violet-600">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <div className="flex flex-col leading-tight">
            <h1 className="text-sm font-semibold">MiniMax Agent</h1>
            <p className="text-xs text-muted-foreground">
              Expert: <span className="font-medium text-foreground">{expertLabel}</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={newChat}
            className="rounded-md border border-border bg-card px-3 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            + New chat
          </button>
          <BackendStatusBadge status={backendStatus} message={backendMessage} />
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl space-y-4">
          {state.messages.length === 0 ? (
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-sm text-muted-foreground">
                👋 Welcome to MiniMax Agent Desktop.
              </p>
              <p className="mt-2 text-sm">
                Phase 2 ready — chat wired to the FastAPI sidecar via WebSocket. Type
                a message below to start.
              </p>
            </div>
          ) : (
            state.messages.map((m) => (
              <MessageBubble
                key={m.id}
                role={m.role}
                content={m.content}
                thinking={m.thinking}
                streaming={m.streaming}
                toolNames={m.toolCalls?.map((t) => t.name)}
              />
            ))
          )}
          {state.status === "error" && state.errorMessage && (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-400">
              {state.errorMessage}
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <Composer
        onSend={sendMessage}
        disabled={backendStatus !== "running"}
        status={state.status}
        expertLabel={expertLabel}
        sessionId={state.sessionId}
      />
    </div>
  );
}

function BackendStatusBadge({
  status,
  message,
}: {
  status: "starting" | "running" | "stopped" | "error";
  message?: string;
}) {
  const config = {
    starting: { dot: "bg-amber-500", text: "Starting backend…", color: "text-amber-500" },
    running: { dot: "bg-emerald-500", text: "Backend running", color: "text-emerald-500" },
    stopped: { dot: "bg-zinc-500", text: "Backend stopped", color: "text-zinc-500" },
    error: { dot: "bg-red-500", text: message ?? "Backend error", color: "text-red-500" },
  }[status];

  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5">
      <span className={cn("h-2 w-2 rounded-full", config.dot)} />
      <span className={cn("text-xs font-medium", config.color)}>{config.text}</span>
    </div>
  );
}
