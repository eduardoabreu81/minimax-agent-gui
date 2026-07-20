import { useState, useEffect, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Video, Loader2, Save, RefreshCw, Image as ImageIcon, Film, User, Check, Coins, AlertTriangle,
  Upload, X, ChevronDown, Play, Download, Search, Sliders, FileVideo, Info,
} from 'lucide-react'
import { useSessionProtection } from '../../hooks/useSessionProtection'
import MediaPanelLayout from '../shared/MediaPanelLayout'
import ModeTabBar from '../shared/ModeTabBar'
import { apiFetch, assetUrl } from '../../lib/api.js'
import AnchorLibrary from './AnchorLibrary.jsx'
import { anchorToDataUrl } from '../../lib/anchors.js'
import GenerationMetaModal from './GenerationMetaModal'

// ───────────────────────────────────────────────────────────────────────────
// Constants — TAURI_SPEC §5b
// ───────────────────────────────────────────────────────────────────────────

const VIDEO_MODES = [
  { id: 'text2video',  labelKey: 'video.modes.text',    titleKey: 'video.modes.text' },
  { id: 'image2video', labelKey: 'video.modes.image',   titleKey: 'video.modes.image' },
  { id: 'sef',         labelKey: 'video.modes.frames',  titleKey: 'video.modes.frames' },
  { id: 's2v',         labelKey: 'video.modes.subject', titleKey: 'video.modes.subject' },
]

const VIDEO_MODELS = [
  { id: 'MiniMax-Hailuo-2.3',      labelKey: 'video.modelHailuo23' },
  { id: 'MiniMax-Hailuo-2.3-Fast', labelKey: 'video.modelHailuo23Fast' },
]

// Camera commands — full list of 18 motions the mockup hints at
// (mockup shows 5 + "+12 more"). Hardcoded since the API doesn't return
// a dynamic list.
const CAMERA_COMMANDS = [
  'Push in', 'Push out', 'Pan left', 'Pan right',
  'Zoom in', 'Zoom out', 'Tracking shot', 'Static shot',
  'Tilt up', 'Tilt down', 'Crane up', 'Crane down',
  'Dolly in', 'Dolly out', 'Handheld', 'Aerial',
  'Orbit', 'Roll',
]

const DURATIONS = [
  { id: '6',  labelKey: 'video.duration6s' },
  { id: '10', labelKey: 'video.duration10s' },
]

const RESOLUTIONS = [
  { id: '768P',  labelKey: 'video.resolution768P' },
  { id: '1080P', labelKey: 'video.resolution1080P' },
]

// Per-mode frame requirements — drives which dropzones show
const MODE_FRAMES = {
  text2video:  { start: false, end: false, subject: false },
  image2video: { start: true,  end: false, subject: false },
  sef:         { start: true,  end: true,  subject: false },
  s2v:         { start: false, end: false, subject: true  },
}

/**
 * Map presence of frame/subject inputs to the MiniMax video-mode taxonomy
 * recorded in the generation-meta sidecar. Pure function — exported for
 * unit tests.
 *
 * @param {{firstFrame?: string|null, lastFrame?: string|null, subject_reference?: Array|null}} inputs
 * @returns {'text2video' | 'image2video' | 'sef' | 's2v'}
 */
export function deriveVideoMode({ firstFrame, lastFrame, subject_reference } = {}) {
  if (subject_reference && subject_reference.length) return 's2v'
  if (firstFrame && lastFrame) return 'sef'
  if (firstFrame) return 'image2video'
  return 'text2video'
}

// ───────────────────────────────────────────────────────────────────────────
// Inline sub-components
// ───────────────────────────────────────────────────────────────────────────

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

// Image dropzone — shows placeholder or the picked filename. On click
// opens a file picker; supports drag/drop too.
function FrameDropzone({ file, onPick, t }) {
  const onDrop = (e) => {
    e.preventDefault()
    const f = e.dataTransfer?.files?.[0]
    if (f && f.type.startsWith('image/')) onPick(f)
  }
  const onSelect = (e) => {
    const f = e.target.files?.[0]
    if (f) onPick(f)
    e.target.value = ''
  }
  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDrop={onDrop}
      onDragOver={(e) => e.preventDefault()}
      style={{
        flex: 1, height: 96,
        border: '1.5px dashed var(--app-border)',
        borderRadius: 11,
        background: 'var(--app-surface)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 6, cursor: 'pointer',
        color: 'var(--app-text-2)',
        position: 'relative', overflow: 'hidden',
        padding: 8,
      }}
    >
      {file ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--app-text)' }}>
          <FileVideo size={14} color="hsl(var(--primary))" />
          <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {file.name}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); onPick(null) }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--app-text-2)', display: 'flex' }}
          ><X size={12} /></button>
        </div>
      ) : (
        <>
          <Upload size={20} />
          <span style={{ fontSize: 11, textAlign: 'center', lineHeight: 1.4 }}>
            {t('video.frameDrop')}
          </span>
        </>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={onSelect}
        style={{ display: 'none' }}
      />
    </div>
  )
}

// Camera commands multiselect — pill-tags inside the trigger + a popup
// with a searchable checkbox list. Closing the popup applies the picks.
//
// Each row shows a localized label (left) and a hover tooltip with a
// one-sentence description of what the shot does. The English token
// (e.g. "Push in") is the value sent to the model in the prompt as
// `[Push in]` — see generate() below — so we keep the array as the
// source of truth and look up i18n labels/descriptions by token.
function CameraCommandMultiSelect({ selected, onChange }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [hovered, setHovered] = useState(null)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setHovered(null) }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return CAMERA_COMMANDS
    return CAMERA_COMMANDS.filter(c => {
      // Match against the English token AND the localized label so
      // searching "푸시" finds "Push in" in Korean mode.
      const label = (t(`video.cameraCommands.items.${c}`) || '').toLowerCase()
      return c.toLowerCase().includes(q) || label.includes(q)
    })
  }, [search, t])

  const toggle = (cmd) => {
    if (selected.includes(cmd)) {
      onChange(selected.filter(c => c !== cmd))
    } else {
      onChange([...selected, cmd])
    }
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--app-text-2)', display: 'block', marginBottom: 7 }}>
        {t('video.cameraCommandsTitle')}
        <span style={{ fontWeight: 400 }}> · {t('video.cameraCommandsLabel')}</span>
      </label>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: '100%', minHeight: 38,
          background: 'var(--app-surface)',
          border: '0.5px solid var(--app-border)',
          borderRadius: 10, padding: '7px 11px',
          display: 'flex', alignItems: 'center', gap: 6,
          cursor: 'pointer', textAlign: 'left', flexWrap: 'wrap',
        }}
      >
        {selected.length === 0 ? (
          <span style={{ fontSize: 12, color: 'var(--app-text-2)', flex: 1 }}>{t('video.cameraCommandsPlaceholder')}</span>
        ) : (
          selected.map(cmd => (
            <span
              key={cmd}
              style={{
                fontSize: 11, fontWeight: 500, fontFamily: 'JetBrains Mono, monospace',
                padding: '3px 7px', borderRadius: 6,
                background: 'hsl(var(--primary) / 0.12)',
                color: 'hsl(var(--primary))',
                display: 'inline-flex', alignItems: 'center', gap: 4,
              }}
            >
              [{cmd}]
              <button
                onClick={(e) => { e.stopPropagation(); toggle(cmd) }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'hsl(var(--primary))', display: 'flex', padding: 0 }}
              ><X size={10} /></button>
            </span>
          ))
        )}
        <ChevronDown size={12} color="var(--app-text-2)" style={{ flexShrink: 0, marginLeft: 'auto' }} />
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4,
          background: 'var(--app-bg, var(--app-surface))',
          border: '0.5px solid var(--app-border)',
          borderRadius: 10, zIndex: 50,
          boxShadow: '0 14px 36px rgba(0,0,0,0.45)',
          maxHeight: 320, display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ padding: 8, borderBottom: '0.5px solid var(--app-border)' }}>
            <div style={{ position: 'relative' }}>
              <Search size={12} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--app-text-2)' }} />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('video.searchCommands')}
                style={{
                  width: '100%',
                  background: 'var(--app-surface)',
                  border: '0.5px solid var(--app-border)',
                  borderRadius: 7, padding: '6px 10px 6px 28px',
                  fontSize: 11.5, color: 'var(--app-text)', outline: 'none',
                  fontFamily: 'inherit', boxSizing: 'border-box',
                }}
              />
            </div>
          </div>
          <div style={{ overflowY: 'auto', padding: 4, flex: 1, minHeight: 0 }}>
            {filtered.length === 0 && (
              <div style={{ padding: 12, fontSize: 11, color: 'var(--app-text-2)', textAlign: 'center' }}>
                {t('video.cameraCommandsNoMatches')}
              </div>
            )}
            {filtered.map(cmd => {
              const isSelected = selected.includes(cmd)
              const desc = t(`video.cameraCommands.descriptions.${cmd}`)
              const localizedLabel = t(`video.cameraCommands.items.${cmd}`)
              // Show the localized label; keep the bracketed English
              // token visible as a small tag so the user can confirm
              // what will go into the prompt.
              const showLabel = localizedLabel && localizedLabel !== cmd
              return (
                <button
                  key={cmd}
                  onClick={() => toggle(cmd)}
                  onMouseEnter={() => setHovered(cmd)}
                  onMouseLeave={() => setHovered(prev => (prev === cmd ? null : prev))}
                  title={desc || cmd}
                  style={{
                    width: '100%',
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '6px 9px', border: 'none', borderRadius: 6,
                    cursor: 'pointer', textAlign: 'left',
                    background: isSelected ? 'hsl(var(--primary) / 0.12)' : (hovered === cmd ? 'var(--app-surface)' : 'transparent'),
                    color: isSelected ? 'hsl(var(--primary))' : 'var(--app-text)',
                    fontSize: 11.5, fontWeight: 500,
                    fontFamily: 'JetBrains Mono, monospace',
                    position: 'relative',
                  }}
                >
                  <div style={{
                    width: 14, height: 14, flexShrink: 0, borderRadius: 3,
                    border: '0.5px solid var(--app-border)',
                    background: isSelected ? 'hsl(var(--primary))' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {isSelected && <Check size={10} color="#fff" strokeWidth={3} />}
                  </div>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {showLabel ? `${localizedLabel} ` : ''}
                    <span style={{ opacity: 0.65 }}>[{cmd}]</span>
                  </span>
                </button>
              )
            })}
          </div>
          {open && hovered && (
            <div style={{
              padding: '6px 9px',
              borderTop: '0.5px solid var(--app-border)',
              fontSize: 10.5, color: 'var(--app-text-2)',
              background: 'var(--app-surface)',
              flexShrink: 0,
            }}>
              <strong style={{ color: 'var(--app-text)', fontWeight: 600, fontFamily: 'JetBrains Mono, monospace' }}>
                [{hovered}]
              </strong>
              {' — '}
              {t(`video.cameraCommands.descriptions.${hovered}`) || hovered}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// 16:9 preview card. Shows gradient placeholder when no video is loaded;
// renders <video> when src is provided. Top-left badge displays the
// current resolution + duration.
function VideoPreviewCard({ resolution, duration, src, statusText }) {
  if (src) {
    return (
      <div style={{ aspectRatio: '16/9', borderRadius: 14, overflow: 'hidden', position: 'relative', background: '#000' }}>
        <video controls style={{ width: '100%', height: '100%', display: 'block' }} src={src} />
      </div>
    )
  }
  return (
    <div style={{ aspectRatio: '16/9', borderRadius: 14, overflow: 'hidden', position: 'relative', background: 'linear-gradient(135deg,#0b1e3a,#1d4ed8 60%,#7c3aed)' }}>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <button style={{
          width: 62, height: 62, borderRadius: '50%', border: 'none',
          background: 'rgba(255,255,255,0.9)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
        }}>
          <Play size={24} fill="#111" style={{ marginLeft: 3 }} />
        </button>
      </div>
      <div style={{ position: 'absolute', top: 12, left: 14, fontSize: 11, fontWeight: 600, color: '#fff', background: 'rgba(0,0,0,0.45)', padding: '3px 9px', borderRadius: 6, backdropFilter: 'blur(4px)' }}>
        {resolution} · 16:9 · {duration}s
      </div>
      {statusText && (
        <div style={{ position: 'absolute', bottom: 12, left: 14, right: 14, fontSize: 11, color: '#fff', background: 'rgba(0,0,0,0.45)', padding: '6px 10px', borderRadius: 6, backdropFilter: 'blur(4px)' }}>
          {statusText}
        </div>
      )}
    </div>
  )
}

// Static player controls — visual only. Wire up when <video> is in the
// preview card (or when we add a real controller).
function PlayerControls() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
      <button style={{ width: 34, height: 34, flexShrink: 0, borderRadius: 9, border: 'none', background: 'hsl(var(--primary))', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
        <Play size={15} fill="currentColor" style={{ marginLeft: 1 }} />
      </button>
      <span style={{ fontSize: 11.5, color: 'var(--app-text-2)', fontVariantNumeric: 'tabular-nums' }}>0:00</span>
      <div style={{ flex: 1, height: 5, borderRadius: 3, background: 'var(--app-surface)', position: 'relative' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: 0, borderRadius: 3, background: 'hsl(var(--primary))' }} />
      </div>
      <span style={{ fontSize: 11.5, color: 'var(--app-text-2)', fontVariantNumeric: 'tabular-nums' }}>0:00</span>
      <button style={{ width: 34, height: 34, flexShrink: 0, borderRadius: 9, border: '0.5px solid var(--app-border)', background: 'transparent', color: 'var(--app-text)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
        <Download size={15} />
      </button>
    </div>
  )
}

// Render queue — visual skeleton only. Backend doesn't track multiple
// in-flight tasks yet, so this is a placeholder showing the layout.
function RenderQueueSkeleton() {
  const { t } = useTranslation()
  return (
    <div style={{ marginTop: 26 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--app-text-2)', marginBottom: 12 }}>{t('video.renderQueue')}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 13, padding: 12, border: '1px solid hsl(var(--primary) / 0.35)', borderRadius: 11, background: 'hsl(var(--primary) / 0.06)', marginBottom: 10 }}>
        <div style={{ width: 64, height: 40, flexShrink: 0, borderRadius: 7, background: 'linear-gradient(135deg,#3b0764,#a855f7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <RefreshCw size={16} color="#fff" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--app-text-2)' }}>
            {t('video.renderPreview')}
          </div>
          <div style={{ marginTop: 7, height: 5, borderRadius: 3, background: 'var(--app-surface)', overflow: 'hidden' }}>
            <div style={{ width: '0%', height: '100%', background: 'hsl(var(--primary))' }} />
          </div>
        </div>
        <span style={{ fontSize: 11, color: 'hsl(var(--primary))', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>—</span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--app-text-2)', padding: '14px 12px', textAlign: 'center', border: '1px dashed var(--app-border)', borderRadius: 11, lineHeight: 1.5 }}>
        {t('video.renderQueueNotice')}
        <br />
        <span style={{ opacity: 0.7 }}>{t('video.renderQueueHint')}</span>
      </div>
    </div>
  )
}

// "History" + recent generations — same as the mockup's old fallback but
// tucked below the render queue. We use the existing RecentGenerations
// component for the list, since the user can't test new videos here.
function VideoHistory({ history, historyLoading, onRefresh, onShowMeta }) {
  const { t } = useTranslation()
  return (
    <div style={{ marginTop: 26 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--app-text-2)' }}>{t('video.historyTitle')}</span>
        <button
          onClick={onRefresh}
          disabled={historyLoading}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--app-text-2)', display: 'flex', padding: 2 }}
          title={t('video.refresh')}
        >
          <RefreshCw size={12} className={historyLoading ? 'animate-spin' : ''} />
        </button>
      </div>
      {history.length === 0 ? (
        <div style={{ fontSize: 11, color: 'var(--app-text-2)', padding: '14px 12px', textAlign: 'center', border: '1px dashed var(--app-border)', borderRadius: 11 }}>
          {t('video.empty')}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
          {history.slice(0, 6).map(item => (
            <div key={item.path} style={{ position: 'relative' }}>
              <a
                href={assetUrl(`/api/files/content?path=${encodeURIComponent(item.path)}`)}
                target="_blank"
                rel="noreferrer"
                style={{ aspectRatio: '16/9', borderRadius: 10, border: '0.5px solid var(--app-border)', background: 'linear-gradient(135deg,#0b1e3a,#1d4ed8 60%,#7c3aed)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}
              >
                <Play size={20} fill="rgba(255,255,255,0.92)" />
                <span style={{ position: 'absolute', bottom: 6, right: 8, fontSize: 10, color: '#fff', background: 'rgba(0,0,0,0.5)', padding: '1px 6px', borderRadius: 5 }}>
                  {item.name.replace(/^video_/, '').slice(0, 8)}
                </span>
              </a>
              {onShowMeta && (
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); onShowMeta(item) }}
                  disabled={!item.meta}
                  style={{
                    position: 'absolute', top: 6, left: 6,
                    background: item.meta ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.35)',
                    color: item.meta ? '#000' : 'rgba(0,0,0,0.4)',
                    border: 'none', borderRadius: 6, padding: 4, cursor: item.meta ? 'pointer' : 'not-allowed',
                  }}
                  title={item.meta ? t('generationMeta.showMeta', { defaultValue: 'View prompt & settings' }) : t('generationMeta.noMeta', { defaultValue: 'No saved metadata' })}
                  aria-label={item.meta ? t('generationMeta.showMeta', { defaultValue: 'View prompt & settings' }) : t('generationMeta.noMeta', { defaultValue: 'No saved metadata' })}
                >
                  <Info size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// Main component
// ───────────────────────────────────────────────────────────────────────────

export default function VideoPanel() {
  const { t } = useTranslation()

  // Mode
  const [mode, setMode] = useState('text2video')
  const modeConfig = VIDEO_MODES.find(m => m.id === mode)

  // Form state — new visual fields (NOT yet wired to backend)
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState('MiniMax-Hailuo-2.3')
  const [duration, setDuration] = useState('6')
  const [resolution, setResolution] = useState('1080P')
  // Currently-open GenerationMetaModal item (null = closed).
  const [metaItem, setMetaItem] = useState(null)
  const [promptOptimizer, setPromptOptimizer] = useState(false)
  const [cameraCommands, setCameraCommands] = useState([])

  // Frame files (per mode)
  const [firstFrame, setFirstFrame] = useState(null)
  const [lastFrame, setLastFrame] = useState(null)
  const [subjectImage, setSubjectImage] = useState(null)
  // Attached anchors — their images are sent as subject_reference[] data
  // URLs in generate(), giving the model character/subject visual
  // references for cross-generation consistency.
  const [attachedAnchors, setAttachedAnchors] = useState([])
  // Snapshot of the params sent to /api/video on the most recent
  // generate() call. Replayed as the meta payload on /api/video/download
  // so the backend can write the prompt+params sidecar next to the mp4.
  // Captured at generate() time (not read from form state at download
  // time) so the sidecar reflects exactly what was sent, even if the
  // user edits the form while the video is rendering.
  const [lastGenerationMeta, setLastGenerationMeta] = useState(null)

  // Generation state (existing)
  const [loading, setLoading] = useState(false)
  const [taskId, setTaskId] = useState(null)
  const [status, setStatus] = useState(null)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState(null)
  const [cost, setCost] = useState(null)
  const [videoDailyLimit, setVideoDailyLimit] = useState(null)
  const [videoDailyUsed, setVideoDailyUsed] = useState(null)
  const [error, setError] = useState(null)
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const frames = MODE_FRAMES[mode] || MODE_FRAMES.text2video

  const { register } = useSessionProtection()

  useEffect(() => {
    register('video-loading', loading || !!taskId, t('video.sessionInProgress', { defaultValue: 'Video generation in progress' }))
  }, [loading, taskId, register, t])

  useEffect(() => {
    register('video-prompt', prompt.trim().length > 0, t('video.unsavedPrompt', { defaultValue: 'Unsaved video prompt' }))
  }, [prompt, register, t])

  const fetchHistory = async () => {
    setHistoryLoading(true)
    try {
      const res = await apiFetch('/api/generations')
      const data = await res.json()
      let videos = []
      if (data.success) videos = data.data.videos || []
      const wsRes = await apiFetch('/api/files?path=workspace')
      const wsData = await wsRes.json()
      if (wsData.entries) {
        const wsVideos = wsData.entries
          .filter(e => !e.is_dir && /\.(mp4|mov|webm)$/i.test(e.name))
          .filter(e => /^(video_|generated_video)/i.test(e.name))
          .map(e => ({ name: e.name, path: e.path, size: 0 }))
        const seen = new Set(videos.map(i => i.path))
        wsVideos.forEach(v => { if (!seen.has(v.path)) videos.push(v) })
      }
      videos.sort((a, b) => {
        if (a.modified_at && b.modified_at) return b.modified_at.localeCompare(a.modified_at)
        return b.name.localeCompare(a.name)
      })
      setHistory(videos)
    } catch { /* ignore */ }
    setHistoryLoading(false)
  }

  const fetchDailyQuota = async () => {
    try {
      const res = await apiFetch('/api/minimax/quota')
      if (!res.ok) return
      const data = await res.json()
      const payload = data?.data ?? data
      if (typeof payload?.video_daily_limit === 'number') setVideoDailyLimit(payload.video_daily_limit)
      if (typeof payload?.video_daily_used === 'number') setVideoDailyUsed(payload.video_daily_used)
    } catch { /* ignore */ }
  }

  useEffect(() => {
    fetchHistory()
    fetchDailyQuota()
  }, [])

  useEffect(() => {
    const onMedia = () => fetchDailyQuota()
    window.addEventListener('minimax:media-complete', onMedia)
    return () => window.removeEventListener('minimax:media-complete', onMedia)
  }, [])

  // Read a File object as a base64 data URL — used to send image frames
  // to the backend without a separate upload step. The API accepts
  // data URLs for first_frame_image / last_frame_image / subject_reference.
  const readFileAsDataURL = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })

  // Generate video via the /api/video endpoint (direct API, no CLI
  // subprocess). Frame files are inlined as data URLs; the backend
  // forwards them to the underlying video_generation call. Camera
  // commands are appended to the prompt as `[Push in]` etc.
  const generate = async () => {
    if (!prompt.trim()) return
    setLoading(true)
    setError(null)
    setResult(null)
    setCost(null)
    setProgress(0)
    try {
      // Build effective prompt: user text + camera commands as `[Push in]` etc.
      const cmdText = cameraCommands.length
        ? ` ${cameraCommands.map(c => `[${c}]`).join(', ')}`
        : ''
      const effectivePrompt = prompt + cmdText

      // Resolve image references.
      //   - Attached anchors → subject_reference[] (character/subject
      //     visual consistency across the generated video). The MiniMax
      //     API needs data URLs, so each anchor image is fetched via
      //     /api/files/raw and converted.
      //   - Manual dropzones (firstFrame / lastFrame / subjectImage) work
      //     independently for the image2video / sef / s2v modes. When
      //     anchors are attached they take precedence over the manual
      //     subject dropzone.
      const anchorDataUrls = []
      for (const a of attachedAnchors) {
        const d = await anchorToDataUrl(a, assetUrl)
        if (d) anchorDataUrls.push(d)
      }
      const manualFirstFrame = firstFrame ? await readFileAsDataURL(firstFrame) : ''
      const manualLastFrame  = lastFrame  ? await readFileAsDataURL(lastFrame)  : ''
      const manualSubject    = subjectImage ? [await readFileAsDataURL(subjectImage)] : null

      const subjectData = anchorDataUrls.length > 0 ? anchorDataUrls : manualSubject
      // Snapshot the params as-sent so the download call can attach
      // them as the sidecar meta. effectivePrompt (with camera commands
      // appended) is what the model actually saw; the raw user prompt is
      // recorded separately. Manual frame uploads aren't persisted as
      // anchor IDs, so they're recorded as null — re-upload to reproduce.
      setLastGenerationMeta({
        media_type: 'video',
        prompt: effectivePrompt,
        user_prompt: prompt,
        model,
        params: {
          duration: parseInt(duration, 10),
          resolution,
          prompt_optimizer: promptOptimizer,
          mode: deriveVideoMode({
            firstFrame: manualFirstFrame,
            lastFrame: manualLastFrame,
            subject_reference: subjectData,
          }),
        },
        references: {
          first_frame_image: null,
          last_frame_image: null,
          subject_reference: (attachedAnchors || []).map(a => a.id),
        },
      })

      const res = await apiFetch('/api/video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: effectivePrompt,
          model,
          settings: {
            model,
            duration: parseInt(duration, 10),
            resolution,
            prompt_optimizer: promptOptimizer,
            first_frame_image: manualFirstFrame,
            last_frame_image: manualLastFrame,
            subject_reference: subjectData,
          },
        }),
      })
      const data = await res.json()
      if (data.success && data.task_id) {
        setTaskId(data.task_id)
        setStatus(t('video.taskCreated'))
        if (typeof data.cost_credits === 'number' || typeof data.cost_usd === 'number') {
          setCost({ cost_credits: data.cost_credits, cost_usd: data.cost_usd })
        }
        if (typeof videoDailyUsed === 'number') setVideoDailyUsed(videoDailyUsed + 1)
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('minimax:media-complete'))
        }
      } else {
        setError(data.error || data.detail || t('video.failed'))
        setLoading(false)
      }
    } catch (e) {
      setError(e.message)
      setLoading(false)
    }
  }

  // Poll /api/video/{task_id} for status. When Success, fetch the
  // file via /api/video/download and set the local path.
  useEffect(() => {
    if (!taskId) return
    const interval = setInterval(async () => {
      try {
        const res = await apiFetch(`/api/video/${taskId}`)
        const data = await res.json()
        if (data.success && data.data) {
          const taskStatus = data.data.status
          const fileId = data.data.file_id
          if (taskStatus === 'Success' || taskStatus === ' success') {
            setStatus(t('video.videoReady'))
            setProgress(100)
            setLoading(false)
            if (fileId) {
              const dlRes = await apiFetch('/api/video/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ file_id: fileId, meta: lastGenerationMeta }),
              })
              const dlData = await dlRes.json()
              if (dlData.success && dlData.path) {
                setResult(dlData.path)
                fetchHistory()
                fetchDailyQuota()
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(new CustomEvent('minimax:media-complete'))
                }
              } else {
                setError(dlData.error || t('video.downloadFailed'))
              }
            }
            clearInterval(interval)
          } else if (taskStatus === 'Failed' || taskStatus === 'failed') {
            setError(t('video.failed'))
            setLoading(false)
            clearInterval(interval)
          } else {
            setStatus(`${t('video.statusPrefix')}${taskStatus || t('video.processing')}...`)
            setProgress(prev => Math.min(prev + 10, 90))
          }
        }
      } catch (e) {
        setError(e.message)
        setLoading(false)
        clearInterval(interval)
      }
    }, 8000)
    return () => clearInterval(interval)
  }, [taskId])

  // ── Top bar (full-width) — icon + dynamic title + ModeTabBar ─────────

  const topBar = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
        <div style={{
          width: 34, height: 34, flexShrink: 0, borderRadius: 9,
          background: 'hsl(var(--primary) / 0.14)',
          color: 'hsl(var(--primary))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Video size={18} strokeWidth={2} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontSize: 15, fontWeight: 600, color: 'var(--app-text)',
            whiteSpace: 'nowrap',
          }}>
            {t('video.title')}
          </div>
          <div style={{
            fontSize: 11.5, color: 'var(--app-text-2)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {t(modeConfig.titleKey)} · {t('video.upTo1080P')}
          </div>
        </div>
      </div>
      <div style={{ flexShrink: 0 }}>
        <ModeTabBar modes={VIDEO_MODES} active={mode} onChange={setMode} />
      </div>
    </div>
  )

  // ── Controls (left column) — mockup L489-565 ───────────────────────────

  const controls = (
    <>
      {/* Anchor library — reusable image cards that provide character/subject
          visual references for cross-generation consistency. Attached anchors
          are sent as subject_reference[] data URLs in generate(). */}
      <AnchorLibrary
        attachedAnchors={attachedAnchors}
        onAttachedChange={setAttachedAnchors}
      />

      {/* Active anchor attachment summary — compact chips showing what's
          referenced for this generation. Hidden when nothing is attached. */}
      {attachedAnchors.length > 0 && (
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 5,
          padding: '6px 8px',
          background: 'hsl(var(--primary) / 0.05)',
          border: '0.5px solid hsl(var(--primary) / 0.2)',
          borderRadius: 9,
        }}>
          {attachedAnchors.map(a => (
            <span key={a.id} style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: 10.5, fontWeight: 500, color: 'hsl(var(--primary))',
            }}>
              <User size={10} /> {a.name}
            </span>
          ))}
        </div>
      )}

      {/* Frame inputs — mockup L489-506
          For image2video: 1 dropzone (first)
          For sef: 2 dropzones side by side (first + last)
          For s2v: 1 dropzone (subject)
          For text2video: nothing */}
      {frames.start && frames.end && (
        <div>
          <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--app-text-2)', display: 'block', marginBottom: 7 }}>
            {t('video.framesLabel')}
          </label>
          <div style={{ display: 'flex', gap: 10 }}>
            <FrameDropzone file={firstFrame} onPick={setFirstFrame} t={t} />
            <FrameDropzone file={lastFrame}  onPick={setLastFrame}  t={t} />
          </div>
        </div>
      )}
      {frames.start && !frames.end && (
        <div>
          <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--app-text-2)', display: 'block', marginBottom: 7 }}>
            {t('video.firstFrame')}
          </label>
          <FrameDropzone file={firstFrame} onPick={setFirstFrame} t={t} />
        </div>
      )}
      {frames.subject && (
        <div>
          <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--app-text-2)', display: 'block', marginBottom: 7 }}>
            {t('video.subjectReference')}
          </label>
          {attachedAnchors.length > 0 ? (
            <div style={{
              minHeight: 96, borderRadius: 11,
              border: '1.5px solid hsl(var(--primary) / 0.5)',
              background: 'hsl(var(--primary) / 0.06)',
              display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '8px 12px',
              fontSize: 11, color: 'hsl(var(--primary))',
            }}>
              <Check size={14} strokeWidth={2.5} />
              <span>{t('anchor.lockedByAnchors', { defaultValue: 'Referenced by anchor(s)' })}: <strong>{attachedAnchors.map(a => a.name).join(', ')}</strong></span>
            </div>
          ) : (
            <FrameDropzone file={subjectImage} onPick={setSubjectImage} t={t} />
          )}
        </div>
      )}

      {/* Prompt — mockup L508-515 */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
          <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--app-text-2)' }}>{t('video.promptLabel')}</label>
          <span style={{
            fontSize: 11, color: prompt.length > 2000 ? 'hsl(var(--error))' : 'var(--app-text-2)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {prompt.length} / 2000
          </span>
        </div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t('video.promptPlaceholder')}
          rows={4}
          style={{
            width: '100%',
            background: 'var(--app-surface)',
            border: '0.5px solid var(--app-border)',
            borderRadius: 10, padding: '11px 13px',
            fontSize: 13, lineHeight: 1.6, color: 'var(--app-text)',
            resize: 'none', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none',
            minHeight: 88,
          }}
        />
      </div>

      {/* Camera commands — multiselect (replaces inline chips) */}
      <CameraCommandMultiSelect selected={cameraCommands} onChange={setCameraCommands} />

      {/* Model — single dropdown — mockup L530-534 */}
      <div>
        <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--app-text-2)', display: 'block', marginBottom: 7 }}>
          {t('video.modelLabel')}
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
            {VIDEO_MODELS.map(m => <option key={m.id} value={m.id}>{t(m.labelKey)}</option>)}
          </select>
          <ChevronDown size={12} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--app-text-2)' }} />
        </div>
      </div>

      {/* Duration — mockup L536-543 */}
      <div>
        <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--app-text-2)', display: 'block', marginBottom: 7 }}>
          {t('video.durationLabel')}
        </label>
        <div style={{ display: 'flex', gap: 7 }}>
          {DURATIONS.map(d => {
            const active = duration === d.id
            return (
              <button
                key={d.id}
                onClick={() => setDuration(d.id)}
                style={{
                  flex: 1, height: 34, borderRadius: 8,
                  border: '1px solid',
                  borderColor: active ? 'hsl(var(--primary))' : 'var(--app-border)',
                  background: active ? 'hsl(var(--primary) / 0.1)' : 'transparent',
                  color: active ? 'hsl(var(--primary))' : 'var(--app-text-2)',
                  fontSize: 12, fontWeight: active ? 600 : 500,
                  cursor: 'pointer', transition: 'all 0.15s',
                }}
              >{t(d.labelKey)}</button>
            )
          })}
        </div>
      </div>

      {/* Resolution — mockup L545-552 */}
      <div>
        <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--app-text-2)', display: 'block', marginBottom: 7 }}>
          {t('video.resolutionLabel')}
        </label>
        <div style={{ display: 'flex', gap: 7 }}>
          {RESOLUTIONS.map(r => {
            const active = resolution === r.id
            return (
              <button
                key={r.id}
                onClick={() => setResolution(r.id)}
                style={{
                  flex: 1, height: 34, borderRadius: 8,
                  border: '1px solid',
                  borderColor: active ? 'hsl(var(--primary))' : 'var(--app-border)',
                  background: active ? 'hsl(var(--primary) / 0.1)' : 'transparent',
                  color: active ? 'hsl(var(--primary))' : 'var(--app-text-2)',
                  fontSize: 12, fontWeight: active ? 600 : 500,
                  cursor: 'pointer', transition: 'all 0.15s',
                }}
              >{t(r.labelKey)}</button>
            )
          })}
        </div>
      </div>

      {/* Prompt optimizer — mockup L554-558 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--app-text)' }}>{t('video.promptOptimizer')}</div>
          <div style={{ fontSize: 11, color: 'var(--app-text-2)' }}>{t('video.promptOptimizerHint')}</div>
        </div>
        <Toggle checked={promptOptimizer} onChange={setPromptOptimizer} />
      </div>

      {/* Cost + quota — same as before, shown only when known */}
      {(cost || (videoDailyLimit !== null && videoDailyLimit !== undefined)) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {cost && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '3px 10px', borderRadius: 999,
              background: 'hsl(var(--primary) / 0.05)',
              border: '0.5px solid hsl(var(--primary) / 0.2)',
              fontSize: 10.5, fontWeight: 500, color: 'hsl(var(--primary))',
            }}>
              <Coins size={11} />
              <span>
                {t('media.costLabel', {
                  credits: cost.cost_credits ?? 0,
                  usd: typeof cost.cost_usd === 'number' ? cost.cost_usd.toFixed(4) : '0.0000',
                })}
              </span>
            </div>
          )}
          {videoDailyLimit !== null && videoDailyLimit !== undefined && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '3px 10px', borderRadius: 999,
              background: (videoDailyUsed ?? 0) >= videoDailyLimit
                ? 'hsl(var(--error) / 0.1)'
                : (videoDailyUsed ?? 0) / Math.max(videoDailyLimit, 1) >= 0.8
                  ? 'hsl(43 96% 56% / 0.1)'
                  : 'var(--app-surface)',
              border: '0.5px solid var(--app-border)',
              fontSize: 10.5, fontWeight: 500,
              color: (videoDailyUsed ?? 0) >= videoDailyLimit
                ? 'hsl(var(--error))'
                : (videoDailyUsed ?? 0) / Math.max(videoDailyLimit, 1) >= 0.8
                  ? 'hsl(43 96% 46%)'
                  : 'var(--app-text-2)',
            }}>
              {(videoDailyUsed ?? 0) >= videoDailyLimit && <AlertTriangle size={10} />}
              <span>{t('media.dailyLabel', { used: videoDailyUsed ?? 0, limit: videoDailyLimit })}</span>
            </div>
          )}
        </div>
      )}

      {error && (
        <div style={{
          background: 'hsl(var(--error) / 0.1)',
          border: '0.5px solid hsl(var(--error) / 0.2)',
          borderRadius: 9, padding: '8px 12px',
          fontSize: 11, color: 'hsl(var(--error))',
        }}>{error}</div>
      )}

      <button
        onClick={generate}
        disabled={loading || !prompt.trim()}
        style={{
          marginTop: 'auto',
          width: '100%', height: 42, padding: '0 11px',
          background: 'hsl(var(--primary))',
          color: '#fff', border: 'none', borderRadius: 11,
          fontSize: 13.5, fontWeight: 600,
          cursor: loading ? 'wait' : 'pointer',
          opacity: (loading || !prompt.trim()) ? 0.4 : 1,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}
      >
        {loading
          ? <><Loader2 size={14} className="animate-spin" /> {t('video.submitting')}</>
          : <><Video size={16} /> {t('video.generate')}</>}
      </button>
    </>
  )

  // ── Canvas (right column) ──────────────────────────────────────────────
  // Per user feedback: no 16:9 preview placeholder, no player controls
  // — those are visual noise when generation can't be tested. Just show
  // the render queue skeleton and the history grid (real data).

  const canvas = (
    <div style={{ display: 'flex', flexDirection: 'column', maxWidth: 720, width: '100%', margin: '0 auto' }}>
      {/* Render queue — visual skeleton, backend tracking comes next round */}
      <RenderQueueSkeleton />

      {/* History — generated videos list (real data, replaces old placement) */}
      <VideoHistory
        history={history}
        historyLoading={historyLoading}
        onRefresh={fetchHistory}
        onShowMeta={setMetaItem}
      />
    </div>
  )

  return (
    <>
      <MediaPanelLayout
        controlsWidth={400}
        topBar={topBar}
        controls={controls}
        canvas={canvas}
      />
      {metaItem && (
        <GenerationMetaModal item={metaItem} onClose={() => setMetaItem(null)} />
      )}
    </>
  )
}
