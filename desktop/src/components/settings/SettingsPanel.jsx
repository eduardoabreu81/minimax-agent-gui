import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Globe, Moon, Sun, Key, Cpu, Shield, Keyboard,
  Info, Check, AlertCircle, Save, RotateCcw, Eye, EyeOff,
  MapPin, BarChart3, Lock, Unlock, Search, Monitor, Palette, User, Trash2, Pencil, Activity, Server,
  Boxes, Sparkles, Github, Sliders, Loader2, Brain
} from 'lucide-react'
import { useTheme } from '../../context/ThemeContext'
import { apiFetch } from '../../lib/api.js'
import SkillsTab from './SkillsTab.jsx'
import { useContextModal } from '../agent-context/ContextProvider.jsx'

// Models available in the Token Plan. Chat models are the ones the user
// can pick as their default — media models (image / video / speech / music)
// are picked inside their own panels, not here.
const ALL_MODELS = [
  { id: 'MiniMax-M3', label: 'MiniMax-M3', desc: 'Frontier multimodal coding model (1M context, agentic tool use)', type: 'chat', plan: 'plus' },
  { id: 'MiniMax-M2.7', label: 'MiniMax-M2.7', desc: 'Beginning the journey of recursive self-improvement (200k context, ~60 tps)', type: 'chat', plan: 'plus' },
  { id: 'MiniMax-M2.7-highspeed', label: 'MiniMax-M2.7-highspeed', desc: 'Same performance, faster and more agile (200k context, ~100 tps)', type: 'chat', plan: 'plus' },
  { id: 'MiniMax-Hailuo-2.3', label: 'MiniMax-Hailuo-2.3', desc: 'Video generation model', type: 'video', plan: 'max' },
  { id: 'MiniMax-speech-2.8', label: 'MiniMax-Speech-2.8', desc: 'Text-to-speech model', type: 'tts', plan: 'plus' },
  { id: 'MiniMax-image-01', label: 'MiniMax-Image-01', desc: 'Image generation model', type: 'image', plan: 'plus' },
  { id: 'music-2.6', label: 'MiniMax-Music-2.6', desc: 'Music generation model', type: 'music', plan: 'plus' },
]

const PLAN_LABELS = {
  plus: 'Plus',
  max: 'Max',
  ultra: 'Ultra',
}

const PLAN_ORDER = { plus: 0, max: 1, ultra: 2 }

// Shortcut labels are resolved via t(`settings.${actionKey}`) in JSX so
// the action text follows the active i18n language without re-mapping.
const SHORTCUTS = [
  { keys: 'Ctrl + K', actionKey: 'openPalette' },
  { keys: 'Ctrl + Enter', actionKey: 'sendMessage' },
  { keys: 'Esc', actionKey: 'closeModal' },
  { keys: '↑ / ↓', actionKey: 'navigatePalette' },
  { keys: 'Enter', actionKey: 'selectPalette' },
  { keys: 'Shift + Enter', actionKey: 'newLine' },
]

// Language list — labels are the language's own name (not translated),
// because they're literally what the user picks.
const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'pt-BR', label: 'Português' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'es', label: 'Español' },
  { code: 'zh-CN', label: '简体中文' },
]

const REGIONS = [
  { code: 'global', label: 'Global · api.minimax.io', desc: 'International users' },
  { code: 'cn', label: 'China · api.minimaxi.com', desc: 'Mainland China users' },
]

// Mirrors the validation sets in web/backend/main.py
// GenerationDefaultsAudio — keep in sync if the backend enum expands.
const AUDIO_FORMAT_OPTIONS = ['mp3', 'pcm', 'flac', 'wav']
const AUDIO_SAMPLE_RATE_OPTIONS = [8000, 16000, 22050, 24000, 32000, 44100]
const AUDIO_BITRATE_OPTIONS = [32000, 64000, 128000, 256000]
const AUDIO_DEFAULT = { format: 'mp3', sample_rate: 32000, bitrate: 128000, channel: 1 }

// ─────────────────────────────────────────────────────────────────────────────
// Small layout primitives — kept inline so the section JSX stays readable.
// ─────────────────────────────────────────────────────────────────────────────

function SectionHeader({ icon: Icon, title, id }) {
  return (
    <div id={id} className="flex items-center gap-2 text-[13px] font-semibold mb-3.5 scroll-mt-6">
      {Icon && <Icon size={16} className="text-primary" />}
      <span>{title}</span>
    </div>
  )
}

function Card({ children, className = '' }) {
  return (
    <div className={`border border-border rounded-[14px] bg-card overflow-hidden mb-6 ${className}`}>
      {children}
    </div>
  )
}

function Row({ children, label, desc, last = false }) {
  return (
    <div className={`flex items-center justify-between gap-4 px-5 py-4 ${last ? '' : 'border-b border-border'}`}>
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-foreground">{label}</div>
        {desc && <div className="text-[11.5px] text-muted-foreground mt-0.5">{desc}</div>}
      </div>
      <div className="flex items-center gap-2 shrink-0">{children}</div>
    </div>
  )
}

function Toggle({ on, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onChange}
      className={`relative w-[40px] h-[23px] rounded-[12px] transition-colors ${on ? 'bg-primary' : 'bg-secondary'}`}
    >
      <span
        className={`absolute top-[2px] w-[19px] h-[19px] rounded-full bg-white shadow-sm transition-all ${on ? 'left-[19px]' : 'left-[2px]'}`}
      />
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

export default function SettingsPanel() {
  const { t, i18n } = useTranslation()
  const { theme, setTheme, mode, setMode, toggleMatrixEffect, matrixEffect, themes: THEME_LIST } = useTheme()

  const [config, setConfig] = useState({})
  const [savedMessage, setSavedMessage] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [activeSection, setActiveSection] = useState('appearance')
  const [localSettings, setLocalSettings] = useState({
    apiKey: '',
    apiKeyConfigured: false,
    model: 'MiniMax-M3',
    maxSteps: 50,
    // ``workspaceDir`` was removed in v0.5 — coding sessions have their
    // own picker in the CodingPanel header, and the app workspace is
    // fixed (under %APPDATA%/MiniMaxStudio/). We keep the field name
    // around in case any stale localStorage payload still has it
    // (see useEffect below — it's silently ignored).
    workspaceDir: '',
    appWorkspaceDir: '',
    systemPrompt: '',
    region: 'global',
    webSearch: true,
    understandImage: true,
    apiBase: '',
  })
  const [userPlan, setUserPlan] = useState('plus')
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
  const [audioDefaults, setAudioDefaults] = useState(AUDIO_DEFAULT)
  const [audioDefaultsLoaded, setAudioDefaultsLoaded] = useState(false)
  const [audioDefaultsSaving, setAudioDefaultsSaving] = useState(false)

  const fetchMcpServers = async () => {
    setMcpLoading(true)
    setMcpError(null)
    try {
      const res = await apiFetch('/api/mcp/servers')
      const data = await res.json()
      if (data.success) setMcpServers(data.servers || [])
    } catch (e) {
      setMcpError(t('settings.profileFailed'))
    }
    setMcpLoading(false)
  }

  // ---- Audio generation defaults (GET /api/config/defaults/audio) ----
  // Validated enums live in web/backend/main.py — keep these lists in sync.

  const fetchAudioDefaults = async () => {
    try {
      const res = await apiFetch('/api/config/defaults/audio')
      const data = await res.json()
      if (data && typeof data === 'object') {
        setAudioDefaults({
          format: AUDIO_FORMAT_OPTIONS.includes(data.format) ? data.format : AUDIO_DEFAULT.format,
          sample_rate: AUDIO_SAMPLE_RATE_OPTIONS.includes(Number(data.sample_rate))
            ? Number(data.sample_rate)
            : AUDIO_DEFAULT.sample_rate,
          bitrate: AUDIO_BITRATE_OPTIONS.includes(Number(data.bitrate))
            ? Number(data.bitrate)
            : AUDIO_DEFAULT.bitrate,
          channel: data.channel === 2 ? 2 : 1,
        })
      }
    } catch { /* keep default */ }
    setAudioDefaultsLoaded(true)
  }

  const saveAudioDefaults = async () => {
    setAudioDefaultsSaving(true)
    try {
      const res = await apiFetch('/api/config/defaults/audio', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(audioDefaults),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || t('settings.saveFailed'))
      }
      setSavedMessage(t('settings.generationDefaultsSaved') || 'Audio defaults saved.')
      setTimeout(() => setSavedMessage(''), 3000)
    } catch (e) {
      setSavedMessage(e?.message || t('settings.saveFailed'))
      setTimeout(() => setSavedMessage(''), 3000)
    } finally {
      setAudioDefaultsSaving(false)
    }
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
        setSavedMessage(mcpEditingId ? t('settings.serverUpdated') : t('settings.serverAdded'))
        setTimeout(() => setSavedMessage(''), 2000)
        resetMcpForm()
        fetchMcpServers()
      } else {
        setMcpError(data.detail || t('settings.saveFailed'))
      }
    } catch (e) {
      setMcpError(t('settings.saveFailed'))
    }
  }

  const toggleMcpServer = async (id) => {
    try {
      const res = await apiFetch(`/api/mcp/servers/${id}/toggle`, { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        setMcpServers(prev => prev.map(s => s.id === id ? { ...s, enabled: data.enabled } : s))
      }
    } catch { /* ignore */ }
  }

  const deleteMcpServer = async (id) => {
    try {
      const res = await apiFetch(`/api/mcp/servers/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.success) {
        setSavedMessage(t('settings.serverRemoved'))
        setTimeout(() => setSavedMessage(''), 2000)
        fetchMcpServers()
      }
    } catch { /* ignore */ }
  }

  const testMcpServer = async (id) => {
    setMcpTestResults(prev => ({ ...prev, [id]: { loading: true } }))
    try {
      const res = await apiFetch(`/api/mcp/servers/${id}/test`, { method: 'POST' })
      const data = await res.json()
      setMcpTestResults(prev => ({ ...prev, [id]: { loading: false, result: data } }))
    } catch (e) {
      setMcpTestResults(prev => ({ ...prev, [id]: { loading: false, error: e.message || t('settings.saveFailed') } }))
    }
  }

  useEffect(() => {
    apiFetch('/api/config')
      .then(r => r.json())
      .then(data => {
        setConfig(data)
        setLocalSettings(prev => ({
          ...prev,
          apiKey: '',
          apiKeyConfigured: data.api_key_configured || false,
          model: data.agent?.model || 'MiniMax-M3',
          maxSteps: data.agent?.max_steps || 50,
          // v0.5: ``workspace_dir`` is gone — we read the new
          // ``app_workspace_dir`` (read-only indicator below) instead.
          appWorkspaceDir: data.app_workspace_dir || '',
          systemPrompt: data.agent?.system_prompt || '',
          apiBase: data.api_base || '',
          region: data.region || 'global',
          webSearch: data.tools?.web_search ?? true,
          understandImage: data.tools?.understand_image ?? true,
        }))
        if (data.mcp_servers) setMcpServers(data.mcp_servers)
      })
      .catch(() => setConfig({}))

    fetchMcpServers()
    fetchAudioDefaults()

    apiFetch('/api/profile')
      .catch(() => {})  // profile is now loaded by AboutYouCard; no top-level state needed

    apiFetch('/api/minimax/quota')
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          setQuotaData(data.data)
          if (data.plan && PLAN_ORDER[data.plan] !== undefined) {
            setUserPlan(data.plan)
          } else if (data.data?.model_remains) {
            const m2Model = data.data.model_remains.find(m =>
              (m.model_name || '').toLowerCase().includes('minimax-m')
            )
            if (m2Model) {
              const total = m2Model.current_interval_total_count || 0
              if (total >= 15000) setUserPlan('max')
              else if (total >= 4500) setUserPlan('plus')
              else setUserPlan('plus')
            }
          }
        }
      })
      .catch(() => {})
  }, [])

  const handleSave = async () => {
    try {
      const messages = []

      // 1) API key — empty field = no-op (never wipe a previously configured key).
      const newKey = (localSettings.apiKey || '').trim()
      if (newKey) {
        const res = await apiFetch('/api/config/api-key', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: newKey }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.detail || t('settings.saveFailed'))
        }
        setLocalSettings(s => ({ ...s, apiKey: '', apiKeyConfigured: true }))
        messages.push(t('settings.apiKeySaved'))
      }

      // 2) Agent settings — round-trip current values so Save is idempotent.
      const agentPayload = {}
      if (localSettings.model) agentPayload.model = localSettings.model
      if (localSettings.maxSteps) agentPayload.max_steps = Number(localSettings.maxSteps)
      // v0.5: workspaceDir is no longer sent — per-session coding
      // workspace is set via PUT /api/coding/workspace instead.
      if (localSettings.region) agentPayload.region = localSettings.region
      if (localSettings.apiBase) agentPayload.api_base = localSettings.apiBase

      if (Object.keys(agentPayload).length > 0) {
        const res = await apiFetch('/api/config/agent', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(agentPayload),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.detail || t('settings.saveFailed'))
        }
        messages.push(t('settings.agentSaved'))
      }

      setSavedMessage(messages.length ? messages.join(' ') : t('settings.savedSuccess'))
      setTimeout(() => setSavedMessage(''), 3000)
    } catch (e) {
      setSavedMessage(e?.message || t('settings.saveFailed'))
    }
  }

  const handleSaveTools = async (key, value) => {
    try {
      const payload = key === 'webSearch'
        ? { web_search: value, understand_image: localSettings.understandImage }
        : { web_search: localSettings.webSearch, understand_image: value }
      await apiFetch('/api/config/tools', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      setSavedMessage(t('settings.toolsUpdated'))
      setTimeout(() => setSavedMessage(''), 2000)
    } catch { /* ignore */ }
  }

  const handleReset = () => {
    setLocalSettings({
      apiKey: '',
      apiKeyConfigured: false,
      model: 'MiniMax-M3',
      maxSteps: 50,
      // v0.5: no global workspaceDir; show the live app workspace
      // path (read-only) and let coding sessions pick their own folder.
      workspaceDir: '',
      appWorkspaceDir: localSettings.appWorkspaceDir,
      systemPrompt: '',
      region: 'global',
      apiBase: '',
    })
  }

  // Chat models for the "Default model" radio list. Plan-gating is implicit
  // because everything below Max+ is in every paid Token Plan tier.
  const chatModels = ALL_MODELS.filter(m => m.type === 'chat')

  // Scroll-spy: highlight the left-rail entry for whichever section is
  // currently in view. Each SectionHeader renders with id="settings-<key>".
  useEffect(() => {
    const ids = ['about-you', 'appearance', 'default-model', 'agent', 'api-key', 'lang-region', 'generation-defaults', 'skills', 'tools', 'mcp', 'shortcuts', 'about-app']
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting)
        if (visible.length === 0) return
        const top = visible.reduce((a, b) =>
          a.boundingClientRect.top < b.boundingClientRect.top ? a : b
        )
        const id = top.target.id.replace('settings-', '')
        setActiveSection(id)
      },
      { rootMargin: '-10% 0px -55% 0px', threshold: 0 }
    )
    ids.forEach((id) => {
      const el = document.getElementById(`settings-${id}`)
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
  }, [])

  // Sections list for the left rail. About You + Agent context used
  // to live here as separate entries; they were merged into a single
  // rail entry "Context" that opens a fullscreen modal (see
  // components/agent-context/ContextModal.jsx). This keeps the
  // Settings page compact and the two related concerns together.
  const railSections = [
    { id: 'context',             label: t('agentContext.contextLabel') || 'Context', icon: Brain, action: 'openContextModal' },
    { id: 'appearance',          label: t('settings.appearance'),          icon: Palette },
    { id: 'default-model',       label: t('settings.defaultModel'),        icon: Cpu },
    { id: 'agent',               label: t('settings.agent'),               icon: Shield },
    { id: 'api-key',             label: t('settings.apiKey'),              icon: Key },
    { id: 'lang-region',         label: t('settings.langRegion'),          icon: Globe },
    { id: 'generation-defaults', label: t('settings.generationDefaults'),  icon: Sliders },
    { id: 'skills',              label: t('settings.skills') || 'Skills',  icon: Sparkles },
    { id: 'tools',               label: t('settings.tools'),               icon: Boxes },
    { id: 'mcp',                 label: t('settings.mcpServers'),          icon: Server },
    { id: 'shortcuts',           label: t('settings.shortcuts'),           icon: Keyboard },
    { id: 'about-app',           label: t('settings.about'),               icon: Info },
  ]

  const contextModal = useContextModal()

  // The rail click handler now branches on a possible `action` key:
  // rail sections with an action are buttons that open something
  // (the Context modal) instead of scrolling to a settings-X anchor.
  // All other sections behave as before (scroll-spy target).
  const handleRailClick = (section) => {
    if (section.action === 'openContextModal') {
      contextModal.openModal()
      return
    }
    const el = document.getElementById(`settings-${section.id}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setActiveSection(section.id)
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* LEFT RAIL — section nav. Scroll-spy updates activeSection as the
          user scrolls the right column; clicking scrolls back. */}
      <nav
        aria-label="Settings sections"
        className="w-[224px] shrink-0 border-r border-border overflow-y-auto py-6 px-3 hidden md:flex md:flex-col gap-0.5"
      >
        <div className="px-3 pb-4 mb-2 border-b border-border">
          <h1 className="text-[15px] font-semibold tracking-[-0.01em]">{t('settings.title')}</h1>
          <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
            {t('settings.subtitle')}
          </p>
        </div>
        {railSections.map((s) => {
          const Icon = s.icon
          // Sections with `action` (currently only Context) don't
          // participate in scroll-spy — they open a modal instead.
          const active = !s.action && activeSection === s.id
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => handleRailClick(s)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-[8px] text-[12.5px] transition-colors text-left ${
                active
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-surface'
              }`}
            >
              {Icon && <Icon size={14} aria-hidden="true" />}
              <span className="truncate flex-1">{s.label}</span>
              {active && <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" aria-hidden="true" />}
            </button>
          )
        })}
      </nav>

      {/* RIGHT CONTENT — the existing single-column body, now scrollable
          in its own column. SectionHeader ids + scroll-mt-6 keep scroll-spy
          happy. */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[780px] mx-auto px-8 py-9 pb-24 md:px-10">
          {/* Mobile-only header (md:hidden because the rail already shows it) */}
          <div className="md:hidden mb-6">
            <h1 className="text-[22px] font-bold tracking-[-0.02em] mb-1">{t('settings.title')}</h1>
            <p className="text-[13px] text-muted-foreground">{t('settings.subtitle')}</p>
          </div>
          <h1 className="text-[22px] font-bold tracking-[-0.02em] mb-1">{t('settings.title')}</h1>
          <p className="text-[13px] text-muted-foreground mb-8">
            {t('settings.subtitle')}
          </p>

        {/* ─── 1. Appearance ──────────────────────────────────────────────── */}
        <SectionHeader id="settings-appearance" icon={Palette} title={t('settings.appearance')} />
        <Card>
          <Row label={t('settings.mode')} desc={t('settings.modeDesc')} last={false}>
            <div className="flex gap-1 p-[3px] rounded-[9px] bg-secondary">
              {[
                { id: 'light', labelKey: 'settings.lightMode', icon: Sun },
                { id: 'dark', labelKey: 'settings.darkMode', icon: Moon },
                { id: 'system', label: 'System', icon: Monitor },
              ].map((m) => {
                const Icon = m.icon
                const active = mode === m.id
                return (
                  <button
                    key={m.id}
                    onClick={() => setMode(m.id)}
                    className={`flex items-center gap-1.5 h-[28px] px-3 rounded-[6px] text-[11.5px] font-medium transition-colors ${
                      active
                        ? 'bg-card text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Icon size={13} />
                    {m.labelKey ? t(m.labelKey) : m.label}
                  </button>
                )
              })}
            </div>
          </Row>
          <div className="px-5 py-4 border-t border-border">
            <div className="text-[13px] font-medium mb-1">{t('settings.theme')}</div>
            <div className="text-[11.5px] text-muted-foreground mb-3.5">
              {t('settings.themeDesc')}
            </div>
            <div className="grid grid-cols-3 gap-2.5">
              {THEME_LIST.map((th) => {
                const active = theme === th.id
                return (
                  <button
                    key={th.id}
                    onClick={() => setTheme(th.id)}
                    className={`relative flex flex-col items-start gap-2 p-3 rounded-[10px] border transition-colors ${
                      active
                        ? 'bg-primary/10 border-primary text-primary'
                        : 'bg-surface border-border text-muted-foreground hover:border-primary/50'
                    }`}
                    title={th.name}
                  >
                    <div className="flex gap-1.5">
                      <span className="w-[22px] h-[22px] rounded-[6px] border border-border/50" style={{ backgroundColor: th.preview.darkBg }} />
                      <span className="w-[22px] h-[22px] rounded-[6px] border border-border/50" style={{ backgroundColor: th.preview.lightBg }} />
                      <span className={`w-[22px] h-[22px] rounded-[6px] ${th.color}`} />
                    </div>
                    <span className="text-[12px] font-medium">{th.name}</span>
                    {active && (
                      <span className="absolute top-2 right-2 w-[18px] h-[18px] rounded-full bg-primary flex items-center justify-center">
                        <Check size={11} className="text-primary-foreground" />
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
          {theme === 'matrix' && (
            <div className="px-5 py-4 border-t border-border flex items-center justify-between">
              <div>
                <div className="text-[13px] font-medium flex items-center gap-2">
                  <Sparkles size={13} className="text-green-400" />
                  {t('settings.matrixRain')}
                </div>
                <div className="text-[11.5px] text-muted-foreground">{t('settings.matrixRainDesc')}</div>
              </div>
              <Toggle on={matrixEffect} onChange={toggleMatrixEffect} label={t('settings.matrixRain')} />
            </div>
          )}
        </Card>

        {/* ─── 3. Default model ───────────────────────────────────────────── */}
        <SectionHeader id="settings-default-model" icon={Cpu} title={t('settings.defaultModel')} />
        <Card>
          <div className="p-2">
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-[11px] text-muted-foreground">{t('settings.yourTokenPlan')}</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-medium">
                {PLAN_LABELS[userPlan] || 'Plus'} Plan
              </span>
            </div>
            {chatModels.map((m, idx) => {
              const active = localSettings.model === m.id
              return (
                <button
                  key={m.id}
                  onClick={() => setLocalSettings(s => ({ ...s, model: m.id }))}
                  className={`w-full flex items-center justify-between gap-3 px-3 py-3 rounded-[8px] transition-colors text-left ${
                    active ? 'bg-primary/10' : 'hover:bg-surface'
                  } ${idx < chatModels.length - 1 ? 'mb-0.5' : ''}`}
                >
                  <div className="min-w-0">
                    <div className={`text-[13px] font-semibold ${active ? 'text-primary' : 'text-foreground'}`}>{m.label}</div>
                    <div className="text-[11.5px] text-muted-foreground mt-0.5">{m.desc}</div>
                  </div>
                  <span
                    className={`shrink-0 w-[16px] h-[16px] rounded-full border-2 flex items-center justify-center transition-colors ${
                      active ? 'border-primary' : 'border-border'
                    }`}
                  >
                    {active && <span className="w-[8px] h-[8px] rounded-full bg-primary" />}
                  </span>
                </button>
              )
            })}
          </div>
        </Card>

        {/* ─── 4. Agent ───────────────────────────────────────────────────── */}
        <SectionHeader id="settings-agent" icon={Shield} title={t('settings.agent')} />
        <Card>
          <div className="p-5 space-y-4">
            <div>
              <label className="text-[11.5px] font-semibold text-muted-foreground mb-1.5 block">{t('settings.maxStepsLabel')}</label>
              <input
                type="number"
                value={localSettings.maxSteps}
                onChange={(e) => setLocalSettings(s => ({ ...s, maxSteps: parseInt(e.target.value) || 50 }))}
                className="w-full h-[36px] bg-surface border border-border rounded-[9px] px-3 text-[13px] text-foreground focus:outline-none focus:border-primary"
              />
              <p className="text-[10px] text-muted-foreground mt-1">{t('settings.maxStepsHint')}</p>
            </div>

            {/* ``workspaceDir`` removed in v0.5 — coding sessions pick a
                folder from the CodingPanel header; the app workspace is
                fixed (%APPDATA%/MiniMaxStudio/). We show a read-only
                indicator so the user can see where their data lives. */}
            <div>
              <label className="text-[11.5px] font-semibold text-muted-foreground mb-1.5 block">{t('settings.appWorkspaceDir')}</label>
              <input
                type="text"
                value={localSettings.appWorkspaceDir || t('settings.appWorkspaceLoading')}
                readOnly
                className="w-full h-[36px] bg-surface border border-border rounded-[9px] px-3 font-mono text-[12.5px] text-muted-foreground focus:outline-none cursor-default"
              />
              <p className="text-[10px] text-muted-foreground mt-1">{t('settings.appWorkspaceHint')}</p>
            </div>

            <div>
              <label className="text-[11.5px] font-semibold text-muted-foreground mb-1.5 block">{t('settings.apiBase')}</label>
              <div className="relative">
                <input
                  type="text"
                  value={localSettings.apiBase}
                  onChange={(e) => setLocalSettings(s => ({ ...s, apiBase: e.target.value }))}
                  placeholder="https://api.minimax.io"
                  className="w-full h-[36px] bg-surface border border-border rounded-[9px] pl-9 pr-3 font-mono text-[12.5px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
                />
                <Server size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                {t('settings.apiBaseHint')}
              </p>
            </div>

            <div>
              <label className="text-[11.5px] font-semibold text-muted-foreground mb-1.5 block">{t('settings.systemPrompt')}</label>
              <div className="bg-surface border border-border rounded-[9px] px-3 py-2.5 text-[11.5px] text-muted-foreground leading-relaxed">
                {t('settings.systemPromptHint', {
                  file: <code className="px-1 py-0.5 rounded bg-card border border-border font-mono text-foreground text-[11px]">system_prompt.md</code>,
                  yaml: <code className="px-1 py-0.5 rounded bg-card border border-border font-mono text-foreground text-[11px]">config.yaml</code>,
                })}
              </div>
            </div>
          </div>
        </Card>

        {/* ─── 5. API key ─────────────────────────────────────────────────── */}
        <SectionHeader id="settings-api-key" icon={Key} title={t('settings.apiKey')} />
        <Card>
          <div className="p-5">
            <label className="text-[11.5px] font-semibold text-muted-foreground mb-1.5 block">{t('settings.apiKeyLabel')}</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={localSettings.apiKey}
                  onChange={(e) => setLocalSettings(s => ({ ...s, apiKey: e.target.value }))}
                  placeholder={localSettings.apiKeyConfigured ? t('settings.apiKeyPlaceholderMasked') : t('settings.apiKeyPlaceholder')}
                  className="w-full h-[40px] bg-surface border border-border rounded-[9px] px-3 pr-10 font-mono text-[12.5px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                  title={showApiKey ? 'Hide' : 'Show'}
                >
                  {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <button
                onClick={handleSave}
                disabled={!localSettings.apiKey.trim()}
                className="h-[40px] px-4 rounded-[9px] border border-border bg-transparent text-foreground text-[12.5px] font-medium hover:border-primary/50 transition-colors disabled:opacity-40"
              >
                {t('settings.update')}
              </button>
            </div>
            <div className={`flex items-center gap-1.5 mt-3 text-[11.5px] ${localSettings.apiKeyConfigured ? 'text-success' : 'text-muted-foreground'}`}>
              {localSettings.apiKeyConfigured ? (
                <>
                  <Check size={13} />
                  {t('settings.apiKeyConnected')}
                </>
              ) : (
                <>
                  <AlertCircle size={13} />
                  {t('settings.apiKeyNotConfigured')}
                </>
              )}
            </div>
          </div>
        </Card>

        {/* ─── 6. Language & region ───────────────────────────────────────── */}
        <SectionHeader id="settings-lang-region" icon={Globe} title={t('settings.langRegion')} />
        <Card>
          <Row label={t('settings.interfaceLanguage')} desc={t('settings.interfaceLanguageDesc')} last={false}>
            <select
              value={i18n.language}
              onChange={(e) => i18n.changeLanguage(e.target.value)}
              className="h-[36px] bg-surface border border-border rounded-[9px] px-3 text-[12.5px] text-foreground focus:outline-none focus:border-primary cursor-pointer"
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
          </Row>
          <Row label={t('settings.apiEndpoint')} desc={t('settings.apiEndpointDesc')} last>
            <select
              value={localSettings.region}
              onChange={(e) => setLocalSettings(s => ({ ...s, region: e.target.value }))}
              className="h-[36px] bg-surface border border-border rounded-[9px] px-3 text-[12.5px] text-foreground focus:outline-none focus:border-primary cursor-pointer"
            >
              {REGIONS.map((r) => (
                <option key={r.code} value={r.code}>{r.label}</option>
              ))}
            </select>
          </Row>
        </Card>

        {/* ─── 7. Generation defaults (audio) ─────────────────────────────── */}
        <SectionHeader id="settings-generation-defaults" icon={Sliders} title={t('settings.generationDefaults')} />
        <Card>
          <Row label={t('settings.audioFormat')} desc={t('settings.audioFormatDesc')} last={false}>
            <select
              value={audioDefaults.format}
              onChange={(e) => setAudioDefaults((d) => ({ ...d, format: e.target.value }))}
              className="h-[36px] bg-surface border border-border rounded-[9px] px-3 text-[12.5px] text-foreground focus:outline-none focus:border-primary cursor-pointer font-mono"
            >
              {AUDIO_FORMAT_OPTIONS.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </Row>
          <Row label={t('settings.audioSampleRate')} desc={t('settings.audioSampleRateDesc')} last={false}>
            <select
              value={audioDefaults.sample_rate}
              onChange={(e) => setAudioDefaults((d) => ({ ...d, sample_rate: Number(e.target.value) }))}
              className="h-[36px] bg-surface border border-border rounded-[9px] px-3 text-[12.5px] text-foreground focus:outline-none focus:border-primary cursor-pointer font-mono"
            >
              {AUDIO_SAMPLE_RATE_OPTIONS.map((r) => (
                <option key={r} value={r}>{r.toLocaleString()} Hz</option>
              ))}
            </select>
          </Row>
          <Row label={t('settings.audioBitrate')} desc={t('settings.audioBitrateDesc')} last={false}>
            <select
              value={audioDefaults.bitrate}
              onChange={(e) => setAudioDefaults((d) => ({ ...d, bitrate: Number(e.target.value) }))}
              className="h-[36px] bg-surface border border-border rounded-[9px] px-3 text-[12.5px] text-foreground focus:outline-none focus:border-primary cursor-pointer font-mono"
            >
              {AUDIO_BITRATE_OPTIONS.map((b) => (
                <option key={b} value={b}>{b.toLocaleString()} bps</option>
              ))}
            </select>
          </Row>
          <Row label={t('settings.audioChannel')} desc={t('settings.audioChannelDesc')} last>
            <div className="flex gap-1 p-[3px] rounded-[9px] bg-secondary">
              {[{ id: 1, label: t('settings.audioChannelMono') || 'Mono' }, { id: 2, label: t('settings.audioChannelStereo') || 'Stereo' }].map((c) => {
                const active = audioDefaults.channel === c.id
                return (
                  <button
                    key={c.id}
                    onClick={() => setAudioDefaults((d) => ({ ...d, channel: c.id }))}
                    className={`h-[28px] px-3 rounded-[6px] text-[11.5px] font-medium transition-colors ${
                      active ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {c.label}
                  </button>
                )
              })}
            </div>
          </Row>
          <div className="px-5 py-4 border-t border-border flex items-center justify-between">
            <p className="text-[11px] text-muted-foreground leading-snug">
              {t('settings.generationDefaultsHint')}
            </p>
            <button
              onClick={saveAudioDefaults}
              disabled={audioDefaultsSaving || !audioDefaultsLoaded}
              className="h-[34px] px-4 rounded-[8px] bg-primary hover:bg-primary-hover disabled:opacity-40 text-white text-[12px] font-medium transition-colors flex items-center gap-1.5 shrink-0 ml-3"
            >
              {audioDefaultsSaving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              {t('settings.save')}
            </button>
          </div>
        </Card>

        {/* ─── 8. Skills ─────────────────────────────────────────────────── */}
        <SectionHeader id="settings-skills" icon={Sparkles} title={t('settings.skills') || 'Skills'} />
        <Card>
          <SkillsTab />
        </Card>

        {/* ─── 9. Tools ───────────────────────────────────────────────────── */}
        <SectionHeader id="settings-tools" icon={Boxes} title={t('settings.tools')} />
        <Card>
          <Row label={t('settings.webSearch')} desc={t('settings.webSearchDesc')} last={false}>
            <Toggle
              on={localSettings.webSearch}
              onChange={() => {
                const next = !localSettings.webSearch
                setLocalSettings(s => ({ ...s, webSearch: next }))
                handleSaveTools('webSearch', next)
              }}
              label={t('settings.webSearch')}
            />
          </Row>
          <Row label={t('settings.imageUnderstanding')} desc={t('settings.imageUnderstandingDesc')} last>
            <Toggle
              on={localSettings.understandImage}
              onChange={() => {
                const next = !localSettings.understandImage
                setLocalSettings(s => ({ ...s, understandImage: next }))
                handleSaveTools('understandImage', next)
              }}
              label={t('settings.imageUnderstanding')}
            />
          </Row>
        </Card>

        {/* ─── 10. MCP servers ───────────────────────────────────────────── */}
        <div id="settings-mcp" className="flex items-center justify-between mb-3.5 scroll-mt-6">
          <SectionHeader icon={Server} title={t('settings.mcpServers')} />
          <button
            onClick={() => { resetMcpForm(); setMcpFormVisible(true) }}
            className="flex items-center gap-1.5 h-[30px] px-3 rounded-[8px] border border-border bg-transparent text-foreground text-[12px] font-medium hover:border-primary/50 transition-colors"
          >
            <span className="text-[14px] leading-none">+</span> {t('settings.addServer')}
          </button>
        </div>
        <Card>
          {mcpLoading && <div className="px-5 py-3 text-[12px] text-muted-foreground">{t('settings.mcpLoading')}</div>}
          {mcpError && <div className="px-5 py-3 text-[12px] text-error">{mcpError}</div>}

          {mcpFormVisible && (
            <div className="p-5 border-b border-border space-y-3 bg-surface/40">
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block font-semibold">{t('settings.name')}</label>
                <input
                  type="text"
                  value={mcpForm.name}
                  onChange={(e) => setMcpForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Local Filesystem"
                  className="w-full h-[34px] bg-card border border-border rounded-[8px] px-3 text-[12.5px] text-foreground focus:outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block font-semibold">{t('settings.transport')}</label>
                <select
                  value={mcpForm.transport}
                  onChange={(e) => setMcpForm(f => ({ ...f, transport: e.target.value }))}
                  className="w-full h-[34px] bg-card border border-border rounded-[8px] px-3 text-[12.5px] text-foreground focus:outline-none focus:border-primary"
                >
                  <option value="stdio">stdio</option>
                  <option value="sse">sse</option>
                  <option value="http">http</option>
                </select>
              </div>
              {mcpForm.transport === 'stdio' && (
                <>
                  <div>
                    <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block font-semibold">{t('settings.command')}</label>
                    <input
                      type="text"
                      value={mcpForm.command}
                      onChange={(e) => setMcpForm(f => ({ ...f, command: e.target.value }))}
                      placeholder="e.g. npx"
                      className="w-full h-[34px] bg-card border border-border rounded-[8px] px-3 font-mono text-[12.5px] text-foreground focus:outline-none focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block font-semibold">{t('settings.argsPlaceholder')}</label>
                    <textarea
                      value={mcpForm.args}
                      onChange={(e) => setMcpForm(f => ({ ...f, args: e.target.value }))}
                      placeholder="-y&#10;@modelcontextprotocol/server-filesystem&#10;./workspace"
                      rows={3}
                      className="w-full bg-card border border-border rounded-[8px] px-3 py-2 text-[12.5px] font-mono text-foreground focus:outline-none focus:border-primary resize-none"
                    />
                  </div>
                </>
              )}
              {mcpForm.transport !== 'stdio' && (
                <div>
                  <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block font-semibold">{t('settings.url')}</label>
                  <input
                    type="text"
                    value={mcpForm.url}
                    onChange={(e) => setMcpForm(f => ({ ...f, url: e.target.value }))}
                    placeholder="https://example.com/mcp"
                    className="w-full h-[34px] bg-card border border-border rounded-[8px] px-3 font-mono text-[12.5px] text-foreground focus:outline-none focus:border-primary"
                  />
                </div>
              )}
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block font-semibold">{t('settings.envPlaceholder')}</label>
                <textarea
                  value={mcpForm.env}
                  onChange={(e) => setMcpForm(f => ({ ...f, env: e.target.value }))}
                  placeholder="API_KEY=xxx&#10;DEBUG=true"
                  rows={2}
                  className="w-full bg-card border border-border rounded-[8px] px-3 py-2 text-[12.5px] font-mono text-foreground focus:outline-none focus:border-primary resize-none"
                />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={mcpForm.enabled}
                  onChange={(e) => setMcpForm(f => ({ ...f, enabled: e.target.checked }))}
                  className="rounded border-border text-primary"
                />
                <span className="text-[12.5px] text-foreground">{t('settings.enabled')}</span>
              </label>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={submitMcpForm}
                  disabled={!mcpForm.name.trim()}
                  className="flex-1 h-[34px] bg-primary hover:bg-primary-hover disabled:opacity-40 text-white text-[12.5px] font-medium rounded-[8px] transition-colors"
                >
                  {mcpEditingId ? t('settings.update') : t('settings.save')}
                </button>
                <button
                  onClick={resetMcpForm}
                  className="flex-1 h-[34px] bg-surface hover:bg-surface/80 border border-border text-foreground text-[12.5px] font-medium rounded-[8px] transition-colors"
                >
                  {t('settings.cancel')}
                </button>
              </div>
            </div>
          )}

          {mcpServers.length === 0 && !mcpLoading && !mcpFormVisible && (
            <div className="px-5 py-4 text-[12px] text-muted-foreground">{t('settings.mcpEmpty')}</div>
          )}

          <div className="divide-y divide-border">
            {mcpServers.map(server => (
              <div key={server.id} className="px-5 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-[34px] h-[34px] flex-none rounded-[9px] bg-secondary flex items-center justify-center font-mono text-[12px] font-bold text-primary">
                      {server.name?.[0]?.toUpperCase() || '?'}
                    </span>
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium truncate">{server.name}</div>
                      <div className="text-[11px] text-muted-foreground font-mono truncate">
                        {server.transport === 'stdio'
                          ? `${server.command || '-'} ${(server.args || []).join(' ')}`
                          : (server.url || '-')}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${
                      server.enabled
                        ? 'bg-success/10 text-success border-success/25'
                        : 'bg-muted/20 text-muted-foreground border-border'
                    }`}>
                      {server.enabled ? t('settings.statusEnabled') : t('settings.statusDisabled')}
                    </span>
                    <button onClick={() => testMcpServer(server.id)} className="p-1.5 rounded hover:bg-surface text-muted-foreground hover:text-foreground" title={t('settings.test')}>
                      <Activity size={12} />
                    </button>
                    <button onClick={() => toggleMcpServer(server.id)} className="p-1.5 rounded hover:bg-surface text-muted-foreground hover:text-foreground" title={server.enabled ? t('settings.disable') : t('settings.enable')}>
                      {server.enabled ? <Unlock size={12} /> : <Lock size={12} />}
                    </button>
                    <button onClick={() => openMcpEdit(server)} className="p-1.5 rounded hover:bg-surface text-muted-foreground hover:text-foreground" title={t('settings.edit')}>
                      <Pencil size={12} />
                    </button>
                    <button onClick={() => deleteMcpServer(server.id)} className="p-1.5 rounded hover:bg-error/10 text-muted-foreground hover:text-error" title={t('settings.delete')}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
                {mcpTestResults[server.id]?.result && (
                  <div className="mt-2 text-[11px] space-y-1">
                    {mcpTestResults[server.id].result.success ? (
                      <>
                        <div className="flex items-center gap-1 text-success">
                          <Check size={11} />
                          <span>Connected — {mcpTestResults[server.id].result.tool_count} tool(s)</span>
                        </div>
                        {mcpTestResults[server.id].result.tools?.slice(0, 4).map((tool, i) => (
                          <div key={i} className="pl-4 text-muted-foreground">
                            <span className="font-medium text-foreground">{tool.name}</span>
                            {tool.description && <span className="ml-1">— {tool.description}</span>}
                          </div>
                        ))}
                        {mcpTestResults[server.id].result.tools?.length > 4 && (
                          <div className="pl-4 italic text-muted-foreground">
                            + {mcpTestResults[server.id].result.tools.length - 4} more
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="flex items-center gap-1 text-error">
                        <AlertCircle size={11} />
                        <span>{mcpTestResults[server.id].result.error || 'Connection failed'}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>

        {/* ─── 10. Shortcuts ─────────────────────────────────────────────── */}
        <SectionHeader id="settings-shortcuts" icon={Keyboard} title={t('settings.shortcuts')} />
        <Card>
          <div className="divide-y divide-border">
            {SHORTCUTS.map((s, i) => (
              <div key={i} className="flex items-center justify-between px-5 py-3">
                <span className="text-[12.5px] text-foreground">{t(`settings.${s.actionKey}`)}</span>
                <kbd className="px-2 py-1 rounded bg-secondary border border-border text-[10.5px] font-mono text-muted-foreground">
                  {s.keys}
                </kbd>
              </div>
            ))}
          </div>
        </Card>

        {/* ─── 11. About ───────────────────────────────────────────────── */}
        <SectionHeader id="settings-about-app" icon={Info} title={t('settings.about')} />
        <Card>
          <div className="p-5 flex items-center gap-4">
            <div
              className="w-[40px] h-[40px] flex-none rounded-[10px] flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, hsl(var(--primary)), hsl(var(--primary) / 0.55))' }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="hsl(var(--primary-foreground))" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 19V7l5 5 3-4 3 4 5-5v12" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold">MiniMax Studio</div>
              <div className="text-[11.5px] text-muted-foreground">{t('settings.version')}</div>
            </div>
            <button className="h-[34px] px-4 rounded-[8px] border border-border bg-transparent text-foreground text-[12px] font-medium hover:border-primary/50 transition-colors flex items-center gap-1.5">
              <Github size={13} />
              {t('settings.github')}
            </button>
          </div>
        </Card>

        {/* ─── Sticky save bar ───────────────────────────────────────────── */}
        {savedMessage && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 px-4 py-2 rounded-[10px] bg-card border border-border shadow-lg flex items-center gap-2 text-[12.5px]">
            {savedMessage.toLowerCase().includes('fail') ? (
              <AlertCircle size={14} className="text-error" />
            ) : (
              <Check size={14} className="text-success" />
            )}
            <span className={savedMessage.toLowerCase().includes('fail') ? 'text-error' : 'text-foreground'}>
              {savedMessage}
            </span>
          </div>
        )}
        </div>
      </div>
    </div>
  )
}
