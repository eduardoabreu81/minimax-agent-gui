import { useEffect, useRef, useState } from 'react'
import { X, Download, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { assetUrl } from '../../lib/api.js'

const MIN_ZOOM = 1
const MAX_ZOOM = 8

/**
 * ImageLightbox — fullscreen overlay showing one generated image at large size.
 *
 * Props:
 *   item    — { name, path } from the recent-generations feed
 *   onClose — () => void
 *
 * UX notes:
 *  - Closes on backdrop click, X button, or ESC key.
 *  - Click the image to toggle between fit-to-screen and 2× zoom; drag while
 *    zoomed in to pan. Explicit +/- toolbar buttons give finer control and
 *    work on touch devices.
 *  - Body scroll is locked while open to prevent background bleed.
 */
export default function ImageLightbox({ item, onClose }) {
  const { t } = useTranslation()
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })

  const url = item?.path
    ? assetUrl(`/api/files/download?path=${encodeURIComponent(item.path)}`)
    : null

  // ESC + body scroll lock
  useEffect(() => {
    if (!item) return
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [item, onClose])

  // Reset zoom/pan whenever a new image is shown
  useEffect(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [item?.path])

  if (!item) return null

  const handleImageClick = () => {
    // Toggle fit ↔ 2× around the click point approximation
    setZoom((z) => (z > 1 ? 1 : 2))
    setPan({ x: 0, y: 0 })
  }

  const bumpZoom = (delta) => {
    setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, +(z + delta).toFixed(2))))
    if (zoom + delta <= MIN_ZOOM) setPan({ x: 0, y: 0 })
  }
  const resetZoom = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  // Drag-to-pan while zoomed in
  const dragOriginRef = useRef(null)
  const handlePointerDown = (e) => {
    if (zoom <= 1) return
    dragOriginRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const handlePointerMove = (e) => {
    const o = dragOriginRef.current
    if (!o) return
    setPan({ x: e.clientX - o.x, y: e.clientY - o.y })
  }
  const handlePointerUp = (e) => {
    dragOriginRef.current = null
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch {}
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={item.name}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      {/* Toolbar — outside the image so clicks don't dismiss */}
      <div
        className="absolute top-4 right-4 flex items-center gap-2 z-10"
        onClick={(e) => e.stopPropagation()}
      >
        <a
          href={url}
          download={item.name}
          className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
          title={t('common.download', { defaultValue: 'Download' })}
          aria-label={t('common.download', { defaultValue: 'Download' })}
        >
          <Download size={16} />
        </a>
        <button
          type="button"
          onClick={() => bumpZoom(-0.5)}
          className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
          title={t('lightbox.zoomOut', { defaultValue: 'Zoom out' })}
          aria-label={t('lightbox.zoomOut', { defaultValue: 'Zoom out' })}
        >
          <ZoomOut size={16} />
        </button>
        <button
          type="button"
          onClick={() => bumpZoom(0.5)}
          className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
          title={t('lightbox.zoomIn', { defaultValue: 'Zoom in' })}
          aria-label={t('lightbox.zoomIn', { defaultValue: 'Zoom in' })}
        >
          <ZoomIn size={16} />
        </button>
        <button
          type="button"
          onClick={resetZoom}
          className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
          title={t('lightbox.reset', { defaultValue: 'Reset zoom' })}
          aria-label={t('lightbox.reset', { defaultValue: 'Reset zoom' })}
        >
          <RotateCcw size={16} />
        </button>
        <button
          type="button"
          onClick={onClose}
          className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
          title={t('common.close', { defaultValue: 'Close' })}
          aria-label={t('common.close', { defaultValue: 'Close' })}
        >
          <X size={16} />
        </button>
      </div>

      {/* Caption */}
      <div
        className="absolute bottom-4 left-1/2 -translate-x-1/2 max-w-[80vw] px-3 py-1.5 rounded-lg bg-black/60 text-white text-xs truncate z-10 flex items-center gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="truncate">{item.name}</span>
        <span className="text-white/60 flex-shrink-0">{Math.round(zoom * 100)}%</span>
      </div>

      {/* Image surface — click toggles zoom, drag pans */}
      <div
        className="relative max-w-[95vw] max-h-[90vh] overflow-hidden"
        onClick={(e) => { e.stopPropagation(); handleImageClick() }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{
          cursor: zoom > 1 ? 'grab' : 'zoom-in',
          touchAction: 'none',
        }}
      >
        {url && (
          <img
            src={url}
            alt={item.name}
            draggable={false}
            className="max-w-[95vw] max-h-[90vh] object-contain select-none"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transition: dragOriginRef.current ? 'none' : 'transform 120ms ease-out',
              transformOrigin: 'center center',
            }}
          />
        )}
      </div>
    </div>
  )
}
