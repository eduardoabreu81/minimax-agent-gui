// useChat — opens a WebSocket to the FastAPI sidecar and exposes reactive
// chat state. Used by the main ChatPanel.
//
// Events consumed (matches the existing /ws/chat/{session_id} protocol):
//   - history          { type, messages: [...] }
//   - user             { type, content }
//   - thinking         { type, content }           // snapshot
//   - thinking_delta   { type, content }           // streaming chunk
//   - text_delta       { type, content }           // streaming chunk
//   - tool_calls       { type, tools: [...] }      // model decided to call tools
//   - tool_result      { type, tool, result }      // tool finished
//   - step_start       { type, step }
//   - assistant        { type, content, thinking?, tool_calls? }  // final
//   - error            { type, content }
//   - status           { type, content }           // "thinking...", etc.
//   - skill_activated  { type, skill }
//
// The hook maintains a rolling in-flight assistant message that gets frozen
// when a new `assistant` event arrives, mirroring the web frontend behaviour.

import { useEffect, useRef, useState, useCallback } from "react";

export type Role = "user" | "assistant" | "system";

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  result?: string;
  status: "pending" | "done" | "error";
}

export interface Message {
  id: string;
  role: Role;
  content: string;
  thinking?: string;
  toolCalls?: ToolCall[];
  streaming?: boolean;
  createdAt: number;
}

export interface ChatState {
  messages: Message[];
  status: "idle" | "thinking" | "streaming" | "error";
  statusMessage?: string;
  currentTools: ToolCall[];
  step: number;
  errorMessage?: string;
  sessionId: string;
}

const DEFAULT_PORT = 8765;
const BACKEND_URL = `ws://127.0.0.1:${DEFAULT_PORT}`;

function newId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function getOrCreateSessionId(): string {
  const KEY = "minimax-chat-session-id";
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = newId();
    localStorage.setItem(KEY, id);
  }
  return id;
}

function resetSessionId(): string {
  const KEY = "minimax-chat-session-id";
  const id = newId();
  localStorage.setItem(KEY, id);
  return id;
}

export function useChat() {
  const [state, setState] = useState<ChatState>(() => ({
    messages: [],
    status: "idle",
    currentTools: [],
    step: 0,
    sessionId: getOrCreateSessionId(),
  }));

  const wsRef = useRef<WebSocket | null>(null);
  const inflightRef = useRef<Message | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);

  const applyToInflight = useCallback(
    (patch: Partial<Message>) => {
      const cur = inflightRef.current;
      if (!cur) return;
      inflightRef.current = { ...cur, ...patch };
      // Mirror into state.messages so React re-renders
      setState((s) => ({
        ...s,
        messages: s.messages.map((m) => (m.id === cur.id ? { ...m, ...patch } : m)),
      }));
    },
    []
  );

  const freezeInflight = useCallback(() => {
    const cur = inflightRef.current;
    if (!cur) return;
    inflightRef.current = null;
    setState((s) => ({
      ...s,
      status: "idle",
      messages: s.messages.map((m) =>
        m.id === cur.id ? { ...m, streaming: false } : m
      ),
    }));
  }, []);

  const handleEvent = useCallback(
    (msg: Record<string, unknown>) => {
      const type = msg.type as string;
      switch (type) {
        case "history": {
          const histMsgs = (msg.messages as Array<Record<string, unknown>>) || [];
          setState((s) => ({
            ...s,
            messages: histMsgs.map((m) => ({
              id: newId(),
              role: m.role as Role,
              content: (m.content as string) || "",
              thinking: m.thinking as string | undefined,
              toolCalls: m.tool_calls as ToolCall[] | undefined,
              createdAt: Date.now(),
            })),
          }));
          break;
        }
        case "user": {
          setState((s) => ({
            ...s,
            messages: [
              ...s.messages,
              {
                id: newId(),
                role: "user",
                content: (msg.content as string) || "",
                createdAt: Date.now(),
              },
            ],
          }));
          break;
        }
        case "status": {
          setState((s) => ({ ...s, status: "thinking", statusMessage: msg.content as string }));
          break;
        }
        case "step_start": {
          setState((s) => ({ ...s, step: (msg.step as number) ?? s.step + 1 }));
          break;
        }
        case "thinking": {
          // Snapshot (non-streaming)
          applyToInflight({ thinking: (msg.content as string) || "" });
          break;
        }
        case "thinking_delta": {
          const cur = inflightRef.current;
          if (!cur) return;
          applyToInflight({ thinking: (cur.thinking || "") + ((msg.content as string) || "") });
          break;
        }
        case "text_delta": {
          // Make sure we have an in-flight message
          if (!inflightRef.current) {
            const id = newId();
            const m: Message = {
              id,
              role: "assistant",
              content: "",
              streaming: true,
              createdAt: Date.now(),
            };
            inflightRef.current = m;
            setState((s) => ({ ...s, status: "streaming", messages: [...s.messages, m] }));
          }
          const cur2 = inflightRef.current!;
          applyToInflight({ content: cur2.content + ((msg.content as string) || "") });
          break;
        }
        case "tool_calls": {
          const tools = (msg.tools as Array<Record<string, unknown>>) || [];
          const calls: ToolCall[] = tools.map((t) => ({
            name: (t.name as string) || "unknown",
            args: (t.args as Record<string, unknown>) || {},
            status: "pending",
          }));
          setState((s) => ({
            ...s,
            currentTools: calls,
            messages: [
              ...s.messages,
              {
                id: newId(),
                role: "system",
                content: `🔧 Calling ${calls.map((c) => c.name).join(", ")}`,
                toolCalls: calls,
                createdAt: Date.now(),
              },
            ],
          }));
          break;
        }
        case "tool_result": {
          const toolName = msg.tool as string;
          setState((s) => ({
            ...s,
            currentTools: s.currentTools.map((t) =>
              t.name === toolName
                ? { ...t, result: String(msg.result || ""), status: "done" }
                : t
            ),
          }));
          break;
        }
        case "assistant": {
          // Final snapshot — freeze the in-flight message
          setState((s) => ({
            ...s,
            status: "idle",
            messages: inflightRef.current
              ? s.messages.map((m) =>
                  m.id === inflightRef.current!.id
                    ? {
                        ...m,
                        content: (msg.content as string) || m.content,
                        thinking: (msg.thinking as string) || m.thinking,
                        toolCalls:
                          (msg.tool_calls as ToolCall[] | undefined) || m.toolCalls,
                        streaming: false,
                      }
                    : m
                )
              : [
                  ...s.messages,
                  {
                    id: newId(),
                    role: "assistant",
                    content: (msg.content as string) || "",
                    thinking: msg.thinking as string | undefined,
                    createdAt: Date.now(),
                  },
                ],
          }));
          inflightRef.current = null;
          break;
        }
        case "error": {
          setState((s) => ({
            ...s,
            status: "error",
            errorMessage: msg.content as string,
          }));
          inflightRef.current = null;
          break;
        }
        case "skill_activated": {
          setState((s) => ({
            ...s,
            messages: [
              ...s.messages,
              {
                id: newId(),
                role: "system",
                content: `✨ Skill activated: ${msg.skill}`,
                createdAt: Date.now(),
              },
            ],
          }));
          break;
        }
        default:
          // ignore unknown events
          break;
      }
    },
    [applyToInflight]
  );

  const connect = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState <= 1) return;
    const sid = getOrCreateSessionId();
    const url = `${BACKEND_URL}/ws/chat/${sid}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;
    ws.onopen = () => {
      // eslint-disable-next-line no-console
      console.log("[chat] connected to", url);
      setState((s) => ({ ...s, status: "idle", errorMessage: undefined }));
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string);
        handleEvent(msg);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[chat] bad message", err);
      }
    };
    ws.onerror = () => {
      setState((s) => ({ ...s, status: "error", errorMessage: "WebSocket error" }));
    };
    ws.onclose = () => {
      // Try to reconnect in 2s if not manually closed
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = window.setTimeout(connect, 2000);
    };
  }, [handleEvent]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const sendMessage = useCallback(
    (text: string, attachment?: { name: string; path: string; type: string }) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== 1) {
        setState((s) => ({ ...s, status: "error", errorMessage: "Not connected" }));
        return;
      }
      // Pre-append a user message optimistically (the server echoes it back)
      setState((s) => ({
        ...s,
        status: "thinking",
        statusMessage: "Sending…",
        messages: [
          ...s.messages,
          {
            id: newId(),
            role: "user",
            content: text,
            createdAt: Date.now(),
          },
        ],
      }));
      ws.send(JSON.stringify({ message: text, attachment: attachment ?? null }));
    },
    []
  );

  const activateSkill = useCallback((skillName: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: "activate_skill", skill: skillName }));
  }, []);

  const newChat = useCallback(() => {
    const id = resetSessionId();
    wsRef.current?.close();
    inflightRef.current = null;
    setState({
      messages: [],
      status: "idle",
      currentTools: [],
      step: 0,
      sessionId: id,
    });
    setTimeout(connect, 200);
  }, [connect]);

  return {
    state,
    sendMessage,
    activateSkill,
    newChat,
  };
}
