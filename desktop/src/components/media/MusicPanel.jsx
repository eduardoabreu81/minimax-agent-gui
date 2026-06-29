import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Music, Loader2, Save, Wand2, Guitar, AudioLines, Check, Coins, FileAudio, Upload, Disc3, X, Link2, AlertCircle, Mic, NotebookPen, Copy, Sparkles } from 'lucide-react'
import { useSessionProtection } from '../../hooks/useSessionProtection'
import RecentGenerations from './RecentGenerations'
import ModeTabBar from '../shared/ModeTabBar'
import { apiFetch, assetUrl } from '../../lib/api.js'

// Phase 1: only the two music-2.6 variants. Cover (music-cover / -free)
// and lyrics generation come in Phase 2/3 and live on separate panels.
// Dropdown keeps the row compact — see how the chat model picker is
// laid out in SettingsPanel.
const MUSIC_MODES = [
  { id: 'generate', label: 'Compose', icon: Music },
  { id: 'cover',    label: 'Cover',   icon: Disc3 },
  { id: 'lyrics',   label: 'Lyrics',  icon: NotebookPen },
]

const MUSIC_MODELS = [
  { id: 'music-2.6', label: 'Music 2.6', descKey: 'music.bestQuality' },
  { id: 'music-2.6-free', label: 'Music 2.6 Free', descKey: 'music.unlimitedDefault' },
]

const MUSIC_COVER_MODELS = [
  { id: 'music-cover', labelKey: 'music.coverModelCover' },
  { id: 'music-cover-free', labelKey: 'music.coverModelCoverFree' },
]

const COVER_FEATURE_CACHE_PREFIX = 'minimax.music.cover.feature.'
const COVER_FEATURE_TTL_MS = 24 * 60 * 60 * 1000

// Lyrics structure tags the MiniMax API returns — used to render the
// generated lyrics as styled chips in the result pane (matches the
// spec's "14 structure tags" reference in TAURI_SPEC.md §5c).
const LYRICS_STRUCTURE_TAGS = ['Intro', 'Verse', 'Pre-Chorus', 'Chorus', 'Hook', 'Drop', 'Bridge', 'Solo', 'Build-up', 'Instrumental', 'Breakdown', 'Break', 'Interlude', 'Outro']

// Read the cached ``cover_feature_id`` (if any) for the given audio
// source. Returns ``{ featureId, expiresAt }`` or ``null``.
function readCachedFeature(audioUrl) {
  if (!audioUrl) return null
  try {
    const raw = localStorage.getItem(COVER_FEATURE_CACHE_PREFIX + audioUrl)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.featureId || !parsed?.expiresAt) return null
    if (Date.parse(parsed.expiresAt) <= Date.now()) return null
    return parsed
  } catch {
    return null
  }
}

function writeCachedFeature(audioUrl, featureId, expiresAtIso) {
  if (!audioUrl || !featureId) return
  try {
    localStorage.setItem(
      COVER_FEATURE_CACHE_PREFIX + audioUrl,
      JSON.stringify({ featureId, expiresAt: expiresAtIso }),
    )
  } catch { /* quota / private mode — skip */ }
}

const STRUCTURE_TAGS = ['Intro', 'Verse', 'Pre Chorus', 'Chorus', 'Interlude', 'Bridge', 'Outro', 'Post Chorus', 'Hook', 'Inst']

// Mirror of backend AUDIO_* enums (mini_max_mcp → web/backend/main.py).
// Kept client-side so the panel can show "what will be sent" without
// round-tripping the spec — backend re-validates on submit.
const AUDIO_SETTING_DEFAULT = { sample_rate: 44100, bitrate: 256000, format: 'mp3' }

function formatDuration(ms) {
  if (!ms || ms <= 0) return '—'
  const total = Math.round(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

export default function MusicPanel() {
  const { t } = useTranslation()
  // Phase 1 surface is a single panel with two peer checkboxes (auto-gen
  // lyrics, instrumental) instead of a mode button group. Cover will
  // land in Phase 2 as its own tab + flow.
  const [isInstrumental, setIsInstrumental] = useState(false)
  const [model, setModel] = useState('music-2.6')
  const [prompt, setPrompt] = useState('')
  const [lyrics, setLyrics] = useState('')
  const [useLyricsOptimizer, setUseLyricsOptimizer] = useState(false)
  const [filename, setFilename] = useState('')
  // Mirror of Settings → Audio tab. Loaded once from /api/config so the
  // panel reflects what the backend will actually use. Refreshed on
  // mount; not re-fetched per-keystroke (would be overkill).
  const [audioSetting, setAudioSetting] = useState(AUDIO_SETTING_DEFAULT)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  // ---- Cover (music-cover / music-cover-free) state ----
  const [mode, setMode] = useState('generate')           // 'generate' | 'cover' | 'lyrics'
  const [coverMode, setCoverMode] = useState('quick')    // 'quick' | 'custom'
  const [coverModel, setCoverModel] = useState('music-cover')
  const [coverPrompt, setCoverPrompt] = useState('')
  const [referenceUrl, setReferenceUrl] = useState('')   // audio_url sent to API
  const [referenceFileName, setReferenceFileName] = useState('')
  const [referenceFileSize, setReferenceFileSize] = useState(0)
  const [coverFeatureId, setCoverFeatureId] = useState('')
  const [featureExpiresAt, setFeatureExpiresAt] = useState('')
  const [preprocessLoading, setPreprocessLoading] = useState(false)
  const fileInputRef = useRef(null)
  // ---- Lyrics (lyrics_generation) state ----
  const [lyricsMode, setLyricsMode] = useState('write_full_song')  // 'write_full_song' | 'edit'
  const [lyricsThemePrompt, setLyricsThemePrompt] = useState('')
  const [lyricsSourceLyrics, setLyricsSourceLyrics] = useState('')
  const [lyricsTitle, setLyricsTitle] = useState('')
  const [lyricsLoading, setLyricsLoading] = useState(false)
  const [lyricsResult, setLyricsResult] = useState(null)  // { song_title, style_tags, lyrics, trace_id }
  const [lyricsCopied, setLyricsCopied] = useState(false)
  const [cost, setCost] = useState(null)
  const [error, setError] = useState(null)
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const { register } = useSessionProtection()

  useEffect(() => {
    register('music-loading', loading, t('music.title'))
  }, [loading, register, t])

  useEffect(() => {
    register('music-prompt', prompt.trim().length > 0 || lyrics.trim().length > 0, t('music.stylePrompt'))
  }, [prompt, lyrics, register, t])

  // Pull audio defaults from the dedicated endpoint so the panel reflects
  // what the backend will actually use (sample_rate / bitrate / format).
  // Falls back to AUDIO_SETTING_DEFAULT if the call fails or the shape
  // doesn't match.
  useEffect(() => {
    apiFetch('/api/config/defaults/audio')
      .then(r => r.json())
      .then(data => {
        if (data && typeof data === 'object') {
          setAudioSetting({
            sample_rate: Number(data.sample_rate) || AUDIO_SETTING_DEFAULT.sample_rate,
            bitrate: Number(data.bitrate) || AUDIO_SETTING_DEFAULT.bitrate,
            format: String(data.format || AUDIO_SETTING_DEFAULT.format),
          })
        }
      })
      .catch(() => { /* keep default */ })
  }, [])

  const fetchHistory = async () => {
    setHistoryLoading(true)
    try {
      const res = await apiFetch('/api/generations')
      const data = await res.json()
      let music = []
      if (data.success) music = data.data.music || []

      const wsRes = await apiFetch('/api/files?path=workspace')
      const wsData = await wsRes.json()
      if (wsData.entries) {
        const wsMusic = wsData.entries
          .filter(e => !e.is_dir && /\.(mp3|wav|pcm|flac|m4a)$/i.test(e.name))
          .filter(e => /^(music_|music_web|generated_music)/i.test(e.name))
          .map(e => ({ name: e.name, path: e.path, size: 0 }))
        const seen = new Set(music.map(i => i.path))
        wsMusic.forEach(m => {
          if (!seen.has(m.path)) music.push(m)
        })
      }

      music.sort((a, b) => {
        if (a.modified_at && b.modified_at) return b.modified_at.localeCompare(a.modified_at)
        return b.name.localeCompare(a.name)
      })

      setHistory(music)
    } catch (e) { /* ignore */ }
    setHistoryLoading(false)
  }

  useEffect(() => {
    fetchHistory()
  }, [])

  const insertTag = (tag) => {
    setLyrics(prev => prev + (prev ? '\n' : '') + `[${tag}] `)
  }

  const generate = async () => {
    // Client-side mirror of backend validation. Saves a round-trip and
    // gives an instant error before the request fires.
    if (isInstrumental) {
      if (!prompt.trim()) {
        setError(t('music.instrumentalNeedsPrompt') || 'Instrumental mode requires a style prompt.')
        return
      }
      if (prompt.length > 2000) {
        setError(t('music.promptTooLong') || 'Prompt exceeds 2000 character limit.')
        return
      }
    } else {
      if (!useLyricsOptimizer && !lyrics.trim()) {
        setError(t('music.lyricsRequired') || 'Lyrics are required (or enable Auto-generate lyrics).')
        return
      }
      if (lyrics.length > 3500) {
        setError(t('music.exceedsLimit'))
        return
      }
    }

    setLoading(true)
    setError(null)
    setResult(null)
    setCost(null)
    try {
      const body = {
        model,
        prompt,
        lyrics,
        is_instrumental: isInstrumental,
        lyrics_optimizer: useLyricsOptimizer && !isInstrumental,  // forced false in instrumental mode
        filename: filename.trim(),
        audio_setting: audioSetting,
      }

      const res = await apiFetch('/api/music', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        // FastAPI HTTPException puts the message in `detail`; our custom
        // 4xx/5xx responses (cover/balance/rate-limit) do the same.
        const msg = data.detail || data.error || t('music.failed')
        setError(typeof msg === 'string' ? msg : JSON.stringify(msg))
      } else {
        setResult(data)
        if (typeof data.cost_credits === 'number' || typeof data.cost_usd === 'number') {
          setCost({ cost_credits: data.cost_credits, cost_usd: data.cost_usd })
        }
        fetchHistory()
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('minimax:media-complete'))
        }
      }
    } catch (e) {
      setError(e.message || t('music.failed'))
    }
    setLoading(false)
  }

  // ============ Cover flow ============

  // Upload a reference audio file via /api/upload, store the returned
  // workspace path as ``referenceUrl`` so /api/minimax/music/preprocess
  // can resolve it on the backend (the pre-flight check at the backend
  // validates size + format against the on-disk file before the API
  // round-trip). Clears any cached feature ID — a new audio can't reuse
  // a previous one.
  const uploadReferenceFile = async (file) => {
    if (!file) return
    setError(null)
    setCoverFeatureId('')
    setFeatureExpiresAt('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await apiFetch('/api/upload', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error || t('music.coverUploadFailed') || 'Upload failed.')
      }
      // Build the internal download URL the backend's preprocess endpoint
      // understands. /api/files/download?path=... is what _resolve_local_audio_url
      // pattern-matches against.
      const downloadUrl = `/api/files/download?path=${encodeURIComponent(data.path)}`
      setReferenceUrl(downloadUrl)
      setReferenceFileName(data.filename || file.name)
      setReferenceFileSize(file.size || 0)
    } catch (e) {
      setError(e.message || t('music.coverUploadFailed') || 'Upload failed.')
    }
  }

  const onDropFile = (e) => {
    e.preventDefault()
    const file = e.dataTransfer?.files?.[0]
    if (file) uploadReferenceFile(file)
  }

  const onPickFile = (e) => {
    const file = e.target.files?.[0]
    if (file) uploadReferenceFile(file)
    // Allow re-selecting the same file later.
    if (e.target) e.target.value = ''
  }

  const onPasteUrl = (raw) => {
    setError(null)
    setCoverFeatureId('')
    setFeatureExpiresAt('')
    setReferenceFileName('')
    setReferenceFileSize(0)
    const url = raw.trim()
    if (!url) {
      setReferenceUrl('')
      return
    }
    if (!/^https?:\/\//i.test(url)) {
      setError(t('music.coverUrlInvalid') || 'Enter a valid http(s) URL or upload a file.')
      setReferenceUrl('')
      return
    }
    setReferenceUrl(url)
  }

  // Hit /api/minimax/music/preprocess. Backend caches the MD5-deduped
  // cover_feature_id (24h), and we additionally mirror it in localStorage
  // so re-opening the panel (or revisiting this audio) skips the round-trip.
  const preprocessAudio = async () => {
    if (!referenceUrl) {
      setError(t('music.coverReferenceAudio') || 'Add a reference audio first.')
      return
    }
    // Look up cache first — MD5-dedup means same audio ⇒ same id.
    const cached = readCachedFeature(referenceUrl)
    if (cached) {
      setCoverFeatureId(cached.featureId)
      setFeatureExpiresAt(cached.expiresAt)
      setLyrics('') // Don't pre-fill lyrics — user must extract first
      return
    }
    setPreprocessLoading(true)
    setError(null)
    try {
      const res = await apiFetch('/api/minimax/music/preprocess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio_url: referenceUrl }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        const msg = data.detail || data.error || t('music.coverPreprocessFailed') || 'Preprocess failed.'
        throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
      }
      setCoverFeatureId(data.cover_feature_id || '')
      setFeatureExpiresAt(data.feature_expires_at || '')
      if (data.formatted_lyrics) setLyrics(data.formatted_lyrics)
      writeCachedFeature(referenceUrl, data.cover_feature_id, data.feature_expires_at)
    } catch (e) {
      setError(e.message || t('music.coverPreprocessFailed') || 'Preprocess failed.')
    } finally {
      setPreprocessLoading(false)
    }
  }

  // Mirror of backend validation for the cover flow.
  const validateCover = () => {
    if (!referenceUrl) {
      return t('music.coverReferenceAudio') || 'Add a reference audio first.'
    }
    const p = coverPrompt.trim()
    if (p.length < 10 || p.length > 300) {
      return (t('music.coverPromptHint') || 'Prompt must be 10–300 characters.')
    }
    if (coverMode === 'custom') {
      if (!coverFeatureId) {
        return t('music.coverLyricsRequired') || 'Click "Extract Lyrics" first.'
      }
      const l = lyrics.trim()
      if (l.length < 10 || l.length > 1000) {
        return (t('music.coverLyricsHintCustom') || 'Lyrics must be 10–1000 characters.')
      }
    } else {
      // Quick mode: lyrics optional, but if provided must be 10-1000.
      const l = lyrics.trim()
      if (l && (l.length < 10 || l.length > 1000)) {
        return (t('music.coverLyricsHintQuick') || 'When provided, lyrics must be 10–1000 characters.')
      }
    }
    return null
  }

  const generateCover = async () => {
    const validationError = validateCover()
    if (validationError) {
      setError(validationError)
      return
    }
    setLoading(true)
    setError(null)
    setResult(null)
    setCost(null)
    try {
      const body = {
        model: coverModel,
        prompt: coverPrompt,
        lyrics: lyrics.trim(),
        filename: filename.trim(),
        audio_setting: audioSetting,
      }
      // Quick mode uses audio_url; custom mode uses cover_feature_id.
      if (coverMode === 'custom') {
        body.cover_feature_id = coverFeatureId
      } else {
        body.audio_url = referenceUrl
      }
      const res = await apiFetch('/api/music', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        const msg = data.detail || data.error || t('music.failed')
        throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
      }
      setResult(data)
      if (typeof data.cost_credits === 'number' || typeof data.cost_usd === 'number') {
        setCost({ cost_credits: data.cost_credits, cost_usd: data.cost_usd })
      }
      fetchHistory()
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('minimax:media-complete'))
      }
    } catch (e) {
      setError(e.message || t('music.failed'))
    } finally {
      setLoading(false)
    }
  }

  // ============ Lyrics flow ============

  // Mirror of backend validation. Keep client-side checks in sync with
  // ``LyricsRequest`` in web/backend/main.py so we surface the error
  // before the round-trip.
  const validateLyrics = () => {
    const p = lyricsThemePrompt.trim()
    if (lyricsMode === 'write_full_song') {
      if (!p) return t('music.lyricsPromptRequired') || 'Theme is required.'
    } else {
      if (!lyricsSourceLyrics.trim()) {
        return t('music.lyricsEditNeedsSource') || 'Existing lyrics are required in edit mode.'
      }
    }
    if (p.length > 2000) {
      return t('music.lyricsPromptTooLong') || 'Theme exceeds 2000 character limit.'
    }
    if (lyricsMode === 'edit' && lyricsSourceLyrics.length > 3500) {
      return t('music.lyricsEditTooLong') || 'Existing lyrics exceed 3500 character limit.'
    }
    return null
  }

  const generateLyrics = async () => {
    const validationError = validateLyrics()
    if (validationError) {
      setError(validationError)
      return
    }
    setLyricsLoading(true)
    setError(null)
    setLyricsResult(null)
    try {
      const body = {
        mode: lyricsMode,
        prompt: lyricsThemePrompt,
        lyrics: lyricsMode === 'edit' ? lyricsSourceLyrics : '',
        title: lyricsTitle.trim(),
      }
      const res = await apiFetch('/api/minimax/music/lyrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        const msg = data.detail || data.error || t('music.lyricsFailed') || 'Lyrics generation failed.'
        throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
      }
      setLyricsResult({
        song_title: data.song_title || '',
        style_tags: data.style_tags || '',
        lyrics: data.lyrics || '',
        trace_id: data.trace_id || '',
      })
    } catch (e) {
      setError(e.message || t('music.lyricsFailed') || 'Lyrics generation failed.')
    } finally {
      setLyricsLoading(false)
    }
  }

  // Cross-handoff: Lyrics → Compose. Drops lyrics + style_tags into
  // the Compose form and switches mode. Style tags are prepended to the
  // prompt so the user can see/edit them before generating.
  const useLyricsInCompose = () => {
    if (!lyricsResult) return
    setLyrics(lyricsResult.lyrics || '')
    const tags = (lyricsResult.style_tags || '').trim()
    if (tags) {
      // Merge into the existing prompt rather than overwrite, so the
      // user's own style description isn't lost.
      setPrompt((prev) => {
        const prevClean = prev.trim()
        return prevClean ? `${prevClean}, ${tags}` : tags
      })
    }
    setMode('generate')
  }

  // Cross-handoff: Compose → Lyrics (write mode). Carries the current
  // prompt as the lyrics-generation theme, so the user can iterate.
  const openLyricsMode = () => {
    if (prompt.trim()) {
      setLyricsThemePrompt(prompt)
    }
    setLyricsMode('write_full_song')
    setMode('lyrics')
  }

  const copyLyricsToClipboard = async () => {
    if (!lyricsResult?.lyrics) return
    try {
      await navigator.clipboard.writeText(lyricsResult.lyrics)
      setLyricsCopied(true)
      setTimeout(() => setLyricsCopied(false), 2000)
    } catch {
      /* clipboard blocked — ignore */
    }
  }

  return (
    // Two-column layout: full-width top bar (icon + title + ModeTabBar)
    // at the very top, then form-left 380px + tracks-right flex-1 below.
    // The mockup is the visual source for the panel shape; the field set
    // is from our own Phase 1 spec because the API requires prompt/model
    // and the user wants the Instrumental as a checkbox. All state, fetch
    // and validation logic above stays untouched.
    <div className="flex flex-col h-full bg-card">
      {/* ============ TOP BAR (full-width) ============ */}
      <div className="h-[56px] shrink-0 flex items-center justify-between px-[22px] border-b border-border">
        {/* Left: icon + title (mockup L622-628) */}
        <div className="flex items-center gap-[11px] min-w-0">
          <div className="w-[34px] h-[34px] rounded-[9px] bg-primary/14 flex items-center justify-center text-primary shrink-0">
            <Music size={18} />
          </div>
          <div className="min-w-0">
            <div className="text-[15px] font-semibold truncate">Music</div>
            <div className="text-[11.5px] text-muted-foreground truncate">Lyrics &amp; prompt to song</div>
          </div>
        </div>
        {/* Right: sub-mode pills (mockup L629-633) */}
        <div className="shrink-0">
          <ModeTabBar modes={MUSIC_MODES} active={mode} onChange={setMode} />
        </div>
      </div>

      {/* ============ COLUMNS (form-left 380px + tracks-right flex-1) ============ */}
      <div className="flex flex-1 min-h-0">
      {/* ============ FORM COLUMN (left, 380px) ============ */}
      <div className="w-[380px] flex-none flex flex-col border-r border-border overflow-y-auto">
        {/* Form fields — vertical stack, gap 18px, padding 18px 22px */}
        <div className="px-[22px] py-[18px] flex flex-col gap-[18px]">
          {/* ============ Generate (Phase 1) fields ============ */}
          {mode === 'generate' && (
          <>
          {/* Model — keeps the 2-option dropdown (music-2.6 / -free) */}
          <div>
            <label className="text-[11.5px] font-semibold text-muted-foreground mb-[7px] block">{t('music.model')}</label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
            >
              {MUSIC_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} — {t(m.descKey)}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-muted-foreground mt-1">
              {t('music.modelHint') || 'Music 2.6 is the paid Tier-Plan model; Free has lower RPM but is available to all API-key users.'}
            </p>
          </div>

          {/* Filename (optional) */}
          <div>
            <label className="text-[11.5px] font-semibold text-muted-foreground mb-[7px] flex items-center gap-1.5">
              <FileAudio size={12} /> {t('music.filename') || 'Filename (optional)'}
            </label>
            <input
              type="text"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              placeholder={t('music.filenamePlaceholder') || 'auto: timestamp if blank'}
              className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
            />
          </div>

          {/* Prompt */}
          <div>
            <label className="text-[11.5px] font-semibold text-muted-foreground mb-[7px] flex items-center gap-1.5">
              <Guitar size={12} /> {t('music.stylePrompt')}
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value.slice(0, 2000))}
              placeholder={t('music.stylePlaceholder')}
              className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-primary"
              rows={3}
            />
            <div className="flex items-center justify-between mt-1">
              <p className="text-[10px] text-muted-foreground">{t('music.characters', { count: prompt.length.toLocaleString() })}</p>
            </div>
          </div>

          {/* Lyrics — label on left, two peer checkboxes stacked on the
              right. Auto-generate fills the lyrics-optimizer gap when
              the user has no lyrics; Instrumental swaps the panel into
              vocal-free mode and hides the textarea + structure tags.
              The "Write with AI" button is the cross-handoff into the
              Lyrics sub-mode (TAURI_SPEC §5c) — it carries the current
              prompt as the lyrics theme so users can iterate. */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <label className="text-[11.5px] font-semibold text-muted-foreground flex items-center gap-1.5">
                  <Music size={12} /> {t('music.lyrics')}
                </label>
                <button
                  onClick={openLyricsMode}
                  title={t('music.lyricsWriteWithAi') || 'Write with AI'}
                  className="px-2 py-0.5 bg-primary/10 border border-primary/20 rounded text-[10px] font-medium text-primary hover:bg-primary/20 transition-colors flex items-center gap-1"
                >
                  <Sparkles size={10} /> {t('music.lyricsWriteWithAi') || 'Write with AI'}
                </button>
              </div>
              <div className="flex flex-col gap-1 items-end">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useLyricsOptimizer}
                    onChange={(e) => setUseLyricsOptimizer(e.target.checked)}
                    className="rounded border-border text-primary focus:ring-primary"
                  />
                  <span className="text-[10.5px] text-foreground flex items-center gap-1" title={t('music.autoGenLyrics')}>
                    <Wand2 size={11} /> {t('music.autoGenLyrics')}
                  </span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isInstrumental}
                    onChange={(e) => setIsInstrumental(e.target.checked)}
                    className="rounded border-border text-primary focus:ring-primary"
                  />
                  <span className="text-[10.5px] text-foreground flex items-center gap-1" title={t('music.instrumentalTip')}>
                    <AudioLines size={11} /> {t('music.instrumental')}
                  </span>
                </label>
              </div>
            </div>
            {isInstrumental ? (
              <p className="text-[11px] text-muted-foreground italic px-1 py-2">
                {t('music.instrumentalActiveHint') || 'This song will be instrumental, with no vocals or lyrics.'}
              </p>
            ) : (
              !useLyricsOptimizer && (
                <>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {STRUCTURE_TAGS.map((tag) => (
                      <button
                        key={tag}
                        onClick={() => insertTag(tag)}
                        className="px-2 py-0.5 bg-surface border border-border rounded text-[10px] text-muted-foreground hover:border-primary hover:text-foreground transition-colors"
                      >
                        +{tag}
                      </button>
                    ))}
                  </div>
                  <textarea
                    value={lyrics}
                    onChange={(e) => setLyrics(e.target.value.slice(0, 3500))}
                    placeholder={`[Verse] La da dee, sunny day\n[Chorus] Summer vibes all the way...`}
                    className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-primary font-mono"
                    rows={5}
                  />
                  <div className="flex items-center justify-between mt-1">
                    <p className="text-[10px] text-muted-foreground">{t('music.characters3500', { count: lyrics.length.toLocaleString() })}</p>
                    {lyrics.length > 3500 && <p className="text-[10px] text-error">{t('music.exceedsLimit')}</p>}
                  </div>
                </>
              )
            )}
          </div>
          </>
          )}

          {/* ============ Cover (music-cover / music-cover-free) fields ============ */}
          {mode === 'cover' && (
          <>
            {/* Cover Mode toggle: Quick (one-step) vs Custom (two-step) */}
            <div>
              <label className="text-[11.5px] font-semibold text-muted-foreground mb-[7px] block">
                {t('music.coverModeLabel') || 'Cover Mode'}
              </label>
              <div className="flex items-center bg-surface rounded-lg border border-border p-0.5">
                <button
                  onClick={() => setCoverMode('quick')}
                  className={`flex-1 px-3 py-1.5 rounded text-[11.5px] font-medium transition-colors ${coverMode === 'quick' ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {t('music.coverModeQuick') || 'Quick (one-step)'}
                </button>
                <button
                  onClick={() => setCoverMode('custom')}
                  className={`flex-1 px-3 py-1.5 rounded text-[11.5px] font-medium transition-colors ${coverMode === 'custom' ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {t('music.coverModeCustom') || 'Custom (two-step)'}
                </button>
              </div>
            </div>

            {/* Cover Model picker — both options always visible per the
                user decision (no tier-based default). */}
            <div>
              <label className="text-[11.5px] font-semibold text-muted-foreground mb-[7px] block">
                {t('music.coverModelLabel') || 'Cover Model'}
              </label>
              <select
                value={coverModel}
                onChange={(e) => setCoverModel(e.target.value)}
                className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
              >
                {MUSIC_COVER_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {t(m.labelKey) || m.id}
                  </option>
                ))}
              </select>
            </div>

            {/* Reference Audio — file picker (drag/drop + click) with a
                small input below for pasting an external URL. The
                backend pre-flight validates size + format when the URL
                points to a local upload (workspace/uploads/cover_refs/...);
                external URLs are passed through and the API validates. */}
            <div>
              <label className="text-[11.5px] font-semibold text-muted-foreground mb-[7px] flex items-center gap-1.5">
                <Mic size={12} /> {t('music.coverReferenceAudio') || 'Reference Audio'}
              </label>
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={onDropFile}
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-border rounded-lg p-4 text-center cursor-pointer hover:border-primary hover:bg-primary/5 transition-colors"
              >
                {referenceFileName ? (
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <FileAudio size={14} className="text-primary shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[12px] text-foreground truncate">{referenceFileName}</p>
                        <p className="text-[10px] text-muted-foreground">{formatBytes(referenceFileSize)}</p>
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setReferenceUrl('')
                        setReferenceFileName('')
                        setReferenceFileSize(0)
                        setCoverFeatureId('')
                        setFeatureExpiresAt('')
                      }}
                      className="p-1 rounded hover:bg-error/10 text-muted-foreground hover:text-error transition-colors shrink-0"
                      title="Remove"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-1 text-muted-foreground">
                    <Upload size={18} />
                    <p className="text-[11.5px]">{t('music.coverUploadCta') || 'Click to upload or drag & drop'}</p>
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*"
                  onChange={onPickFile}
                  className="hidden"
                />
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                {t('music.coverReferenceAudioHint') || 'Upload or paste a URL — mp3, wav, flac, m4a (6s–6 min, max 50 MB).'}
              </p>
              <div className="mt-2 flex items-center gap-1.5">
                <Link2 size={11} className="text-muted-foreground shrink-0" />
                <input
                  type="text"
                  value={referenceUrl.startsWith('/api/') ? '' : referenceUrl}
                  onChange={(e) => onPasteUrl(e.target.value)}
                  placeholder={t('music.coverUrlPlaceholder') || 'https://example.com/song.mp3'}
                  className="flex-1 bg-card border border-border rounded px-2 py-1 text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
                />
              </div>
            </div>

            {/* Style / Prompt (10-300 chars for cover) */}
            <div>
              <label className="text-[11.5px] font-semibold text-muted-foreground mb-[7px] flex items-center gap-1.5">
                <Guitar size={12} /> {t('music.stylePrompt')}
              </label>
              <textarea
                value={coverPrompt}
                onChange={(e) => setCoverPrompt(e.target.value.slice(0, 300))}
                placeholder="Jazz, smooth, late night lounge, saxophone"
                className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-primary"
                rows={2}
              />
              <div className="flex items-center justify-between mt-1">
                <p className="text-[10px] text-muted-foreground">
                  {t('music.coverPromptHint') || '10–300 characters describing the target cover style.'}
                </p>
                <p className="text-[10px] text-muted-foreground">{coverPrompt.length} / 300</p>
              </div>
            </div>

            {/* Lyrics — same textarea reused, but with cover-specific
                hints and a conditional "Extract Lyrics" button for the
                custom (two-step) flow. In quick mode, the lyrics are
                optional and auto-extracted via ASR if empty. */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[11.5px] font-semibold text-muted-foreground flex items-center gap-1.5">
                  <Music size={12} /> {t('music.lyrics')}
                </label>
                {coverMode === 'custom' && (
                  <button
                    onClick={preprocessAudio}
                    disabled={preprocessLoading || !referenceUrl}
                    className="px-2.5 py-1 text-[10.5px] font-medium bg-surface border border-border rounded-md text-foreground hover:border-primary disabled:opacity-40 transition-colors flex items-center gap-1.5"
                  >
                    {preprocessLoading ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : (
                      <Wand2 size={11} />
                    )}
                    {preprocessLoading
                      ? (t('music.coverPreprocessLoading') || 'Extracting lyrics…')
                      : (t('music.coverPreprocess') || 'Extract Lyrics')}
                  </button>
                )}
              </div>
              {coverMode === 'custom' && coverFeatureId && (
                <p className="text-[10px] text-success flex items-center gap-1 mb-2">
                  <Check size={10} /> {t('music.coverPreprocessSuccess') || 'Lyrics extracted — review and edit before generating.'}
                  {featureExpiresAt && (
                    <span className="text-muted-foreground ml-1">({t('music.coverFeatureCached') || 'cached — re-extract to refresh'})</span>
                  )}
                </p>
              )}
              <textarea
                value={lyrics}
                onChange={(e) => setLyrics(e.target.value.slice(0, 1000))}
                placeholder={coverMode === 'custom'
                  ? '[Verse 1]\nFirst line...'
                  : 'Optional. Leave empty to auto-extract from the reference audio.'}
                className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-primary font-mono"
                rows={5}
              />
              <div className="flex items-center justify-between mt-1">
                <p className="text-[10px] text-muted-foreground">
                  {coverMode === 'custom'
                    ? (t('music.coverLyricsHintCustom') || '10–1000 characters. Required when using a preprocessed feature.')
                    : (t('music.coverLyricsHintQuick') || 'Optional. Leave empty to auto-extract lyrics from the reference audio via ASR.')}
                </p>
                <p className="text-[10px] text-muted-foreground">{lyrics.length} / 1000</p>
              </div>
            </div>
          </>
          )}

          {/* ============ Lyrics (lyrics_generation) fields ============ */}
          {mode === 'lyrics' && (
          <>
            {/* Lyrics Mode toggle: Write full song vs Edit */}
            <div>
              <label className="text-[11.5px] font-semibold text-muted-foreground mb-[7px] block">
                {t('music.lyricsModeLabel') || 'Lyrics Mode'}
              </label>
              <div className="flex items-center bg-surface rounded-lg border border-border p-0.5">
                <button
                  onClick={() => setLyricsMode('write_full_song')}
                  className={`flex-1 px-3 py-1.5 rounded text-[11.5px] font-medium transition-colors ${lyricsMode === 'write_full_song' ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {t('music.lyricsModeWrite') || 'Write full song'}
                </button>
                <button
                  onClick={() => setLyricsMode('edit')}
                  className={`flex-1 px-3 py-1.5 rounded text-[11.5px] font-medium transition-colors ${lyricsMode === 'edit' ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {t('music.lyricsModeEdit') || 'Edit existing lyrics'}
                </button>
              </div>
            </div>

            {/* Theme / Brief prompt */}
            <div>
              <label className="text-[11.5px] font-semibold text-muted-foreground mb-[7px] flex items-center gap-1.5">
                <Sparkles size={12} /> {t('music.lyricsThemePrompt') || 'Theme / Brief'}
              </label>
              <textarea
                value={lyricsThemePrompt}
                onChange={(e) => setLyricsThemePrompt(e.target.value.slice(0, 2000))}
                placeholder={t('music.lyricsThemePlaceholder') || 'A soulful blues song about a rainy night'}
                className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-primary"
                rows={3}
              />
              <p className="text-[10px] text-muted-foreground mt-1 text-right">{lyricsThemePrompt.length} / 2000</p>
            </div>

            {/* Existing Lyrics (edit mode only) */}
            {lyricsMode === 'edit' && (
              <div>
                <label className="text-[11.5px] font-semibold text-muted-foreground mb-[7px] flex items-center gap-1.5">
                  <Music size={12} /> {t('music.lyricsExisting') || 'Existing Lyrics'}
                </label>
                <textarea
                  value={lyricsSourceLyrics}
                  onChange={(e) => setLyricsSourceLyrics(e.target.value.slice(0, 3500))}
                  placeholder={t('music.lyricsExistingPlaceholder') || 'Paste the lyrics you want to refine…'}
                  className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-primary font-mono"
                  rows={6}
                />
                <p className="text-[10px] text-muted-foreground mt-1 text-right">{lyricsSourceLyrics.length} / 3500</p>
              </div>
            )}

            {/* Song Title (optional) */}
            <div>
              <label className="text-[11.5px] font-semibold text-muted-foreground mb-[7px] flex items-center gap-1.5">
                <NotebookPen size={12} /> {t('music.lyricsTitle') || 'Song Title (optional)'}
              </label>
              <input
                type="text"
                value={lyricsTitle}
                onChange={(e) => setLyricsTitle(e.target.value)}
                placeholder={t('music.lyricsTitlePlaceholder') || 'auto-generated if blank'}
                className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
              />
            </div>

            {/* Result panel — title + style_tags chips + lyrics + Copy / Use in Compose */}
            {lyricsResult && (
              <div className="bg-surface border border-border rounded-lg p-3 space-y-2">
                {lyricsResult.song_title && (
                  <h4 className="text-[13px] font-semibold text-foreground">
                    {lyricsResult.song_title}
                  </h4>
                )}
                {lyricsResult.style_tags && (
                  <div className="flex flex-wrap gap-1">
                    {lyricsResult.style_tags.split(',').map((tag, i) => (
                      <span
                        key={`${tag}-${i}`}
                        className="px-2 py-0.5 bg-primary/10 border border-primary/20 rounded text-[10px] text-primary"
                      >
                        {tag.trim()}
                      </span>
                    ))}
                  </div>
                )}
                <pre className="text-[11.5px] text-foreground whitespace-pre-wrap font-mono leading-relaxed max-h-[260px] overflow-y-auto bg-card border border-border rounded p-2">
                  {lyricsResult.lyrics}
                </pre>
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={copyLyricsToClipboard}
                    className="px-3 py-1.5 bg-card border border-border rounded text-[11px] text-foreground hover:border-primary transition-colors flex items-center gap-1.5"
                  >
                    {lyricsCopied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
                    {lyricsCopied
                      ? (t('music.lyricsCopied') || 'Copied!')
                      : (t('music.lyricsCopy') || 'Copy')}
                  </button>
                  <button
                    onClick={useLyricsInCompose}
                    className="px-3 py-1.5 bg-primary hover:bg-primary-hover text-white rounded text-[11px] font-medium transition-colors flex items-center gap-1.5"
                  >
                    <Sparkles size={12} /> {t('music.lyricsUseInCompose') || 'Use in Compose'}
                  </button>
                </div>
              </div>
            )}
          </>
          )}
        </div>

        {/* Generate button — mt-auto pushes it to the bottom of the form
            column so it stays in reach when the form is scrolled. */}
        <div className="mt-auto px-[22px] pt-[16px] pb-[22px] shrink-0 border-t border-border/50">
          {mode === 'generate' ? (
            <button
              onClick={generate}
              disabled={loading || (!prompt.trim() && !lyrics.trim() && !useLyricsOptimizer)}
              className="w-full py-3 bg-primary hover:bg-primary-hover disabled:opacity-40 text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 size={18} className="animate-spin" /> : <Music size={18} />}
              {loading
                ? t('music.generating')
                : (isInstrumental ? t('music.generateInstrumental') : t('music.generateMusic'))}
            </button>
          ) : mode === 'cover' ? (
            <button
              onClick={generateCover}
              disabled={loading || preprocessLoading || !referenceUrl || coverPrompt.trim().length < 10}
              className="w-full py-3 bg-primary hover:bg-primary-hover disabled:opacity-40 text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 size={18} className="animate-spin" /> : <Disc3 size={18} />}
              {loading
                ? (t('music.coverGenerating') || 'Generating cover…')
                : (t('music.coverGenerate') || 'Generate Cover')}
            </button>
          ) : (
            <button
              onClick={generateLyrics}
              disabled={lyricsLoading || (lyricsMode === 'write_full_song' ? !lyricsThemePrompt.trim() : !lyricsSourceLyrics.trim())}
              className="w-full py-3 bg-primary hover:bg-primary-hover disabled:opacity-40 text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
            >
              {lyricsLoading ? <Loader2 size={18} className="animate-spin" /> : <NotebookPen size={18} />}
              {lyricsLoading
                ? (t('music.lyricsGenerating') || 'Generating lyrics…')
                : (t('music.lyricsGenerate') || 'Generate Lyrics')}
            </button>
          )}
        </div>
      </div>

      {/* ============ TRACKS COLUMN (right, flex-1) ============ */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Header bar — 52px, "Tracks" + "Saved to..." */}
        <div className="h-[52px] flex-none flex items-center justify-between px-6 border-b border-border bg-surface/30">
          <span className="text-[13px] font-semibold">Tracks</span>
          <span className="text-[11.5px] text-muted-foreground">Saved to workspace/generations/music/</span>
        </div>

        {/* Body — scrollable. Order: error → current result → history */}
        <div className="flex-1 overflow-y-auto p-[20px_24px] flex flex-col gap-3">
          {error && (
            <div className="bg-error/10 border border-error/20 rounded-xl p-4 text-sm text-error">{error}</div>
          )}

          {result && (
            <div className="bg-surface border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <p className="text-sm text-muted-foreground flex items-center gap-2">
                  <Check size={14} className="text-success" /> {t('music.success')}
                </p>
                {cost && (
                  <div
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/5 border border-primary/20 text-[10px] font-medium text-primary"
                    title={t('media.costTitle')}
                  >
                    <Coins size={11} />
                    <span>
                      {t('media.costLabel', {
                        credits: cost.cost_credits ?? 0,
                        usd: typeof cost.cost_usd === 'number' ? cost.cost_usd.toFixed(4) : '0.0000',
                      })}
                    </span>
                  </div>
                )}
              </div>
              <audio controls className="w-full" src={assetUrl(`/api/files/raw?path=${encodeURIComponent(result.file_path)}`)} />
              <div className="flex gap-2">
                <a
                  href={assetUrl(`/api/files/download?path=${encodeURIComponent(result.file_path)}`)}
                  download={result.filename || result.file_path.split('/').pop()}
                  className="px-4 py-2 bg-primary hover:bg-primary-hover text-white text-sm rounded-lg transition-colors flex items-center gap-2"
                >
                  <Save size={14} /> {t('music.download')}
                </a>
              </div>

              {result.extra_info && Object.keys(result.extra_info).length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2 pt-2 border-t border-border/50">
                  <div className="text-center">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{t('music.metadata.duration') || 'Duration'}</p>
                    <p className="text-sm font-mono text-foreground">{formatDuration(result.extra_info.music_duration)}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{t('music.metadata.sampleRate') || 'Sample rate'}</p>
                    <p className="text-sm font-mono text-foreground">
                      {result.extra_info.music_sample_rate ? `${(result.extra_info.music_sample_rate / 1000).toFixed(1)} kHz` : '—'}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{t('music.metadata.channels') || 'Channels'}</p>
                    <p className="text-sm font-mono text-foreground">
                      {result.extra_info.music_channel ? (result.extra_info.music_channel === 2 ? 'Stereo' : `${result.extra_info.music_channel} ch`) : '—'}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{t('music.metadata.bitrate') || 'Bitrate'}</p>
                    <p className="text-sm font-mono text-foreground">
                      {result.extra_info.bitrate ? `${Math.round(result.extra_info.bitrate / 1000)} kbps` : '—'}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{t('music.metadata.size') || 'Size'}</p>
                    <p className="text-sm font-mono text-foreground">{formatBytes(result.extra_info.music_size)}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          <RecentGenerations
            title={t('music.recentGenerations')}
            type="music"
            items={history}
            loading={historyLoading}
            onRefresh={fetchHistory}
            emptyMessage={t('music.noGenerated')}
          />
        </div>
      </div>
      </div>
    </div>
  )
}
