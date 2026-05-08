import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Search, CheckSquare, ListTodo, Bot, PanelRightClose, PanelRightOpen,
  Loader2, Circle, CircleDot, Sparkles
} from 'lucide-react'

const TABS = [
  { id: 'plan', label: 'Plan', icon: Search },
  { id: 'todos', label: 'Todos', icon: CheckSquare },
  { id: 'tasks', label: 'Tasks', icon: ListTodo },
  { id: 'agents', label: 'Agents', icon: Bot },
]

export default function WorkspaceSidebar({ visible, onToggle }) {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState('plan')

  if (!visible) {
    return (
      <button
        onClick={onToggle}
        className="absolute right-0 top-1/2 -translate-y-1/2 z-30 p-1.5 bg-card border border-border border-r-0 rounded-l-lg text-muted-foreground hover:text-foreground hover:bg-surface transition-colors shadow-lg"
        title="Open sidebar"
      >
        <PanelRightOpen size={16} />
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
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-muted">
        <Sparkles size={12} />
        <span>No active plan</span>
      </div>
      <p className="text-[11px] text-muted leading-relaxed">
        The agent will create a plan here before making changes.
        Switch to <strong>Plan mode</strong> to see the planning in action.
      </p>
      <div className="p-3 rounded-lg bg-surface border border-border border-dashed">
        <p className="text-[10px] text-muted uppercase tracking-wider mb-2">Example plan steps</p>
        <div className="space-y-2">
          <div className="flex items-start gap-2 text-[11px]">
            <CircleDot size={12} className="text-primary mt-0.5 shrink-0" />
            <span className="text-foreground">Explore codebase structure</span>
          </div>
          <div className="flex items-start gap-2 text-[11px]">
            <Circle size={12} className="text-muted mt-0.5 shrink-0" />
            <span className="text-muted">Identify relevant files</span>
          </div>
          <div className="flex items-start gap-2 text-[11px]">
            <Circle size={12} className="text-muted mt-0.5 shrink-0" />
            <span className="text-muted">Implement changes</span>
          </div>
          <div className="flex items-start gap-2 text-[11px]">
            <Circle size={12} className="text-muted mt-0.5 shrink-0" />
            <span className="text-muted">Verify and test</span>
          </div>
        </div>
      </div>
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
      <div className="space-y-2">
        <div className="p-2.5 rounded-lg bg-surface border border-border">
          <div className="flex items-center gap-2 mb-1">
            <Loader2 size={11} className="animate-spin text-primary" />
            <span className="text-[11px] font-medium text-foreground">Analyzing request...</span>
          </div>
          <p className="text-[10px] text-muted">Step 1 of 5</p>
        </div>
        <div className="p-2.5 rounded-lg bg-surface/50 border border-border/50 opacity-60">
          <div className="flex items-center gap-2 mb-1">
            <Circle size={11} className="text-muted" />
            <span className="text-[11px] font-medium text-muted">Execute tools</span>
          </div>
          <p className="text-[10px] text-muted">Step 2 of 5</p>
        </div>
      </div>
    </div>
  )
}

function AgentsPanel() {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-muted">
        <Bot size={12} />
        <span>No sub-agents active</span>
      </div>
      <p className="text-[11px] text-muted leading-relaxed">
        Sub-agents will appear here when spawned.
        Each agent can work on a specific task in parallel.
      </p>
      <div className="p-3 rounded-lg bg-surface border border-border">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center">
            <Bot size={12} className="text-primary" />
          </div>
          <div>
            <p className="text-[11px] font-medium text-foreground">MiniMax-M2.7</p>
            <p className="text-[10px] text-muted">Main agent · Active</p>
          </div>
        </div>
      </div>
    </div>
  )
}
