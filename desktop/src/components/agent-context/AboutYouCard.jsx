// AboutYouCard — extracted from SettingsPanel.jsx.
//
// The Settings page used to have a long "About You" section with a
// bio textarea + save button. With the Context modal refactor, that
// section is no longer in the rail — it lives inside the modal as
// the first card, above the 5 Agent Context cards. The bio state
// is owned here so the modal can manage it independently of the
// rest of Settings.
//
// Persists to /api/profile (matches the previous SettingsPanel
// behaviour — same endpoint, same shape).

import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Save, Loader2 } from 'lucide-react'
import { apiFetch } from '../../lib/api.js'

export default function AboutYouCard() {
  const { t } = useTranslation()
  const [bio, setBio] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')  // '' | 'saved' | 'failed'

  // Load on mount
  useEffect(() => {
    let cancelled = false
    apiFetch('/api/profile')
      .then(r => r.ok ? r.json() : { bio: '' })
      .then(data => { if (!cancelled) setBio(data.bio || '') })
      .catch(() => { if (!cancelled) setBio('') })
    return () => { cancelled = true }
  }, [])

  // Auto-clear the saved/failed toast after 3s
  useEffect(() => {
    if (!message) return
    const id = setTimeout(() => setMessage(''), 3000)
    return () => clearTimeout(id)
  }, [message])

  const handleSave = async () => {
    setSaving(true)
    setMessage('')
    try {
      await apiFetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bio }),
      })
      setMessage('saved')
    } catch {
      setMessage('failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
          <span className="text-sm font-semibold">A</span>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-foreground">
            {t('settings.aboutYou')}
          </h3>
        </div>
      </div>
      <div className="p-4 space-y-3">
        <p className="text-[11.5px] text-muted-foreground leading-relaxed">
          {t('settings.aboutYouDesc')}
        </p>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          placeholder={t('settings.aboutYouPlaceholder')}
          rows={6}
          className="w-full bg-surface border border-border rounded-[10px] px-3 py-2.5 text-[13px] text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-primary transition-colors leading-relaxed"
        />
        <div className="flex justify-between items-center">
          <p className="text-[10px] text-muted-foreground">{t('settings.aboutYouHint')}</p>
          <div className="flex items-center gap-2">
            {message === 'saved' && (
              <span className="text-[11px] text-emerald-600 dark:text-emerald-400">
                {t('settings.profileSaved') || 'Saved'}
              </span>
            )}
            {message === 'failed' && (
              <span className="text-[11px] text-red-600 dark:text-red-400">
                {t('settings.profileFailed') || 'Save failed'}
              </span>
            )}
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-1.5 bg-primary hover:bg-primary-hover disabled:opacity-40 text-white rounded-[8px] text-[12px] font-medium transition-colors flex items-center gap-1.5"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              {t('settings.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
