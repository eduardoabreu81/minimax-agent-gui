import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'

/**
 * SessionActionGuard — reusable confirmation dialog for destructive
 * actions that affect an active agent run (New Chat, conversation
 * switch, delete, workspace change).
 *
 * Props:
 *   open: boolean
 *   title: string
 *   description: string
 *   confirmLabel: string
 *   cancelLabel: string
 *   onConfirm: () => void
 *   onCancel: () => void
 */
export default function SessionActionGuard({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}) {
  const { t } = useTranslation()

  if (!open) return null

  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) onCancel?.()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={handleBackdrop}
    >
      <div className="w-full max-w-sm bg-card border border-border rounded-xl shadow-2xl p-6">
        <div className="flex items-start gap-3 mb-4">
          <div className="shrink-0 w-8 h-8 rounded-full bg-amber-500/10 flex items-center justify-center">
            <AlertTriangle size={16} className="text-amber-500" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground mb-1">
              {title || t('agentRuns.destructiveTitle', 'Stop the active agent?')}
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {description || t('agentRuns.destructiveDescription', 'This action will stop the current run and discard in-flight output.')}
            </p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors rounded-lg"
          >
            {cancelLabel || t('agentRuns.stay', 'Keep running')}
          </button>
          <button
            onClick={onConfirm}
            className="px-3 py-1.5 text-xs font-medium text-white bg-red-500 hover:bg-red-600 transition-colors rounded-lg"
          >
            {confirmLabel || t('agentRuns.stopAndContinue', 'Stop and continue')}
          </button>
        </div>
      </div>
    </div>
  )
}
