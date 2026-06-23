import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useTheme } from './context/ThemeContext'
import { AgentActivityProvider } from './context/AgentActivityContext'
import { SessionTokensProvider } from './context/SessionTokensContext'
import { hasAnyRisk } from './hooks/useSessionProtection'
import { useBackendReady } from './hooks/useBackendReady'
import { useAgentContext } from './hooks/useAgentContext'
import Sidebar from './components/Sidebar'
import Titlebar from './components/shell/Titlebar'
import BackendLoader from './components/shell/BackendLoader'
import ChatPanel from './components/chat/ChatPanel'
import MatrixRain from './components/effects/MatrixRain'
import SpeechPanel from './components/media/SpeechPanel'
import ImagePanel from './components/media/ImagePanel'
import MusicPanel from './components/media/MusicPanel'
import VideoPanel from './components/media/VideoPanel'
import CodingPanel from './components/coding/CodingPanel'
import TaskBoard from './components/taskboard/TaskBoard'
import SettingsPanel from './components/settings/SettingsPanel'
import QuickSettings from './components/settings/QuickSettings'
import Onboarding from './components/onboarding/Onboarding'
import OnboardingWizard, { WIZARD_SEEN_KEY } from './components/agent-context/OnboardingWizard.jsx'
import IncompleteContextBanner from './components/agent-context/IncompleteContextBanner.jsx'
import CommandPalette from './components/command-palette/CommandPalette'
import StatusBar from './components/shared/StatusBar'

// App — healthcheck gate.
//
// During `npm run tauri:dev` Vite serves the page in ~300ms but
// backend.exe takes 1-2s to bind :8765. If the real app shell mounts
// immediately, every panel fires off `fetch('/api/...')` calls that hit
// a closed port. So we show <BackendLoader /> until `/api/config`
// responds 2xx (see useBackendReady.js — timeout matches lib.rs
// HEALTHCHECK_TIMEOUT = 30s).
//
// IMPORTANT: this component must call the SAME number of hooks on every
// render — that's why we extract the rest into <AppShell /> below. If
// we'd inlined `useState(activeTab)` etc. behind an early return here,
// React would explode with "Rendered more hooks than during the previous
// render" on the render where `backend.ready` flips true.
function App() {
  const backend = useBackendReady()

  if (!backend.ready) {
    return (
      <BackendLoader
        status={backend.status}
        error={backend.error}
        attempt={backend.attempt}
        onRetry={backend.retry}
      />
    )
  }

  return <AppShell />
}

// AppShell — the real application tree.
//
// Only mounts once `backend.ready` is true, so all hooks below are
// called for the first time at that moment and consistently on every
// subsequent render. Splitting this out keeps `App` hook-count-stable.
function AppShell() {
  const { t } = useTranslation()
  const { isDark, toggleDark, theme, matrixEffect } = useTheme()
  const [activeTab, setActiveTab] = useState('chat')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [chatKey, setChatKey] = useState(0)
  const [pendingTab, setPendingTab] = useState(null)
  const [showSessionGuard, setShowSessionGuard] = useState(false)
  const [guardAction, setGuardAction] = useState(null) // 'tab' | 'navigate' | 'action'
  const [guardPayload, setGuardPayload] = useState(null)

  // Global model + thinking override — shared across Chat and Code panels
  // so the StatusBar model picker always reflects "what the next send uses".
  // Migrated from the old per-panel localStorage keys (`chat-model-override`,
  // `code-model-override`) — first read wins, then we write to the unified key.
  const [activeModel, setActiveModel] = useState(() => {
    try {
      return (
        localStorage.getItem('global-model-override') ||
        localStorage.getItem('chat-model-override') ||
        localStorage.getItem('code-model-override') ||
        'MiniMax-M3'
      )
    } catch { return 'MiniMax-M3' }
  })
  const [thinkingEnabled, setThinkingEnabled] = useState(() => {
    try {
      const v =
        localStorage.getItem('global-thinking-enabled') ??
        localStorage.getItem('chat-thinking-enabled') ??
        localStorage.getItem('code-thinking-enabled')
      // Anything other than literal "false" is treated as ON.
      return v !== 'false'
    } catch { return true }
  })

  useEffect(() => {
    try { localStorage.setItem('global-model-override', activeModel) } catch {}
  }, [activeModel])
  useEffect(() => {
    try { localStorage.setItem('global-thinking-enabled', String(thinkingEnabled)) } catch {}
  }, [thinkingEnabled])

  // Extended thinking is M3-only (today). Other chat models in the Token
  // Plan do not support the Anthropic `thinking` param.
  const supportsThinking = activeModel === 'MiniMax-M3'

  // Agent Context system — banner + wizard mount state. The hook
  // owns the .agent/ status, the localStorage flag controls whether
  // the wizard is shown on first launch. The wizard can be re-opened
  // any time via the banner's "Set up now" button.
  const agentContext = useAgentContext()
  const [wizardOpen, setWizardOpen] = useState(false)
  // Auto-open the wizard on first launch if the user hasn't seen it
  // AND the .agent/ files are not yet filled. Runs once.
  useEffect(() => {
    let seen = false
    try { seen = !!localStorage.getItem(WIZARD_SEEN_KEY) } catch {}
    if (!seen && !agentContext.loading && agentContext.status?.banner_visible) {
      setWizardOpen(true)
    }
  }, [agentContext.loading, agentContext.status?.banner_visible])

  const openAgentContextSettings = useCallback(() => {
    setActiveTab('settings')
    // The Settings panel uses scroll-spy; the agent-context section
    // has id="settings-agent-context" so we scroll it into view after
    // a tick (let the panel mount first).
    setTimeout(() => {
      const el = document.getElementById('settings-agent-context')
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 60)
  }, [])

  const openAgentContextWizard = useCallback(() => {
    setActiveTab('settings')
    setWizardOpen(true)
  }, [])

  const panels = {
    chat: <ChatPanel key={chatKey}
                     activeModel={activeModel}
                     setActiveModel={setActiveModel}
                     thinkingEnabled={thinkingEnabled}
                     setThinkingEnabled={setThinkingEnabled}
                     supportsThinking={supportsThinking} />,
    tts: <SpeechPanel />,
    image: <ImagePanel />,
    music: <MusicPanel />,
    video: <VideoPanel />,
    code: <CodingPanel activeModel={activeModel}
                      setActiveModel={setActiveModel}
                      thinkingEnabled={thinkingEnabled}
                      setThinkingEnabled={setThinkingEnabled}
                      supportsThinking={supportsThinking} />,
    tasks: <TaskBoard />,
    settings: <SettingsPanel />,
  }

  // Global Ctrl+K shortcut
  useEffect(() => {
    const handleKeyDown = (e) => {
      const isCmdK = (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k'
      if (isCmdK) {
        e.preventDefault()
        setPaletteOpen(prev => !prev)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  // beforeunload guard — warn on page refresh/close when there's active work
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (hasAnyRisk()) {
        e.preventDefault()
        e.returnValue = ''
        return ''
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  const handleNavigate = useCallback((tabId) => {
    if (hasAnyRisk() && tabId !== activeTab) {
      setGuardAction('navigate')
      setGuardPayload(tabId)
      setShowSessionGuard(true)
    } else {
      setActiveTab(tabId)
    }
  }, [activeTab])

  const executeAction = useCallback((action) => {
    switch (action) {
      case 'new-chat':
        setChatKey(k => k + 1)
        setActiveTab('chat')
        break
      case 'clear-chat':
        setChatKey(k => k + 1)
        break
      case 'open-task-board':
        setActiveTab('tasks')
        break
      case 'open-settings':
      case 'settings-api':
      case 'settings-model':
      case 'settings-theme':
        // Settings is a full-page panel now, so all "jump to settings"
        // palette actions collapse to a single navigation. Section-level
        // deep-linking can be added later if needed.
        setActiveTab('settings')
        break
      default:
        break
    }
  }, [])

  const handleAction = useCallback((action) => {
    if (hasAnyRisk()) {
      setGuardAction('action')
      setGuardPayload(action)
      setShowSessionGuard(true)
    } else {
      executeAction(action)
    }
  }, [executeAction])

  return (
    <SessionTokensProvider>
      <AgentActivityProvider>
        <div className="flex flex-col h-screen w-screen bg-background text-foreground overflow-hidden relative">
          {theme === 'matrix' && matrixEffect && <MatrixRain />}
          <Titlebar onOpenPalette={() => setPaletteOpen(true)} />
          <div className="flex flex-1 min-h-0">
            <Sidebar
              activeTab={activeTab}
              onTabChange={(tab) => {
                if (hasAnyRisk() && tab !== activeTab) {
                  setGuardAction('tab')
                  setPendingTab(tab)
                  setShowSessionGuard(true)
                } else {
                  setActiveTab(tab)
                }
              }}
            />
            <main className="flex-1 flex flex-col min-w-0">
              {panels[activeTab]}
            </main>
          </div>
          <StatusBar
            model={activeModel}
            setModel={setActiveModel}
            thinkingEnabled={thinkingEnabled}
            setThinkingEnabled={setThinkingEnabled}
            supportsThinking={supportsThinking}
          />
          <Onboarding />
          <IncompleteContextBanner
            status={agentContext.status}
            onOpenSettings={openAgentContextSettings}
            onOpenWizard={openAgentContextWizard}
          />
          <OnboardingWizard
            open={wizardOpen}
            onClose={() => setWizardOpen(false)}
          />
          <QuickSettings
            isOpen={false}
            onClose={() => {}}
            isDark={isDark}
            onToggleTheme={toggleDark}
          />
          {showSessionGuard && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
              <div className="w-full max-w-sm bg-card border border-border rounded-xl shadow-2xl p-6">
                <h3 className="text-sm font-semibold mb-2">{t('session.active')}</h3>
                <p className="text-xs text-muted-foreground mb-4">
                  {t('session.activeDesc')}
                </p>
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => {
                      setShowSessionGuard(false)
                      setPendingTab(null)
                      setGuardAction(null)
                      setGuardPayload(null)
                    }}
                    className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {t('session.stay')}
                  </button>
                  <button
                    onClick={() => {
                      setShowSessionGuard(false)
                      if (guardAction === 'tab' && pendingTab) {
                        setActiveTab(pendingTab)
                      } else if (guardAction === 'navigate' && guardPayload) {
                        setActiveTab(guardPayload)
                      } else if (guardAction === 'action' && guardPayload) {
                        executeAction(guardPayload)
                      }
                      setPendingTab(null)
                      setGuardAction(null)
                      setGuardPayload(null)
                    }}
                    className="px-3 py-1.5 bg-primary hover:bg-primary-hover text-white rounded-lg text-xs font-medium transition-colors"
                  >
                    {t('session.switchAnyway')}
                  </button>
                </div>
              </div>
            </div>
          )}
          <CommandPalette
            isOpen={paletteOpen}
            onClose={() => setPaletteOpen(false)}
            onNavigate={handleNavigate}
            onAction={handleAction}
            currentTab={activeTab}
            isDark={isDark}
            onToggleTheme={toggleDark}
          />
        </div>
      </AgentActivityProvider>
    </SessionTokensProvider>
  )
}

export default App
