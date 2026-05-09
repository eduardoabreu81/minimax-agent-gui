import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useTheme } from './context/ThemeContext'
import { AgentActivityProvider } from './context/AgentActivityContext'
import { hasAnyRisk } from './hooks/useSessionProtection'
import Sidebar from './components/Sidebar'
import ChatPanel from './components/chat/ChatPanel'
import MatrixRain from './components/effects/MatrixRain'
import TTSPanel from './components/media/TTSPanel'
import ImagePanel from './components/media/ImagePanel'
import MusicPanel from './components/media/MusicPanel'
import VideoPanel from './components/media/VideoPanel'
import CodingPanel from './components/coding/CodingPanel'
import TaskBoard from './components/taskboard/TaskBoard'
import QuickSettings from './components/settings/QuickSettings'
import SettingsModal from './components/settings/SettingsModal'
import Onboarding from './components/onboarding/Onboarding'
import CommandPalette from './components/command-palette/CommandPalette'

function App() {
  const { t } = useTranslation()
  const { isDark, toggleDark, theme, matrixEffect } = useTheme()
  const [activeTab, setActiveTab] = useState('chat')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsModalOpen, setSettingsModalOpen] = useState(false)
  const [chatKey, setChatKey] = useState(0)
  const [pendingTab, setPendingTab] = useState(null)
  const [showSessionGuard, setShowSessionGuard] = useState(false)
  const [guardAction, setGuardAction] = useState(null) // 'tab' | 'navigate' | 'action'
  const [guardPayload, setGuardPayload] = useState(null)

  const panels = {
    chat: <ChatPanel key={chatKey} />,
    tts: <TTSPanel />,
    image: <ImagePanel />,
    music: <MusicPanel />,
    video: <VideoPanel />,
    code: (
      <AgentActivityProvider>
        <CodingPanel />
      </AgentActivityProvider>
    ),
    tasks: <TaskBoard />,
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
        // Modern browsers show a generic message; the returnValue is legacy support
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
      case 'git-status':
      case 'git-fetch':
      case 'git-pull':
      case 'git-log':
        setActiveTab('code')
        window.dispatchEvent(new CustomEvent('gitAction', { detail: action }))
        break
      case 'new-task':
        setActiveTab('tasks')
        break
      case 'open-settings':
        setSettingsModalOpen(true)
        break
      case 'settings-api':
      case 'settings-model':
      case 'settings-theme':
        // TODO: open settings modal
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
    <div className="flex h-screen w-screen bg-background text-foreground overflow-hidden relative">
      {theme === 'matrix' && matrixEffect && <MatrixRain />}
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
        onOpenSettings={() => setSettingsModalOpen(true)}
      />
      <main className="flex-1 flex flex-col min-w-0">
        {panels[activeTab]}
      </main>
      <Onboarding />
      <QuickSettings
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        isDark={isDark}
        onToggleTheme={toggleDark}
      />
      <SettingsModal
        isOpen={settingsModalOpen}
        onClose={() => setSettingsModalOpen(false)}
        isDark={isDark}
        onToggleTheme={toggleDark}
      />
      {showSessionGuard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-card border border-border rounded-xl shadow-2xl p-6">
            <h3 className="text-sm font-semibold mb-2">{t('session.active')}</h3>
            <p className="text-xs text-muted mb-4">
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
                className="px-3 py-1.5 text-xs text-muted hover:text-foreground transition-colors"
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
  )
}

export default App
