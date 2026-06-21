import { useState, useEffect } from 'react'
import {
  BarChart3, RefreshCw, AlertCircle, ChevronDown, ChevronUp,
  Zap, Volume2, Image, Music, Video, Globe
} from 'lucide-react'
import { apiFetch, apiWebSocketUrl } from '../lib/api.js'

const OFFICIAL_MODELS = [
  // Token Plan buckets. Every paid tier (Plus/Max/Ultra) includes chat +
  // image + speech + music — those are gated at 'plus'. Video is the
  // only capability that requires Max+ (with a daily cap). The Token
  // Plan dashboard is about *quota*, not about plan-tier UI: when Token Plan API
  // returns quota data for a bucket we render the bar; when it doesn't
  // (media buckets aren't always tracked) we render an "Available" pill.
  // Do NOT add per-model entries for M3 / M2.7 / M2.7-highspeed — they
  // all share the ``general`` quota and show as one row.
  { match: 'general', icon: Zap,     label: 'Text (M-series)', desc: 'Chat',      interval: '5h',  group: 'text',  hasWeekly: true,  plan: 'plus', tracking: 'percent' },
  { match: 'image',   icon: Image,   label: 'Image-01',        desc: 'Image gen', interval: '24h', group: 'daily', hasWeekly: false, plan: 'plus', tracking: 'none'    },
  { match: 'speech',  icon: Volume2, label: 'Speech 2.8',      desc: 'TTS',       interval: '24h', group: 'daily', hasWeekly: false, plan: 'plus', tracking: 'none'    },
  { match: 'music',   icon: Music,   label: 'Music-2.6',       desc: 'Music gen', interval: '24h', group: 'daily', hasWeekly: false, plan: 'plus', tracking: 'none'    },
  { match: 'video',   icon: Video,   label: 'Hailuo Video',    desc: 'Video gen', interval: '24h', group: 'daily', hasWeekly: false, plan: 'max',  tracking: 'count'   },
]

// Plan ordering — used to filter the OFFICIAL_MODELS list to what the
// current user's subscription actually unlocks. There is no "starter"
// tier: Token Plan starts at Plus.
const PLAN_ORDER = { plus: 0, max: 1, ultra: 2 }
const EXCLUDED_NAMES = ['music-2.5', 'music-cover', 'lyrics_generation', 'coding-plan-vlm', 'coding-plan-search']

function formatTime(ms) {
  if (!ms || ms <= 0) return 'soon'
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export default function QuotaDashboard({ compact = false }) {
  const [quota, setQuota] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [region, setRegion] = useState('global')
  const [expanded, setExpanded] = useState(!compact)
  const [textView, setTextView] = useState('5h')

  const fetchQuota = async () => {
    setLoading(true); setError('')
    try {
      const res = await apiFetch('/api/minimax/quota')
      const data = await res.json()
      if (data.success) setQuota(data)  // keep full envelope so parse() can read enriched fields
      else setError(data.error || 'Failed')
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => {
    apiFetch('/api/config').then(r => r.json()).then(d => setRegion(d.region || 'global')).catch(() => {})
    fetchQuota()
    const iv = setInterval(fetchQuota, 60000)
    return () => clearInterval(iv)
  }, [])

  const parse = (envelope) => {
    // ``envelope`` is the full response from /api/minimax/quota (we keep
    // the full shape so we can read the enriched ``plan`` field). The
    // raw Token Plan API data lives under ``envelope.data``.
    const data = envelope?.data
    // Default to Plus when the API is unreachable or returns no plan —
    // it's the lowest paid tier and matches what every Token Plan
    // subscriber has for chat + media. If the user is on Max/Ultra and
    // Token Plan API is up, the backend's auto-detect will return the right tier.
    const userPlan = envelope?.plan || 'plus'
    const userPlanLevel = PLAN_ORDER[userPlan] ?? 0
    const modelRemains = data?.model_remains || []
    // Index Token Plan API quota entries by lowercase model_name for O(1) lookup.
    const quotaByName = new Map()
    for (const item of modelRemains) {
      const n = (item.model_name || '').toLowerCase()
      if (n) quotaByName.set(n, item)
    }
    return OFFICIAL_MODELS.map(meta => {
      // Only show models the user's plan unlocks. The ``plan`` field on
      // each entry uses the same tier names as the backend (starter <
      // plus < max < ultra).
      if (PLAN_ORDER[meta.plan] > userPlanLevel) return null

      // --- Video: count-based quota (e.g. "3 / 20 today") ---
      // Backend returns ``video_daily_limit`` (Max=3, Ultra=5, Plus=null
      // because Plus doesn't have video). The Token Plan API model_remains entry
      // can also flip status=3 to hide it for non-video tiers.
      if (meta.tracking === 'count') {
        const limit = data?.video_daily_limit
        const used = data?.video_daily_used ?? 0
        // Hide entirely when backend reports no limit (Plus tier or
        // detection failed) — don't fall back to a stale "Available".
        if (limit == null) return null
        const pct = limit > 0 ? Math.round((used / limit) * 100) : 0
        const reached = used >= limit
        return {
          key: meta.match,
          name: meta.label,
          desc: meta.desc,
          icon: meta.icon,
          group: meta.group,
          hasWeekly: meta.hasWeekly,
          tracking: 'count',
          videoQuota: { used, limit },
          used: pct,
          total: 100,
          pct,
          reached,
          resetMs: 0,
          displayLabel: reached ? 'Limit reached' : `${used} / ${limit} today`,
        }
      }

      // Token Plan API quota entries use the new short names ('general', 'video', ...)
      // or legacy long names. Try exact short match first, then prefix.
      // Skip the lookup entirely for buckets the dashboard treats as
      // untracked — image/speech/music always render as "Available" and
      // shouldn't be confused by a stray Token Plan API quota entry.
      const quotaItem = meta.tracking === 'none' ? null : (quotaByName.get(meta.match)
        || Array.from(quotaByName.entries()).find(([n]) => n.startsWith(meta.match + '-'))?.[1])
      if (quotaItem) {
        // Token Plan API reports ``current_interval_status``: 1 = active, 3 = inactive.
        // Hide models the user has no access to (e.g. Plus sees "video"
        // with status 3 in Token Plan API but the dashboard shouldn't render it).
        const status = Number(quotaItem.current_interval_status ?? quotaItem.current_weekly_status)
        if (status === 3) return null
        const useWeekly = meta.group === 'text' && textView === 'weekly'
        const remainingPct = useWeekly
          ? (quotaItem.current_weekly_remaining_percent || 0)
          : (quotaItem.current_interval_remaining_percent || 0)
        const usedPct = Math.max(0, Math.min(100, 100 - remainingPct))
        const resetMs = useWeekly ? (quotaItem.weekly_remains_time || 0) : (quotaItem.remains_time || 0)
        return {
          key: meta.match,
          name: meta.label,
          desc: meta.desc,
          icon: meta.icon,
          group: meta.group,
          hasWeekly: meta.hasWeekly,
          tracking: meta.tracking,
          used: usedPct,
          total: 100,
          pct: usedPct,
          remainingPct,
          resetMs,
          displayLabel: `${remainingPct}% remaining`,
        }
      }
      // No quota entry in Token Plan API — model is part of the plan but not
      // tracked by the Token Plan quota (e.g. Image-01, Speech 2.8,
      // Music-2.6 on Plus). Render as "Available" without a bar.
      return {
        key: meta.match,
        name: meta.label,
        desc: meta.desc,
        icon: meta.icon,
        group: meta.group,
        hasWeekly: meta.hasWeekly,
        tracking: meta.tracking,
        used: 0,
        total: 100,
        pct: 0,
        remainingPct: null,
        resetMs: 0,
        available: true,
        displayLabel: 'Available',
      }
    }).filter(Boolean)
  }

  const items = parse(quota)
  const textItems = items.filter(i => i.group === 'text')
  const dailyItems = items.filter(i => i.group === 'daily')

  // Common reset time for the group
  const dailyReset = dailyItems.length > 0 ? Math.max(...dailyItems.map(i => i.resetMs)) : 0
  const textReset = textItems.length > 0 ? textItems[0].resetMs : 0

  const Progress = ({ used, total, pct, label }) => (
    <div className="h-4 bg-surface rounded-full overflow-hidden relative">
      <div
        className={`h-full transition-all duration-500 ${pct >= 90 ? 'bg-error' : pct >= 70 ? 'bg-amber-500' : 'bg-success'}`}
        style={{ width: `${Math.min(pct, 100)}%` }}
      />
      <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-white drop-shadow">
        {label != null ? label : `${used.toLocaleString()}/${total.toLocaleString()} (${pct}%)`}
      </span>
    </div>
  )

  // Daily row: renders Image/Speech/Music as a plain "Available" pill,
  // and Video (count-based) with a counter + bar. Used in both compact
  // (sidebar) and full (Settings → Token Plan) layouts so the styles
  // stay in sync.
  const DailyRow = ({ item }) => {
    const iconSize = compact ? 10 : 12
    const labelSize = compact ? 'text-[10px]' : 'text-xs'
    if (item.tracking === 'none') {
      // Image-01 / Speech 2.8 / Music-2.6: untracked, no bar.
      return (
        <div className="flex items-center justify-between py-1">
          <div className="flex items-center gap-1.5">
            <item.icon size={iconSize} className="text-muted-foreground" />
            <span className={`${labelSize} text-muted-foreground`}>
              {item.name}
              {!compact && (
                <span className="text-muted-foreground/60"> ({item.desc})</span>
              )}
            </span>
          </div>
          <span className={`${labelSize} font-medium text-success`}>Available</span>
        </div>
      )
    }
    // tracking === 'count' → Video (Hailuo). Counter on the right, bar below.
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <item.icon size={iconSize} className="text-muted-foreground" />
            <span className={`${labelSize} text-muted-foreground`}>
              {item.name}
              {!compact && (
                <span className="text-muted-foreground/60"> ({item.desc})</span>
              )}
            </span>
          </div>
          <span className={`${labelSize} font-medium ${item.reached ? 'text-error' : 'text-muted-foreground'}`}>
            {item.displayLabel}
          </span>
        </div>
        <Progress used={item.pct} total={100} pct={item.pct} label="" />
      </div>
    )
  }

  if (compact) {
    return (
      <div className="border border-border rounded-lg bg-card overflow-hidden">
        <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center justify-between px-3 py-2 hover:bg-surface/50 transition-colors">
          <div className="flex items-center gap-2">
            <BarChart3 size={14} className="text-primary" />
            <span className="text-xs font-semibold">Token Plan</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Globe size={10} className="text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground uppercase">{region}</span>
            {expanded ? <ChevronUp size={12} className="text-muted-foreground" /> : <ChevronDown size={12} className="text-muted-foreground" />}
          </div>
        </button>

        {expanded && (
          <div className="px-3 pb-3 space-y-3 border-t border-border">
            {loading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-2"><RefreshCw size={12} className="animate-spin" /> Loading...</div>
            ) : error ? (
              <div className="flex items-center gap-1.5 text-xs text-error bg-error/10 border border-error/25 rounded-md px-2 py-1.5 mt-2 mx-1 font-medium">
                <AlertCircle size={12} /> {error}
              </div>
            ) : items.length > 0 ? (
              <div className="space-y-3 pt-2">
                {/* Text */}
                {textItems.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Text Generation</span>
                      <div className="flex items-center bg-surface rounded-lg border border-border p-0.5">
                        <button onClick={(e) => { e.stopPropagation(); setTextView('5h') }} className={`px-2 py-0.5 rounded text-[9px] font-medium transition-colors ${textView === '5h' ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'}`}>5h</button>
                        <button onClick={(e) => { e.stopPropagation(); setTextView('weekly') }} className={`px-2 py-0.5 rounded text-[9px] font-medium transition-colors ${textView === 'weekly' ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'}`}>Weekly</button>
                      </div>
                    </div>
                    <p className="text-[9px] text-muted-foreground">Resets in {formatTime(textReset)}</p>
                    {textItems.map(item => (
                      <div key={item.key} className="space-y-1">
                        <div className="flex items-center gap-1.5">
                          <item.icon size={10} className="text-muted-foreground" />
                          <span className="text-[10px] text-muted-foreground">{item.name}</span>
                          {item.pct >= 90 && <AlertCircle size={10} className="text-error" />}
                        </div>
                        <Progress used={item.used} total={item.total} pct={item.pct} label={item.displayLabel} />
                      </div>
                    ))}
                  </div>
                )}

                {/* Daily */}
                {dailyItems.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Daily Quota</span>
                      <span className="text-[9px] text-muted-foreground">Resets in {formatTime(dailyReset)}</span>
                    </div>
                    {dailyItems.map(item => (
                      <DailyRow key={item.key} item={item} />
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground py-2">No quota data</div>
            )}
            <button onClick={(e) => { e.stopPropagation(); fetchQuota() }} className="w-full flex items-center justify-center gap-1 text-[10px] text-primary hover:underline pt-1">
              <RefreshCw size={10} /> Refresh
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 size={16} className="text-primary" />
          <h2 className="text-sm font-semibold">Token Plan Usage</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground uppercase flex items-center gap-1"><Globe size={10} /> {region}</span>
          <button onClick={fetchQuota} disabled={loading} className="p-1.5 rounded-lg bg-surface border border-border hover:border-primary transition-colors disabled:opacity-50">
            <RefreshCw size={12} className={loading ? 'animate-spin text-primary' : 'text-muted-foreground'} />
          </button>
        </div>
      </div>

      {error && <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-error/10 border border-error/20 text-xs text-error"><AlertCircle size={14} /> {error}</div>}

      {items.length > 0 ? (
        <div className="space-y-4">
          {textItems.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Text Generation</h3>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground">Resets in {formatTime(textReset)}</span>
                  <div className="flex items-center bg-surface rounded-lg border border-border p-0.5">
                    <button onClick={() => setTextView('5h')} className={`px-3 py-1 rounded text-xs font-medium transition-colors ${textView === '5h' ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'}`}>5h</button>
                    <button onClick={() => setTextView('weekly')} className={`px-3 py-1 rounded text-xs font-medium transition-colors ${textView === 'weekly' ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'}`}>Weekly</button>
                  </div>
                </div>
              </div>
              {textItems.map(item => (
                <div key={item.key} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <item.icon size={12} className="text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">{item.name} <span className="text-muted-foreground/60">({item.desc})</span></span>
                  </div>
                  <Progress used={item.used} total={item.total} pct={item.pct} label={item.displayLabel} />
                </div>
              ))}
            </div>
          )}

          {dailyItems.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Daily Quota</h3>
                <span className="text-[10px] text-muted-foreground">Resets in {formatTime(dailyReset)}</span>
              </div>
              {dailyItems.map(item => (
                <DailyRow key={item.key} item={item} />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="text-center py-8 text-muted-foreground text-sm">{loading ? 'Loading...' : 'No quota data'}</div>
      )}
    </div>
  )
}
