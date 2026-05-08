import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Code2, FileCode, Folder, GitBranch, Terminal, Save, RefreshCw,
  GitCommit, GitPullRequest, X, Send, Bot, User, Loader2, Sparkles,
  Wand2, Bug, FileCheck, Lightbulb, ChevronRight, Play, Square,
  MessageSquarePlus, Trash2, Paperclip, Image as ImageIcon, FileText, ChevronDown
} from 'lucide-react'
import XTermTerminal from './XTermTerminal'
import MarkdownRenderer from '../MarkdownRenderer'

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

const QUICK_ACTIONS = [
  { id: 'explain', label: 'Explain', icon: Lightbulb, prompt: 'Explain this code in detail. What does it do and how does it work?' },
  { id: 'fix', label: 'Fix', icon: Bug, prompt: 'Find and fix any bugs or issues in this code. Explain what was wrong.' },
  { id: 'test', label: 'Tests', icon: FileCheck, prompt: 'Write unit tests for this code. Use best practices.' },
  { id: 'refactor', label: 'Refactor', icon: Wand2, prompt: 'Refactor this code to improve readability, performance, and maintainability.' },
]

export default function CodingPanel() {
  const { t } = useTranslation()
  const [files, setFiles] = useState([])
  const [openFiles, setOpenFiles] = useState([])
  const [activeFile, setActiveFile] = useState(null)
  const [fileContents, setFileContents] = useState({})
  const [gitStatus, setGitStatus] = useState(null)
  const [activeBottomTab, setActiveBottomTab] = useState('terminal')
  const [selectedGitView, setSelectedGitView] = useState('status')
  const [commitMessage, setCommitMessage] = useState('')
  const [showGitPanel, setShowGitPanel] = useState(false)

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
  const codingChatRef = useRef(null)
  const codingFileInputRef = useRef(null)
  const codingConvListRef = useRef(null)

  const loadFiles = useCallback(async (path = 'workspace') => {
    try {
      const res = await fetch(`/api/files?path=${encodeURIComponent(path)}`)
      const data = await res.json()
      setFiles(data.entries || [])
    } catch (e) {
      console.error('Failed to load files:', e)
    }
  }, [])

  const openFile = async (path) => {
    if (openFiles.find((f) => f.path === path)) {
      setActiveFile(path)
      return
    }
    try {
      const res = await fetch(`/api/files/content?path=${encodeURIComponent(path)}`)
      const data = await res.json()
      setFileContents((prev) => ({ ...prev, [path]: data.content }))
      setOpenFiles((prev) => [...prev, { path, name: path.split('/').pop() }])
      setActiveFile(path)
    } catch (e) {
      console.error('Failed to open file:', e)
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

  const startNewCodingChat = () => {
    const newId = 'coding-' + Math.random().toString(36).substring(2, 10)
    setCodingMessages([])
    setCodingSessionId(newId)
    setShowCodingConvList(false)
    fetchCodingConversations()
  }

  const loadCodingConversation = (conv) => {
    setCodingMessages([])
    setCodingSessionId(conv.id)
    setShowCodingConvList(false)
  }

  const deleteCodingConversation = async (e, convId) => {
    e.stopPropagation()
    try {
      await fetch(`/api/conversations/${convId}`, { method: 'DELETE' })
      setCodingConversations(prev => prev.filter(c => c.id !== convId))
      if (convId === codingSessionId) startNewCodingChat()
    } catch (err) { console.error('Delete failed:', err) }
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
        setCodingMessages(data.messages || [])
        setCodingThinking(false)
      } else if (data.type === 'status' && data.content === 'thinking...') {
        setCodingThinking(true)
      } else if (data.type === 'user') {
        // User message was already added locally, ignore WebSocket echo
        setCodingThinking(true)
      } else {
        setCodingThinking(false)
        setCodingMessages((prev) => [...prev, data])
      }
    }

    return () => ws.close()
  }, [codingSessionId])

  const sendCodingMessage = useCallback(() => {
    if ((!codingInput.trim() && !codingAttachment) || !codingWs || codingWs.readyState !== WebSocket.OPEN) return

    // Build context from current file
    let contextMessage = codingInput.trim()
    if (activeFile && fileContents[activeFile]) {
      const fileName = activeFile.split('/').pop()
      const codeSnippet = fileContents[activeFile].slice(0, 3000)
      contextMessage = `[Context: File \`${fileName}\` is currently open]\n\n${contextMessage}\n\n[Current file content (first 3000 chars):\n\`\`\`\n${codeSnippet}\n\`\`\`]`
    }

    const payload = { message: contextMessage }
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
  }, [codingInput, codingWs, activeFile, fileContents, codingAttachment])

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

  const handleQuickAction = (action) => {
    if (!activeFile || !fileContents[activeFile]) return
    const fileName = activeFile.split('/').pop()
    const code = fileContents[activeFile].slice(0, 3000)
    const prompt = `${action.prompt}\n\nFile: \`${fileName}\`\n\n\`\`\`\n${code}\n\`\`\``

    codingWs.send(JSON.stringify({ message: prompt }))
    setCodingThinking(true)
  }

  const clearCodingChat = () => setCodingMessages([])

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
          <div className="h-9 flex items-center px-3 border-b border-border">
            <span className="text-xs font-semibold text-muted uppercase tracking-wider">{t('coding.explorer')}</span>
          </div>
          <div className="flex-1 overflow-y-auto py-2">
            {files.map((file) => (
              <button
                key={file.path}
                onClick={() => file.is_dir ? null : openFile(file.path)}
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

        {/* Center: Editor + Bottom Panel */}
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
                onChange={(e) => setFileContents((prev) => ({ ...prev, [activeFile]: e.target.value }))}
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

        {/* Right: Coding Agent Chat (Copilot-style) */}
        <div className="w-80 flex flex-col border-l border-border bg-card shrink-0">
          {/* Chat Header */}
          <div className="h-12 flex items-center justify-between px-4 border-b border-border bg-surface/50 shrink-0">
            <div className="flex items-center gap-2 relative" ref={codingConvListRef}>
              <Bot size={16} className="text-primary" />
              <button
                onClick={() => setShowCodingConvList(!showCodingConvList)}
                className="flex items-center gap-1 text-sm font-semibold text-foreground hover:text-primary transition-colors"
              >
                {codingConversations.find(c => c.id === codingSessionId)?.title || 'Code Chat'}
                <ChevronDown size={12} className={`transition-transform ${showCodingConvList ? 'rotate-180' : ''}`} />
              </button>
              {showCodingConvList && (
                <div className="absolute top-full left-0 mt-1 w-64 bg-card border border-border rounded-xl shadow-lg z-50 py-2 max-h-72 overflow-y-auto">
                  <button
                    onClick={startNewCodingChat}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-primary hover:bg-primary/10 transition-colors"
                  >
                    <MessageSquarePlus size={12} /> New Code Chat
                  </button>
                  <div className="border-t border-border my-1" />
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
                        <p className="text-xs font-medium text-foreground truncate">{conv.title}</p>
                        <p className="text-[10px] text-muted">{conv.message_count} messages</p>
                      </div>
                      <button
                        onClick={(e) => deleteCodingConversation(e, conv.id)}
                        className="p-1 rounded hover:bg-error/10 text-muted hover:text-error transition-colors"
                        title="Delete"
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button onClick={startNewCodingChat} className="p-1.5 rounded hover:bg-surface text-muted hover:text-foreground transition-colors" title="New chat">
                <MessageSquarePlus size={12} />
              </button>
              <div className={`w-2 h-2 rounded-full ${codingConnected ? 'bg-success' : 'bg-error'}`} />
            </div>
          </div>

          {/* Quick Actions */}
          {activeFile && (
            <div className="px-3 py-2 border-b border-border shrink-0">
              <div className="grid grid-cols-2 gap-1.5">
                {QUICK_ACTIONS.map((action) => {
                  const Icon = action.icon
                  return (
                    <button
                      key={action.id}
                      onClick={() => handleQuickAction(action)}
                      disabled={codingThinking}
                      className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-surface border border-border hover:border-primary text-xs text-foreground transition-colors disabled:opacity-40"
                    >
                      <Icon size={12} className="text-primary" />
                      {action.label}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Chat Messages */}
          <div ref={codingChatRef} className="flex-1 overflow-y-auto p-3 space-y-3">
            {codingMessages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-muted text-center">
                <Sparkles size={32} className="mb-3 opacity-30" />
                <p className="text-xs">Ask me about your code</p>
                <p className="text-[10px] mt-1 opacity-50">I can see the file you have open</p>
              </div>
            )}

            {codingMessages.map((msg, idx) => (
              <div key={idx} className={`flex gap-2 ${msg.type === 'user' ? 'flex-row-reverse' : ''}`}>
                <div className={`
                  w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0
                  ${msg.type === 'user' ? 'bg-primary' : 'bg-surface border border-border'}
                `}>
                  {msg.type === 'user' ? <User size={10} className="text-white" /> : <Bot size={10} className="text-primary" />}
                </div>
                <div className={`
                  max-w-[85%] px-3 py-2 rounded-xl text-xs leading-relaxed
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
                          className="max-w-[180px] max-h-[120px] rounded-lg object-cover"
                          onError={(e) => { e.target.style.display = 'none' }}
                        />
                      ) : (
                        <div className="flex items-center gap-2 opacity-90">
                          <FileText size={12} />
                          <span className="truncate max-w-[180px]">{msg.attachment.split('/').pop()}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {codingThinking && (
              <div className="flex gap-2">
                <div className="w-6 h-6 rounded-full bg-surface border border-border flex items-center justify-center">
                  <Bot size={10} className="text-primary" />
                </div>
                <div className="bg-surface border border-border rounded-2xl rounded-bl-md px-3 py-2">
                  <Loader2 size={14} className="animate-spin text-muted" />
                </div>
              </div>
            )}
          </div>

          {/* Chat Input */}
          <div className="p-3 border-t border-border bg-surface/50 shrink-0">
            {codingAttachment && (
              <div className="flex items-center gap-2 mb-2 px-3 py-1 bg-primary/10 border border-primary/20 rounded-lg w-fit">
                {codingAttachment.type?.startsWith('image/') ? <ImageIcon size={12} className="text-primary" /> : <FileText size={12} className="text-primary" />}
                <span className="text-xs text-primary">{codingAttachment.name}</span>
                <button onClick={() => setCodingAttachment(null)} className="text-primary hover:text-primary/70">
                  <X size={12} />
                </button>
              </div>
            )}
            <div className="flex gap-2">
              <div className="flex-1">
                <textarea
                  value={codingInput}
                  onChange={(e) => setCodingInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      sendCodingMessage()
                    }
                  }}
                  placeholder="Ask about your code..."
                  rows={2}
                  className="w-full bg-card border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted resize-none focus:outline-none focus:border-primary"
                />
                <div className="flex justify-between items-center mt-0.5">
                  <p className="text-[9px] text-muted">Enter to send · Shift+Enter for new line</p>
                  <p className="text-[9px] text-muted">{codingInput.length.toLocaleString()} characters</p>
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
                  className="px-2.5 py-2 bg-surface hover:bg-surface-hover border border-border disabled:opacity-40 text-foreground rounded-lg transition-colors flex items-center justify-center"
                  title="Attach file or image"
                >
                  <Paperclip size={14} />
                </button>
                <button
                  onClick={sendCodingMessage}
                  disabled={(!codingInput.trim() && !codingAttachment) || !codingConnected || codingThinking}
                  className="px-3 py-2 bg-primary hover:bg-primary-hover disabled:opacity-40 text-white rounded-lg transition-colors flex items-center gap-1"
                >
                  <Send size={14} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
