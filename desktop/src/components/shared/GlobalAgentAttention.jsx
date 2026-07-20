import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, MessageSquare, Code2, X } from 'lucide-react'
import { useAgentActivity } from '../../context/AgentActivityContext'

const TAB_ICONS = {
  chat: MessageSquare,
  code: Code2,
}

function GlobalAgentAttention() {
  const { sessions, selectGlobalSummary, acknowledgeSession } = useAgentActivity()
  const summary = selectGlobalSummary()
  const { t } = useTranslation()

  // Collect sessions that need user attention: needs_input, or unread errors
  const attentionItems = useMemo(() => {
    if (!sessions) return []
    return Object.entries(sessions)
      .filter(([_id, s]) => {
        if (s.status === 'needs_input') return true
        if (s.status === 'error' && s.unread) return true
        return false
      })
      .map(([id, s]) => ({
        id,
        tabId: s.tabId,
        status: s.status,
        attention: s.attention,
        toolName: s.attention?.toolName,
      }))
  }, [sessions])

  if (attentionItems.length === 0) return null

  return (
    <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 max-w-md">
      {attentionItems.map((item) => {
        const Icon = TAB_ICONS[item.tabId] || MessageSquare
        const isAttention = item.status === 'needs_input'

        return (
          <div
            key={item.id}
            className={`
              flex items-start gap-3 px-4 py-3 rounded-xl border shadow-xl backdrop-blur-sm
              ${isAttention
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-600'
                : 'bg-red-500/10 border-red-500/30 text-red-600'
              }
            `}
          >
            <div className={`shrink-0 mt-0.5 ${isAttention ? 'text-amber-500' : 'text-red-500'}`}>
              <AlertTriangle size={16} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 text-[12px] font-medium">
                <Icon size={12} />
                <span>
                  {isAttention
                    ? t('agentRuns.needsInput', `Needs input — ${item.tabId}`)
                    : t('agentRuns.hasError', `Error — ${item.tabId}`)
                  }
                </span>
              </div>
              {item.toolName && (
                <p className="text-[11px] opacity-80 mt-0.5 truncate">
                  {t('agentRuns.toolRequest', `Tool: ${item.toolName}`)}
                </p>
              )}
            </div>
            <button
              onClick={() => acknowledgeSession(item.id)}
              className="shrink-0 p-1 rounded-lg hover:bg-black/10 transition-colors opacity-60 hover:opacity-100"
            >
              <X size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}

export default GlobalAgentAttention
