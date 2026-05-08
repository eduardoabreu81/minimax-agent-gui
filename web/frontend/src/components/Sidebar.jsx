import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  MessageSquare, Volume2, Image, Music, Video, Code2,
  Layout, Settings, Crown
} from 'lucide-react'
import QuotaDashboard from './QuotaDashboard'

const PLAN_ORDER = { starter: 1, plus: 2, max: 3 }
const PLAN_LABELS = { starter: 'Starter', plus: 'Plus', max: 'Max' }

const NAV_META = {
  chat: { plan: 'starter', always: true },
  tts: { plan: 'plus' },
  image: { plan: 'plus' },
  music: { plan: 'starter' },
  video: { plan: 'max' },
  code: { plan: 'starter', always: true },
  tasks: { plan: 'starter', always: true },
}

export default function Sidebar({ activeTab, onTabChange, onOpenSettings }) {
  const { t } = useTranslation()
  const [userPlan, setUserPlan] = useState('starter')
  const [planLoaded, setPlanLoaded] = useState(false)

  useEffect(() => {
    fetch('/api/minimax/quota')
      .then(r => r.json())
      .then(data => {
        if (data.success && data.data?.model_remains) {
          const m2Model = data.data.model_remains.find(m =>
            (m.model_name || '').toLowerCase().includes('minimax-m')
          )
          if (m2Model) {
            const total = m2Model.current_interval_total_count || 0
            if (total >= 15000) setUserPlan('max')
            else if (total >= 4500) setUserPlan('plus')
            else setUserPlan('starter')
          }
          setPlanLoaded(true)
        }
      })
      .catch(() => setPlanLoaded(true))
  }, [])

  const allNavItems = [
    { id: 'chat', label: t('nav.chat'), icon: MessageSquare, plan: 'starter', always: true },
    { id: 'tts', label: t('nav.tts'), icon: Volume2, plan: 'plus' },
    { id: 'image', label: t('nav.image'), icon: Image, plan: 'plus' },
    { id: 'music', label: t('nav.music'), icon: Music, plan: 'starter' },
    { id: 'video', label: t('nav.video'), icon: Video, plan: 'max' },
    { id: 'code', label: t('nav.code'), icon: Code2, plan: 'starter', always: true },
    { id: 'tasks', label: t('nav.tasks'), icon: Layout, plan: 'starter', always: true },
  ]

  const PLAN_ORDER = { starter: 1, plus: 2, max: 3 }
  const navItems = allNavItems.filter(item => item.always || PLAN_ORDER[item.plan] <= PLAN_ORDER[userPlan])

  return (
    <aside className="w-64 flex flex-col bg-card border-r border-border">
      {/* Logo */}
      <div className="h-14 flex items-center px-5 border-b border-border">
        <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center mr-3">
          <img src="/favicon.svg" alt="MiniMax" className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold text-foreground">MiniMax Agent</h1>
          <p className="text-[10px] text-muted">All-in-One Platform</p>
        </div>
        {planLoaded && (
          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/10 border border-primary/20">
            <Crown size={10} className="text-primary" />
            <span className="text-[9px] text-primary font-medium">{PLAN_LABELS[userPlan]}</span>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3 px-3 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon
          const isActive = activeTab === item.id
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className={`
                w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150
                ${isActive
                  ? 'bg-primary/10 text-primary border-l-2 border-primary'
                  : 'text-muted-foreground hover:bg-surface hover:text-foreground'
                }
              `}
            >
              <Icon size={18} />
              <span className="flex-1 text-left">{item.label}</span>
            </button>
          )
        })}
      </nav>

      {/* Quota Dashboard */}
      <div className="px-3 pb-2">
        <QuotaDashboard compact />
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-border space-y-1">
        <button
          onClick={onOpenSettings}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-surface hover:text-foreground transition-colors"
        >
          <Settings size={18} />
          {t('nav.settings')}
        </button>
      </div>
    </aside>
  )
}
