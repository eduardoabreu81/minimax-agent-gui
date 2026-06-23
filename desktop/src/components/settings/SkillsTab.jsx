import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Sparkles, Plus, RefreshCw, Trash2, Edit3, Eye, Github, Save, X, Loader2,
  AlertCircle, Check, Search, ChevronDown, ChevronRight, Copy, ExternalLink,
} from 'lucide-react'
import { apiFetch } from '../../lib/api.js'

// ─── Source-badge palette ───────────────────────────────────────────────────
// Each source has a short letter + a colour band so users can scan the list
// quickly. BUILTIN = grey (shipped with package), USER = green (writable),
// CLAUDE = orange, CODEX = violet, GEMINI = yellow, EXTRA = blue, GENERIC = slate.
const SOURCE_BADGES = {
  'builtin':          { letter: 'B', color: 'bg-zinc-500/15 text-zinc-700 dark:text-zinc-300 border-zinc-500/30',   label: 'Built-in' },
  'user':             { letter: 'U', color: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30', label: 'User' },
  'extra':            { letter: 'E', color: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30',         label: 'Extra' },
  'external:claude':  { letter: 'C', color: 'bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30', label: 'Claude' },
  'external:codex':   { letter: 'X', color: 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30', label: 'Codex' },
  'external:gemini':  { letter: 'G', color: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-300 border-yellow-500/30', label: 'Gemini' },
  'external:generic': { letter: '·', color: 'bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30',     label: 'Generic' },
}

function SourceBadge({ source }) {
  const meta = SOURCE_BADGES[source] || SOURCE_BADGES['builtin']
  return (
    <span
      className={`inline-flex items-center justify-center w-[18px] h-[18px] rounded-[5px] border text-[10px] font-semibold font-mono shrink-0 ${meta.color}`}
      title={meta.label}
    >
      {meta.letter}
    </span>
  )
}

// ─── Source ordering matches SkillSource.priority in skill_loader.py ────────
const SOURCE_ORDER = [
  'user', 'extra', 'external:generic', 'external:claude', 'external:codex', 'external:gemini', 'builtin',
]

// ─────────────────────────────────────────────────────────────────────────────

export default function SkillsTab() {
  const { t } = useTranslation()
  const [skills, setSkills] = useState([])
  const [grouped, setGrouped] = useState({})
  const [sources, setSources] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [rescanning, setRescanning] = useState(false)
  const [search, setSearch] = useState('')
  const [expandedGroups, setExpandedGroups] = useState(() => new Set(SOURCE_ORDER))

  const [createOpen, setCreateOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [editingSkill, setEditingSkill] = useState(null)     // Skill | null
  const [viewingSkill, setViewingSkill] = useState(null)     // Skill | null
  const [contextMenu, setContextMenu] = useState(null)       // { skill, x, y } | null
  const [savedMessage, setSavedMessage] = useState('')

  // Add custom-path input
  const [addPathOpen, setAddPathOpen] = useState(false)
  const [newPath, setNewPath] = useState('')

  const fetchAll = useCallback(async () => {
    setError(null)
    try {
      const [sRes, srcRes] = await Promise.all([
        apiFetch('/api/skills'),
        apiFetch('/api/skills/sources'),
      ])
      const sData = await sRes.json()
      const srcData = await srcRes.json()
      if (!sData.success) throw new Error(sData.error || 'Failed to list skills')
      setSkills(sData.skills || [])
      setGrouped(sData.grouped || {})
      setSources(srcData.sources || [])
    } catch (e) {
      setError(e.message || 'Failed to load skills')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [contextMenu])

  const filteredSkills = useMemo(() => {
    if (!search.trim()) return skills
    const q = search.toLowerCase()
    return skills.filter(s =>
      s.name.toLowerCase().includes(q) ||
      (s.description || '').toLowerCase().includes(q),
    )
  }, [skills, search])

  const groupedFiltered = useMemo(() => {
    const out = {}
    for (const s of filteredSkills) {
      out[s.source] = out[s.source] || []
      out[s.source].push(s)
    }
    return out
  }, [filteredSkills])

  const toggleGroup = (source) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(source)) next.delete(source)
      else next.add(source)
      return next
    })
  }

  const rescan = async () => {
    setRescanning(true)
    try {
      const r = await apiFetch('/api/skills/discover', { method: 'POST' })
      const data = await r.json()
      if (!data.success) throw new Error(data.error || 'Rescan failed')
      await fetchAll()
      setSavedMessage(t('settings.skillsRescanned', { count: data.count }) || `Rescanned ${data.count} skills.`)
      setTimeout(() => setSavedMessage(''), 2500)
    } catch (e) {
      setError(e.message)
    } finally {
      setRescanning(false)
    }
  }

  const addCustomPath = async () => {
    const path = newPath.trim()
    if (!path) return
    try {
      const cur = sources
      // Find any current extra path entries (UI-only mirror; persisted via /api/config/skills)
      // We need to PATCH the config: read current block first via... actually we just send
      // the new array including the user's path. Backend replaces.
      // Simplest: read existing extras by scanning sources list where source==='extra'.
      const extras = cur.filter(s => s.source === 'extra').map(s => s.path)
      const next = [...new Set([...extras, path])]
      const r = await apiFetch('/api/config/skills', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ extra_skill_dirs: next }),
      })
      const data = await r.json()
      if (!data.success) throw new Error(data.error || 'Failed to add path')
      setNewPath('')
      setAddPathOpen(false)
      await fetchAll()
    } catch (e) {
      setError(e.message)
    }
  }

  const removeCustomPath = async (pathToRemove) => {
    const extras = sources.filter(s => s.source === 'extra').map(s => s.path)
    const next = extras.filter(p => p !== pathToRemove)
    try {
      const r = await apiFetch('/api/config/skills', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ extra_skill_dirs: next }),
      })
      const data = await r.json()
      if (!data.success) throw new Error(data.error || 'Failed to remove path')
      await fetchAll()
    } catch (e) {
      setError(e.message)
    }
  }

  const showMessage = (msg) => {
    setSavedMessage(msg)
    setTimeout(() => setSavedMessage(''), 2500)
  }

  const handleContextMenu = (e, skill) => {
    e.preventDefault()
    setContextMenu({ skill, x: e.clientX, y: e.clientY })
  }

  const deleteSkill = async (skill) => {
    if (!confirm(`Delete skill "${skill.name}"? This removes the skill directory.`)) return
    try {
      const r = await apiFetch(`/api/skills/${encodeURIComponent(skill.name)}`, { method: 'DELETE' })
      const data = await r.json()
      if (!r.ok) throw new Error(data.detail || 'Delete failed')
      showMessage(`Skill "${skill.name}" deleted.`)
      await fetchAll()
    } catch (e) {
      setError(e.message)
    }
  }

  const importToUser = async (skill) => {
    try {
      // Re-fetch full content then POST as new
      const r = await apiFetch(`/api/skills/${encodeURIComponent(skill.name)}`)
      const data = await r.json()
      if (!data.success) throw new Error('Failed to fetch skill body')
      const raw = data.skill.raw_markdown
      const payload = {
        name: skill.name,
        description: skill.description,
        body: extractBody(raw),
        license: skill.license || undefined,
        compatibility: skill.compatibility || undefined,
        allowed_tools: skill.allowed_tools || undefined,
      }
      const cr = await apiFetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const cd = await cr.json()
      if (!cr.ok) throw new Error(cd.detail || 'Import failed')
      showMessage(`Skill "${skill.name}" imported to user dir.`)
      await fetchAll()
    } catch (e) {
      setError(e.message)
    }
  }

  const viewSkill = async (skill) => {
    try {
      const r = await apiFetch(`/api/skills/${encodeURIComponent(skill.name)}`)
      const data = await r.json()
      if (!data.success) throw new Error('Failed to load skill')
      setViewingSkill(data.skill)
    } catch (e) {
      setError(e.message)
    }
  }

  const editSkill = async (skill) => {
    try {
      const r = await apiFetch(`/api/skills/${encodeURIComponent(skill.name)}`)
      const data = await r.json()
      if (!data.success) throw new Error('Failed to load skill')
      setEditingSkill(data.skill)
    } catch (e) {
      setError(e.message)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="px-5 py-8 text-center text-[12.5px] text-muted-foreground flex items-center justify-center gap-2">
        <Loader2 size={13} className="animate-spin" /> {t('common.loading') || 'Loading…'}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* ── Sources panel ──────────────────────────────────────────────── */}
      <div className="border border-border rounded-[14px] bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div>
            <div className="text-[13px] font-medium">Skill sources</div>
            <div className="text-[11.5px] text-muted-foreground mt-0.5">
              Built-in + User + Extra + external brand dirs (Claude / Codex / Gemini). User wins on conflict.
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={rescan}
              disabled={rescanning}
              className="flex items-center gap-1.5 h-[30px] px-3 rounded-[8px] border border-border bg-transparent text-foreground text-[12px] font-medium hover:border-primary/50 transition-colors disabled:opacity-40"
              title="Re-scan all sources"
            >
              {rescanning ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Rescan
            </button>
            <button
              onClick={() => setAddPathOpen(true)}
              className="flex items-center gap-1.5 h-[30px] px-3 rounded-[8px] border border-border bg-transparent text-foreground text-[12px] font-medium hover:border-primary/50 transition-colors"
              title="Add a custom skills directory"
            >
              <span className="text-[14px] leading-none">+</span> Add path
            </button>
          </div>
        </div>

        {addPathOpen && (
          <div className="px-5 py-3 border-b border-border bg-surface/40 flex gap-2">
            <input
              type="text"
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addCustomPath(); if (e.key === 'Escape') setAddPathOpen(false) }}
              placeholder="~/my-team-skills  or  C:/path/to/skills  or  .claude/plugins/foo/skills"
              className="flex-1 h-[32px] bg-card border border-border rounded-[8px] px-3 font-mono text-[12px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
              autoFocus
            />
            <button onClick={addCustomPath} disabled={!newPath.trim()} className="h-[32px] px-4 rounded-[8px] bg-primary text-white text-[12px] font-medium disabled:opacity-40">Add</button>
            <button onClick={() => { setAddPathOpen(false); setNewPath('') }} className="h-[32px] px-3 rounded-[8px] border border-border text-[12px] hover:border-primary/50">Cancel</button>
          </div>
        )}

        <div className="divide-y divide-border">
          {sources.map((src) => {
            const removable = src.source === 'extra'
            return (
              <div key={`${src.source}-${src.path}`} className="px-5 py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <SourceBadge source={src.source} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-medium truncate">
                      {src.source_label}
                      <span className="ml-2 text-[10px] text-muted-foreground font-normal">
                        {src.count} skill{src.count === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="text-[10.5px] font-mono text-muted-foreground truncate" title={src.path}>
                      {src.path}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {!src.exists && (
                    <span className="text-[10px] text-muted-foreground italic px-1.5">not on disk</span>
                  )}
                  {src.read_only && (
                    <span className="text-[10px] text-muted-foreground italic px-1.5" title="Read-only source">read-only</span>
                  )}
                  {removable && (
                    <button
                      onClick={() => removeCustomPath(src.path)}
                      className="p-1 rounded-[5px] text-muted-foreground hover:text-error hover:bg-error/10 transition-colors"
                      title="Remove this custom path"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Skills toolbar ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-[360px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search skills…"
            className="w-full h-[34px] bg-surface border border-border rounded-[8px] pl-9 pr-3 text-[12.5px] focus:outline-none focus:border-primary"
          />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setImportOpen(true)}
            className="flex items-center gap-1.5 h-[34px] px-3 rounded-[8px] border border-border bg-transparent text-foreground text-[12px] font-medium hover:border-primary/50 transition-colors"
          >
            <Github size={13} /> Import from GitHub
          </button>
          <button
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-1.5 h-[34px] px-4 rounded-[8px] bg-primary hover:bg-primary-hover text-white text-[12px] font-medium transition-colors"
          >
            <Plus size={13} /> Create skill
          </button>
        </div>
      </div>

      {/* ── Skills list (grouped by source) ───────────────────────────── */}
      <div className="border border-border rounded-[14px] bg-card overflow-hidden">
        {SOURCE_ORDER.map((source) => {
          const items = groupedFiltered[source] || []
          if (items.length === 0) return null
          const meta = SOURCE_BADGES[source] || SOURCE_BADGES['builtin']
          const expanded = expandedGroups.has(source)
          return (
            <div key={source}>
              <button
                onClick={() => toggleGroup(source)}
                className="w-full flex items-center gap-2 px-5 py-3 hover:bg-surface/60 transition-colors border-b border-border text-left"
              >
                {expanded ? <ChevronDown size={13} className="text-muted-foreground" /> : <ChevronRight size={13} className="text-muted-foreground" />}
                <SourceBadge source={source} />
                <span className="text-[12.5px] font-semibold">{meta.label}</span>
                <span className="text-[10.5px] text-muted-foreground">{items.length} skill{items.length === 1 ? '' : 's'}</span>
              </button>
              {expanded && (
                <div className="divide-y divide-border">
                  {items.map((s) => (
                    <div
                      key={`${s.source}:${s.name}`}
                      onContextMenu={(e) => handleContextMenu(e, s)}
                      className="px-5 py-3 hover:bg-surface/40 cursor-default"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <code className="text-[12.5px] font-semibold font-mono">{s.name}</code>
                            {s.skill_type && (
                              <span className="text-[9.5px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 uppercase tracking-wider">{s.skill_type}</span>
                            )}
                            {s.license && (
                              <span className="text-[9.5px] text-muted-foreground" title={s.license}>📄 {s.license}</span>
                            )}
                          </div>
                          <div className="text-[11.5px] text-muted-foreground mt-1 leading-snug">
                            {s.description}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => viewSkill(s)}
                            className="p-1.5 rounded-[6px] text-muted-foreground hover:text-foreground hover:bg-surface transition-colors"
                            title="View raw markdown"
                          >
                            <Eye size={12} />
                          </button>
                          {!s.read_only && (
                            <button
                              onClick={() => editSkill(s)}
                              className="p-1.5 rounded-[6px] text-muted-foreground hover:text-foreground hover:bg-surface transition-colors"
                              title="Edit (user dir)"
                            >
                              <Edit3 size={12} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
        {Object.keys(groupedFiltered).length === 0 && (
          <div className="px-5 py-8 text-center text-[12.5px] text-muted-foreground">
            {search ? `No skills match "${search}".` : 'No skills found.'}
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

      {/* ── Context menu ──────────────────────────────────────────────── */}
      {contextMenu && (
        <ContextMenu
          skill={contextMenu.skill}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onView={() => { viewSkill(contextMenu.skill); setContextMenu(null) }}
          onEdit={() => { editSkill(contextMenu.skill); setContextMenu(null) }}
          onImport={() => { importToUser(contextMenu.skill); setContextMenu(null) }}
          onDelete={() => { deleteSkill(contextMenu.skill); setContextMenu(null) }}
          onCopyPath={() => {
            navigator.clipboard?.writeText(contextMenu.skill.skill_path || '')
            showMessage('Path copied to clipboard.')
            setContextMenu(null)
          }}
        />
      )}

      {/* ── Modals ────────────────────────────────────────────────────── */}
      {createOpen && (
        <SkillEditorModal
          mode="create"
          onClose={() => setCreateOpen(false)}
          onSaved={async () => { setCreateOpen(false); await fetchAll(); showMessage('Skill created.') }}
          onError={setError}
        />
      )}
      {editingSkill && (
        <SkillEditorModal
          mode="edit"
          skill={editingSkill}
          onClose={() => setEditingSkill(null)}
          onSaved={async () => { setEditingSkill(null); await fetchAll(); showMessage('Skill updated.') }}
          onError={setError}
        />
      )}
      {viewingSkill && (
        <SkillViewerModal skill={viewingSkill} onClose={() => setViewingSkill(null)} />
      )}
      {importOpen && (
        <ImportModal
          onClose={() => setImportOpen(false)}
          onInstalled={async () => { setImportOpen(false); await fetchAll(); showMessage('Skill imported.') }}
          onError={setError}
        />
      )}
    </div>
  )
}

// ─── Context menu ─────────────────────────────────────────────────────────

function ContextMenu({ skill, x, y, onClose, onView, onEdit, onImport, onDelete, onCopyPath }) {
  // Clamp position so menu stays inside viewport
  const left = Math.min(x, typeof window !== 'undefined' ? window.innerWidth - 200 : x)
  const top = Math.min(y, typeof window !== 'undefined' ? window.innerHeight - 220 : y)

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="fixed z-50 min-w-[180px] bg-popover border border-border rounded-[10px] shadow-lg overflow-hidden text-[12.5px]"
      style={{ left, top }}
    >
      <MenuItem icon={<Eye size={12} />} onClick={onView}>View raw markdown</MenuItem>
      {!skill.read_only && <MenuItem icon={<Edit3 size={12} />} onClick={onEdit}>Edit</MenuItem>}
      <MenuItem icon={<Copy size={12} />} onClick={onImport}>Import to user</MenuItem>
      <MenuItem icon={<ExternalLink size={12} />} onClick={onCopyPath}>Copy skill path</MenuItem>
      {!skill.read_only && (
        <>
          <div className="border-t border-border my-1" />
          <MenuItem icon={<Trash2 size={12} />} onClick={onDelete} destructive>Delete</MenuItem>
        </>
      )}
    </div>
  )
}

function MenuItem({ icon, children, onClick, destructive }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-2 hover:bg-surface transition-colors text-left ${destructive ? 'text-error hover:bg-error/10' : 'text-foreground'}`}
    >
      {icon}
      <span>{children}</span>
    </button>
  )
}

// ─── Skill editor modal (create + edit) ───────────────────────────────────

function SkillEditorModal({ mode, skill, onClose, onSaved, onError }) {
  const isEdit = mode === 'edit'
  const [name, setName] = useState(skill?.name || '')
  const [description, setDescription] = useState(skill?.description || '')
  const [body, setBody] = useState(extractBody(skill?.raw_markdown) || '')
  const [license, setLicense] = useState(skill?.license || '')
  const [compatibility, setCompatibility] = useState(skill?.compatibility || '')
  const [allowedTools, setAllowedTools] = useState((skill?.allowed_tools || []).join(', '))
  const [saving, setSaving] = useState(false)
  const [nameError, setNameError] = useState('')

  // Live validation: name must match [a-z0-9][a-z0-9-]{0,63}
  const validateName = (raw) => {
    const v = (raw || '').trim()
    if (!v) return 'Name is required.'
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(v)) return '1-64 chars, lowercase letters/digits/hyphens, starting with letter/digit.'
    return ''
  }

  // Live preview of the full SKILL.md
  const previewMarkdown = useMemo(() => {
    if (!name && !description) return ''
    const fm = ['---']
    if (name) fm.push(`name: ${name}`)
    if (description) fm.push(`description: ${description}`)
    if (license) fm.push(`license: ${license}`)
    if (compatibility) fm.push(`compatibility: ${compatibility}`)
    if (allowedTools.trim()) {
      fm.push('allowed-tools:')
      allowedTools.split(',').map(s => s.trim()).filter(Boolean).forEach(t => fm.push(`  - ${t}`))
    }
    fm.push('---', '')
    return fm.join('\n') + (body || '').trim() + '\n'
  }, [name, description, license, compatibility, allowedTools, body])

  const handleSave = async () => {
    const err = validateName(name)
    if (err) { setNameError(err); return }
    if (!description.trim()) { onError?.('Description is required.'); return }

    setSaving(true)
    try {
      const payload = {
        description: description.trim(),
        body: body,
        license: license.trim() || undefined,
        compatibility: compatibility.trim() || undefined,
        allowed_tools: allowedTools.split(',').map(s => s.trim()).filter(Boolean),
      }
      const url = isEdit
        ? `/api/skills/${encodeURIComponent(skill.name)}`
        : '/api/skills'
      const method = isEdit ? 'PUT' : 'POST'
      const body2 = isEdit ? payload : { name: name.trim(), ...payload }
      const r = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body2),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.detail || 'Save failed')
      onSaved?.()
    } catch (e) {
      onError?.(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell onClose={onClose} title={isEdit ? `Edit "${skill.name}"` : 'Create skill'} maxWidth="max-w-[1100px]">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* ── Left: form ──────────────────────────────────────────────── */}
        <div className="space-y-3">
          <Field label="Name" hint={isEdit ? 'Cannot be changed.' : '1-64 chars, lowercase letters/digits/hyphens.'}>
            <input
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); setNameError('') }}
              disabled={isEdit}
              placeholder="my-skill"
              className="w-full h-[34px] bg-surface border border-border rounded-[8px] px-3 font-mono text-[12.5px] focus:outline-none focus:border-primary disabled:opacity-50"
            />
            {nameError && <p className="text-[10.5px] text-error mt-1">{nameError}</p>}
          </Field>
          <Field label="Description" hint="1-1024 chars. First thing the Agent reads.">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="When the user wants to do X, this skill provides Y."
              className="w-full bg-surface border border-border rounded-[8px] px-3 py-2 text-[12.5px] focus:outline-none focus:border-primary resize-none"
            />
            <p className="text-[10px] text-muted-foreground mt-0.5">{description.length}/1024</p>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="License">
              <input type="text" value={license} onChange={(e) => setLicense(e.target.value)} placeholder="MIT"
                className="w-full h-[32px] bg-surface border border-border rounded-[8px] px-2.5 text-[12px] focus:outline-none focus:border-primary" />
            </Field>
            <Field label="Compatibility" hint={`≤500 chars (${compatibility.length})`}>
              <input type="text" value={compatibility} onChange={(e) => setCompatibility(e.target.value)} placeholder="e.g. needs Python 3.11+"
                className="w-full h-[32px] bg-surface border border-border rounded-[8px] px-2.5 text-[12px] focus:outline-none focus:border-primary" />
            </Field>
          </div>
          <Field label="Allowed tools" hint="Comma-separated: read_file, write_file, bash, web_search, …">
            <input type="text" value={allowedTools} onChange={(e) => setAllowedTools(e.target.value)} placeholder="read_file, write_file"
              className="w-full h-[32px] bg-surface border border-border rounded-[8px] px-2.5 font-mono text-[12px] focus:outline-none focus:border-primary" />
          </Field>
          <Field label="Body" hint="Markdown. Use {{skill_root}} or absolute paths for references.">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={14}
              placeholder="# My Skill&#10;&#10;When the user wants to do X, follow these steps..."
              className="w-full bg-surface border border-border rounded-[8px] px-3 py-2 font-mono text-[12px] focus:outline-none focus:border-primary resize-none"
            />
          </Field>
        </div>
        {/* ── Right: live preview ─────────────────────────────────────── */}
        <div className="flex flex-col">
          <div className="text-[11.5px] font-semibold text-muted-foreground mb-1.5">Live preview (SKILL.md)</div>
          <pre className="flex-1 min-h-[400px] bg-surface border border-border rounded-[8px] px-3 py-2.5 text-[11.5px] font-mono whitespace-pre-wrap break-words overflow-auto">
{previewMarkdown || 'Fill in name + description to see preview…'}
          </pre>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-end gap-2">
        <button onClick={onClose} className="h-[34px] px-4 rounded-[8px] border border-border text-[12px] hover:border-primary/50">Cancel</button>
        <button onClick={handleSave} disabled={saving}
          className="flex items-center gap-1.5 h-[34px] px-4 rounded-[8px] bg-primary hover:bg-primary-hover disabled:opacity-40 text-white text-[12px] font-medium">
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
          {isEdit ? 'Save changes' : 'Create skill'}
        </button>
      </div>
    </ModalShell>
  )
}

// ─── Skill viewer modal (read-only raw markdown) ──────────────────────────

function SkillViewerModal({ skill, onClose }) {
  return (
    <ModalShell onClose={onClose} title={skill.name} subtitle={`${skill.source_label} · ${skill.skill_path || ''}`} maxWidth="max-w-[900px]">
      <div className="text-[12.5px] text-muted-foreground mb-4">{skill.description}</div>
      <pre className="bg-surface border border-border rounded-[8px] px-3 py-3 text-[12px] font-mono whitespace-pre-wrap break-words max-h-[60vh] overflow-auto">
{skill.raw_markdown}
      </pre>
    </ModalShell>
  )
}

// ─── GitHub import modal ──────────────────────────────────────────────────

function ImportModal({ onClose, onInstalled, onError }) {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState(null)

  const fetchPreview = async () => {
    if (!url.trim()) return
    setLoading(true)
    setPreview(null)
    try {
      const r = await apiFetch('/api/skills/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.detail || 'Import preview failed')
      setPreview(data.preview)
    } catch (e) {
      onError?.(e.message)
    } finally {
      setLoading(false)
    }
  }

  const install = async () => {
    if (!preview) return
    setLoading(true)
    try {
      const payload = {
        name: (preview.suggested_name || '').trim() || 'imported-skill',
        description: preview.suggested_description || '',
        body: preview.body || '',
        license: preview.suggested_license || undefined,
        compatibility: preview.suggested_compatibility || undefined,
        allowed_tools: preview.suggested_allowed_tools || undefined,
        metadata: preview.suggested_metadata || undefined,
      }
      const r = await apiFetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.detail || 'Install failed')
      onInstalled?.()
    } catch (e) {
      onError?.(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <ModalShell onClose={onClose} title="Import from GitHub" maxWidth="max-w-[900px]">
      <div className="space-y-4">
        <Field label="GitHub URL" hint="Paste a SKILL.md link (blob or raw). GitHub URLs auto-normalised.">
          <div className="flex gap-2">
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') fetchPreview() }}
              placeholder="https://github.com/<owner>/<repo>/blob/main/path/SKILL.md"
              className="flex-1 h-[36px] bg-surface border border-border rounded-[8px] px-3 font-mono text-[12.5px] focus:outline-none focus:border-primary"
            />
            <button onClick={fetchPreview} disabled={!url.trim() || loading}
              className="h-[36px] px-4 rounded-[8px] bg-primary text-white text-[12.5px] font-medium disabled:opacity-40 flex items-center gap-1.5">
              {loading && !preview ? <Loader2 size={12} className="animate-spin" /> : <Eye size={12} />}
              Preview
            </button>
          </div>
        </Field>

        {preview && (
          <div className="border border-border rounded-[10px] bg-surface/40 p-4 space-y-3">
            <div className="text-[11.5px] text-muted-foreground">
              Preview fetched from <code className="font-mono text-foreground">{preview.source_url}</code>
            </div>
            <div className="grid grid-cols-2 gap-3 text-[12px]">
              <Field label="Suggested name">
                <input type="text" value={preview.suggested_name} readOnly
                  className="w-full h-[30px] bg-card border border-border rounded-[7px] px-2.5 font-mono text-[12px] opacity-70" />
              </Field>
              <Field label="Suggested description">
                <input type="text" value={(preview.suggested_description || '').slice(0, 100)} readOnly
                  className="w-full h-[30px] bg-card border border-border rounded-[7px] px-2.5 text-[12px] opacity-70" />
              </Field>
            </div>
            <details>
              <summary className="text-[11.5px] text-muted-foreground cursor-pointer hover:text-foreground">Show raw markdown</summary>
              <pre className="mt-2 bg-card border border-border rounded-[7px] px-3 py-2 text-[11px] font-mono whitespace-pre-wrap break-words max-h-[40vh] overflow-auto">
{preview.raw_markdown}
              </pre>
            </details>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <button onClick={onClose} className="h-[34px] px-4 rounded-[8px] border border-border text-[12px] hover:border-primary/50">Cancel</button>
          <button onClick={install} disabled={!preview || loading}
            className="flex items-center gap-1.5 h-[34px] px-4 rounded-[8px] bg-primary hover:bg-primary-hover disabled:opacity-40 text-white text-[12px] font-medium">
            {loading && preview ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            Install to user dir
          </button>
        </div>
      </div>
    </ModalShell>
  )
}

// ─── Shared modal shell + field ──────────────────────────────────────────

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

// ─── Helper: extract body from full SKILL.md markdown ────────────────────

function extractBody(raw) {
  if (!raw) return ''
  const m = raw.match(/^---\n.*?\n---\n?(.*)$/s)
  return m ? m[1].trim() : raw.trim()
}
