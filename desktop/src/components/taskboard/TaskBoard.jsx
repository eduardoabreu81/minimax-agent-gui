import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { apiFetch } from '../../lib/api.js'
import {
  Layout, Plus, X, CheckCircle, Circle, Clock, AlertCircle,
  Search, ArrowUpDown, Trash2, Bot, RefreshCw, AlertTriangle
} from 'lucide-react'

const STATUS_META = [
  { id: 'pending', icon: Circle, color: 'text-slate-500', bgColor: 'bg-slate-500', borderColor: 'border-slate-200' },
  { id: 'in-progress', icon: Clock, color: 'text-blue-500', bgColor: 'bg-blue-500', borderColor: 'border-blue-200' },
  { id: 'review', icon: AlertCircle, color: 'text-amber-500', bgColor: 'bg-amber-500', borderColor: 'border-amber-200' },
  { id: 'done', icon: CheckCircle, color: 'text-green-500', bgColor: 'bg-green-500', borderColor: 'border-green-200' },
]

const PRIORITY_META = [
  { id: 'high', color: 'text-red-500', bg: 'bg-red-50' },
  { id: 'medium', color: 'text-amber-500', bg: 'bg-amber-50' },
  { id: 'low', color: 'text-blue-500', bg: 'bg-blue-50' },
]

function genSubtaskId() {
  return `sub-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

function TaskCard({ task, onClick, onDelete, t }) {
  const statusConfig = STATUS_META.find(s => s.id === task.status) || STATUS_META[0]
  const priorityConfig = PRIORITY_META.find(p => p.id === task.priority)
  const StatusIcon = statusConfig.icon
  const progress = task.subtasks?.length
    ? Math.round((task.subtasks.filter(s => s.done).length / task.subtasks.length) * 100)
    : 0
  const isAgent = task.created_by === 'agent'

  return (
    <div
      onClick={() => onClick(task)}
      className="bg-card border border-border rounded-lg p-3 space-y-2 hover:shadow-md hover:border-primary/30 transition-all duration-200 cursor-pointer group"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
            <span className="text-[10px] font-mono text-muted-foreground bg-surface px-1.5 py-0.5 rounded">{task.id.slice(-6)}</span>
            {priorityConfig && (
              <span className={`text-[10px] font-medium ${priorityConfig.color} ${priorityConfig.bg} px-1.5 py-0.5 rounded`}>
                {t(`tasks.${priorityConfig.id}`)}
              </span>
            )}
            {isAgent && (
              <span
                className="text-[10px] font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded inline-flex items-center gap-1"
                title={t('tasks.agentBadge')}
              >
                <Bot size={9} /> {t('tasks.agentBadge')}
              </span>
            )}
          </div>
          <h3 className="text-sm font-medium text-foreground leading-tight line-clamp-2">{task.title}</h3>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(task.id) }}
          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-error/20 text-muted-foreground hover:text-error transition-opacity"
          aria-label={t('tasks.delete')}
        >
          <Trash2 size={12} />
        </button>
      </div>

      {task.description && (
        <p className="text-xs text-muted-foreground line-clamp-2">{task.description}</p>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <StatusIcon size={12} className={statusConfig.color} />
          <span className={`text-[10px] font-medium ${statusConfig.color}`}>{t(`tasks.${task.status === 'in-progress' ? 'inProgress' : task.status}`)}</span>
        </div>
        {task.subtasks?.length > 0 && (
          <div className="flex items-center gap-1.5">
            <div className="w-12 h-1 rounded-full bg-surface">
              <div
                className={`h-full rounded-full ${task.status === 'done' ? 'bg-green-500' : 'bg-blue-500'} transition-all`}
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-[10px] text-muted-foreground">{task.subtasks.filter(s => s.done).length}/{task.subtasks.length}</span>
          </div>
        )}
      </div>
    </div>
  )
}

function TaskModal({ task, isOpen, onClose, onSave, onDelete, t, saving }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState('pending')
  const [priority, setPriority] = useState('medium')
  const [subtasks, setSubtasks] = useState([])
  const [newSubtask, setNewSubtask] = useState('')

  useEffect(() => {
    if (task) {
      setTitle(task.title || '')
      setDescription(task.description || '')
      setStatus(task.status || 'pending')
      setPriority(task.priority || 'medium')
      setSubtasks(task.subtasks || [])
    } else {
      setTitle('')
      setDescription('')
      setStatus('pending')
      setPriority('medium')
      setSubtasks([])
    }
  }, [task, isOpen])

  if (!isOpen) return null

  const handleSave = () => {
    if (!title.trim() || saving) return
    onSave({
      id: task?.id,
      title: title.trim(),
      description: description.trim(),
      status,
      priority,
      subtasks,
    })
  }

  const addSubtask = () => {
    if (!newSubtask.trim()) return
    setSubtasks([...subtasks, { id: genSubtaskId(), text: newSubtask.trim(), done: false }])
    setNewSubtask('')
  }

  const toggleSubtask = (id) => {
    setSubtasks(subtasks.map(s => s.id === id ? { ...s, done: !s.done } : s))
  }

  const removeSubtask = (id) => {
    setSubtasks(subtasks.filter(s => s.id !== id))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={(e) => e.target === e.currentTarget && !saving && onClose()}>
      <div className="w-full max-w-lg bg-card border border-border rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h3 className="text-sm font-semibold">{task ? t('tasks.editTask') : t('tasks.newTask')}</h3>
          <button onClick={onClose} disabled={saving} className="p-1 rounded hover:bg-surface text-muted-foreground disabled:opacity-40">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('tasks.titleLabel')}</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('tasks.taskTitlePlaceholder')}
              autoFocus
              className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('tasks.description')}</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('tasks.descriptionPlaceholder')}
              rows={3}
              className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('tasks.status')}</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
              >
                {STATUS_META.map(s => <option key={s.id} value={s.id}>{t(`tasks.${s.id === 'in-progress' ? 'inProgress' : s.id}`)}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('tasks.priority')}</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
              >
                {PRIORITY_META.map(p => <option key={p.id} value={p.id}>{t(`tasks.${p.id}`)}</option>)}
              </select>
            </div>
          </div>

          {/* Subtasks */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-2 block">{t('tasks.subtasks')}</label>
            <div className="space-y-1.5 mb-2">
              {subtasks.map((sub) => (
                <div key={sub.id} className="flex items-center gap-2 px-2 py-1.5 rounded bg-surface group">
                  <button
                    onClick={() => toggleSubtask(sub.id)}
                    className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${sub.done ? 'bg-green-500 border-green-500' : 'border-border hover:border-primary'}`}
                  >
                    {sub.done && <CheckCircle size={10} className="text-white" />}
                  </button>
                  <span className={`text-xs flex-1 ${sub.done ? 'text-muted-foreground line-through' : 'text-foreground'}`}>{sub.text}</span>
                  <button
                    onClick={() => removeSubtask(sub.id)}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-error/20 text-muted-foreground hover:text-error transition-opacity"
                    aria-label={t('tasks.delete')}
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={newSubtask}
                onChange={(e) => setNewSubtask(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addSubtask()}
                placeholder={t('tasks.addSubtask')}
                className="flex-1 bg-surface border border-border rounded-lg px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
              />
              <button
                onClick={addSubtask}
                className="px-3 py-1.5 bg-primary hover:bg-primary-hover text-white rounded-lg text-xs font-medium transition-colors"
                aria-label={t('tasks.addSubtask')}
              >
                <Plus size={12} />
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t border-border">
          {task && (
            <button
              onClick={() => onDelete(task.id)}
              disabled={saving}
              className="px-3 py-1.5 text-xs text-error hover:bg-error/10 rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-40"
            >
              <Trash2 size={12} /> {t('tasks.delete')}
            </button>
          )}
          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 bg-surface border border-border hover:border-primary text-foreground rounded-lg text-xs font-medium transition-colors disabled:opacity-40"
            >
              {t('tasks.cancel')}
            </button>
            <button
              onClick={handleSave}
              disabled={!title.trim() || saving}
              className="px-4 py-2 bg-primary hover:bg-primary-hover disabled:opacity-40 text-white rounded-lg text-xs font-medium transition-colors"
            >
              {task ? t('tasks.save') : t('tasks.create')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function TaskBoard() {
  const { t } = useTranslation()
  const [tasks, setTasks] = useState([])
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [sortField, setSortField] = useState('updatedAt')
  const [sortOrder, setSortOrder] = useState('desc')
  const [selectedTask, setSelectedTask] = useState(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [saving, setSaving] = useState(false)
  // Refs for the agent-event listener so we only ever register one
  // window event handler for the lifetime of the component.
  const tasksRef = useRef(tasks)
  tasksRef.current = tasks

  // Initial fetch + 5s poll so agent-created tasks show up without
  // requiring the user to switch tabs to force a remount.
  const fetchTasks = useCallback(async () => {
    try {
      const res = await apiFetch('/api/tasks')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (data?.success) {
        setTasks(data.tasks || [])
        setLoadError(null)
      } else {
        setLoadError(t('tasks.errorLoad'))
      }
    } catch (e) {
      setLoadError(t('tasks.errorLoad'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    fetchTasks()
    const interval = setInterval(fetchTasks, 5000)
    return () => clearInterval(interval)
  }, [fetchTasks])

  const filteredTasks = useMemo(() => {
    let result = [...tasks]

    if (searchTerm) {
      const q = searchTerm.toLowerCase()
      result = result.filter(t =>
        t.title.toLowerCase().includes(q) ||
        (t.description && t.description.toLowerCase().includes(q))
      )
    }

    if (statusFilter !== 'all') {
      result = result.filter(t => t.status === statusFilter)
    }

    if (priorityFilter !== 'all') {
      result = result.filter(t => t.priority === priorityFilter)
    }

    result.sort((a, b) => {
      const aVal = a[sortField] || ''
      const bVal = b[sortField] || ''
      const cmp = aVal > bVal ? 1 : aVal < bVal ? -1 : 0
      return sortOrder === 'desc' ? -cmp : cmp
    })

    return result
  }, [tasks, searchTerm, statusFilter, priorityFilter, sortField, sortOrder])

  const kanbanColumns = useMemo(() => {
    return STATUS_META.map(status => ({
      ...status,
      tasks: filteredTasks.filter(t => t.status === status.id),
    }))
  }, [filteredTasks])

  // Save = create new OR update existing. Single endpoint, server
  // distinguishes by presence of `id` in the PATCH path.
  const handleSaveTask = useCallback(async (payload) => {
    setSaving(true)
    try {
      let res
      if (payload.id) {
        // Strip server-managed fields so the user can't accidentally
        // forge created_by='agent' on a user task.
        const { id, ...patch } = payload
        res = await apiFetch(`/api/tasks/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(patch),
        })
      } else {
        res = await apiFetch('/api/tasks', {
          method: 'POST',
          body: JSON.stringify({
            title: payload.title,
            description: payload.description,
            status: payload.status,
            priority: payload.priority,
            subtasks: payload.subtasks,
            created_by: 'user',
          }),
        })
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || err.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      if (data?.success) {
        // Refetch to get canonical state (server assigns ids, timestamps).
        await fetchTasks()
        setIsModalOpen(false)
      } else {
        alert(data?.error || t('tasks.errorLoad'))
      }
    } catch (e) {
      alert(e?.message || t('tasks.errorLoad'))
    } finally {
      setSaving(false)
    }
  }, [fetchTasks, t])

  const handleDeleteTask = useCallback(async (taskId) => {
    // Optimistic remove — feels snappy, and the refetch on interval
    // will reconfirm within 5s if the server rejects.
    const prev = tasks
    setTasks(prev.filter(t => t.id !== taskId))
    try {
      const res = await apiFetch(`/api/tasks/${taskId}`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || `HTTP ${res.status}`)
      }
      const data = await res.json()
      if (!data?.success) {
        setTasks(prev)
        alert(data?.error || 'Delete failed')
      }
    } catch (e) {
      setTasks(prev)
      alert(e?.message || 'Delete failed')
    }
  }, [tasks])

  const stats = useMemo(() => ({
    total: tasks.length,
    pending: tasks.filter(t => t.status === 'pending').length,
    inProgress: tasks.filter(t => t.status === 'in-progress').length,
    review: tasks.filter(t => t.status === 'review').length,
    done: tasks.filter(t => t.status === 'done').length,
  }), [tasks])

  return (
    <div className="flex flex-col h-full bg-card">
      {/* Header */}
      <div className="h-14 flex items-center px-6 border-b border-border bg-surface/50 justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Layout size={18} className="text-primary" />
          <h2 className="text-sm font-semibold">{t('tasks.title')}</h2>
          <span className="text-xs text-muted-foreground ml-2">{t('tasks.tasksCount', { count: stats.total })}</span>
        </div>
        <button
          onClick={() => { setSelectedTask(null); setIsModalOpen(true) }}
          className="px-3 py-1.5 bg-primary hover:bg-primary-hover text-white rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5"
        >
          <Plus size={12} /> {t('tasks.newTask')}
        </button>
      </div>

      {/* Stats bar — formatted with separator and i18n */}
      <div className="flex items-center gap-4 px-6 py-2 border-b border-border bg-surface/20 shrink-0 text-xs text-muted-foreground">
        {t('common.statusSummary', {
          pending: stats.pending,
          progress: stats.inProgress,
          review: stats.review,
          done: stats.done,
        })}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 px-6 py-2 border-b border-border bg-surface/20 shrink-0">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={t('tasks.search')}
            className="w-full bg-surface border border-border rounded-lg pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-surface border border-border rounded-lg px-2 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary"
        >
          <option value="all">{t('tasks.allStatus')}</option>
          {STATUS_META.map(s => <option key={s.id} value={s.id}>{t(`tasks.${s.id === 'in-progress' ? 'inProgress' : s.id}`)}</option>)}
        </select>
        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          className="bg-surface border border-border rounded-lg px-2 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary"
        >
          <option value="all">{t('tasks.allPriority')}</option>
          {PRIORITY_META.map(p => <option key={p.id} value={p.id}>{t(`tasks.${p.id}`)}</option>)}
        </select>
        <button
          onClick={() => {
            setSortOrder(o => o === 'desc' ? 'asc' : 'desc')
          }}
          className="p-1.5 rounded hover:bg-surface text-muted-foreground transition-colors"
          title={t('tasks.toggleSort')}
        >
          <ArrowUpDown size={14} />
        </button>
        <button
          onClick={fetchTasks}
          disabled={loading}
          className="p-1.5 rounded hover:bg-surface text-muted-foreground transition-colors disabled:opacity-40"
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Body: loading, error, or kanban */}
      {loading && tasks.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          {t('tasks.loading')}
        </div>
      ) : loadError && tasks.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <AlertTriangle size={32} className="text-error" />
          <p className="text-sm">{loadError}</p>
          <button
            onClick={fetchTasks}
            className="px-3 py-1.5 bg-primary hover:bg-primary-hover text-white rounded-lg text-xs font-medium transition-colors"
          >
            {t('tasks.retry')}
          </button>
        </div>
      ) : (
        /* Kanban board */
        <div className="flex-1 overflow-x-auto overflow-y-hidden p-4">
          <div className="flex gap-4 h-full min-w-max">
            {kanbanColumns.map(column => (
              <div key={column.id} className="w-72 flex flex-col h-full">
                {/* Column header */}
                <div className={`flex items-center justify-between px-3 py-2 rounded-t-lg border-t-2 ${column.borderColor} bg-surface/50`}>
                  <div className="flex items-center gap-2">
                    <column.icon size={14} className={column.color} />
                    <span className="text-xs font-semibold text-foreground">{t(`tasks.${column.id === 'in-progress' ? 'inProgress' : column.id}`)}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground bg-card px-2 py-0.5 rounded-full">{column.tasks.length}</span>
                </div>

                {/* Quick add — moved to TOP of column (right under header) */}
                <button
                  onClick={() => {
                    setSelectedTask({ status: column.id, priority: 'medium', subtasks: [] })
                    setIsModalOpen(true)
                  }}
                  className="mt-2 flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-surface rounded-lg transition-colors"
                >
                  <Plus size={12} /> {t('tasks.addTask')}
                </button>

                {/* Column content (scrollable) */}
                <div className="flex-1 overflow-y-auto space-y-2 py-2 bg-surface/20 rounded-b-lg">
                  {column.tasks.map(task => (
                    <div key={task.id} className="px-2">
                      <TaskCard
                        task={task}
                        onClick={(t) => { setSelectedTask(t); setIsModalOpen(true) }}
                        onDelete={handleDeleteTask}
                        t={t}
                      />
                    </div>
                  ))}
                  {column.tasks.length === 0 && (
                    <div className="text-center py-8 text-muted-foreground">
                      <p className="text-xs opacity-50">{t('tasks.noTasks')}</p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <TaskModal
        task={selectedTask}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSaveTask}
        onDelete={(id) => { handleDeleteTask(id); setIsModalOpen(false) }}
        t={t}
        saving={saving}
      />
    </div>
  )
}
