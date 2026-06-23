import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Image as ImageIcon, Loader2, Sparkles,
  Upload, X, Dice5, Plus, Minus,
} from 'lucide-react'
import { useSessionProtection } from '../../hooks/useSessionProtection'
import MediaPanelLayout from '../shared/MediaPanelLayout'
import ModeTabBar from '../shared/ModeTabBar'
import GalleryHeader from '../shared/GalleryHeader'
import ShapePreview from '../shared/ShapePreview'
import RecentGenerations from './RecentGenerations'
import { apiFetch } from '../../lib/api.js'

// ── Aspect ratios — match MiniMax `image-01` official resolutions (mockup L182-189)
const ASPECT_RATIOS = [
  { label: 'Square',      value: '1:1',  shapeW: 22, shapeH: 22, res: '1024 × 1024' },
  { label: 'Widescreen',  value: '16:9', shapeW: 26, shapeH: 15, res: '1280 × 720'  },
  { label: 'Vertical',    value: '9:16', shapeW: 15, shapeH: 26, res: '720 × 1280'  },
  { label: 'Standard',    value: '4:3',  shapeW: 24, shapeH: 18, res: '1152 × 864'  },
  { label: 'Portrait',    value: '3:4',  shapeW: 18, shapeH: 24, res: '864 × 1152'  },
  { label: 'Photo',       value: '3:2',  shapeW: 26, shapeH: 17, res: '1248 × 832'  },
  { label: 'Photo tall',  value: '2:3',  shapeW: 17, shapeH: 26, res: '832 × 1248'  },
  { label: 'Cinematic',   value: '21:9', shapeW: 28, shapeH: 12, res: '1344 × 576'  },
]

// ── Sub-modes — both hit the same endpoint, model swaps automatically.
// `image-01`      → T2I (text prompt only)
// `image-01-live` → i2i via `subject_reference` (character/face photo)
// `label` is the pill text. `title` shows up in the top-bar subtitle
// with the active model name so the user always knows what's being called.
const IMAGE_MODES = [
  { id: 'text',    label: 'Text to image',  title: 'Text to image',  model: 'image-01'      },
  { id: 'subject', label: 'Image to image', title: 'Image to image', model: 'image-01-live' },
]

const PROMPT_MAX = 1500   // image_generation prompt cap (mockup §6)
const N_MIN = 1
const N_MAX = 9           // n range per image_generation spec

const labelStyle = {
  fontSize: 11.5,
  fontWeight: 600,
  color: 'var(--app-text-2)',
  display: 'block',
  marginBottom: 7,
}

// Character / subject dropzone — same UX as VideoPanel's FrameDropzone but
// tuned for a single image-01-live subject reference. Click or drag/drop.
function SubjectDropzone({ file, onPick }) {
  const inputRef = useRef(null)
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
        width: '100%', height: 96,
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
          <ImageIcon size={14} color="hsl(var(--primary))" />
          <span style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {file.name}
          </span>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onPick(null) }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--app-text-2)', display: 'flex' }}
            aria-label="Remove reference image"
          ><X size={12} /></button>
        </div>
      ) : (
        <>
          <Upload size={20} />
          <span style={{ fontSize: 11, textAlign: 'center', lineHeight: 1.4 }}>
            Drop a character photo or <span style={{ color: 'hsl(var(--primary))' }}>browse</span>
          </span>
          <span style={{ fontSize: 10, color: 'var(--app-text-2)', opacity: 0.7 }}>
            Keeps the same face across generations
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

export default function ImagePanel() {
  const { t } = useTranslation()
  const [mode, setMode] = useState('text')
  const [prompt, setPrompt] = useState('')
  const [aspectRatio, setAspectRatio] = useState('1:1')
  const [aspectOpen, setAspectOpen] = useState(false)
  const aspectRef = useRef(null)
  const [batchCount, setBatchCount] = useState(1)
  const [seed, setSeed] = useState('')
  const [referenceImage, setReferenceImage] = useState(null)
  const [promptOptimizer, setPromptOptimizer] = useState(false)
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState([])
  const [error, setError] = useState(null)
  const [gallery, setGallery] = useState([])
  const [galleryLoading, setGalleryLoading] = useState(false)

  const { register } = useSessionProtection()

  useEffect(() => {
    register('image-loading', loading, t('image.title'))
  }, [loading, register, t])

  useEffect(() => {
    register('image-prompt', prompt.trim().length > 0, t('image.prompt'))
  }, [prompt, register, t])

  useEffect(() => { fetchGallery() }, [])

  // Close aspect dropdown on outside click / Escape (mockup L416-429 menu).
  useEffect(() => {
    if (!aspectOpen) return
    const onDown = (e) => {
      if (aspectRef.current && !aspectRef.current.contains(e.target)) {
        setAspectOpen(false)
      }
    }
    const onKey = (e) => { if (e.key === 'Escape') setAspectOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [aspectOpen])

  const fetchGallery = async () => {
    setGalleryLoading(true)
    try {
      const genRes = await apiFetch('/api/generations')
      const genData = await genRes.json()
      let images = []
      if (genData.success && genData.data?.images) {
        images = genData.data.images
      }

      const wsRes = await apiFetch('/api/files?path=workspace')
      const wsData = await wsRes.json()
      if (wsData.entries) {
        const wsImages = wsData.entries
          .filter(e => !e.is_dir && /\.(png|jpg|jpeg|webp|gif)$/i.test(e.name))
          .filter(e => /^(image_|generated_image)/i.test(e.name))
          .map(e => ({ name: e.name, path: e.path, size: 0 }))
        const seen = new Set(images.map(i => i.path))
        wsImages.forEach(img => { if (!seen.has(img.path)) images.push(img) })
      }

      images.sort((a, b) => {
        if (a.modified_at && b.modified_at) return b.modified_at.localeCompare(a.modified_at)
        return b.name.localeCompare(a.name)
      })

      setGallery(images)
    } catch (e) { /* ignore */ }
    setGalleryLoading(false)
  }

  // Read a File as a base64 data URL — same approach used by VideoPanel.
  // The MiniMax image_generation endpoint accepts data URLs inside
  // subject_reference[].image_file, so no separate upload step needed.
  const readFileAsDataURL = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })

  const generate = async () => {
    if (!prompt.trim()) return
    if (mode === 'subject' && !referenceImage) {
      setError('Pick a character reference image first.')
      return
    }
    setLoading(true)
    setError(null)
    setResults([])
    try {
      const modeConfig = IMAGE_MODES.find((m) => m.id === mode)
      const body = {
        prompt,
        aspect_ratio: aspectRatio,
        n: batchCount,
        prompt_optimizer: promptOptimizer,
        model: modeConfig.model,
      }

      // Seed — empty means "random per request" (matches §6 spec:
      // "OMIT for a random seed each image"). Only send when parseable.
      const trimmedSeed = seed.trim()
      if (trimmedSeed) {
        const parsed = parseInt(trimmedSeed, 10)
        if (!Number.isNaN(parsed)) body.seed = parsed
      }

      // Subject reference — i2i mode inlines the picked image as a
      // data URL so the backend can pass it straight to MiniMax's
      // `/v1/image_generation` subject_reference[].image_file.
      if (mode === 'subject' && referenceImage) {
        const dataUrl = await readFileAsDataURL(referenceImage)
        body.subject_reference = [{ type: 'character', image_file: dataUrl }]
      }

      const res = await fetch('/api/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.success) {
        setResults([{ path: data.file_path }])
        fetchGallery()
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('minimax:media-complete'))
        }
      } else {
        setError(data.error || t('image.failed'))
      }
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }

  const curAspect = ASPECT_RATIOS.find((a) => a.value === aspectRatio) || ASPECT_RATIOS[0]
  const modeConfig = IMAGE_MODES.find((m) => m.id === mode)

  const decN = () => setBatchCount((n) => Math.max(N_MIN, n - 1))
  const incN = () => setBatchCount((n) => Math.min(N_MAX, n + 1))
  const randomSeed = () =>
    setSeed(String(Math.floor(Math.random() * 1_000_000_000)))

  // ──── topBar (full-width above both columns) ─────────────────────────
  // Mirrors VideoPanel: icon + dynamic title/subtitle on the left,
  // ModeTabBar pills on the right. The subtitle reflects the active
  // mode so the user always sees which model is about to be called.
  const topBar = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
        <div style={{
          width: 34, height: 34, flexShrink: 0, borderRadius: 9,
          background: 'hsl(var(--primary) / 0.14)',
          color: 'hsl(var(--primary))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <ImageIcon size={18} strokeWidth={2} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontSize: 15, fontWeight: 600, color: 'var(--app-text)',
            whiteSpace: 'nowrap',
          }}>
            {t('image.title')}
          </div>
          <div style={{
            fontSize: 11.5, color: 'var(--app-text-2)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {modeConfig.title} · {modeConfig.model}
          </div>
        </div>
      </div>
      <div style={{ flexShrink: 0 }}>
        <ModeTabBar modes={IMAGE_MODES} active={mode} onChange={setMode} />
      </div>
    </div>
  )

  // ──── galleryHeader (52px above canvas) ─────────────────────────────
  const galleryHeader = (
    <GalleryHeader
      title={t('image.recentGenerations')}
      subtitle="Saved to workspace/generations/images/"
    />
  )

  // ──── controls (left column body) ───────────────────────────────────
  const controls = (
    <>
      {/* (a) Character reference — i2i mode only.
          The dropzone reuses the VideoPanel FrameDropzone UX
          (click-or-drag, 96px, dashed border, filename chip with X). */}
      {mode === 'subject' && (
        <div>
          <label style={labelStyle}>
            Character reference
            <span style={{ fontWeight: 400, color: 'var(--app-text-2)' }}> · single face</span>
          </label>
          <SubjectDropzone file={referenceImage} onPick={setReferenceImage} />
        </div>
      )}

      {/* (b) Prompt + counter (mockup L404-407 + counter on the right) */}
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 7 }}>
          <label style={{ ...labelStyle, marginBottom: 0 }}>{t('image.prompt')}</label>
          <span style={{
            fontSize: 10.5,
            color: prompt.length > PROMPT_MAX * 0.9 ? 'hsl(var(--primary))' : 'var(--app-text-2)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {prompt.length} / {PROMPT_MAX}
          </span>
        </div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value.slice(0, PROMPT_MAX))}
          placeholder={t('image.promptPlaceholder')}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            minHeight: 96,
            background: 'hsl(var(--card))',
            border: '1px solid var(--app-border-2)',
            borderRadius: 10,
            padding: '11px 13px',
            fontSize: 13,
            color: 'var(--app-text)',
            fontFamily: 'inherit',
            lineHeight: 1.5,
            resize: 'none',
            outline: 'none',
          }}
        />
      </div>

      {/* (c) Aspect ratio — unchanged */}
      <div ref={aspectRef} style={{ position: 'relative' }}>
        <label style={labelStyle}>{t('image.aspectRatio')}</label>
        <button
          type="button"
          onClick={() => setAspectOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={aspectOpen}
          style={{
            width: '100%',
            height: 46,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '0 13px',
            background: 'hsl(var(--card))',
            border: '1px solid var(--app-border-2)',
            borderRadius: 10,
            cursor: 'pointer',
            color: 'var(--app-text)',
            outline: 'none',
          }}
        >
          <span style={{ width: 26, height: 26, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ShapePreview
              width={curAspect.shapeW}
              height={Math.round(curAspect.shapeH * 0.9)}
              active
            />
          </span>
          <span style={{ flex: 1, textAlign: 'left', fontSize: 13, fontWeight: 600 }}>
            {curAspect.value}
          </span>
          <span style={{ fontSize: 11.5, color: 'var(--app-text-2)', fontVariantNumeric: 'tabular-nums' }}>
            {curAspect.res}
          </span>
        </button>

        {aspectOpen && (
          <div
            role="listbox"
            style={{
              position: 'absolute',
              top: 74,
              left: 0,
              right: 0,
              zIndex: 50,
              maxHeight: 280,
              overflowY: 'auto',
              padding: 6,
              borderRadius: 11,
              background: 'hsl(var(--card))',
              border: '1px solid var(--app-border-2)',
              boxShadow: '0 16px 40px rgba(0, 0, 0, 0.45)',
            }}
          >
            {ASPECT_RATIOS.map((ar) => {
              const active = aspectRatio === ar.value
              return (
                <button
                  key={ar.value}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => { setAspectRatio(ar.value); setAspectOpen(false) }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    width: '100%',
                    padding: '9px 11px',
                    borderRadius: 9,
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--app-text)',
                    background: active ? 'hsl(var(--primary) / 0.1)' : 'transparent',
                    textAlign: 'left',
                  }}
                >
                  <span style={{ width: 30, height: 30, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <ShapePreview width={ar.shapeW} height={ar.shapeH} active={active} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600 }}>
                      {ar.value}
                      <span style={{ fontWeight: 400, color: 'var(--app-text-2)' }}> · {ar.label}</span>
                    </span>
                    <div style={{ fontSize: 11, color: 'var(--app-text-2)', fontVariantNumeric: 'tabular-nums' }}>
                      {ar.res}
                    </div>
                  </span>
                  {active && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="hsl(var(--primary))" strokeWidth="2.4" aria-hidden="true">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* (d) n stepper (mockup L455-459).
          Replaces the old 4-pill row with a compact − / value / + that
          clamps to the 1-9 range the image_generation endpoint accepts. */}
      <div>
        <label style={labelStyle}>Images · n</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            onClick={decN}
            disabled={batchCount <= N_MIN}
            aria-label="Decrease n"
            style={{
              width: 32, height: 32,
              borderRadius: 8,
              border: '0.5px solid var(--app-border)',
              background: 'var(--app-surface)',
              color: batchCount <= N_MIN ? 'var(--app-text-2)' : 'var(--app-text)',
              cursor: batchCount <= N_MIN ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              opacity: batchCount <= N_MIN ? 0.5 : 1,
              transition: 'opacity 120ms',
            }}
          >
            <Minus size={13} />
          </button>
          <div style={{
            flex: 1, height: 32,
            background: 'var(--app-surface)',
            border: '0.5px solid var(--app-border)',
            borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12.5, fontWeight: 600, color: 'var(--app-text)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {batchCount}
          </div>
          <button
            type="button"
            onClick={incN}
            disabled={batchCount >= N_MAX}
            aria-label="Increase n"
            style={{
              width: 32, height: 32,
              borderRadius: 8,
              border: '0.5px solid var(--app-border)',
              background: 'var(--app-surface)',
              color: batchCount >= N_MAX ? 'var(--app-text-2)' : 'var(--app-text)',
              cursor: batchCount >= N_MAX ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              opacity: batchCount >= N_MAX ? 0.5 : 1,
              transition: 'opacity 120ms',
            }}
          >
            <Plus size={13} />
          </button>
        </div>
      </div>

      {/* (e) Seed (mockup L461-465).
          Empty = random each request (per §6 spec). Randomize button
          fills with a 9-digit value so the user can reproduce a result. */}
      <div>
        <label style={labelStyle}>
          Seed
          <span style={{ fontWeight: 400, color: 'var(--app-text-2)' }}> · blank = random</span>
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="number"
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            placeholder="Random"
            style={{
              flex: 1, height: 32,
              background: 'var(--app-surface)',
              border: '0.5px solid var(--app-border)',
              borderRadius: 8,
              padding: '0 10px',
              fontSize: 12.5,
              color: 'var(--app-text)',
              outline: 'none',
              fontFamily: 'JetBrains Mono, monospace',
              fontVariantNumeric: 'tabular-nums',
            }}
          />
          <button
            type="button"
            onClick={randomSeed}
            title="Randomize seed"
            aria-label="Randomize seed"
            style={{
              width: 32, height: 32,
              background: 'var(--app-surface)',
              border: '0.5px solid var(--app-border)',
              borderRadius: 8,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
              color: 'var(--app-text-2)',
              flexShrink: 0,
            }}
          >
            <Dice5 size={14} />
          </button>
        </div>
      </div>

      {/* (f) Prompt optimizer — unchanged */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--app-text)' }}>
            {t('image.promptOptimizer')}
          </div>
          <div style={{ fontSize: 11, color: 'var(--app-text-2)' }}>
            Enhance prompt before generating
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={promptOptimizer}
          onClick={() => setPromptOptimizer(!promptOptimizer)}
          style={{
            position: 'relative',
            width: 40,
            height: 23,
            flexShrink: 0,
            borderRadius: 12,
            border: 'none',
            background: promptOptimizer ? 'hsl(var(--primary))' : 'hsl(var(--secondary))',
            cursor: 'pointer',
            transition: 'background 140ms',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: 2,
              right: promptOptimizer ? 2 : 'auto',
              left: promptOptimizer ? 'auto' : 2,
              width: 19,
              height: 19,
              borderRadius: '50%',
              background: '#fff',
              transition: 'left 140ms ease, right 140ms ease',
            }}
          />
        </button>
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            background: 'var(--app-error)',
            color: '#fff',
            borderRadius: 10,
            padding: '8px 12px',
            fontSize: 11.5,
            lineHeight: 1.4,
          }}
        >
          {error}
        </div>
      )}

      {/* Generate button — unchanged */}
      <button
        type="button"
        onClick={generate}
        disabled={loading || !prompt.trim() || (mode === 'subject' && !referenceImage)}
        style={{
          width: '100%',
          height: 42,
          marginTop: 'auto',
          padding: '0 16px',
          background: (loading || !prompt.trim() || (mode === 'subject' && !referenceImage))
            ? 'hsl(var(--secondary))'
            : 'hsl(var(--primary))',
          color: (loading || !prompt.trim() || (mode === 'subject' && !referenceImage))
            ? 'var(--app-text-2)'
            : 'hsl(var(--primary-foreground))',
          border: 'none',
          borderRadius: 11,
          fontSize: 13.5,
          fontWeight: 600,
          cursor: (loading || !prompt.trim() || (mode === 'subject' && !referenceImage))
            ? 'not-allowed'
            : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          transition: 'background 120ms, color 120ms',
        }}
      >
        {loading
          ? <Loader2 size={16} className="animate-spin" />
          : <Sparkles size={16} strokeWidth={2} />}
        {loading
          ? t('image.generating')
          : t('image.generate')}
      </button>
    </>
  )

  // ──── canvas (right column body) ────────────────────────────────────
  const canvas = (
    <RecentGenerations
      type="image"
      items={gallery}
      loading={galleryLoading}
      onRefresh={fetchGallery}
      emptyMessage={t('image.noGenerated')}
    />
  )

  return (
    <MediaPanelLayout
      controlsWidth={360}
      topBar={topBar}
      galleryHeader={galleryHeader}
      controls={controls}
      canvas={canvas}
    />
  )
}