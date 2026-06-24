import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { apiFetch, apiWebSocketUrl } from '../../lib/api.js'
import { useTranslation } from 'react-i18next'
import { Send, ArrowRight, Plus, User, Bot, Loader2, Paperclip, X, Image as ImageIcon, FileText, MessageSquarePlus, Trash2, ChevronDown, Pencil, Search } from 'lucide-react'
import SlashMenu from '../shared/SlashMenu.jsx'
import { useSessionProtection } from '../../hooks/useSessionProtection'
import { useSessionTokens } from '../../context/SessionTokensContext'
import ThinkingBlock from '../shared/ThinkingBlock'
import CopyButton from '../shared/CopyButton'
import MarkdownRenderer from '../MarkdownRenderer'
import ContextWarningBanner from '../shared/ContextWarningBanner'
import { getCompactThresholds, getContextLimit } from '../../lib/modelLimits'
import { useContextRefs } from '../context-refs/useContextRefs.js'
import { ContextRefChips } from '../context-refs/ContextRefChips.jsx'
import { ContextRefAutocomplete } from '../context-refs/ContextRefAutocomplete.jsx'
import { buildAttachedContext } from '../context-refs/buildAttachedContext.js'

function generateId() {
  return Math.random().toString(36).substring(2, 10)
}

export default function ChatPanel({
  onProcessingChange,
  activeModel: activeModelProp,
  setActiveModel,
  thinkingEnabled: thinkingEnabledProp,
  setThinkingEnabled,
  supportsThinking: supportsThinkingProp,
} = {}) {
  const { t } = useTranslation()
  // Per-turn model + thinking controls are owned by App.jsx (so the
  // StatusBar's model picker stays in sync across panels). Props are
  // required — App.jsx always passes them. The `??` fallback is just
  // defensive for unit-test mounts.
  const activeModel = activeModelProp ?? 'MiniMax-M3'
  const thinkingEnabled = thinkingEnabledProp ?? true
  const supportsThinking = supportsThinkingProp ?? (activeModelProp === 'MiniMax-M3')
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  // Cursor position inside the textarea — used by the @-refs hook
  // to compute which partial ref the user is currently typing and
  // to position the autocomplete popover relative to the caret.
  const [cursor, setCursor] = useState(0)
  const [isConnected, setIsConnected] = useState(false)
  const [isThinking, setIsThinking] = useState(false)
  // True between sending {type:'compact'} and receiving the matching
  // compact_done event. Drives the spinner in the ContextWarningBanner
  // for the auto/max tiers so the user sees feedback while the backend
  // runs _summarize_messages (can take 1-3s for long histories).
  const [compactInFlight, setCompactInFlight] = useState(false)
  const [attachment, setAttachment] = useState(null)
  const [sessionId, setSessionId] = useState(() => {
    // Persist the chat sessionId in localStorage so it survives tab
    // switches, page refreshes, and accidental component unmounts.
    // A new session is only created on explicit "New Chat" (which
    // clears the storage key) or for first-time visitors. This way,
    // a user can switch to Code, switch back, and find their
    // conversation exactly where they left it.
    try {
      const stored = localStorage.getItem('chat-session-id')
      if (stored) return stored
    } catch { /* ignore */ }
    return generateId()
  })

  // Keep localStorage in sync with the current sessionId. We
  // intentionally save on every change (including the "New Chat"
  // path which sets a new UUID) so the next mount reads the latest.
  useEffect(() => {
    try {
      localStorage.setItem('chat-session-id', sessionId)
    } catch { /* ignore */ }
  }, [sessionId])
  // Accumulates the model's reasoning chunks streamed during the current
  // run, so we can attach the full block to the final assistant message.
  const streamingThinkingRef = useRef('')
  const [conversations, setConversations] = useState([])
  const [showConvList, setShowConvList] = useState(false)
  const [skills, setSkills] = useState([])
  const [showSkills, setShowSkills] = useState(false)
  const [skillIndex, setSkillIndex] = useState(0)
  const [thinkingDuration, setThinkingDuration] = useState(0)
  const [editingId, setEditingId] = useState(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState(null)
  const [searchLoading, setSearchLoading] = useState(false)
  // Permission request from the agent (shown as an inline modal in the chat).
  // Read-only tools (risk === "low") are auto-approved; medium/high risk
  // surface here so the user can approve or reject.
  const [permissionRequest, setPermissionRequest] = useState(null)
  const wsRef = useRef(null)
  const scrollRef = useRef(null)
  const fileInputRef = useRef(null)
  const convListRef = useRef(null)
  const searchTimeoutRef = useRef(null)
  // Ref to the composer textarea — used to anchor the @-ref
  // autocomplete popover (positioned via getBoundingClientRect in
  // ContextRefAutocomplete).
  const composerTextareaRef = useRef(null)

  const { register } = useSessionProtection()

  useEffect(() => {
    register('chat-thinking', isThinking, 'Agent is thinking')
  }, [isThinking, register])

  // ---- @-refs: parse, expand (debounced), autocomplete (debounced) ----
  // The hook is pure-React: it observes (draft, cursor, sessionId) and
  // returns the live state. We do NOT mutate `input` from inside the
  // hook — the textarea onChange is the source of truth.
  const { parsed, partial, report, isExpanding, suggestions, isListing } = useContextRefs({
    draft: input,
    cursor,
    sessionId,
  })

  // Popover open state mirrors partial: true when there's an active
  // partial ref at the cursor, false otherwise (whitespace, no @,
  // cursor not on a ref). Escape flips it to false explicitly.
  const [autocompleteOpen, setAutocompleteOpen] = useState(false)
  useEffect(() => {
    if (partial) setAutocompleteOpen(true)
    else setAutocompleteOpen(false)
  }, [partial])

  // When the user picks a suggestion from the autocomplete popover,
  // replace the partial @-ref in the text with the inserted string
  // (which already includes the "@type:" prefix) and move the
  // cursor to just after the inserted text.
  const handleAutocompleteSelect = useCallback((insertion) => {
    if (!partial) return
    setInput((prev) => {
      const before = prev.slice(0, partial.start)
      const after = prev.slice(partial.end)
      const next = before + insertion + after
      const newCursor = before.length + insertion.length
      // setTimeout so the textarea re-renders with the new value
      // before we restore the caret.
      setTimeout(() => {
        if (composerTextareaRef.current) {
          composerTextareaRef.current.focus()
          composerTextareaRef.current.setSelectionRange(newCursor, newCursor)
        }
      }, 0)
      return next
    })
    setAutocompleteOpen(false)
  }, [partial])

  useEffect(() => {
    register('chat-input', input.trim().length > 0, 'Unsent message')
  }, [input, register])

  useEffect(() => {
    register('chat-attachment', !!attachment, 'Pending attachment')
  }, [attachment, register])

  const fetchConversations = async () => {
    try {
      const res = await apiFetch('/api/conversations?type=chat')
      const data = await res.json()
      if (data.success) {
        const list = data.conversations || []
        setConversations(list)
        // Do NOT auto-load the most recent conversation. Each tab open
        // (or each "New Chat" click) starts a fresh empty conversation;
        // the user picks a previous one by clicking it in the sidebar
        // list explicitly.
      }
    } catch (e) { /* ignore */ }
  }

  const fetchSkills = async () => {
    try {
      const res = await apiFetch('/api/skills')
      const data = await res.json()
      setSkills(data.skills || [])
    } catch (e) { /* ignore */ }
  }

  const connectWebSocket = useCallback(async (sid) => {
    if (wsRef.current) {
      wsRef.current.close()
    }
    const ws = new WebSocket(await apiWebSocketUrl(`/ws/chat/${sid}`))
    wsRef.current = ws

    ws.onopen = () => setIsConnected(true)
    ws.onclose = () => setIsConnected(false)
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data)
      console.log('[WS RECV]', data.type, data.usage ? `usage: ${JSON.stringify(data.usage)}` : '', data.model ? `model: ${data.model}` : '')
      if (data.type === 'history') {
        // Filter out internal agent-loop events (step_start, tool_*) that
        // might have been saved to old conversations before the cleanup.
        // Split the assistant's stored ``thinking`` into a SEPARATE
        // message so the chat timeline shows the reasoning as its own
        // event before the response (matches the streaming behavior).
        const raw = (data.messages || []).filter(
          m => m.type !== 'step_start' && m.type !== 'tool_calls' && m.type !== 'tool_result'
        )
        const flat = []
        for (const m of raw) {
          if (m.thinking) {
            flat.push({ type: 'thinking', content: m.thinking, model: m.model || null })
          }
          flat.push(m)
        }
        setMessages(flat)
        streamingThinkingRef.current = ''
        setIsThinking(false)
        onProcessingChange?.(false)
      } else if (data.type === 'status' && data.content === 'thinking...') {
        setIsThinking(true)
        onProcessingChange?.(true)
      } else if (data.type === 'user') {
        // User message was already added locally, ignore WebSocket echo
        setIsThinking(true)
        onProcessingChange?.(true)
      } else if (data.type === 'thinking') {
        // Legacy/non-streaming thinking event (one-shot per LLM call).
        // The new per-token path lives under thinking_delta below.
        if (data.content) {
          setMessages((prev) => {
            const last = prev[prev.length - 1]
            if (last && last.type === 'thinking' && last.streaming) {
              const updated = [...prev]
              updated[updated.length - 1] = {
                ...last,
                content: last.content + '\n\n' + data.content,
              }
              return updated
            }
            return [...prev, { type: 'thinking', content: data.content, streaming: true }]
          })
        }
      } else if (data.type === 'thinking_delta') {
        // Per-token thinking stream. Append to the in-flight thinking
        // message so the user sees the reasoning appear word-by-word.
        if (data.content) {
          setMessages((prev) => {
            const last = prev[prev.length - 1]
            if (last && last.type === 'thinking' && last.streaming) {
              const updated = [...prev]
              updated[updated.length - 1] = {
                ...last,
                content: last.content + data.content,
              }
              return updated
            }
            return [...prev, { type: 'thinking', content: data.content, streaming: true }]
          })
        }
      } else if (data.type === 'text_delta') {
        // Per-token text stream for the visible response. Append to
        // the in-flight assistant message so it appears word-by-word.
        if (data.content) {
          setMessages((prev) => {
            const last = prev[prev.length - 1]
            if (last && last.type === 'assistant' && last.streaming) {
              const updated = [...prev]
              updated[updated.length - 1] = {
                ...last,
                content: last.content + data.content,
              }
              return updated
            }
            return [...prev, {
              type: 'assistant',
              content: data.content,
              streaming: true,
            }]
          })
        }
      } else if (data.type === 'step_start') {
        // Agent-loop step indicator — internal state, not chat content.
        // Don't add to messages (the CodingPanel uses this for the
        // activity widget; the chat just shows messages).
        // Update thinking state so the spinner keeps animating.
        setIsThinking(true)
        onProcessingChange?.(true)
      } else if (data.type === 'skill_activated') {
        setIsThinking(false)
        onProcessingChange?.(false)
        setMessages((prev) => [...prev, { type: 'system', content: `Skill '${data.skill}' activated` }])
      } else if (data.type === 'permission_request') {
        // Auto-approve read-only tools (risk === "low" per the backend's
        // classifier) so the chat doesn't break for harmless lookups
        // (web_search, read_file, glob, grep, list_directory, get_skill,
        // understand_image, bash_output, …). Destructive / medium+high
        // risk surface as an inline modal so the user can decide.
        const risk = data.classification?.risk
        if (risk === 'low') {
          wsRef.current?.send(JSON.stringify({
            type: 'permission_response',
            request_id: data.request_id,
            approved: true,
          }))
          setMessages((prev) => [...prev, {
            type: 'system',
            content: `Auto-approved read-only tool: ${data.tool_name}.`,
          }])
        } else {
          setPermissionRequest(data)
          setMessages((prev) => [...prev, {
            type: 'system',
            content: `Permission requested for ${data.tool_name} (${risk ?? 'unknown'} risk).`,
          }])
        }
      } else if (data.type === 'usage') {
        // Backend sends per-turn token usage so the StatusBar's context
        // chip can show live progress. Anthropic usage shape:
        //   { input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens }
        // Always record when the backend emits this event — earlier we
        // dropped the payload when both input+output were 0, which
        // masked the fact that agent.last_usage was being populated with
        // the wrong field names (always 0). Trust the backend to emit
        // this event only when there's something meaningful.
        console.log('[ChatPanel] got usage event:', { sessionId, usage: data.usage, model: data.model })
        if (data.usage) {
          // data.by_source is the per-source breakdown from
          // Agent.estimate_by_source() (system / skills / tools /
          // messages / mcp_deferred / total). Optional — only present
          // since the token-attribution feature; older backends
          // omit it and we fall back to no breakdown.
          recordUsage(sessionId, data.usage, data.model || null, data.by_source || null)
        }
      } else if (data.type === 'compact_done') {
        // Backend finished _summarize_messages for our manual [Compact]
        // click. The follow-up `usage` event below carries the new
        // (post-compact) input_tokens so the StatusBar drops immediately.
        setCompactInFlight(false)
        setMessages((prev) => [...prev, {
          type: 'system',
          content: `Context compacted (${data.before_tokens?.toLocaleString() ?? '?'} → ${data.after_tokens?.toLocaleString() ?? '?'} tokens).`,
        }])
      } else if (data.type === 'compact_failed') {
        setCompactInFlight(false)
        setError?.(data.detail || 'Compact failed.')
        setMessages((prev) => [...prev, {
          type: 'system',
          content: `Context compact failed: ${data.detail || 'unknown error'}`,
        }])
      } else if (data.type === 'daily_updated') {
        // Backend appended to .agent/daily/{date}.md. Broadcast so any
        // open ContextModal / DocViewer can refresh without the user
        // re-opening it. Window-level event keeps it decoupled from
        // ChatPanel's tree (mirrors the minimax:media-complete pattern).
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('minimax:daily-updated', {
            detail: { date: data.date, path: data.path },
          }))
        }
      } else {
        setIsThinking(false)
        onProcessingChange?.(false)
        // Some backends pack usage into the assistant event instead of a
        // separate 'usage' event — record it either way so the StatusBar
        // sees real numbers even if the dedicated event isn't emitted.
        if (data.usage) {
          recordUsage(sessionId, data.usage, data.model || null, data.by_source || null)
        }
        // The final assistant message arrives AFTER all the text_delta
        // events have already streamed the content to the in-flight
        // assistant message. So here we just FREEZE the streaming
        // assistant (and any streaming thinking) instead of adding
        // a new message — that would duplicate the content.
        const finalThinking = data.thinking || streamingThinkingRef.current || null
        streamingThinkingRef.current = ''
        setMessages((prev) => {
          // Freeze the in-flight assistant message (if any) and add
          // any metadata the backend sent (model tag, final usage).
          const last = prev[prev.length - 1]
          if (last && last.type === 'assistant' && last.streaming) {
            const frozen = [...prev]
            frozen[frozen.length - 1] = {
              ...last,
              ...data,
              streaming: false,
              thinking: undefined,  // thinking lives in its own message
            }
            // If there's a final thinking to add (e.g. accumulated
            // after text finished), insert it as a separate message
            // before the now-frozen assistant.
            if (finalThinking) {
              // Most likely the streaming thinking message is already
              // present. Only inject a separate one if it isn't.
              const hasThinking = prev.some(m => m.type === 'thinking' && !m.streaming)
              if (!hasThinking) {
                frozen.splice(frozen.length - 1, 0, {
                  type: 'thinking',
                  content: finalThinking,
                  model: data.model || null,
                })
              }
            }
            return frozen
          }
          // No streaming assistant — fall back to building messages
          // from scratch (covers non-streaming path / older backends).
          const frozen = prev.map((m, i) =>
            i === prev.length - 1 && m.type === 'thinking' && m.streaming
              ? { ...m, streaming: false }
              : m
          )
          const lastFrozen = frozen[frozen.length - 1]
          const hasThinkingMsg = lastFrozen && lastFrozen.type === 'thinking' && !lastFrozen.streaming
          if (!hasThinkingMsg && finalThinking) {
            frozen.push({ type: 'thinking', content: finalThinking, model: data.model || null })
          }
          frozen.push({ ...data, thinking: undefined })
          return frozen
        })
      }
    }
  }, [onProcessingChange])

  // Thinking duration timer
  useEffect(() => {
    if (!isThinking) {
      setThinkingDuration(0)
      return
    }
    const start = Date.now()
    const interval = setInterval(() => {
      setThinkingDuration(Math.floor((Date.now() - start) / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [isThinking])

  // Register the current chat session with the StatusBar so the context
  // chip tracks tokens for THIS conversation. The bucket persists across
  // session changes (you can switch to an old chat and see its old totals).
  const { setActiveSessionId, recordUsage, sessions, activeSessionId } = useSessionTokens()
  useEffect(() => {
    setActiveSessionId(sessionId)
    return () => setActiveSessionId(null)
  }, [sessionId, setActiveSessionId])

  // Context window pct + banner level. Computed from the live token
  // bucket for THIS session so it tracks the active conversation (not
  // the model picker selection — see bucket.lastModel below).
  //
  // Tier ladder (per MODEL_COMPACT_THRESHOLDS, mirror of mini-agent):
  //   max  (90%) > auto (80%) > warn (50%, M3-only)
  //
  // Banner state-based: re-renders show banner whenever pct >= threshold.
  useEffect(() => {
    fetchConversations()
    connectWebSocket(sessionId)
    return () => wsRef.current?.close()
  }, [sessionId, connectWebSocket])

  const banner = useMemo(() => {
    const bucket = activeSessionId ? sessions[activeSessionId] : null
    const modelId = bucket?.lastModel || activeModelProp || null
    if (!modelId) return { level: null, pct: 0, used: 0, limit: 0 }
    const used = bucket?.lastTurnInput || bucket?.input_tokens || 0
    const limit = getContextLimit(modelId)
    if (limit <= 0) return { level: null, pct: 0, used, limit }
    const pct = Math.min(100, (used / limit) * 100)
    const t = getCompactThresholds(modelId)
    let level = null
    if (pct >= t.max * 100)        level = 'max'
    else if (pct >= t.auto * 100)  level = 'auto'
    else if (t.warn != null && pct >= t.warn * 100) level = 'warn'
    return { level, pct, used, limit }
  }, [sessions, activeSessionId, activeModelProp])

  // Send {type:'compact'} on the active WebSocket. Used by the [Compact]
  // button in the warn-tier banner (manual user opt-in) and by the
  // auto-tier banner (UI feedback while the backend triggers pre-LLM
  // summarize at 80%).
  const triggerCompact = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
    setCompactInFlight(true)
    wsRef.current.send(JSON.stringify({ type: 'compact', model: activeModelProp }))
  }, [activeModelProp])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  // Close conversation list when clicking outside
  useEffect(() => {
    const handleClick = (e) => {
      if (convListRef.current && !convListRef.current.contains(e.target)) {
        setShowConvList(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const startNewChat = () => {
    try { localStorage.removeItem('chat-session-id') } catch { /* ignore */ }
    const newId = generateId()
    setMessages([])
    setSessionId(newId)
    setShowConvList(false)
    fetchConversations()
  }

  const loadConversation = (conv) => {
    setMessages([])
    setSessionId(conv.id)
    setShowConvList(false)
    setSearchQuery('')
    setSearchResults(null)
  }

  const deleteConversation = async (e, convId) => {
    e.stopPropagation()
    try {
      await apiFetch(`/api/conversations/${convId}`, { method: 'DELETE' })
      setConversations(prev => prev.filter(c => c.id !== convId))
      if (convId === sessionId) {
        startNewChat()
      }
    } catch (err) { console.error('Delete failed:', err) }
  }

  const startRename = (e, conv) => {
    e.stopPropagation()
    setEditingId(conv.id)
    setEditingTitle(conv.title)
  }

  const submitRename = async (convId) => {
    try {
      await apiFetch(`/api/conversations/${convId}/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: editingTitle })
      })
      setConversations(prev => prev.map(c => c.id === convId ? { ...c, title: editingTitle } : c))
    } catch (err) { console.error('Rename failed:', err) }
    setEditingId(null)
    setEditingTitle('')
  }

  const activateSkill = (skillName) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'activate_skill', skill: skillName }))
    }
    setMessages(prev => [...prev, { type: 'system', content: `Skill '${skillName}' activated` }])
    setInput('')
    setShowSkills(false)
  }

  const handlePermissionApprove = useCallback(() => {
    if (!permissionRequest || !wsRef.current) return
    wsRef.current.send(JSON.stringify({
      type: 'permission_response',
      request_id: permissionRequest.request_id,
      approved: true,
    }))
    setMessages(prev => [...prev, { type: 'system', content: `Tool approved: ${permissionRequest.tool_name}` }])
    setPermissionRequest(null)
  }, [permissionRequest])

  const handlePermissionReject = useCallback(() => {
    if (!permissionRequest || !wsRef.current) return
    wsRef.current.send(JSON.stringify({
      type: 'permission_response',
      request_id: permissionRequest.request_id,
      approved: false,
    }))
    setMessages(prev => [...prev, { type: 'system', content: `Tool rejected: ${permissionRequest.tool_name}` }])
    setPermissionRequest(null)
  }, [permissionRequest])

  const sendMessage = useCallback(async () => {
    if ((!input.trim() && !attachment) || !wsRef.current) return
    const trimmed = input.trim()

    // Re-run expand right before send so the attached context is
    // fresh (the debounced report might be stale if the user typed
    // fast and hit Enter before the 400ms timer fired).
    let attached = ''
    try {
      const res = await apiFetch('/api/context-refs/expand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, message: trimmed }),
      })
      if (res.ok) {
        const body = await res.json()
        if (body.refused) {
          // Hard limit — refuse the send and surface the reason.
          alert(`Context too large to send: ${body.refusal_reason}`)
          return
        }
        attached = buildAttachedContext(body)
      }
    } catch {
      // Network error — send without attached context. The agent
      // still sees the @-refs in plain text, no worse than the
      // pre-PR-A flow.
    }

    const finalText = attached ? `${trimmed}\n\n${attached}` : trimmed
    const payload = {
      message: finalText,
      permission_mode: 'agent',
      // Per-turn model + thinking override. The backend uses these to
      // choose which LLM to call and whether to inject the Anthropic
      // `thinking` param for this message.
      model: activeModel,
      thinking: supportsThinking ? thinkingEnabled : false,
    }
    if (attachment) payload.attachment = attachment.path
    // Show user message immediately before sending (use the trimmed
    // original — the attached context is for the agent only, the
    // chat history stays clean).
    setMessages(prev => [...prev, {
      type: 'user',
      content: input.trim() || '📎 Attachment sent',
      attachment: attachment?.path
    }])
    streamingThinkingRef.current = ''
    wsRef.current.send(JSON.stringify(payload))
    setInput('')
    setCursor(0)
    setAttachment(null)
    setIsThinking(true)
    onProcessingChange?.(true)
  }, [input, attachment, onProcessingChange, activeModel, supportsThinking, thinkingEnabled, sessionId])

  const filteredSkills = input.startsWith('/')
    ? skills.filter(s =>
        s.name.toLowerCase().includes(input.slice(1).toLowerCase()) ||
        s.description?.toLowerCase().includes(input.slice(1).toLowerCase())
      )
    : []

  const handleKeyDown = (e) => {
    if (e.key === 'Escape' && autocompleteOpen) {
      e.preventDefault()
      setAutocompleteOpen(false)
      return
    }
    if (showSkills && filteredSkills.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSkillIndex(i => (i + 1) % filteredSkills.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSkillIndex(i => (i - 1 + filteredSkills.length) % filteredSkills.length)
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        activateSkill(filteredSkills[skillIndex].name)
        return
      }
      if (e.key === 'Escape') {
        setShowSkills(false)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const formData = new FormData()
    formData.append('file', file)
    try {
      const res = await apiFetch('/api/upload', { method: 'POST', body: formData })
      const data = await res.json()
      if (data.success) {
        setAttachment({ name: file.name, path: data.path, type: file.type })
      }
    } catch (err) {
      console.error('Upload failed:', err)
    }
    e.target.value = ''
  }

  const currentTitle = conversations.find(c => c.id === sessionId)?.title || 'Chat'

  return (
    <div className="flex flex-col h-full bg-card">
      {/* Context window warning banner — appears whenever the active
          session's pct crosses a threshold (50/80/90). State-based:
          shows again on every render where pct >= threshold; dismissal
          is per-mount (in-memory, see ContextWarningBanner). */}
      <ContextWarningBanner
        level={banner.level}
        pct={banner.pct}
        compacting={compactInFlight}
        onCompact={triggerCompact}
      />

      {/* Header */}
      <div className="flex items-center justify-between px-[22px] border-b border-border" style={{ height: 52, flexShrink: 0 }}>
        <div className="relative flex items-center gap-2.5" ref={convListRef}>
          <button
            onClick={() => setShowConvList(!showConvList)}
            className="flex items-center gap-2 hover:opacity-80 transition-opacity"
            style={{ fontSize: 15, fontWeight: 600 }}
          >
            <span className="text-foreground">{currentTitle}</span>
            <ChevronDown size={14} className={`text-muted-foreground transition-transform ${showConvList ? 'rotate-180' : ''}`} />
          </button>
          <span className="bg-secondary text-muted-foreground" style={{ fontSize: 11, padding: '2px 8px', borderRadius: 5 }}>
            {messages.length} messages
          </span>
          {showConvList && (
            <div className="absolute top-full left-0 mt-1 w-72 bg-card border border-border rounded-xl shadow-lg z-50 py-2 max-h-80 overflow-y-auto">
              <button
                onClick={startNewChat}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-primary hover:bg-primary/10 transition-colors"
              >
                <MessageSquarePlus size={14} /> New Chat
              </button>
              <div className="border-t border-border my-1" />
              {conversations.length === 0 && (
                <p className="px-3 py-2 text-xs text-muted-foreground">No previous conversations</p>
              )}
              {conversations.map((conv) => (
                <div
                  key={conv.id}
                  onClick={() => loadConversation(conv)}
                  className={`flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-surface transition-colors ${conv.id === sessionId ? 'bg-primary/10' : ''}`}
                >
                  <div className="flex-1 min-w-0">
                    {editingId === conv.id ? (
                      <input
                        autoFocus
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') submitRename(conv.id)
                          if (e.key === 'Escape') { setEditingId(null); setEditingTitle('') }
                        }}
                        onBlur={() => submitRename(conv.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full bg-card border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-primary"
                      />
                    ) : (
                      <>
                        <p className="text-xs font-medium text-foreground truncate">{conv.title}</p>
                        <p className="text-[10px] text-muted-foreground">{conv.message_count} messages</p>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-0.5">
                    <button
                      onClick={(e) => startRename(e, conv)}
                      className="p-1 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
                      title="Rename conversation"
                    >
                      <Pencil size={10} />
                    </button>
                    <button
                      onClick={(e) => deleteConversation(e, conv.id)}
                      className="p-1 rounded hover:bg-error/10 text-muted-foreground hover:text-error transition-colors"
                      title="Delete conversation"
                    >
                      <Trash2 size={10} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={startNewChat}
          title="New Chat"
          className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border text-foreground text-[12.5px] font-medium hover:border-primary/50 transition-colors"
        >
          <Plus size={15} aria-hidden="true" /> New Chat
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-5">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Bot size={48} className="mb-4 opacity-30" />
            <p className="text-sm text-foreground/90">{t('chat.emptyTitle')}</p>
            <p className="text-xs mt-1.5 text-muted-foreground font-medium tracking-wide">{t('chat.emptySubtitle')}</p>
          </div>
        )}

        {messages.map((msg, idx) => {
          if (msg.type === 'tool_result') {
            return (
              <div key={idx} className="my-2 p-2 bg-slate-800/50 rounded border border-slate-700/50">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-cyan-400">🔧 {msg.tool}</span>
                  <span className="text-slate-400">{msg.success ? '✅' : '❌'}</span>
                </div>
                {msg.arguments?.path && (
                  <div className="text-xs text-slate-500 mt-1">{msg.arguments.path}</div>
                )}
              </div>
            )
          }
          if (msg.type === 'thinking') {
            // Standalone thinking message — emitted as its own chat
            // event so the user sees the reasoning arrive in real time
            // BEFORE the assistant's response. The block shows a
            // streaming cursor while chunks are still arriving.
            return (
              <div key={idx} className="max-w-[80%]">
                <ThinkingBlock
                  thinking={msg.content}
                  streaming={msg.streaming}
                />
              </div>
            )
          }
          if (msg.type === 'system') {
            return (
              <div key={idx} className="flex justify-center my-2">
                <span className="text-xs text-muted-foreground bg-surface border border-border px-3 py-1 rounded-full">{msg.content}</span>
              </div>
            )
          }
          // Skip any internal agent-loop events that slipped through.
          if (msg.type === 'step_start' || msg.type === 'tool_calls' || msg.type === 'tool_result') {
            return null
          }
          return (
            <div key={idx} className={`flex gap-3 ${msg.type === 'user' ? 'flex-row-reverse' : ''}`}>
              <div className={`
                w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0
                ${msg.type === 'user' ? 'bg-primary' : 'bg-surface border border-border'}
              `}>
                {msg.type === 'user' ? <User size={14} className="text-white" /> : <Bot size={14} className="text-primary" />}
              </div>
              <div className={`
                max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed space-y-2
                ${msg.type === 'user'
                  ? 'bg-primary text-white rounded-br-md'
                  : 'bg-surface border border-border text-foreground rounded-bl-md'
                }
              `}>
                {/* Model tag for assistant messages — confirms which model
                    produced this turn when the user has multiple options. */}
                {msg.type === 'assistant' && msg.model && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] text-primary/80 font-medium">
                      {msg.model}
                    </span>
                    <CopyButton text={msg.content} />
                  </div>
                )}
                <MarkdownRenderer content={msg.content} />
                {msg.attachment && (
                  <div className="mt-2 pt-2 border-t border-white/20">
                    {/\.(png|jpg|jpeg|webp|gif)$/i.test(msg.attachment) ? (
                      <img
                        src={`/api/files/download?path=${encodeURIComponent(msg.attachment)}`}
                        alt="attachment"
                        className="max-w-[200px] max-h-[150px] rounded-lg object-cover"
                        onError={(e) => { e.target.style.display = 'none' }}
                      />
                    ) : (
                      <div className="flex items-center gap-2 text-xs opacity-90">
                        <FileText size={14} />
                        <span className="truncate max-w-[200px]">{msg.attachment.split('/').pop()}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        })}

        {isThinking && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-surface border border-border flex items-center justify-center">
              <Bot size={14} className="text-primary" />
            </div>
            <div className="bg-surface border border-border rounded-2xl rounded-bl-md px-4 py-3">
              <Loader2 size={16} className="animate-spin text-muted-foreground" />
            </div>
          </div>
        )}
      </div>

      {/* Composer — single rounded card (mockup: lines 242-260) */}
      <div style={{ flex: 'none', padding: '0 24px 22px' }}>
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          {attachment && (
            <div className="flex items-center gap-2 mb-2 px-3 py-1.5 bg-primary/10 border border-primary/20 rounded-lg w-fit">
              {attachment.type?.startsWith('image/') ? <ImageIcon size={12} className="text-primary" /> : <FileText size={12} className="text-primary" />}
              <span className="text-xs text-primary">{attachment.name}</span>
              <button onClick={() => setAttachment(null)} className="text-primary hover:text-primary/70">
                <X size={12} />
              </button>
            </div>
          )}
          {/* @-ref preview chips (one per parsed @-ref). Renders
              nothing when there are no refs in the current draft. */}
          <ContextRefChips parsed={parsed} report={report} isExpanding={isExpanding} />
          <div className="relative">
            {showSkills && filteredSkills.length > 0 && (
              <SlashMenu
                skills={filteredSkills}
                activeIndex={skillIndex}
                onSelect={(s) => activateSkill(s.name)}
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
            />
            <div style={{ border: '1px solid hsl(var(--border))', borderRadius: 14, background: 'hsl(var(--card))', boxShadow: '0 4px 20px rgba(0,0,0,0.18)', overflow: 'hidden' }}>
              {/* Wrap textarea in a relative div so the @-ref
                  autocomplete popover can position itself relative
                  to the caret via anchorRef. */}
              <div className="relative">
                <textarea
                  ref={composerTextareaRef}
                  value={input}
                  onChange={(e) => {
                    const value = e.target.value
                    setInput(value)
                    setCursor(e.target.selectionStart ?? value.length)
                    if (value.startsWith('/')) {
                      if (!showSkills) fetchSkills()
                      setShowSkills(true)
                      setSkillIndex(0)
                    } else {
                      setShowSkills(false)
                    }
                  }}
                  onSelect={(e) => {
                    const t = e.currentTarget
                    setCursor(t.selectionStart ?? t.value.length)
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder={t('chat.placeholder')}
                  rows={1}
                  style={{ width: '100%', border: 'none', outline: 'none', resize: 'none', background: 'transparent', color: 'hsl(var(--foreground))', fontSize: 14, padding: '14px 16px 4px', minHeight: 48 }}
                />
                {autocompleteOpen && partial && (
                  <ContextRefAutocomplete
                    partial={partial}
                    suggestions={suggestions}
                    isLoading={isListing}
                    onSelect={handleAutocompleteSelect}
                    onClose={() => setAutocompleteOpen(false)}
                    anchorRef={composerTextareaRef}
                  />
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px 10px' }}>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={!isConnected}
                    title="Attach file or image"
                    className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-surface hover:text-foreground disabled:opacity-40 transition-colors"
                  >
                    <Paperclip size={17} aria-hidden="true" />
                  </button>
                </div>
                <button
                  onClick={sendMessage}
                  disabled={(!input.trim() && !attachment) || !isConnected}
                  title="Send"
                  className="flex items-center justify-center bg-primary hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
                  style={{ width: 34, height: 34, borderRadius: 9 }}
                >
                  <ArrowRight size={17} aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground mt-2 text-center">Enter to send · Shift+Enter for new line</p>
        </div>
      </div>

      {/* Inline permission modal — only for medium/high risk tools.
          Read-only tools (risk === "low") are auto-approved in the WS
          handler above and never reach this branch. */}
      {permissionRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md bg-card border border-border rounded-xl shadow-2xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 flex items-center justify-center text-amber-400">⚠</span>
              <h3 className="text-sm font-semibold">Tool Permission Required</h3>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Tool:</span>
                <span className="font-mono font-medium text-foreground">{permissionRequest.tool_name}</span>
              </div>
              {permissionRequest.classification && (
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Category:</span>
                    <span className="px-1.5 py-0.5 rounded bg-surface border border-border">{permissionRequest.classification.category}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Risk:</span>
                    <span className={`px-1.5 py-0.5 rounded ${
                      permissionRequest.classification.risk === 'high'
                        ? 'bg-red-400/10 text-red-400'
                        : permissionRequest.classification.risk === 'medium'
                        ? 'bg-amber-400/10 text-amber-400'
                        : 'bg-green-400/10 text-green-400'
                    }`}>
                      {permissionRequest.classification.risk}
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-muted-foreground shrink-0">Reason:</span>
                    <span className="text-foreground">{permissionRequest.classification.reason}</span>
                  </div>
                </>
              )}
              {permissionRequest.arguments && Object.keys(permissionRequest.arguments).length > 0 && (
                <div className="bg-surface border border-border rounded-lg p-2 max-h-32 overflow-y-auto">
                  <pre className="text-[10px] font-mono text-muted-foreground whitespace-pre-wrap">{JSON.stringify(permissionRequest.arguments, null, 2)}</pre>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={handlePermissionApprove}
                className="flex-1 py-2 bg-primary hover:bg-primary-hover text-white text-xs font-medium rounded-lg transition-colors"
              >
                Approve
              </button>
              <button
                onClick={handlePermissionReject}
                className="flex-1 py-2 bg-surface hover:bg-error/10 border border-border text-foreground hover:text-error text-xs font-medium rounded-lg transition-colors"
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
