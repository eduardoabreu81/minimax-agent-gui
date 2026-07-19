import { Brain, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * ThinkingBlock — renders a model's reasoning above the assistant's response.
 *
 * Used in both ChatPanel and CodingPanel. The block is always visible
 * (per user preference) and styled to be visually distinct from the
 * final response without distracting from it.
 */
export default function ThinkingBlock({ thinking, compact = false, streaming = false, className = '' }) {
  const { t } = useTranslation()
  if (!thinking) return null

  const padding = compact ? 'px-2 py-1.5' : 'px-3 py-2'
  const textSize = compact ? 'text-[10px]' : 'text-xs'

  return (
    <div
      className={`${padding} ${textSize} rounded-md
                  bg-primary/5 border border-primary/15
                  text-muted-foreground/90
                  font-mono whitespace-pre-wrap break-words
                  ${className}`}
    >
      <div className="flex items-center gap-1.5 mb-1 text-primary/80 font-semibold">
        {streaming ? <Loader2 size={11} className="animate-spin" /> : <Brain size={11} />}
        <span>{streaming ? t('thinking.streaming') : t('thinking.label')}</span>
      </div>
      <div className="leading-relaxed">{thinking}</div>
    </div>
  )
}
