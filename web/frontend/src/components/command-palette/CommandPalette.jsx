import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  MessageSquare, Volume2, Image, Music, Video, Code2, Layout, Settings,
  Search, X, FileText, GitBranch, GitCommit, Terminal, Sparkles,
  ChevronRight, Sun, Moon, Keyboard
} from 'lucide-react'

const NAV_ITEMS = [
  { id: 'chat', label: 'Chat', icon: MessageSquare, keywords: 'chat conversation messages agent' },
  { id: 'tts', label: 'Text to Speech', icon: Volume2, keywords: 'tts voice audio speech' },
  { id: 'image', label: 'Image Generation', icon: Image, keywords: 'image picture photo generate' },
  { id: 'music', label: 'Music Generation', icon: Music, keywords: 'music song audio generate' },
  { id: 'video', label: 'Video Generation', icon: Video, keywords: 'video hailuo generate' },
  { id: 'code', label: 'Coding Workspace', icon: Code2, keywords: 'code editor files terminal git' },
  { id: 'tasks', label: 'Task Board', icon: Layout, keywords: 'tasks kanban board project management' },
]

const ACTION_ITEMS = [
  { id: 'new-chat', label: 'Start New Chat', icon: Sparkles, action: 'new-chat', keywords: 'new chat conversation start' },
  { id: 'clear-chat', label: 'Clear Chat History', icon: X, action: 'clear-chat', keywords: 'clear reset chat history' },
  { id: 'toggle-theme', label: 'Toggle Light/Dark Theme', icon: Sun, action: 'toggle-theme', keywords: 'theme dark light mode' },
  { id: 'new-task', label: 'Create New Task', icon: Layout, action: 'new-task', keywords: 'new task create kanban board' },
  { id: 'open-settings', label: 'Open Quick Settings', icon: Settings, action: 'open-settings', keywords: 'settings configuration preferences' },
]

const GIT_ACTIONS = [
  { id: 'git-status', label: 'Git: Show Status', icon: GitBranch, action: 'git-status', keywords: 'git status branch' },
  { id: 'git-fetch', label: 'Git: Fetch Remote', icon: GitBranch, action: 'git-fetch', keywords: 'git fetch remote pull' },
  { id: 'git-pull', label: 'Git: Pull Changes', icon: GitBranch, action: 'git-pull', keywords: 'git pull merge update' },
  { id: 'git-log', label: 'Git: View Commit Log', icon: GitCommit, action: 'git-log', keywords: 'git log commits history' },
]

const SETTINGS_ITEMS = [
  { id: 'settings-api', label: 'Settings: API Keys', icon: Settings, action: 'settings-api', keywords: 'settings api key minimax token' },
  { id: 'settings-model', label: 'Settings: Model Selection', icon: Settings, action: 'settings-model', keywords: 'settings model m2.7 hailuo' },
  { id: 'settings-theme', label: 'Settings: Appearance', icon: Settings, action: 'settings-theme', keywords: 'settings theme appearance color' },
]

function fuzzyMatch(text, query) {
  if (!query) return true
  const t = text.toLowerCase()
  const q = query.toLowerCase()
  let ti = 0
  for (let qi = 0; qi < q.length; qi++) {
    const idx = t.indexOf(q[qi], ti)
    if (idx === -1) return false
    ti = idx + 1
  }
  return true
}

export default function CommandPalette({ isOpen, onClose, onNavigate, onAction, currentTab, isDark, onToggleTheme }) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [files, setFiles] = useState([])
  const [gitStatus, setGitStatus] = useState(null)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)

  // Fetch files and git status when palette opens
  useEffect(() => {
    if (!isOpen) {
      setQuery('')
      setSelectedIndex(0)
      return
    }
    // Load files
    fetch('/api/files?path=workspace')
      .then(r => r.json())
      .then(d => setFiles(d.entries || []))
      .catch(() => setFiles([]))
    // Load git status
    fetch('/api/git/status')
      .then(r => r.json())
      .then(d => setGitStatus(d))
      .catch(() => setGitStatus(null))
    // Focus input after a short delay
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [isOpen])

  const allItems = useMemo(() => {
    const items = []

    // Navigation group
    NAV_ITEMS.forEach(item => {
      items.push({
        group: 'Navigate',
        groupOrder: 1,
        id: `nav-${item.id}`,
        label: `Go to ${item.label}`,
        icon: item.icon,
        keywords: `${item.label} ${item.keywords}`,
        action: () => onNavigate(item.id),
      })
    })

    // Actions group
    ACTION_ITEMS.forEach(item => {
      items.push({
        group: 'Actions',
        groupOrder: 2,
        id: item.id,
        label: item.label,
        icon: item.icon,
        keywords: item.keywords,
        action: () => {
          if (item.action === 'toggle-theme') onToggleTheme()
          else onAction(item.action)
        },
      })
    })

    // Git group
    GIT_ACTIONS.forEach(item => {
      items.push({
        group: 'Git',
        groupOrder: 3,
        id: item.id,
        label: item.label,
        icon: item.icon,
        keywords: item.keywords,
        action: () => onAction(item.action),
      })
    })

    // Settings group
    SETTINGS_ITEMS.forEach(item => {
      items.push({
        group: 'Settings',
        groupOrder: 4,
        id: item.id,
        label: item.label,
        icon: item.icon,
        keywords: item.keywords,
        action: () => onAction(item.action),
      })
    })

    // Files group
    files.forEach(file => {
      items.push({
        group: 'Files',
        groupOrder: 5,
        id: `file-${file.path}`,
        label: file.name,
        icon: file.is_dir ? GitBranch : FileText,
        keywords: `${file.name} ${file.path}`,
        detail: file.path,
        action: () => {
          onNavigate('code')
          // The coding panel will need to handle opening this file
          window.dispatchEvent(new CustomEvent('openFile', { detail: file.path }))
        },
      })
    })

    // Branches from git status
    if (gitStatus?.branch) {
      items.push({
        group: 'Git',
        groupOrder: 3,
        id: 'git-current-branch',
        label: `Current Branch: ${gitStatus.branch}`,
        icon: GitBranch,
        keywords: `branch ${gitStatus.branch}`,
        action: () => onNavigate('code'),
      })
    }

    // Commits from git status
    if (gitStatus?.log) {
      gitStatus.log.slice(0, 5).forEach((commit, i) => {
        const hash = commit.split(' ')[0]
        const msg = commit.slice(hash.length + 1)
        items.push({
          group: 'Recent Commits',
          groupOrder: 6,
          id: `commit-${hash}`,
          label: msg,
          icon: GitCommit,
          keywords: `${hash} ${msg}`,
          detail: hash,
          action: () => onNavigate('code'),
        })
      })
    }

    return items
  }, [files, gitStatus, onNavigate, onAction, onToggleTheme])

  const filteredItems = useMemo(() => {
    if (!query.trim()) return allItems
    return allItems.filter(item => fuzzyMatch(item.keywords, query))
  }, [allItems, query])

  // Group items
  const groupedItems = useMemo(() => {
    const groups = {}
    filteredItems.forEach(item => {
      if (!groups[item.group]) groups[item.group] = []
      groups[item.group].push(item)
    })
    // Sort groups by groupOrder
    return Object.entries(groups).sort((a, b) => {
      const orderA = a[1][0]?.groupOrder || 99
      const orderB = b[1][0]?.groupOrder || 99
      return orderA - orderB
    })
  }, [filteredItems])

  // Flat list for keyboard navigation
  const flatItems = useMemo(() => {
    return groupedItems.flatMap(([, items]) => items)
  }, [groupedItems])

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(i => Math.min(i + 1, flatItems.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = flatItems[selectedIndex]
      if (item) {
        item.action()
        onClose()
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }, [flatItems, selectedIndex, onClose])

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${selectedIndex}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  if (!isOpen) return null

  let globalIndex = 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-2xl bg-card border border-border rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[70vh]">
        {/* Search header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search size={18} className="text-muted shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('palette.placeholder')}
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted focus:outline-none"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
          />
          <kbd className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface border border-border text-[10px] text-muted font-mono">
            <Keyboard size={10} /> ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="flex-1 overflow-y-auto py-2">
          {flatItems.length === 0 && (
            <div className="px-4 py-8 text-center text-muted text-sm">
              No results found for "{query}"
            </div>
          )}

          {groupedItems.map(([groupName, items]) => (
            <div key={groupName} className="mb-2">
              <div className="px-4 py-1.5 text-[10px] font-semibold text-muted uppercase tracking-wider">
                {groupName === 'Navigate' ? t('palette.navigate') :
                 groupName === 'Actions' ? t('palette.actions') :
                 groupName === 'Git' ? t('palette.git') :
                 groupName === 'Settings' ? t('palette.settings') :
                 groupName === 'Files' ? t('palette.files') :
                 groupName === 'Recent Commits' ? t('palette.recentCommits') :
                 groupName}
              </div>
              {items.map((item) => {
                const isSelected = globalIndex === selectedIndex
                const idx = globalIndex++
                const Icon = item.icon
                return (
                  <button
                    key={item.id}
                    data-index={idx}
                    onClick={() => { item.action(); onClose() }}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={`
                      w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors
                      ${isSelected ? 'bg-primary/10 text-foreground' : 'text-foreground hover:bg-surface'}
                    `}
                  >
                    <Icon size={16} className={isSelected ? 'text-primary' : 'text-muted'} />
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{item.label}</div>
                      {item.detail && (
                        <div className="text-xs text-muted truncate">{item.detail}</div>
                      )}
                    </div>
                    {isSelected && (
                      <ChevronRight size={14} className="text-muted shrink-0" />
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-border bg-surface/50 flex items-center gap-4 text-[10px] text-muted">
          <span className="flex items-center gap-1">
            <kbd className="px-1 rounded bg-card border border-border font-mono">↑↓</kbd> Navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1 rounded bg-card border border-border font-mono">Enter</kbd> Select
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1 rounded bg-card border border-border font-mono">Esc</kbd> Close
          </span>
          <span className="ml-auto">{flatItems.length} {t('palette.results')}</span>
        </div>
      </div>
    </div>
  )
}
