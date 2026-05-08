import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useTheme } from './context/ThemeContext'
import Sidebar from './components/Sidebar'
import ChatPanel from './components/chat/ChatPanel'
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
  const { isDark, toggleDark } = useTheme()
  const [activeTab, setActiveTab] = useState('chat')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsModalOpen, setSettingsModalOpen] = useState(false)
  const [chatKey, setChatKey] = useState(0)
  const [isProcessing, setIsProcessing] = useState(false)
  const [pendingTab, setPendingTab] = useState(null)
  const [showSessionGuard, setShowSessionGuard] = useState(false)

  const panels = {
    chat: <ChatPanel key={chatKey} onProcessingChange={setIsProcessing} />,
    tts: <TTSPanel />,
    image: <ImagePanel />,
    music: <MusicPanel />,
    video: <VideoPanel />,
    code: <CodingPanel />,
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

  const handleNavigate = useCallback((tabId) => {
    setActiveTab(tabId)
  }, [])

  const handleAction = useCallback((action) => {
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
        // Dispatch event for CodingPanel to handle git action
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



  return (
    <div className="flex h-screen w-screen bg-background text-foreground overflow-hidden">
      <Sidebar
        activeTab={activeTab}
        onTabChange={(tab) => {
          if (isProcessing && tab !== activeTab) {
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
                onClick={() => { setShowSessionGuard(false); setPendingTab(null) }}
                className="px-3 py-1.5 text-xs text-muted hover:text-foreground transition-colors"
              >
                {t('session.stay')}
              </button>
              <button
                onClick={() => {
                  setShowSessionGuard(false)
                  setIsProcessing(false)
                  if (pendingTab) setActiveTab(pendingTab)
                  setPendingTab(null)
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
