import { useState, useEffect, useRef } from 'react'
import { ChevronDown, ChevronRight, Loader2, Brain, AlertCircle } from 'lucide-react'
import { useSessionTokens } from '../../context/SessionTokensContext'
import { useAgentActivity } from '../../context/AgentActivityContext'
import { getContextLimit, formatTokenCount, formatTokenCountExact, formatByteCount, DEFAULT_MODEL } from '../../lib/modelLimits'
import { apiFetch } from '../../lib/api.js'

// StatusBar — global footer anchored above the bottom of the app.
// Layout (left → right), matches the Claude Code reference:
//   ┌──────────────────────────────────────────────────────────────────────────────────┐
//   │ ● Connected │ git   ctx  │  Model ▼  Thinking ▢▢  ● Orb                          │
//   └──────────────────────────────────────────────────────────────────────────────────┘
//   - Connectivity chip (single dot, polls /api/minimax/quota)
//   - Context chip: shows input tokens / limit in bar; popover merges
//     context + Token Plan (5h limit + weekly) — Claude Code style
//   - Model picker: custom button + popover (NOT native <select>)
//   - Thinking toggle: button with inline switch visual (M3 only)
//   - Agent status: conic-gradient orb + label

function Popover({ open, onClose, anchorRef, children, width = 280, align = 'right' }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target) &&
          anchorRef?.current && !anchorRef.current.contains(e.target)) {
        onClose()
      }
    }
    const escHandler = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', escHandler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', escHandler)
    }
  }, [open, onClose, anchorRef])
  if (!open) return null
  const alignStyle = align === 'right' ? 'right-0' : 'left-0'
  return (
    <div
      ref={ref}
      style={{ width }}
      className={`absolute bottom-full mb-1.5 ${alignStyle} bg-card border border-border rounded-[13px] shadow-2xl overflow-hidden z-50`}
    >
      {children}
    </div>
  )
}

function formatResetTime(ms) {
  if (!ms || ms <= 0) return ''
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

// ─────────────────────────────────────────────────────────────────────────────
// Plan usage parsing — mirrors the QuotaDashboard logic so the popover
// shows the same model breakdown as the sidebar widget.
// ─────────────────────────────────────────────────────────────────────────────

const OFFICIAL_MODELS = [
  { match: 'general', label: 'Text (M-series)', desc: 'Chat', interval: '5h', group: 'text', hasWeekly: true, plan: 'plus' },
  { match: 'image',   label: 'Image-01',        desc: 'Image gen', interval: '24h', group: 'daily', plan: 'plus' },
  { match: 'speech',  label: 'Speech 2.8',      desc: 'TTS',       interval: '24h', group: 'daily', plan: 'plus' },
  { match: 'music',   label: 'Music-2.6',       desc: 'Music gen', interval: '24h', group: 'daily', plan: 'plus' },
  { match: 'video',   label: 'Hailuo Video',    desc: 'Video gen', interval: '24h', group: 'daily', plan: 'max'  },
]
const PLAN_LABEL = { plus: 'Plus', max: 'Max', ultra: 'Ultra' }
const PLAN_ORDER = { plus: 0, max: 1, ultra: 2 }

function parseQuota(envelope, userPlan) {
  const data = envelope?.data
  const userPlanLevel = PLAN_ORDER[userPlan] ?? 0
  const quotaByName = new Map()
  for (const item of data?.model_remains || []) {
    const n = (item.model_name || '').toLowerCase()
    if (n) quotaByName.set(n, item)
  }
  return OFFICIAL_MODELS.map(meta => {
    if (PLAN_ORDER[meta.plan || 'plus'] > userPlanLevel) return null
    const item = quotaByName.get(meta.match)
      || Array.from(quotaByName.entries()).find(([n]) => n.startsWith(meta.match + '-'))?.[1]
    if (item) {
      const status = Number(item.current_interval_status ?? item.current_weekly_status)
      if (status === 3) return null
      const remainingPct = item.current_interval_remaining_percent || 0
      const usedPct = Math.max(0, Math.min(100, 100 - remainingPct))
      return {
        key: meta.match,
        name: meta.label,
        desc: meta.desc,
        group: meta.group,
        usedPct,
        resetMs: item.remains_time || 0,
        weeklyPct: meta.hasWeekly ? Math.max(0, Math.min(100, 100 - (item.current_weekly_remaining_percent || 0))) : null,
      }
    }
    return { key: meta.match, name: meta.label, desc: meta.desc, group: meta.group, available: true }
  }).filter(Boolean)
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared "useQuota" hook — used by ContextChip (full popover) and can be
// reused elsewhere if more status widgets get added later.
// ─────────────────────────────────────────────────────────────────────────────

function useQuota() {
  const [data, setData] = useState(null)
  const [userPlan, setUserPlan] = useState('plus')
  useEffect(() => {
    let cancelled = false
    const fetchIt = async () => {
      try {
        const res = await apiFetch('/api/minimax/quota')
        const json = await res.json()
        console.log('[useQuota] fetch result:', { ok: res.ok, status: res.status, success: json?.success, plan: json?.plan, hasData: !!json?.data, modelCount: json?.data?.model_remains?.length, error: json?.error })
        if (!cancelled && json.success) {
          setData(json)
          const plan = (json?.plan || '').toLowerCase()
          if (PLAN_ORDER[plan] !== undefined) setUserPlan(plan)
        } else if (!cancelled && json.error) {
          console.warn('[useQuota] backend returned error:', json.error)
        }
      } catch (e) {
        console.warn('[useQuota] fetch threw:', e?.message || e)
      }
    }
    fetchIt()
    const iv = setInterval(fetchIt, 60000)
    return () => { cancelled = true; clearInterval(iv) }
  }, [])
  return { data, userPlan, items: data ? parseQuota(data, userPlan) : [] }
}

// ─────────────────────────────────────────────────────────────────────────────
// ConnectionChip — multi-dot status indicator. Each dot has its own color
// and title; the design shows Connected + Live as a pair.
// ─────────────────────────────────────────────────────────────────────────────

function ConnectionChip() {
  const [status, setStatus] = useState('checking')
  useEffect(() => {
    let cancelled = false
    const check = async () => {
      try {
        const res = await apiFetch('/api/minimax/quota', { method: 'GET' })
        if (!cancelled) setStatus(res.ok ? 'online' : 'offline')
      } catch {
        if (!cancelled) setStatus('offline')
      }
    }
    check()
    const iv = setInterval(check, 30000)
    return () => { cancelled = true; clearInterval(iv) }
  }, [])

  // Single dot for simplicity, matches the design's "● Connected" pattern.
  // Could be expanded to a list of subsystems later.
  const dotColor =
    status === 'online' ? 'bg-success' :
    status === 'checking' ? 'bg-amber-400' :
    'bg-error'
  const label =
    status === 'online' ? 'Connected' :
    status === 'checking' ? 'Connecting…' :
    'Offline'
  return (
    <div className="flex items-center gap-1.5 text-muted-foreground" title={label}>
      <span className={`w-[7px] h-[7px] rounded-full ${dotColor}`} />
      <span className="text-[11.5px]">{label}</span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ContextChip — single button with mini progress bar. Opens popover that
// merges context-window breakdown with Token Plan usage (5h + weekly).
// Matches the Claude Code reference: bar shows only context, popover
// reveals plan on click.
// ─────────────────────────────────────────────────────────────────────────────

// Plan bar color — based on the % REMAINING (not the % used), so
// the bar goes red when the user is about to run out rather than
// after they're already at 90% used. Thresholds match the daily
// wrap decision: 5% left = critical, 20% left = warning.
// Exported for unit testing (see StatusBar.test.jsx).
export const planBarColor = (pct) => {
  if (pct === null) return 'bg-muted'
  const remaining = 100 - pct
  if (remaining <= 5) return 'bg-error'
  if (remaining <= 20) return 'bg-amber-400'
  return 'bg-primary'
}

// Plan usage text state — mirrors the bar color. The popover
// renderer uses this to pick the bold/weight + icon treatment.
// Exported for unit testing.
export const planTextState = (pct) => {
  if (pct === null) return 'normal'
  const remaining = 100 - pct
  if (remaining <= 5) return 'critical'
  if (remaining <= 20) return 'warning'
  return 'normal'
}

// Context window bar — continuous gradient from green → amber → red
// as the user fills the model context window. Width is set by the
// caller (`width: ${pct}%`); the gradient is fixed and stretches
// with the bar so the visible color at the leading edge always
// reflects the current fill level (50% filled shows ~amber at the
// edge, 95% filled shows ~red).
// Exported for unit testing.
export const contextBarGradient = 'linear-gradient(to right, hsl(142 71% 45%) 0%, hsl(48 96% 53%) 50%, hsl(0 84% 60%) 100%)'

// ExpandableRow — REMOVED in v0.4.x. The 3 per-category expandable
// rows (MCP / Memory / Custom agents) were dropped when the
// breakdown was simplified to 6 flat rows under "Janela de
// contexto". The per-category details still come back from the
// backend in `details.{mcp_tools_list,memory_files_list,custom_agents_list}`
// (kept for future expansion) but the UI no longer renders them.


function ContextChip() {
  const { sessions, activeSessionId } = useSessionTokens()
  const { data: quotaData, items: quotaItems } = useQuota()
  const bucket = activeSessionId ? sessions[activeSessionId] : null
  const modelId = bucket?.lastModel || DEFAULT_MODEL
  const limit = getContextLimit(modelId)

  // Latest turn's input_tokens is what determines "will the next send
  // fit". Cumulative input is also tracked but only used in the popover.
  const used = bucket?.lastTurnInput || bucket?.input_tokens || 0
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0

  console.log('[ContextChip] bucket:', { activeSessionId, bucketExists: !!bucket, lastModel: bucket?.lastModel, lastTurnInput: bucket?.lastTurnInput, inputTokens: bucket?.input_tokens, outputTokens: bucket?.output_tokens, turnCount: bucket?.turnCount, modelId, limit, used, pct })

  // Continuous gradient bar — color at the leading edge reflects the
  // current pct (50% filled shows amber at the edge, 95% shows red).
  const barStyle = { width: `${pct}%`, background: contextBarGradient }

  // Plan usage — pull the text bucket (5h + weekly)
  const textQuota = quotaItems.find(i => i.group === 'text' && !i.available)
  const sessionPct = textQuota?.usedPct ?? null
  const sessionReset = textQuota?.resetMs ?? null
  const weeklyPct = textQuota?.weeklyPct ?? null
  const planLabel = PLAN_LABEL[quotaData?.plan || 'plus'] || 'Plus'
  console.log('[ContextChip] render:', { quotaDataNull: quotaData === null, planLabel, itemCount: quotaItems.length, textQuota: textQuota ? { usedPct: textQuota.usedPct, weeklyPct: textQuota.weeklyPct } : null })

  const anchorRef = useRef(null)
  const [open, setOpen] = useState(false)
  // The 6-row breakdown (Messages / Skills / Memory files / Custom
  // agents / System prompt / MCP tools) defaults to expanded. The
  // user can collapse it via the small chevron next to the section
  // header to focus on just the bar + total. Hidden in the
  // collapsed state to keep the popover compact.
  const [breakdownOpen, setBreakdownOpen] = useState(true)
  // Token breakdown section — collapsed by default. Six rows of
  // raw cache/turn metrics is debug info most users don't need
  // every time they open the popover. Toggle exposes it on demand.
  const [showTokenDetail, setShowTokenDetail] = useState(false)

  return (
    <div className="relative">
      <button
        ref={anchorRef}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 h-[22px] px-2.5 rounded-md hover:bg-secondary hover:text-foreground text-muted-foreground transition-colors"
        title="Context window & plan"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
        </svg>
        {/* Chip stays compact — no unit suffix. The popover header
            below carries the explicit "tokens" unit for users who
            need to know; the bar at the bottom of the screen is
            glanceable space, and the percent + ratio already say
            "context fill" implicitly (title="Context window & plan").
            Edu's v0.4.x feedback: "não precisa colocar 'tokens' na
            barra" — the suffix was visual noise on the chip. */}
        <span className="text-[11.5px] tabular-nums">
          {formatTokenCount(used)} / {formatTokenCount(limit)} ({pct}%)
        </span>
        <span className="w-[42px] h-[5px] rounded-full bg-secondary overflow-hidden inline-block">
          <span className="block h-full transition-all duration-300" style={barStyle} />
        </span>
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} width={320}>
        <div className="p-3.5">
          {/* Section 1 — Context window */}
          <div className="flex items-center justify-between mb-2">
            <span className="text-[12.5px] font-semibold text-foreground">Context window</span>
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {formatTokenCount(used)} / {formatTokenCount(limit)} tokens ({pct}%)
            </span>
          </div>
          <div className="h-2 rounded-full bg-secondary overflow-hidden mb-3">
            <div className="h-full transition-all duration-300" style={barStyle} />
          </div>

          {/* Chevron toggle for the 6-row breakdown below — keeps
              the popover compact when the user just wants the bar.
              Default expanded so the breakdown is visible on first
              open (matches Edu's screenshot). */}
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              By source
            </span>
            <button
              type="button"
              onClick={() => setBreakdownOpen((v) => !v)}
              data-testid="breakdown-toggle"
              aria-expanded={breakdownOpen}
              className="p-0.5 rounded hover:bg-surface/60 text-muted-foreground transition-colors"
              title={breakdownOpen ? 'Hide breakdown' : 'Show breakdown'}
            >
              {breakdownOpen
                ? <ChevronDown size={12} />
                : <ChevronRight size={12} />}
            </button>
          </div>

          {/* Section 1b — Per-source token breakdown, inlined.
              Edu's v0.4.x feedback: the separate "Breakdown by
              source" panel was redundant — the 6 source rows ARE
              the breakdown, and they belong visually under "Janela
              de contexto" (Portuguese for "Context window" — the
              user is using pt-BR labels in screenshots). So we
              dropped the BreakdownPanel component entirely and
              render the 6 rows directly here.

              The 6 rows (in pt-BR labels):
                Messages       — size in bytes (the user explicitly
                                  asked for "tamanho em bytes" on
                                  Messages specifically, because
                                  that's what the conversation
                                  weighs in memory/disk, not tokens)
                Skills         — tokens
                Memory files   — tokens
                Custom agents  — tokens
                System prompt  — tokens
                MCP tools      — tokens

              The two deferred buckets (mcp_deferred, system_tools_deferred)
              were dropped — they're always 0 today and the user
              didn't want them visible. Backend still returns them
              in the data contract for backwards-compat / future
              use; we just don't render.

              Free space is gone (already removed earlier in v0.4.x). */}
          {breakdownOpen && (() => {
            const bs = bucket?.lastBySource
            if (!bs) return null
            const total = bs.total || 1
            // Per-row config. The Messages row is special — it
            // shows the byte size (from bs.messages_bytes) instead
            // of the token count, per Edu's "tamanho em bytes" ask.
            // All other rows show token counts as before.
            const rows = [
              { key: 'messages',      label: 'Messages',      useBytes: true  },
              { key: 'skills',        label: 'Skills',        useBytes: false },
              { key: 'memory_files',  label: 'Memory files',  useBytes: false },
              { key: 'custom_agents', label: 'Custom agents', useBytes: false },
              { key: 'system_prompt', label: 'System prompt', useBytes: false },
              { key: 'mcp_tools',     label: 'MCP tools',     useBytes: false },
            ]
            return (
              <div className="space-y-1 mt-1">
                {rows.map(({ key, label, useBytes }) => {
                  const tokens = bs[key] || 0
                  const bytes  = bs.messages_bytes || 0
                  const value  = useBytes ? bytes : tokens
                  const rowPct = total > 0 ? (tokens / total) * 100 : 0
                  const display = useBytes
                    ? formatByteCount(bytes)
                    : formatTokenCount(tokens)
                  return (
                    <div key={key} className="flex items-center gap-2 text-[11px]">
                      <span className="w-[88px] text-muted-foreground truncate">{label}</span>
                      <span className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                        <span
                          className="block h-full bg-primary/70 transition-all duration-300"
                          style={{ width: `${Math.min(rowPct, 100)}%` }}
                        />
                      </span>
                      <span className="w-[60px] text-right font-mono tabular-nums text-foreground">
                        {display}
                      </span>
                      <span className="w-[36px] text-right font-mono tabular-nums text-muted-foreground">
                        {rowPct.toFixed(0)}%
                      </span>
                    </div>
                  )
                })}
              </div>
            )
          })()}

          {/* Section 2 — Token Plan (Claude Code style) */}
          <div className="flex items-center justify-between mb-2 pt-2.5 border-t border-border">
            <span className="text-[12.5px] font-semibold text-foreground">Plan usage</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/25 font-medium">
              {planLabel}
            </span>
          </div>

          {quotaData === null ? (
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground py-2">
              <Loader2 size={12} className="animate-spin" /> Connecting to Token Plan…
            </div>
          ) : !textQuota ? (
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground py-2">
              Plan data unavailable
            </div>
          ) : (
            <div className="space-y-2.5">
              {/* 5-hour session limit */}
              {(() => {
                const sessionState = planTextState(sessionPct)
                const sessionTextClass =
                  sessionState === 'critical' ? 'text-error font-semibold' :
                  sessionState === 'warning'  ? 'text-amber-600 dark:text-amber-400 font-semibold' :
                                                 'text-muted-foreground'
                return (
                  <div>
                    <div className="flex items-baseline justify-between mb-1.5">
                      <span className="text-[12px] font-semibold text-foreground">5-hour limit</span>
                      <span className={`inline-flex items-center gap-1 text-[11px] tabular-nums ${sessionTextClass}`}>
                        {sessionState !== 'normal' && <AlertCircle size={11} />}
                        Resets in {formatResetTime(sessionReset)} · {100 - sessionPct}% left
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                      <div
                        className={`h-full ${planBarColor(sessionPct)} transition-all duration-300`}
                        style={{ width: `${sessionPct}%` }}
                      />
                    </div>
                  </div>
                )
              })()}
              {/* Weekly */}
              {weeklyPct !== null && (() => {
                const weeklyState = planTextState(weeklyPct)
                const weeklyTextClass =
                  weeklyState === 'critical' ? 'text-error font-semibold' :
                  weeklyState === 'warning'  ? 'text-amber-600 dark:text-amber-400 font-semibold' :
                                                 'text-muted-foreground'
                return (
                  <div>
                    <div className="flex items-baseline justify-between mb-1.5">
                      <span className="text-[12px] font-semibold text-foreground">Weekly · all models</span>
                      <span className={`inline-flex items-center gap-1 text-[11px] tabular-nums ${weeklyTextClass}`}>
                        {weeklyState !== 'normal' && <AlertCircle size={11} />}
                        {100 - weeklyPct}% left
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                      <div
                        className={`h-full ${planBarColor(weeklyPct)} transition-all duration-300`}
                        style={{ width: `${weeklyPct}%` }}
                      />
                    </div>
                  </div>
                )
              })()}
            </div>
          )}

          {/* Section 3 — Per-token detail (debug). Hidden by default
              because the six rows of cache/turn metrics are noise
              for normal use. A small "Show details" toggle at the
              bottom of the popover reveals them on demand. */}
          {bucket && (
            <div className="mt-3 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setShowTokenDetail((v) => !v)}
                data-testid="token-detail-toggle"
                aria-expanded={showTokenDetail}
                className="
                  w-full flex items-center justify-between
                  text-[10.5px] text-muted-foreground
                  hover:text-foreground transition-colors
                  py-1 px-1 rounded
                "
              >
                <span className="font-medium uppercase tracking-wider">
                  {showTokenDetail ? 'Hide token details' : 'Show token details'}
                </span>
                {showTokenDetail
                  ? <ChevronDown size={11} />
                  : <ChevronRight size={11} />}
              </button>
              {showTokenDetail && (
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                  <span className="text-muted-foreground">Input (this turn)</span>
                  <span className="font-mono tabular-nums text-right text-foreground">{formatTokenCountExact(bucket?.lastTurnInput)}</span>
                  <span className="text-muted-foreground">Input (cumulative)</span>
                  <span className="font-mono tabular-nums text-right text-foreground">{formatTokenCountExact(bucket?.input_tokens)}</span>
                  <span className="text-muted-foreground">Cache read</span>
                  <span className="font-mono tabular-nums text-right text-foreground">{formatTokenCountExact(bucket?.cache_read_input_tokens)}</span>
                  <span className="text-muted-foreground">Cache write</span>
                  <span className="font-mono tabular-nums text-right text-foreground">{formatTokenCountExact(bucket?.cache_creation_input_tokens)}</span>
                  <span className="text-muted-foreground">Output (cumulative)</span>
                  <span className="font-mono tabular-nums text-right text-foreground">{formatTokenCountExact(bucket?.output_tokens)}</span>
                  <span className="text-muted-foreground">Turns</span>
                  <span className="font-mono tabular-nums text-right text-foreground">{bucket?.turnCount || 0}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </Popover>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ModelPicker — custom button + popover listing the chat models. Replaces
// the native <select> dropdown with a styled list matching the design.
// ─────────────────────────────────────────────────────────────────────────────

const CHAT_MODELS = [
  { id: 'MiniMax-M3', label: 'MiniMax M3', desc: '1M context · agentic · multimodal' },
  { id: 'MiniMax-M2.7', label: 'MiniMax M2.7', desc: 'Balanced reasoning · 200k context' },
  { id: 'MiniMax-M2.7-highspeed', label: 'M2.7 Highspeed', desc: 'Lowest latency · 200k context' },
]

function ModelPicker({ model, setModel }) {
  const anchorRef = useRef(null)
  const [open, setOpen] = useState(false)

  const current = CHAT_MODELS.find(m => m.id === model) || CHAT_MODELS[0]

  // Pick a new model and persist to backend so WorkspaceSidebar (and any
  // other place that reads `agent.model` via useSelectedModel) reflects
  // the change immediately. The frontend localStorage is the source of
  // truth for the next message's payload, but the backend stays in
  // sync so the saved-default and any other consumers stay consistent.
  const changeModel = async (newId) => {
    setModel(newId)
    setOpen(false)
    try {
      await apiFetch('/api/config/agent', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: newId }),
      })
      // Broadcast so consumers using useSelectedModel can refetch without
      // waiting for the next window-focus tick.
      window.dispatchEvent(new CustomEvent('minimax:config-changed', { detail: { model: newId } }))
    } catch (e) {
      // Backend unreachable (e.g. dev without server). The frontend
      // localStorage state is already updated, so the next send still
      // uses the new model. Surface the error quietly — the Settings
      // page is the proper place to diagnose backend connectivity.
      console.warn('[StatusBar] model sync to /api/config failed:', e?.message || e)
    }
  }

  return (
    <div className="relative">
      <button
        ref={anchorRef}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 h-[22px] px-2 rounded-md hover:bg-secondary text-foreground transition-colors text-[11.5px] font-medium"
        title="Select chat model"
      >
        {/* Hexagon icon (matches design's M3 model mark) */}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="hsl(var(--primary))" strokeWidth="2">
          <path d="M12 3 4 9v6l8 6 8-6V9z" />
        </svg>
        <span>{current.label}</span>
        <ChevronDown size={11} className="text-muted-foreground" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} width={256}>
        <div className="p-1.5">
          {CHAT_MODELS.map((m) => {
            const active = model === m.id
            return (
              <button
                key={m.id}
                onClick={() => changeModel(m.id)}
                className={`w-full flex items-center justify-between gap-3 px-2.5 py-2 rounded-[9px] text-left transition-colors ${
                  active ? 'bg-primary/10' : 'hover:bg-surface'
                }`}
              >
                <div className="flex flex-col items-start gap-0.5">
                  <span className={`text-[12.5px] font-semibold ${active ? 'text-primary' : 'text-foreground'}`}>
                    {m.label}
                  </span>
                  <span className="text-[11px] text-muted-foreground">{m.desc}</span>
                </div>
                {/* Active dot */}
                <span
                  className={`shrink-0 w-2 h-2 rounded-full border-[1.5px] ${
                    active ? 'border-primary bg-primary' : 'border-border bg-transparent'
                  }`}
                />
              </button>
            )
          })}
        </div>
      </Popover>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ThinkingToggle — button that visually contains a switch. The whole
// button is clickable; the switch is just visual feedback for the state.
// Hidden entirely when the active model doesn't support thinking.
// ─────────────────────────────────────────────────────────────────────────────

function ThinkingToggle({ thinkingEnabled, setThinkingEnabled, supportsThinking }) {
  if (!supportsThinking) return null
  const knobLeft = thinkingEnabled ? 'left-[17px]' : 'left-[1.5px]'
  const trackBg = thinkingEnabled ? 'bg-primary' : 'bg-secondary'
  const label = thinkingEnabled ? 'Thinking' : 'Thinking off'
  return (
    <button
      type="button"
      onClick={() => setThinkingEnabled(!thinkingEnabled)}
      title={thinkingEnabled ? 'Thinking: ON' : 'Thinking: OFF'}
      className={`flex items-center gap-1.5 h-[22px] px-2 rounded-md transition-colors ${
        thinkingEnabled
          ? 'bg-primary/10 text-primary hover:bg-primary/15'
          : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
      }`}
    >
      <Brain size={13} />
      <span className="text-[11.5px] font-medium">{label}</span>
      {/* Inline switch visual */}
      <span className={`relative w-[34px] h-[18px] rounded-full transition-colors ${trackBg}`}>
        <span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-all ${knobLeft}`} />
      </span>
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// AgentStatus — conic-gradient spinner + label. Active when AgentActivity
// context says thinking/steps running; idle otherwise.
// ─────────────────────────────────────────────────────────────────────────────

function AgentStatus() {
  const { thinking, steps } = useAgentActivity()
  const active = thinking.active || steps.some((s) => s.status === 'running')
  const color = active ? 'text-success' : 'text-muted-foreground'
  return (
    <div
      title={active ? 'Agent is processing' : 'Agent idle'}
      className="flex items-center gap-1.5 h-[22px] px-2 rounded-md text-[11.5px] font-medium"
    >
      <span
        className="w-[13px] h-[13px] rounded-full"
        style={{
          background: active
            ? 'conic-gradient(from 0deg, hsl(var(--primary)), hsl(var(--success)), hsl(var(--primary)))'
            : 'hsl(var(--muted))',
          animation: active ? 'mmpulse 1.6s ease-in-out infinite' : 'none',
        }}
      />
      <span className={color}>{active ? 'Agent running' : 'Agent idle'}</span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Top-level StatusBar — mounted by App.jsx below the main panel.
// ─────────────────────────────────────────────────────────────────────────────

export default function StatusBar({
  model,
  setModel,
  thinkingEnabled,
  setThinkingEnabled,
  supportsThinking,
}) {
  return (
    <footer className="h-[30px] flex-none border-t border-border bg-surface/95 backdrop-blur-sm flex items-center justify-between px-3.5 text-foreground relative z-30 select-none">
      {/* Left: connectivity */}
      <div className="flex items-center gap-3.5">
        <ConnectionChip />
        {/* Git branch placeholder — wire to actual branch when available */}
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="6" y1="3" x2="6" y2="15" />
            <circle cx="18" cy="6" r="3" />
            <circle cx="6" cy="18" r="3" />
            <path d="M18 9a9 9 0 0 1-9 9" />
          </svg>
          <span className="text-[11.5px]">main</span>
        </div>
      </div>

      {/* Right: context (popover merges context + plan) | model + thinking + agent */}
      <div className="flex items-center gap-0.5">
        <ContextChip />

        <div className="w-px h-4 bg-border mx-1" />

        <ModelPicker model={model} setModel={setModel} />

        <ThinkingToggle
          thinkingEnabled={thinkingEnabled}
          setThinkingEnabled={setThinkingEnabled}
          supportsThinking={supportsThinking}
        />

        <div className="w-px h-4 bg-border mx-1" />

        <AgentStatus />
      </div>
    </footer>
  )
}
