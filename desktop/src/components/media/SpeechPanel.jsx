import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Volume2, Save, Loader2, RefreshCw, Mic, Gauge, Check, Coins, Mic2, Wand2, Upload, X, Trash2, Sparkles, Headphones, AudioLines, FileAudio } from 'lucide-react'
import { useSessionProtection } from '../../hooks/useSessionProtection'
import RecentGenerations from './RecentGenerations'
import MediaPanelLayout from '../shared/MediaPanelLayout'
import MediaHeader from '../shared/MediaHeader'
import GalleryHeader from '../shared/GalleryHeader'
import { apiFetch } from '../../lib/api.js'

// TAURI_SPEC.md §6b — 4 sub-modes for the Speech panel.
// Model options cover the public T2A lineup per the MiniMax docs.
const SPEECH_MODELS = [
  { id: 'speech-2.8-hd',     label: 'Speech 2.8 HD' },
  { id: 'speech-2.8-turbo',  label: 'Speech 2.8 Turbo' },
  { id: 'speech-2.6-hd',     label: 'Speech 2.6 HD' },
  { id: 'speech-2.6-turbo',  label: 'Speech 2.6 Turbo' },
  { id: 'speech-02-hd',      label: 'Speech 02 HD' },
  { id: 'speech-02-turbo',   label: 'Speech 02 Turbo' },
  { id: 'speech-01-hd',      label: 'Speech 01 HD' },
  { id: 'speech-01-turbo',   label: 'Speech 01 Turbo' },
]

const EMOTIONS = [
  { id: '', value: 'auto' },
  { id: 'happy', value: 'happy' },
  { id: 'sad', value: 'sad' },
  { id: 'angry', value: 'angry' },
  { id: 'fearful', value: 'fearful' },
  { id: 'disgusted', value: 'disgusted' },
  { id: 'surprised', value: 'surprised' },
  { id: 'calm', value: 'calm' },
  { id: 'fluent', value: 'fluent' },
  { id: 'whisper', value: 'whisper' },
]

const SOUND_EFFECTS = [
  { id: '', value: 'none' },
  { id: 'spacious_echo', value: 'spacious_echo' },
  { id: 'auditorium_echo', value: 'auditorium_echo' },
  { id: 'lofi_telephone', value: 'lofi_telephone' },
  { id: 'robotic', value: 'robotic' },
]

const LANGUAGE_OPTIONS = [
  'auto', 'Chinese', 'Chinese,Yue', 'English', 'Arabic', 'Russian', 'Spanish',
  'French', 'Portuguese', 'German', 'Turkish', 'Dutch', 'Ukrainian', 'Vietnamese',
  'Indonesian', 'Japanese', 'Italian', 'Korean', 'Thai', 'Polish', 'Romanian',
  'Greek', 'Czech', 'Finnish', 'Hindi', 'Bulgarian', 'Danish', 'Hebrew', 'Malay',
  'Persian', 'Slovak', 'Swedish', 'Croatian', 'Filipino', 'Hungarian', 'Norwegian',
  'Slovenian', 'Catalan', 'Nynorsk', 'Tamil', 'Afrikaans',
]

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

export default function SpeechPanel() {
  const { t } = useTranslation()
  // Mode toggle (TAURI_SPEC §6b)
  const [mode, setMode] = useState('synthesize')  // 'synthesize' | 'clone' | 'design' | 'voices'
  // Synthesize state
  const [delivery, setDelivery] = useState('standard')  // 'standard' | 'async'
  const [text, setText] = useState('')
  const [model, setModel] = useState('speech-2.8-hd')
  const [voiceId, setVoiceId] = useState('English_Graceful_Lady')
  const [speed, setSpeed] = useState(1.0)
  const [vol, setVol] = useState(1.0)
  const [pitch, setPitch] = useState(0)
  const [emotion, setEmotion] = useState('')
  const [vmPitch, setVmPitch] = useState(0)         // voice_modify pitch (-100..100)
  const [vmIntensity, setVmIntensity] = useState(0) // voice_modify intensity
  const [vmTimbre, setVmTimbre] = useState(0)       // voice_modify timbre
  const [vmSoundFx, setVmSoundFx] = useState('')    // sound_effects enum or ''
  const [languageBoost, setLanguageBoost] = useState('auto')
  // Voice list (3 buckets)
  const [voices, setVoices] = useState({ system_voice: [], voice_cloning: [], voice_generation: [] })
  const [voicesLoading, setVoicesLoading] = useState(false)
  const [voiceFilter, setVoiceFilter] = useState('')
  // Clone state
  const [cloneSample, setCloneSample] = useState(null)
  const [cloneSampleFileId, setCloneSampleFileId] = useState(null)
  const [cloneUploading, setCloneUploading] = useState(false)
  const [cloneVoiceId, setCloneVoiceId] = useState('')
  const [clonePromptFileId, setClonePromptFileId] = useState(0)
  const [clonePromptText, setClonePromptText] = useState('')
  const [cloneNR, setCloneNR] = useState(false)
  const [cloneVN, setCloneVN] = useState(false)
  const [clonePreviewText, setClonePreviewText] = useState('')
  const [cloneRunning, setCloneRunning] = useState(false)
  const [cloneResult, setCloneResult] = useState(null)
  // Design state
  const [designPrompt, setDesignPrompt] = useState('')
  const [designPreviewText, setDesignPreviewText] = useState('')
  const [designVoiceId, setDesignVoiceId] = useState('')
  const [designRunning, setDesignRunning] = useState(false)
  const [designResult, setDesignResult] = useState(null)
  // Async long-text state
  const [asyncTaskId, setAsyncTaskId] = useState('')
  const [asyncFileId, setAsyncFileId] = useState(null)
  const [asyncStatus, setAsyncStatus] = useState('')
  const [polling, setPolling] = useState(false)
  // Common
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [cost, setCost] = useState(null)
  const [error, setError] = useState(null)
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const cloneSampleInputRef = useRef(null)

  const { register } = useSessionProtection()

  useEffect(() => {
    register('speech-loading', loading, 'Speech generation in progress')
  }, [loading, register])

  useEffect(() => {
    register('speech-text', text.trim().length > 0, 'Unsaved speech text')
  }, [text, register])

  // ---- History (all 4 sub-modes share) ----

  const fetchHistory = async () => {
    setHistoryLoading(true)
    try {
      const res = await apiFetch('/api/generations')
      const data = await res.json()
      let tts = []
      if (data.success) tts = data.data.tts || []

      const wsRes = await apiFetch('/api/files?path=workspace')
      const wsData = await wsRes.json()
      if (wsData.entries) {
        const wsTts = wsData.entries
          .filter(e => !e.is_dir && /\.(mp3|wav|flac|pcm)$/i.test(e.name))
          .filter(e => /^(tts_|tts_web|tts_output)/i.test(e.name))
          .map(e => ({ name: e.name, path: e.path, size: 0 }))
        const seen = new Set(tts.map(i => i.path))
        wsTts.forEach(t => {
          if (!seen.has(t.path)) tts.push(t)
        })
      }

      tts.sort((a, b) => {
        if (a.modified_at && b.modified_at) return b.modified_at.localeCompare(a.modified_at)
        return b.name.localeCompare(a.name)
      })

      setHistory(tts)
    } catch (e) { /* ignore */ }
    setHistoryLoading(false)
  }

  useEffect(() => {
    fetchHistory()
  }, [])

  // ---- Voices (3 buckets from /v1/get_voice) ----

  const fetchVoices = async () => {
    setVoicesLoading(true)
    try {
      const res = await apiFetch('/api/minimax/speech/voices?voice_type=all')
      const data = await res.json()
      if (data.success) {
        setVoices({
          system_voice: data.system_voice || [],
          voice_cloning: data.voice_cloning || [],
          voice_generation: data.voice_generation || [],
        })
      }
    } catch (e) {
      // Silently fail — Voices mode will show an empty state
    } finally {
      setVoicesLoading(false)
    }
  }

  useEffect(() => { fetchVoices() }, [])

  // Flatten + dedupe by voice_id, applying filter
  const flatVoices = (() => {
    const all = [
      ...(voices.system_voice || []).map(v => ({ ...v, source: 'system_voice' })),
      ...(voices.voice_cloning || []).map(v => ({ ...v, source: 'voice_cloning' })),
      ...(voices.voice_generation || []).map(v => ({ ...v, source: 'voice_generation' })),
    ]
    if (!voiceFilter) return all
    const q = voiceFilter.toLowerCase()
    return all.filter(v =>
      (v.voice_name || v.voice_id || '').toLowerCase().includes(q) ||
      (v.description || []).join(' ').toLowerCase().includes(q)
    )
  })()

  // ---- Synthesize ----

  const buildVoiceModify = () => {
    const vm = {
      pitch: vmPitch,
      intensity: vmIntensity,
      timbre: vmTimbre,
    }
    if (vmSoundFx) vm.sound_effects = vmSoundFx
    // If all are zero and no sound effect, omit
    if (!vm.sound_effects && vm.pitch === 0 && vm.intensity === 0 && vm.timbre === 0) {
      return null
    }
    return vm
  }

  const synthesizeNow = async () => {
    if (!text.trim()) {
      setError('Text is required.')
      return
    }
    if (text.length > 10000) {
      setError('Text exceeds 10000 characters.')
      return
    }
    setLoading(true)
    setError(null)
    setResult(null)
    setCost(null)
    setAsyncStatus('')
    setAsyncTaskId('')
    setAsyncFileId(null)
    try {
      const endpoint = delivery === 'async'
        ? '/api/minimax/speech/synthesize-async'
        : '/api/minimax/speech/synthesize'
      const body = {
        text,
        model,
        voice_id: voiceId,
        speed,
        vol,
        pitch,
        language_boost: languageBoost,
        voice_modify_pitch: vmPitch,
        voice_modify_intensity: vmIntensity,
        voice_modify_timbre: vmTimbre,
        voice_modify_sound_effects: vmSoundFx,
      }
      if (emotion) body.emotion = emotion
      const res = await apiFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        const msg = data.detail || data.error || 'TTS failed.'
        throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
      }
      if (delivery === 'async') {
        // Async: store task_id and start polling
        setAsyncTaskId(data.task_id || '')
        setAsyncStatus(data.status || 'processing')
        setAsyncFileId(data.file_id || null)
        setPolling(true)
      } else {
        // Sync: file ready immediately
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
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // Poll the async task every 3s while pending
  useEffect(() => {
    if (!polling || !asyncTaskId) return
    let cancelled = false
    const tick = async () => {
      try {
        const res = await apiFetch(`/api/minimax/speech/synthesize-async/${asyncTaskId}`)
        const data = await res.json()
        if (cancelled) return
        if (res.ok && data.success) {
          setAsyncStatus(data.status || 'processing')
          setAsyncFileId(data.file_id || null)
          if (data.status === 'success' && data.file_id) {
            // Async tasks don't auto-download the file — we have file_id only.
            // User can re-poll or use file_id via /api/files. For simplicity
            // we surface "ready" and offer re-synthesize.
            setPolling(false)
            fetchHistory()
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('minimax:media-complete'))
            }
          } else if (data.status === 'failed' || data.status === 'expired') {
            setPolling(false)
            setError(`Async task ${data.status}.`)
          }
        }
      } catch { /* swallow */ }
      if (!cancelled) setTimeout(tick, 3000)
    }
    const id = setTimeout(tick, 1500)
    return () => { cancelled = true; clearTimeout(id) }
  }, [polling, asyncTaskId])

  // ---- Clone ----

  const uploadCloneSample = async (file) => {
    if (!file) return
    setError(null)
    setCloneUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await apiFetch('/api/minimax/speech/clone/upload', {
        method: 'POST',
        body: fd,
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.detail || data.error || 'Sample upload failed.')
      }
      setCloneSample(file)
      setCloneSampleFileId(data.file_id)
      // Refresh voice library so the new clone appears once registered
      fetchVoices()
    } catch (e) {
      setError(e.message || 'Sample upload failed.')
    } finally {
      setCloneUploading(false)
    }
  }

  const onPickCloneSample = (e) => {
    const file = e.target.files?.[0]
    if (file) uploadCloneSample(file)
    if (e.target) e.target.value = ''
  }

  const onDropCloneSample = (e) => {
    e.preventDefault()
    const file = e.dataTransfer?.files?.[0]
    if (file) uploadCloneSample(file)
  }

  const submitClone = async () => {
    setError(null)
    setCloneResult(null)
    if (!cloneSampleFileId) {
      setError('Upload a sample first.')
      return
    }
    const v = cloneVoiceId.trim()
    if (v.length < 8 || v.length > 256) {
      setError('Voice ID must be 8–256 characters.')
      return
    }
    if (!/^[A-Za-z]/.test(v)) {
      setError('Voice ID must start with a letter.')
      return
    }
    setCloneRunning(true)
    try {
      const body = {
        file_id: cloneSampleFileId,
        voice_id: v,
        need_noise_reduction: cloneNR,
        need_volume_normalization: cloneVN,
      }
      if (clonePreviewText.trim()) {
        body.text = clonePreviewText
        body.model = model
        body.language_boost = languageBoost
      }
      if (clonePromptFileId && clonePromptText.trim()) {
        body.clone_prompt_file_id = clonePromptFileId
        body.clone_prompt_text = clonePromptText
      }
      const res = await apiFetch('/api/minimax/speech/clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        const msg = data.detail || data.error || 'Clone failed.'
        throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
      }
      setCloneResult({ voice_id: v, demo_audio: data.demo_audio || '' })
      fetchVoices()
    } catch (e) {
      setError(e.message || 'Voice cloning failed.')
    } finally {
      setCloneRunning(false)
    }
  }

  // ---- Design ----

  const submitDesign = async () => {
    setError(null)
    setDesignResult(null)
    if (!designPrompt.trim()) {
      setError('Voice description is required.')
      return
    }
    if (!designPreviewText.trim()) {
      setError('Preview text is required.')
      return
    }
    if (designPreviewText.length > 500) {
      setError('Preview text must be ≤500 chars.')
      return
    }
    setDesignRunning(true)
    try {
      const body = {
        prompt: designPrompt,
        preview_text: designPreviewText,
      }
      if (designVoiceId.trim()) body.voice_id = designVoiceId.trim()
      const res = await apiFetch('/api/minimax/speech/design', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        const msg = data.detail || data.error || 'Design failed.'
        throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
      }
      setDesignResult({
        voice_id: data.voice_id,
        trial_audio_path: data.trial_audio_path,
      })
      fetchVoices()
    } catch (e) {
      setError(e.message || 'Voice design failed.')
    } finally {
      setDesignRunning(false)
    }
  }

  // ---- Voices (delete) ----

  const deleteVoice = async (type, voiceId, voiceName) => {
    if (!window.confirm(`Delete voice "${voiceName || voiceId}"? This cannot be undone.`)) return
    setError(null)
    try {
      const res = await apiFetch(
        `/api/minimax/speech/voices/${type}/${encodeURIComponent(voiceId)}`,
        { method: 'DELETE' }
      )
      const data = await res.json()
      if (!res.ok || !data.success) {
        const msg = data.detail || data.error || 'Delete failed.'
        throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
      }
      fetchVoices()
    } catch (e) {
      setError(e.message || 'Delete failed.')
    }
  }

  // ---- Mode toggle UI ----

  const modeButton = (id, label, Icon) => {
    const active = mode === id
    return (
      <button
        key={id}
        onClick={() => { setMode(id); setError(null) }}
        className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-colors ${
          active
            ? 'bg-primary text-white shadow-sm'
            : 'bg-surface text-muted-foreground hover:text-foreground border border-border'
        }`}
      >
        <Icon size={12} aria-hidden="true" />
        {label}
      </button>
    )
  }

  const chip = (active) =>
    `px-2.5 py-1.5 rounded-lg text-xs border transition-colors ${
      active
        ? 'bg-primary/10 border-primary text-primary'
        : 'bg-surface border-border text-foreground hover:border-primary'
    }`

  // ---- Synthesize sub-mode controls ----

  const synthesizeControls = (
    <>
      {/* Delivery: Standard / Async */}
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Delivery</label>
        <div className="flex gap-1.5">
          <button onClick={() => setDelivery('standard')} className={chip(delivery === 'standard')}>Standard</button>
          <button onClick={() => setDelivery('async')} className={chip(delivery === 'async')}>Async (long)</button>
        </div>
      </div>

      {/* Text */}
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Text to synthesize</label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Enter text… (up to 10,000 characters)"
          rows={5}
          className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-primary transition-colors"
        />
        <div className="flex items-center justify-between mt-1">
          <span className="text-[11px] text-muted-foreground">{text.length.toLocaleString()} / 10,000</span>
          {text.length > 10000 && <span className="text-[11px] text-error">Exceeds limit</span>}
        </div>
        <p className="text-[10px] text-muted-foreground/70 mt-1">Tip: insert <code className="px-1 py-0.5 bg-surface rounded text-[10px]">{'<#0.5#>'}</code> for a 0.5s pause. (laughs), (sighs) work on 2.8.</p>
      </div>

      {/* Model */}
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Model</label>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="w-full bg-surface border border-border rounded-lg px-2.5 py-2 text-xs text-foreground focus:outline-none focus:border-primary"
        >
          {SPEECH_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </div>

      {/* Voice */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
            <Mic size={12} aria-hidden="true" /> Voice
          </label>
          <div className="flex items-center gap-1.5">
            <select
              value={voiceFilter}
              onChange={(e) => setVoiceFilter(e.target.value)}
              className="text-[11px] bg-surface border border-border rounded-md px-1.5 py-0.5"
            >
              <option value="">All</option>
              {Array.from(new Set(flatVoices.map(v => v.source).filter(Boolean))).sort().map(src => (
                <option key={src} value={src}>{src.replace('_', ' ')}</option>
              ))}
            </select>
            <button
              onClick={fetchVoices}
              disabled={voicesLoading}
              title="Refresh voices"
              aria-label="Refresh voices"
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-surface transition-colors"
            >
              <RefreshCw size={12} className={voicesLoading ? 'animate-spin' : ''} aria-hidden="true" />
            </button>
          </div>
        </div>
        <select
          value={voiceId}
          onChange={(e) => setVoiceId(e.target.value)}
          className="w-full bg-surface border border-border rounded-lg px-2.5 py-2 text-xs text-foreground focus:outline-none focus:border-primary"
        >
          {flatVoices
            .filter(v => !voiceFilter || v.source === voiceFilter)
            .map(v => (
              <option key={`${v.source}-${v.voice_id}`} value={v.voice_id}>
                {v.voice_name || v.voice_id}{v.source && v.source !== 'system_voice' ? ` · ${v.source.replace('_', ' ')}` : ''}
              </option>
            ))}
        </select>
      </div>

      {/* Voice settings */}
      <div className="space-y-2">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 flex items-center justify-between">
            <span className="flex items-center gap-1"><Gauge size={12} aria-hidden="true" /> Speed</span>
            <span className="text-foreground">{speed.toFixed(1)}x</span>
          </label>
          <input type="range" min="0.5" max="2.0" step="0.1" value={speed} onChange={(e) => setSpeed(parseFloat(e.target.value))} className="w-full accent-primary" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 flex items-center justify-between">
            <span>Volume</span>
            <span className="text-foreground">{vol.toFixed(1)}x</span>
          </label>
          <input type="range" min="0.1" max="2.0" step="0.1" value={vol} onChange={(e) => setVol(parseFloat(e.target.value))} className="w-full accent-primary" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 flex items-center justify-between">
            <span>Pitch</span>
            <span className="text-foreground">{pitch}</span>
          </label>
          <input type="range" min="-12" max="12" step="1" value={pitch} onChange={(e) => setPitch(parseInt(e.target.value))} className="w-full accent-primary" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Emotion</label>
          <select value={emotion} onChange={(e) => setEmotion(e.target.value)} className="w-full bg-surface border border-border rounded-lg px-2.5 py-1.5 text-xs">
            {EMOTIONS.map(e => <option key={e.id || 'auto'} value={e.id}>{e.value}</option>)}
          </select>
        </div>
      </div>

      {/* Voice effects */}
      <details className="bg-surface/50 border border-border rounded-lg">
        <summary className="px-3 py-2 text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground flex items-center justify-between">
          <span className="flex items-center gap-1.5"><Sparkles size={12} /> Voice effects (optional)</span>
          <span className="text-[10px] text-muted-foreground/70">pitch · intensity · timbre · fx</span>
        </summary>
        <div className="px-3 pb-3 pt-1 space-y-2">
          <div>
            <label className="text-[11px] text-muted-foreground mb-1 flex justify-between">
              <span>Voice pitch</span><span>{vmPitch}</span>
            </label>
            <input type="range" min="-100" max="100" step="1" value={vmPitch} onChange={(e) => setVmPitch(parseInt(e.target.value))} className="w-full accent-primary" />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground mb-1 flex justify-between">
              <span>Intensity</span><span>{vmIntensity}</span>
            </label>
            <input type="range" min="-100" max="100" step="1" value={vmIntensity} onChange={(e) => setVmIntensity(parseInt(e.target.value))} className="w-full accent-primary" />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground mb-1 flex justify-between">
              <span>Timbre</span><span>{vmTimbre}</span>
            </label>
            <input type="range" min="-100" max="100" step="1" value={vmTimbre} onChange={(e) => setVmTimbre(parseInt(e.target.value))} className="w-full accent-primary" />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground mb-1 block">Sound effect</label>
            <select value={vmSoundFx} onChange={(e) => setVmSoundFx(e.target.value)} className="w-full bg-surface border border-border rounded-md px-2 py-1 text-[11px]">
              {SOUND_EFFECTS.map(s => <option key={s.id || 'none'} value={s.id}>{s.value}</option>)}
            </select>
          </div>
        </div>
      </details>

      {/* Language boost */}
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Language boost</label>
        <select value={languageBoost} onChange={(e) => setLanguageBoost(e.target.value)} className="w-full bg-surface border border-border rounded-lg px-2.5 py-1.5 text-xs">
          {LANGUAGE_OPTIONS.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
      </div>

      {delivery === 'async' && asyncStatus && (
        <div className="bg-surface border border-border rounded-lg px-3 py-2 text-[11px] text-muted-foreground">
          Async task <code className="text-foreground">{asyncTaskId || '—'}</code> · status <span className="text-foreground font-medium">{asyncStatus}</span>
          {asyncFileId && <span> · file_id <code>{asyncFileId}</code></span>}
        </div>
      )}
    </>
  )

  // ---- Clone sub-mode controls ----

  const cloneControls = (
    <>
      {/* Sample upload */}
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1.5 block flex items-center gap-1.5">
          <Upload size={12} aria-hidden="true" /> Sample audio (10s – 5min)
        </label>
        <div
          onDrop={onDropCloneSample}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => cloneSampleInputRef.current?.click()}
          className="bg-surface border-2 border-dashed border-border hover:border-primary rounded-lg p-4 text-center cursor-pointer transition-colors"
        >
          {cloneUploading ? (
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 size={14} className="animate-spin" /> Uploading…
            </div>
          ) : cloneSample ? (
            <div className="flex items-center justify-center gap-2 text-xs text-foreground">
              <FileAudio size={14} className="text-primary" />
              <span className="truncate flex-1 text-left">{cloneSample.name}</span>
              <button onClick={(e) => { e.stopPropagation(); setCloneSample(null); setCloneSampleFileId(null) }} className="text-muted-foreground hover:text-error"><X size={12} /></button>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">
              <Upload size={20} className="mx-auto mb-1 text-muted-foreground/60" />
              Drop audio file or click to browse
            </div>
          )}
          <input ref={cloneSampleInputRef} type="file" accept="audio/*" onChange={onPickCloneSample} className="hidden" />
        </div>
      </div>

      {/* Voice ID */}
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Voice ID (8–256 chars, must start with letter)</label>
        <input
          type="text"
          value={cloneVoiceId}
          onChange={(e) => setCloneVoiceId(e.target.value)}
          placeholder="e.g. my-narrator-01"
          className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
        />
      </div>

      {/* Enhancements */}
      <div className="space-y-1.5">
        <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
          <input type="checkbox" checked={cloneNR} onChange={(e) => setCloneNR(e.target.checked)} className="accent-primary" />
          Noise reduction
        </label>
        <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
          <input type="checkbox" checked={cloneVN} onChange={(e) => setCloneVN(e.target.checked)} className="accent-primary" />
          Volume normalization
        </label>
      </div>

      {/* Preview (optional) */}
      <details className="bg-surface/50 border border-border rounded-lg">
        <summary className="px-3 py-2 text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground flex items-center gap-1.5">
          <Headphones size={12} /> Preview generation (optional)
        </summary>
        <div className="px-3 pb-3 pt-1 space-y-2">
          <textarea
            value={clonePreviewText}
            onChange={(e) => setClonePreviewText(e.target.value)}
            placeholder="Preview text — generates demo audio after clone"
            rows={2}
            className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-primary"
          />
        </div>
      </details>

      <p className="text-[10px] text-muted-foreground/70 flex items-start gap-1.5">
        <span className="text-warning">⚠</span>
        Cloned voices are auto-deleted if not used for 7 days. Save the voice_id to keep them.
      </p>
    </>
  )

  // ---- Design sub-mode controls ----

  const designControls = (
    <>
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1.5 block flex items-center gap-1.5">
          <Wand2 size={12} aria-hidden="true" /> Voice description
        </label>
        <textarea
          value={designPrompt}
          onChange={(e) => setDesignPrompt(e.target.value)}
          placeholder="e.g. Warm male narrator with British accent, calm and confident"
          rows={4}
          className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-primary"
        />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Preview text (≤500 chars)</label>
        <textarea
          value={designPreviewText}
          onChange={(e) => setDesignPreviewText(e.target.value)}
          placeholder="Text the trial voice will speak"
          rows={2}
          className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-primary"
        />
        <span className="text-[10px] text-muted-foreground">{designPreviewText.length} / 500</span>
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Voice ID (optional, auto-generated if blank)</label>
        <input
          type="text"
          value={designVoiceId}
          onChange={(e) => setDesignVoiceId(e.target.value)}
          placeholder="Leave blank to auto-generate"
          className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
        />
      </div>
    </>
  )

  // ---- Voices sub-mode controls ----

  const voiceGroupSection = (title, Icon, type, items) => (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon size={12} className="text-primary" aria-hidden="true" />
        <span className="text-xs font-medium text-muted-foreground">{title}</span>
        <span className="text-[10px] text-muted-foreground/70">({items.length})</span>
      </div>
      <div className="bg-surface border border-border rounded-lg divide-y divide-border max-h-40 overflow-y-auto">
        {items.length === 0 ? (
          <div className="px-3 py-3 text-[11px] text-muted-foreground/70 text-center">No voices in this group</div>
        ) : items.map(v => (
          <div key={v.voice_id} className="flex items-center gap-2 px-2.5 py-2 text-xs">
            <div className="flex-1 min-w-0">
              <div className="truncate font-medium text-foreground">{v.voice_name || v.voice_id}</div>
              <div className="text-[10px] text-muted-foreground truncate">
                {v.voice_id}{(v.description || []).length > 0 ? ` · ${v.description.slice(0, 2).join(' / ')}` : ''}
              </div>
            </div>
            {type !== 'system_voice' && (
              <button
                onClick={() => deleteVoice(type, v.voice_id, v.voice_name)}
                title="Delete voice"
                className="p-1 rounded-md text-muted-foreground hover:text-error hover:bg-error/10 transition-colors"
              >
                <Trash2 size={12} aria-hidden="true" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )

  const voicesControls = (
    <>
      {voicesLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 size={12} className="animate-spin" /> Loading voices…</div>
      ) : (
        <>
          {voiceGroupSection('System voices', Volume2, 'system_voice', voices.system_voice || [])}
          {voiceGroupSection('Cloned voices', Mic2, 'voice_cloning', voices.voice_cloning || [])}
          {voiceGroupSection('Designed voices', AudioLines, 'voice_generation', voices.voice_generation || [])}
          <p className="text-[10px] text-muted-foreground/70">System voices are built-in and cannot be deleted. Cloned/Designed voices can be removed here.</p>
        </>
      )}
    </>
  )

  const controls = (
    <>
      {/* Mode toggle */}
      <div className="flex gap-1">
        {modeButton('synthesize', 'Synthesize', Volume2)}
        {modeButton('clone', 'Clone', Mic2)}
        {modeButton('design', 'Design', Wand2)}
        {modeButton('voices', 'Voices', AudioLines)}
      </div>

      {/* Mode-specific controls */}
      {mode === 'synthesize' && synthesizeControls}
      {mode === 'clone' && cloneControls}
      {mode === 'design' && designControls}
      {mode === 'voices' && voicesControls}

      {error && (
        <div className="bg-error/10 border border-error/20 rounded-lg p-2.5 text-xs text-error">{error}</div>
      )}

      {/* Mode-specific submit */}
      {mode === 'synthesize' && (
        <button
          onClick={synthesizeNow}
          disabled={loading || !text.trim() || text.length > 10000}
          className="mt-auto w-full py-2.5 bg-primary hover:bg-primary-hover disabled:opacity-40 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Volume2 size={16} />}
          {loading ? 'Synthesizing…' : delivery === 'async' ? 'Submit Long Text' : 'Synthesize Speech'}
        </button>
      )}
      {mode === 'clone' && (
        <button
          onClick={submitClone}
          disabled={cloneRunning || !cloneSampleFileId || !cloneVoiceId.trim()}
          className="mt-auto w-full py-2.5 bg-primary hover:bg-primary-hover disabled:opacity-40 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
        >
          {cloneRunning ? <Loader2 size={16} className="animate-spin" /> : <Mic2 size={16} />}
          {cloneRunning ? 'Cloning…' : 'Clone Voice'}
        </button>
      )}
      {mode === 'design' && (
        <button
          onClick={submitDesign}
          disabled={designRunning || !designPrompt.trim() || !designPreviewText.trim() || designPreviewText.length > 500}
          className="mt-auto w-full py-2.5 bg-primary hover:bg-primary-hover disabled:opacity-40 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
        >
          {designRunning ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
          {designRunning ? 'Designing…' : 'Design Voice'}
        </button>
      )}
    </>
  )

  // ---- Canvas (mode-specific result area) ----

  const synthesizeCanvas = (
    <div className="flex flex-col gap-3 h-full">
      {result ? (
        <div className="bg-surface border border-border rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Check size={14} className="text-success" /> Audio generated
            </p>
            {cost && (
              <div
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/5 border border-primary/20 text-[10px] font-medium text-primary"
                title="Cost for this generation"
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
          {result.file_path ? (
            <>
              <audio controls className="w-full" src={`/api/files/content?path=${encodeURIComponent(result.file_path)}`} />
              <a
                href={`/api/files/content?path=${encodeURIComponent(result.file_path)}`}
                download
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-hover text-white text-sm rounded-lg transition-colors w-fit"
              >
                <Save size={14} /> Download
              </a>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">{result}</p>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-3 py-14 text-center">
          <div className="w-16 h-16 rounded-full bg-surface border border-border flex items-center justify-center">
            <Volume2 size={26} className="text-muted-foreground" aria-hidden="true" />
          </div>
          <div>
            <div className="text-sm text-foreground font-medium">{SPEECH_MODELS.find(m => m.id === model)?.label || model}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">Your generated audio will appear here</div>
          </div>
        </div>
      )}

      <div className="border-t border-border" />

      <RecentGenerations
        title="Recent generations"
        type="tts"
        items={history}
        loading={historyLoading}
        onRefresh={fetchHistory}
        emptyMessage="No generated speech yet"
      />
    </div>
  )

  const cloneCanvas = (
    <div className="flex flex-col gap-3 h-full">
      {cloneResult ? (
        <div className="bg-surface border border-border rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Check size={14} className="text-success" /> Voice cloned
            </p>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">voice_id</div>
            <code className="block px-3 py-2 bg-surface rounded text-sm text-foreground">{cloneResult.voice_id}</code>
          </div>
          {cloneResult.demo_audio && (
            <audio controls className="w-full" src={cloneResult.demo_audio} />
          )}
          <p className="text-[11px] text-muted-foreground">Voice is now in your library (Voices tab). Reminder: auto-deleted if unused for 7 days.</p>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-3 py-14 text-center">
          <div className="w-16 h-16 rounded-full bg-surface border border-border flex items-center justify-center">
            <Mic2 size={26} className="text-muted-foreground" aria-hidden="true" />
          </div>
          <div>
            <div className="text-sm text-foreground font-medium">Clone a voice</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">Upload a 10s–5min sample to clone</div>
          </div>
        </div>
      )}
    </div>
  )

  const designCanvas = (
    <div className="flex flex-col gap-3 h-full">
      {designResult ? (
        <div className="bg-surface border border-border rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Check size={14} className="text-success" /> Voice designed
            </p>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">voice_id</div>
            <code className="block px-3 py-2 bg-surface rounded text-sm text-foreground">{designResult.voice_id}</code>
          </div>
          {designResult.trial_audio_path && (
            <audio controls className="w-full" src={`/api/files/content?path=${encodeURIComponent(designResult.trial_audio_path)}`} />
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-3 py-14 text-center">
          <div className="w-16 h-16 rounded-full bg-surface border border-border flex items-center justify-center">
            <Wand2 size={26} className="text-muted-foreground" aria-hidden="true" />
          </div>
          <div>
            <div className="text-sm text-foreground font-medium">Design a voice</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">Describe the voice you want</div>
          </div>
        </div>
      )}
    </div>
  )

  const voicesCanvas = (
    <div className="flex flex-col gap-3 h-full">
      <p className="text-sm text-muted-foreground">Browse all available voices — system, cloned, and designed. Cloned and designed voices can be deleted from here.</p>
      <button
        onClick={fetchVoices}
        disabled={voicesLoading}
        className="self-start inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
      >
        <RefreshCw size={12} className={voicesLoading ? 'animate-spin' : ''} /> Refresh
      </button>
    </div>
  )

  const canvas = mode === 'synthesize' ? synthesizeCanvas
    : mode === 'clone' ? cloneCanvas
    : mode === 'design' ? designCanvas
    : voicesCanvas

  const controlsHeader = (
    <MediaHeader
      icon={<Volume2 size={18} strokeWidth={2} />}
      title="Speech"
      subtitle="Synthesize · Clone · Design · Voices"
    />
  )

  const galleryHeader = (
    <GalleryHeader
      title="History"
      subtitle="Saved to workspace/generations/tts/"
    />
  )

  return (
    <MediaPanelLayout
      controlsWidth={400}
      controlsHeader={controlsHeader}
      controls={controls}
      galleryHeader={galleryHeader}
      canvas={canvas}
    />
  )
}
