// ContextModal — single fullscreen overlay combining About You and
// the 5 Agent Context cards, with a "Re-run onboarding" affordance.
//
// Replaces the previous Settings rail entries for "About You" and
// "Agent context". The modal opens from the rail (Context button),
// the banner, the command palette, and any future trigger.
//
// Renders ABOVE the rest of the app (z-index 70) with a backdrop
// blur. Closes on:
//   - X button click
//   - Backdrop click
//   - ESC key
//
// When the "Re-run onboarding" button is pressed, the modal stays
// open and the OnboardingWizard overlay appears on top of it. The
// user can complete the wizard and the modal will close when the
// wizard does (or stay open if they cancel — the modal's close
// button is the explicit exit).

import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Sparkles, User, Briefcase, Brain, Calendar, FileText, Loader2, Save, Eye, Edit3 } from 'lucide-react'
import { useContextModal } from './ContextProvider.jsx'
import { useAgentContext } from '../../hooks/useAgentContext.js'
import AboutYouCard from './AboutYouCard.jsx'

export default function ContextModal() {
  const { t } = useTranslation()
  const { open, closeModal, openModalAndWizard } = useContextModal()
  const { status, dailies, loading, fetchFile, saveFile, fetchDaily } = useAgentContext()

  // ESC closes the modal
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') closeModal() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, closeModal])

  if (!open) return null

  // Character usage lookup for the Agent Context cards below
  const usageOf = (id) => status.char_usage?.[id] || { used: 0, limit: 0 }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => e.target === e.currentTarget && closeModal()}
    >
      <div className="
        w-full max-w-2xl max-h-[88vh]
        bg-card border border-border rounded-2xl shadow-2xl
        overflow-hidden flex flex-col
      ">
        {/* Header */}
        <div className="flex items-start gap-3 px-5 py-4 border-b border-border">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
            <Brain size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-foreground">
              {t('agentContext.title') || 'Agent context'}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('agentContext.subtitle')}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={openModalAndWizard}
              className="
                inline-flex items-center gap-1.5
                px-2.5 py-1.5 rounded-md
                bg-primary/10 hover:bg-primary/20
                text-primary text-xs font-medium
                border border-primary/30
                transition-colors
              "
            >
              <Sparkles size={12} />
              {t('agentContext.rerunOnboarding') || 'Re-run onboarding'}
            </button>
            <button
              onClick={closeModal}
              className="p-1.5 rounded-md hover:bg-surface text-muted-foreground transition-colors"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground py-12">
              <Loader2Icon /> Loading…
            </div>
          ) : (
            <>
              {/* 1. About You */}
              <AboutYouCard />

              {/* 2-5. Agent Context cards — reuse the same renderers
                  the AgentContextTab uses, inlined here to keep the
                  modal self-contained. */}
              <ContextCard
                icon={Sparkles}
                title={t('agentContext.file.soul')}
                badge={`${t('agentContext.userOnly')} · ${t('agentContext.slot1')}`}
                id="soul"
                usage={usageOf('soul')}
                fetchFile={fetchFile}
                saveFile={saveFile}
              />
              <ContextCard
                icon={Briefcase}
                title={t('agentContext.file.identity')}
                badge={t('agentContext.userOnly')}
                id="identity"
                usage={usageOf('identity')}
                fetchFile={fetchFile}
                saveFile={saveFile}
              />
              <ContextCard
                icon={User}
                title={t('agentContext.file.user')}
                badge={t('agentContext.userOnly')}
                id="user"
                usage={usageOf('user')}
                fetchFile={fetchFile}
                saveFile={saveFile}
              />
              <ContextCard
                icon={Brain}
                title={t('agentContext.file.memory')}
                badge={t('agentContext.youAndAgent')}
                id="memory"
                usage={usageOf('memory')}
                fetchFile={fetchFile}
                saveFile={saveFile}
              />

              {/* 6. Daily logs list */}
              <DailyLogsCard dailies={dailies} fetchDaily={fetchDaily} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ---- Small sub-components used only by the modal ----

import { useState, useCallback } from 'react'

function Loader2Icon() {
  return <Loader2 size={14} className="animate-spin" />
}

// Generic card with icon, title, optional badge, and the body slot.
// Each card owns its edit/view state and uses the same fetchFile /
// saveFile from useAgentContext.
function ContextCard({ icon: Icon, title, badge, id, usage, fetchFile, saveFile }) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [content, setContent] = useState(null)  // null = not loaded
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const startEdit = useCallback(async () => {
    setEditing(true)
    if (content === null) {
      try {
        const data = await fetchFile(id)
        setContent(data.content || '')
      } catch (e) {
        setError(e.message)
      }
    }
  }, [content, fetchFile, id])

  const cancelEdit = () => { setEditing(false); setError(null) }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      await saveFile(id, content)
      setEditing(false)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const used = content?.length ?? 0
  const limit = usage.limit || 0
  const overLimit = limit > 0 && used > limit
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
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
        {/* Usage bar */}
        {limit > 0 && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>{t('agentContext.charCount', { used: usage.used, limit })}</span>
              <span>{t('agentContext.percent', { pct: Math.round((usage.used / limit) * 100) })}</span>
            </div>
            <div className="w-full h-1 bg-border rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${
                  pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-amber-500' : 'bg-primary'
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}

        {editing ? (
          <div className="space-y-2">
            <textarea
              value={content ?? ''}
              onChange={(e) => setContent(e.target.value)}
              rows={6}
              className="
                w-full font-mono text-xs leading-relaxed
                px-3 py-2.5
                bg-surface border border-border rounded-lg
                focus:outline-none focus:border-primary
                resize-y
              "
            />
            {error && (
              <div className="text-xs text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg p-2">
                {error}
              </div>
            )}
            <div className="flex items-center justify-between text-[10px]">
              <div className={overLimit ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}>
                {overLimit ? `${t('agentContext.percent', { pct })}` : `${used} / ${limit} ${t('limit.char') || 'chars'}`}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={cancelEdit} className="text-xs text-muted-foreground hover:text-foreground">
                  {t('agentContext.common.cancel')}
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || overLimit}
                  className="px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-medium flex items-center gap-1 disabled:opacity-50"
                >
                  {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                  {t('agentContext.common.save')}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-end">
            <button onClick={startEdit} className="text-xs text-primary hover:underline">
              {t('agentContext.memory.edit')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// Daily logs list — same shape as AgentContextTab's daily list,
// inlined so the modal is self-contained.
function DailyLogsCard({ dailies, fetchDaily }) {
  const { t } = useTranslation()
  const [viewingDate, setViewingDate] = useState(null)
  const [viewing, setViewing] = useState(null)

  const open = async (date) => {
    setViewingDate(date)
    try {
      const data = await fetchDaily(date)
      setViewing(data)
    } catch (e) {
      setViewing({ content: `Error: ${e.message}` })
    }
  }

  return (
    <>
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
            <Calendar size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-foreground">
              {t('agentContext.file.daily')}
            </h3>
          </div>
          <span className="text-[10px] text-muted-foreground bg-surface border border-border rounded px-1.5 py-0.5 shrink-0">
            {t('agentContext.agentAppends')}
          </span>
        </div>
        <div className="p-4">
          {dailies.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">{t('agentContext.daily.empty')}</p>
          ) : (
            <ul className="space-y-1">
              {dailies.slice(0, 5).map((d) => (
                <li key={d.date}>
                  <button
                    onClick={() => open(d.date)}
                    className="
                      w-full text-left flex items-center justify-between
                      px-3 py-2 rounded-md
                      hover:bg-surface text-xs transition-colors
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
        </div>
      </div>

      {/* Daily viewer — local to this card so the modal can host
          multiple doc viewers in a stack. */}
      {viewingDate && (
        <DailyViewer
          date={viewingDate}
          content={viewing}
          onClose={() => { setViewingDate(null); setViewing(null) }}
        />
      )}
    </>
  )
}

function DailyViewer({ date, content, onClose }) {
  const { t } = useTranslation()
  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-2xl max-h-[80vh] bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold">
            {t('agentContext.viewer.daily.title', { date })}
          </h3>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-surface text-muted-foreground" aria-label="Close">
            <X size={14} />
          </button>
        </div>
        <pre className="flex-1 overflow-y-auto p-4 text-xs font-mono leading-relaxed whitespace-pre-wrap break-words bg-surface">
          {content?.content || '—'}
        </pre>
      </div>
    </div>
  )
}
