import { useState, useEffect, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Sparkles, Plus, Trash2, Edit3, Eye, Save, X, Loader2,
  AlertCircle, Check, Search,
} from 'lucide-react'
import { apiFetch } from '../../lib/api.js'
import { StyleSheetEditor, StyleSheetModal } from '../style-sheets/index.js'
import {
  listStyleSheets,
  deleteStyleSheet as apiDelete,
} from '../../lib/styleSheets.js'
import SessionActionGuard from '../shared/SessionActionGuard'

// StyleSheetsTab — reusable image-prompt fragments.
//
// Mirrors SkillsTab's shape (toolbar + list + editor modal) but drops the
// multi-source machinery: style sheets are user-only, so there's no source
// badge, no rescan, no addPath, no import. Storage + validation live in
// mini_agent/tools/style_sheet_loader.py; CRUD is exposed at
// /api/style-sheets/* (see web/backend/main.py).

const PROMPT_MAX = 1500        // mirrors ImagePanel.jsx + combine_prompt cap
const BODY_MAX = 1000          // mirrors style_sheet_loader.BODY_MAX
const PLACEHOLDER = '{prompt}' // mirrors style_sheet_loader.PLACEHOLDER

export default function StyleSheetsTab() {
  const { t } = useTranslation()
  const [sheets, setSheets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [savedMessage, setSavedMessage] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [editingSheet, setEditingSheet] = useState(null)   // StyleSheet | null
  const [viewingSheet, setViewingSheet] = useState(null)   // StyleSheet | null

  const fetchAll = useCallback(async () => {
    setError(null)
    try {
      const list = await listStyleSheets()
      setSheets(list || [])
    } catch (e) {
      setError(e.message || 'Failed to load style sheets')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const filtered = useMemo(() => {
    if (!search.trim()) return sheets
    const q = search.toLowerCase()
    return sheets.filter((s) =>
      s.name.toLowerCase().includes(q) ||
      (s.description || '').toLowerCase().includes(q),
    )
  }, [sheets, search])

  const showMessage = (msg) => {
    setSavedMessage(msg)
    setTimeout(() => setSavedMessage(''), 2500)
  }
  const [deleteGuard, setDeleteGuard] = useState(null) // sheet | null

  const performDeleteSheet = async (sheet) => {
    try {
      await apiDelete(sheet.name)
      showMessage(t('styleSheets.toastDeleted', { name: sheet.name }))
      await fetchAll()
    } catch (e) {
      setError(e.message || 'Delete failed')
    }
  }
  const deleteSheet = (sheet) => {
    setDeleteGuard(sheet)
  }

  const viewSheet = async (sheet) => {

    try {
      const r = await apiFetch(`/api/style-sheets/${encodeURIComponent(sheet.name)}`)
      const data = await r.json()
      if (!data.success) throw new Error('Failed to load style sheet')
      setViewingSheet(data.style_sheet)
    } catch (e) {
      setError(e.message)
    }
  }

  const editSheet = async (sheet) => {
    try {
      const r = await apiFetch(`/api/style-sheets/${encodeURIComponent(sheet.name)}`)
      const data = await r.json()
      if (!data.success) throw new Error('Failed to load style sheet')
      setEditingSheet(data.style_sheet)
    } catch (e) {
      setError(e.message)
    }
  }

  if (loading) {
    return (
      <div className="px-5 py-8 text-center text-[12.5px] text-muted-foreground flex items-center justify-center gap-2">
        <Loader2 size={13} className="animate-spin" /> {t('common.loading') || 'Loading…'}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="border border-border rounded-[14px] bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div>
            <div className="text-[13px] font-medium">{t('styleSheets.title')}</div>
            <div className="text-[11.5px] text-muted-foreground mt-0.5">
              {t('styleSheets.desc')}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setCreateOpen(true)}
              className="flex items-center gap-1.5 h-[30px] px-3 rounded-[8px] bg-primary hover:bg-primary-hover text-white text-[12px] font-medium transition-colors"
              title={t('styleSheets.create')}
            >
              <Plus size={13} /> {t('styleSheets.create')}
            </button>
          </div>
        </div>
      </div>

      {/* ── Toolbar (search) ────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-[360px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('styleSheets.search')}
            className="w-full h-[34px] bg-surface border border-border rounded-[8px] pl-9 pr-3 text-[12.5px] focus:outline-none focus:border-primary"
          />
        </div>
      </div>

      {/* ── List ─────────────────────────────────────────────────────── */}
      <div className="border border-border rounded-[14px] bg-card overflow-hidden">
        {filtered.length > 0 ? (
          <div className="divide-y divide-border">
            {filtered.map((s) => (
              <div key={s.name} className="px-5 py-3 hover:bg-surface/40">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <code className="text-[12.5px] font-semibold font-mono">{s.name}</code>
                      <span className="text-[9.5px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 uppercase tracking-wider font-mono">
                        {s.prompt_placeholder_count === 1
                          ? t('styleSheets.placeholderBadge', { placeholder: PLACEHOLDER })
                          : t('styleSheets.noPlaceholderBadge')}
                      </span>
                      <span className="text-[9.5px] text-muted-foreground font-mono">
                        {s.body_length}/{BODY_MAX}
                      </span>
                    </div>
                    <div className="text-[11.5px] text-muted-foreground mt-1 leading-snug">
                      {s.description}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => viewSheet(s)}
                      className="p-1.5 rounded-[6px] text-muted-foreground hover:text-foreground hover:bg-surface transition-colors"
                      title={t('styleSheets.viewRaw')}
                    >
                      <Eye size={12} />
                    </button>
                    <button
                      onClick={() => editSheet(s)}
                      className="p-1.5 rounded-[6px] text-muted-foreground hover:text-foreground hover:bg-surface transition-colors"
                      title={t('styleSheets.edit')}
                    >
                      <Edit3 size={12} />
                    </button>
                    <button
                      onClick={() => deleteSheet(s)}
                      className="p-1.5 rounded-[6px] text-muted-foreground hover:text-error hover:bg-error/10 transition-colors"
                      title={t('styleSheets.delete')}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-5 py-8 text-center text-[12.5px] text-muted-foreground">
            {search ? t('styleSheets.noMatches', { query: search }) : t('styleSheets.none')}
          </div>
        )}
      </div>

      {error && (
        <div className="px-4 py-2.5 rounded-[10px] bg-error/10 border border-error/30 text-[12px] text-error flex items-center gap-2">
          <AlertCircle size={13} />
          {error}
          <button onClick={() => setError(null)} className="ml-auto"><X size={12} /></button>
        </div>
      )}

      {savedMessage && (
        <div className="px-4 py-2.5 rounded-[10px] bg-success/10 border border-success/30 text-[12px] text-success flex items-center gap-2">
          <Check size={13} /> {savedMessage}
        </div>
      )}

      {/* ── Modals ───────────────────────────────────────────────────── */}
      {createOpen && (
        <StyleSheetEditorModal
          mode="create"
          onClose={() => setCreateOpen(false)}
          onSaved={async () => { setCreateOpen(false); await fetchAll(); showMessage(t('styleSheets.toastCreated')) }}
          onError={setError}
        />
      )}
      {editingSheet && (
        <StyleSheetEditorModal
          mode="edit"
          sheet={editingSheet}
          onClose={() => setEditingSheet(null)}
          onSaved={async () => { setEditingSheet(null); await fetchAll(); showMessage(t('styleSheets.toastUpdated')) }}
          onError={setError}
        />
      )}
      {viewingSheet && (
        <StyleSheetViewerModal sheet={viewingSheet} onClose={() => setViewingSheet(null)} />
      )}
      <SessionActionGuard
        open={!!deleteGuard}
        title={t('styleSheets.deleteTitle', { defaultValue: 'Delete style sheet?' })}
        description={deleteGuard
          ? t('styleSheets.confirmDelete', { name: deleteGuard.name })
          : ''}
        confirmLabel={t('styleSheets.delete', { defaultValue: 'Delete' })}
        cancelLabel={t('common.cancel', { defaultValue: 'Cancel' })}
        onCancel={() => setDeleteGuard(null)}
        onConfirm={() => {
          const target = deleteGuard
          setDeleteGuard(null)
          if (target) performDeleteSheet(target)
        }}
      />
    </div>
  )
}

// ─── Editor modal (create + edit) — mounts the shared editor ───────────────

function StyleSheetEditorModal({ mode, sheet, onClose, onSaved, onError }) {
  const { t } = useTranslation()
  const isEdit = mode === 'edit'
  const [dirty, setDirty] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const guardedClose = () => {
    if (dirty) { setDiscardOpen(true); return }
    onClose()
  }
  return (
    <>
    <StyleSheetModal
      onClose={guardedClose}
      title={isEdit ? t('styleSheets.editTitle', { name: sheet?.name || '' }) : t('styleSheets.createTitle')}
      maxWidth="max-w-[1100px]"
    >
      <StyleSheetEditor
        mode={mode}
        sheet={sheet}
        onClose={guardedClose}
        onSaved={onSaved}
        onError={onError}
        onDirtyChange={setDirty}
      />
    </StyleSheetModal>
    <SessionActionGuard
      open={discardOpen}
      title={t('styleSheets.discardTitle', { defaultValue: 'Discard unsaved changes?' })}
      description={t('styleSheets.confirmDiscard')}
      confirmLabel={t('styleSheets.discard', { defaultValue: 'Discard' })}
      cancelLabel={t('common.cancel', { defaultValue: 'Cancel' })}
      onCancel={() => setDiscardOpen(false)}
      onConfirm={() => {
        setDiscardOpen(false)
        onClose()
      }}
    />
    </>
  )
}
// ─── Viewer modal (read-only raw markdown) ─────────────────────────────────

function StyleSheetViewerModal({ sheet, onClose }) {
  const { t } = useTranslation()
  return (
    <ModalShell onClose={onClose} title={sheet.name} subtitle={sheet.path || ''} maxWidth="max-w-[900px]">
      <div className="text-[12.5px] text-muted-foreground mb-4">{sheet.description}</div>
      <pre className="bg-surface border border-border rounded-[8px] px-3 py-3 text-[12px] font-mono whitespace-pre-wrap break-words max-h-[60vh] overflow-auto">
{sheet.raw_markdown}
      </pre>
    </ModalShell>
  )
}

// ─── Shared modal shell + field ────────────────────────────────────────────

function ModalShell({ children, title, subtitle, onClose, maxWidth = 'max-w-[700px]' }) {
  return (
    <div className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm flex items-center justify-center p-6" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full ${maxWidth} max-h-[90vh] bg-card border border-border rounded-[14px] shadow-2xl overflow-hidden flex flex-col`}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border shrink-0">
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold truncate">{title}</h2>
            {subtitle && <p className="text-[11px] text-muted-foreground font-mono truncate">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-[6px] hover:bg-surface text-muted-foreground hover:text-foreground">
            <X size={14} />
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  )
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="text-[10.5px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">{label}</label>
      {children}
      {hint && <p className="text-[10px] text-muted-foreground mt-1">{hint}</p>}
    </div>
  )
}

