import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  MessageSquare, Volume2, Image, Music, Video, Code2,
  Layout, Settings, ChevronsLeft, ChevronsRight
} from 'lucide-react'
import QuotaDashboard from './QuotaDashboard'
import CreditBalanceWidget from './CreditBalanceWidget'
import { apiFetch, apiWebSocketUrl } from '../lib/api.js'

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

export default function Sidebar({ activeTab, onTabChange }) {
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
    // level (enriched server-side from config.yaml + Token Plan API). The legacy
    // ``model_remains.includes('minimax-m')`` heuristic no longer matches
    // Token Plan API 1.0.16+ responses (which use short bucket names like 'general'),
    // so we read the enriched ``plan`` field directly.
    apiFetch('/api/minimax/quota')
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

  // Order + labels mirror the design's sidebar (Chat, Code, Image, Video,
  // Music, Speech, Tasks). All entries are always shown.
  const navItems = [
    { id: 'chat', label: t('nav.chat'), icon: MessageSquare },
    { id: 'code', label: t('nav.code'), icon: Code2, badge: 'AGENT' },
    { id: 'image', label: t('nav.image'), icon: Image },
    { id: 'video', label: t('nav.video'), icon: Video },
    { id: 'music', label: t('nav.music'), icon: Music },
    { id: 'tts', label: 'Speech', icon: Volume2 },
    { id: 'tasks', label: t('nav.tasks'), icon: Layout },
  ]

  return (
    <aside
      className={`flex flex-col bg-card border-r border-border transition-all duration-300 ease-in-out ${
        collapsed ? 'w-16' : 'w-[236px]'
      }`}
    >
      {/* Workspace label + collapse toggle. App identity (logo/name) now
          lives in the titlebar, so the sidebar header stays minimal. */}
      <div className="shrink-0 px-3 pt-4 pb-2">
        {collapsed ? (
          <div className="flex justify-center">
            <button
              onClick={toggleCollapsed}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-surface transition-colors"
              title={t('sidebar.expand')}
              aria-label={t('sidebar.expand')}
            >
              <ChevronsRight size={16} />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between px-2">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {t('sidebar.workspace', 'Workspace')}
            </span>
            <button
              onClick={toggleCollapsed}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-surface transition-colors"
              title={t('sidebar.collapse')}
              aria-label={t('sidebar.collapse')}
            >
              <ChevronsLeft size={14} />
            </button>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon
          const isActive = activeTab === item.id
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              title={collapsed ? item.label : undefined}
              className={`
                relative w-full flex items-center rounded-lg transition-all duration-150
                ${collapsed ? 'justify-center px-2 py-2.5' : 'gap-3 px-3 py-2.5'}
                ${isActive
                  ? 'bg-primary/[0.13] text-primary'
                  : 'text-muted-foreground hover:bg-surface hover:text-foreground'
                }
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50
              `}
              aria-current={isActive ? 'page' : undefined}
              aria-label={collapsed ? item.label : undefined}
            >
              {isActive && !collapsed && (
                <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-primary" aria-hidden="true" />
              )}
              <Icon size={18} aria-hidden="true" />
              {!collapsed && (
                <span className="flex-1 text-left text-[13px] font-medium truncate">{item.label}</span>
              )}
              {!collapsed && item.badge && (
                <span className="text-[9px] font-bold tracking-wide px-1.5 py-0.5 rounded bg-primary/[0.16] text-primary">{item.badge}</span>
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

      {/* Footer — Settings is a routed panel like the others, so we just
          call onTabChange('settings'). The active highlight matches the
          nav items (primary tint + inset left bar). */}
      <div className="p-2 border-t border-border shrink-0">
        <button
          onClick={() => onTabChange('settings')}
          title={collapsed ? t('nav.settings') : undefined}
          className={`
            relative w-full flex items-center rounded-lg transition-all duration-150
            ${collapsed ? 'justify-center px-2 py-2.5' : 'gap-3 px-3 py-2.5'}
            ${activeTab === 'settings'
              ? 'bg-primary/[0.13] text-primary'
              : 'text-muted-foreground hover:bg-surface hover:text-foreground'
            }
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50
          `}
          aria-current={activeTab === 'settings' ? 'page' : undefined}
          aria-label={collapsed ? t('nav.settings') : undefined}
        >
          {activeTab === 'settings' && !collapsed && (
            <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-primary" aria-hidden="true" />
          )}
          <Settings size={18} aria-hidden="true" />
          {!collapsed && <span className="flex-1 text-left text-[13px] font-medium truncate">{t('nav.settings')}</span>}
        </button>
      </div>
    </aside>
  )
}
