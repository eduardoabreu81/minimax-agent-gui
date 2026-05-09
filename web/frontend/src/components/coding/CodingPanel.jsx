import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Code2, FileCode, Folder, GitBranch, Terminal, Save, RefreshCw,
  GitCommit, GitPullRequest, X, Send, Bot, User, Loader2, Sparkles,
  ChevronRight, Play, Square,
  MessageSquarePlus, Trash2, Paperclip, Image as ImageIcon, FileText, ChevronDown, Search,
  Zap, LayoutTemplate, Columns, Pencil, ArrowUp, Home, AlertTriangle
} from 'lucide-react'
import XTermTerminal from './XTermTerminal'
import MarkdownRenderer from '../MarkdownRenderer'
import WorkspaceSidebar from './WorkspaceSidebar'
import AgentChatPanel from './AgentChatPanel'
import { useCodingChat } from './useCodingChat'
import { useAgentActivity } from '../../context/AgentActivityContext'
import { useSessionProtection } from '../../hooks/useSessionProtection'

const CODING_SYSTEM_PROMPT = `You are MiniMax Coding Agent, an expert software engineer powered by MiniMax-M2.7.
You help users write, debug, refactor, and understand code.
You have access to:
- The currently open file (its content and path)
- The terminal output
- Git status
- The file system

When asked to write code:
1. Provide clean, well-documented code
2. Explain your reasoning
3. Suggest tests when appropriate

When asked to debug:
1. Analyze the error carefully
2. Explain the root cause
3. Provide a fix with explanation

Always be concise but thorough. Use markdown for code blocks.`

// Quick actions removed — agent now works directly from chat context

export default function CodingPanel() {
  const { t } = useTranslation()
  const activity = useAgentActivity()
  const [files, setFiles] = useState([])
  const [currentPath, setCurrentPath] = useState('workspace')
  const [openFiles, setOpenFiles] = useState([])
  const [activeFile, setActiveFile] = useState(null)
  const [fileContents, setFileContents] = useState({})
  const [gitStatus, setGitStatus] = useState(null)
  const [activeBottomTab, setActiveBottomTab] = useState('terminal')
  const [selectedGitView, setSelectedGitView] = useState('status')
  const [commitMessage, setCommitMessage] = useState('')
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [originalContents, setOriginalContents] = useState({})

  const [showGitPanel, setShowGitPanel] = useState(false)
  const [workspaceSidebarVisible, setWorkspaceSidebarVisible] = useState(() => {
    try { return localStorage.getItem('workspace-sidebar-visible') !== 'false' } catch { return true }
  })
  const [agentMode, setAgentMode] = useState(() => {
    try { return localStorage.getItem('agent-mode') || 'agent' } catch { return 'agent' }
  })
  const [permissionRequest, setPermissionRequest] = useState(null)
  const [layoutMode, setLayoutMode] = useState(() => {
    try { return localStorage.getItem('coding-layout') || 'ide' } catch { return 'ide' }
  })
  const [showEditorDrawer, setShowEditorDrawer] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editingTitle, setEditingTitle] = useState('')

  const MODES = [
    { id: 'plan', label: 'Plan', icon: Search, color: 'text-amber-400', bg: 'bg-amber-400/10', border: 'border-amber-400/30' },
    { id: 'agent', label: 'Agent', icon: Bot, color: 'text-primary', bg: 'bg-primary/10', border: 'border-primary/30' },
    { id: 'yolo', label: 'YOLO', icon: Zap, color: 'text-green-400', bg: 'bg-green-400/10', border: 'border-green-400/30' },
  ]

  const cycleMode = () => {
    const idx = MODES.findIndex(m => m.id === agentMode)
    const next = MODES[(idx + 1) % MODES.length]
    setAgentMode(next.id)
    try { localStorage.setItem('agent-mode', next.id) } catch {}
  }

  // Coding Agent Chat state
  const [codingMessages, setCodingMessages] = useState([])
  const [codingInput, setCodingInput] = useState('')
  const [codingWs, setCodingWs] = useState(null)
  const [codingThinking, setCodingThinking] = useState(false)
  const [codingConnected, setCodingConnected] = useState(false)
  const [codingAttachment, setCodingAttachment] = useState(null)
  const [codingSessionId, setCodingSessionId] = useState('coding-default')
  const [codingConversations, setCodingConversations] = useState([])
  const [showCodingConvList, setShowCodingConvList] = useState(false)
  const [codingSearchQuery, setCodingSearchQuery] = useState('')
  const [codingSearchResults, setCodingSearchResults] = useState(null)
  const [codingSearchLoading, setCodingSearchLoading] = useState(false)
  const [skills, setSkills] = useState([])
  const [showSkills, setShowSkills] = useState(false)
  const [skillIndex, setSkillIndex] = useState(0)
  const [thinkingDuration, setThinkingDuration] = useState(0)
  const codingSearchTimeoutRef = useRef(null)
  const codingChatRef = useRef(null)
  const codingFileInputRef = useRef(null)
  const codingConvListRef = useRef(null)

  const { register } = useSessionProtection()

  useEffect(() => {
    register('code-thinking', codingThinking, 'Agent is thinking')
  }, [codingThinking, register])

  useEffect(() => {
    if (permissionRequest) {
      register('tool-permission', true, 'Pending tool permission request')
    } else {
      register('tool-permission', false, '')
    }
  }, [permissionRequest, register])

  useEffect(() => {
    register('code-input', codingInput.trim().length > 0, 'Unsent code message')
  }, [codingInput, register])

  useEffect(() => {
    register('code-unsaved', hasUnsavedChanges, 'Unsaved file changes')
  }, [hasUnsavedChanges, register])

  useEffect(() => {
    const hasDraft = activity.plan.items.length > 0 && !activity.plan.approved
    register('plan-draft', hasDraft, 'Unapproved plan draft')
  }, [activity.plan.items.length, activity.plan.approved, register])

  const loadFiles = useCallback(async (path = currentPath) => {
    try {
      const res = await fetch(`/api/files?path=${encodeURIComponent(path)}`)
      const data = await res.json()
      setFiles(data.entries || [])
      setCurrentPath(path)
    } catch (e) {
      console.error('Failed to load files:', e)
    }
  }, [currentPath])

  const openFile = async (path) => {
    if (openFiles.find((f) => f.path === path)) {
      setActiveFile(path)
      return
    }
    try {
      const res = await fetch(`/api/files/content?path=${encodeURIComponent(path)}`)
      if (!res.ok) {
        const text = await res.text().catch(() => 'Unknown error')
        throw new Error(`HTTP ${res.status}: ${text}`)
      }
      const data = await res.json()
      setFileContents((prev) => ({ ...prev, [path]: data.content }))
      setOriginalContents((prev) => ({ ...prev, [path]: data.content }))
      setOpenFiles((prev) => [...prev, { path, name: path.split('/').pop() }])
      setActiveFile(path)
    } catch (e) {
      console.error('Failed to open file:', e)
      setCodingMessages((prev) => [...prev, {
        type: 'system',
        content: `Failed to open file: ${path}. Make sure the backend is running.`,
      }])
    }
  }

  const closeFile = (path) => {
    setOpenFiles((prev) => prev.filter((f) => f.path !== path))
    if (activeFile === path) {
      const remaining = openFiles.filter((f) => f.path !== path)
      setActiveFile(remaining.length > 0 ? remaining[remaining.length - 1].path : null)
    }
    setFileContents((prev) => {
      const next = { ...prev }
      delete next[path]
      return next
    })
  }

  const saveFile = async () => {
    if (!activeFile) return
    try {
      await fetch('/api/files/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: activeFile, content: fileContents[activeFile] }),
      })
    } catch (e) {
      console.error('Failed to save file:', e)
    }
  }

  const loadGitStatus = async () => {
    try {
      const res = await fetch('/api/git/status')
      const data = await res.json()
      setGitStatus(data)
    } catch (e) {
      console.error('Failed to load git status:', e)
    }
  }

  const runGitCommand = async (cmd) => {
    try {
      const res = await fetch('/api/shell', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd }),
      })
      return await res.json()
    } catch (e) {
      return { error: e.message }
    }
  }

  // Coding conversations
  const fetchCodingConversations = async () => {
    try {
      const res = await fetch('/api/conversations?type=coding')
      const data = await res.json()
      if (data.success) setCodingConversations(data.conversations || [])
    } catch (e) { /* ignore */ }
  }

  const fetchSkills = async () => {
    try {
      const res = await fetch('/api/skills')
      const data = await res.json()
      setSkills(data.skills || [])
    } catch (e) { /* ignore */ }
  }

  const startNewCodingChat = () => {
    const newId = 'coding-' + Math.random().toString(36).substring(2, 10)
    setCodingMessages([])
    setCodingSessionId(newId)
    setShowCodingConvList(false)
    setCodingSearchQuery('')
    setCodingSearchResults(null)
    fetchCodingConversations()
  }

  const loadCodingConversation = (conv) => {
    setCodingMessages([])
    setCodingSessionId(conv.id)
    setShowCodingConvList(false)
    setCodingSearchQuery('')
    setCodingSearchResults(null)
  }

  const deleteCodingConversation = async (e, convId) => {
    e.stopPropagation()
    try {
      await fetch(`/api/conversations/${convId}`, { method: 'DELETE' })
      setCodingConversations(prev => prev.filter(c => c.id !== convId))
      if (convId === codingSessionId) startNewCodingChat()
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
      setCodingConversations(prev => prev.map(c => c.id === convId ? { ...c, title: editingTitle } : c))
    } catch (err) { console.error('Rename failed:', err) }
    setEditingId(null)
    setEditingTitle('')
  }

  // Coding Agent WebSocket
  useEffect(() => {
    fetchCodingConversations()
  }, [])

  useEffect(() => {
    if (codingWs) codingWs.close()
    const ws = new WebSocket(`ws://localhost:8000/ws/chat/${codingSessionId}`)
    setCodingWs(ws)

    ws.onopen = () => setCodingConnected(true)
    ws.onclose = () => setCodingConnected(false)
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data)
      if (data.type === 'history') {
        const chatMessages = (data.messages || []).filter(m =>
          m.type !== 'step_start' && m.type !== 'tool_result' && m.type !== 'tool_calls'
        )
        setCodingMessages(chatMessages)
        setCodingThinking(false)
        activity.clearActivity()
      } else if (data.type === 'status' && data.content === 'thinking...') {
        setCodingThinking(true)
        activity.setThinkingState(true)
      } else if (data.type === 'user') {
        setCodingThinking(true)
        activity.setThinkingState(true)
      } else if (data.type === 'tool_result') {
        setCodingThinking(false)
        activity.addToolResult(data)
        activity.completeStep(data.step || activity.steps.length)
        if (data.tool === 'write_file' || data.tool === 'edit_file') {
          loadFiles()
        }
        if (data.error) {
          setCodingMessages(prev => [...prev, { type: 'system', content: `Tool error: ${data.error}` }])
        }
      } else if (data.type === 'step_start') {
        activity.addStep(data.step, data.max_steps)
        activity.setThinkingState(true)
      } else if (data.type === 'thinking') {
        activity.setThinkingState(true, data.content)
      } else if (data.type === 'skill_activated') {
        setCodingThinking(false)
        setCodingMessages((prev) => [...prev, { type: 'system', content: `Skill '${data.skill}' activated` }])
        activity.setThinkingState(false)
      } else if (data.type === 'permission_request') {
        setPermissionRequest(data)
        activity.setThinkingState(false)
      } else {
        setCodingThinking(false)
        setCodingMessages((prev) => [...prev, data])
        activity.setThinkingState(false)
      }
    }

    return () => ws.close()
  }, [codingSessionId, loadFiles])

  const buildPlanItems = (userMessage) => {
    const items = [
      'Understand the request',
      'Inspect relevant files',
      'Implement the change',
      'Run validation',
      'Summarize results',
    ]
    if (activeFile) {
      const fileName = activeFile.split('/').pop()
      items.splice(1, 0, `Review current file: ${fileName}`)
    }
    if (gitStatus?.status && gitStatus.status.trim().length > 0) {
      items.splice(1, 0, 'Check current git changes before editing')
    }
    return items
  }

  const approveAndRunPlan = useCallback(() => {
    if (!codingWs || codingWs.readyState !== WebSocket.OPEN) return
    const plan = activity.plan
    if (!plan.items.length || !plan.sourcePrompt) return

    const planText = plan.items.map((item, i) => `${i + 1}. ${item.text}`).join('\n')
    const approvedMessage = `[Approved Plan]\n\nUser request:\n${plan.sourcePrompt}\n\nPlan:\n${planText}\n\nPlease follow this approved plan. Execute step by step, use tools when needed, and summarize what was changed.`

    const payload = { message: approvedMessage, permission_mode: 'agent' }
    if (plan.sourceAttachment) payload.attachment = plan.sourceAttachment.path

    setCodingMessages(prev => [...prev, {
      type: 'system',
      content: 'Approved plan was sent to the agent'
    }])
    codingWs.send(JSON.stringify(payload))
    activity.approvePlan()
    setAgentMode('agent')
    try { localStorage.setItem('agent-mode', 'agent') } catch {}
    setCodingThinking(true)
  }, [codingWs, activity])

  useEffect(() => {
    const handleApprove = () => approveAndRunPlan()
    window.addEventListener('approvePlan', handleApprove)
    return () => window.removeEventListener('approvePlan', handleApprove)
  }, [approveAndRunPlan])

  const sendCodingMessage = useCallback(() => {
    if ((!codingInput.trim() && !codingAttachment) || !codingWs || codingWs.readyState !== WebSocket.OPEN) return

    if (permissionRequest) {
      setCodingMessages(prev => [...prev, {
        type: 'system',
        content: 'Respond to the pending tool permission request before sending another message.'
      }])
      return
    }

    // Plan mode: create a draft plan instead of sending immediately
    if (agentMode === 'plan') {
      const userMessage = codingInput.trim() || '📎 Attachment sent'
      const planItems = buildPlanItems(userMessage)
      activity.createPlan(planItems, userMessage, codingAttachment)
      setCodingMessages(prev => [...prev, {
        type: 'user',
        content: userMessage,
        attachment: codingAttachment?.path
      }])
      setCodingMessages(prev => [...prev, {
        type: 'system',
        content: 'Plan draft created. Review and approve it in the Workspace sidebar before the agent starts working.'
      }])
      setCodingInput('')
      setCodingAttachment(null)
      // Open workspace sidebar and switch to Plan tab
      if (!workspaceSidebarVisible) {
        setWorkspaceSidebarVisible(true)
        try { localStorage.setItem('workspace-sidebar-visible', 'true') } catch {}
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('openWorkspaceTab', { detail: 'plan' }))
      }
      return
    }

    // Build context from current file
    let contextMessage = codingInput.trim()
    if (activeFile && fileContents[activeFile]) {
      const fileName = activeFile.split('/').pop()
      const codeSnippet = fileContents[activeFile].slice(0, 3000)
      contextMessage = `[Context: File \`${fileName}\` is currently open]\n\n${contextMessage}\n\n[Current file content (first 3000 chars):\n\`\`\`\n${codeSnippet}\n\`\`\`]`
    }

    const payload = { message: contextMessage, permission_mode: agentMode === 'yolo' ? 'yolo' : 'agent' }
    if (codingAttachment) payload.attachment = codingAttachment.path
    // Show user message immediately before sending
    setCodingMessages(prev => [...prev, {
      type: 'user',
      content: codingInput.trim() || '📎 Attachment sent',
      attachment: codingAttachment?.path
    }])
    codingWs.send(JSON.stringify(payload))
    setCodingInput('')
    setCodingAttachment(null)
    setCodingThinking(true)
  }, [codingInput, codingWs, activeFile, fileContents, codingAttachment, agentMode, activity, gitStatus])

  const activateSkill = (skillName) => {
    if (codingWs && codingWs.readyState === WebSocket.OPEN) {
      codingWs.send(JSON.stringify({ type: 'activate_skill', skill: skillName }))
    }
    setCodingMessages(prev => [...prev, { type: 'system', content: `Skill '${skillName}' activated` }])
    setCodingInput('')
    setShowSkills(false)
  }

  const handleCodingFileSelect = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const formData = new FormData()
    formData.append('file', file)
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData })
      const data = await res.json()
      if (data.success) {
        setCodingAttachment({ name: file.name, path: data.path, type: file.type })
      }
    } catch (err) {
      console.error('Upload failed:', err)
    }
    e.target.value = ''
  }

  // Quick actions removed — agent works directly from chat context

  const clearCodingChat = () => setCodingMessages([])

  // Thinking duration timer
  useEffect(() => {
    if (!codingThinking) {
      setThinkingDuration(0)
      return
    }
    const start = Date.now()
    const interval = setInterval(() => {
      setThinkingDuration(Math.floor((Date.now() - start) / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [codingThinking])

  // Auto-scroll coding chat
  useEffect(() => {
    codingChatRef.current?.scrollTo({ top: codingChatRef.current.scrollHeight, behavior: 'smooth' })
  }, [codingMessages])

  // Close conversation list when clicking outside
  useEffect(() => {
    const handleClick = (e) => {
      if (codingConvListRef.current && !codingConvListRef.current.contains(e.target)) {
        setShowCodingConvList(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Listen for events from Command Palette
  useEffect(() => {
    const handleOpenFile = (e) => { if (e.detail) openFile(e.detail) }
    window.addEventListener('openFile', handleOpenFile)
    return () => window.removeEventListener('openFile', handleOpenFile)
  }, [])

  useEffect(() => {
    loadFiles()
    loadGitStatus()
  }, [loadFiles])

  const changedFiles = gitStatus?.status
    ? gitStatus.status.split('\n').filter(Boolean).map(line => ({
        status: line[0],
        path: line.slice(3),
        staged: line[0] !== ' ' && line[0] !== '?',
      }))
    : []

  const getLanguage = (filename) => {
    const ext = filename.split('.').pop()?.toLowerCase()
    const map = {
      js: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx',
      py: 'python', html: 'html', css: 'css', json: 'json',
      md: 'markdown', yaml: 'yaml', yml: 'yaml', sh: 'bash',
      rs: 'rust', go: 'go', java: 'java', c: 'c', cpp: 'cpp',
      php: 'php', rb: 'ruby', sql: 'sql', xml: 'xml',
    }
    return map[ext] || 'text'
  }

  const filteredSkills = codingInput.startsWith('/')
    ? skills.filter(s =>
        s.name.toLowerCase().includes(codingInput.slice(1).toLowerCase()) ||
        s.description?.toLowerCase().includes(codingInput.slice(1).toLowerCase())
      )
    : []

  const renderChat = (isAgent) => {
    return (
      <div className={isAgent ? 'flex-1 flex flex-col min-w-0 bg-card relative' : 'w-80 flex flex-col border-l border-border bg-card shrink-0'}>
        {/* Chat Header */}
        <div className={isAgent ? 'h-14 flex items-center justify-between px-6 border-b border-border bg-surface/50 shrink-0' : 'h-12 flex items-center justify-between px-4 border-b border-border bg-surface/50 shrink-0'}>
          <div className="flex items-center gap-2 relative" ref={codingConvListRef}>
            <Bot size={isAgent ? 20 : 16} className="text-primary" />
            <button
              onClick={() => setShowCodingConvList(!showCodingConvList)}
              className="flex items-center gap-1 text-sm font-semibold text-foreground hover:text-primary transition-colors"
            >
              {codingConversations.find(c => c.id === codingSessionId)?.title || 'Code Chat'}
              <ChevronDown size={12} className={`transition-transform ${showCodingConvList ? 'rotate-180' : ''}`} />
            </button>
            {showCodingConvList && (
              <div className="absolute top-full left-0 mt-1 w-80 bg-card border border-border rounded-xl shadow-lg z-50 py-2 max-h-96 overflow-y-auto">
                <button
                  onClick={startNewCodingChat}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-primary hover:bg-primary/10 transition-colors"
                >
                  <MessageSquarePlus size={12} /> New Code Chat
                </button>
                <div className="border-t border-border my-1" />
                {/* Search input */}
                <div className="px-3 py-1.5">
                  <div className="relative">
                    <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
                    <input
                      type="text"
                      placeholder="Search code sessions..."
                      value={codingSearchQuery}
                      onChange={(e) => {
                        const val = e.target.value
                        setCodingSearchQuery(val)
                        if (codingSearchTimeoutRef.current) clearTimeout(codingSearchTimeoutRef.current)
                        if (val.trim()) {
                          codingSearchTimeoutRef.current = setTimeout(async () => {
                            setCodingSearchLoading(true)
                            try {
                              const res = await fetch(`/api/conversations/search?q=${encodeURIComponent(val)}&type=coding`)
                              const data = await res.json()
                              if (data.success) setCodingSearchResults(data.results)
                            } catch (err) { /* ignore */ }
                            setCodingSearchLoading(false)
                          }, 300)
                        } else {
                          setCodingSearchResults(null)
                        }
                      }}
                      className="w-full bg-surface border border-border rounded-lg pl-7 pr-2 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary"
                    />
                  </div>
                </div>
                {/* Results or normal list */}
                {codingSearchLoading && <p className="px-3 py-2 text-xs text-muted">Searching...</p>}
                {codingSearchResults ? (
                  codingSearchResults.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-muted">No results found</p>
                  ) : (
                    codingSearchResults.map((result) => (
                      <div
                        key={result.id}
                        onClick={() => loadCodingConversation(result)}
                        className={`flex flex-col px-3 py-2 cursor-pointer hover:bg-surface transition-colors ${result.id === codingSessionId ? 'bg-primary/10' : ''}`}
                      >
                        <p className="text-xs font-medium text-foreground truncate">{result.title}</p>
                        <p className="text-[10px] text-muted">{result.message_count} messages</p>
                        {result.matches && result.matches.slice(0, 2).map((m, i) => (
                          <p key={i} className="text-[10px] text-muted mt-0.5 truncate">
                            <span className="text-primary/70">{m.field}:</span> {m.snippet}
                          </p>
                        ))}
                      </div>
                    ))
                  )
                ) : (
                  <>
                    {codingConversations.length === 0 && (
                      <p className="px-3 py-2 text-xs text-muted">No previous code chats</p>
                    )}
                    {codingConversations.map((conv) => (
                      <div
                        key={conv.id}
                        onClick={() => loadCodingConversation(conv)}
                        className={`flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-surface transition-colors ${conv.id === codingSessionId ? 'bg-primary/10' : ''}`}
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
                            title="Rename"
                          >
                            <Pencil size={10} />
                          </button>
                          <button
                            onClick={(e) => deleteCodingConversation(e, conv.id)}
                            className="p-1 rounded hover:bg-error/10 text-muted hover:text-error transition-colors"
                            title="Delete"
                          >
                            <Trash2 size={10} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
            {isAgent && (
              <button
                onClick={() => setShowEditorDrawer(!showEditorDrawer)}
                className={`ml-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${showEditorDrawer ? 'bg-primary/10 text-primary' : 'bg-surface border border-border hover:border-primary text-muted-foreground'}`}
              >
                <Code2 size={12} /> Editor
              </button>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={startNewCodingChat} className={isAgent ? 'p-2 rounded hover:bg-surface text-muted hover:text-foreground transition-colors' : 'p-1.5 rounded hover:bg-surface text-muted hover:text-foreground transition-colors'} title="New chat">
              <MessageSquarePlus size={isAgent ? 14 : 12} />
            </button>
            <div className={`w-2 h-2 rounded-full ${codingConnected ? 'bg-success' : 'bg-error'}`} />
          </div>
        </div>

        {/* Chat Messages */}
        <div ref={codingChatRef} className={isAgent ? 'flex-1 overflow-y-auto p-6 space-y-5' : 'flex-1 overflow-y-auto p-3 space-y-3'}>
          {codingMessages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-muted text-center">
              {isAgent ? <Bot size={48} className="mb-4 opacity-30" /> : <Sparkles size={32} className="mb-3 opacity-30" />}
              <p className={isAgent ? 'text-sm' : 'text-xs'}>Ask me about your code</p>
              <p className={isAgent ? 'text-xs mt-1 opacity-50' : 'text-[10px] mt-1 opacity-50'}>I can see the file you have open</p>
            </div>
          )}

          {codingMessages.map((msg, idx) => {
            if (msg.type === 'system') {
              return (
                <div key={idx} className="flex justify-center my-2">
                  <span className={isAgent ? 'text-sm text-muted bg-surface border border-border px-3 py-1 rounded-full' : 'text-xs text-muted bg-surface border border-border px-3 py-1 rounded-full'}>{msg.content}</span>
                </div>
              )
            }
            return (
              <div key={idx} className={`flex gap-2 ${msg.type === 'user' ? 'flex-row-reverse' : ''}`}>
                <div className={`
                  rounded-full flex items-center justify-center flex-shrink-0
                  ${isAgent ? 'w-8 h-8' : 'w-6 h-6'}
                  ${msg.type === 'user' ? 'bg-primary' : 'bg-surface border border-border'}
                `}>
                  {msg.type === 'user' ? <User size={isAgent ? 14 : 10} className="text-white" /> : <Bot size={isAgent ? 14 : 10} className="text-primary" />}
                </div>
                <div className={`
                  leading-relaxed
                  ${isAgent ? 'max-w-[80%] px-4 py-3 rounded-2xl text-sm' : 'max-w-[85%] px-3 py-2 rounded-xl text-xs'}
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
                          className={isAgent ? 'max-w-[240px] max-h-[160px] rounded-lg object-cover' : 'max-w-[180px] max-h-[120px] rounded-lg object-cover'}
                          onError={(e) => { e.target.style.display = 'none' }}
                        />
                      ) : (
                        <div className="flex items-center gap-2 opacity-90">
                          <FileText size={isAgent ? 14 : 12} />
                          <span className={isAgent ? 'truncate max-w-[240px]' : 'truncate max-w-[180px]'}>{msg.attachment.split('/').pop()}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          {codingThinking && (
            <div className="flex gap-2">
              <div className={`
                rounded-full bg-surface border border-border flex items-center justify-center
                ${isAgent ? 'w-8 h-8' : 'w-6 h-6'}
              `}>
                <Bot size={isAgent ? 14 : 10} className="text-primary" />
              </div>
              <div className={`
                bg-surface border border-border rounded-2xl rounded-bl-md
                ${isAgent ? 'px-4 py-3' : 'px-3 py-2'}
              `}>
                <Loader2 size={isAgent ? 16 : 14} className="animate-spin text-muted" />
              </div>
            </div>
          )}
        </div>

        {/* Chat Input */}
        <div className={isAgent ? 'p-4 border-t border-border bg-surface/50 shrink-0' : 'p-3 border-t border-border bg-surface/50 shrink-0'}>
          {codingAttachment && (
            <div className={isAgent ? 'flex items-center gap-2 mb-3 px-4 py-2 bg-primary/10 border border-primary/20 rounded-lg w-fit' : 'flex items-center gap-2 mb-2 px-3 py-1 bg-primary/10 border border-primary/20 rounded-lg w-fit'}>
              {codingAttachment.type?.startsWith('image/') ? <ImageIcon size={isAgent ? 14 : 12} className="text-primary" /> : <FileText size={isAgent ? 14 : 12} className="text-primary" />}
              <span className={isAgent ? 'text-sm text-primary' : 'text-xs text-primary'}>{codingAttachment.name}</span>
              <button onClick={() => setCodingAttachment(null)} className="text-primary hover:text-primary/70">
                <X size={isAgent ? 14 : 12} />
              </button>
            </div>
          )}
          <div className={isAgent ? 'max-w-4xl mx-auto flex gap-2' : 'flex gap-2'}>
            <div className="flex-1">
              <div className="relative">
                <textarea
                  value={codingInput}
                  disabled={!!permissionRequest}
                  onChange={(e) => {
                    const value = e.target.value
                    setCodingInput(value)
                    if (value.startsWith('/')) {
                      if (!showSkills) fetchSkills()
                      setShowSkills(true)
                      setSkillIndex(0)
                    } else {
                      setShowSkills(false)
                    }
                  }}
                  onKeyDown={(e) => {
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
                      sendCodingMessage()
                    }
                  }}
                  placeholder="Ask about your code..."
                  rows={isAgent ? 3 : 2}
                  className={isAgent ? 'w-full bg-card border border-border rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted resize-none focus:outline-none focus:border-primary' : 'w-full bg-card border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted resize-none focus:outline-none focus:border-primary'}
                />
                {showSkills && filteredSkills.length > 0 && (
                  <div className={isAgent ? 'absolute bottom-full left-0 w-full bg-card border border-border rounded-xl shadow-lg z-50 py-1 mb-1 max-h-48 overflow-y-auto' : 'absolute bottom-full left-0 w-full bg-card border border-border rounded-lg shadow-lg z-50 py-1 mb-1 max-h-48 overflow-y-auto'}>
                    {filteredSkills.map((skill, i) => (
                      <div
                        key={skill.name}
                        ref={el => { if (i === skillIndex && el) el.scrollIntoView({ block: 'nearest' }) }}
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
                <p className={isAgent ? 'text-xs text-muted' : 'text-[9px] text-muted'}>Enter to send · Shift+Enter for new line</p>
                <p className={isAgent ? 'text-xs text-primary font-medium' : 'text-[9px] text-primary font-medium'}>MiniMax-M2.7</p>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <input
                type="file"
                ref={codingFileInputRef}
                onChange={handleCodingFileSelect}
                accept="image/*,.txt,.md,.json,.js,.jsx,.ts,.tsx,.py,.html,.css"
                className="hidden"
              />
              <button
                onClick={() => codingFileInputRef.current?.click()}
                disabled={!codingConnected}
                className={isAgent ? 'px-3 py-3 bg-surface hover:bg-surface-hover border border-border disabled:opacity-40 text-foreground rounded-lg transition-colors flex items-center justify-center' : 'px-2.5 py-2 bg-surface hover:bg-surface-hover border border-border disabled:opacity-40 text-foreground rounded-lg transition-colors flex items-center justify-center'}
                title="Attach file or image"
              >
                <Paperclip size={isAgent ? 16 : 14} />
              </button>
              <button
                onClick={sendCodingMessage}
                disabled={(!codingInput.trim() && !codingAttachment) || !codingConnected || codingThinking || permissionRequest}
                className={isAgent ? 'px-4 py-3 bg-primary hover:bg-primary-hover disabled:opacity-40 text-white rounded-lg transition-colors flex items-center gap-1' : 'px-3 py-2 bg-primary hover:bg-primary-hover disabled:opacity-40 text-white rounded-lg transition-colors flex items-center gap-1'}
              >
                <Send size={isAgent ? 16 : 14} />
              </button>
            </div>
          </div>
        </div>

        {/* Agent Mode: Editor Drawer */}
        {isAgent && showEditorDrawer && (
          <div className="absolute bottom-0 left-0 right-0 h-[60%] bg-card border-t border-border flex flex-col z-20 shadow-2xl">
            {/* Editor Tabs */}
            {openFiles.length > 0 && (
              <div className="flex border-b border-border bg-surface/30 overflow-x-auto shrink-0">
                {openFiles.map((file) => (
                  <div
                    key={file.path}
                    onClick={() => setActiveFile(file.path)}
                    className={`flex items-center gap-2 px-3 py-2 text-xs font-medium border-r border-border transition-colors whitespace-nowrap group cursor-pointer ${
                      activeFile === file.path
                        ? 'bg-surface text-foreground border-t-2 border-t-primary'
                        : 'text-muted-foreground hover:text-foreground hover:bg-surface/50'
                    }`}
                  >
                    <FileCode size={12} />
                    <span>{file.name}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); closeFile(file.path) }}
                      className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-error/20 transition-opacity"
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Editor */}
            <div className="flex-1 min-h-0 relative">
              {activeFile ? (
                <textarea
                  value={fileContents[activeFile] || ''}
                  onChange={(e) => {
                    const newValue = e.target.value
                    setFileContents((prev) => ({ ...prev, [activeFile]: newValue }))
                    setHasUnsavedChanges(newValue !== (originalContents[activeFile] || ''))
                  }}
                  className="w-full h-full bg-card text-foreground p-4 font-mono text-sm resize-none focus:outline-none"
                  spellCheck={false}
                  placeholder={`// ${getLanguage(activeFile.split('/').pop())}`}
                />
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-muted">
                  <Code2 size={48} className="mb-4 opacity-20" />
                  <p className="text-sm">{t('coding.selectFile')}</p>
                  <p className="text-xs mt-1 opacity-60">{t('coding.selectFileHint')}</p>
                </div>
              )}
            </div>

            {/* Bottom Panel: Terminal / Git */}
            <div className="h-48 border-t border-border flex flex-col shrink-0">
              <div className="flex border-b border-border bg-surface/30 shrink-0">
                <button
                  onClick={() => setActiveBottomTab('terminal')}
                  className={`px-4 py-2 text-xs font-medium transition-colors flex items-center gap-1.5 ${activeBottomTab === 'terminal' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  <Terminal size={12} /> {t('coding.terminal')}
                </button>
                <button
                  onClick={() => { setActiveBottomTab('git'); loadGitStatus() }}
                  className={`px-4 py-2 text-xs font-medium transition-colors flex items-center gap-1.5 ${activeBottomTab === 'git' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  <GitBranch size={12} /> {t('coding.git')}
                </button>
              </div>
              <div className="flex-1 overflow-hidden">
                {activeBottomTab === 'terminal' && <XTermTerminal />}
                {activeBottomTab === 'git' && (
                  <div className="h-full overflow-y-auto p-3 text-xs space-y-2">
                    <div className="flex items-center gap-2">
                      <GitBranch size={14} className="text-primary" />
                      <span className="font-mono text-foreground">{gitStatus?.branch || 'N/A'}</span>
                    </div>
                    {changedFiles.length > 0 ? (
                      <>
                        {changedFiles.map((f, i) => (
                          <div key={i} className="flex items-center gap-2 px-2 py-1 rounded bg-surface">
                            <span className={`font-mono ${f.staged ? 'text-green-500' : 'text-amber-500'}`}>{f.status}</span>
                            <span className="text-foreground">{f.path}</span>
                          </div>
                        ))}
                        <div className="flex gap-2 pt-2">
                          <input
                            value={commitMessage}
                            onChange={(e) => setCommitMessage(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && runGitCommand(`git add -A && git commit -m "${commitMessage}"`)}
                            placeholder={t('coding.commitMessage')}
                            className="flex-1 bg-surface border border-border rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-primary"
                          />
                          <button
                            onClick={() => { runGitCommand(`git add -A && git commit -m "${commitMessage}"`); setCommitMessage(''); loadGitStatus() }}
                            className="px-3 py-1.5 bg-primary hover:bg-primary-hover text-white rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5"
                          >
                            <GitCommit size={12} /> {t('coding.commit')}
                          </button>
                        </div>
                      </>
                    ) : (
                      <p className="text-muted text-center py-4">{t('coding.workingTreeClean')}</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  const handlePermissionApprove = () => {
    if (!permissionRequest || !codingWs) return
    codingWs.send(JSON.stringify({
      type: 'permission_response',
      request_id: permissionRequest.request_id,
      approved: true,
    }))
    setCodingMessages(prev => [...prev, { type: 'system', content: `Tool approved: ${permissionRequest.tool_name}` }])
    setPermissionRequest(null)
    setCodingThinking(true)
  }

  const handlePermissionReject = () => {
    if (!permissionRequest || !codingWs) return
    codingWs.send(JSON.stringify({
      type: 'permission_response',
      request_id: permissionRequest.request_id,
      approved: false,
    }))
    setCodingMessages(prev => [...prev, { type: 'system', content: `Tool rejected: ${permissionRequest.tool_name}` }])
    setPermissionRequest(null)
    setCodingThinking(true)
  }

  return (
    <div className="flex flex-col h-full bg-card">
      {/* Header */}
      <div className="h-14 flex items-center px-4 border-b border-border bg-surface/50 justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Code2 size={18} className="text-primary" />
          <h2 className="text-sm font-semibold">{t('coding.title')}</h2>
          {activeFile && (
            <span className="text-xs text-muted font-mono ml-2">{activeFile}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {(() => {
            const mode = MODES.find(m => m.id === agentMode)
            const Icon = mode.icon
            return (
              <button
                onClick={cycleMode}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${mode.bg} ${mode.color} border ${mode.border}`}
                title={`Mode: ${mode.label} — click to cycle`}
              >
                <Icon size={12} /> {mode.label}
              </button>
            )
          })()}
          <button
            onClick={() => {
              const next = layoutMode === 'ide' ? 'agent' : 'ide'
              setLayoutMode(next)
              try { localStorage.setItem('coding-layout', next) } catch {}
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${layoutMode === 'agent' ? 'bg-primary/10 text-primary' : 'bg-surface border border-border hover:border-primary text-muted-foreground'}`}
            title={layoutMode === 'ide' ? 'IDE Mode — click for Agent Mode' : 'Agent Mode — click for IDE Mode'}
          >
            {layoutMode === 'ide' ? <LayoutTemplate size={12} /> : <Columns size={12} />}
            {layoutMode === 'ide' ? 'IDE' : 'Agent'}
          </button>
          <button
            onClick={() => {
              const next = !workspaceSidebarVisible
              setWorkspaceSidebarVisible(next)
              try { localStorage.setItem('workspace-sidebar-visible', String(next)) } catch {}
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${workspaceSidebarVisible ? 'bg-primary/10 text-primary' : 'bg-surface border border-border hover:border-primary text-muted-foreground'}`}
          >
            <Bot size={12} /> Workspace
          </button>
          <button
            onClick={() => setShowGitPanel(!showGitPanel)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${showGitPanel ? 'bg-primary/10 text-primary' : 'bg-surface border border-border hover:border-primary text-muted-foreground'}`}
          >
            <GitBranch size={12} /> Git
            {changedFiles.length > 0 && (
              <span className="bg-primary text-white text-[9px] px-1.5 py-0.5 rounded-full">{changedFiles.length}</span>
            )}
          </button>
          <button
            onClick={saveFile}
            disabled={!activeFile}
            className="px-3 py-1.5 bg-primary hover:bg-primary-hover disabled:opacity-40 text-white rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5"
          >
            <Save size={12} /> {t('coding.save')}
          </button>
        </div>
      </div>

      {/* Main content: 3 columns */}
      <div className="flex flex-1 min-h-0">
        {/* Left: File Explorer */}
        <div className="w-52 flex flex-col border-r border-border bg-card shrink-0">
          <div className="h-9 flex items-center px-2 border-b border-border gap-1">
            <button
              onClick={() => loadFiles('workspace')}
              className="p-1 rounded hover:bg-surface text-muted hover:text-foreground transition-colors"
              title="Go to workspace root"
            >
              <Home size={12} />
            </button>
            <button
              onClick={() => {
                const parent = currentPath.split('/').slice(0, -1).join('/') || 'workspace'
                loadFiles(parent)
              }}
              className="p-1 rounded hover:bg-surface text-muted hover:text-foreground transition-colors"
              title="Go up"
            >
              <ArrowUp size={12} />
            </button>
            <span className="text-[10px] font-mono text-muted truncate flex-1" title={currentPath}>{currentPath}</span>
          </div>
          <div className="flex-1 overflow-y-auto py-2">
            {files.map((file) => (
              <button
                key={file.path}
                onClick={() => file.is_dir ? loadFiles(file.path) : openFile(file.path)}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors text-left ${
                  activeFile === file.path
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-surface hover:text-foreground'
                }`}
              >
                {file.is_dir ? <Folder size={14} className="text-muted" /> : <FileCode size={14} className="text-primary" />}
                <span className="truncate">{file.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Center */}
        {layoutMode === 'ide' ? (
          <div className="flex-1 flex flex-col min-w-0">
            {/* Editor Tabs */}
            {openFiles.length > 0 && (
              <div className="flex border-b border-border bg-surface/30 overflow-x-auto shrink-0">
                {openFiles.map((file) => (
                  <div
                    key={file.path}
                    onClick={() => setActiveFile(file.path)}
                    className={`flex items-center gap-2 px-3 py-2 text-xs font-medium border-r border-border transition-colors whitespace-nowrap group cursor-pointer ${
                      activeFile === file.path
                        ? 'bg-surface text-foreground border-t-2 border-t-primary'
                        : 'text-muted-foreground hover:text-foreground hover:bg-surface/50'
                    }`}
                  >
                    <FileCode size={12} />
                    <span>{file.name}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); closeFile(file.path) }}
                      className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-error/20 transition-opacity"
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Editor */}
            <div className="flex-1 min-h-0 relative">
              {activeFile ? (
                <textarea
                  value={fileContents[activeFile] || ''}
                  onChange={(e) => {
                    const newValue = e.target.value
                    setFileContents((prev) => ({ ...prev, [activeFile]: newValue }))
                    setHasUnsavedChanges(newValue !== (originalContents[activeFile] || ''))
                  }}
                  className="w-full h-full bg-card text-foreground p-4 font-mono text-sm resize-none focus:outline-none"
                  spellCheck={false}
                  placeholder={`// ${getLanguage(activeFile.split('/').pop())}`}
                />
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-muted">
                  <Code2 size={48} className="mb-4 opacity-20" />
                  <p className="text-sm">{t('coding.selectFile')}</p>
                  <p className="text-xs mt-1 opacity-60">{t('coding.selectFileHint')}</p>
                </div>
              )}
            </div>

            {/* Bottom Panel: Terminal / Git */}
            <div className="h-48 border-t border-border flex flex-col shrink-0">
              <div className="flex border-b border-border bg-surface/30 shrink-0">
                <button
                  onClick={() => setActiveBottomTab('terminal')}
                  className={`px-4 py-2 text-xs font-medium transition-colors flex items-center gap-1.5 ${activeBottomTab === 'terminal' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  <Terminal size={12} /> {t('coding.terminal')}
                </button>
                <button
                  onClick={() => { setActiveBottomTab('git'); loadGitStatus() }}
                  className={`px-4 py-2 text-xs font-medium transition-colors flex items-center gap-1.5 ${activeBottomTab === 'git' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  <GitBranch size={12} /> {t('coding.git')}
                </button>
              </div>
              <div className="flex-1 overflow-hidden">
                {activeBottomTab === 'terminal' && <XTermTerminal />}
                {activeBottomTab === 'git' && (
                  <div className="h-full overflow-y-auto p-3 text-xs space-y-2">
                    <div className="flex items-center gap-2">
                      <GitBranch size={14} className="text-primary" />
                      <span className="font-mono text-foreground">{gitStatus?.branch || 'N/A'}</span>
                    </div>
                    {changedFiles.length > 0 ? (
                      <>
                        {changedFiles.map((f, i) => (
                          <div key={i} className="flex items-center gap-2 px-2 py-1 rounded bg-surface">
                            <span className={`font-mono ${f.staged ? 'text-green-500' : 'text-amber-500'}`}>{f.status}</span>
                            <span className="text-foreground">{f.path}</span>
                          </div>
                        ))}
                        <div className="flex gap-2 pt-2">
                          <input
                            value={commitMessage}
                            onChange={(e) => setCommitMessage(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && runGitCommand(`git add -A && git commit -m "${commitMessage}"`)}
                            placeholder={t('coding.commitMessage')}
                            className="flex-1 bg-surface border border-border rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-primary"
                          />
                          <button
                            onClick={() => { runGitCommand(`git add -A && git commit -m "${commitMessage}"`); setCommitMessage(''); loadGitStatus() }}
                            className="px-3 py-1.5 bg-primary hover:bg-primary-hover text-white rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5"
                          >
                            <GitCommit size={12} /> {t('coding.commit')}
                          </button>
                        </div>
                      </>
                    ) : (
                      <p className="text-muted text-center py-4">{t('coding.workingTreeClean')}</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          renderChat(true)
        )}

        {/* Right: Workspace Sidebar (Plan/Todos/Tasks/Agents) */}
        {workspaceSidebarVisible && (
          <WorkspaceSidebar
            visible={workspaceSidebarVisible}
            onToggle={() => {
              const next = !workspaceSidebarVisible
              setWorkspaceSidebarVisible(next)
              try { localStorage.setItem('workspace-sidebar-visible', String(next)) } catch {}
            }}
          />
        )}

        {/* Right: Coding Agent Chat (Copilot-style) */}
        {layoutMode === 'ide' && renderChat(false)}

        {/* Permission Request Modal */}
        {permissionRequest && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="w-full max-w-md bg-card border border-border rounded-xl shadow-2xl p-5 space-y-4">
              <div className="flex items-center gap-2">
                <AlertTriangle size={18} className="text-amber-400" />
                <h3 className="text-sm font-semibold">Tool Permission Required</h3>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-muted">Tool:</span>
                  <span className="font-mono font-medium text-foreground">{permissionRequest.tool_name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted">Category:</span>
                  <span className="px-1.5 py-0.5 rounded bg-surface border border-border">{permissionRequest.classification?.category}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted">Risk:</span>
                  <span className={`px-1.5 py-0.5 rounded ${permissionRequest.classification?.risk === 'high' ? 'bg-red-400/10 text-red-400' : permissionRequest.classification?.risk === 'medium' ? 'bg-amber-400/10 text-amber-400' : 'bg-green-400/10 text-green-400'}`}>
                    {permissionRequest.classification?.risk}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted">Reason:</span>
                  <span className="text-foreground">{permissionRequest.classification?.reason}</span>
                </div>
                <div className="bg-surface border border-border rounded-lg p-2 max-h-32 overflow-y-auto">
                  <pre className="text-[10px] font-mono text-muted whitespace-pre-wrap">{JSON.stringify(permissionRequest.arguments, null, 2)}</pre>
                </div>
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
    </div>
  )
}
