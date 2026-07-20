import { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, AlertTriangle, CheckCircle2, XCircle, MessageSquare, Code2, Clock } from 'lucide-react'
import { useAgentActivity } from '../../context/AgentActivityContext'

const TAB_LABELS = {
  chat: { icon: MessageSquare, labelKey: 'chat' },
  code: { icon: Code2, labelKey: 'code' },
}

const STATUS_CONFIG = {
  running:      { icon: Loader2,       color: 'text-primary',      bg: 'bg-primary/10',    pulse: true  },
  needs_input:  { icon: AlertTriangle, color: 'text-amber-500',    bg: 'bg-amber-500/10',  pulse: false },
  completed:    { icon: CheckCircle2,  color: 'text-green-500',    bg: 'bg-green-500/10',  pulse: false },
  error:        { icon: XCircle,       color: 'text-red-500',      bg: 'bg-red-500/10',    pulse: false },
  idle:         { icon: null,          color: 'text-muted-foreground', bg: 'bg-surface',  pulse: false },
}

function formatDuration(startTime) {
  if (!startTime) return ''
  const sec = Math.floor((Date.now() - startTime) / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  return `${min}m ${sec % 60}s`
}

function SessionRow({ sessionId, session }) {
  const { t } = useTranslation()
  const tabInfo = TAB_LABELS[session.tabId] || { icon: MessageSquare, labelKey: 'session' }
  const Icon = tabInfo.icon
  const status = STATUS_CONFIG[session.status] || STATUS_CONFIG.idle
  const StatusIcon = status.icon

  return (
    <div className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg ${status.bg} ${status.pulse ? 'animate-pulse' : ''}`}>
      <Icon size={14} className="text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium text-foreground truncate">
            {t(`agentRuns.${tabInfo.labelKey}`, tabInfo.labelKey)}
          </span>
          {session.unread && (
            <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className={`text-[10px] ${status.color} flex items-center gap-1`}>
            {StatusIcon && <StatusIcon size={10} className={status.pulse ? 'animate-spin' : ''} />}
            {t(`agentRuns.status.${session.status}`, session.status)}
          </span>
          {session.runStart && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
              <Clock size={9} />
              {formatDuration(session.runStart)}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function AgentRunStatus() {
  const { sessions, selectGlobalSummary } = useAgentActivity()
  const summary = selectGlobalSummary()
  const [open, setOpen] = useState(false)
  const anchorRef = useRef(null)
  const active = summary.runningCount > 0 || summary.attentionCount > 0

  const sessionList = Object.entries(sessions || {}).filter(
    ([_id, s]) => s.status === 'running' || s.status === 'needs_input' || s.unread
  )

  return (
    <div className="relative">
      <button
        ref={anchorRef}
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 h-[22px] px-2 rounded-md text-[11.5px] font-medium transition-colors hover:bg-secondary ${active ? 'text-success' : 'text-muted-foreground'}`}
        title={active ? 'Agent is processing' : 'Agent idle'}
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
        {sessionList.length > 0 && (
          <span className="text-[10px] tabular-nums">{sessionList.length}</span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
      )}

      {open && (
        <div
          className="absolute bottom-full right-0 mb-2 z-50 bg-card border border-border rounded-xl shadow-2xl"
          style={{ minWidth: 240, maxWidth: 320 }}
        >
          <div className="p-2 space-y-1 max-h-64 overflow-y-auto">
            {sessionList.length === 0 ? (
              <div className="text-[11px] text-muted-foreground text-center py-3">
                No active sessions
              </div>
            ) : (
              sessionList.map(([sessionId, session]) => (
                <SessionRow key={sessionId} sessionId={sessionId} session={session} />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default AgentRunStatus
