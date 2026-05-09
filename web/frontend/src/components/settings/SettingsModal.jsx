import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  X, Globe, Moon, Sun, Key, Cpu, Shield, Keyboard,
  Info, Check, AlertCircle, Save, RotateCcw, Eye, EyeOff,
  MapPin, BarChart3, Lock, Unlock, Search, Monitor, Palette, User, Trash2, Pencil, Activity
} from 'lucide-react'
import { useTheme } from '../../context/ThemeContext'

const TABS = [
  { id: 'general', label: 'General', icon: Globe },
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'theme', label: 'Theme', icon: Palette },
  { id: 'api', label: 'API Keys', icon: Key },
  { id: 'region', label: 'Region', icon: MapPin },
  { id: 'models', label: 'Models', icon: Cpu },
  { id: 'tools', label: 'Tools', icon: Search },
  { id: 'agent', label: 'Agent', icon: Shield },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
  { id: 'about', label: 'About', icon: Info },
]

const ALL_MODELS = [
  { id: 'MiniMax-M2.7', label: 'MiniMax-M2.7', desc: 'General purpose chat model', type: 'chat', plan: 'starter' },
  { id: 'MiniMax-Hailuo-2.3', label: 'MiniMax-Hailuo-2.3', desc: 'Video generation model', type: 'video', plan: 'max' },
  { id: 'MiniMax-speech-2.8', label: 'MiniMax-Speech-2.8', desc: 'Text-to-speech model', type: 'tts', plan: 'plus' },
  { id: 'MiniMax-image-01', label: 'MiniMax-Image-01', desc: 'Image generation model', type: 'image', plan: 'plus' },
  { id: 'music-2.6', label: 'MiniMax-Music-2.6', desc: 'Music generation model', type: 'music', plan: 'starter' },
]

const PLAN_LABELS = {
  starter: 'Starter',
  plus: 'Plus',
  max: 'Max',
}

const PLAN_ORDER = { starter: 1, plus: 2, max: 3 }

const SHORTCUTS = [
  { keys: 'Ctrl + K', action: 'Open Command Palette' },
  { keys: 'Ctrl + Enter', action: 'Send message' },
  { keys: 'Esc', action: 'Close modal / palette' },
  { keys: '↑ / ↓', action: 'Navigate palette items' },
  { keys: 'Enter', action: 'Select palette item' },
  { keys: 'Shift + Enter', action: 'New line in input' },
]

export default function SettingsModal({ isOpen, onClose, isDark, onToggleTheme }) {
  const { t, i18n } = useTranslation()
  const { theme, setTheme, mode, setMode, toggleMatrixEffect, matrixEffect, themes: THEME_LIST } = useTheme()
  const [activeTab, setActiveTab] = useState('general')
  const [config, setConfig] = useState({})
  const [savedMessage, setSavedMessage] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [localSettings, setLocalSettings] = useState({
    apiKey: '',
    apiKeyConfigured: false,
    model: 'MiniMax-M2.7',
    maxSteps: 50,
    workspaceDir: './workspace',
    systemPrompt: '',
    region: 'global',
    webSearch: true,
    understandImage: true,
  })
  const [userProfile, setUserProfile] = useState({ bio: '' })
  const [profileSaving, setProfileSaving] = useState(false)
  const [userPlan, setUserPlan] = useState('starter')
  const [quotaData, setQuotaData] = useState(null)
  const [mcpServers, setMcpServers] = useState([])
  const [mcpLoading, setMcpLoading] = useState(false)
  const [mcpError, setMcpError] = useState(null)
  const [mcpFormVisible, setMcpFormVisible] = useState(false)
  const [mcpEditingId, setMcpEditingId] = useState(null)
  const [mcpForm, setMcpForm] = useState({
    name: '',
    transport: 'stdio',
    command: '',
    args: '',
    env: '',
    url: '',
    enabled: true,
  })
  const [mcpTestResults, setMcpTestResults] = useState({})

  const fetchMcpServers = async () => {
    setMcpLoading(true)
    setMcpError(null)
    try {
      const res = await fetch('/api/mcp/servers')
      const data = await res.json()
      if (data.success) setMcpServers(data.servers || [])
    } catch (e) {
      setMcpError('Failed to load MCP servers')
    }
    setMcpLoading(false)
  }

  const resetMcpForm = () => {
    setMcpForm({ name: '', transport: 'stdio', command: '', args: '', env: '', url: '', enabled: true })
    setMcpEditingId(null)
    setMcpFormVisible(false)
  }

  const openMcpEdit = (server) => {
    setMcpForm({
      name: server.name || '',
      transport: server.transport || 'stdio',
      command: server.command || '',
      args: (server.args || []).join('\n'),
      env: Object.entries(server.env || {}).map(([k, v]) => `${k}=${v}`).join('\n'),
      url: server.url || '',
      enabled: server.enabled ?? true,
    })
    setMcpEditingId(server.id)
    setMcpFormVisible(true)
  }

  const submitMcpForm = async () => {
    const payload = {
      name: mcpForm.name.trim(),
      transport: mcpForm.transport,
      command: mcpForm.command.trim() || null,
      args: mcpForm.args.split('\n').map(s => s.trim()).filter(Boolean),
      env: Object.fromEntries(
        mcpForm.env.split('\n').map(s => s.trim()).filter(Boolean).map(line => {
          const [k, ...v] = line.split('=')
          return [k.trim(), v.join('=').trim()]
        })
      ),
      url: mcpForm.url.trim() || null,
      enabled: mcpForm.enabled,
    }
    try {
      const url = mcpEditingId ? `/api/mcp/servers/${mcpEditingId}` : '/api/mcp/servers'
      const method = mcpEditingId ? 'PUT' : 'POST'
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const data = await res.json()
      if (data.success) {
        setSavedMessage(mcpEditingId ? 'Server updated' : 'Server added')
        setTimeout(() => setSavedMessage(''), 2000)
        resetMcpForm()
        fetchMcpServers()
      } else {
        setMcpError(data.detail || 'Failed to save')
      }
    } catch (e) {
      setMcpError('Failed to save server')
    }
  }

  const toggleMcpServer = async (id) => {
    try {
      const res = await fetch(`/api/mcp/servers/${id}/toggle`, { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        setMcpServers(prev => prev.map(s => s.id === id ? { ...s, enabled: data.enabled } : s))
      }
    } catch { /* ignore */ }
  }

  const deleteMcpServer = async (id) => {
    try {
      const res = await fetch(`/api/mcp/servers/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.success) {
        setSavedMessage('Server removed')
        setTimeout(() => setSavedMessage(''), 2000)
        fetchMcpServers()
      }
    } catch { /* ignore */ }
  }

  const testMcpServer = async (id) => {
    setMcpTestResults(prev => ({ ...prev, [id]: { loading: true } }))
    try {
      const res = await fetch(`/api/mcp/servers/${id}/test`, { method: 'POST' })
      const data = await res.json()
      setMcpTestResults(prev => ({ ...prev, [id]: { loading: false, result: data } }))
    } catch (e) {
      setMcpTestResults(prev => ({ ...prev, [id]: { loading: false, error: e.message || 'Test failed' } }))
    }
  }

  useEffect(() => {
    if (!isOpen) return
    fetch('/api/config')
      .then(r => r.json())
      .then(data => {
        setConfig(data)
        setLocalSettings(prev => ({
          ...prev,
          apiKey: '',
          apiKeyConfigured: data.api_key_configured || false,
          model: data.agent?.model || 'MiniMax-M2.7',
          maxSteps: data.agent?.max_steps || 50,
          workspaceDir: data.agent?.workspace_dir || './workspace',
          systemPrompt: data.agent?.system_prompt || '',
          region: data.region || 'global',
          webSearch: data.tools?.web_search ?? true,
          understandImage: data.tools?.understand_image ?? true,
        }))
        if (data.mcp_servers) setMcpServers(data.mcp_servers)
      })
      .catch(() => setConfig({}))

    fetchMcpServers()

    // Load user profile
    fetch('/api/profile')
      .then(r => r.json())
      .then(data => setUserProfile({ bio: data.bio || '' }))
      .catch(() => {})
    
    // Fetch quota to detect plan
    fetch('/api/minimax/quota')
      .then(r => r.json())
      .then(data => {
        if (data.success && data.data?.model_remains) {
          setQuotaData(data.data)
          // Detect plan based on M2.7 quota
          const m2Model = data.data.model_remains.find(m => 
            (m.model_name || '').toLowerCase().includes('minimax-m')
          )
          if (m2Model) {
            const total = m2Model.current_interval_total_count || 0
            if (total >= 15000) setUserPlan('max')
            else if (total >= 4500) setUserPlan('plus')
            else setUserPlan('starter')
          }
        }
      })
      .catch(() => {})
  }, [isOpen])

  const handleSave = async () => {
    try {
      // In a real app, this would save to the backend
      // For now, we show a success message
      setSavedMessage('Settings saved successfully!')
      setTimeout(() => setSavedMessage(''), 3000)
    } catch (e) {
      setSavedMessage('Failed to save settings')
    }
  }

  const handleSaveProfile = async () => {
    setProfileSaving(true)
    try {
      await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userProfile)
      })
      setSavedMessage('Profile saved!')
      setTimeout(() => setSavedMessage(''), 3000)
    } catch (e) {
      setSavedMessage('Failed to save profile')
    } finally {
      setProfileSaving(false)
    }
  }

  const handleReset = () => {
    setLocalSettings({
      apiKey: '',
      apiKeyConfigured: false,
      model: 'MiniMax-M2.7',
      maxSteps: 50,
      workspaceDir: './workspace',
      systemPrompt: '',
      region: 'global',
    })
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-2xl bg-card border border-border rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="text-sm font-semibold">Settings</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-surface text-muted">
            <X size={16} />
          </button>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Sidebar tabs */}
          <div className="w-44 border-r border-border bg-surface/30 flex flex-col py-2">
            {TABS.map((tab) => {
              const Icon = tab.icon
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-2 text-xs font-medium transition-colors text-left ${
                    activeTab === tab.id
                      ? 'bg-primary/10 text-primary border-r-2 border-r-primary'
                      : 'text-muted-foreground hover:bg-surface hover:text-foreground'
                  }`}
                >
                  <Icon size={14} />
                  {tab.label}
                </button>
              )
            })}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-5">
            {/* General */}
            {activeTab === 'general' && (
              <div className="space-y-5">
                <div>
                  <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">Language</h3>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { code: 'en', label: 'English', tip: 'Switch interface language to English' },
                      { code: 'pt-BR', label: 'Português', tip: 'Mudar idioma da interface para Português' },
                      { code: 'ja', label: '日本語', tip: 'インターフェース言語を日本語に変更' },
                      { code: 'ko', label: '한국어', tip: '인터페이스 언어를 한국어로 변경' },
                      { code: 'es', label: 'Español', tip: 'Cambiar idioma de la interfaz a Español' },
                      { code: 'zh-CN', label: '简体中文', tip: '将界面语言切换为简体中文' },
                    ].map((lang) => (
                      <button
                        key={lang.code}
                        onClick={() => i18n.changeLanguage(lang.code)}
                        className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs transition-colors ${
                          i18n.language === lang.code
                            ? 'bg-primary/10 text-primary border border-primary/20'
                            : 'bg-surface border border-border text-foreground hover:border-primary'
                        }`}
                      >
                        {i18n.language === lang.code && <Check size={10} />}
                        <span title={lang.tip}>{lang.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

              </div>
            )}

            {/* Profile */}
            {activeTab === 'profile' && (
              <div className="space-y-5">
                <div>
                  <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">About You</h3>
                  <p className="text-[11px] text-muted mb-3 leading-relaxed">
                    Tell the agent about yourself — your preferences, background, goals, or anything you want it to remember across all conversations.
                  </p>
                  <textarea
                    value={userProfile.bio}
                    onChange={(e) => setUserProfile({ bio: e.target.value })}
                    placeholder="e.g. I'm a full-stack developer based in Brazil. I prefer clean, modern UI designs and work mainly with React and Python. I speak Portuguese and English."
                    rows={8}
                    className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted resize-none focus:outline-none focus:border-primary transition-colors"
                  />
                  <div className="flex justify-between items-center mt-3">
                    <p className="text-[10px] text-muted">This bio is injected into every conversation automatically.</p>
                    <button
                      onClick={handleSaveProfile}
                      disabled={profileSaving}
                      className="px-4 py-2 bg-primary hover:bg-primary-hover disabled:opacity-40 text-white rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5"
                    >
                      <Save size={12} />
                      {profileSaving ? 'Saving...' : 'Save Profile'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Theme */}
            {activeTab === 'theme' && (
              <div className="space-y-5">
                {/* Mode Toggle */}
                <div>
                  <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">Appearance Mode</h3>
                  <div className="flex gap-2">
                    {[
                      { id: 'light', label: 'Light', icon: Sun },
                      { id: 'dark', label: 'Dark', icon: Moon },
                      { id: 'system', label: 'System', icon: Monitor },
                    ].map((m) => {
                      const Icon = m.icon
                      return (
                        <button
                          key={m.id}
                          onClick={() => setMode(m.id)}
                          className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-xs font-medium transition-colors ${
                            mode === m.id
                              ? 'bg-primary/10 border-primary text-primary'
                              : 'bg-surface border-border text-muted-foreground hover:border-primary'
                          }`}
                        >
                          <Icon size={14} />
                          {m.label}
                        </button>
                      )
                    })}
                  </div>
                  <p className="text-[10px] text-muted mt-2">
                    {mode === 'system' ? 'Follows your system preference' : mode === 'dark' ? 'Dark mode is active' : 'Light mode is active'}
                  </p>
                </div>

                {/* Theme Grid with Split Preview */}
                <div>
                  <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">Color Theme</h3>
                  <div className="grid grid-cols-3 gap-2">
                    {THEME_LIST.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => setTheme(t.id)}
                        className={`flex flex-col items-center gap-2 px-2 py-3 rounded-lg border transition-colors ${
                          theme === t.id
                            ? 'bg-primary/10 border-primary text-primary'
                            : 'bg-surface border-border text-muted-foreground hover:border-primary'
                        }`}
                        title={t.name}
                      >
                        {/* Split preview */}
                        <div className="flex w-full h-10 rounded-md overflow-hidden border border-border/50">
                          <div
                            className="flex-1 flex items-center justify-center"
                            style={{ backgroundColor: t.preview.lightBg }}
                          >
                            <span className="text-sm font-bold" style={{ color: t.preview.lightText }}>Aa</span>
                          </div>
                          <div
                            className="flex-1 flex items-center justify-center"
                            style={{ backgroundColor: t.preview.darkBg }}
                          >
                            <span className="text-sm font-bold" style={{ color: t.preview.darkText }}>Aa</span>
                          </div>
                        </div>
                        <span className="text-[10px] font-medium">{t.name}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Matrix Effect Toggle */}
                {theme === 'matrix' && (
                  <div className="flex items-center justify-between p-3 bg-surface border border-border rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-green-500/10 flex items-center justify-center">
                        <span className="text-green-400 text-xs font-mono">Mx</span>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">Matrix Rain Effect</p>
                        <p className="text-xs text-muted">Animated code rain background</p>
                      </div>
                    </div>
                    <button
                      onClick={toggleMatrixEffect}
                      className={`w-11 h-6 rounded-full transition-colors relative ${
                        matrixEffect ? 'bg-green-500' : 'bg-muted/30'
                      }`}
                    >
                      <div className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-transform ${
                        matrixEffect ? 'translate-x-6' : 'translate-x-1'
                      }`} />
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* API Keys */}
            {activeTab === 'api' && (
              <div className="space-y-5">
                <div>
                  <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">MiniMax API Key</h3>
                  <div className="space-y-2">
                    <div className="relative">
                      <input
                        type={showApiKey ? 'text' : 'password'}
                        value={localSettings.apiKey}
                        onChange={(e) => setLocalSettings(s => ({ ...s, apiKey: e.target.value }))}
                        placeholder="Enter your MiniMax API key..."
                        className="w-full bg-surface border border-border rounded-lg px-3 py-2 pr-10 text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-primary"
                      />
                      <button
                        onClick={() => setShowApiKey(!showApiKey)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted hover:text-foreground"
                      >
                        {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                    <p className="text-[10px] text-muted">
                      Your API key is stored securely and never shared. Get one at{' '}
                      <a href="https://api.minimax.io" target="_blank" rel="noopener" className="text-primary hover:underline">api.minimax.io</a>
                    </p>
                  </div>
                </div>

                <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${localSettings.apiKeyConfigured ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
                  {localSettings.apiKeyConfigured ? <Check size={14} className="text-green-500" /> : <AlertCircle size={14} className="text-amber-500" />}
                  <span className={`text-xs font-medium ${localSettings.apiKeyConfigured ? 'text-green-700' : 'text-amber-700'}`}>
                    {localSettings.apiKeyConfigured ? 'API Key configured' : 'API Key not configured'}
                  </span>
                </div>
              </div>
            )}

            {/* Region */}
            {activeTab === 'region' && (
              <div className="space-y-5">
                <div>
                  <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">API Region</h3>
                  <div className="space-y-2">
                    {[
                      { code: 'global', label: 'Global', desc: 'api.minimax.io — International users', flag: '🌐', tip: 'Use MiniMax global API (for users outside mainland China)' },
                      { code: 'cn', label: 'China (CN)', desc: 'api.minimaxi.com — Chinese users', flag: '🇨🇳', tip: 'Use MiniMax China API (for users in mainland China)' },
                    ].map((r) => (
                      <button
                        key={r.code}
                        onClick={() => setLocalSettings(s => ({ ...s, region: r.code }))}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg border transition-colors text-left ${
                          localSettings.region === r.code
                            ? 'bg-primary/10 border-primary text-primary'
                            : 'bg-surface border-border text-foreground hover:border-primary'
                        }`}
                      >
                        <span className="text-lg">{r.flag}</span>
                        <div className="flex-1">
                          <div className="text-sm font-medium" title={r.tip}>{r.label}</div>
                          <div className="text-[10px] text-muted">{r.desc}</div>
                        </div>
                        {localSettings.region === r.code && <Check size={14} />}
                      </button>
                    ))}
                  </div>
                </div>
                <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${localSettings.region === 'cn' ? 'bg-red-50 border-red-200' : 'bg-blue-50 border-blue-200'}`}>
                  <MapPin size={14} className={localSettings.region === 'cn' ? 'text-red-500' : 'text-blue-500'} />
                  <span className={`text-xs font-medium ${localSettings.region === 'cn' ? 'text-red-700' : 'text-blue-700'}`}>
                    {localSettings.region === 'cn' ? 'China region selected — Plans and quotas may differ' : 'Global region selected'}
                  </span>
                </div>
              </div>
            )}

            {/* Models */}
            {activeTab === 'models' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-muted uppercase tracking-wider">Your Token Plan</h3>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                    {PLAN_LABELS[userPlan] || 'Starter'} Plan
                  </span>
                </div>

                {/* Included models — fixed, non-clickable */}
                <div className="space-y-2">
                  <p className="text-[10px] text-muted">Included in your plan:</p>
                  {ALL_MODELS.filter(m => PLAN_ORDER[m.plan] <= PLAN_ORDER[userPlan]).map((model) => (
                    <div
                      key={model.id}
                      className="flex items-center gap-3 px-4 py-3 rounded-lg bg-success/5 border border-success/20"
                    >
                      <Check size={16} className="text-success shrink-0" />
                      <div className="flex-1">
                        <div className="text-sm font-medium text-foreground">{model.label}</div>
                        <div className="text-[10px] text-muted">{model.desc}</div>
                      </div>
                      <span className="text-[10px] text-success font-medium">Included</span>
                    </div>
                  ))}
                </div>

                {/* Not included */}
                {ALL_MODELS.filter(m => PLAN_ORDER[m.plan] > PLAN_ORDER[userPlan]).length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[10px] text-muted">Not included — requires upgrade:</p>
                    {ALL_MODELS.filter(m => PLAN_ORDER[m.plan] > PLAN_ORDER[userPlan]).map((model) => (
                      <div
                        key={model.id}
                        className="flex items-center gap-3 px-4 py-3 rounded-lg bg-surface/50 border border-border/50 opacity-50"
                      >
                        <Cpu size={16} className="text-muted shrink-0" />
                        <div className="flex-1">
                          <div className="text-sm font-medium text-muted">{model.label}</div>
                          <div className="text-[10px] text-muted">{model.desc}</div>
                        </div>
                        <span className="text-[10px] text-muted font-medium">{PLAN_LABELS[model.plan]}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Tools */}
            {activeTab === 'tools' && (
              <div className="space-y-6">
                {/* Built-in MiniMax Tools */}
                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-1">Built-in MiniMax Tools</h3>
                  <p className="text-xs text-muted mb-4">Enable or disable tools available to the agent. These require a MiniMax Token Plan API key.</p>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between p-3 bg-surface border border-border rounded-lg">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                          <Search size={14} className="text-primary" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">Web Search</p>
                          <p className="text-xs text-muted">Search the web for real-time information</p>
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          const newVal = !localSettings.webSearch
                          setLocalSettings({ ...localSettings, webSearch: newVal })
                          fetch('/api/config/tools', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              web_search: newVal,
                              understand_image: localSettings.understandImage,
                            }),
                          }).then(() => setSavedMessage('Tools updated')).catch(() => {})
                          setTimeout(() => setSavedMessage(''), 2000)
                        }}
                        className={`w-11 h-6 rounded-full transition-colors relative ${
                          localSettings.webSearch ? 'bg-primary' : 'bg-muted/30'
                        }`}
                      >
                        <div className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-transform ${
                          localSettings.webSearch ? 'translate-x-6' : 'translate-x-1'
                        }`} />
                      </button>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-surface border border-border rounded-lg">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                          <Eye size={14} className="text-primary" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">Image Understanding</p>
                          <p className="text-xs text-muted">Analyze and describe image content</p>
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          const newVal = !localSettings.understandImage
                          setLocalSettings({ ...localSettings, understandImage: newVal })
                          fetch('/api/config/tools', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              web_search: localSettings.webSearch,
                              understand_image: newVal,
                            }),
                          }).then(() => setSavedMessage('Tools updated')).catch(() => {})
                          setTimeout(() => setSavedMessage(''), 2000)
                        }}
                        className={`w-11 h-6 rounded-full transition-colors relative ${
                          localSettings.understandImage ? 'bg-primary' : 'bg-muted/30'
                        }`}
                      >
                        <div className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-transform ${
                          localSettings.understandImage ? 'translate-x-6' : 'translate-x-1'
                        }`} />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Custom MCP Servers */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">Custom MCP Servers</h3>
                      <p className="text-xs text-muted">Add and manage external MCP servers.</p>
                    </div>
                    <button
                      onClick={() => { resetMcpForm(); setMcpFormVisible(true) }}
                      className="px-3 py-1.5 bg-primary hover:bg-primary-hover text-white text-xs rounded-lg transition-colors flex items-center gap-1.5"
                    >
                      <span>+</span> Add MCP Server
                    </button>
                  </div>

                  {mcpLoading && <p className="text-xs text-muted">Loading...</p>}
                  {mcpError && <p className="text-xs text-error">{mcpError}</p>}

                  {mcpFormVisible && (
                    <div className="p-3 bg-surface border border-border rounded-lg space-y-3 mb-3">
                      <div>
                        <label className="text-[10px] text-muted uppercase tracking-wider mb-1 block">Name</label>
                        <input
                          type="text"
                          value={mcpForm.name}
                          onChange={(e) => setMcpForm(f => ({ ...f, name: e.target.value }))}
                          placeholder="e.g. Local Filesystem"
                          className="w-full bg-card border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:border-primary"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-muted uppercase tracking-wider mb-1 block">Transport</label>
                        <select
                          value={mcpForm.transport}
                          onChange={(e) => setMcpForm(f => ({ ...f, transport: e.target.value }))}
                          className="w-full bg-card border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:border-primary"
                        >
                          <option value="stdio">stdio</option>
                          <option value="sse">sse</option>
                          <option value="http">http</option>
                        </select>
                      </div>
                      {mcpForm.transport === 'stdio' && (
                        <div>
                          <label className="text-[10px] text-muted uppercase tracking-wider mb-1 block">Command</label>
                          <input
                            type="text"
                            value={mcpForm.command}
                            onChange={(e) => setMcpForm(f => ({ ...f, command: e.target.value }))}
                            placeholder="e.g. npx"
                            className="w-full bg-card border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:border-primary"
                          />
                        </div>
                      )}
                      {mcpForm.transport === 'stdio' && (
                        <div>
                          <label className="text-[10px] text-muted uppercase tracking-wider mb-1 block">Args (one per line)</label>
                          <textarea
                            value={mcpForm.args}
                            onChange={(e) => setMcpForm(f => ({ ...f, args: e.target.value }))}
                            placeholder="-y&#10;@modelcontextprotocol/server-filesystem&#10;./workspace"
                            rows={3}
                            className="w-full bg-card border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:border-primary resize-none"
                          />
                        </div>
                      )}
                      {mcpForm.transport !== 'stdio' && (
                        <div>
                          <label className="text-[10px] text-muted uppercase tracking-wider mb-1 block">URL</label>
                          <input
                            type="text"
                            value={mcpForm.url}
                            onChange={(e) => setMcpForm(f => ({ ...f, url: e.target.value }))}
                            placeholder="https://example.com/mcp"
                            className="w-full bg-card border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:border-primary"
                          />
                        </div>
                      )}
                      <div>
                        <label className="text-[10px] text-muted uppercase tracking-wider mb-1 block">Env (KEY=VALUE per line)</label>
                        <textarea
                          value={mcpForm.env}
                          onChange={(e) => setMcpForm(f => ({ ...f, env: e.target.value }))}
                          placeholder="API_KEY=xxx&#10;DEBUG=true"
                          rows={2}
                          className="w-full bg-card border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:border-primary resize-none"
                        />
                      </div>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={mcpForm.enabled}
                          onChange={(e) => setMcpForm(f => ({ ...f, enabled: e.target.checked }))}
                          className="rounded border-border text-primary"
                        />
                        <span className="text-xs text-foreground">Enabled</span>
                      </label>
                      <div className="flex gap-2">
                        <button
                          onClick={submitMcpForm}
                          disabled={!mcpForm.name.trim()}
                          className="flex-1 py-1.5 bg-primary hover:bg-primary-hover disabled:opacity-40 text-white text-xs rounded-lg transition-colors"
                        >
                          {mcpEditingId ? 'Update' : 'Save'}
                        </button>
                        <button
                          onClick={resetMcpForm}
                          className="flex-1 py-1.5 bg-surface hover:bg-surface/80 border border-border text-foreground text-xs rounded-lg transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {mcpServers.length === 0 && !mcpLoading && (
                    <p className="text-xs text-muted py-2">No custom MCP servers configured yet.</p>
                  )}

                  <div className="space-y-2">
                    {mcpServers.map(server => (
                      <div key={server.id} className="p-3 bg-surface border border-border rounded-lg space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-foreground">{server.name}</p>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${
                              server.enabled
                                ? 'bg-green-400/10 text-green-400 border-green-400/20'
                                : 'bg-muted/20 text-muted border-border'
                            }`}>
                              {server.enabled ? 'Enabled' : 'Disabled'}
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => testMcpServer(server.id)}
                              className="p-1.5 rounded hover:bg-surface text-muted hover:text-foreground transition-colors"
                              title="Test connection"
                            >
                              <Activity size={12} />
                            </button>
                            <button
                              onClick={() => toggleMcpServer(server.id)}
                              className="p-1.5 rounded hover:bg-surface text-muted hover:text-foreground transition-colors"
                              title={server.enabled ? 'Disable' : 'Enable'}
                            >
                              {server.enabled ? <Unlock size={12} /> : <Lock size={12} />}
                            </button>
                            <button
                              onClick={() => openMcpEdit(server)}
                              className="p-1.5 rounded hover:bg-surface text-muted hover:text-foreground transition-colors"
                              title="Edit"
                            >
                              <Pencil size={12} />
                            </button>
                            <button
                              onClick={() => deleteMcpServer(server.id)}
                              className="p-1.5 rounded hover:bg-error/10 text-muted hover:text-error transition-colors"
                              title="Delete"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-muted">
                          <span className="px-1.5 py-0.5 bg-card border border-border rounded">{server.transport}</span>
                          <span className="truncate">
                            {server.transport === 'stdio'
                              ? (server.command || '-') + ' ' + (server.args || []).join(' ')
                              : (server.url || '-')
                            }
                          </span>
                        </div>
                        {/* Test result */}
                        {mcpTestResults[server.id] && (
                          <div className="mt-1">
                            {mcpTestResults[server.id].loading && (
                              <div className="flex items-center gap-1.5 text-[10px] text-muted">
                                <span className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                                Testing connection...
                              </div>
                            )}
                            {mcpTestResults[server.id].result && (
                              <div>
                                {mcpTestResults[server.id].result.success ? (
                                  <div className="text-[10px] space-y-1">
                                    <div className="flex items-center gap-1 text-green-400">
                                      <Check size={10} />
                                      <span>Connected — {mcpTestResults[server.id].result.tool_count} tool(s) discovered</span>
                                    </div>
                                    {mcpTestResults[server.id].result.tools && mcpTestResults[server.id].result.tools.length > 0 && (
                                      <div className="pl-4 space-y-0.5">
                                        {mcpTestResults[server.id].result.tools.map((tool, idx) => (
                                          <div key={idx} className="text-muted">
                                            <span className="font-medium text-foreground">{tool.name}</span>
                                            {tool.description && <span className="ml-1">— {tool.description}</span>}
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1 text-[10px] text-error">
                                    <AlertCircle size={10} />
                                    <span>{mcpTestResults[server.id].result.error || 'Connection failed'}</span>
                                  </div>
                                )}
                              </div>
                            )}
                            {mcpTestResults[server.id].error && (
                              <div className="flex items-center gap-1 text-[10px] text-error">
                                <AlertCircle size={10} />
                                <span>{mcpTestResults[server.id].error}</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {savedMessage && (
                  <p className="text-xs text-success flex items-center gap-1">
                    <Check size={12} /> {savedMessage}
                  </p>
                )}
              </div>
            )}

            {/* Agent */}
            {activeTab === 'agent' && (
              <div className="space-y-5">
                <div>
                  <label className="text-xs font-semibold text-muted uppercase tracking-wider mb-1 block">Max Steps</label>
                  <input
                    type="number"
                    value={localSettings.maxSteps}
                    onChange={(e) => setLocalSettings(s => ({ ...s, maxSteps: parseInt(e.target.value) || 50 }))}
                    className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
                  />
                  <p className="text-[10px] text-muted mt-1">Maximum number of reasoning steps per request</p>
                </div>

                <div>
                  <label className="text-xs font-semibold text-muted uppercase tracking-wider mb-1 block">Workspace Directory</label>
                  <input
                    type="text"
                    value={localSettings.workspaceDir}
                    onChange={(e) => setLocalSettings(s => ({ ...s, workspaceDir: e.target.value }))}
                    className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-muted uppercase tracking-wider mb-1 block">System Prompt</label>
                  <textarea
                    value={localSettings.systemPrompt}
                    onChange={(e) => setLocalSettings(s => ({ ...s, systemPrompt: e.target.value }))}
                    placeholder="Custom system prompt for the agent..."
                    rows={4}
                    className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-primary resize-none"
                  />
                  <p className="text-[10px] text-muted mt-1">Leave empty to use the default system prompt</p>
                </div>
              </div>
            )}

            {/* Shortcuts */}
            {activeTab === 'shortcuts' && (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">Keyboard Shortcuts</h3>
                {SHORTCUTS.map((shortcut, i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-2 rounded-lg bg-surface">
                    <span className="text-xs text-foreground">{shortcut.action}</span>
                    <kbd className="px-2 py-1 rounded bg-card border border-border text-[10px] font-mono text-muted">
                      {shortcut.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            )}

            {/* About */}
            {activeTab === 'about' && (
              <div className="space-y-5">
                <div className="text-center py-4">
                  <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center mx-auto mb-4">
                    <span className="text-white font-bold text-2xl">M</span>
                  </div>
                  <h3 className="text-lg font-semibold">MiniMax Agent</h3>
                  <p className="text-xs text-muted">All-in-One Platform for MiniMax Token Plan</p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-surface text-xs">
                    <span className="text-muted">Version</span>
                    <span className="font-mono text-foreground">0.3.0</span>
                  </div>
                  <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-surface text-xs">
                    <span className="text-muted">Backend</span>
                    <span className="font-mono text-foreground">FastAPI + Python 3.10+</span>
                  </div>
                  <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-surface text-xs">
                    <span className="text-muted">Frontend</span>
                    <span className="font-mono text-foreground">React 18 + Vite + Tailwind</span>
                  </div>
                  <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-surface text-xs">
                    <span className="text-muted">API Base</span>
                    <span className="font-mono text-foreground">https://api.minimax.io</span>
                  </div>
                </div>

                <div className="text-center">
                  <a
                    href="https://github.com/minimax-io"
                    target="_blank"
                    rel="noopener"
                    className="text-xs text-primary hover:underline"
                  >
                    github.com/minimax-io
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-border bg-surface/50">
          {savedMessage && (
            <span className={`text-xs ${savedMessage.includes('success') ? 'text-primary' : 'text-error'}`}>
              {savedMessage}
            </span>
          )}
          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={handleReset}
              className="px-3 py-1.5 text-xs text-muted hover:text-foreground transition-colors flex items-center gap-1.5"
            >
              <RotateCcw size={12} /> Reset
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-1.5 bg-primary hover:bg-primary-hover text-white rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5"
            >
              <Save size={12} /> Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
