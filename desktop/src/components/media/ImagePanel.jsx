import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Image, Loader2, Sparkles } from 'lucide-react'
import { useSessionProtection } from '../../hooks/useSessionProtection'
import MediaPanelLayout from '../shared/MediaPanelLayout'
import MediaHeader from '../shared/MediaHeader'
import GalleryHeader from '../shared/GalleryHeader'
import ShapePreview from '../shared/ShapePreview'
import RecentGenerations from './RecentGenerations'
import { apiFetch } from '../../lib/api.js'

// 8 presets from the mockup (aspectDefs L1084-1093). Width/height are the
// *display* sizes used by ShapePreview; the API receives just aspect_ratio.
const ASPECT_RATIOS = [
  { label: 'Square',      value: '1:1',  shapeW: 22, shapeH: 22, res: '1024 × 1024' },
  { label: 'Widescreen',  value: '16:9', shapeW: 26, shapeH: 15, res: '1344 × 768' },
  { label: 'Vertical',    value: '9:16', shapeW: 15, shapeH: 26, res: '768 × 1344' },
  { label: 'Standard',    value: '4:3',  shapeW: 24, shapeH: 18, res: '1152 × 896' },
  { label: 'Portrait',    value: '3:4',  shapeW: 18, shapeH: 24, res: '896 × 1152' },
  { label: 'Photo',       value: '3:2',  shapeW: 26, shapeH: 17, res: '1216 × 832' },
  { label: 'Photo tall',  value: '2:3',  shapeW: 17, shapeH: 26, res: '832 × 1216' },
  { label: 'Cinematic',   value: '21:9', shapeW: 28, shapeH: 12, res: '1536 × 640' },
]

// Mockup L405-407 / L431-436 — labels and field control styles
const labelStyle = {
  fontSize: 11.5,
  fontWeight: 600,
  color: 'var(--app-text-2)',
  display: 'block',
  marginBottom: 7,
}

export default function ImagePanel() {
  const { t } = useTranslation()
  const [prompt, setPrompt] = useState('')
  const [aspectRatio, setAspectRatio] = useState('1:1')
  const [aspectOpen, setAspectOpen] = useState(false)
  const aspectRef = useRef(null)
  const [batchCount, setBatchCount] = useState(1)
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

  const downloadUrl = (path) => `/api/files/download?path=${encodeURIComponent(path)}`

  const generate = async () => {
    if (!prompt.trim()) return
    setLoading(true)
    setError(null)
    setResults([])
    try {
      const body = {
        prompt,
        aspect_ratio: aspectRatio,
        n: batchCount,
        prompt_optimizer: promptOptimizer,
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

  // ──────── controlsHeader (inline at top of controls column) ────────
  const controlsHeader = (
    <MediaHeader
      icon={<Image size={18} strokeWidth={2} />}
      title={t('image.title')}
      subtitle={t('image.textToImage') + ' · Hailuo'}
    />
  )

  // ──────── galleryHeader (52px above canvas) ────────
  const galleryHeader = (
    <GalleryHeader
      title={t('image.recentGenerations')}
      subtitle="Saved to workspace/generations/images/"
    />
  )

  // ──────── controls (left column body) ────────
  const controls = (
    <>
      {/* (a) Prompt — mockup L404-407 */}
      <div>
        <label style={labelStyle}>{t('image.prompt')}</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value.slice(0, 2000))}
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

      {/* (b) Aspect ratio — mockup L408-430 */}
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
          {/* Shape preview container — 26×26 (mockup L411) */}
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
              top: 74, // label height + gap + button height (mockup L417)
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
                  {/* Shape preview container — 30×30 (mockup L420) */}
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

      {/* (c) Batch size — mockup L438-445 */}
      <div>
        <label style={labelStyle}>{t('image.batchCount')}</label>
        <div style={{ display: 'flex', gap: 7 }}>
          {[1, 2, 3, 4].map((n) => {
            const selected = batchCount === n
            return (
              <button
                key={n}
                type="button"
                onClick={() => setBatchCount(n)}
                style={{
                  width: 42,
                  height: 34,
                  borderRadius: 8,
                  border: `1px solid ${selected ? 'hsl(var(--primary))' : 'var(--app-border-2)'}`,
                  background: selected ? 'hsl(var(--primary) / 0.1)' : 'transparent',
                  color: selected ? 'hsl(var(--primary))' : 'var(--app-text-2)',
                  fontSize: 12,
                  fontWeight: selected ? 600 : 400,
                  cursor: 'pointer',
                  fontVariantNumeric: 'tabular-nums',
                  transition: 'background 120ms, border-color 120ms, color 120ms',
                }}
              >
                {n}
              </button>
            )
          })}
        </div>
      </div>

      {/* (d) Prompt optimizer — mockup L431-436.
          Justified-between row, NO card. Switch pill 40×23 radius 12. */}
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

      {/* Generate button — mockup L447-452 */}
      <button
        type="button"
        onClick={generate}
        disabled={loading || !prompt.trim()}
        style={{
          width: '100%',
          height: 42,
          marginTop: 'auto',
          padding: '0 16px',
          background: loading || !prompt.trim() ? 'hsl(var(--secondary))' : 'hsl(var(--primary))',
          color: loading || !prompt.trim() ? 'var(--app-text-2)' : 'hsl(var(--primary-foreground))',
          border: 'none',
          borderRadius: 11,
          fontSize: 13.5,
          fontWeight: 600,
          cursor: loading || !prompt.trim() ? 'not-allowed' : 'pointer',
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

  // ──────── canvas (right column body) ────────
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
      controlsHeader={controlsHeader}
      controls={controls}
      galleryHeader={galleryHeader}
      canvas={canvas}
    />
  )
}