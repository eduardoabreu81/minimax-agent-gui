import { X } from 'lucide-react'

/**
 * Shared overlay shell used by both the Image panel and Settings for the
 * inline style-sheet editor. Mirrors the look of the previous
 * ModalShell in StyleSheetsTab.jsx so the visual stays identical.
 *
 * Props:
 *   onClose   — required close handler (also fires on backdrop click + X)
 *   title     — modal heading
 *   subtitle  — optional mono subtitle (e.g. file path)
 *   maxWidth  — tailwind max-width class (default 'max-w-[900px]')
 *   children  — modal body
 */
export default function StyleSheetModal({
  onClose,
  title,
  subtitle,
  maxWidth = 'max-w-[900px]',
  children,
}) {
  return (
    <div
      className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full ${maxWidth} max-h-[90vh] bg-card border border-border rounded-[14px] shadow-2xl overflow-hidden flex flex-col`}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border shrink-0">
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold truncate">{title}</h2>
            {subtitle && <p className="text-[11px] text-muted-foreground font-mono truncate">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-[6px] hover:bg-surface text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  )
}
