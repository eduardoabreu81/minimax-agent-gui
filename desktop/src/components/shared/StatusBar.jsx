import { useState, useEffect, useRef } from 'react'
import { ChevronDown, ChevronRight, Loader2, Brain, AlertCircle } from 'lucide-react'
import { useSessionTokens } from '../../context/SessionTokensContext'
import { useAgentActivity } from '../../context/AgentActivityContext'
import { getContextLimit, formatTokenCount, formatTokenCountExact, DEFAULT_MODEL } from '../../lib/modelLimits'
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

// BreakdownPanel — the 9-row summary + 3 expandable sub-sections
// inside the context popover. Extracted from ContextChip so it can
// be unit-tested in isolation (see StatusBar.test.jsx) and so the
// JSX inside ContextChip stays readable.
//
// Visual layout (matches the Claude Code reference):
//
//   COLLAPSED (default):
//   ┌──────────────────────────────────────────────────────┐
//   │ Breakdown by source                        718.2k  v  │
//   └──────────────────────────────────────────────────────┘
//
//   EXPANDED (click the header):
//   ┌──────────────────────────────────────────────────────┐
//   │ Breakdown by source                        718.2k  ^  │
//   │ ──────────────────────────────────────────────────── │
//   │ Messages              ▰▰▰▰▰▰▰▰▰▰▰▰▰▱▱▱ 718.2k  72% │
//   │ Skills                ▰▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱  30.1k   3% │
//   │ Memory files          ▰▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱   7.4k   1% │
//   │ Custom agents         ▰▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱   5.1k   1% │
//   │ System prompt         ▰▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱   2.8k   0% │
//   │ MCP tools             ▰▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱   171    0% │
//   │ MCP tools (deferred)  ▰▰▱▱▱▱▱▱▱▱▱▱▱▱▱  22.8k   2% │
//   │ System tools (defer.) ▰▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱  14.5k   2% │
//   │ Free space            ▰▰▰▰▰▱▱▱▱▱▱▱▱▱▱ 236.3k  24% │
//   ├──────────────────────────────────────────────────────┤
//   │ > MCP tools                  23.0k    85 tools      │
//   │ > Memory files                7.4k    12 files      │
//   │ > Custom agents               5.1k    60 agents     │
//   └──────────────────────────────────────────────────────┘
//
// Exported for unit testing.
export function BreakdownPanel({ bySource }) {
  // Outer collapse: hides the entire 9-row + 3-expandable list. The
  // 3 in-list expandables are tracked separately so a user can
  // expand a section WITHOUT first expanding the parent — useful
  // when a user knows exactly which section they want to inspect.
  const [outerOpen, setOuterOpen] = useState(false)
  const [expanded, setExpanded] = useState({ mcp: false, memory: false, agents: false })

  // Hide the whole panel if the backend hasn't sent a breakdown yet.
  if (!bySource) return null
  const total = bySource.total || 1
  const pct = (n) => total > 0 ? (n / total) * 100 : 0

  // Order matches the design (heaviest first). No "free space" row —
  // the user explicitly didn't want it (the design doesn't have a
  // bucket for "context I haven't used yet", and reporting a
  // derived value like `limit - total` made the dominant-row
  // detection pick free_space whenever it dwarfed everything else,
  // producing nonsense headers like "Free space · 198k (10734%)").
  const rows = [
    { key: 'messages',              label: 'Messages' },
    { key: 'skills',                label: 'Skills' },
    { key: 'memory_files',          label: 'Memory files' },
    { key: 'custom_agents',         label: 'Custom agents' },
    { key: 'system_prompt',         label: 'System prompt' },
    { key: 'mcp_tools',             label: 'MCP tools' },
    { key: 'mcp_deferred',          label: 'MCP tools (deferred)' },
    { key: 'system_tools_deferred', label: 'System tools (deferred)' },
  ]

  // The dominant row (heaviest bucket) — shown in the collapsed
  // header so the user still sees "what's filling my context"
  // without expanding. Defaults to the first row if every bucket
  // is 0 (would otherwise crash on the empty `acc`).
  const dominant = rows.reduce(
    (acc, r) => ((bySource[r.key] || 0) > (bySource[acc.key] || 0) ? r : acc),
    rows[0],
  )
  const dominantTokens = bySource[dominant.key] || 0
  const dominantPct = pct(dominantTokens)

  const details = bySource.details || {}
  const mcpList     = details.mcp_tools_list     || []
  const memoryList  = details.memory_files_list  || []
  const agentsList  = details.custom_agents_list || []

  // Per-expandable summary line (sum of tokens + count of items).
  // Pluralize properly — "1 files" looks unprofessional. The helper
  // is local because it's a 3-line function and only used here.
  const plural = (n, singular, pluralForm) =>
    n === 1 ? singular : (pluralForm || singular + 's')
  const summary = {
    mcp:    { tokens: mcpList.reduce((s, x)    => s + (x.tokens || 0), 0), n: mcpList.length,
              label: plural(mcpList.length, 'tool', 'tools') },
    memory: { tokens: memoryList.reduce((s, x) => s + (x.tokens || 0), 0), n: memoryList.length,
              label: plural(memoryList.length, 'file', 'files') },
    agents: { tokens: agentsList.reduce((s, x) => s + (x.tokens || 0), 0), n: agentsList.length,
              label: plural(agentsList.length, 'agent', 'agents') },
  }

  const toggle = (key) => setExpanded((e) => ({ ...e, [key]: !e[key] }))

  return (
    <div className="mb-3">
      {/* Collapsible header — matches the Claude Code reference.
          When collapsed: just the dominant row's name + total +
          chevron (so the user can still tell "what's filling my
          context" without expanding). When expanded: the full
          9-row list + 3 expandable sub-sections. */}
      <button
        type="button"
        onClick={() => setOuterOpen(!outerOpen)}
        data-testid="breakdown-toggle"
        className="w-full flex items-center gap-2 text-left mb-1.5 hover:bg-surface/60 rounded px-1 py-0.5 -mx-1 transition-colors"
        aria-expanded={outerOpen}
      >
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          Breakdown by source
        </span>
        <span className="flex-1 text-[11px] text-foreground">
          {dominant.label}
          <span className="text-muted-foreground tabular-nums">
            {' · '}
            {formatTokenCount(dominantTokens)} ({dominantPct.toFixed(0)}%)
          </span>
        </span>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {formatTokenCount(total)}
        </span>
        {outerOpen
          ? <ChevronDown size={12} className="text-muted-foreground shrink-0" />
          : <ChevronRight size={12} className="text-muted-foreground shrink-0" />}
      </button>

      {outerOpen && (
        <>
          {/* Flat summary list — 8 rows */}
          <div className="space-y-1">
            {rows.map(({ key, label }) => {
              const tokens = bySource[key] || 0
              const rowPct = pct(tokens)
              return (
                <div key={key}>
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="w-[120px] text-muted-foreground truncate">{label}</span>
                    <span className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                      <span
                        className="block h-full bg-primary/70 transition-all duration-300"
                        style={{ width: `${Math.min(rowPct, 100)}%` }}
                      />
                    </span>
                    <span className="w-[52px] text-right font-mono tabular-nums text-foreground">
                      {formatTokenCount(tokens)}
                    </span>
                    <span className="w-[36px] text-right font-mono tabular-nums text-muted-foreground">
                      {rowPct.toFixed(0)}%
                    </span>
                  </div>
                  {/* Subtle hint under Messages — clarifies that the
                      number covers user + assistant + thinking, so
                      the user doesn't think "I sent 2 messages, why
                      is it 598 tokens?" Placed only under Messages
                      since the other rows have unambiguous labels. */}
                  {key === 'messages' && tokens > 0 && (
                    <div className="text-[10px] text-muted-foreground/70 italic pl-[120px] -mt-0.5 mb-0.5">
                      your messages + agent's responses + thinking
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Expandable sub-sections — only render if there's anything to show.
              A backend payload from an older session (no `details`) just
              hides these — no crash. */}
          {(mcpList.length + memoryList.length + agentsList.length) > 0 && (
            <div className="mt-2 pt-2 border-t border-border space-y-1">
              {/* MCP tools (per-server) */}
              {mcpList.length > 0 && (
                <ExpandableRow
                  label="MCP tools"
                  summary={`${formatTokenCount(summary.mcp.tokens)} · ${summary.mcp.n} ${summary.mcp.label}`}
                  expanded={expanded.mcp}
                  onToggle={() => toggle('mcp')}
                  rows={mcpList.map((t) => ({
                    key: `mcp-${t.server_id}`,
                    primary: t.name || t.server_id,
                    secondary: `${t.tool_count} tool${t.tool_count === 1 ? '' : 's'}`,
                    tokens: t.tokens,
                    pct: pct(t.tokens),
                  }))}
                />
              )}

              {/* Memory files */}
              {memoryList.length > 0 && (
                <ExpandableRow
                  label="Memory files"
                  summary={`${formatTokenCount(summary.memory.tokens)} · ${summary.memory.n} ${summary.memory.label}`}
                  expanded={expanded.memory}
                  onToggle={() => toggle('memory')}
                  rows={memoryList.map((t) => ({
                    key: `mem-${t.file}`,
                    primary: t.file,
                    secondary: null,
                    tokens: t.tokens,
                    pct: pct(t.tokens),
                  }))}
                />
              )}

              {/* Custom agents */}
              {agentsList.length > 0 && (
                <ExpandableRow
                  label="Custom agents"
                  summary={`${formatTokenCount(summary.agents.tokens)} · ${summary.agents.n} ${summary.agents.label}`}
                  expanded={expanded.agents}
                  onToggle={() => toggle('agents')}
                  rows={agentsList.map((t) => ({
                    key: `agent-${t.agent}`,
                    primary: t.agent,
                    secondary: null,
                    tokens: t.tokens,
                    pct: pct(t.tokens),
                  }))}
                />
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ExpandableRow — chevron + label + summary on the collapsed row;
// expands to show the child `rows` (each with bar + count + pct).
// Matches the Claude Code design where the chevron rotates and the
// sub-rows slide in below.
function ExpandableRow({ label, summary, expanded, onToggle, rows }) {
  const Chevron = expanded ? ChevronDown : ChevronRight
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        data-testid={`breakdown-expand-${label.toLowerCase().replace(/\s+/g, '-')}`}
        className="w-full flex items-center gap-2 text-[11px] py-0.5 hover:bg-surface/60 rounded transition-colors"
      >
        <Chevron size={12} className="text-muted-foreground shrink-0" />
        <span className="flex-1 text-left text-foreground">{label}</span>
        <span className="text-muted-foreground tabular-nums">{summary}</span>
      </button>
      {expanded && (
        <div className="pl-5 mt-1 space-y-0.5">
          {rows.map((r) => (
            <div key={r.key} className="flex items-center gap-2 text-[10.5px] text-muted-foreground">
              <span className="w-[110px] truncate">{r.primary}</span>
              {r.secondary && (
                <span className="text-[10px] text-muted-foreground/70 tabular-nums">
                  {r.secondary}
                </span>
              )}
              <span className="flex-1 h-1 rounded-full bg-secondary overflow-hidden">
                <span
                  className="block h-full bg-primary/60"
                  style={{ width: `${Math.min(r.pct, 100)}%` }}
                />
              </span>
              <span className="w-[40px] text-right font-mono tabular-nums text-foreground">
                {formatTokenCount(r.tokens)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

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
        {/* Explicit "tokens" suffix — without it "12k / 1.0M"
            reads like 12 kilobytes / 1 megabyte (which is what the
            original Claude Code reference confused the user with).
            Showing the unit removes the ambiguity. */}
        <span className="text-[11.5px] tabular-nums">
          {formatTokenCount(used)} / {formatTokenCount(limit)} <span className="text-muted-foreground">tokens</span> ({pct}%)
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

          {/* Section 1b — Per-source token breakdown (best-effort, from
              Agent.estimate_by_source). Hidden when the backend hasn't
              sent a breakdown yet (older sessions).

              Shape (per the agent.py contract):
                bs = {
                  messages, skills, memory_files, custom_agents,
                  system_prompt, mcp_tools, mcp_deferred,
                  system_tools_deferred, free_space, total, limit,
                  details: {
                    mcp_tools_list:    [{server_id, name, tool_count, tokens}],
                    memory_files_list: [{file, tokens}],
                    custom_agents_list:[{agent, tokens}],
                  },
                }

              Layout matches the Claude Code reference:
                - 9 flat rows (label + bar + count + pct)
                - 3 expandable chevron rows below: MCP tools (with
                  per-server tool_count), Memory files, Custom agents.

              Older payloads without `details` fall back to no
              expandable sections (no crash). */}
          <BreakdownPanel bySource={bucket?.lastBySource} />

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

          {/* Section 3 — Per-token detail (debug) */}
          {bucket && (
            <>
              <div className="text-[12.5px] font-semibold text-foreground mb-2 mt-3 pt-2.5 border-t border-border">
                Token breakdown
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
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
            </>
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
