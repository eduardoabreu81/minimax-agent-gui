// FirstRunSetup — the unified first-run experience.
//
// Replaces the two separate overlays (the marketing Onboarding tour and the
// standalone OnboardingWizard) with one cohesive, left-rail wizard:
//
//   Welcome → API key → Language → Agent context → Done
//
// Gated by a single localStorage flag (`minimax-setup-complete`). The API key
// step is the only hard requirement; it validates the key for real by saving
// it (PUT /api/config/api-key) and then reading the plan back from
// GET /api/minimax/quota. The agent-context step reuses useAgentContext so we
// don't duplicate the SOUL/IDENTITY/USER/MEMORY logic.

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Sparkles, Key, Languages, UserCog, Rocket, Check, ChevronLeft,
  ChevronRight, Loader2, AlertCircle, PlugZap, ExternalLink,
  Zap, Smile, GraduationCap, Brain, Wand2,
} from 'lucide-react'
import { apiFetch } from '../../lib/api.js'
import {
  useAgentContext, buildUserBody, buildMemoryBody,
} from '../../hooks/useAgentContext.js'
import { TimezoneSelect } from '../agent-context/OnboardingWizard.jsx'

export const SETUP_COMPLETE_KEY = 'minimax-setup-complete'

// The 6 UI locales, in display order. Labels are endonyms (each shown in its
// own language) so a user finds their language without reading English.
const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'pt-BR', label: 'Português' },
  { code: 'es', label: 'Español' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'zh-CN', label: '中文' },
]

const STEPS = [
  { id: 'welcome', icon: Sparkles },
  { id: 'language', icon: Languages },
  { id: 'apikey', icon: Key },
  { id: 'about', icon: UserCog },
  { id: 'style', icon: Wand2 },
  { id: 'done', icon: Rocket },
]

const DEFAULT_LABELS = {
  welcome: 'Welcome',
  apikey: 'API key',
  language: 'Language',
  about: 'About you',
  style: 'Agent style',
  done: 'Done',
}

// One glyph per personality preset, so each option reads at a glance.
const PERSONALITY_ICONS = {
  concise: Zap,
  friendly: Smile,
  mentor: GraduationCap,
  expert: Brain,
  creative: Wand2,
}

export default function FirstRunSetup({ onComplete }) {
  const { t, i18n } = useTranslation()
  const { saveBatch, refreshStatus, getPresetBody, getRoleBody, presets, roles } = useAgentContext()

  const [step, setStep] = useState(0)

  // API key step
  const [apiKey, setApiKey] = useState('')
  const [keyState, setKeyState] = useState('idle') // idle | validating | ok | error
  const [plan, setPlan] = useState(null)
  const [keyError, setKeyError] = useState(null)
  const [keySkipped, setKeySkipped] = useState(false)

  // Context step
  const [name, setName] = useState('')
  const [preset, setPreset] = useState('concise')
  const [role, setRole] = useState('eng')
  // Detected once from the OS (Intl), kept separate from the editable value so
  // the picker can offer a "use detected" revert if the user changes it.
  const [detectedTz] = useState(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || '' } catch { return '' }
  })
  const [timezone, setTimezone] = useState(detectedTz)
  const [level, setLevel] = useState('mid')
  const [savingContext, setSavingContext] = useState(false)

  const stepId = STEPS[step].id
  const isFirst = step === 0
  const isLast = step === STEPS.length - 1

  // One-line teaser from the preset's SOUL body (localized by the backend
  // /presets endpoint via useAgentContext), same source the wizard uses.
  const presetTeaser = (id) => {
    const body = getPresetBody?.(id) || ''
    return body.split('\n').find((l) => l.trim() && !l.startsWith('#')) || ''
  }

  const finish = () => {
    try { localStorage.setItem(SETUP_COMPLETE_KEY, 'true') } catch {}
    onComplete?.()
  }

  const goNext = () => setStep((s) => Math.min(STEPS.length - 1, s + 1))
  const goBack = () => setStep((s) => Math.max(0, s - 1))

  // ---- API key: save then read the plan back to prove it works -------------
  const validateKey = async () => {
    const key = apiKey.trim()
    if (!key) return
    setKeyState('validating')
    setKeyError(null)
    try {
      const save = await apiFetch('/api/config/api-key', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: key }),
      })
      if (!save.ok) throw new Error(`save failed (${save.status})`)

      const quota = await apiFetch('/api/minimax/quota')
      const data = await quota.json().catch(() => ({}))
      const detected = (data?.plan || '').toLowerCase()
      setPlan(detected || null)
      setKeyState('ok')
      setKeySkipped(false)
    } catch (e) {
      setKeyError(e.message || 'Validation failed')
      setKeyState('error')
    }
  }

  // ---- Context: write the 4 .agent files via the shared hook ---------------
  const saveContextThenFinish = async () => {
    setSavingContext(true)
    try {
      await saveBatch([
        { id: 'soul', content: getPresetBody(preset) },
        { id: 'identity', content: getRoleBody(role) },
        { id: 'user', content: buildUserBody(name, timezone, level) },
        { id: 'memory', content: buildMemoryBody() },
      ])
      await refreshStatus()
    } catch { /* non-fatal — the banner will prompt later */ }
    finally {
      setSavingContext(false)
      goNext()
    }
  }

  // Continue is blocked on the API-key step until validated (or skipped).
  const canContinue = stepId !== 'apikey' || keyState === 'ok' || keySkipped

  const handlePrimary = () => {
    if (stepId === 'style') { saveContextThenFinish(); return }
    if (isLast) { finish(); return }
    goNext()
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-background/95 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-3xl h-[560px] bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex animate-in fade-in zoom-in-95 duration-300">

        {/* Stepper rail */}
        <nav className="w-56 shrink-0 border-r border-border bg-surface/40 p-5 flex flex-col">
          <div className="flex items-center gap-2 mb-7">
            <span className="w-7 h-7 rounded-lg bg-primary/[0.13] flex items-center justify-center text-primary">
              <Sparkles size={16} />
            </span>
            <span className="text-sm font-semibold">MiniMax Studio</span>
          </div>

          <div className="flex flex-col gap-1">
            {STEPS.map((s, i) => {
              const Icon = s.icon
              const done = i < step
              const active = i === step
              return (
                <div
                  key={s.id}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                    active ? 'bg-primary/[0.13] text-primary'
                    : done ? 'text-foreground' : 'text-muted-foreground'
                  }`}
                >
                  {done ? <Check size={16} className="text-success" /> : <Icon size={16} />}
                  <span className={`text-[13px] ${active ? 'font-medium' : ''}`}>
                    {t(`setup.step.${s.id}`, DEFAULT_LABELS[s.id])}
                  </span>
                </div>
              )
            })}
          </div>
        </nav>

        {/* Content */}
        <div className="flex-1 min-w-0 flex flex-col p-8">
          <div className="flex-1 min-h-0 overflow-y-auto">
            <div key={stepId} className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            {stepId === 'welcome' && (
              <StepShell
                icon={Sparkles}
                title={t('setup.welcome.title', 'Welcome to MiniMax Studio')}
                subtitle={t('setup.welcome.subtitle', 'Your all-in-one desktop workspace for MiniMax M3 — chat, code, media, and an autonomous agent. Three quick steps and you are ready.')}
              >
                <ul className="space-y-2.5 mt-2">
                  {[
                    t('setup.welcome.b2', 'Pick your language'),
                    t('setup.welcome.b1', 'Connect your MiniMax account'),
                    t('setup.welcome.b3', 'Teach the agent who you are'),
                  ].map((b, i) => (
                    <li key={i} className="flex items-center gap-3 text-sm text-muted-foreground">
                      <span className="w-5 h-5 rounded-full bg-primary/[0.13] text-primary flex items-center justify-center text-[11px] font-semibold">{i + 1}</span>
                      {b}
                    </li>
                  ))}
                </ul>
              </StepShell>
            )}

            {stepId === 'apikey' && (
              <StepShell
                icon={Key}
                title={t('setup.apikey.title', 'Connect your MiniMax account')}
                subtitle={t('setup.apikey.subtitle', 'This app is built for MiniMax Token Plan subscribers. Paste your Token Plan API key — it is stored locally and never leaves your machine.')}
              >
                <label className="text-[11.5px] font-semibold text-muted-foreground mb-1.5 block">
                  {t('setup.apikey.label', 'API key')}
                </label>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => { setApiKey(e.target.value); setKeyState('idle') }}
                    placeholder="sk-…"
                    className="flex-1 px-3 py-2 bg-surface border border-border rounded-lg text-sm font-mono focus:outline-none focus:border-primary"
                    autoFocus
                  />
                  <button
                    onClick={validateKey}
                    disabled={!apiKey.trim() || keyState === 'validating'}
                    className="px-3 py-2 bg-primary hover:bg-primary-hover text-white rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 disabled:opacity-50 whitespace-nowrap"
                  >
                    {keyState === 'validating'
                      ? <Loader2 size={15} className="animate-spin" />
                      : <PlugZap size={15} />}
                    {t('setup.apikey.validate', 'Validate')}
                  </button>
                </div>

                {keyState === 'ok' && (
                  <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-success/10 text-success text-xs">
                    <Check size={14} />
                    {t('setup.apikey.connected', 'Connected')}
                    {plan && <span> · {plan.charAt(0).toUpperCase() + plan.slice(1)}</span>}
                  </div>
                )}
                {keyState === 'error' && (
                  <div className="mt-3 flex items-start gap-2 text-xs text-red-500">
                    <AlertCircle size={14} className="mt-0.5 shrink-0" />
                    <span>{t('setup.apikey.error', 'Could not validate the key.')} {keyError}</span>
                  </div>
                )}

                <div className="mt-5 flex items-center gap-4 text-[11.5px]">
                  <a
                    href="https://platform.minimax.io/subscribe/token-plan"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline inline-flex items-center gap-1"
                  >
                    {t('setup.apikey.getKey', 'Get a Token Plan subscription')} <ExternalLink size={12} />
                  </a>
                  <button
                    onClick={() => { setKeySkipped(true); goNext() }}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {t('setup.apikey.later', 'I’ll do this later')}
                  </button>
                </div>
              </StepShell>
            )}

            {stepId === 'language' && (
              <StepShell
                icon={Languages}
                title={t('setup.language.title', 'Choose your language')}
                subtitle={t('setup.language.subtitle', 'You can change this any time in Settings.')}
              >
                <div className="grid grid-cols-2 gap-2 mt-1">
                  {LANGUAGES.map((l) => {
                    const active = i18n.language === l.code
                    return (
                      <button
                        key={l.code}
                        onClick={() => i18n.changeLanguage(l.code)}
                        className={`px-4 py-3 rounded-lg border text-left text-sm font-medium transition-colors ${
                          active
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border bg-surface text-foreground hover:border-primary/40'
                        }`}
                      >
                        {l.label}
                        {active && <Check size={15} className="inline ml-2 -mt-0.5" />}
                      </button>
                    )
                  })}
                </div>
              </StepShell>
            )}

            {stepId === 'about' && (
              <StepShell
                icon={UserCog}
                title={t('setup.context.title', 'Teach the agent who you are')}
                subtitle={t('setup.context.subtitle', 'Optional, but the agent gets noticeably better. You can refine it later in Settings.')}
              >
                <label className="text-[11.5px] font-semibold text-muted-foreground mb-1.5 block">
                  {t('agentContext.wizard.name', 'Your name')}
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('agentContext.wizard.namePh', 'How should the agent address you?')}
                  className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm focus:outline-none focus:border-primary mb-4"
                />

                <label className="text-[11.5px] font-semibold text-muted-foreground mb-1.5 block">
                  {t('agentContext.wizard.timezone', 'Timezone')}
                </label>
                <div className="mb-4">
                  <TimezoneSelect value={timezone} onChange={setTimezone} detectedTz={detectedTz} />
                </div>

                <label className="text-[11.5px] font-semibold text-muted-foreground mb-1.5 block">
                  {t('agentContext.wizard.level', 'Technical level')}
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {['beginner', 'mid', 'senior'].map((l) => (
                    <button
                      key={l}
                      onClick={() => setLevel(l)}
                      className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                        level === l
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border bg-surface text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {t(`agentContext.wizard.level${l.charAt(0).toUpperCase() + l.slice(1)}`, l)}
                    </button>
                  ))}
                </div>
              </StepShell>
            )}

            {stepId === 'style' && (
              <StepShell
                icon={Wand2}
                title={t('setup.style.title', 'Agent style')}
                subtitle={t('setup.style.subtitle', 'Pick a personality and a default role for the agent.')}
              >
                <label className="text-[11.5px] font-semibold text-muted-foreground mb-1.5 block">
                  {t('setup.context.personality', 'Personality')}
                </label>
                <div className="grid grid-cols-1 gap-2 mb-4">
                  {['concise', 'friendly', 'mentor', 'expert', 'creative'].map((p) => {
                    const PIcon = PERSONALITY_ICONS[p]
                    const active = preset === p
                    return (
                      <button
                        key={p}
                        onClick={() => setPreset(p)}
                        className={`flex items-start gap-3 text-left px-3.5 py-2.5 rounded-lg border transition-colors ${
                          active ? 'border-primary bg-primary/10' : 'border-border bg-surface hover:border-primary/40'
                        }`}
                      >
                        <span className={`mt-0.5 shrink-0 ${active ? 'text-primary' : 'text-muted-foreground'}`}>
                          <PIcon size={16} />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-foreground">
                            {t(`agentContext.presets.${p}`, presets.find((x) => x.id === p)?.name || p)}
                          </span>
                          <span className="block text-xs text-muted-foreground line-clamp-2">
                            {t(`agentContext.presetDesc.${p}`, presetTeaser(p))}
                          </span>
                        </span>
                      </button>
                    )
                  })}
                </div>

                <label className="text-[11.5px] font-semibold text-muted-foreground mb-1.5 block">
                  {t('setup.context.role', 'Default role')}
                </label>
                <div className="flex flex-wrap gap-2">
                  {['eng', 'reviewer', 'pm'].map((r) => (
                    <Chip key={r} active={role === r} onClick={() => setRole(r)}>
                      {t(`agentContext.roles.${r}`, roles.find((x) => x.id === r)?.name || r)}
                    </Chip>
                  ))}
                </div>
              </StepShell>
            )}

            {stepId === 'done' && (
              <StepShell
                icon={Rocket}
                title={t('setup.done.title', 'You’re all set')}
                subtitle={t('setup.done.subtitle', 'Everything is configured. Press Start to open your workspace.')}
              >
                <div className="space-y-2 mt-2">
                  <SummaryRow label={t('setup.step.apikey', 'API key')} value={keySkipped ? t('setup.done.keyLater', 'Skipped — set it in Settings') : (plan ? `${plan.charAt(0).toUpperCase() + plan.slice(1)} plan` : t('setup.apikey.connected', 'Connected'))} ok={!keySkipped} />
                  <SummaryRow label={t('setup.step.language', 'Language')} value={LANGUAGES.find((l) => l.code === i18n.language)?.label || i18n.language} ok />
                  <SummaryRow label={t('agentContext.wizard.name', 'Your name')} value={name || '—'} ok={!!name} />
                  <SummaryRow label={t('agentContext.wizard.timezone', 'Timezone')} value={timezone || '—'} ok={!!timezone} />
                  <SummaryRow label={t('agentContext.wizard.level', 'Technical level')} value={t(`agentContext.wizard.level${level.charAt(0).toUpperCase() + level.slice(1)}`, level)} ok />
                  <SummaryRow label={t('setup.context.personality', 'Personality')} value={t(`agentContext.presets.${preset}`, presets.find((x) => x.id === preset)?.name || preset)} ok />
                  <SummaryRow label={t('setup.context.role', 'Default role')} value={t(`agentContext.roles.${role}`, roles.find((x) => x.id === role)?.name || role)} ok />
                </div>
              </StepShell>
            )}
            </div>
          </div>

          {/* Nav */}
          <div className="flex items-center justify-between pt-5 mt-2 border-t border-border">
            <button
              onClick={isFirst ? finish : goBack}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
            >
              {isFirst
                ? t('setup.skipAll', 'Skip setup')
                : <><ChevronLeft size={14} /> {t('setup.back', 'Back')}</>}
            </button>
            <button
              onClick={handlePrimary}
              disabled={!canContinue || savingContext}
              className="px-5 py-2 bg-primary hover:bg-primary-hover text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              {savingContext && <Loader2 size={15} className="animate-spin" />}
              {isLast
                ? <>{t('setup.start', 'Start')} <Rocket size={15} /></>
                : stepId === 'style'
                  ? <>{t('setup.finish', 'Finish')} <ChevronRight size={15} /></>
                  : <>{t('setup.continue', 'Continue')} <ChevronRight size={15} /></>}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function StepShell({ icon: Icon, title, subtitle, children }) {
  return (
    <div>
      <span className="w-11 h-11 rounded-xl bg-primary/[0.13] flex items-center justify-center text-primary mb-4">
        <Icon size={22} />
      </span>
      <h2 className="text-xl font-semibold text-foreground mb-1.5">{title}</h2>
      <p className="text-sm text-muted-foreground leading-relaxed mb-6 max-w-md">{subtitle}</p>
      {children}
    </div>
  )
}

function Chip({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-3.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
        active
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border bg-surface text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
    </button>
  )
}

function SummaryRow({ label, value, ok }) {
  return (
    <div className="flex items-center justify-between px-3.5 py-2.5 bg-surface border border-border rounded-lg">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-xs font-medium flex items-center gap-1.5 ${ok ? 'text-foreground' : 'text-muted-foreground'}`}>
        {ok && <Check size={13} className="text-success" />}
        {value}
      </span>
    </div>
  )
}
