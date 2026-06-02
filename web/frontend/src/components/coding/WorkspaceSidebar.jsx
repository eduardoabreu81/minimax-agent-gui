import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Search, CheckSquare, ListTodo, Bot, PanelRightClose, PanelRightOpen,
  Loader2, Circle, CircleDot, Sparkles, CheckCircle2, XCircle,
  Wrench, Clock, Terminal
} from 'lucide-react'
import { useAgentActivity } from '../../context/AgentActivityContext'
import { useSelectedModel } from '../../hooks/useSelectedModel'

const TABS = [
  { id: 'plan', label: 'Plan', icon: Search },
  { id: 'todos', label: 'Todos', icon: CheckSquare },
  { id: 'tasks', label: 'Tasks', icon: ListTodo },
  { id: 'agents', label: 'Agents', icon: Bot },
]

export default function WorkspaceSidebar({ visible, onToggle }) {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState('tasks')
  const activity = useAgentActivity()

  useEffect(() => {
    const handleOpenTab = (e) => {
      if (e.detail) setActiveTab(e.detail)
      if (!visible) onToggle()
    }
    window.addEventListener('openWorkspaceTab', handleOpenTab)
    return () => window.removeEventListener('openWorkspaceTab', handleOpenTab)
  }, [visible, onToggle])

  if (!visible) {
    return (
      <button
        onClick={() => { onToggle(); activity.acknowledgeActivity() }}
        className="absolute right-0 top-1/2 -translate-y-1/2 z-30 p-1.5 bg-card border border-border border-r-0 rounded-l-lg text-muted-foreground hover:text-foreground hover:bg-surface transition-colors shadow-lg"
        title="Open sidebar"
      >
        <PanelRightOpen size={16} />
        {activity.hasNewActivity && (
          <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-primary rounded-full animate-pulse" />
        )}
      </button>
    )
  }

  return (
    <div className="w-64 flex flex-col bg-card border-l border-border shrink-0">
      {/* Header with tabs */}
      <div className="h-10 flex items-center border-b border-border shrink-0">
        {TABS.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-[11px] font-medium transition-colors border-b-2 ${
                isActive
                  ? 'text-primary border-primary bg-primary/5'
                  : 'text-muted-foreground border-transparent hover:text-foreground hover:bg-surface'
              }`}
            >
              <Icon size={13} />
              <span className="hidden sm:inline">{tab.label}</span>
              {tab.id === 'tasks' && activity.hasNewActivity && (
                <span className="w-1.5 h-1.5 bg-primary rounded-full" />
              )}
            </button>
          )
        })}
        <button
          onClick={onToggle}
          className="px-2 py-2 text-muted-foreground hover:text-foreground hover:bg-surface transition-colors"
          title="Close sidebar"
        >
          <PanelRightClose size={14} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {activeTab === 'plan' && <PlanPanel />}
        {activeTab === 'todos' && <TodosPanel />}
        {activeTab === 'tasks' && <TasksPanel />}
        {activeTab === 'agents' && <AgentsPanel />}
      </div>
    </div>
  )
}

function PlanPanel() {
  const activity = useAgentActivity()
  const [editingId, setEditingId] = useState(null)
  const [editingText, setEditingText] = useState('')
  const [copied, setCopied] = useState(false)

  const startEdit = (item) => {
    setEditingId(item.id)
    setEditingText(item.text)
  }

  const submitEdit = (id) => {
    const trimmed = editingText.trim()
    if (trimmed.length > 0) {
      activity.updatePlanItem(id, trimmed)
    }
    setEditingId(null)
    setEditingText('')
  }

  const handleApprove = () => {
    if (!hasValidSteps) return
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('approvePlan'))
    }
  }

  const handleCopy = async () => {
    const planText = activity.plan.items.map((item, i) => `${i + 1}. ${item.text}`).join('\n')
    const text = `User request:\n${activity.plan.sourcePrompt}\n\nPlan:\n${planText}`
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1000)
    } catch { /* ignore */ }
  }

  const hasValidSteps = activity.plan.items.some(item => item.text.trim().length > 0)
  const lastItemIsEmptyNew = activity.plan.items.length > 0 &&
    activity.plan.items[activity.plan.items.length - 1].text === 'New step'

  if (activity.plan.items.length === 0) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-xs text-muted">
          <Sparkles size={12} />
          <span>No active plan</span>
        </div>
        <p className="text-[11px] text-muted leading-relaxed">
          Create a plan before the agent makes changes.
        </p>
        <div className="p-3 rounded-lg bg-surface border border-border border-dashed space-y-2">
          <p className="text-[10px] text-muted uppercase tracking-wider mb-1">How it works</p>
          <div className="flex items-start gap-2 text-[11px]">
            <span className="text-primary font-medium shrink-0">1.</span>
            <span className="text-foreground">Switch the mode button to <strong>Plan</strong></span>
          </div>
          <div className="flex items-start gap-2 text-[11px]">
            <span className="text-primary font-medium shrink-0">2.</span>
            <span className="text-foreground">Describe the change in the code chat</span>
          </div>
          <div className="flex items-start gap-2 text-[11px]">
            <span className="text-primary font-medium shrink-0">3.</span>
            <span className="text-foreground">Review, edit, and approve the draft plan</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-foreground font-medium">
          <Sparkles size={12} className="text-primary" />
          <span>{activity.plan.approved ? 'Approved Plan' : 'Plan Draft'}</span>
          <span className="text-[10px] text-muted bg-surface border border-border rounded-full px-2 py-0.5">
            {activity.plan.items.length}
          </span>
        </div>
        {activity.plan.approved && (
          <span className="text-[10px] text-green-400 bg-green-400/10 border border-green-400/20 rounded-full px-2 py-0.5">
            Approved
          </span>
        )}
      </div>

      {/* Request block */}
      <div className="p-2.5 rounded-lg bg-surface border border-border space-y-1.5">
        <p className="text-[10px] text-muted uppercase tracking-wider">Request</p>
        <p className="text-[11px] text-foreground line-clamp-4 break-words" title={activity.plan.sourcePrompt}>
          {activity.plan.sourcePrompt}
        </p>
        {activity.plan.sourceAttachment && (
          <p className="text-[10px] text-primary flex items-center gap-1">
            <span>📎 Attached:</span>
            <span className="truncate">{activity.plan.sourceAttachment.name || activity.plan.sourceAttachment.path?.split('/').pop()}</span>
          </p>
        )}
      </div>

      {/* Steps */}
      <div className="space-y-2">
        {activity.plan.items.map((item) => (
          <div key={item.id} className="group flex items-start gap-2 p-2 rounded-lg bg-surface border border-border hover:border-primary/30 transition-colors">
            <button
              onClick={() => activity.togglePlanItem(item.id)}
              className="mt-0.5 shrink-0"
              title={item.status === 'done' ? 'Mark pending' : 'Mark done'}
            >
              {item.status === 'done' ? (
                <CheckCircle2 size={14} className="text-green-500" />
              ) : (
                <Circle size={14} className="text-muted hover:text-primary" />
              )}
            </button>

            {editingId === item.id ? (
              <input
                autoFocus
                value={editingText}
                onChange={(e) => setEditingText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitEdit(item.id)
                  if (e.key === 'Escape') { setEditingId(null); setEditingText('') }
                }}
                onBlur={() => submitEdit(item.id)}
                className="flex-1 bg-card border border-border rounded px-2 py-1 text-[11px] text-foreground focus:outline-none focus:border-primary"
              />
            ) : (
              <span
                onClick={() => startEdit(item)}
                className={`flex-1 text-[11px] cursor-text ${item.status === 'done' ? 'text-muted line-through' : 'text-foreground'}`}
                title="Click to edit"
              >
                {item.text}
              </span>
            )}

            <button
              onClick={() => activity.removePlanItem(item.id)}
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-error/10 text-muted hover:text-error transition-opacity shrink-0"
              title="Remove step"
            >
              <XCircle size={12} />
            </button>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="space-y-2 pt-1">
        {!activity.plan.approved && (
          <>
            <button
              onClick={() => {
                if (!lastItemIsEmptyNew) activity.addPlanItem('New step')
              }}
              disabled={lastItemIsEmptyNew}
              className="w-full py-1.5 bg-surface hover:bg-surface/80 border border-border hover:border-primary text-foreground text-[11px] rounded-lg transition-colors flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <CircleDot size={12} className="text-primary" /> Add step
            </button>
            <button
              onClick={handleApprove}
              disabled={!hasValidSteps}
              className="w-full py-1.5 bg-primary hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed text-white text-[11px] rounded-lg transition-colors flex items-center justify-center gap-1.5"
            >
              <CheckSquare size={12} /> Approve & Run
            </button>
          </>
        )}
        <button
          onClick={() => activity.clearPlan()}
          className="w-full py-1.5 bg-surface hover:bg-error/10 border border-border hover:border-error/30 text-muted hover:text-error text-[11px] rounded-lg transition-colors flex items-center justify-center gap-1.5"
        >
          <XCircle size={12} /> Clear plan
        </button>
        <button
          onClick={handleCopy}
          className="w-full py-1.5 bg-surface hover:bg-surface/80 border border-border hover:border-primary text-foreground text-[11px] rounded-lg transition-colors flex items-center justify-center gap-1.5"
        >
          {copied ? 'Copied' : 'Copy plan'}
        </button>
      </div>

      {activity.plan.approved && (
        <p className="text-[10px] text-muted text-center">
          This plan has been sent to the agent.
        </p>
      )}
    </div>
  )
}

function TodosPanel() {
  const [todos, setTodos] = useState([
    { id: 1, text: 'Setup project structure', done: true },
    { id: 2, text: 'Implement sidebar component', done: false },
    { id: 3, text: 'Add mode toggles', done: false },
  ])

  const toggleTodo = (id) => {
    setTodos(prev => prev.map(t => t.id === id ? { ...t, done: !t.done } : t))
  }

  return (
    <div className="space-y-2">
      {todos.map(todo => (
        <div
          key={todo.id}
          onClick={() => toggleTodo(todo.id)}
          className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors ${
            todo.done ? 'bg-surface/50' : 'bg-surface hover:bg-surface/80'
          }`}
        >
          <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
            todo.done ? 'bg-primary border-primary' : 'border-border'
          }`}>
            {todo.done && <CheckSquare size={10} className="text-white" />}
          </div>
          <span className={`text-[11px] ${todo.done ? 'text-muted line-through' : 'text-foreground'}`}>
            {todo.text}
          </span>
        </div>
      ))}
      <p className="text-[10px] text-muted pt-2">
        Todos will be auto-generated by the agent in Plan mode.
      </p>
    </div>
  )
}

function TasksPanel() {
  const activity = useAgentActivity()

  if (activity.steps.length === 0 && activity.toolResults.length === 0) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-xs text-muted">
          <Loader2 size={12} className="animate-spin" />
          <span>No active tasks</span>
        </div>
        <p className="text-[11px] text-muted leading-relaxed">
          Tasks appear here when the agent is working.
          Each step of the agent loop will show as a task card.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Steps */}
      {activity.steps.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] text-muted uppercase tracking-wider">Steps</p>
          {activity.steps.map((step) => (
            <div
              key={step.step}
              className={`p-2.5 rounded-lg border ${
                step.status === 'running'
                  ? 'bg-surface border-primary/30'
                  : 'bg-surface/50 border-border/50'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                {step.status === 'running' ? (
                  <Loader2 size={11} className="animate-spin text-primary" />
                ) : (
                  <CheckCircle2 size={11} className="text-green-500" />
                )}
                <span className={`text-[11px] font-medium ${
                  step.status === 'running' ? 'text-foreground' : 'text-muted'
                }`}>
                  Step {step.step} of {step.maxSteps}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tool Results */}
      {activity.toolResults.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] text-muted uppercase tracking-wider">Tools</p>
          {activity.toolResults.slice(-10).map((tr, i) => (
            <details key={i} className="group">
              <summary className="flex items-center gap-2 p-2 rounded-lg bg-surface border border-border cursor-pointer hover:bg-surface/80 transition-colors list-none">
                <Wrench size={11} className="text-primary shrink-0" />
                <span className="text-[11px] font-medium text-foreground truncate flex-1">{tr.tool}</span>
                {tr.success ? (
                  <CheckCircle2 size={11} className="text-green-500 shrink-0" />
                ) : (
                  <XCircle size={11} className="text-red-500 shrink-0" />
                )}
              </summary>
              <div className="mt-1 p-2 rounded bg-surface/50 text-[10px] space-y-1">
                {tr.arguments?.path && (
                  <div className="text-muted">📁 {tr.arguments.path}</div>
                )}
                {tr.content && (
                  <pre className="text-muted whitespace-pre-wrap break-all max-h-32 overflow-y-auto">{tr.content}</pre>
                )}
                {tr.error && (
                  <div className="text-red-400">❌ {tr.error}</div>
                )}
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  )
}

function AgentsPanel() {
  const activity = useAgentActivity()
  const { model: selectedModel } = useSelectedModel({ fallback: 'MiniMax-M3' })

  return (
    <div className="space-y-3">
      {/* Main Agent */}
      <div className="p-3 rounded-lg bg-surface border border-border">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center">
            <Bot size={12} className="text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-medium text-foreground">{selectedModel}</p>
            <p className="text-[10px] text-muted truncate">
              {activity.thinking.active ? 'Thinking...' : 'Idle'}
            </p>
          </div>
        </div>
        {activity.thinking.active && activity.thinking.duration > 0 && (
          <div className="flex items-center gap-1.5 mt-2 text-[10px] text-muted">
            <Clock size={10} />
            <span>{activity.thinking.duration}s</span>
          </div>
        )}
        {activity.lastTool && (
          <div className="flex items-center gap-1.5 mt-2 text-[10px] text-muted">
            <Terminal size={10} />
            <span className="truncate">Last: {activity.lastTool.tool}</span>
          </div>
        )}
      </div>

      {/* Thinking Content */}
      {activity.thinking.content && (
        <details className="group">
          <summary className="flex items-center gap-2 text-[11px] text-muted cursor-pointer hover:text-foreground transition-colors">
            <Loader2 size={11} className="animate-spin" />
            Thinking process
          </summary>
          <pre className="mt-1 p-2 rounded bg-surface text-[10px] text-muted whitespace-pre-wrap max-h-48 overflow-y-auto">
            {activity.thinking.content}
          </pre>
        </details>
      )}
    </div>
  )
}
