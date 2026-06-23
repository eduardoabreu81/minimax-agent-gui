// AgentContextTab — Settings panel content for the 5-file Agent
// Context system. Four cards: Personality, Role, Project memory,
// Daily logs. Each card shows the current state (char usage,
// status), and exposes the relevant actions (view / edit /
// quick switch).
//
// This is a "tab" that lives inside SettingsPanel (mounted at the
// `settings-agentContext` section anchor). The tab does NOT own
// navigation — the parent decides whether to render an inline
// editor or open a modal. For v0 we use inline editors for SOUL,
// IDENTITY, USER, MEMORY and a side-by-side viewer for the daily
// list.
//
// State is owned by the useAgentContext hook so other components
// (banner, wizard) stay in sync without prop-drilling.

import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Sparkles, User, Briefcase, Brain, Calendar, Save, X, Eye,
  Loader2, AlertCircle, RotateCcw, FileText,
} from 'lucide-react'
import { useAgentContext, FILE_IDS } from '../../hooks/useAgentContext.js'
import DocViewer from './DocViewer.jsx'

// Inline editor — textarea + char counter + Save/Cancel.
// Used for SOUL.md, IDENTITY.md, USER.md, MEMORY.md.
function InlineEditor({ fileId, file, onSave, onCancel }) {
  const { t } = useTranslation()
  const [content, setContent] = useState(file?.content || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => { setContent(file?.content || '') }, [file?.content])

  const used = content.length
  const limit = file?.char_limit || 0
  const pct = limit > 0 ? Math.round((used / limit) * 100) : 0
  const overLimit = limit > 0 && used > limit

  const handleSave = async () => {
    setError(null)
    setSaving(true)
    try {
      await onSave(content)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={10}
        className="
          w-full font-mono text-xs leading-relaxed
          px-3 py-2.5
          bg-surface border border-border rounded-lg
          focus:outline-none focus:border-primary
          resize-y
        "
        placeholder={t('agentContext.personality.customPlaceholder')}
      />

      <div className="flex items-center justify-between text-[10px]">
        <div className="flex items-center gap-2">
          {overLimit && (
            <span className="text-red-600 dark:text-red-400 flex items-center gap-1">
              <AlertCircle size={10} />
              {t('agentContext.percent', { pct })}
            </span>
          )}
          {!overLimit && limit > 0 && (
            <span className="text-muted-foreground">
              {t('agentContext.charCount', { used, limit })}
            </span>
          )}
        </div>
        {limit > 0 && (
          <div className="w-32 h-1.5 bg-border rounded-full overflow-hidden">
            <div
              className={`h-full transition-all ${
                pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-amber-500' : 'bg-primary'
              }`}
              style={{ width: `${Math.min(pct, 100)}%` }}
            />
          </div>
        )}
      </div>

      {error && (
        <div className="text-xs text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg p-2">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          onClick={onCancel}
          disabled={saving}
          className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {t('agentContext.common.cancel')}
        </button>
        <button
          onClick={handleSave}
          disabled={saving || overLimit}
          className="px-3 py-1.5 bg-primary hover:bg-primary-hover text-white rounded-lg text-xs font-medium transition-colors flex items-center gap-1 disabled:opacity-50"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
          {t('agentContext.common.save')}
        </button>
      </div>
    </div>
  )
}

// A single card — header (icon, title, badge) + body (status, actions).
function ContextCard({ icon: Icon, title, badge, status, children, tone = 'default' }) {
  const toneClass = {
    default: 'border-border',
    primary: 'border-primary/40',
    warning: 'border-amber-500/40',
  }[tone]

  return (
    <div className={`rounded-xl border bg-card ${toneClass} overflow-hidden`}>
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
          <Icon size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        </div>
        {badge && (
          <span className="text-[10px] text-muted-foreground bg-surface border border-border rounded px-1.5 py-0.5 shrink-0">
            {badge}
          </span>
        )}
      </div>
      <div className="p-4 space-y-3">
        {status}
        {children}
      </div>
    </div>
  )
}

export default function AgentContextTab() {
  const { t } = useTranslation()
  const {
    status, dailies, loading, fetchFile, saveFile, fetchDaily,
  } = useAgentContext()

  // Per-card state. `editing` means the inline editor is open for
  // that file id. `files` is the cached FileStatus.
  const [editing, setEditing] = useState(null)        // fileId | null
  const [files, setFiles] = useState({})
  const [viewingMemory, setViewingMemory] = useState(false)
  const [viewingDaily, setViewingDaily] = useState(null) // date string | null

  // Lazy load a file when the user clicks Edit.
  const ensureFile = useCallback(async (id) => {
    if (files[id]?.content !== undefined) return files[id]
    const f = await fetchFile(id)
    setFiles(prev => ({ ...prev, [id]: f }))
    return f
  }, [files, fetchFile])

  const handleEdit = async (id) => {
    setEditing(id)
    await ensureFile(id)
  }

  const handleSave = async (id, content) => {
    await saveFile(id, content)
    // Refresh the local cache so the next open has the new content.
    setFiles(prev => ({ ...prev, [id]: { ...(prev[id] || {}), content } }))
    setEditing(null)
  }

  // Character usage for a file id — falls back to 0/limit.
  const usageOf = (id) => {
    const u = status.char_usage?.[id] || { used: 0, limit: 0 }
    return u
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground py-12">
        <Loader2 size={14} className="animate-spin" /> Loading agent context…
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header / context blurb */}
      <div className="text-xs text-muted-foreground bg-surface border border-border rounded-lg p-3 leading-relaxed">
        {t('agentContext.subtitle')} {t('agentContext.gracefulDegradation')}
      </div>

      {/* Card 1 — Personality (SOUL) */}
      <ContextCard
        icon={Sparkles}
        title={t('agentContext.file.soul')}
        badge={`${t('agentContext.userOnly')} · ${t('agentContext.slot1')}`}
        status={<UsageBar id="soul" usage={usageOf('soul')} />}
      >
        {editing === 'soul' ? (
          <InlineEditor
            fileId="soul"
            file={files.soul}
            onSave={(c) => handleSave('soul', c)}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <div className="flex items-center justify-end">
            <button
              onClick={() => handleEdit('soul')}
              className="text-xs text-primary hover:underline"
            >
              {t('agentContext.memory.edit')}
            </button>
          </div>
        )}
      </ContextCard>

      {/* Card 2 — Current role (IDENTITY) */}
      <ContextCard
        icon={Briefcase}
        title={t('agentContext.file.identity')}
        badge={t('agentContext.userOnly')}
        status={<UsageBar id="identity" usage={usageOf('identity')} />}
      >
        {editing === 'identity' ? (
          <InlineEditor
            fileId="identity"
            file={files.identity}
            onSave={(c) => handleSave('identity', c)}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <div className="flex items-center justify-end">
            <button
              onClick={() => handleEdit('identity')}
              className="text-xs text-primary hover:underline"
            >
              {t('agentContext.memory.edit')}
            </button>
          </div>
        )}
      </ContextCard>

      {/* Card 3 — Your profile (USER) */}
      <ContextCard
        icon={User}
        title={t('agentContext.file.user')}
        badge={t('agentContext.userOnly')}
        status={<UsageBar id="user" usage={usageOf('user')} />}
      >
        {editing === 'user' ? (
          <InlineEditor
            fileId="user"
            file={files.user}
            onSave={(c) => handleSave('user', c)}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <div className="flex items-center justify-end">
            <button
              onClick={() => handleEdit('user')}
              className="text-xs text-primary hover:underline"
            >
              {t('agentContext.memory.edit')}
            </button>
          </div>
        )}
      </ContextCard>

      {/* Card 4 — Project memory (MEMORY) */}
      <ContextCard
        icon={Brain}
        title={t('agentContext.file.memory')}
        badge={t('agentContext.youAndAgent')}
        status={<UsageBar id="memory" usage={usageOf('memory')} />}
      >
        <div className="flex items-center gap-2 justify-end">
          <button
            onClick={() => setViewingMemory(true)}
            className="text-xs text-primary hover:underline flex items-center gap-1"
          >
            <Eye size={11} /> {t('agentContext.memory.view')}
          </button>
          <button
            onClick={() => handleEdit('memory')}
            className="text-xs text-primary hover:underline"
          >
            {t('agentContext.memory.edit')}
          </button>
        </div>
      </ContextCard>

      {/* Card 5 — Daily logs */}
      <ContextCard
        icon={Calendar}
        title={t('agentContext.file.daily')}
        badge={t('agentContext.agentAppends')}
      >
        {dailies.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">{t('agentContext.daily.empty')}</p>
        ) : (
          <ul className="space-y-1">
            {dailies.slice(0, 5).map((d) => (
              <li key={d.date}>
                <button
                  onClick={() => setViewingDaily(d.date)}
                  className="
                    w-full text-left flex items-center justify-between
                    px-3 py-2 rounded-md
                    hover:bg-surface text-xs
                    transition-colors
                  "
                >
                  <span className="flex items-center gap-2">
                    <FileText size={12} className="text-muted-foreground" />
                    <span className="text-foreground font-medium">{d.date}</span>
                  </span>
                  <span className="text-muted-foreground">{d.size} B</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </ContextCard>

      {/* Modal viewers */}
      {viewingMemory && (
        <ViewerModal onClose={() => setViewingMemory(false)}>
          <DocViewer
            mode="memory"
            fetchFn={() => fetchFile('memory')}
          />
        </ViewerModal>
      )}

      {viewingDaily && (
        <ViewerModal onClose={() => setViewingDaily(null)}>
          <DocViewer
            mode="daily"
            date={viewingDaily}
            fetchFn={(d) => fetchDaily(d)}
          />
        </ViewerModal>
      )}
    </div>
  )
}

// Small usage bar (char count + percent + progress).
function UsageBar({ id, usage }) {
  const { t } = useTranslation()
  if (!usage || !usage.limit) return null
  const pct = Math.round((usage.used / usage.limit) * 100)
  const color = pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-amber-500' : 'bg-primary'
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{t('agentContext.charCount', { used: usage.used, limit: usage.limit })}</span>
        <span>{t('agentContext.percent', { pct })}</span>
      </div>
      <div className="w-full h-1 bg-border rounded-full overflow-hidden">
        <div className={`h-full transition-all ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
    </div>
  )
}

// Generic modal wrapper for the DocViewer.
function ViewerModal({ children, onClose }) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-2xl h-[80vh] bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-end px-3 py-2 border-b border-border">
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-surface text-muted-foreground"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>
        <div className="flex-1 min-h-0">{children}</div>
      </div>
    </div>
  )
}
