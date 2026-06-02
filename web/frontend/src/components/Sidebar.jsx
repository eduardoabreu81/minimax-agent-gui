import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  MessageSquare, Volume2, Image, Music, Video, Code2,
  Layout, Settings, Crown, ChevronsLeft, ChevronsRight
} from 'lucide-react'
import QuotaDashboard from './QuotaDashboard'
import CreditBalanceWidget from './CreditBalanceWidget'

const PLAN_ORDER = { plus: 0, max: 1, ultra: 2 }
const PLAN_LABELS = { plus: 'Plus', max: 'Max', ultra: 'Ultra' }

const NAV_META = {
  // All Token Plan subscribers (Plus/Max/Ultra) get chat + media generation
  // (image / speech / music). Only video gen is tier-gated. There is no
  // "starter" tier in the current Token Plan.
  chat: { plan: 'plus', always: true },
  tts: { plan: 'plus' },
  image: { plan: 'plus' },
  music: { plan: 'plus' },
  video: { plan: 'max' },
  code: { plan: 'plus', always: true },
  tasks: { plan: 'plus', always: true },
}

export default function Sidebar({ activeTab, onTabChange, onOpenSettings }) {
  const { t } = useTranslation()
  // Default to the lowest paid tier (Plus). When the API is reachable,
  // the auto-detected plan overrides this; when it isn't, we still show
  // a tier that matches what every paying subscriber has.
  const [userPlan, setUserPlan] = useState('plus')
  const [planLoaded, setPlanLoaded] = useState(false)
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('sidebar-collapsed') === 'true'
    } catch {
      return false
    }
  })

  useEffect(() => {
    // The /api/minimax/quota endpoint returns the user's plan at the top
    // level (enriched server-side from config.yaml + mmx). The legacy
    // ``model_remains.includes('minimax-m')`` heuristic no longer matches
    // mmx 1.0.16+ responses (which use short bucket names like 'general'),
    // so we read the enriched ``plan`` field directly.
    fetch('/api/minimax/quota')
      .then(r => r.json())
      .then(data => {
        const plan = (data?.plan || '').toLowerCase()
        if (plan && PLAN_ORDER[plan] !== undefined) {
          setUserPlan(plan)
        }
        setPlanLoaded(true)
      })
      .catch(() => setPlanLoaded(true))
  }, [])

  const toggleCollapsed = () => {
    setCollapsed(prev => {
      const next = !prev
      try { localStorage.setItem('sidebar-collapsed', String(next)) } catch {}
      return next
    })
  }

  const allNavItems = [
    { id: 'chat', label: t('nav.chat'), icon: MessageSquare, plan: 'plus', always: true },
    { id: 'tts', label: t('nav.tts'), icon: Volume2, plan: 'plus' },
    { id: 'image', label: t('nav.image'), icon: Image, plan: 'plus' },
    { id: 'music', label: t('nav.music'), icon: Music, plan: 'plus' },
    { id: 'video', label: t('nav.video'), icon: Video, plan: 'max' },
    { id: 'code', label: t('nav.code'), icon: Code2, plan: 'plus', always: true },
    { id: 'tasks', label: t('nav.tasks'), icon: Layout, plan: 'plus', always: true },
  ]

  const navItems = allNavItems.filter(item => item.always || PLAN_ORDER[item.plan] <= PLAN_ORDER[userPlan])

  return (
    <aside
      className={`flex flex-col bg-card border-r border-border transition-all duration-300 ease-in-out ${
        collapsed ? 'w-16' : 'w-64'
      }`}
    >
      {/* Logo + Toggle */}
      <div className={`border-b border-border shrink-0 ${collapsed ? 'flex flex-col items-center justify-center py-2 h-auto gap-1' : 'h-14 flex items-center px-4'}`}>
        <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
          <img src="/favicon.svg" alt="MiniMax" className="w-5 h-5" />
        </div>
        {!collapsed && (
          <div className="ml-3 flex-1 min-w-0">
            <h1 className="text-sm font-semibold text-foreground truncate">MiniMax Agent</h1>
            <p className="text-[10px] text-muted truncate">All-in-One Platform</p>
          </div>
        )}
        {!collapsed && planLoaded && (
          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/10 border border-primary/20 ml-2">
            <Crown size={10} className="text-primary" />
            <span className="text-[9px] text-primary font-medium">{PLAN_LABELS[userPlan]}</span>
          </div>
        )}
        <button
          onClick={toggleCollapsed}
          className={`p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-surface transition-colors shrink-0 ${collapsed ? '' : 'ml-2'}`}
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3 px-2 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon
          const isActive = activeTab === item.id
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              title={collapsed ? item.label : undefined}
              className={`
                w-full flex items-center rounded-lg transition-all duration-150
                ${collapsed ? 'justify-center px-2 py-2.5' : 'gap-3 px-3 py-2.5'}
                ${isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-surface hover:text-foreground'
                }
              `}
            >
              <Icon size={18} />
              {!collapsed && (
                <span className="flex-1 text-left text-sm font-medium">{item.label}</span>
              )}
            </button>
          )
        })}
      </nav>

      {/* Credit balance widget — hidden when sidebar is collapsed to keep
          the rail narrow. The widget polls every 30s and also refreshes
          after any media panel dispatches `minimax:media-complete`. */}
      {!collapsed && (
        <div className="px-3 pt-2 shrink-0">
          <CreditBalanceWidget />
        </div>
      )}
      {collapsed && (
        <div className="px-2 py-2 shrink-0 flex justify-center">
          <CreditBalanceWidget compact />
        </div>
      )}

      {/* Quota Dashboard — hidden when collapsed */}
      {!collapsed && (
        <div className="px-3 pb-2">
          <QuotaDashboard compact />
        </div>
      )}

      {/* Footer */}
      <div className="p-2 border-t border-border shrink-0">
        <button
          onClick={onOpenSettings}
          title={collapsed ? t('nav.settings') : undefined}
          className={`
            w-full flex items-center rounded-lg text-sm text-muted-foreground hover:bg-surface hover:text-foreground transition-colors
            ${collapsed ? 'justify-center px-2 py-2' : 'gap-3 px-3 py-2'}
          `}
        >
          <Settings size={18} />
          {!collapsed && t('nav.settings')}
        </button>
      </div>
    </aside>
  )
}
