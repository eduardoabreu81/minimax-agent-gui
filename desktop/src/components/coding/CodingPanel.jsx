import { useState, useEffect, useCallback, useRef } from 'react'
import { apiFetch, apiWebSocketUrl } from '../../lib/api.js'
import { useTranslation } from 'react-i18next'
import {
  Code2, FileCode, Folder, GitBranch, Terminal, Save, RefreshCw,
  X, Send, Bot, User, Loader2, Sparkles,
  ChevronRight, Play, Square,
  MessageSquarePlus, Trash2, Paperclip, Image as ImageIcon, FileText, ChevronDown, Search,
  Zap, Pencil, ArrowUp, Home, AlertTriangle
} from 'lucide-react'
import XTermTerminal from './XTermTerminal'
import MarkdownRenderer from '../MarkdownRenderer'
import WorkspaceSidebar from './WorkspaceSidebar'
import WorkspacePicker from './WorkspacePicker'
import AgentChatPanel from './AgentChatPanel'
import { useCodingChat } from './useCodingChat'
import { useAgentActivity } from '../../context/AgentActivityContext'
import { useSessionProtection } from '../../hooks/useSessionProtection'
import { useSessionTokens } from '../../context/SessionTokensContext'
import ThinkingBlock from '../shared/ThinkingBlock'
import SlashMenu from '../shared/SlashMenu.jsx'
import CopyButton from '../shared/CopyButton'

/**
 * Build the system prompt for the coding agent. The model is interpolated
 * at call time so the prompt never references a stale hardcoded model id.
 * Pass an empty/falsy model to omit the model line entirely.
 */
const buildCodingSystemPrompt = (model) => {
  const modelLine = model
    ? `You are MiniMax Coding Agent, an expert software engineer powered by ${model}.`
    : 'You are MiniMax Coding Agent, an expert software engineer.'
  return `${modelLine}
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
}

// Quick actions removed — agent now works directly from chat context

export default function CodingPanel({
  activeModel: activeModelProp,
  setActiveModel,
  thinkingEnabled: thinkingEnabledProp,
  setThinkingEnabled,
  supportsThinking: supportsThinkingProp,
} = {}) {
  const { t } = useTranslation()
  const activity = useAgentActivity()
  // Per-turn model + thinking controls are owned by App.jsx (shared with
  // StatusBar and ChatPanel). Props are required — App.jsx always passes.
  const activeModel = activeModelProp ?? 'MiniMax-M3'
  const thinkingEnabled = thinkingEnabledProp ?? true
  const supportsThinking = supportsThinkingProp ?? (activeModelProp === 'MiniMax-M3')
  const [files, setFiles] = useState([])
  const [currentPath, setCurrentPath] = useState('workspace')
  const [openFiles, setOpenFiles] = useState([])
  const [activeFile, setActiveFile] = useState(null)
  const [fileContents, setFileContents] = useState({})
  const [gitStatus, setGitStatus] = useState(null)
  const [activeBottomTab, setActiveBottomTab] = useState('terminal')
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [originalContents, setOriginalContents] = useState({})
  const [workspaceSidebarVisible, setWorkspaceSidebarVisible] = useState(() => {
    try { return localStorage.getItem('workspace-sidebar-visible') !== 'false' } catch { return true }
  })
  const [agentMode, setAgentMode] = useState(() => {
    try { return localStorage.getItem('agent-mode') || 'agent' } catch { return 'agent' }
  })
  const [permissionRequest, setPermissionRequest] = useState(null)
  const [selectedPreview, setSelectedPreview] = useState(null)
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
  const [codingSessionId, setCodingSessionId] = useState(() => `coding-${Math.random().toString(36).substring(2, 10)}`)
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
  // Accumulates the model's reasoning chunks streamed during the
  // current run, so we can attach the full block to the final
  // assistant message (rendered via ThinkingBlock).
  const codingStreamingThinkingRef = useRef('')

  // Coding workspace — per-session folder picker state.
  // Mirrors the backend's _coding_sessions[session_id]. Three states:
  //   none     → no workspace attached (forces user to pick before sending).
  //   selected → workspace set, user can still swap folders.
  //   locked   → first message sent; workspace is permanent for this session.
  const [codingWorkspace, setCodingWorkspace] = useState({ dir: null, label: null, locked: false })
  const [recentWorkspaces, setRecentWorkspaces] = useState([])

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
      const res = await apiFetch(
        `/api/files?path=${encodeURIComponent(path)}&session_id=${encodeURIComponent(codingSessionId)}`
      )
      const data = await res.json()
      setFiles(data.entries || [])
      setCurrentPath(path)
      // The backend also returns the workspace_dir it resolved against,
      // so the picker chip / explorer root stay in sync after a workspace
      // swap (where `path` may be the *new* workspace, not a sub-dir).
      if (data.workspace_dir && (!codingWorkspace.dir || data.workspace_dir !== codingWorkspace.dir)) {
        // No-op: refreshCodingWorkspace on sessionId change handles this.
      }
    } catch (e) {
      console.error('Failed to load files:', e)
    }
  }, [currentPath, codingSessionId, codingWorkspace.dir])

  const openFile = async (path) => {
    const type = getFileType(path)
    if (type === 'image' || type === 'audio' || type === 'video' || type === 'unsupported') {
      setSelectedPreview({ path, name: path.split('/').pop(), type })
      setActiveFile(null)
      setShowEditorDrawer(true)
      return
    }
    if (openFiles.find((f) => f.path === path)) {
      setSelectedPreview(null)
      setActiveFile(path)
      return
    }
    try {
      const res = await apiFetch(
        `/api/files/content?path=${encodeURIComponent(path)}&session_id=${encodeURIComponent(codingSessionId)}`
      )
      if (!res.ok) {
        const text = await res.text().catch(() => 'Unknown error')
        throw new Error(`HTTP ${res.status}: ${text}`)
      }
      const data = await res.json()
      setFileContents((prev) => ({ ...prev, [path]: data.content }))
      setOriginalContents((prev) => ({ ...prev, [path]: data.content }))
      setOpenFiles((prev) => [...prev, { path, name: path.split('/').pop() }])
      setSelectedPreview(null)
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
      await apiFetch('/api/files/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: activeFile,
          content: fileContents[activeFile],
          session_id: codingSessionId,
        }),
      })
    } catch (e) {
      console.error('Failed to save file:', e)
    }
  }

  const loadGitStatus = async () => {
    try {
      const res = await apiFetch(`/api/git/status?session_id=${encodeURIComponent(codingSessionId)}`)
      const data = await res.json()
      setGitStatus(data)
    } catch (e) {
      console.error('Failed to load git status:', e)
    }
  }

  const runGitCommand = async (cmd) => {
    try {
      const res = await apiFetch('/api/shell', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd, session_id: codingSessionId }),
      })
      return await res.json()
    } catch (e) {
      return { error: e.message }
    }
  }

  // Coding conversations
  const fetchCodingConversations = async () => {
    try {
      const res = await apiFetch('/api/conversations?type=coding')
      const data = await res.json()
      if (data.success) {
        const list = data.conversations || []
        setCodingConversations(list)
        // Do NOT auto-load the most recent session. Each Code-tab open
        // starts a fresh empty session; the user picks a previous one
        // by clicking it in the sidebar list explicitly.
      }
    } catch (e) { /* ignore */ }
  }

  const fetchRecentWorkspaces = async () => {
    try {
      const res = await apiFetch('/api/coding/recent-workspaces')
      const data = await res.json()
      if (data.success) setRecentWorkspaces(data.workspaces || [])
    } catch (e) { /* ignore */ }
  }

  const refreshCodingWorkspace = async (sid = codingSessionId) => {
    try {
      const res = await apiFetch(`/api/coding/workspace?session_id=${encodeURIComponent(sid)}`)
      const data = await res.json()
      if (data.success) {
        setCodingWorkspace({
          dir: data.workspace_dir || null,
          label: data.workspace_dir ? (data.workspace_dir.split(/[\\/]/).pop() || data.workspace_dir) : null,
          locked: !!data.locked,
        })
      }
    } catch (e) { /* ignore */ }
  }

  const handlePickWorkspace = async (path) => {
    try {
      const res = await apiFetch('/api/coding/workspace', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: codingSessionId, workspace_dir: path }),
      })
      const data = await res.json()
      if (!data.success) {
        setCodingMessages((prev) => [...prev, { type: 'system', content: `Workspace error: ${data.detail || 'unknown'}` }])
        return
      }
      setCodingWorkspace({
        dir: data.workspace_dir,
        label: data.label || (data.workspace_dir.split(/[\\/]/).pop() || data.workspace_dir),
        locked: false,
      })
      // Refresh file explorer + git against the new workspace.
      loadFiles(data.workspace_dir)
      loadGitStatus()
      fetchRecentWorkspaces()
    } catch (e) {
      setCodingMessages((prev) => [...prev, { type: 'system', content: `Workspace error: ${e.message}` }])
    }
  }

  const handleRemoveRecent = async (path) => {
    try {
      const res = await apiFetch(`/api/coding/recent-workspaces?path=${encodeURIComponent(path)}`, {
        method: 'DELETE',
      })
      const data = await res.json()
      if (data.success) setRecentWorkspaces(data.workspaces || [])
    } catch (e) { /* ignore */ }
  }

  const fetchSkills = async () => {
    try {
      const res = await apiFetch('/api/skills')
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
    // New session = no workspace attached yet; user must pick one.
    setCodingWorkspace({ dir: null, label: null, locked: false })
    fetchCodingConversations()
  }

  const loadCodingConversation = (conv) => {
    setCodingMessages([])
    setCodingSessionId(conv.id)
    setShowCodingConvList(false)
    setCodingSearchQuery('')
    setCodingSearchResults(null)
    // Workspace state is authoritative on the backend; refresh so the
    // picker chip + file explorer + git all switch in lockstep.
    refreshCodingWorkspace(conv.id)
  }

  const deleteCodingConversation = async (e, convId) => {
    e.stopPropagation()
    try {
      await apiFetch(`/api/conversations/${convId}`, { method: 'DELETE' })
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
      await apiFetch(`/api/conversations/${convId}/rename`, {
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
    fetchRecentWorkspaces()
  }, [])

  // Whenever the session id changes, pull the workspace + lock state
  // from the backend so the picker chip, file explorer, and git status
  // all point at the right folder (especially when the user picks a
  // past conversation from the dropdown — that conversation may have
  // been started in a different folder).
  useEffect(() => {
    refreshCodingWorkspace(codingSessionId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codingSessionId])

  // Register the current coding session with the StatusBar so the context
  // chip tracks this conversation's tokens. Cleared on unmount; re-registers
  // on every session change (loadConversation, startNewCodingChat).
  const { setActiveSessionId, recordUsage } = useSessionTokens()
  useEffect(() => {
    if (!codingSessionId) return
    setActiveSessionId(codingSessionId)
    return () => setActiveSessionId(null)
  }, [codingSessionId, setActiveSessionId])

  useEffect(() => {
    if (codingWs) codingWs.close()
    let ws = null
    let cancelled = false
    apiWebSocketUrl(`/ws/chat/${codingSessionId}`).then((url) => {
      if (cancelled) return
      ws = new WebSocket(url)
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
        codingStreamingThinkingRef.current = ''
        setCodingThinking(false)
        activity.clearActivity()
      } else if (data.type === 'session_workspace') {
        // Backend tells us which folder this conversation belongs to
        // and whether the lock has been flipped. Update the picker
        // chip + file explorer + git in lockstep.
        setCodingWorkspace({
          dir: data.workspace_dir || null,
          label: data.workspace_dir ? (data.workspace_dir.split(/[\\/]/).pop() || data.workspace_dir) : null,
          locked: !!data.locked,
        })
        if (data.workspace_dir) {
          loadFiles(data.workspace_dir)
          loadGitStatus()
        }
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
        // Legacy/non-streaming thinking event (one-shot per LLM call).
        // The new per-token path lives under thinking_delta below.
        if (data.content) {
          setCodingMessages((prev) => {
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
        activity.setThinkingState(true, data.content)
      } else if (data.type === 'thinking_delta') {
        // Per-token thinking stream. Append to the in-flight thinking
        // message so the user sees the reasoning appear word-by-word.
        if (data.content) {
          setCodingMessages((prev) => {
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
        activity.setThinkingState(true, data.content)
      } else if (data.type === 'text_delta') {
        // Per-token text stream for the visible response.
        if (data.content) {
          setCodingMessages((prev) => {
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
        activity.setThinkingState(true)
      } else if (data.type === 'skill_activated') {
        setCodingThinking(false)
        setCodingMessages((prev) => [...prev, { type: 'system', content: `Skill '${data.skill}' activated` }])
        activity.setThinkingState(false)
      } else if (data.type === 'permission_request') {
        setPermissionRequest(data)
        activity.setThinkingState(false)
      } else if (data.type === 'usage') {
        // Backend pushes per-turn usage so StatusBar context chip
        // reflects real numbers as the agent streams.
        if (data.usage && (data.usage.input_tokens || data.usage.output_tokens)) {
          recordUsage(codingSessionId, data.usage, data.model || null)
        }
      } else {
        setCodingThinking(false)
        // Fallback: some backends pack usage into the assistant event
        // itself. Still record it for the StatusBar.
        if (data.usage && (data.usage.input_tokens || data.usage.output_tokens)) {
          recordUsage(codingSessionId, data.usage, data.model || null)
        }
        // The final assistant event arrives AFTER all text_delta
        // events have already streamed the content. Just FREEZE the
        // in-flight assistant (and any streaming thinking) — don't
        // add a new message or we'd duplicate the text.
        const finalThinking = data.thinking || codingStreamingThinkingRef.current || null
        codingStreamingThinkingRef.current = ''
        setCodingMessages((prev) => {
          const last = prev[prev.length - 1]
          if (last && last.type === 'assistant' && last.streaming) {
            const frozen = [...prev]
            frozen[frozen.length - 1] = {
              ...last,
              ...data,
              streaming: false,
              thinking: undefined,
            }
            if (finalThinking) {
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
        activity.setThinkingState(false)
      }
    }
    })

    return () => {
      cancelled = true
      if (ws) ws.close()
    }
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

    // Coding workspace gate: refuse to send the first message before
    // the user picks a folder. Backend enforces the same rule and
    // replies with an error event if we ever slip past this check,
    // but the UX is friendlier when we catch it here.
    if (!codingWorkspace.dir) {
      setCodingMessages(prev => [...prev, {
        type: 'system',
        content: 'Pick a workspace folder in the Coding header before sending your first message.',
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

    const payload = {
      message: contextMessage,
      permission_mode: agentMode === 'yolo' ? 'yolo' : 'agent',
      // Per-turn model + thinking override. Backend routes the LLM call
      // to the chosen model and injects the thinking param if M3 + on.
      model: activeModel,
      thinking: supportsThinking ? thinkingEnabled : false,
    }
    if (codingAttachment) payload.attachment = codingAttachment.path
    // Show user message immediately before sending
    setCodingMessages(prev => [...prev, {
      type: 'user',
      content: codingInput.trim() || '📎 Attachment sent',
      attachment: codingAttachment?.path
    }])
    codingStreamingThinkingRef.current = ''
    codingWs.send(JSON.stringify(payload))
    // Defensive lock: also fire the lock endpoint client-side so the
    // backend state flips to "locked" even if the WebSocket races.
    // The WebSocket handler will set it again on the first server-side
    // processing — both paths are idempotent.
    apiFetch(`/api/coding/session/${encodeURIComponent(codingSessionId)}/lock`, {
      method: 'POST',
    }).then(() => {
      setCodingWorkspace((w) => ({ ...w, locked: true }))
    }).catch(() => { /* server will lock on first message */ })
    setCodingInput('')
    setCodingAttachment(null)
    setCodingThinking(true)
  }, [codingInput, codingWs, activeFile, fileContents, codingAttachment, agentMode, activity, gitStatus, activeModel, supportsThinking, thinkingEnabled, codingWorkspace.dir, codingSessionId])

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
      const res = await apiFetch('/api/upload', { method: 'POST', body: formData })
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

  const getFileType = (path) => {
    const ext = path.split('.').pop()?.toLowerCase()
    if (['html','htm'].includes(ext)) return 'html'
    if (['js','jsx','ts','tsx','py','css','json','md','txt','yaml','yml','sh','sql','xml'].includes(ext)) return 'text'
    if (['png','jpg','jpeg','webp','gif'].includes(ext)) return 'image'
    if (['mp3','wav','flac','m4a'].includes(ext)) return 'audio'
    if (['mp4','webm','mov'].includes(ext)) return 'video'
    return 'unsupported'
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
                    <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
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
                              const res = await apiFetch(`/api/conversations/search?q=${encodeURIComponent(val)}&type=coding`)
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
                {codingSearchLoading && <p className="px-3 py-2 text-xs text-muted-foreground">Searching...</p>}
                {codingSearchResults ? (
                  codingSearchResults.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-muted-foreground">No results found</p>
                  ) : (
                    codingSearchResults.map((result) => (
                      <div
                        key={result.id}
                        onClick={() => loadCodingConversation(result)}
                        className={`flex flex-col px-3 py-2 cursor-pointer hover:bg-surface transition-colors ${result.id === codingSessionId ? 'bg-primary/10' : ''}`}
                      >
                        <p className="text-xs font-medium text-foreground truncate">{result.title}</p>
                        <p className="text-[10px] text-muted-foreground">{result.message_count} messages</p>
                        {result.matches && result.matches.slice(0, 2).map((m, i) => (
                          <p key={i} className="text-[10px] text-muted-foreground mt-0.5 truncate">
                            <span className="text-primary/70">{m.field}:</span> {m.snippet}
                          </p>
                        ))}
                      </div>
                    ))
                  )
                ) : (
                  <>
                    {codingConversations.length === 0 && (
                      <p className="px-3 py-2 text-xs text-muted-foreground">No previous code chats</p>
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
                              <div className="flex items-center gap-1.5 mt-0.5">
                                {/* VSCode-style: show the workspace path
                                    under each conversation title so the
                                    user can see which project a chat
                                    belongs to at a glance. */}
                                {conv.workspace_dir ? (
                                  <span
                                    className="text-[10px] text-primary/80 font-mono truncate flex items-center gap-1"
                                    title={conv.workspace_dir}
                                  >
                                    <Folder size={9} className="shrink-0" />
                                    {conv.workspace_dir}
                                  </span>
                                ) : (
                                  <span className="text-[10px] text-muted-foreground/60 italic">
                                    no workspace
                                  </span>
                                )}
                                <span className="text-[10px] text-muted-foreground/60">·</span>
                                <span className="text-[10px] text-muted-foreground">{conv.message_count} msg</span>
                              </div>
                            </>
                          )}
                        </div>
                        <div className="flex items-center gap-0.5">
                          <button
                            onClick={(e) => startRename(e, conv)}
                            className="p-1 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
                            title="Rename"
                          >
                            <Pencil size={10} />
                          </button>
                          <button
                            onClick={(e) => deleteCodingConversation(e, conv.id)}
                            className="p-1 rounded hover:bg-error/10 text-muted-foreground hover:text-error transition-colors"
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
            <button onClick={startNewCodingChat} className={isAgent ? 'p-2 rounded hover:bg-surface text-muted-foreground hover:text-foreground transition-colors' : 'p-1.5 rounded hover:bg-surface text-muted-foreground hover:text-foreground transition-colors'} title="New chat">
              <MessageSquarePlus size={isAgent ? 14 : 12} />
            </button>
            <div className={`w-2 h-2 rounded-full ${codingConnected ? 'bg-success' : 'bg-error'}`} />
          </div>
        </div>

        {/* Chat Messages */}
        <div ref={codingChatRef} className={isAgent ? 'flex-1 overflow-y-auto p-6 space-y-5' : 'flex-1 overflow-y-auto p-3 space-y-3'}>
          {codingMessages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-center">
              {isAgent ? <Bot size={48} className="mb-4 opacity-30" /> : <Sparkles size={32} className="mb-3 opacity-30" />}
              <p className={isAgent ? 'text-sm' : 'text-xs'}>Ask me about your code</p>
              <p className={isAgent ? 'text-xs mt-1 opacity-50' : 'text-[10px] mt-1 opacity-50'}>I can see the file you have open</p>
            </div>
          )}

          {codingMessages.map((msg, idx) => {
            if (msg.type === 'system') {
              return (
                <div key={idx} className="flex justify-center my-2">
                  <span className={isAgent ? 'text-sm text-muted-foreground bg-surface border border-border px-3 py-1 rounded-full' : 'text-xs text-muted-foreground bg-surface border border-border px-3 py-1 rounded-full'}>{msg.content}</span>
                </div>
              )
            }
            if (msg.type === 'thinking') {
              return (
                <div key={idx} className={isAgent ? 'max-w-[80%]' : 'max-w-[85%]'}>
                  <ThinkingBlock
                    thinking={msg.content}
                    streaming={msg.streaming}
                    compact={!isAgent}
                  />
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
                  leading-relaxed space-y-1.5
                  ${isAgent ? 'max-w-[80%] px-4 py-3 rounded-2xl text-sm' : 'max-w-[85%] px-3 py-2 rounded-xl text-xs'}
                  ${msg.type === 'user'
                    ? 'bg-primary text-white rounded-br-md'
                    : 'bg-surface border border-border text-foreground rounded-bl-md'
                  }
                `}>
                  {/* Model tag for assistant messages — confirms which
                      model produced this turn when the user has multiple
                      chat options. */}
                  {msg.type === 'assistant' && msg.model && (
                    <div className="flex items-center justify-between gap-2">
                      <span className={isAgent ? 'text-[10px] text-primary/80 font-medium' : 'text-[9px] text-primary/80 font-medium'}>
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
                <Loader2 size={isAgent ? 16 : 14} className="animate-spin text-muted-foreground" />
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
                  className={isAgent ? 'w-full bg-card border border-border rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-primary' : 'w-full bg-card border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-primary'}
                />
                {showSkills && filteredSkills.length > 0 && (
                  <SlashMenu
                    skills={filteredSkills}
                    activeIndex={skillIndex}
                    onSelect={(s) => activateSkill(s.name)}
                    onHoverIndex={setSkillIndex}
                    size={isAgent ? 'md' : 'sm'}
                  />
                )}
              </div>
              <div className="flex justify-between items-center mt-1.5 gap-2">
                <p className={isAgent ? 'text-xs text-muted-foreground' : 'text-[9px] text-muted-foreground'}>Enter to send · Shift+Enter for new line</p>
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
              <div className="flex border-b border-border bg-surface/30 overflow-x-auto shrink-0 items-center">
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
                {activeFile && getFileType(activeFile) === 'html' && (
                  <button
                    onClick={() => window.open(`/api/files/raw?path=${encodeURIComponent(activeFile)}`, '_blank')}
                    className="ml-auto mr-2 px-2 py-1 rounded text-[10px] bg-surface border border-border hover:border-primary text-muted-foreground hover:text-foreground transition-colors"
                    title="Open this HTML file in a new browser tab"
                  >
                    Open in Browser
                  </button>
                )}
              </div>
            )}

            {/* Editor / Preview */}
            <div className="flex-1 min-h-0 relative">
              {selectedPreview ? (
                <div className="w-full h-full flex flex-col items-center justify-center p-4">
                  {selectedPreview.type === 'image' && (
                    <img
                      src={`/api/files/raw?path=${encodeURIComponent(selectedPreview.path)}`}
                      alt={selectedPreview.name}
                      className="max-w-full max-h-full object-contain rounded-lg"
                      title="Image preview"
                    />
                  )}
                  {selectedPreview.type === 'audio' && (
                    <audio controls className="w-full" title="Audio preview">
                      <source src={`/api/files/raw?path=${encodeURIComponent(selectedPreview.path)}`} />
                    </audio>
                  )}
                  {selectedPreview.type === 'video' && (
                    <video controls className="max-w-full max-h-full rounded-lg" title="Video preview">
                      <source src={`/api/files/raw?path=${encodeURIComponent(selectedPreview.path)}`} />
                    </video>
                  )}
                  {selectedPreview.type === 'unsupported' && (
                    <div className="text-center text-muted-foreground">
                      <FileCode size={48} className="mb-4 opacity-20 mx-auto" />
                      <p className="text-sm">This file type cannot be previewed yet.</p>
                      <p className="text-xs mt-1 opacity-60">You can download it or open it from the workspace folder.</p>
                    </div>
                  )}
                </div>
              ) : activeFile ? (
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
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
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
                  <GitBranch size={12} /> Changes
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
                      </>
                    ) : (
                      <p className="text-muted-foreground text-center py-4">{t('coding.workingTreeClean')}</p>
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
          {/* Workspace picker — only place in the app where the user
              picks the folder the agent will read/write. Sits next to
              the title (left side) so it's obvious this is the active
              workspace for THIS coding session. Mirrors the branch
              chip in the StatusBar (right side) — those are the only
              two header slots that talk about "where am I working". */}
          <WorkspacePicker
            state={codingWorkspace.locked ? 'locked' : (codingWorkspace.dir ? 'selected' : 'none')}
            workspaceDir={codingWorkspace.dir}
            label={codingWorkspace.label}
            recentWorkspaces={recentWorkspaces}
            onChange={handlePickWorkspace}
            onRemoveRecent={handleRemoveRecent}
          />
          {activeFile && (
            <span className="text-xs text-muted-foreground font-mono ml-2">{activeFile}</span>
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
              const next = !workspaceSidebarVisible
              setWorkspaceSidebarVisible(next)
              try { localStorage.setItem('workspace-sidebar-visible', String(next)) } catch {}
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${workspaceSidebarVisible ? 'bg-primary/10 text-primary' : 'bg-surface border border-border hover:border-primary text-muted-foreground'}`}
          >
            <Bot size={12} /> Workspace
          </button>
          <button
            onClick={() => { setActiveBottomTab('git'); loadGitStatus() }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${activeBottomTab === 'git' ? 'bg-primary/10 text-primary' : 'bg-surface border border-border hover:border-primary text-muted-foreground'}`}
            title="View workspace Git changes"
          >
            <GitBranch size={12} /> Changes
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
              className="p-1 rounded hover:bg-surface text-muted-foreground hover:text-foreground transition-colors"
              title="Go to workspace root"
            >
              <Home size={12} />
            </button>
            <button
              onClick={() => {
                const parent = currentPath.split('/').slice(0, -1).join('/') || 'workspace'
                loadFiles(parent)
              }}
              className="p-1 rounded hover:bg-surface text-muted-foreground hover:text-foreground transition-colors"
              title="Go up"
            >
              <ArrowUp size={12} />
            </button>
            <span className="text-[10px] font-mono text-muted-foreground truncate flex-1" title={currentPath}>{currentPath}</span>
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
                {file.is_dir ? <Folder size={14} className="text-muted-foreground" /> : <FileCode size={14} className="text-primary" />}
                <span className="truncate">{file.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Center: Agent-first chat */}
        {renderChat(true)}

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
                  <span className="text-muted-foreground">Tool:</span>
                  <span className="font-mono font-medium text-foreground">{permissionRequest.tool_name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Category:</span>
                  <span className="px-1.5 py-0.5 rounded bg-surface border border-border">{permissionRequest.classification?.category}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Risk:</span>
                  <span className={`px-1.5 py-0.5 rounded ${permissionRequest.classification?.risk === 'high' ? 'bg-red-400/10 text-red-400' : permissionRequest.classification?.risk === 'medium' ? 'bg-amber-400/10 text-amber-400' : 'bg-green-400/10 text-green-400'}`}>
                    {permissionRequest.classification?.risk}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Reason:</span>
                  <span className="text-foreground">{permissionRequest.classification?.reason}</span>
                </div>
                <div className="bg-surface border border-border rounded-lg p-2 max-h-32 overflow-y-auto">
                  <pre className="text-[10px] font-mono text-muted-foreground whitespace-pre-wrap">{JSON.stringify(permissionRequest.arguments, null, 2)}</pre>
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
