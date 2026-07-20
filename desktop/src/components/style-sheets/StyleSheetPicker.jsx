// StyleSheetPicker — replaces the native <select> previously used in the
// Image panel. "Atelier" aesthetic: a chip trigger that flips into a
// popover drawer of index-card rows. Each row shows name + a one-line
// description (ellipsized). Hovering a row reveals a portal-rendered
// tooltip with the full description plus the body preview (fetched
// lazily via useStyleSheetTooltip).
//
// Per-row affordances:
//   - click row   → select this sheet
//   - pencil      → onEdit(sheet)
//   - trash       → onDelete(sheet)  (parent handles confirm)
//
// Header:
//   - "+ New"     → onCreate()
//
// Trigger:
//   - none  → dashed "No style sheet" chip
//   - set   → solid chip with name + 1-line description caption
//
// Search: filters list by name OR description (case-insensitive). The
// "None" row is always visible and is not affected by the search.
//
// Keyboard:
//   - Escape     → close popover
//   - Up/Down    → move highlight
//   - Enter      → select highlighted row
//   - Tab        → close + return focus to trigger

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import {
  ChevronDown,
  Pencil,
  Plus,
  Search as SearchIcon,
  Trash2,
  X,
} from 'lucide-react'
import { useStyleSheetTooltip } from '../../hooks/useStyleSheetTooltip.js'
import SessionActionGuard from '../shared/SessionActionGuard.jsx'

const TOOLTIP_MAX_W = 360

export default function StyleSheetPicker({
  value = '',
  sheets = [],
  onChange,
  onCreate,
  onEdit,
  onDelete,
  overBudget = false,
  combinedLen = 0,
  promptMax = 1500,
  loading = false,
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [deleteGuard, setDeleteGuard] = useState(null) // sheet | null
  const triggerRef = useRef(null)
  const popoverRef = useRef(null)
  const searchRef = useRef(null)

  const selected = useMemo(
    () => sheets.find((s) => s.name === value) || null,
    [sheets, value]
  )

  // Build the visible row list. "None" is always index 0. The rest are
  // the filtered sheets.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sheets
    return sheets.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.description || '').toLowerCase().includes(q)
    )
  }, [sheets, query])

  // Reset highlight whenever the visible list or popover open state changes.
  useEffect(() => {
    setHighlight(0)
  }, [open, query])

  // Focus search when opening; close on outside click + Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target)
      ) {
        setOpen(false)
      }
    }
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    // Microtask defer so the popover has rendered before we focus.
    const focusId = setTimeout(() => searchRef.current?.focus(), 0)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      clearTimeout(focusId)
    }
  }, [open])

  const handleSelect = useCallback(
    (name) => {
      onChange?.(name || '')
      setOpen(false)
      triggerRef.current?.focus()
    },
    [onChange]
  )

  const onTriggerKey = useCallback(
    (e) => {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        setOpen(true)
      }
    },
    []
  )

  const onSearchKey = useCallback(
    (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlight((h) => Math.min(h + 1, visible.length)) // +1 for "None" row
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlight((h) => Math.max(h - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (highlight === 0) handleSelect('')
        else {
          const s = visible[highlight - 1]
          if (s) handleSelect(s.name)
        }
      } else if (e.key === 'Tab') {
        setOpen(false)
      }
    },
    [highlight, visible, handleSelect]
  )

  return (
    <div className="relative w-full">
      {/* Trigger chip */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onTriggerKey}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid="style-sheet-trigger"
        className={`w-full text-left rounded-[10px] px-3 py-2 transition-colors min-h-[44px] flex items-center gap-2 group ${
          selected
            ? 'bg-card border border-border hover:border-primary/40'
            : 'bg-card/40 border border-dashed border-border hover:border-primary/50'
        }`}
      >
        {selected ? (
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[13px] font-mono font-medium text-primary truncate">
                {selected.name}
              </span>
              <span
                className={`ml-auto text-[10.5px] tabular-nums shrink-0 ${
                  overBudget
                    ? 'text-error'
                    : combinedLen > promptMax * 0.8
                      ? 'text-primary'
                      : 'text-muted-foreground'
                }`}
                title={overBudget ? t('image.styleSheetOverBudget') : undefined}
                data-testid="style-sheet-budget"
              >
                {combinedLen}/{promptMax}
              </span>
            </div>
            {selected.description && (
              <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                {selected.description}
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex items-center gap-2">
            <span className="text-[12.5px] text-muted-foreground italic">
              {t('styleSheets.noneChip')}
            </span>
          </div>
        )}
        <ChevronDown
          size={14}
          className={`text-muted-foreground shrink-0 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open &&
        createPortal(
          <div
            ref={popoverRef}
            role="listbox"
            data-testid="style-sheet-popover"
            style={{
              position: 'absolute',
              top: triggerRef.current
                ? triggerRef.current.getBoundingClientRect().bottom + 6
                : 0,
              left: triggerRef.current
                ? triggerRef.current.getBoundingClientRect().left
                : 0,
              width: triggerRef.current
                ? triggerRef.current.getBoundingClientRect().width
                : 'auto',
              zIndex: 60,
            }}
            className="bg-popover border border-border rounded-[12px] shadow-2xl overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t('styleSheets.title')}
              </div>
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  onCreate?.()
                }}
                className="flex items-center gap-1 text-[11.5px] font-medium text-primary hover:text-primary-hover"
                data-testid="style-sheet-new"
              >
                <Plus size={12} /> {t('styleSheets.create')}
              </button>
            </div>

            {/* Search */}
            <div className="px-3 py-2 border-b border-border">
              <div className="flex items-center gap-2 bg-surface rounded-[8px] px-2.5 py-1.5">
                <SearchIcon size={12} className="text-muted-foreground shrink-0" />
                <input
                  ref={searchRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onSearchKey}
                  placeholder={t('styleSheets.search')}
                  className="flex-1 bg-transparent border-0 outline-none text-[12px] text-foreground placeholder:text-muted-foreground/70"
                  data-testid="style-sheet-search"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    aria-label={t('common.cancel')}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
            </div>

            {/* Rows */}
            <div className="max-h-[300px] overflow-y-auto py-1">
              {/* None row */}
              <SheetRow
                active={value === ''}
                highlighted={highlight === 0}
                onClick={() => handleSelect('')}
                onMouseEnter={() => setHighlight(0)}
                name={t('image.styleSheetNone')}
                description=""
                isNone
              />

              {loading && sheets.length === 0 && (
                <div className="px-3 py-4 text-[11px] text-muted-foreground text-center">
                  {t('common.loading') || 'Loading…'}
                </div>
              )}

              {!loading && visible.length === 0 && (
                <div className="px-3 py-4 text-[11px] text-muted-foreground text-center">
                  {t('styleSheets.noMatches', { query })}
                </div>
              )}

              {visible.map((sheet, i) => (
                <SheetRow
                  key={sheet.name}
                  sheet={sheet}
                  index={i + 1}
                  active={value === sheet.name}
                  highlighted={highlight === i + 1}
                  onClick={() => handleSelect(sheet.name)}
                  onMouseEnter={() => setHighlight(i + 1)}
                  onEdit={() => {
                    setOpen(false)
                    onEdit?.(sheet)
                  }}
                  onDeleteClick={() => setDeleteGuard(sheet)}
                />
              ))}
            </div>
          </div>,
          document.body
        )}

      {/* Delete confirm modal — reuses the existing SessionActionGuard */}
      <SessionActionGuard
        open={!!deleteGuard}
        title={t('styleSheets.deleteTitle', {
          defaultValue: 'Delete style sheet?',
        })}
        description={
          deleteGuard
            ? t('styleSheets.confirmDelete', { name: deleteGuard.name })
            : ''
        }
        confirmLabel={t('styleSheets.delete')}
        cancelLabel={t('common.cancel', { defaultValue: 'Cancel' })}
        onCancel={() => setDeleteGuard(null)}
        onConfirm={async () => {
          const sheet = deleteGuard
          setDeleteGuard(null)
          if (!sheet) return
          try {
            await onDelete?.(sheet.name)
            // If we deleted the active selection, fall back to None.
            if (sheet.name === value) onChange?.('')
          } catch {
            /* parent will surface the error */
          }
        }}
      />
    </div>
  )
}

// ─── Single row ──────────────────────────────────────────────────────────

function SheetRow({
  sheet,
  name,
  active,
  highlighted,
  onClick,
  onMouseEnter,
  onEdit,
  onDeleteClick,
  isNone = false,
}) {
  const { t } = useTranslation()
  const [hovered, setHovered] = useState(false)
  const displayName = isNone ? name : sheet.name
  const displayDesc = isNone ? '' : sheet.description || sheet.name

  return (
    <div
      role="option"
      aria-selected={active}
      onClick={onClick}
      onMouseEnter={(e) => {
        setHovered(true)
        onMouseEnter?.(e)
      }}
      onMouseLeave={() => setHovered(false)}
      data-testid={isNone ? 'style-sheet-row-none' : `style-sheet-row-${sheet.name}`}
      className={`group relative flex items-start gap-2.5 px-3 py-2 cursor-pointer transition-colors ${
        highlighted ? 'bg-surface' : 'hover:bg-surface/60'
      } ${active ? 'bg-primary/5' : ''}`}
    >
      {/* Selection dot */}
      <div
        className={`mt-1 h-3 w-3 rounded-full border-2 shrink-0 transition-colors ${
          active ? 'bg-primary border-primary' : 'border-border'
        }`}
        aria-hidden="true"
      />

      {/* Body */}
      <div className="flex-1 min-w-0">
        <div
          className={`text-[12.5px] font-mono truncate ${
            active ? 'text-primary font-medium' : 'text-foreground'
          }`}
        >
          {displayName}
        </div>
        {!isNone && displayDesc && (
          <div className="text-[11px] text-muted-foreground truncate mt-0.5">
            {displayDesc}
          </div>
        )}
      </div>

      {/* Hover actions (hidden when not None — None has no edit/delete) */}
      {!isNone && (
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 shrink-0 transition-opacity">
          {onEdit && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onEdit()
              }}
              aria-label={t('styleSheets.edit')}
              data-testid={`style-sheet-edit-${sheet.name}`}
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-card"
            >
              <Pencil size={11} />
            </button>
          )}
          {onDeleteClick && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onDeleteClick()
              }}
              aria-label={t('styleSheets.deleteHint')}
              data-testid={`style-sheet-delete-${sheet.name}`}
              className="p-1 rounded text-muted-foreground hover:text-error hover:bg-card"
            >
              <Trash2 size={11} />
            </button>
          )}
        </div>
      )}

      {/* Hover tooltip with full description + body preview — only for
          actual sheets (None has nothing to preview). */}
      {!isNone && sheet && (
        <SheetTooltip sheet={sheet} hovered={hovered} />
      )}
    </div>
  )
}

// ─── Hover tooltip ───────────────────────────────────────────────────────

function SheetTooltip({ sheet, hovered }) {
  const { t } = useTranslation()
  const tooltip = useStyleSheetTooltip(sheet.name)
  const [pos, setPos] = useState(null)

  // Capture position whenever we become visible. We snapshot on the
  // hovered transition (true) — re-running on every render would race
  // the row's own mouseleave and could leave the tooltip stranded.
  useEffect(() => {
    if (!hovered) {
      setPos(null)
      return
    }
    const trigger = document.querySelector(
      `[data-testid="style-sheet-row-${CSS.escape(sheet.name)}"]`
    )
    if (!trigger) return
    const r = trigger.getBoundingClientRect()
    const placeRight = r.right + 8 + TOOLTIP_MAX_W < window.innerWidth
    setPos({
      top: r.top,
      left: placeRight ? r.right + 8 : null,
      right: placeRight ? null : window.innerWidth - r.left + 8,
    })
  }, [hovered, sheet.name])

  if (!hovered || !pos) return null

  const body = tooltip.data?.body || ''
  const placeholderCount = (body.match(/\{prompt\}/g) || []).length

  return createPortal(
    <div
      role="tooltip"
      data-testid={`style-sheet-tooltip-${sheet.name}`}
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left ?? 'auto',
        right: pos.right ?? 'auto',
        maxWidth: TOOLTIP_MAX_W,
        zIndex: 70,
      }}
      className="bg-popover border border-border rounded-[8px] shadow-xl px-3 py-2.5 text-[11.5px] text-foreground"
    >
      <div className="font-mono font-semibold text-[12px] text-foreground mb-1">
        {sheet.name}
      </div>
      {sheet.description && (
        <div className="text-muted-foreground leading-relaxed whitespace-normal mb-1.5">
          {sheet.description}
        </div>
      )}
      {tooltip.loading && (
        <div className="text-[10.5px] text-muted-foreground/70 italic">
          {t('styleSheets.loading')}
        </div>
      )}
      {tooltip.error && (
        <div className="text-[10.5px] text-error italic">
          {t('styleSheets.unavailable')}
        </div>
      )}
      {tooltip.data && (
        <>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 mt-1.5 mb-1">
            {t('styleSheets.bodyPreview')}
          </div>
          <div className="font-mono text-[11px] bg-surface/60 rounded px-2 py-1.5 whitespace-pre-wrap break-words max-h-32 overflow-y-auto">
            {body.slice(0, 400) || t('styleSheets.emptyBody')}
            {body.length > 400 && '…'}
          </div>
          <div className="text-[10px] text-muted-foreground/70 mt-1.5">
            {'{prompt}'} placeholder: {placeholderCount} found · {body.length} chars
          </div>
        </>
      )}
    </div>,
    document.body,
  )
}
