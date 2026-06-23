import { FileText, Sparkles } from 'lucide-react'

/**
 * SlashMenu — `/` skills dropdown for the chat/code composer.
 *
 * Visual reference: Claude Code's slash menu. Header row labels the
 * section ("Skills"), each item shows a file icon + bold name + one-line
 * description. Selected item uses a subtle primary tint; unselected uses
 * `hover:bg-surface`. Keyboard navigation (↑/↓/Enter/Esc) is owned by the
 * parent — this component is purely presentational.
 *
 * Props:
 *   - skills:        list of { name, description, source?, ... }
 *   - activeIndex:   currently-highlighted index (keyboard cursor)
 *   - onSelect:      (skill) => void
 *   - onHoverIndex:  (i) => void  — optional hover sync
 *   - size:          'sm' | 'md'  (CodingPanel passes 'sm' for the side chat)
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
  const nameCls = isSm ? 'text-[12.5px] font-semibold font-mono' : 'text-[13px] font-semibold font-mono'
  const descCls = isSm ? 'text-[10.5px] text-muted-foreground truncate' : 'text-[11.5px] text-muted-foreground truncate'
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
      {skills.map((skill, i) => {
        const active = i === activeIndex
        return (
          <div
            key={skill.name}
            onClick={() => onSelect?.(skill)}
            onMouseEnter={() => onHoverIndex?.(i)}
            className={`${itemPx} cursor-pointer flex items-start gap-2.5 ${
              active
                ? 'bg-primary/10 text-foreground'
                : 'text-foreground hover:bg-surface'
            }`}
          >
            <FileText
              size={iconSize}
              className={`shrink-0 mt-0.5 ${active ? 'text-primary' : 'text-muted-foreground'}`}
            />
            <div className="min-w-0 flex-1">
              <div className={`${nameCls} ${active ? 'text-primary' : 'text-foreground'} truncate`}>
                {skill.name}
              </div>
              <div className={descCls}>{skill.description}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
