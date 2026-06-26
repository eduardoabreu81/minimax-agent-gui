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

import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { X, ChevronLeft, ChevronRight, Check, Sparkles, User, Briefcase } from 'lucide-react'
import { useAgentContext, buildUserBody, buildMemoryBody } from '../../hooks/useAgentContext.js'

// localStorage key — separate from the global Onboarding tour
// (minimax-onboarding-seen) so closing one doesn't suppress the other.
const SEEN_KEY = 'agent-context-wizard-seen'

const STEP_IDS = ['about', 'personality', 'identity', 'review']

// ─────────────────────────────────────────────────────────────────────────────
// TimezoneSelect — scrollable, universal IANA timezone picker.
//
// Replaces the old text input for the wizard's timezone field. Uses
// `Intl.supportedValuesOf('timeZone')` (Node 18+ / all evergreen
// browsers) to enumerate every IANA timezone the runtime knows about —
// usually ~400. Each entry shows the IANA id plus its current UTC
// offset (computed live so DST shifts reflect automatically).
//
// Grouped by leading region segment ("America/", "Europe/", etc.) with
// <optgroup> headers so the user can scan their continent first. Sorted
// by current UTC offset within each group, then alphabetically — so
// nearby zones cluster together (e.g. all of America at UTC-03 to
// UTC-08 stay adjacent, regardless of alphabetical id order).
//
// Exported for unit testing (see OnboardingWizard.test.jsx).
// ─────────────────────────────────────────────────────────────────────────────

// Compute the current UTC offset for an IANA timezone. Returns a
// string like "UTC-03:00" or "UTC+05:30". Stable across DST shifts
// because we format the current instant, not a fixed one.
function formatOffset(tz) {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'longOffset',
    })
    const parts = fmt.formatToParts(new Date())
    const offsetPart = parts.find((p) => p.type === 'timeZoneName')?.value || ''
    // longOffset comes back as "GMT-03:00" — normalize to "UTC-03:00".
    return offsetPart.replace(/^GMT/, 'UTC') || 'UTC'
  } catch {
    return 'UTC'
  }
}

// Compare two "UTC±HH:MM" strings numerically so similar offsets
// cluster together. Returns a stable integer sort key.
function offsetSortKey(offsetStr) {
  // "UTC-03:00" → -180, "UTC+05:30" → 330, "UTC" → 0.
  const m = offsetStr.match(/^UTC([+-])(\d{1,2})(?::(\d{2}))?$/)
  if (!m) return 0
  const sign = m[1] === '-' ? -1 : 1
  const hours = parseInt(m[2], 10)
  const mins = parseInt(m[3] || '0', 10)
  return sign * (hours * 60 + mins)
}

// Group a list of {tz, offset} objects by leading region ("America",
// "Europe", etc.). Anything that doesn't start with a known continent
// prefix falls into "Other" (UTC, GMT, Antarctica, Indian, Pacific
// without a /country subtag, etc.).
function groupByRegion(entries) {
  const REGIONS = ['Africa', 'America', 'Antarctica', 'Asia', 'Atlantic',
                   'Australia', 'Europe', 'Indian', 'Pacific']
  const groups = new Map()
  for (const e of entries) {
    const seg = e.tz.split('/')[0]
    const region = REGIONS.includes(seg) ? seg : 'Other'
    if (!groups.has(region)) groups.set(region, [])
    groups.get(region).push(e)
  }
  // Sort each group's entries: by offset first, then by IANA name.
  for (const list of groups.values()) {
    list.sort((a, b) => {
      const oa = offsetSortKey(a.offset)
      const ob = offsetSortKey(b.offset)
      if (oa !== ob) return oa - ob
      return a.tz.localeCompare(b.tz)
    })
  }
  // Sort the groups themselves by their first entry's offset — keeps
  // the most "negative" regions (Americas) at the top, "Other" at
  // the bottom.
  const ordered = [...groups.entries()].sort((a, b) => {
    if (!a[1].length) return 1
    if (!b[1].length) return -1
    return offsetSortKey(a[1][0].offset) - offsetSortKey(b[1][0].offset)
  })
  return ordered
}

export function TimezoneSelect({ value, onChange, detectedTz }) {
  // Build the full list once per mount (the IANA database doesn't
  // change at runtime). Detected timezone is shown first as a hint
  // for the user — they can confirm or pick a different one.
  const groups = useMemo(() => {
    let zones = []
    try {
      if (typeof Intl.supportedValuesOf === 'function') {
        zones = Intl.supportedValuesOf('timeZone') || []
      }
    } catch { /* old runtime — fall through to empty list */ }
    const entries = zones.map((tz) => ({ tz, offset: formatOffset(tz) }))
    return groupByRegion(entries)
  }, [])

  if (groups.length === 0) {
    // Runtime doesn't expose Intl.supportedValuesOf (very old). Fall
    // back to a free-text input so the wizard still works.
    return (
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Continent/City"
        className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm focus:outline-none focus:border-primary font-mono"
      />
    )
  }

  return (
    <div className="space-y-1">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm focus:outline-none focus:border-primary font-mono"
        data-testid="wizard-timezone-select"
      >
        {groups.map(([region, entries]) => (
          <optgroup key={region} label={region}>
            {entries.map(({ tz, offset }) => (
              <option key={tz} value={tz}>
                {tz} ({offset})
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {detectedTz && detectedTz !== value && (
        <button
          type="button"
          onClick={() => onChange(detectedTz)}
          className="text-[11px] text-primary hover:underline"
        >
          Use detected: <span className="font-mono">{detectedTz}</span>
        </button>
      )}
    </div>
  )
}

export default function OnboardingWizard({ open, onClose }) {
  const { t, i18n } = useTranslation()
  const { saveBatch, refreshStatus, getPresetBody, getRoleBody, presets, roles } = useAgentContext()

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

  // Preset/role bodies come from the hook (which fetches from the
  // backend /presets and /roles endpoints on mount). The backend
  // i18n table is the single source of truth. If the hook hasn't
  // loaded yet, getPresetBody/getRoleBody return the JS fallback
  // map so the wizard still has *something* to show.
  //
  // The "preview" string on each card is the body's second line —
  // a one-sentence teaser. The full body is only written to
  // SOUL.md / IDENTITY.md when the user clicks "Create 4 files".
  const presetTeaser = (id) => {
    const body = getPresetBody(id)
    return body.split('\n').find(l => l.trim() && !l.startsWith('#')) || ''
  }
  const roleTeaser = (id) => {
    const body = getRoleBody(id)
    return body.split('.')[0] || ''
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
      // Identity body: custom = user types it inline; non-custom =
      // canonical body from /roles (via the hook).
      const identityBody = role === 'custom'
        ? customRole.trim()
        : getRoleBody(role)

      const entries = [
        { id: 'soul',     content: getPresetBody(preset) },
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
                <TimezoneSelect
                  value={timezone}
                  onChange={setTimezone}
                  detectedTz={(() => {
                    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || '' }
                    catch { return '' }
                  })()}
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
                      {/* Prefer the live preset name from /presets (already
                          i18n-resolved by the backend); fall back to the
                          frontend t() key for offline mode. */}
                      {presets.find(x => x.id === p)?.name || t(`agentContext.presets.${p}`)}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
                      {presetTeaser(p)}
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
                      {roles.find(x => x.id === r)?.name || t(`agentContext.roles.${r}`)}
                    </div>
                    {r !== 'custom' && (
                      <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
                        {roleTeaser(r)}
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
