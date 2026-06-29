import { useState, useEffect, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Volume2, Save, Loader2, RefreshCw, Mic, Check, Coins, Mic2, Wand2, Upload, X, Trash2,
  Sparkles, AudioLines, FileAudio, Search, Play, ChevronDown, ChevronRight, AlertCircle, Globe, Plus,
} from 'lucide-react'
import { useSessionProtection } from '../../hooks/useSessionProtection'
import RecentGenerations from './RecentGenerations'
import MediaPanelLayout from '../shared/MediaPanelLayout'
import ModeTabBar from '../shared/ModeTabBar'
import { apiFetch, assetUrl } from '../../lib/api.js'

// ───────────────────────────────────────────────────────────────────────────
// Constants — TAURI_SPEC §6b
// ───────────────────────────────────────────────────────────────────────────

const SPEECH_MODES = [
  { id: 'synthesize', label: 'Synthesize', icon: Volume2 },
  { id: 'clone',      label: 'Clone',      icon: Mic2 },
  { id: 'design',     label: 'Design',     icon: Wand2 },
  { id: 'voices',     label: 'Voices',     icon: AudioLines },
]

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
  { id: '',         label: 'Auto' },
  { id: 'happy',    label: 'happy' },
  { id: 'sad',      label: 'sad' },
  { id: 'angry',    label: 'angry' },
  { id: 'fearful',  label: 'fearful' },
  { id: 'disgusted',label: 'disgusted' },
  { id: 'surprised',label: 'surprised' },
  { id: 'calm',     label: 'calm' },
  { id: 'fluent',   label: 'fluent' },
  { id: 'whisper',  label: 'whisper' },
]

const SOUND_EFFECT_CHIPS = [
  { id: 'spacious_echo',   label: 'Spacious echo' },
  { id: 'auditorium_echo', label: 'Auditorium' },
  { id: 'lofi_telephone',  label: 'Lo-fi phone' },
  { id: 'robotic',         label: 'Robotic' },
]

const DESIGN_TRAITS = [
  { id: 'warm',      label: '+ Warm' },
  { id: 'energetic', label: '+ Energetic' },
  { id: 'deep',      label: '+ Deep' },
  { id: 'youthful',  label: '+ Youthful' },
  { id: 'raspy',     label: '+ Raspy' },
]

const DELIVERY_OPTIONS = [
  { id: 'standard', label: 'Standard' },
  { id: 'async',    label: 'Async · long text' },
]

const LANGUAGE_BOOST_OPTIONS = [
  { id: 'auto', label: 'auto' },
  { id: 'en',   label: 'English' },
  { id: 'zh',   label: 'Chinese' },
  { id: 'ja',   label: 'Japanese' },
  { id: 'ko',   label: 'Korean' },
  { id: 'es',   label: 'Spanish' },
  { id: 'pt',   label: 'Portuguese' },
  { id: 'fr',   label: 'French' },
  { id: 'de',   label: 'German' },
  { id: 'ru',   label: 'Russian' },
  { id: 'ar',   label: 'Arabic' },
  { id: 'hi',   label: 'Hindi' },
  { id: 'it',   label: 'Italian' },
  { id: 'tr',   label: 'Turkish' },
  { id: 'id',   label: 'Indonesian' },
  { id: 'vi',   label: 'Vietnamese' },
  { id: 'th',   label: 'Thai' },
  { id: 'nl',   label: 'Dutch' },
  { id: 'uk',   label: 'Ukrainian' },
  { id: 'el',   label: 'Greek' },
  { id: 'ms',   label: 'Malay' },
  { id: 'pl',   label: 'Polish' },
]

// ───────────────────────────────────────────────────────────────────────────
// Language detection — Intl.DisplayNames + Character & FX bucket
// Per TAURI_SPEC §6b "Language grouping — derive, don't hardcode"
// ───────────────────────────────────────────────────────────────────────────

const _dn = typeof Intl !== 'undefined' && Intl.DisplayNames
  ? new Intl.DisplayNames(['en'], { type: 'language' })
  : null

const KNOWN_LANG_CODES = ['en','zh','es','pt','fr','de','ja','ko','it','ru','ar','hi','id','vi','th','tr','nl','uk','el','ms','pl']

const KNOWN_LANGS = new Set(
  _dn
    ? KNOWN_LANG_CODES.map(c => _dn.of(c)?.toLowerCase()).filter(Boolean)
    : []
)

function voiceLanguage(voice) {
  if (voice.source === 'voice_cloning')   return 'Cloned'
  if (voice.source === 'voice_generation') return 'Designed'
  const prefix = String(voice.voice_id || '').split('_')[0]
  const base   = prefix.replace(/\s*\(.*\)\s*/, '').toLowerCase()
  if (!KNOWN_LANGS.has(base)) return 'Character & FX'
  const region = (prefix.match(/\(([^)]+)\)/) || [])[1]
  return base[0].toUpperCase() + base.slice(1) + (region ? ` (${region})` : '')
}

function voiceTags(v) {
  const lang = voiceLanguage(v)
  const desc = (v.description || [])[0] || ''
  const tags = []
  if (!['Character & FX', 'Cloned', 'Designed'].includes(lang)) {
    tags.push(lang.split(' (')[0])
  }
  if (/\bfemale\b|\bwoman\b|\blady\b|\bgirl\b/i.test(desc))         tags.push('Female')
  else if (/\bmale\b|\bman\b|\bguy\b|\bboy\b/i.test(desc))           tags.push('Male')
  const toneMatch = desc.match(/\b(warm|calm|deep|bright|serious|cheerful|confident|gentle|youthful|narration|gravitas|persuasive|soft|sweet|elegant|happy|excited|sad|neutral|formal|hostile|passionate|thoughtful|kind|warm-hearted|confident|wise|graceful|lovely|gentle-voiced|deep-voiced|expressive|playful|reserved|cheerful|magnetic|inspiring|romantic|intense|spirited|adventurous|melodic|soothing|patient|energetic|stoic|gentleman|storyteller|anchor|presenter|host|narrator|santa|elf|queen|princess|knight|soldier|warrior|boss|teacher|mentor|scholar|hostess|husband|wife|girlfriend|boyfriend|neighbor)\b/i)
  if (toneMatch) tags.push(toneMatch[1].toLowerCase())
  return tags.join(' · ')
}

function voiceInitials(name) {
  if (!name) return '??'
  const parts = name.split(/[\s_-]+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

const AVATAR_COLORS = [
  'linear-gradient(135deg,#be185d,#ec4899)',
  'linear-gradient(135deg,#1d4ed8,#3b82f6)',
  'linear-gradient(135deg,#0f766e,#14b8a6)',
  'linear-gradient(135deg,#b45309,#f59e0b)',
  'linear-gradient(135deg,#7c3aed,#a855f7)',
  'linear-gradient(135deg,#059669,#10b981)',
  'linear-gradient(135deg,#dc2626,#f87171)',
  'linear-gradient(135deg,#0891b2,#06b6d4)',
]

function voiceAvatarBg(seed) {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash)
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

// ───────────────────────────────────────────────────────────────────────────
// Inline sub-components
// ───────────────────────────────────────────────────────────────────────────

function VoiceAvatar({ voice, size = 34 }) {
  const name = voice.voice_name || voice.voice_id || '??'
  return (
    <div
      style={{
        width: size, height: size, flexShrink: 0, borderRadius: 9,
        background: voiceAvatarBg(voice.voice_id || name),
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: size <= 28 ? 10 : 12, fontWeight: 700, color: '#fff',
      }}
    >
      {voiceInitials(name)}
    </div>
  )
}

function Toggle({ checked, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      style={{
        width: 36, height: 20, borderRadius: 999,
        background: checked ? 'hsl(var(--primary))' : 'hsl(var(--border))',
        border: 'none', padding: 2, cursor: 'pointer',
        display: 'flex', alignItems: 'center', transition: 'background 0.15s',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: 16, height: 16, borderRadius: '50%', background: '#fff',
          transform: checked ? 'translateX(16px)' : 'translateX(0)',
          transition: 'transform 0.15s',
        }}
      />
    </button>
  )
}

// Language filter — globe icon + label + chevron, opens a small popup with
// each language's name + count. Mockup lines 924-940.
function LanguageFilter({ value, options, open, onOpenChange, onChange }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onOpenChange(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, onOpenChange])

  const current = options.find(o => o.id === value) || options[0]

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => onOpenChange(!open)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          height: 24, padding: '0 8px', borderRadius: 7,
          border: '0.5px solid var(--app-border)',
          background: 'var(--app-surface)',
          color: 'var(--app-text-2)',
          fontSize: 11, fontWeight: 500, cursor: 'pointer',
        }}
      >
        <Globe size={12} />
        <span>{current?.label ?? 'All'}</span>
        <ChevronDown size={11} />
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 30, right: 0, zIndex: 55,
          width: 188, maxHeight: 230, overflowY: 'auto', padding: 5,
          borderRadius: 10, background: 'var(--app-bg, var(--app-surface))',
          border: '0.5px solid var(--app-border)',
          boxShadow: '0 14px 36px rgba(0,0,0,0.45)',
        }}>
          {options.map(o => {
            const active = value === o.id
            return (
              <button
                key={o.id}
                onClick={() => { onChange(o.id); onOpenChange(false) }}
                style={{
                  width: '100%',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '6px 9px', border: 'none', borderRadius: 6,
                  cursor: 'pointer',
                  background: active ? 'hsl(var(--primary) / 0.12)' : 'transparent',
                  color: 'var(--app-text)',
                  fontSize: 11, fontWeight: 500, textAlign: 'left',
                }}
              >
                <span>{o.label}</span>
                <span style={{ fontSize: 10.5, color: 'var(--app-text-2)', fontVariantNumeric: 'tabular-nums' }}>{o.count}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// Main component
// ───────────────────────────────────────────────────────────────────────────

export default function SpeechPanel() {
  const { t } = useTranslation()
  const [mode, setMode] = useState('synthesize')

  // Synthesize state
  const [delivery, setDelivery] = useState('standard')
  const [text, setText] = useState('')
  const [model, setModel] = useState('speech-2.8-hd')
  const [voiceId, setVoiceId] = useState('English_Graceful_Lady')
  const [voiceLangFilter, setVoiceLangFilter] = useState('all')
  const [voiceLangOpen, setVoiceLangOpen] = useState(false)
  const [speed, setSpeed] = useState(1.0)
  const [vol, setVol] = useState(1.0)
  const [pitch, setPitch] = useState(0)
  const [emotion, setEmotion] = useState('')
  const [vmPitch, setVmPitch] = useState(0)
  const [vmIntensity, setVmIntensity] = useState(0)
  const [vmTimbre, setVmTimbre] = useState(0)
  const [vmSoundFx, setVmSoundFx] = useState('')
  const [languageBoost, setLanguageBoost] = useState('auto')

  // Voices list
  const [voices, setVoices] = useState({ system_voice: [], voice_cloning: [], voice_generation: [] })
  const [voicesLoading, setVoicesLoading] = useState(false)
  const [voiceDropdownOpen, setVoiceDropdownOpen] = useState(false)
  const [voiceSearch, setVoiceSearch] = useState('')

  // Clone state
  const [cloneSample, setCloneSample] = useState(null)
  const [cloneSampleFileId, setCloneSampleFileId] = useState(null)
  const [cloneUploading, setCloneUploading] = useState(false)
  const [cloneVoiceId, setCloneVoiceId] = useState('')
  const [cloneNR, setCloneNR] = useState(false)
  const [cloneVN, setCloneVN] = useState(false)
  const [clonePromptOpen, setClonePromptOpen] = useState(false)
  const [clonePromptClip, setClonePromptClip] = useState(null)
  const [clonePromptText, setClonePromptText] = useState('')
  const [cloneRunning, setCloneRunning] = useState(false)
  const [cloneResult, setCloneResult] = useState(null)

  // Design state
  const [designPrompt, setDesignPrompt] = useState('')
  const [designPreviewText, setDesignPreviewText] = useState('')
  const [designVoiceId, setDesignVoiceId] = useState('')
  const [designRunning, setDesignRunning] = useState(false)
  const [designResult, setDesignResult] = useState(null)

  // Common
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [cost, setCost] = useState(null)
  const [error, setError] = useState(null)
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const cloneSampleInputRef = useRef(null)
  const clonePromptInputRef = useRef(null)
  const voiceDropdownRef = useRef(null)
  const voiceLangRef = useRef(null)

  const { register } = useSessionProtection()

  useEffect(() => {
    register('speech-loading', loading, 'Speech generation in progress')
  }, [loading, register])

  useEffect(() => {
    register('speech-text', text.trim().length > 0, 'Unsaved speech text')
  }, [text, register])

  // ── Data fetching ──────────────────────────────────────────────────────

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
    } catch (e) { /* swallow */ }
    finally { setVoicesLoading(false) }
  }

  useEffect(() => { fetchVoices() }, [])

  const fetchHistory = async () => {
    setHistoryLoading(true)
    try {
      const res = await apiFetch('/api/generations')
      const data = await res.json()
      let tts = data.success ? (data.data.tts || []) : []
      const wsRes = await apiFetch('/api/files?path=workspace')
      const wsData = await wsRes.json()
      if (wsData.entries) {
        const wsTts = wsData.entries
          .filter(e => !e.is_dir && /\.(mp3|wav|flac|pcm)$/i.test(e.name))
          .filter(e => /^(tts_|tts_web|tts_output)/i.test(e.name))
          .map(e => ({ name: e.name, path: e.path, size: 0 }))
        const seen = new Set(tts.map(i => i.path))
        wsTts.forEach(t => { if (!seen.has(t.path)) tts.push(t) })
      }
      tts.sort((a, b) => {
        if (a.modified_at && b.modified_at) return b.modified_at.localeCompare(a.modified_at)
        return b.name.localeCompare(a.name)
      })
      setHistory(tts)
    } catch (e) { /* ignore */ }
    setHistoryLoading(false)
  }

  useEffect(() => { fetchHistory() }, [])

  // ── Derived voice data ─────────────────────────────────────────────────

  const flatVoices = useMemo(() => {
    return [
      ...voices.system_voice.map(v => ({ ...v, source: 'system_voice' })),
      ...voices.voice_cloning.map(v => ({ ...v, source: 'voice_cloning' })),
      ...voices.voice_generation.map(v => ({ ...v, source: 'voice_generation' })),
    ]
  }, [voices])

  const selectedVoice = flatVoices.find(v => v.voice_id === voiceId)

  // Voices grouped by language, sorted alphabetically (Cloned/Designed last)
  const voicesByLanguage = useMemo(() => {
    const groups = {}
    for (const v of flatVoices) {
      const lang = voiceLanguage(v)
      if (!groups[lang]) groups[lang] = []
      groups[lang].push(v)
    }
    const entries = Object.entries(groups)
    const priority = (lang) => {
      if (lang === 'Cloned')            return 1
      if (lang === 'Designed')          return 2
      if (lang === 'Character & FX')    return 3
      return 0
    }
    entries.sort((a, b) => {
      const pa = priority(a[0]), pb = priority(b[0])
      if (pa !== pb) return pa - pb
      return a[0].localeCompare(b[0])
    })
    return entries
  }, [flatVoices])

  // Language options for the filter dropdown
  const languageOptions = useMemo(() => {
    const total = voicesByLanguage.reduce((sum, [, list]) => sum + list.length, 0)
    return [
      { id: 'all', label: 'All', count: total },
      ...voicesByLanguage.map(([lang, list]) => ({ id: lang, label: lang, count: list.length })),
    ]
  }, [voicesByLanguage])

  // Voices for the dropdown, filtered by language selection
  const voicesByLanguageFiltered = useMemo(() => {
    if (voiceLangFilter === 'all') return voicesByLanguage
    return voicesByLanguage.filter(([lang]) => lang === voiceLangFilter)
  }, [voicesByLanguage, voiceLangFilter])

  // Search-filtered for Voices library
  const filteredVoices = useMemo(() => {
    if (!voiceSearch.trim()) return flatVoices
    const q = voiceSearch.toLowerCase()
    return flatVoices.filter(v =>
      (v.voice_name || v.voice_id || '').toLowerCase().includes(q) ||
      voiceLanguage(v).toLowerCase().includes(q) ||
      voiceTags(v).toLowerCase().includes(q)
    )
  }, [flatVoices, voiceSearch])

  const systemVoicesFiltered = filteredVoices.filter(v => v.source === 'system_voice')
  const clonedVoicesFiltered  = filteredVoices.filter(v => v.source === 'voice_cloning')
  const designedVoicesFiltered= filteredVoices.filter(v => v.source === 'voice_generation')

  // Sync voiceId when language filter changes — if the currently selected
  // voice's language no longer matches the filter, auto-jump to the first
  // voice in the filtered group so the trigger reflects the active filter.
  // "All" leaves the selection untouched.
  useEffect(() => {
    if (voiceLangFilter === 'all') return
    if (voicesByLanguage.length === 0) return
    const current = flatVoices.find(v => v.voice_id === voiceId)
    if (current && voiceLanguage(current) === voiceLangFilter) return
    const firstVoice = voicesByLanguage.find(([lang]) => lang === voiceLangFilter)?.[1]?.[0]
    if (firstVoice) setVoiceId(firstVoice.voice_id)
  }, [voiceLangFilter, voicesByLanguage, flatVoices, voiceId])

  // Close popups on outside click
  useEffect(() => {
    if (!voiceDropdownOpen) return
    const handler = (e) => {
      if (voiceDropdownRef.current && !voiceDropdownRef.current.contains(e.target)) {
        setVoiceDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [voiceDropdownOpen])

  // ── Handlers ───────────────────────────────────────────────────────────

  const buildVoiceModify = () => {
    const vm = { pitch: vmPitch, intensity: vmIntensity, timbre: vmTimbre }
    if (vmSoundFx) vm.sound_effects = vmSoundFx
    if (!vm.sound_effects && vm.pitch === 0 && vm.intensity === 0 && vm.timbre === 0) return null
    return vm
  }

  const synthesizeNow = async () => {
    if (!text.trim()) { setError('Text is required.'); return }
    if (text.length > 10000) { setError('Text exceeds 10000 characters.'); return }
    setLoading(true); setError(null); setResult(null); setCost(null)
    try {
      const body = {
        text,
        model,
        voice_id: voiceId,
        speed, vol, pitch,
        language_boost: languageBoost,
        voice_modify_pitch: vmPitch,
        voice_modify_intensity: vmIntensity,
        voice_modify_timbre: vmTimbre,
        voice_modify_sound_effects: vmSoundFx,
      }
      if (emotion) body.emotion = emotion
      const endpoint = delivery === 'async'
        ? '/api/minimax/speech/synthesize-async'
        : '/api/minimax/speech/synthesize'
      const res = await apiFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(typeof (data.detail || data.error) === 'string'
          ? (data.detail || data.error) : JSON.stringify(data.detail || data.error))
      }
      setResult(data)
      if (typeof data.cost_credits === 'number' || typeof data.cost_usd === 'number') {
        setCost({ cost_credits: data.cost_credits, cost_usd: data.cost_usd })
      }
      fetchHistory()
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('minimax:media-complete'))
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  const uploadCloneSample = async (file) => {
    if (!file) return
    setError(null); setCloneUploading(true)
    try {
      const fd = new FormData(); fd.append('file', file)
      const res = await apiFetch('/api/minimax/speech/clone/upload', {
        method: 'POST', body: fd,
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.detail || data.error || 'Sample upload failed.')
      setCloneSample(file)
      setCloneSampleFileId(data.file_id)
      fetchVoices()
    } catch (e) { setError(e.message || 'Sample upload failed.') }
    finally { setCloneUploading(false) }
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

  const onPickClonePrompt = (e) => {
    const file = e.target.files?.[0]
    if (file) setClonePromptClip(file)
    if (e.target) e.target.value = ''
  }

  const submitClone = async () => {
    setError(null); setCloneResult(null)
    if (!cloneSampleFileId) { setError('Upload a sample first.'); return }
    const v = cloneVoiceId.trim()
    if (v.length < 8 || v.length > 256) { setError('Voice ID must be 8–256 characters.'); return }
    if (!/^[A-Za-z]/.test(v)) { setError('Voice ID must start with a letter.'); return }
    setCloneRunning(true)
    try {
      const body = {
        file_id: cloneSampleFileId,
        voice_id: v,
        need_noise_reduction: cloneNR,
        need_volume_normalization: cloneVN,
      }
      if (clonePromptText.trim()) body.prompt_text = clonePromptText.trim()
      // Note: prompt_audio upload not wired — only prompt_text is sent.
      // Full prompt_audio support requires backend endpoint to accept it.
      const res = await apiFetch('/api/minimax/speech/clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(typeof (data.detail || data.error) === 'string'
          ? (data.detail || data.error) : JSON.stringify(data.detail || data.error))
      }
      setCloneResult({ voice_id: v, demo_audio: data.demo_audio || '' })
      fetchVoices()
    } catch (e) { setError(e.message || 'Voice cloning failed.') }
    finally { setCloneRunning(false) }
  }

  const submitDesign = async () => {
    setError(null); setDesignResult(null)
    if (!designPrompt.trim()) { setError('Voice description is required.'); return }
    if (!designPreviewText.trim()) { setError('Preview text is required.'); return }
    if (designPreviewText.length > 500) { setError('Preview text must be ≤500 chars.'); return }
    setDesignRunning(true)
    try {
      const body = { prompt: designPrompt, preview_text: designPreviewText }
      if (designVoiceId.trim()) body.voice_id = designVoiceId.trim()
      const res = await apiFetch('/api/minimax/speech/design', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(typeof (data.detail || data.error) === 'string'
          ? (data.detail || data.error) : JSON.stringify(data.detail || data.error))
      }
      setDesignResult({ voice_id: data.voice_id, trial_audio_path: data.trial_audio_path })
      fetchVoices()
    } catch (e) { setError(e.message || 'Voice design failed.') }
    finally { setDesignRunning(false) }
  }

  const appendTrait = (trait) => {
    const sep = designPrompt.trim() ? ', ' : ''
    setDesignPrompt(prev => prev + sep + trait)
  }

  const deleteVoice = async (type, vid, vname) => {
    if (!window.confirm(`Delete voice "${vname || vid}"? This cannot be undone.`)) return
    setError(null)
    try {
      const res = await apiFetch(`/api/minimax/speech/voices/${type}/${encodeURIComponent(vid)}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.detail || data.error || 'Delete failed.')
      fetchVoices()
    } catch (e) { setError(e.message || 'Delete failed.') }
  }

  // ── Reusable UI bits ────────────────────────────────────────────────────

  const errorBox = error ? (
    <div style={{
      background: 'hsl(var(--error) / 0.1)',
      border: '0.5px solid hsl(var(--error) / 0.2)',
      borderRadius: 9, padding: '8px 12px',
      fontSize: 11, color: 'hsl(var(--error))',
    }}>{error}</div>
  ) : null

  // ── Synthesize controls ────────────────────────────────────────────────

  const synthesizeControls = (
    <>
      {/* Delivery tabs — Standard | Async · long text (mockup L900-904) */}
      <div style={{ display: 'flex', padding: 3, borderRadius: 9, background: 'var(--app-surface)' }}>
        {DELIVERY_OPTIONS.map(d => {
          const active = delivery === d.id
          return (
            <button
              key={d.id}
              onClick={() => setDelivery(d.id)}
              style={{
                flex: 1, padding: '6px 12px', borderRadius: 7, border: 'none',
                background: active ? 'hsl(var(--primary))' : 'transparent',
                color: active ? '#fff' : 'var(--app-text-2)',
                fontSize: 11, fontWeight: 500, cursor: 'pointer',
                transition: 'background 0.15s',
              }}
            >{d.label}</button>
          )
        })}
      </div>

      {/* Text — mockup L906-913 */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
          <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--app-text-2)' }}>Text</label>
          <span style={{ fontSize: 11, color: 'var(--app-text-2)', fontVariantNumeric: 'tabular-nums' }}>
            {text.length.toLocaleString()} / 10000
          </span>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Enter text… (up to 10,000 characters)"
          rows={5}
          style={{
            width: '100%',
            background: 'var(--app-surface)',
            border: '0.5px solid var(--app-border)',
            borderRadius: 10, padding: '11px 13px',
            fontSize: 13, lineHeight: 1.6, color: 'var(--app-text)',
            resize: 'none', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none',
          }}
        />
        <div style={{ fontSize: 10.5, color: 'var(--app-text-2)', marginTop: 6, lineHeight: 1.5 }}>
          Insert <code style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--app-text)', padding: '1px 5px', background: 'var(--app-surface)', borderRadius: 3, fontSize: 9.5 }}>{'<#0.5#>'}</code> for a 0.5s pause · interjections like <code style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--app-text)' }}>(laughs)</code> on speech-2.8.
        </div>
      </div>

      {/* Model — mockup L914-918 */}
      <div>
        <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--app-text-2)', display: 'block', marginBottom: 7 }}>
          Model
        </label>
        <div style={{ position: 'relative' }}>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            style={{
              width: '100%',
              background: 'var(--app-surface)',
              border: '0.5px solid var(--app-border)',
              borderRadius: 10, padding: '9px 30px 9px 13px',
              fontSize: 12.5, fontWeight: 600, color: 'var(--app-text)',
              cursor: 'pointer', outline: 'none', appearance: 'none',
            }}
          >
            {SPEECH_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          <ChevronDown size={12} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--app-text-2)' }} />
        </div>
      </div>

      {/* Voice — mockup L919-971
          Row 1: "Voice" label (left) + (language filter + refresh) (right)
          Row 2: voice dropdown trigger (opens grouped popup) */}
      <div ref={voiceDropdownRef} style={{ position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
          <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--app-text-2)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Mic size={11} /> Voice
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <LanguageFilter
              value={voiceLangFilter}
              options={languageOptions}
              open={voiceLangOpen}
              onOpenChange={setVoiceLangOpen}
              onChange={setVoiceLangFilter}
            />
            <button
              onClick={fetchVoices}
              title="Reload voices"
              style={{
                width: 24, height: 24, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: 7, border: '0.5px solid var(--app-border)',
                background: 'var(--app-surface)', color: 'var(--app-text-2)',
                cursor: 'pointer',
              }}
            >
              <RefreshCw size={12} className={voicesLoading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
        <button
          onClick={() => setVoiceDropdownOpen(!voiceDropdownOpen)}
          style={{
            width: '100%',
            background: 'var(--app-surface)',
            border: '0.5px solid var(--app-border)',
            borderRadius: 10, padding: '7px 11px',
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 11,
            outline: 'none',
          }}
        >
          {selectedVoice ? (
            <>
              <VoiceAvatar voice={selectedVoice} size={32} />
              <div style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--app-text)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {selectedVoice.voice_name || selectedVoice.voice_id}
                </div>
                <div style={{ fontSize: 11, color: 'var(--app-text-2)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {voiceTags(selectedVoice) || voiceLanguage(selectedVoice)}
                </div>
              </div>
            </>
          ) : (
            <div style={{ flex: 1, textAlign: 'left', fontSize: 12, color: 'var(--app-text-2)' }}>
              {voicesLoading ? 'Loading voices…' : 'Select a voice'}
            </div>
          )}
          <ChevronDown size={14} color="var(--app-text-2)" />
        </button>

        {voiceDropdownOpen && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4,
            background: 'var(--app-bg, var(--app-surface))',
            border: '0.5px solid var(--app-border)',
            borderRadius: 11, maxHeight: 300, overflowY: 'auto', zIndex: 50,
            boxShadow: '0 16px 40px rgba(0,0,0,0.45)',
          }}>
            {voicesByLanguageFiltered.length === 0 && (
              <div style={{ padding: 16, fontSize: 12, color: 'var(--app-text-2)', textAlign: 'center' }}>
                {voicesLoading ? 'Loading…' : 'No voices in this language'}
              </div>
            )}
            {voicesByLanguageFiltered.map(([lang, list]) => (
              <div key={lang}>
                <div style={{
                  padding: '7px 8px 4px', fontSize: 10, fontWeight: 700,
                  letterSpacing: 0.5, textTransform: 'uppercase',
                  color: 'var(--app-text-2)',
                  position: 'sticky', top: 0,
                  background: 'var(--app-bg, var(--app-surface))',
                }}>
                  {lang} <span style={{ opacity: 0.6, fontWeight: 400, textTransform: 'none' }}>· {list.length}</span>
                </div>
                {list.map(v => {
                  const selected = v.voice_id === voiceId
                  return (
                    <button
                      key={`${v.source}-${v.voice_id}`}
                      onClick={() => { setVoiceId(v.voice_id); setVoiceDropdownOpen(false) }}
                      style={{
                        width: '100%',
                        background: selected ? 'hsl(var(--primary) / 0.12)' : 'transparent',
                        border: 'none', padding: '6px 10px',
                        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
                      }}
                    >
                      <VoiceAvatar voice={v} size={28} />
                      <div style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--app-text)' }}>
                          {v.voice_name || v.voice_id}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--app-text-2)' }}>
                          {voiceTags(v)}
                        </div>
                      </div>
                      {selected && <Check size={15} color="hsl(var(--primary))" strokeWidth={2.4} />}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Speed / Volume / Pitch — mockup L972-986 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {[
          { label: 'Speed',  value: speed, set: setSpeed,  display: `${speed.toFixed(1)}x`, min: 0.5, max: 2.0, step: 0.1 },
          { label: 'Volume', value: vol,   set: setVol,    display: vol.toFixed(1),        min: 0.1, max: 2.0, step: 0.1 },
          { label: 'Pitch',  value: pitch, set: setPitch,  display: String(pitch),         min: -12, max: 12,  step: 1   },
        ].map(s => (
          <div key={s.label}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              fontSize: 11.5, fontWeight: 600, color: 'var(--app-text-2)', marginBottom: 7,
            }}>
              <span>{s.label}</span>
              <span style={{ color: 'var(--app-text)', fontVariantNumeric: 'tabular-nums' }}>{s.display}</span>
            </div>
            <input
              type="range" min={s.min} max={s.max} step={s.step}
              value={s.value} onChange={(e) => s.set(parseFloat(e.target.value))}
              style={{ width: '100%', accentColor: 'hsl(var(--primary))' }}
            />
          </div>
        ))}
      </div>

      {/* Emotion — mockup L987-1005 */}
      <div>
        <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--app-text-2)', display: 'block', marginBottom: 7 }}>
          Emotion
        </label>
        <div style={{ position: 'relative' }}>
          <select
            value={emotion}
            onChange={(e) => setEmotion(e.target.value)}
            style={{
              width: '100%',
              background: 'var(--app-surface)',
              border: '0.5px solid var(--app-border)',
              borderRadius: 10, padding: '9px 30px 9px 13px',
              fontSize: 12.5, fontWeight: 600, color: 'var(--app-text)',
              cursor: 'pointer', outline: 'none', appearance: 'none',
            }}
          >
            {EMOTIONS.map(e => <option key={e.id || 'auto'} value={e.id}>{e.label}</option>)}
          </select>
          <ChevronDown size={12} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--app-text-2)' }} />
        </div>
      </div>

      {/* Voice effects — mockup L1006-1029 (always open, no (optional)) */}
      <div>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--app-text-2)', marginBottom: 10 }}>
          Voice effects
        </div>
        {[
          { label: 'Pitch',     value: vmPitch,     set: setVmPitch,     lo: 'Deeper',   hi: 'Brighter' },
          { label: 'Intensity', value: vmIntensity, set: setVmIntensity, lo: 'Softer',   hi: 'Stronger' },
          { label: 'Timbre',    value: vmTimbre,    set: setVmTimbre,    lo: 'Nasal',    hi: 'Crisp'    },
        ].map(s => (
          <div key={s.label} style={{ marginBottom: 12 }}>
            <input
              type="range" min={-100} max={100} step={1}
              value={s.value} onChange={(e) => s.set(parseInt(e.target.value))}
              style={{ width: '100%', accentColor: 'hsl(var(--primary))' }}
            />
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              fontSize: 10.5, color: 'var(--app-text-2)', marginTop: 5,
            }}>
              <span>{s.lo}</span>
              <span>{s.hi}</span>
            </div>
          </div>
        ))}

        {/* Sound effect chips */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 4 }}>
          {SOUND_EFFECT_CHIPS.map(fx => {
            const active = vmSoundFx === fx.id
            return (
              <button
                key={fx.id}
                onClick={() => setVmSoundFx(active ? '' : fx.id)}
                style={{
                  padding: '4px 9px', borderRadius: 7,
                  cursor: 'pointer',
                  background: active ? 'hsl(var(--primary))' : 'var(--app-surface)',
                  color: active ? '#fff' : 'var(--app-text)',
                  fontSize: 11, fontWeight: 500,
                  border: active ? 'none' : '0.5px solid var(--app-border)',
                }}
              >{fx.label}</button>
            )
          })}
        </div>
      </div>

      {/* Language boost — mockup bottom of L972-1029 (NEW) */}
      <div>
        <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--app-text-2)', display: 'block', marginBottom: 7 }}>
          Language boost
        </label>
        <div style={{ position: 'relative' }}>
          <select
            value={languageBoost}
            onChange={(e) => setLanguageBoost(e.target.value)}
            style={{
              width: '100%',
              background: 'var(--app-surface)',
              border: '0.5px solid var(--app-border)',
              borderRadius: 10, padding: '9px 30px 9px 13px',
              fontSize: 12.5, fontWeight: 500, color: 'var(--app-text)',
              cursor: 'pointer', outline: 'none', appearance: 'none',
            }}
          >
            {LANGUAGE_BOOST_OPTIONS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
          <ChevronDown size={12} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--app-text-2)' }} />
        </div>
      </div>

      {errorBox}

      <button
        onClick={synthesizeNow}
        disabled={loading || !text.trim() || text.length > 10000}
        style={{
          marginTop: 'auto',
          width: '100%', height: 42, padding: '0 11px',
          background: 'hsl(var(--primary))',
          color: '#fff', border: 'none', borderRadius: 11,
          fontSize: 13.5, fontWeight: 600,
          cursor: loading ? 'wait' : 'pointer',
          opacity: (loading || !text.trim() || text.length > 10000) ? 0.4 : 1,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}
      >
        {loading
          ? <><Loader2 size={14} className="animate-spin" /> Generating…</>
          : <><Volume2 size={16} /> Synthesize Speech</>}
      </button>
    </>
  )

  // ── Synthesize canvas — mockup L1038-1066 ─────────────────────────────
  // Per user feedback: "History" + "Saved to..." go INSIDE the canvas body
  // (not as a separate 52px galleryHeader), so they sit below the topBar
  // along with the empty state / recent generations.

  const synthesizeCanvas = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%' }}>
      {/* Inner canvas header — "History" + "Saved to..." */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--app-text)' }}>History</span>
        <span style={{ fontSize: 11.5, color: 'var(--app-text-2)' }}>
          Saved to workspace/generations/tts/
        </span>
      </div>
      {result ? (
        <div style={{
          background: 'var(--app-surface)', border: '0.5px solid var(--app-border)',
          borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 12,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <p style={{ fontSize: 13, color: 'var(--app-text-2)', display: 'flex', alignItems: 'center', gap: 6, margin: 0 }}>
              <Check size={14} color="hsl(var(--success, #10b981))" /> Audio generated
            </p>
            {cost && (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '3px 10px', borderRadius: 999,
                background: 'hsl(var(--primary) / 0.05)',
                border: '0.5px solid hsl(var(--primary) / 0.2)',
                fontSize: 10.5, fontWeight: 500, color: 'hsl(var(--primary))',
              }}>
                <Coins size={11} />
                {t('media.costLabel', {
                  credits: cost.cost_credits ?? 0,
                  usd: typeof cost.cost_usd === 'number' ? cost.cost_usd.toFixed(4) : '0.0000',
                })}
              </div>
            )}
          </div>
          {result.file_path && (
            <>
              <audio controls style={{ width: '100%' }} src={assetUrl(`/api/files/content?path=${encodeURIComponent(result.file_path)}`)} />
              <a
                href={assetUrl(`/api/files/content?path=${encodeURIComponent(result.file_path)}`)}
                download
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '8px 14px',
                  background: 'hsl(var(--primary))',
                  color: '#fff', borderRadius: 8,
                  fontSize: 13, textDecoration: 'none',
                  width: 'fit-content',
                }}
              >
                <Save size={14} /> Download
              </a>
            </>
          )}
        </div>
      ) : (
        /* Empty state — mockup L1038-1065 (default "Your generated audio will appear here") */
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 0, padding: '40px 16px', textAlign: 'center', minHeight: 180,
        }}>
          <div style={{
            width: 64, height: 64, borderRadius: '50%',
            background: 'var(--app-surface)', border: '0.5px solid var(--app-border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Volume2 size={26} color="var(--app-text-2)" />
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--app-text)', marginTop: 12 }}>
            {SPEECH_MODELS.find(m => m.id === model)?.label || model}
          </div>
          <div style={{ fontSize: 11, color: 'var(--app-text-2)', marginTop: 4 }}>
            Your generated audio will appear here
          </div>
        </div>
      )}

      <div style={{ height: 1, background: 'var(--app-border)' }} />

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

  // ── Clone controls ─────────────────────────────────────────────────────

  const cloneControls = (
    <>
      {/* Sample audio dropzone */}
      <div>
        <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--app-text-2)', display: 'block', marginBottom: 7 }}>
          Sample audio
        </label>
        <div
          onDrop={onDropCloneSample}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => cloneSampleInputRef.current?.click()}
          style={{
            background: 'var(--app-surface)',
            border: '1.5px dashed var(--app-border)',
            borderRadius: 12, padding: '20px',
            textAlign: 'center', cursor: 'pointer',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
          }}
        >
          {cloneUploading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--app-text-2)' }}>
              <Loader2 size={14} className="animate-spin" /> Uploading…
            </div>
          ) : cloneSample ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--app-text)' }}>
              <FileAudio size={14} color="hsl(var(--primary))" />
              <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {cloneSample.name}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); setCloneSample(null); setCloneSampleFileId(null) }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--app-text-2)' }}
              >
                <X size={12} />
              </button>
            </div>
          ) : (
            <>
              <div style={{
                width: 40, height: 40, borderRadius: 10,
                background: 'var(--app-surface)', border: '0.5px solid var(--app-border)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'hsl(var(--primary))',
              }}>
                <Upload size={19} />
              </div>
              <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--app-text)' }}>
                Drop a voice sample or <span style={{ color: 'hsl(var(--primary))' }}>browse</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--app-text-2)' }}>
                10s–5min · max 20 MB · mp3, m4a, wav
              </div>
            </>
          )}
          <input ref={cloneSampleInputRef} type="file" accept="audio/*" onChange={onPickCloneSample} style={{ display: 'none' }} />
        </div>
      </div>

      {/* Voice ID */}
      <div>
        <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--app-text-2)', display: 'block', marginBottom: 7 }}>
          Voice ID
        </label>
        <input
          type="text"
          value={cloneVoiceId}
          onChange={(e) => setCloneVoiceId(e.target.value)}
          placeholder="my-narrator-01"
          style={{
            width: '100%',
            background: 'var(--app-surface)',
            border: '0.5px solid var(--app-border)',
            borderRadius: 10, padding: '9px 13px',
            fontSize: 12.5, color: 'var(--app-text)', outline: 'none',
            fontFamily: 'JetBrains Mono, monospace',
            boxSizing: 'border-box',
          }}
        />
        <div style={{ fontSize: 10.5, color: 'var(--app-text-2)', marginTop: 6, lineHeight: 1.5 }}>
          8–256 chars · start with a letter · letters, digits, <code style={{ fontFamily: 'JetBrains Mono, monospace' }}>- _</code>
        </div>
      </div>

      {/* Accuracy prompt — mockup L1087-1103 (collapsible) */}
      <div style={{ border: '0.5px solid var(--app-border)', borderRadius: 11, overflow: 'hidden' }}>
        <button
          onClick={() => setClonePromptOpen(!clonePromptOpen)}
          style={{
            width: '100%',
            display: 'flex', alignItems: 'center', gap: 9,
            padding: '11px 13px', border: 'none',
            background: 'hsl(var(--app-surface) / 0.4)',
            color: 'var(--app-text)', cursor: 'pointer', textAlign: 'left',
          }}
        >
          <Sparkles size={14} color="hsl(var(--primary))" />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600 }}>
              Accuracy prompt <span style={{ fontWeight: 400, color: 'var(--app-text-2)' }}>· optional</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--app-text-2)' }}>
              Short clip + transcript boosts similarity
            </div>
          </div>
          <ChevronRight
            size={14}
            color="var(--app-text-2)"
            style={{
              transform: clonePromptOpen ? 'rotate(90deg)' : 'rotate(0deg)',
              transition: 'transform 0.15s',
              flexShrink: 0,
            }}
          />
        </button>
        {clonePromptOpen && (
          <div style={{ padding: 13, display: 'flex', flexDirection: 'column', gap: 11, borderTop: '0.5px solid var(--app-border)' }}>
            <div
              onClick={() => clonePromptInputRef.current?.click()}
              style={{
                display: 'flex', alignItems: 'center', gap: 9,
                height: 38, padding: '0 11px',
                border: '1px dashed var(--app-border)',
                borderRadius: 9,
                color: 'var(--app-text-2)', fontSize: 11.5, cursor: 'pointer',
              }}
            >
              {clonePromptClip ? (
                <>
                  <FileAudio size={14} color="hsl(var(--primary))" />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--app-text)' }}>
                    {clonePromptClip.name}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); setClonePromptClip(null) }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--app-text-2)' }}
                  ><X size={12} /></button>
                </>
              ) : (
                <>
                  <Upload size={14} /> Prompt clip · &lt; 8s
                </>
              )}
              <input
                ref={clonePromptInputRef}
                type="file"
                accept="audio/*"
                onChange={onPickClonePrompt}
                style={{ display: 'none' }}
              />
            </div>
            <input
              type="text"
              value={clonePromptText}
              onChange={(e) => setClonePromptText(e.target.value)}
              placeholder="This voice sounds natural and pleasant."
              style={{
                width: '100%',
                background: 'var(--app-surface)',
                border: '0.5px solid var(--app-border)',
                borderRadius: 9, padding: '9px 11px',
                fontSize: 12.5, color: 'var(--app-text)', outline: 'none',
                fontFamily: 'inherit',
              }}
            />
          </div>
        )}
      </div>

      {/* Toggles — mockup L1105-1113 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--app-text)' }}>Noise reduction</div>
            <div style={{ fontSize: 11, color: 'var(--app-text-2)' }}>Clean background hiss</div>
          </div>
          <Toggle checked={cloneNR} onChange={setCloneNR} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--app-text)' }}>Volume normalization</div>
            <div style={{ fontSize: 11, color: 'var(--app-text-2)' }}>Even out loudness</div>
          </div>
          <Toggle checked={cloneVN} onChange={setCloneVN} />
        </div>
      </div>

      {/* 7-day warning — mockup L1116-1119 */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 8,
        background: 'hsl(43 96% 56% / 0.1)',
        border: '0.5px solid hsl(43 96% 56% / 0.25)',
        borderRadius: 10, padding: '11px 12px',
        fontSize: 11, color: 'var(--app-text)', lineHeight: 1.5,
      }}>
        <AlertCircle size={14} color="hsl(43 96% 46%)" style={{ flexShrink: 0, marginTop: 1 }} />
        <span>A cloned voice is <strong>deleted automatically if unused for 7 days</strong>.</span>
      </div>

      {errorBox}

      <button
        onClick={submitClone}
        disabled={cloneRunning || !cloneSampleFileId || !cloneVoiceId.trim()}
        style={{
          marginTop: 'auto', width: '100%', height: 42, padding: '0 11px',
          background: 'hsl(var(--primary))',
          color: '#fff', border: 'none', borderRadius: 11,
          fontSize: 13.5, fontWeight: 600,
          cursor: cloneRunning ? 'wait' : 'pointer',
          opacity: (cloneRunning || !cloneSampleFileId || !cloneVoiceId.trim()) ? 0.4 : 1,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}
      >
        {cloneRunning
          ? <><Loader2 size={14} className="animate-spin" /> Cloning…</>
          : <><Mic2 size={16} /> Clone voice</>}
      </button>
    </>
  )

  // ── Clone canvas ───────────────────────────────────────────────────────

  const cloneCanvas = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%' }}>
      {/* Inner canvas header — "Preview" */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--app-text)' }}>Preview</span>
      </div>
      {cloneResult ? (
        <div style={{
          background: 'var(--app-surface)', border: '0.5px solid var(--app-border)',
          borderRadius: 14, padding: 22,
          maxWidth: 420, margin: '0 auto', width: '100%',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 18 }}>
            <div style={{
              width: 46, height: 46, borderRadius: 12,
              background: 'linear-gradient(135deg,#0ea5e9,#6366f1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontSize: 15, fontWeight: 700,
            }}>
              {(cloneResult.voice_id || 'CV').slice(0, 2).toUpperCase()}
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--app-text)' }}>
                {cloneResult.voice_id}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--app-text-2)', fontFamily: 'JetBrains Mono, monospace' }}>
                cloned · {model}
              </div>
            </div>
          </div>
          {clonePromptText && (
            <div style={{ fontSize: 12.5, color: 'var(--app-text-2)', lineHeight: 1.55, marginBottom: 16, fontStyle: 'italic' }}>
              "{clonePromptText}"
            </div>
          )}
          {cloneResult.demo_audio && (
            <audio controls style={{ width: '100%' }} src={cloneResult.demo_audio} />
          )}
        </div>
      ) : (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          padding: '60px 16px', textAlign: 'center',
          color: 'var(--app-text-2)',
        }}>
          <Mic2 size={32} style={{ opacity: 0.5, marginBottom: 12 }} />
          <div style={{ fontSize: 12 }}>Your cloned voice preview will appear here</div>
        </div>
      )}
    </div>
  )

  // ── Design controls ────────────────────────────────────────────────────

  const designControls = (
    <>
      {/* Describe the voice */}
      <div>
        <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--app-text-2)', display: 'block', marginBottom: 7 }}>
          Describe the voice
        </label>
        <textarea
          value={designPrompt}
          onChange={(e) => setDesignPrompt(e.target.value)}
          placeholder="e.g. A warm, middle-aged male narrator with a calm British accent and gentle gravitas…"
          rows={4}
          style={{
            width: '100%',
            background: 'var(--app-surface)',
            border: '0.5px solid var(--app-border)',
            borderRadius: 10, padding: '11px 13px',
            fontSize: 13, lineHeight: 1.6, color: 'var(--app-text)',
            resize: 'none', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none',
          }}
        />
      </div>

      {/* Trait presets */}
      <div>
        <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--app-text-2)', display: 'block', marginBottom: 7 }}>
          Trait presets
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
          {DESIGN_TRAITS.map(t => (
            <button
              key={t.id}
              onClick={() => appendTrait(t.label.replace('+ ', ''))}
              style={{
                padding: '4px 9px', borderRadius: 7,
                background: 'var(--app-surface)',
                border: '0.5px solid var(--app-border)',
                color: 'var(--app-text)', fontSize: 11, fontWeight: 500,
                cursor: 'pointer',
              }}
            >{t.label}</button>
          ))}
        </div>
      </div>

      {/* Preview text */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
          <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--app-text-2)' }}>Preview text</label>
          <span style={{ fontSize: 11, color: designPreviewText.length > 500 ? 'hsl(var(--error))' : 'var(--app-text-2)', fontVariantNumeric: 'tabular-nums' }}>
            {designPreviewText.length} / 500
          </span>
        </div>
        <textarea
          value={designPreviewText}
          onChange={(e) => setDesignPreviewText(e.target.value)}
          placeholder="Once upon a time, in a quiet village by the sea…"
          rows={3}
          style={{
            width: '100%',
            background: 'var(--app-surface)',
            border: '0.5px solid var(--app-border)',
            borderRadius: 10, padding: '11px 13px',
            fontSize: 13, lineHeight: 1.6, color: 'var(--app-text)',
            resize: 'none', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none',
          }}
        />
      </div>

      {errorBox}

      <button
        onClick={submitDesign}
        disabled={designRunning || !designPrompt.trim() || !designPreviewText.trim() || designPreviewText.length > 500}
        style={{
          marginTop: 'auto', width: '100%', height: 42, padding: '0 11px',
          background: 'hsl(var(--primary))',
          color: '#fff', border: 'none', borderRadius: 11,
          fontSize: 13.5, fontWeight: 600,
          cursor: designRunning ? 'wait' : 'pointer',
          opacity: (designRunning || !designPrompt.trim() || !designPreviewText.trim() || designPreviewText.length > 500) ? 0.4 : 1,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}
      >
        {designRunning
          ? <><Loader2 size={14} className="animate-spin" /> Designing…</>
          : <><Wand2 size={16} /> Design voice</>}
      </button>
    </>
  )

  // ── Design canvas ──────────────────────────────────────────────────────

  const designCanvas = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%' }}>
      {/* Inner canvas header — "Designed voice" + "Save voice" */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--app-text)' }}>Designed voice</span>
        <button
          onClick={() => {
            if (designResult?.voice_id) {
              navigator.clipboard?.writeText(designResult.voice_id)
            }
          }}
          disabled={!designResult}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '6px 12px', borderRadius: 8,
            background: 'hsl(var(--primary))', color: '#fff',
            border: 'none', fontSize: 12, fontWeight: 600,
            cursor: designResult ? 'pointer' : 'not-allowed',
            opacity: designResult ? 1 : 0.4,
          }}
        >
          <Plus size={13} /> Save voice
        </button>
      </div>

      {designResult ? (
        <div style={{
          background: 'var(--app-surface)', border: '0.5px solid var(--app-border)',
          borderRadius: 14, padding: 22, maxWidth: 420, margin: '0 auto', width: '100%',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 18 }}>
            <div style={{
              width: 46, height: 46, borderRadius: 12,
              background: 'linear-gradient(135deg,#a855f7,#ec4899)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff',
            }}>
              <Sparkles size={20} />
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--app-text)' }}>
                Designed voice
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--app-text-2)', fontFamily: 'JetBrains Mono, monospace' }}>
                voice_id pending save
              </div>
            </div>
          </div>
          {designPreviewText && (
            <div style={{
              fontSize: 12.5, color: 'var(--app-text-2)',
              lineHeight: 1.55, marginBottom: 16, fontStyle: 'italic',
            }}>
              "{designPreviewText}…"
            </div>
          )}
          {designResult.trial_audio_path && (
            <audio controls style={{ width: '100%' }} src={assetUrl(`/api/files/content?path=${encodeURIComponent(designResult.trial_audio_path)}`)} />
          )}
        </div>
      ) : (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          padding: '60px 16px', textAlign: 'center',
          color: 'var(--app-text-2)',
        }}>
          <Wand2 size={32} style={{ opacity: 0.5, marginBottom: 12 }} />
          <div style={{ fontSize: 12 }}>Your designed voice will appear here</div>
        </div>
      )}
    </div>
  )

  // ── Voices library (full-width) ────────────────────────────────────────

  const VoiceCard = ({ voice, canDelete }) => (
    <div style={{
      background: 'var(--app-surface)', border: '0.5px solid var(--app-border)',
      borderRadius: 12, padding: 13,
      display: 'flex', alignItems: 'center', gap: 12,
      transition: 'border-color 0.15s',
    }}
    onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'hsl(var(--primary))' }}
    onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--app-border)' }}
    >
      <VoiceAvatar voice={voice} size={42} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 12.5, fontWeight: 600, color: 'var(--app-text)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {voice.voice_name || voice.voice_id}
        </div>
        <div style={{
          fontSize: 11, color: 'var(--app-text-2)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {voiceTags(voice) || voiceLanguage(voice)}
        </div>
      </div>
      <button
        onClick={() => { setVoiceId(voice.voice_id); setMode('synthesize'); setVoiceDropdownOpen(false) }}
        style={{
          width: 30, height: 30, borderRadius: 8,
          background: 'var(--app-bg)', border: '0.5px solid var(--app-border)',
          cursor: 'pointer', color: 'var(--app-text-2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}
        title="Use in Synthesize"
      >
        <Play size={13} fill="currentColor" />
      </button>
      {canDelete && (
        <button
          onClick={() => deleteVoice(voice.source, voice.voice_id, voice.voice_name)}
          style={{
            width: 30, height: 30, borderRadius: 8,
            background: 'transparent', border: '0.5px solid var(--app-border)',
            cursor: 'pointer', color: 'var(--app-text-2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}
          title="Delete voice"
        >
          <Trash2 size={13} />
        </button>
      )}
    </div>
  )

  const voicesControls = (
    <>
      {/* Search */}
      <div style={{ position: 'relative' }}>
        <Search size={13} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--app-text-2)', pointerEvents: 'none' }} />
        <input
          type="text"
          value={voiceSearch}
          onChange={(e) => setVoiceSearch(e.target.value)}
          placeholder="Search voices…"
          style={{
            width: '100%',
            background: 'var(--app-surface)',
            border: '0.5px solid var(--app-border)',
            borderRadius: 9, padding: '8px 12px 8px 32px',
            fontSize: 12, color: 'var(--app-text)', outline: 'none',
            fontFamily: 'inherit', boxSizing: 'border-box',
          }}
        />
      </div>

      {/* System voices */}
      {voicesLoading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--app-text-2)', padding: '12px 0' }}>
          <Loader2 size={14} className="animate-spin" /> Loading voices…
        </div>
      ) : (
        <>
          {[
            { title: 'System voices', items: systemVoicesFiltered, source: 'system_voice', badge: '40+' },
            { title: 'Cloned',        items: clonedVoicesFiltered,  source: 'voice_cloning', badge: String(clonedVoicesFiltered.length) },
            { title: 'Designed',      items: designedVoicesFiltered,source: 'voice_generation', badge: String(designedVoicesFiltered.length) },
          ].map(section => {
            if (section.source !== 'system_voice' && section.items.length === 0) return null
            if (section.source === 'system_voice' && section.items.length === 0 && voiceSearch.trim()) return null
            return (
              <div key={section.title}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
                }}>
                  <h4 style={{ fontSize: 12, fontWeight: 600, color: 'var(--app-text)', margin: 0 }}>
                    {section.title}
                  </h4>
                  <span style={{
                    fontSize: 11, color: 'var(--app-text-2)',
                    background: 'var(--app-surface)',
                    padding: '1px 8px', borderRadius: 10,
                  }}>{section.badge}</span>
                </div>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(232px, 1fr))',
                  gap: 12,
                }}>
                  {section.items.slice(0, 12).map(v => (
                    <VoiceCard
                      key={v.voice_id}
                      voice={v}
                      canDelete={section.source !== 'system_voice'}
                    />
                  ))}
                </div>
                {section.items.length > 12 && (
                  <div style={{ fontSize: 11, color: 'var(--app-text-2)', textAlign: 'center', marginTop: 8 }}>
                    + {section.items.length - 12} more — search to filter
                  </div>
                )}
              </div>
            )
          })}
        </>
      )}
    </>
  )

  // ── Render ─────────────────────────────────────────────────────────────

  const isVoices = mode === 'voices'
  const controls = isVoices ? voicesControls
    : mode === 'clone' ? cloneControls
    : mode === 'design' ? designControls
    : synthesizeControls

  const canvas = mode === 'clone' ? cloneCanvas
    : mode === 'design' ? designCanvas
    : synthesizeCanvas

  return (
    <MediaPanelLayout
      layout={isVoices ? 'full' : 'split'}
      controlsWidth={400}
      topBar={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, width: '100%' }}>
          {/* Left: icon + title (mockup L879-885) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
            <div
              style={{
                width: 34, height: 34, flexShrink: 0, borderRadius: 9,
                background: 'hsl(var(--primary) / 0.14)',
                color: 'hsl(var(--primary))',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Volume2 size={18} strokeWidth={2} />
            </div>
            <span style={{
              fontSize: 15, fontWeight: 600, color: 'var(--app-text)',
              whiteSpace: 'nowrap',
            }}>
              Speech
            </span>
          </div>
          {/* Right: sub-mode pills (mockup L886-892) */}
          <div style={{ flexShrink: 0 }}>
            <ModeTabBar modes={SPEECH_MODES} active={mode} onChange={setMode} />
          </div>
        </div>
      }
      controls={controls}
      canvas={isVoices ? null : canvas}
    />
  )
}
