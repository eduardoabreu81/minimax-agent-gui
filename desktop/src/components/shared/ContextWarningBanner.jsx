// ContextWarningBanner — top-of-chat strip when the active session's
// context window crosses compact thresholds (50% / 80% / 90%).
//
// State-based trigger: reappears on every render where pct >= threshold
// (NOT edge-triggered on crossing). Dismiss hides for the rest of the
// current mount — reload resets state, so if pct is still above the
// threshold after recompute the banner comes back. Analogy: fuel-tank
// pointer marks half-tank every time it's at half, not just once.
//
// Tiers (driven by parent via `level`):
//   - 'warn'  → M3 only. "Context at 50%. Compact now?" + [Compact] opt-in.
//   - 'auto'  → all models. "Context at 80%. Auto-compacting…" + spinner
//               (parent triggers backend compact when the level is reached).
//   - 'max'   → all models. "Context at 90%. Force-compacting…" + spinner
//               (parent already triggered; this is just feedback).
//   - null / off → hidden.
//
// Spec source: AGENTS.local.md §"Context Window — feature spec".

import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, X, Minimize2, AlertTriangle, Zap } from 'lucide-react'

const LEVEL_STYLE = {
  warn: {
    container: 'bg-amber-500/10 border-b border-amber-500/30 text-amber-800 dark:text-amber-200',
    icon:       'text-amber-600 dark:text-amber-300',
    button:     'bg-amber-500/20 hover:bg-amber-500/30 border-amber-500/40 text-amber-900 dark:text-amber-100',
    dismiss:    'hover:bg-amber-500/15 text-amber-900/70 dark:text-amber-100/70',
  },
  auto: {
    container: 'bg-orange-500/10 border-b border-orange-500/30 text-orange-800 dark:text-orange-200',
    icon:       'text-orange-600 dark:text-orange-300',
    button:     'bg-orange-500/20 hover:bg-orange-500/30 border-orange-500/40 text-orange-900 dark:text-orange-100',
    dismiss:    'hover:bg-orange-500/15 text-orange-900/70 dark:text-orange-100/70',
  },
  max: {
    container: 'bg-red-500/15 border-b border-red-500/40 text-red-800 dark:text-red-200',
    icon:       'text-red-600 dark:text-red-300',
    button:     'bg-red-500/20 hover:bg-red-500/30 border-red-500/40 text-red-900 dark:text-red-100',
    dismiss:    'hover:bg-red-500/15 text-red-900/70 dark:text-red-100/70',
  },
}

const LEVEL_COPY = {
  warn: {
    icon: AlertTriangle,
    text: 'contextWindow.warnText',   // "Context at {pct}%. Compact now to free room for the next turn."
    cta:  'contextWindow.compactNow',
  },
  auto: {
    icon: Zap,
    text: 'contextWindow.autoText',   // "Context at {pct}%. Auto-compacting to keep the conversation going."
    cta:  null,                       // no opt-in button — auto fires automatically
  },
  max: {
    icon: Zap,
    text: 'contextWindow.maxText',    // "Context at {pct}%. Forcing compact — turn input will resume when it drops below 90%."
    cta:  null,
  },
}

export default function ContextWarningBanner({
  level,        // 'warn' | 'auto' | 'max' | null
  pct,          // 0..100 number — drives the copy text
  compacting,   // bool — when true, swap the CTA for a spinner ("compacting…")
  onCompact,    // () => void — fired when user clicks [Compact] (warn tier only)
  onDismiss,    // () => void — optional override; defaults to internal state
}) {
  const { t } = useTranslation()
  const [dismissed, setDismissed] = useState(false)

  // Re-arm the dismiss flag whenever the level changes (so a user
  // dismissing the 50% banner doesn't accidentally suppress the 80%
  // one when they cross it later). Per spec: dismissal is in-memory
  // only — reload resets state.
  useEffect(() => {
    setDismissed(false)
  }, [level])

  if (!level || !LEVEL_STYLE[level]) return null
  if (dismissed) return null

  const style = LEVEL_STYLE[level]
  const copy = LEVEL_COPY[level]
  const Icon = copy.icon
  const pctLabel = `${Math.round(pct)}%`

  const handleDismiss = () => {
    setDismissed(true)
    onDismiss?.()
  }

  return (
    <div
      role="status"
      aria-live={level === 'max' ? 'assertive' : 'polite'}
      data-testid={`context-banner-${level}`}
      className={`
        flex items-center gap-3 px-4 py-2
        ${style.container}
        text-xs
      `}
    >
      {compacting ? (
        <Loader2 size={14} className={`${style.icon} animate-spin shrink-0`} />
      ) : (
        <Icon size={14} className={`${style.icon} shrink-0`} />
      )}

      <div className="flex-1 min-w-0">
        <span className="font-medium">
          {t(copy.text, { pct: pctLabel })}
        </span>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {copy.cta && !compacting && onCompact && (
          <button
            onClick={onCompact}
            className={`
              inline-flex items-center gap-1.5
              px-2.5 py-1 rounded-md border
              ${style.button}
              font-medium transition-colors
            `}
          >
            <Minimize2 size={12} />
            {t(copy.cta)}
          </button>
        )}
        {compacting && (
          <span className="text-xs opacity-80">
            {t('contextWindow.compacting')}
          </span>
        )}
        <button
          onClick={handleDismiss}
          aria-label={t('contextWindow.dismiss')}
          className={`p-1 rounded-md transition-colors ${style.dismiss}`}
        >
          <X size={12} />
        </button>
      </div>
    </div>
  )
}
