import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useTheme } from './context/ThemeContext'
import { AgentActivityProvider } from './context/AgentActivityContext'
import { SessionTokensProvider } from './context/SessionTokensContext'
import { hasAnyRisk } from './hooks/useSessionProtection'
import { useBackendReady } from './hooks/useBackendReady'
import { apiFetch, isTauri } from './lib/api.js'
import { useAgentContext } from './hooks/useAgentContext'
import { ContextModalProvider, useContextModal } from './components/agent-context/ContextProvider.jsx'
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
import HelpPanel from './components/help/HelpPanel'
import QuickSettings from './components/settings/QuickSettings'
import FirstRunSetup, { SETUP_COMPLETE_KEY } from './components/onboarding/FirstRunSetup'
import OnboardingWizard, { WIZARD_SEEN_KEY } from './components/agent-context/OnboardingWizard.jsx'
import IncompleteContextBanner from './components/agent-context/IncompleteContextBanner.jsx'
import ContextModal from './components/agent-context/ContextModal.jsx'
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

  // Wrap AppShell in the ContextModalProvider so the AppShell body
  // (which calls useContextModal) is INSIDE the provider. The provider
  // itself doesn't call any hooks in App, so this doesn't break the
  // hook-count-stability rule for App.
  return (
    <ContextModalProvider>
      <AppShell />
    </ContextModalProvider>
  )
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
  // any time via the banner's "Set up now" button, and the Context
  // modal is opened from the banner's "Open Settings" shortcut.
  const agentContext = useAgentContext()
  const contextModal = useContextModal()
  const [wizardOpen, setWizardOpen] = useState(false)

  // First-run setup gate. Shown once, then `minimax-setup-complete` is set.
  // Existing users (who already saw the legacy onboarding/wizard) are migrated
  // to "complete" so the new flow never interrupts them.
  const [showSetup, setShowSetup] = useState(() => {
    try {
      if (localStorage.getItem(SETUP_COMPLETE_KEY)) return false
      if (localStorage.getItem('minimax-onboarding-seen') || localStorage.getItem(WIZARD_SEEN_KEY)) {
        localStorage.setItem(SETUP_COMPLETE_KEY, 'true')
        return false
      }
      return true
    } catch { return false }
  })

  // Clears the first-run flags and re-opens the setup overlay. Wired to the
  // "Rerun setup" button in Settings → About so users can redo onboarding.
  const restartSetup = useCallback(() => {
    try {
      localStorage.removeItem(SETUP_COMPLETE_KEY)
      localStorage.removeItem('minimax-onboarding-seen')
      localStorage.removeItem(WIZARD_SEEN_KEY)
    } catch {}
    setShowSetup(true)
  }, [])

  // Any "rerun onboarding" affordance (Settings → About, the Agent Context
  // modal header) dispatches this event so it works from anywhere.
  useEffect(() => {
    const onRerun = () => restartSetup()
    window.addEventListener('minimax:rerun-setup', onRerun)
    return () => window.removeEventListener('minimax:rerun-setup', onRerun)
  }, [restartSetup])

  // FirstRunSetup now owns onboarding, so the agent-context wizard no longer
  // auto-opens on launch — it's reachable from the IncompleteContextBanner's
  // "Set up now" button.

  // The "Open Settings" / "Set up now" shortcuts in the banner
  // both go to the new Context modal (no more "switch to settings
  // tab + scroll" dance). "Set up now" additionally opens the
  // wizard on top of the modal.
  const openAgentContextSettings = useCallback(() => {
    contextModal.openModal()
  }, [contextModal])

  const openAgentContextWizard = useCallback(() => {
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
    settings: <SettingsPanel onRestartSetup={restartSetup} />,
    help: <HelpPanel />,
  }

  // Global Ctrl+K (command palette) and F1 / "?" (help) shortcuts.
  useEffect(() => {
    const handleKeyDown = (e) => {
      const isCmdK = (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k'
      if (isCmdK) {
        e.preventDefault()
        setPaletteOpen(prev => !prev)
        return
      }
      // Help: F1 always; "?" only when the user isn't typing into a field,
      // otherwise it would hijack a literal question mark in the composer.
      const target = e.target
      const isEditable =
        target?.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName)
      const isHelpKey =
        e.key === 'F1' ||
        (e.key === '?' && !isEditable && !e.metaKey && !e.ctrlKey && !e.altKey)
      if (isHelpKey) {
        e.preventDefault()
        setActiveTab('help')
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

  // Download links to the bundled backend point at an absolute
  // http://127.0.0.1:8765 URL. In the Tauri WebView a cross-origin
  // `<a download>` is treated as a *navigation* (the download attribute is
  // ignored across origins), which leaves the SPA and trips the beforeunload
  // guard above ("Leave site?"). Intercept those clicks and save the file via
  // a same-origin blob URL instead — the WebView downloads it with no
  // navigation and no prompt.
  useEffect(() => {
    const onClick = (e) => {
      const a = e.target.closest?.('a[download]')
      if (!a) return
      const href = a.getAttribute('href') || ''
      if (!href.includes('/api/files/')) return
      e.preventDefault()
      const filename = a.getAttribute('download') || 'download'
      ;(async () => {
        try {
          if (isTauri) {
            // Native "Save as…": let the user pick where to save, then have
            // the backend (which already has the file on disk) copy it there.
            let srcPath = '', sessionId = ''
            try {
              const u = new URL(href)
              srcPath = u.searchParams.get('path') || ''
              sessionId = u.searchParams.get('session_id') || ''
            } catch { /* unparseable href — fall through to blob */ }
            if (srcPath) {
              const { save } = await import('@tauri-apps/plugin-dialog')
              const dest = await save({ defaultPath: filename })
              if (!dest) return // user cancelled the dialog
              const res = await apiFetch('/api/files/export', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: srcPath, dest, session_id: sessionId }),
              })
              if (!res.ok) throw new Error(`export failed (${res.status})`)
              return
            }
          }
          // Web (or unparseable href): same-origin blob download.
          const res = await fetch(href)
          if (!res.ok) throw new Error(`download failed (${res.status})`)
          const blob = await res.blob()
          const url = URL.createObjectURL(blob)
          const link = document.createElement('a')
          link.href = url
          link.download = filename
          document.body.appendChild(link)
          link.click()
          link.remove()
          setTimeout(() => URL.revokeObjectURL(url), 1500)
        } catch (err) {
          console.error('[download] failed:', err)
        }
      })()
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
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
      case 'open-help':
        setActiveTab('help')
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
          {showSetup && <FirstRunSetup onComplete={() => setShowSetup(false)} />}
          <IncompleteContextBanner
            status={agentContext.status}
            onOpenSettings={openAgentContextSettings}
            onOpenWizard={openAgentContextWizard}
          />
          <OnboardingWizard
            open={wizardOpen}
            onClose={() => setWizardOpen(false)}
          />
          <ContextModal />
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
