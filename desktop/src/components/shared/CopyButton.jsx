import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy } from 'lucide-react'

/**
 * CopyButton — small icon button that copies text to the clipboard
 * and shows a brief "Copied!" confirmation.
 *
 * Used on chat/code assistant messages (and can be used on user
 * messages too) so the user can grab the response as Markdown
 * source and paste it into a doc, chat, or other tool.
 */
export default function CopyButton({ text, label, className = '' }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const effectiveLabel = label || t('common.copyMessage')

  const handleCopy = useCallback(async () => {
    if (!text) return
    try {
      // Modern Clipboard API; falls back to the legacy execCommand
      // path if the browser blocks it (e.g. insecure context).
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text)
      } else {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        ta.setSelectionRange(0, ta.value.length)
        document.execCommand('copy')
        document.body.removeChild(ta)
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch (e) {
      // Swallow — the UI doesn't need to throw on a copy failure,
      // and the fallback path is best-effort.
      console.warn('Copy failed:', e)
    }
  }, [text])

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? t('common.copied') : effectiveLabel}
      aria-label={effectiveLabel}
      className={`flex items-center gap-1 px-1.5 py-0.5 rounded
                  text-muted-foreground hover:text-foreground hover:bg-surface
                  transition-colors
                  ${className}`}
    >
      {copied ? (
        <>
          <Check size={11} className="text-success" />
          <span className="text-[10px] font-medium text-success">{t('common.copied')}</span>
        </>
      ) : (
        <Copy size={11} />
      )}
    </button>
  )
}
