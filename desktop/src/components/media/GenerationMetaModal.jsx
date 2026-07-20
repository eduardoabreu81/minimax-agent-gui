import { useState } from 'react'
import { X, Copy, Check, AlertCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { assetUrl } from '../../lib/api.js'

const FALLBACK = '<unset>'

/**
 * Read-only modal showing the prompt + params for one generation.
 *
 * Props:
 *   item     — { name, path, type, meta } from /api/generations
 *   onClose  — () => void
 *
 * The modal displays whatever the backend recorded in the sidecar
 * (prompt + user_prompt + model + params + references + created_at).
 * `meta === null` (older files generated before this feature) renders
 * an empty state explaining there's no saved metadata. Copy buttons
 * write to the system clipboard; if the clipboard API is unavailable
 * the click is a silent no-op.
 */
export default function GenerationMetaModal({ item, onClose }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(null) // 'prompt' | 'json' | null

  const meta = item?.meta
  const mediaUrl = item?.path
    ? assetUrl(`/api/files/download?path=${encodeURIComponent(item.path)}`)
    : null

  const copy = async (which, text) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(which)
      setTimeout(() => setCopied(null), 1500)
    } catch {
      // best-effort — clipboard may be unavailable in some embeds
    }
  }

  const ParamRow = ({ k, v }) => (
    <div className="flex justify-between gap-3 py-1 text-xs">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-mono text-foreground text-right break-all">
        {v === null || v === undefined ? FALLBACK : String(v)}
      </span>
    </div>
  )

  const promptDiffers = meta?.user_prompt && meta.user_prompt !== meta.prompt

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-background border border-border rounded-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border sticky top-0 bg-background z-10">
          <h2 className="text-sm font-semibold text-foreground truncate" title={item?.name}>
            {t('metaModal.title', { defaultValue: 'Generation details' })}
          </h2>
          <button
            onClick={onClose}
            aria-label={t('common.close', { defaultValue: 'Close' })}
            className="p-1.5 rounded-lg hover:bg-surface text-muted-foreground hover:text-foreground flex-shrink-0"
          >
            <X size={16} />
          </button>
        </div>

        {!meta ? (
          <div className="p-6 flex flex-col items-center gap-2 text-muted-foreground">
            <AlertCircle size={20} />
            <p className="text-xs">
              {t('metaModal.empty',
                { defaultValue: 'This generation has no saved metadata.' })}
            </p>
          </div>
        ) : (
          <div className="p-4 space-y-5">
            {/* Media preview */}
            {mediaUrl && item.type === 'image' && (
              <img src={mediaUrl} alt={item.name}
                   className="w-full max-h-48 object-contain rounded-lg border border-border" />
            )}
            {mediaUrl && item.type === 'video' && (
              <video src={mediaUrl} controls className="w-full max-h-48 rounded-lg border border-border" />
            )}
            {mediaUrl && (item.type === 'music' || item.type === 'tts') && (
              <audio src={mediaUrl} controls className="w-full" />
            )}

            {/* Prompt */}
            <section>
              <div className="flex items-center justify-between mb-1.5">
                <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  {t('metaModal.promptSection', { defaultValue: 'Prompt' })}
                </h3>
                <button
                  onClick={() => copy('prompt', meta.prompt || '')}
                  className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                >
                  {copied === 'prompt' ? <Check size={11} /> : <Copy size={11} />}
                  {t('metaModal.copyPrompt', { defaultValue: 'Copy prompt' })}
                </button>
              </div>
              <div className="bg-surface border border-border rounded-lg p-3 text-xs text-foreground whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
                {meta.prompt || FALLBACK}
              </div>
            </section>

            {/* User prompt (only when differs) */}
            {promptDiffers && (
              <section>
                <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">
                  {t('metaModal.userPromptSection', { defaultValue: 'User prompt' })}
                </h3>
                <div className="bg-surface border border-border rounded-lg p-3 text-xs text-foreground whitespace-pre-wrap break-words">
                  {meta.user_prompt}
                </div>
              </section>
            )}

            {/* Model + created */}
            <section className="grid grid-cols-2 gap-3">
              <ParamRow k={t('metaModal.modelLabel', { defaultValue: 'Model' })} v={meta.model} />
              <ParamRow k={t('metaModal.createdAtLabel', { defaultValue: 'Created' })}
                        v={meta.created_at ? new Date(meta.created_at).toLocaleString() : null} />
            </section>

            {/* Params */}
            {meta.params && Object.keys(meta.params).length > 0 && (
              <section>
                <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">
                  {t('metaModal.paramsSection', { defaultValue: 'Parameters' })}
                </h3>
                <div className="bg-surface border border-border rounded-lg p-3">
                  {Object.entries(meta.params).map(([k, v]) => (
                    <ParamRow key={k} k={k} v={typeof v === 'object' ? JSON.stringify(v) : v} />
                  ))}
                </div>
              </section>
            )}

            {/* References */}
            {meta.references && Object.keys(meta.references).length > 0 && (
              <section>
                <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">
                  {t('metaModal.referencesSection', { defaultValue: 'References' })}
                </h3>
                <div className="bg-surface border border-border rounded-lg p-3 space-y-1">
                  {Object.entries(meta.references).map(([k, v]) => (
                    <ParamRow
                      key={k}
                      k={k}
                      v={v === null
                        ? t('metaModal.manualUpload',
                            { defaultValue: 'Manual upload — not persisted' })
                        : (Array.isArray(v) ? (v.join(', ') || '—') : v)}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Copy full JSON */}
            <div className="pt-2 border-t border-border">
              <button
                onClick={() => copy('json', JSON.stringify(meta, null, 2))}
                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
              >
                {copied === 'json' ? <Check size={11} /> : <Copy size={11} />}
                {t('metaModal.copyJson', { defaultValue: 'Copy full JSON' })}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
