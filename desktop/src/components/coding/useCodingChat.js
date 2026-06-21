import { useState, useEffect, useCallback, useRef } from 'react'
import { apiFetch, apiWebSocketUrl } from '../../lib/api.js'
import { useSessionTokens } from '../../context/SessionTokensContext'

function generateId() {
  return Math.random().toString(36).substring(2, 10)
}

export function useCodingChat({
  onActivity,
  activeModel = null,
  thinkingEnabled = null,
  supportsThinking = null,
} = {}) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [isConnected, setIsConnected] = useState(false)
  const [isThinking, setIsThinking] = useState(false)
  const [attachment, setAttachment] = useState(null)
  const [sessionId, setSessionId] = useState('coding-default')
  const [conversations, setConversations] = useState([])
  const [showConvList, setShowConvList] = useState(false)
  const [skills, setSkills] = useState([])
  const [showSkills, setShowSkills] = useState(false)
  const [skillIndex, setSkillIndex] = useState(0)
  const [thinkingDuration, setThinkingDuration] = useState(0)
  const wsRef = useRef(null)
  const chatRef = useRef(null)
  const fileInputRef = useRef(null)
  const convListRef = useRef(null)

  // Register this coding session with the StatusBar context. Cleared on
  // unmount so the chip falls back to chat when the user switches tabs.
  const { setActiveSessionId, recordUsage } = useSessionTokens()
  useEffect(() => {
    setActiveSessionId(sessionId)
    return () => setActiveSessionId(null)
  }, [sessionId, setActiveSessionId])

  const fetchConversations = async () => {
    try {
      const res = await apiFetch('/api/conversations')
      const data = await res.json()
      if (data.success) setConversations(data.conversations || [])
    } catch (e) { /* ignore */ }
  }

  const fetchSkills = async () => {
    try {
      const res = await apiFetch('/api/skills')
      const data = await res.json()
      setSkills(data.skills || [])
    } catch (e) { /* ignore */ }
  }

  const connectWebSocket = useCallback((sid) => {
    if (wsRef.current) wsRef.current.close()
    let ws = null
    let cancelled = false
    apiWebSocketUrl(`/ws/chat/${sid}`).then((url) => {
      if (cancelled) return
      ws = new WebSocket(url)
      wsRef.current = ws
      ws.onopen = () => setIsConnected(true)
      ws.onclose = () => setIsConnected(false)
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data)
        if (data.type === 'history') {
          // Filter out step_start and tool_result from history — they belong in sidebar
          const chatMessages = (data.messages || []).filter(m =>
            m.type !== 'step_start' && m.type !== 'tool_result' && m.type !== 'tool_calls'
          )
          setMessages(chatMessages)
          setIsThinking(false)
        } else if (data.type === 'status' && data.content === 'thinking...') {
          setIsThinking(true)
          onActivity?.({ type: 'thinking', active: true })
        } else if (data.type === 'user') {
          setIsThinking(true)
          onActivity?.({ type: 'thinking', active: true })
        } else if (data.type === 'skill_activated') {
          setIsThinking(false)
          setMessages((prev) => [...prev, { type: 'system', content: `Skill '${data.skill}' activated` }])
          onActivity?.({ type: 'thinking', active: false })
        } else if (data.type === 'step_start') {
          onActivity?.({ type: 'step_start', step: data.step, maxSteps: data.max_steps })
        } else if (data.type === 'tool_result') {
          setIsThinking(false)
          onActivity?.({ type: 'tool_result', ...data })
          // Only add assistant/error messages to chat, not tool metadata
          if (data.error) {
            setMessages(prev => [...prev, { type: 'system', content: `Tool error: ${data.error}` }])
          }
        } else if (data.type === 'thinking') {
          onActivity?.({ type: 'thinking', active: true, content: data.content })
        } else if (data.type === 'tool_calls') {
          onActivity?.({ type: 'tool_calls', tools: data.tools })
        } else if (data.type === 'usage') {
          // Backend pushes per-turn usage so the StatusBar context chip
          // reflects real numbers as the agent streams.
          if (data.usage && (data.usage.input_tokens || data.usage.output_tokens)) {
            recordUsage(sid, data.usage, data.model || null)
          }
        } else {
          setIsThinking(false)
          setMessages((prev) => [...prev, data])
          onActivity?.({ type: 'thinking', active: false })
          // Fallback: some backends pack usage into the assistant event
          // itself. Still record it for the StatusBar.
          if (data.usage && (data.usage.input_tokens || data.usage.output_tokens)) {
            recordUsage(sid, data.usage, data.model || null)
          }
        }
      }
    })
    return () => {
      cancelled = true
      if (ws) ws.close()
    }
  }, [onActivity])

  useEffect(() => {
    fetchConversations()
    connectWebSocket(sessionId)
    return () => wsRef.current?.close()
  }, [sessionId, connectWebSocket])

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
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

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
    setSessionId('coding-' + newId)
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
      await apiFetch(`/api/conversations/${convId}`, { method: 'DELETE' })
      setConversations(prev => prev.filter(c => c.id !== convId))
      if (convId === sessionId) startNewChat()
    } catch (err) { console.error('Delete failed:', err) }
  }

  const activateSkill = (skillName) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
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
    // Per-turn model + thinking override — same shape as the chat panel,
    // so the backend applies the right Anthropic `thinking` param.
    if (activeModel) payload.model = activeModel
    if (supportsThinking !== null) {
      payload.thinking = supportsThinking ? !!thinkingEnabled : false
    }
    setMessages(prev => [...prev, {
      type: 'user',
      content: input || '📎 Attachment sent',
      attachment: attachment?.path
    }])
    wsRef.current.send(JSON.stringify(payload))
    setInput('')
    setAttachment(null)
    setIsThinking(true)
  }, [input, attachment, activeModel, thinkingEnabled, supportsThinking])

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

  return {
    messages, input, setInput,
    isConnected, isThinking,
    attachment, setAttachment,
    sessionId, conversations,
    showConvList, setShowConvList,
    skills, showSkills, setShowSkills,
    skillIndex, setSkillIndex,
    thinkingDuration,
    chatRef, fileInputRef, convListRef,
    sendMessage, activateSkill,
    startNewChat, loadConversation, deleteConversation,
    handleKeyDown, handleFileSelect, fetchSkills,
    filteredSkills,
  }
}
