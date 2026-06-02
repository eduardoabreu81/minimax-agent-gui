import { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Send, User, Bot, Loader2, Paperclip, X, Image as ImageIcon, FileText, MessageSquarePlus, Trash2, ChevronDown, Pencil, Search } from 'lucide-react'
import { useSessionProtection } from '../../hooks/useSessionProtection'
import { useModelOverride } from '../../hooks/useModelOverride'
import { useThinkingToggle } from '../../hooks/useThinkingToggle'
import ModelThinkingControls from '../shared/ModelThinkingControls'
import ThinkingBlock from '../shared/ThinkingBlock'
import CopyButton from '../shared/CopyButton'
import MarkdownRenderer from '../MarkdownRenderer'

function generateId() {
  return Math.random().toString(36).substring(2, 10)
}

export default function ChatPanel({ onProcessingChange } = {}) {
  const { t } = useTranslation()
  // Per-turn model + thinking controls. Both are remembered in localStorage
  // so the user's last choice sticks across reloads.
  const { model: activeModel, setModel: setActiveModel, supportsThinking } = useModelOverride({
    fallback: 'MiniMax-M3',
    storageKey: 'chat-model-override',
  })
  const { thinkingEnabled, setThinkingEnabled } = useThinkingToggle({
    storageKey: 'chat-thinking-enabled',
    defaultValue: true,
  })
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [isConnected, setIsConnected] = useState(false)
  const [isThinking, setIsThinking] = useState(false)
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
  const wsRef = useRef(null)
  const scrollRef = useRef(null)
  const fileInputRef = useRef(null)
  const convListRef = useRef(null)
  const searchTimeoutRef = useRef(null)

  const { register } = useSessionProtection()

  useEffect(() => {
    register('chat-thinking', isThinking, 'Agent is thinking')
  }, [isThinking, register])

  useEffect(() => {
    register('chat-input', input.trim().length > 0, 'Unsent message')
  }, [input, register])

  useEffect(() => {
    register('chat-attachment', !!attachment, 'Pending attachment')
  }, [attachment, register])

  const fetchConversations = async () => {
    try {
      const res = await fetch('/api/conversations?type=chat')
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
      const res = await fetch('/api/skills')
      const data = await res.json()
      setSkills(data.skills || [])
    } catch (e) { /* ignore */ }
  }

  const connectWebSocket = useCallback((sid) => {
    if (wsRef.current) {
      wsRef.current.close()
    }
    const ws = new WebSocket(`ws://localhost:8000/ws/chat/${sid}`)
    wsRef.current = ws

    ws.onopen = () => setIsConnected(true)
    ws.onclose = () => setIsConnected(false)
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data)
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
        // Chat does not have a permission modal yet; auto-reject for safety
        wsRef.current?.send(JSON.stringify({
          type: 'permission_response',
          request_id: data.request_id,
          approved: false,
        }))
        setMessages((prev) => [...prev, {
          type: 'system',
          content: `Permission required for tool: ${data.tool_name}. Rejected in chat mode.`,
        }])
      } else {
        setIsThinking(false)
        onProcessingChange?.(false)
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

  useEffect(() => {
    fetchConversations()
    connectWebSocket(sessionId)
    return () => wsRef.current?.close()
  }, [sessionId, connectWebSocket])

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
      await fetch(`/api/conversations/${convId}`, { method: 'DELETE' })
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
      await fetch(`/api/conversations/${convId}/rename`, {
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

  const sendMessage = useCallback(() => {
    if ((!input.trim() && !attachment) || !wsRef.current) return
    const payload = {
      message: input,
      permission_mode: 'agent',
      // Per-turn model + thinking override. The backend uses these to
      // choose which LLM to call and whether to inject the Anthropic
      // `thinking` param for this message.
      model: activeModel,
      thinking: supportsThinking ? thinkingEnabled : false,
    }
    if (attachment) payload.attachment = attachment.path
    // Show user message immediately before sending
    setMessages(prev => [...prev, {
      type: 'user',
      content: input || '📎 Attachment sent',
      attachment: attachment?.path
    }])
    streamingThinkingRef.current = ''
    wsRef.current.send(JSON.stringify(payload))
    setInput('')
    setAttachment(null)
    setIsThinking(true)
    onProcessingChange?.(true)
  }, [input, attachment, onProcessingChange, activeModel, supportsThinking, thinkingEnabled])

  const filteredSkills = input.startsWith('/')
    ? skills.filter(s =>
        s.name.toLowerCase().includes(input.slice(1).toLowerCase()) ||
        s.description?.toLowerCase().includes(input.slice(1).toLowerCase())
      )
    : []

  const handleKeyDown = (e) => {
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
      const res = await fetch('/api/upload', { method: 'POST', body: formData })
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
      {/* Header */}
      <div className="h-14 flex items-center px-6 border-b border-border bg-surface/50">
        <div className="relative" ref={convListRef}>
          <button
            onClick={() => setShowConvList(!showConvList)}
            className="flex items-center gap-2 text-sm font-semibold text-foreground hover:text-primary transition-colors"
          >
            {currentTitle}
            <ChevronDown size={14} className={`transition-transform ${showConvList ? 'rotate-180' : ''}`} />
          </button>
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
                <p className="px-3 py-2 text-xs text-muted">No previous conversations</p>
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
                        <p className="text-[10px] text-muted">{conv.message_count} messages</p>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-0.5">
                    <button
                      onClick={(e) => startRename(e, conv)}
                      className="p-1 rounded hover:bg-primary/10 text-muted hover:text-primary transition-colors"
                      title="Rename conversation"
                    >
                      <Pencil size={10} />
                    </button>
                    <button
                      onClick={(e) => deleteConversation(e, conv.id)}
                      className="p-1 rounded hover:bg-error/10 text-muted hover:text-error transition-colors"
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
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={startNewChat}
            className="p-2 rounded-lg hover:bg-surface text-muted hover:text-foreground transition-colors"
            title="New Chat"
          >
            <MessageSquarePlus size={14} />
          </button>
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-success' : 'bg-error'}`} />
          <span className="text-xs text-muted">{isConnected ? t('chat.connected') : t('chat.disconnected')}</span>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-5">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-muted">
            <Bot size={48} className="mb-4 opacity-30" />
            <p className="text-sm">{t('chat.emptyTitle')}</p>
            <p className="text-xs mt-1 opacity-60">{t('chat.emptySubtitle')}</p>
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
                <span className="text-xs text-muted bg-surface border border-border px-3 py-1 rounded-full">{msg.content}</span>
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
              <Loader2 size={16} className="animate-spin text-muted" />
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-4 border-t border-border bg-surface/50">
        <div className="max-w-4xl mx-auto">
          {attachment && (
            <div className="flex items-center gap-2 mb-2 px-3 py-1.5 bg-primary/10 border border-primary/20 rounded-lg w-fit">
              {attachment.type?.startsWith('image/') ? <ImageIcon size={12} className="text-primary" /> : <FileText size={12} className="text-primary" />}
              <span className="text-xs text-primary">{attachment.name}</span>
              <button onClick={() => setAttachment(null)} className="text-primary hover:text-primary/70">
                <X size={12} />
              </button>
            </div>
          )}
          <div className="flex gap-3">
            <div className="flex-1">
              <div className="relative">
                <textarea
                  value={input}
                  onChange={(e) => {
                    const value = e.target.value
                    setInput(value)
                    if (value.startsWith('/')) {
                      if (!showSkills) fetchSkills()
                      setShowSkills(true)
                      setSkillIndex(0)
                    } else {
                      setShowSkills(false)
                    }
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder={t('chat.placeholder')}
                  className="w-full bg-card border border-border rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted resize-none focus:outline-none focus:border-primary transition-colors"
                  rows={2}
                />
                {showSkills && filteredSkills.length > 0 && (
                  <div className="absolute bottom-full left-0 w-full bg-card border border-border rounded-xl shadow-lg z-50 py-1 mb-1 max-h-48 overflow-y-auto">
                    {filteredSkills.map((skill, i) => (
                      <div
                        key={skill.name}
                        onClick={() => activateSkill(skill.name)}
                        className={`px-3 py-2 cursor-pointer ${i === skillIndex ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-surface'}`}
                      >
                        <div className="text-sm font-medium">{skill.name}</div>
                        <div className="text-xs text-muted">{skill.description}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex justify-between items-center mt-1.5 gap-2">
                <p className="text-[10px] text-muted">Enter to send · Shift+Enter for new line</p>
                <ModelThinkingControls
                  model={activeModel}
                  setModel={setActiveModel}
                  thinkingEnabled={thinkingEnabled}
                  setThinkingEnabled={setThinkingEnabled}
                  supportsThinking={supportsThinking}
                  compact
                />
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                accept="image/*,.txt,.md,.json,.js,.jsx,.ts,.tsx,.py,.html,.css"
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={!isConnected}
                className="px-3 py-3 bg-surface hover:bg-surface-hover border border-border disabled:opacity-40 text-foreground rounded-xl transition-colors flex items-center justify-center"
                title="Attach file or image"
              >
                <Paperclip size={16} />
              </button>
              <button
                onClick={sendMessage}
                disabled={(!input.trim() && !attachment) || !isConnected}
                className="px-5 py-3 bg-primary hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl font-medium transition-colors flex items-center gap-2"
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
