import { useState, useEffect } from 'react'
import {
  BarChart3, RefreshCw, AlertCircle, ChevronDown, ChevronUp,
  Zap, Volume2, Image, Music, Video, Globe
} from 'lucide-react'

const OFFICIAL_MODELS = [
  { match: 'minimax-m', icon: Zap, label: 'M2.7', desc: 'Text', interval: '5h', group: 'text', hasWeekly: true },
  { match: 'speech-hd', icon: Volume2, label: 'Speech 2.8', desc: 'TTS', interval: '24h', group: 'daily' },
  { match: 'image-01', icon: Image, label: 'Image-01', desc: 'Image', interval: '24h', group: 'daily' },
  { match: 'minimax-hailuo-2.3-fast', icon: Video, label: 'Hailuo Fast', desc: 'Video', interval: '24h', group: 'daily' },
  { match: 'minimax-hailuo-2.3-6s', icon: Video, label: 'Hailuo 2.3', desc: 'Video', interval: '24h', group: 'daily' },
  { match: 'music-2.6', icon: Music, label: 'Music-2.6', desc: 'Music', interval: '24h', group: 'daily' },
]

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
      const res = await fetch('/api/minimax/quota')
      const data = await res.json()
      if (data.success) setQuota(data.data)
      else setError(data.error || 'Failed')
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => {
    fetch('/api/config').then(r => r.json()).then(d => setRegion(d.region || 'global')).catch(() => {})
    fetchQuota()
    const iv = setInterval(fetchQuota, 60000)
    return () => clearInterval(iv)
  }, [])

  const parse = (data) => {
    if (!data?.model_remains) return []
    return data.model_remains.map(item => {
      const name = (item.model_name || '').toLowerCase()
      if (EXCLUDED_NAMES.some(ex => name.includes(ex))) return null
      const meta = OFFICIAL_MODELS.find(m => name.includes(m.match))
      if (!meta) return null
      const useWeekly = meta.group === 'text' && textView === 'weekly'
      const total = useWeekly ? (item.current_weekly_total_count || 0) : (item.current_interval_total_count || 0)
      const used = useWeekly ? (item.current_weekly_usage_count || 0) : (item.current_interval_usage_count || 0)
      if (total === 0) return null
      // Use correct reset time based on current view
      const resetMs = useWeekly ? (item.weekly_remains_time || 0) : (item.remains_time || 0)
      return {
        key: meta.match,
        name: meta.label,
        desc: meta.desc,
        icon: meta.icon,
        group: meta.group,
        hasWeekly: meta.hasWeekly,
        used, total,
        pct: total > 0 ? Math.round((used / total) * 100) : 0,
        resetMs,
      }
    }).filter(Boolean)
  }

  const items = parse(quota)
  const textItems = items.filter(i => i.group === 'text')
  const dailyItems = items.filter(i => i.group === 'daily')

  // Common reset time for the group
  const dailyReset = dailyItems.length > 0 ? Math.max(...dailyItems.map(i => i.resetMs)) : 0
  const textReset = textItems.length > 0 ? textItems[0].resetMs : 0

  const Progress = ({ used, total, pct }) => (
    <div className="h-4 bg-surface rounded-full overflow-hidden relative">
      <div
        className={`h-full transition-all duration-500 ${pct >= 90 ? 'bg-error' : pct >= 70 ? 'bg-amber-500' : 'bg-success'}`}
        style={{ width: `${Math.min(pct, 100)}%` }}
      />
      <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-white drop-shadow">
        {used.toLocaleString()}/{total.toLocaleString()} ({pct}%)
      </span>
    </div>
  )

  if (compact) {
    return (
      <div className="border border-border rounded-lg bg-card overflow-hidden">
        <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center justify-between px-3 py-2 hover:bg-surface/50 transition-colors">
          <div className="flex items-center gap-2">
            <BarChart3 size={14} className="text-primary" />
            <span className="text-xs font-semibold">Token Plan</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Globe size={10} className="text-muted" />
            <span className="text-[10px] text-muted uppercase">{region}</span>
            {expanded ? <ChevronUp size={12} className="text-muted" /> : <ChevronDown size={12} className="text-muted" />}
          </div>
        </button>

        {expanded && (
          <div className="px-3 pb-3 space-y-3 border-t border-border">
            {loading ? (
              <div className="flex items-center gap-2 text-xs text-muted py-2"><RefreshCw size={12} className="animate-spin" /> Loading...</div>
            ) : error ? (
              <div className="flex items-center gap-1.5 text-xs text-error py-2"><AlertCircle size={12} /> {error}</div>
            ) : items.length > 0 ? (
              <div className="space-y-3 pt-2">
                {/* Text */}
                {textItems.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">Text Generation</span>
                      <div className="flex items-center bg-surface rounded-lg border border-border p-0.5">
                        <button onClick={(e) => { e.stopPropagation(); setTextView('5h') }} className={`px-2 py-0.5 rounded text-[9px] font-medium transition-colors ${textView === '5h' ? 'bg-primary text-white' : 'text-muted hover:text-foreground'}`}>5h</button>
                        <button onClick={(e) => { e.stopPropagation(); setTextView('weekly') }} className={`px-2 py-0.5 rounded text-[9px] font-medium transition-colors ${textView === 'weekly' ? 'bg-primary text-white' : 'text-muted hover:text-foreground'}`}>Weekly</button>
                      </div>
                    </div>
                    <p className="text-[9px] text-muted">Resets in {formatTime(textReset)}</p>
                    {textItems.map(item => (
                      <div key={item.key} className="space-y-1">
                        <div className="flex items-center gap-1.5">
                          <item.icon size={10} className="text-muted" />
                          <span className="text-[10px] text-muted">{item.name}</span>
                          {item.pct >= 90 && <AlertCircle size={10} className="text-error" />}
                        </div>
                        <Progress used={item.used} total={item.total} pct={item.pct} />
                      </div>
                    ))}
                  </div>
                )}

                {/* Daily */}
                {dailyItems.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">Daily Quota</span>
                      <span className="text-[9px] text-muted">Resets in {formatTime(dailyReset)}</span>
                    </div>
                    {dailyItems.map(item => (
                      <div key={item.key} className="space-y-1">
                        <div className="flex items-center gap-1.5">
                          <item.icon size={10} className="text-muted" />
                          <span className="text-[10px] text-muted">{item.name}</span>
                          {item.pct >= 90 && <AlertCircle size={10} className="text-error" />}
                        </div>
                        <Progress used={item.used} total={item.total} pct={item.pct} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-xs text-muted py-2">No quota data</div>
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
          <span className="text-[10px] text-muted uppercase flex items-center gap-1"><Globe size={10} /> {region}</span>
          <button onClick={fetchQuota} disabled={loading} className="p-1.5 rounded-lg bg-surface border border-border hover:border-primary transition-colors disabled:opacity-50">
            <RefreshCw size={12} className={loading ? 'animate-spin text-primary' : 'text-muted'} />
          </button>
        </div>
      </div>

      {error && <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-error/10 border border-error/20 text-xs text-error"><AlertCircle size={14} /> {error}</div>}

      {items.length > 0 ? (
        <div className="space-y-4">
          {textItems.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-muted uppercase tracking-wider">Text Generation</h3>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted">Resets in {formatTime(textReset)}</span>
                  <div className="flex items-center bg-surface rounded-lg border border-border p-0.5">
                    <button onClick={() => setTextView('5h')} className={`px-3 py-1 rounded text-xs font-medium transition-colors ${textView === '5h' ? 'bg-primary text-white' : 'text-muted hover:text-foreground'}`}>5h</button>
                    <button onClick={() => setTextView('weekly')} className={`px-3 py-1 rounded text-xs font-medium transition-colors ${textView === 'weekly' ? 'bg-primary text-white' : 'text-muted hover:text-foreground'}`}>Weekly</button>
                  </div>
                </div>
              </div>
              {textItems.map(item => (
                <div key={item.key} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <item.icon size={12} className="text-muted" />
                    <span className="text-xs text-muted">{item.name} <span className="text-muted/60">({item.desc})</span></span>
                  </div>
                  <Progress used={item.used} total={item.total} pct={item.pct} />
                </div>
              ))}
            </div>
          )}

          {dailyItems.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-muted uppercase tracking-wider">Daily Quota</h3>
                <span className="text-[10px] text-muted">Resets in {formatTime(dailyReset)}</span>
              </div>
              {dailyItems.map(item => (
                <div key={item.key} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <item.icon size={12} className="text-muted" />
                    <span className="text-xs text-muted">{item.name} <span className="text-muted/60">({item.desc})</span></span>
                  </div>
                  <Progress used={item.used} total={item.total} pct={item.pct} />
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="text-center py-8 text-muted text-sm">{loading ? 'Loading...' : 'No quota data'}</div>
      )}
    </div>
  )
}
