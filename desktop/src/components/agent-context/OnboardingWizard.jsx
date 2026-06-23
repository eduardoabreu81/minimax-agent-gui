// OnboardingWizard — 4-step first-run setup that seeds .agent/*.md.
//
// Shown when the localStorage flag `agent-context-wizard-seen` is
// missing. The user can skip at any time (sets the flag) or walk
// through all 4 steps and have the wizard write SOUL.md, IDENTITY.md,
// USER.md, MEMORY.md via PUT /api/agent-context/{id}.
//
// Steps:
//   1. About you      — name, timezone, technical level
//   2. Personality    — pick a preset (concise / friendly / mentor / expert / creative)
//   3. Role           — pick a default identity (eng / reviewer / pm / custom)
//   4. Review         — confirm the 4 files that will be created
//
// The wizard is intentionally lightweight — no animations, no fancy
// transitions. The goal is "I can fill in 30 seconds and the agent
// gets noticeably better". Big CTA in step 4 writes all 4 files in
// one batch via saveBatch() and dismisses.
//
// Open the wizard via the banner's "Set up now" button or by
// deleting the localStorage flag.

import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { X, ChevronLeft, ChevronRight, Check, Sparkles, User, Briefcase } from 'lucide-react'
import { useAgentContext, buildUserBody, buildMemoryBody } from '../../hooks/useAgentContext.js'

// localStorage key — separate from the global Onboarding tour
// (minimax-onboarding-seen) so closing one doesn't suppress the other.
const SEEN_KEY = 'agent-context-wizard-seen'

const STEP_IDS = ['about', 'personality', 'identity', 'review']

export default function OnboardingWizard({ open, onClose }) {
  const { t, i18n } = useTranslation()
  const { saveBatch, refreshStatus } = useAgentContext()

  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [timezone, setTimezone] = useState(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || ''
    } catch { return '' }
  })
  const [level, setLevel] = useState('mid')
  const [preset, setPreset] = useState('concise')
  const [role, setRole] = useState('eng')
  const [customRole, setCustomRole] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  // Reset the form when the wizard re-opens (e.g. user clicked
  // "Set up now" from the banner after closing once).
  useEffect(() => {
    if (open) {
      setStep(0)
      setError(null)
    }
  }, [open])

  if (!open) return null

  // The preset/role bodies live in the backend i18n tables. We
  // grab them here so the wizard writes the *full* body, not the
  // JS fallback (which is a one-liner). For now the wizard just
  // uses a short seed — the body can be edited in the tab.
  //
  // The actual full preset bodies are in web/backend/i18n.py. If
  // we ever expose them via a /api/agent-context/presets endpoint,
  // this function should call that instead.
  const PRESET_BODIES = {
    concise: '# Personality\n\nYou are a pragmatic senior engineer. Direct, no fluff. Prefer showing code over describing in prose.\n\n## Style\n- Direct without being cold\n- Substance > formality\n- Push back on bad ideas with reasoning\n- Admit uncertainty plainly\n\n## What to avoid\n- Sycophancy\n- Hype language\n- Repeating the user\'s framing if it\'s wrong',
    friendly: '# Personality\n\nYou are a warm, kind code partner. Celebrate wins, explain patiently, keep the vibe light.\n\n## Style\n- Welcoming but direct\n- Use concrete examples\n- Acknowledge effort before correcting\n- Ask back when something is unclear\n\n## What to avoid\n- Sarcasm\n- Monosyllabic replies\n- Blaming the user for the bug',
    mentor: '# Personality\n\nYou are a patient mentor. Always explain the reasoning behind decisions.\n\n## Style\n- Explain the why before the how\n- Point out common patterns and pitfalls\n- Suggest further reading when useful\n- Treat errors as learning opportunities',
    expert: '# Personality\n\nYou are a technical expert who goes deep. Cite trade-offs, surface nuances.\n\n## Style\n- High density, no fluff\n- Cite trade-offs and edge cases explicitly\n- Use jargon without translating\n- Reference docs and RFCs when relevant',
    creative: '# Personality\n\nYou are a creative partner. Generate options, explore unexpected angles.\n\n## Style\n- Propose 2-3 alternatives before recommending\n- Use analogies and metaphors\n- Question the problem framing before solving\n- Celebrate unconventional ideas',
  }

  const ROLE_BODIES = {
    eng: 'You are the user\'s engineering partner. Your job is to write, refactor, and debug code with the user. Bias toward action: when the user describes a problem, propose concrete code changes, not abstract analysis.',
    reviewer: 'You are a code reviewer. Read the code the user shares, identify issues, suggest improvements. Focus on correctness, readability, and performance. Be direct about problems but respectful of the author.',
    pm: 'You are a project manager. Help the user organize tasks, track progress, manage scope. Break down work into chunks, identify blockers, surface risks early. Bias toward clarity over completeness.',
  }

  const handleClose = (markSeen = true) => {
    if (markSeen) {
      try { localStorage.setItem(SEEN_KEY, 'true') } catch {}
    }
    onClose?.()
  }

  const handleNext = () => {
    if (step < STEP_IDS.length - 1) {
      setStep(s => s + 1)
    }
  }

  const handlePrev = () => {
    if (step > 0) setStep(s => s - 1)
  }

  const handleCreate = async () => {
    setError(null)
    setSaving(true)
    try {
      const identityBody = role === 'custom'
        ? customRole.trim()
        : ROLE_BODIES[role] || ''

      const entries = [
        { id: 'soul',     content: PRESET_BODIES[preset] || '' },
        { id: 'identity', content: identityBody },
        { id: 'user',     content: buildUserBody(name, timezone, level) },
        { id: 'memory',   content: buildMemoryBody() },
      ]
      const results = await saveBatch(entries)
      const failed = results.filter(r => !r.ok)
      if (failed.length > 0) {
        setError(failed.map(f => `${f.id}: ${f.error}`).join('; '))
        return
      }
      // Refresh the banner status so it disappears.
      await refreshStatus()
      handleClose(true)
    } catch (e) {
      setError(e.message || 'Failed to create files')
    } finally {
      setSaving(false)
    }
  }

  const progress = ((step + 1) / STEP_IDS.length) * 100
  const stepId = STEP_IDS[step]

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => e.target === e.currentTarget && handleClose(false)}
    >
      <div className="w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
        {/* Progress */}
        <div className="h-1 bg-surface">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="p-6">
          {/* Header */}
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                <Sparkles size={20} />
              </div>
              <div>
                <h2 className="text-base font-semibold text-foreground">
                  {t('agentContext.wizard.title')}
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t('agentContext.wizard.subtitle')}
                </p>
              </div>
            </div>
            <button
              onClick={() => handleClose(false)}
              className="p-1.5 rounded-lg hover:bg-surface text-muted-foreground transition-colors"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>

          {/* Step indicator dots */}
          <div className="flex items-center gap-1.5 mb-5">
            {STEP_IDS.map((id, i) => (
              <button
                key={id}
                onClick={() => setStep(i)}
                aria-label={t(`agentContext.wizard.step.${id}`)}
                className={`h-1.5 rounded-full transition-all ${
                  i === step ? 'w-6 bg-primary' : i < step ? 'w-1.5 bg-primary/50' : 'w-1.5 bg-border'
                }`}
              />
            ))}
          </div>

          {/* Step content */}
          <div className="min-h-[260px]">
            {stepId === 'about' && (
              <div className="space-y-4">
                <h3 className="text-sm font-medium flex items-center gap-2">
                  <User size={14} className="text-muted-foreground" />
                  {t('agentContext.wizard.name')}
                </h3>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('agentContext.wizard.namePh')}
                  className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm focus:outline-none focus:border-primary"
                  autoFocus
                />

                <h3 className="text-sm font-medium pt-2">{t('agentContext.wizard.timezone')}</h3>
                <input
                  type="text"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  placeholder="America/Sao_Paulo"
                  className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm focus:outline-none focus:border-primary font-mono"
                />

                <h3 className="text-sm font-medium pt-2">{t('agentContext.wizard.level')}</h3>
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
                      {t(`agentContext.wizard.level${l.charAt(0).toUpperCase() + l.slice(1)}`)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {stepId === 'personality' && (
              <div className="space-y-3">
                <h3 className="text-sm font-medium">{t('agentContext.wizard.personalityQ')}</h3>
                {['concise', 'friendly', 'mentor', 'expert', 'creative'].map((p) => (
                  <button
                    key={p}
                    onClick={() => setPreset(p)}
                    className={`w-full text-left px-4 py-3 rounded-lg border transition-colors ${
                      preset === p
                        ? 'border-primary bg-primary/10'
                        : 'border-border bg-surface hover:border-primary/40'
                    }`}
                  >
                    <div className="text-sm font-medium text-foreground">
                      {t(`agentContext.presets.${p}`)}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
                      {PRESET_BODIES[p]?.split('\n')[2] || ''}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {stepId === 'identity' && (
              <div className="space-y-3">
                <h3 className="text-sm font-medium flex items-center gap-2">
                  <Briefcase size={14} className="text-muted-foreground" />
                  {t('agentContext.wizard.identityQ')}
                </h3>
                {['eng', 'reviewer', 'pm', 'custom'].map((r) => (
                  <button
                    key={r}
                    onClick={() => setRole(r)}
                    className={`w-full text-left px-4 py-3 rounded-lg border transition-colors ${
                      role === r
                        ? 'border-primary bg-primary/10'
                        : 'border-border bg-surface hover:border-primary/40'
                    }`}
                  >
                    <div className="text-sm font-medium text-foreground">
                      {t(`agentContext.roles.${r}`)}
                    </div>
                    {r !== 'custom' && (
                      <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
                        {ROLE_BODIES[r]?.split('.')[0] || ''}
                      </div>
                    )}
                  </button>
                ))}
                {role === 'custom' && (
                  <textarea
                    value={customRole}
                    onChange={(e) => setCustomRole(e.target.value)}
                    placeholder={t('agentContext.identity.customPlaceholder')}
                    rows={3}
                    className="w-full mt-2 px-3 py-2 bg-surface border border-border rounded-lg text-sm focus:outline-none focus:border-primary resize-none"
                  />
                )}
              </div>
            )}

            {stepId === 'review' && (
              <div className="space-y-3">
                <h3 className="text-sm font-medium">{t('agentContext.wizard.reviewQ')}</h3>
                <div className="space-y-2">
                  {[
                    { id: 'soul',     title: t('agentContext.file.soul'),     preview: t(`agentContext.presets.${preset}`) },
                    { id: 'identity', title: t('agentContext.file.identity'), preview: role === 'custom' ? customRole.slice(0, 60) : t(`agentContext.roles.${role}`) },
                    { id: 'user',     title: t('agentContext.file.user'),     preview: name || t('agentContext.wizard.namePh') },
                    { id: 'memory',   title: t('agentContext.file.memory'),   preview: '§ (empty — agent will populate)' },
                  ].map((f) => (
                    <div key={f.id} className="flex items-start gap-3 px-3 py-2.5 bg-surface border border-border rounded-lg">
                      <Check size={14} className="text-primary mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-foreground">{f.title}</div>
                        <div className="text-xs text-muted-foreground truncate">{f.preview}</div>
                      </div>
                    </div>
                  ))}
                </div>
                {error && (
                  <div className="text-xs text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg p-2">
                    {error}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between mt-6 pt-4 border-t border-border">
            <button
              onClick={() => handleClose(false)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {t('agentContext.wizard.skip')}
            </button>
            <div className="flex items-center gap-2">
              {step > 0 && (
                <button
                  onClick={handlePrev}
                  className="px-3 py-1.5 bg-surface border border-border hover:border-primary text-foreground rounded-lg text-xs font-medium transition-colors flex items-center gap-1"
                >
                  <ChevronLeft size={14} /> {t('agentContext.wizard.back')}
                </button>
              )}
              {step < STEP_IDS.length - 1 ? (
                <button
                  onClick={handleNext}
                  className="px-3 py-1.5 bg-primary hover:bg-primary-hover text-white rounded-lg text-xs font-medium transition-colors flex items-center gap-1"
                >
                  {t('agentContext.wizard.next')} <ChevronRight size={14} />
                </button>
              ) : (
                <button
                  onClick={handleCreate}
                  disabled={saving}
                  className="px-3 py-1.5 bg-primary hover:bg-primary-hover text-white rounded-lg text-xs font-medium transition-colors flex items-center gap-1 disabled:opacity-50"
                >
                  {saving ? (
                    <span className="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Check size={14} />
                  )}
                  {t('agentContext.wizard.create', { n: 4 })}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export { SEEN_KEY as WIZARD_SEEN_KEY }
