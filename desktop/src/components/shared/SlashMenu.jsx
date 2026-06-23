import { FileText, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * SlashMenu — `/` skills dropdown for the chat/code composer.
 *
 * Visual reference: Claude Code's slash menu. Each item is a single
 * line: ``<name> - <description>``, truncated together. Hovering an
 * item whose description was truncated shows a portal-rendered
 * tooltip card to the right of the dropdown (or to the left if the
 * dropdown is near the right edge of the viewport) with the full
 * description.
 *
 * Props:
 *   - skills:        list of { name, description, ... }
 *   - activeIndex:   currently-highlighted index (keyboard cursor)
 *   - onSelect:      (skill) => void
 *   - onHoverIndex:  (i) => void  — optional hover sync
 *   - size:          'sm' | 'md'  (CodingPanel side chat uses 'sm')
 */
export default function SlashMenu({
  skills,
  activeIndex = 0,
  onSelect,
  onHoverIndex,
  size = 'md',
}) {
  if (!skills || skills.length === 0) return null

  const isSm = size === 'sm'
  const itemPx = isSm ? 'px-2.5 py-1.5' : 'px-3 py-2'
  const nameCls = isSm
    ? 'text-[12.5px] font-semibold font-mono shrink-0'
    : 'text-[13px] font-semibold font-mono shrink-0'
  const descCls = isSm
    ? 'text-[11px] text-muted-foreground truncate min-w-0'
    : 'text-[11.5px] text-muted-foreground truncate min-w-0'
  const iconSize = isSm ? 12 : 13
  const headerCls = isSm
    ? 'px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border'
    : 'px-3 py-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border'
  const containerCls = isSm
    ? 'absolute bottom-full left-0 w-full bg-card border border-border rounded-lg shadow-lg z-50 mb-1 max-h-64 overflow-y-auto'
    : 'absolute bottom-full left-0 w-full bg-card border border-border rounded-xl shadow-lg z-50 mb-1.5 max-h-72 overflow-y-auto py-0.5'

  return (
    <div className={containerCls}>
      <div className={headerCls}>
        <div className="flex items-center gap-1.5">
          <Sparkles size={iconSize} className="text-primary" />
          <span>Skills</span>
        </div>
      </div>
      {skills.map((skill, i) => (
        <SlashMenuItem
          key={skill.name}
          skill={skill}
          index={i}
          active={i === activeIndex}
          size={size}
          itemPx={itemPx}
          nameCls={nameCls}
          descCls={descCls}
          iconSize={iconSize}
          onSelect={onSelect}
          onHoverIndex={onHoverIndex}
        />
      ))}
    </div>
  )
}

// ─── Single item + portal-rendered hover tooltip ──────────────────────────

const TOOLTIP_MAX_W = 360

function SlashMenuItem({
  skill, index, active, size,
  itemPx, nameCls, descCls, iconSize,
  onSelect, onHoverIndex,
}) {
  const itemRef = useRef(null)
  const descRef = useRef(null)
  const [tooltip, setTooltip] = useState(null)  // {top, side, name, desc} | null

  // Decide if the description actually overflows (only show tooltip when it did).
  // We measure the inner <span> against its parent at hover time.
  const measureAndShow = () => {
    onHoverIndex?.(index)
    const el = itemRef.current
    const descEl = descRef.current
    if (!el || !descEl) return
    const overflowed = descEl.scrollWidth > descEl.clientWidth
    if (!overflowed) {
      setTooltip(null)
      return
    }
    const r = el.getBoundingClientRect()
    // Place tooltip to the right of the item unless that would push it off-screen.
    const placeRight = r.right + 8 + TOOLTIP_MAX_W < window.innerWidth
    setTooltip({
      top: r.top,
      left: placeRight ? r.right + 8 : null,
      right: placeRight ? null : window.innerWidth - r.left + 8,
      name: skill.name,
      desc: skill.description,
    })
  }

  const handleLeave = () => setTooltip(null)

  return (
    <>
      <div
        ref={itemRef}
        onClick={() => onSelect?.(skill)}
        onMouseEnter={measureAndShow}
        onMouseLeave={handleLeave}
        className={`${itemPx} cursor-pointer flex items-center gap-2 ${
          active
            ? 'bg-primary/10 text-foreground'
            : 'text-foreground hover:bg-surface'
        }`}
      >
        <FileText
          size={iconSize}
          className={`shrink-0 ${active ? 'text-primary' : 'text-muted-foreground'}`}
        />
        <span className={`${nameCls} ${active ? 'text-primary' : 'text-foreground'}`}>
          {skill.name}
        </span>
        <span className="text-muted-foreground/70 shrink-0">—</span>
        <span ref={descRef} className={descCls}>
          {skill.description}
        </span>
      </div>
      {tooltip && createPortal(
        <div
          role="tooltip"
          style={{
            position: 'fixed',
            top: tooltip.top,
            left: tooltip.left ?? 'auto',
            right: tooltip.right ?? 'auto',
            maxWidth: TOOLTIP_MAX_W,
            zIndex: 9999,
          }}
          className="bg-popover border border-border rounded-[8px] shadow-xl px-3 py-2 text-[11.5px] text-foreground"
        >
          <div className="font-semibold font-mono text-[12px] mb-1 text-foreground">
            {tooltip.name}
          </div>
          <div className="text-muted-foreground leading-relaxed whitespace-normal">
            {tooltip.desc}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
