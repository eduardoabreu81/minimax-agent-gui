// IncompleteContextBanner — amber strip across the top of the app
// when one or more .agent files are missing or below the threshold.
//
// Reads the agent_context status from /api/config (via the global
// appConfig if available, else the hook's status). The banner is
// dismissable for the current session — reappears on next launch
// unless the files get filled in.
//
// Three actions:
//   - "Set up now"   → opens the OnboardingWizard (parent must pass
//                       onOpenWizard, which switches the active tab to
//                       'settings' AND opens the wizard modal).
//   - "Open Settings" → switches to the 'settings' tab.
//   - Dismiss (X)    → hides for this session.
//
// Per Agent Context spec §2.3: the banner is a soft prompt, never a
// blocker. The agent still works (graceful degradation) — we just
// make it obvious that personalization will improve the answers.

import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, X, Settings, Sparkles } from 'lucide-react'

export default function IncompleteContextBanner({
  status,                  // { missing, banner_visible, char_usage }
  onOpenSettings,          // () => void — switches tab to settings
  onOpenWizard,            // () => void — opens the wizard modal
}) {
  const { t } = useTranslation()
  const [dismissed, setDismissed] = useState(false)

  // Re-arm the dismiss flag whenever the missing set changes (so a
  // user dismissing the banner sees it again later if they delete
  // a file). Edge case — most users will fill the files in.
  useEffect(() => {
    setDismissed(false)
  }, [status?.missing?.join(',')])

  if (!status || !status.banner_visible || dismissed) return null
  if (!status.missing || status.missing.length === 0) return null

  // Show the first missing file as a representative hint. Multiple
  // missing files is rare (all-or-nothing for the wizard flow) and
  // the banner copy says "context is incomplete" which covers it.
  const firstMissing = status.missing[0]
  const fileLabel = t(`agentContext.banner.file.${firstMissing}`) ||
    firstMissing

  return (
    <div
      role="status"
      aria-live="polite"
      className="
        flex items-center gap-3 px-4 py-2
        bg-amber-500/10 border-b border-amber-500/30
        text-amber-800 dark:text-amber-200
        text-xs
      "
    >
      <AlertTriangle size={14} className="shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="font-medium">{t('agentContext.banner.incomplete')}</span>
        <span className="mx-2 text-amber-700/60 dark:text-amber-300/60">·</span>
        <span className="text-amber-900/80 dark:text-amber-100/80">
          {t('agentContext.banner.missingFile', { file: fileLabel })}
        </span>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {onOpenWizard && (
          <button
            onClick={onOpenWizard}
            className="
              inline-flex items-center gap-1.5
              px-2.5 py-1 rounded-md
              bg-amber-500/20 hover:bg-amber-500/30
              border border-amber-500/40
              text-amber-900 dark:text-amber-100
              font-medium transition-colors
            "
          >
            <Sparkles size={12} />
            {t('agentContext.banner.setUpNow')}
          </button>
        )}
        {onOpenSettings && (
          <button
            onClick={onOpenSettings}
            className="
              inline-flex items-center gap-1.5
              px-2.5 py-1 rounded-md
              hover:bg-amber-500/15
              text-amber-900 dark:text-amber-100
              font-medium transition-colors
            "
          >
            <Settings size={12} />
            {t('agentContext.banner.openSettings')}
          </button>
        )}
        <button
          onClick={() => setDismissed(true)}
          aria-label={t('agentContext.banner.dismiss')}
          className="
            p-1 rounded-md
            hover:bg-amber-500/15
            text-amber-900/70 dark:text-amber-100/70
            transition-colors
          "
        >
          <X size={12} />
        </button>
      </div>
    </div>
  )
}
