// DocViewer — read-only viewer for MEMORY.md and daily logs.
//
// Two modes:
//   - mode="memory"   → shows the agent's MEMORY.md with the
//                       Hermes-style header + usage line.
//   - mode="daily"    → shows a specific daily log, given date.
//
// Both render the content inside a monospace block with light styling
// (pre-wrap so long lines wrap). For MEMORY, a small header summarises
// the usage percent. For daily, the date is the title.
//
// Edit is intentionally NOT here — the Settings tab has edit buttons
// that go through the PUT endpoint. This viewer is read-only by design
// (memory + daily are append-only by spec).

import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, FileText, Lock } from 'lucide-react'

export default function DocViewer({
  mode,        // "memory" | "daily"
  date,        // YYYY-MM-DD (only for mode="daily")
  file,        // FileStatus-like for memory mode (optional — the
               //   viewer can fetch on its own)
  fetchFn,     // async (date?) => { content, size, char_count?, char_limit? }
  // For "memory" mode, fetchFn() reads MEMORY.md.
  // For "daily"  mode, fetchFn(date) reads daily/{date}.md.
  // We accept both shapes so the parent doesn't need to branch.
}) {
  const { t } = useTranslation()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setData(null)
    fetchFn(mode === 'daily' ? date : null)
      .then((d) => { if (!cancelled) setData(d) })
      .catch((e) => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [mode, date, fetchFn])

  const isMemory = mode === 'memory'
  const title = isMemory
    ? t('agentContext.viewer.memory.title')
    : t('agentContext.viewer.daily.title', { date: date || '' })

  const usageHeader = isMemory && data?.char_count !== undefined && data?.char_limit
    ? t('agentContext.viewer.memory.usageHeader', {
        pct: Math.round((data.char_count / data.char_limit) * 100),
        used: data.char_count,
        limit: data.char_limit,
      })
    : null

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <FileText size={14} className="text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {isMemory && (
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground bg-surface border border-border rounded px-1.5 py-0.5">
              <Lock size={10} /> {t('agentContext.viewer.memory.appendOnly')}
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {loading && (
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground py-8">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        )}

        {error && (
          <div className="text-xs text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg p-3">
            {error}
          </div>
        )}

        {!loading && !error && data && (
          <div className="space-y-3">
            {usageHeader && (
              <div className="text-xs font-mono text-muted-foreground bg-surface border border-border rounded-md px-3 py-2 whitespace-pre-wrap">
                {usageHeader}
              </div>
            )}
            <pre className="
              text-xs font-mono leading-relaxed
              text-foreground
              whitespace-pre-wrap break-words
              bg-surface border border-border rounded-md
              p-4
            ">
              {data.content || (isMemory
                ? t('agentContext.viewer.memory.empty')
                : '—')}
            </pre>
            {data.size !== undefined && (
              <div className="text-[10px] text-muted-foreground text-right">
                {data.size} bytes
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
