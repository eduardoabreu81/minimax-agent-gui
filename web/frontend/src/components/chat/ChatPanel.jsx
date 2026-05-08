import { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Send, User, Bot, Loader2, Paperclip, X, Image as ImageIcon, FileText, MessageSquarePlus, Trash2, ChevronDown } from 'lucide-react'
import MarkdownRenderer from '../MarkdownRenderer'

function generateId() {
  return Math.random().toString(36).substring(2, 10)
}

export default function ChatPanel({ onProcessingChange }) {
  const { t } = useTranslation()
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [isConnected, setIsConnected] = useState(false)
  const [isThinking, setIsThinking] = useState(false)
  const [attachment, setAttachment] = useState(null)
  const [sessionId, setSessionId] = useState('default')
  const [conversations, setConversations] = useState([])
  const [showConvList, setShowConvList] = useState(false)
  const [skills, setSkills] = useState([])
  const [showSkills, setShowSkills] = useState(false)
  const [skillIndex, setSkillIndex] = useState(0)
  const wsRef = useRef(null)
  const scrollRef = useRef(null)
  const fileInputRef = useRef(null)
  const convListRef = useRef(null)

  const fetchConversations = async () => {
    try {
      const res = await fetch('/api/conversations')
      const data = await res.json()
      if (data.success) setConversations(data.conversations || [])
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
        setMessages(data.messages || [])
        setIsThinking(false)
        onProcessingChange?.(false)
      } else if (data.type === 'status' && data.content === 'thinking...') {
        setIsThinking(true)
        onProcessingChange?.(true)
      } else if (data.type === 'user') {
        // User message was already added locally, ignore WebSocket echo
        setIsThinking(true)
        onProcessingChange?.(true)
      } else if (data.type === 'skill_activated') {
        setIsThinking(false)
        onProcessingChange?.(false)
        setMessages((prev) => [...prev, { type: 'system', content: `Skill '${data.skill}' activated` }])
      } else {
        setIsThinking(false)
        onProcessingChange?.(false)
        setMessages((prev) => [...prev, data])
      }
    }
  }, [onProcessingChange])

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
    const payload = { message: input }
    if (attachment) payload.attachment = attachment.path
    // Show user message immediately before sending
    setMessages(prev => [...prev, {
      type: 'user',
      content: input || '📎 Attachment sent',
      attachment: attachment?.path
    }])
    wsRef.current.send(JSON.stringify(payload))
    setInput('')
    setAttachment(null)
    setIsThinking(true)
    onProcessingChange?.(true)
  }, [input, attachment, onProcessingChange])

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
                    <p className="text-xs font-medium text-foreground truncate">{conv.title}</p>
                    <p className="text-[10px] text-muted">{conv.message_count} messages</p>
                  </div>
                  <button
                    onClick={(e) => deleteConversation(e, conv.id)}
                    className="p-1 rounded hover:bg-error/10 text-muted hover:text-error transition-colors"
                    title="Delete conversation"
                  >
                    <Trash2 size={10} />
                  </button>
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
            return (
              <details key={idx} className="my-1">
                <summary className="text-xs text-slate-500 cursor-pointer">💭 thinking...</summary>
                <pre className="text-xs text-slate-400 p-2 bg-slate-900/50 rounded mt-1">{msg.content}</pre>
              </details>
            )
          }
          if (msg.type === 'step_start') {
            return (
              <div key={idx} className="text-xs text-slate-500 my-1">
                Step {msg.step}/{msg.max_steps}
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
          return (
            <div key={idx} className={`flex gap-3 ${msg.type === 'user' ? 'flex-row-reverse' : ''}`}>
              <div className={`
                w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0
                ${msg.type === 'user' ? 'bg-primary' : 'bg-surface border border-border'}
              `}>
                {msg.type === 'user' ? <User size={14} className="text-white" /> : <Bot size={14} className="text-primary" />}
              </div>
              <div className={`
                max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed
                ${msg.type === 'user'
                  ? 'bg-primary text-white rounded-br-md'
                  : 'bg-surface border border-border text-foreground rounded-bl-md'
                }
              `}>
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
              <div className="flex justify-between items-center mt-1">
                <p className="text-[10px] text-muted">Enter to send · Shift+Enter for new line</p>
                <p className="text-[10px] text-muted">{input.length.toLocaleString()} characters</p>
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
