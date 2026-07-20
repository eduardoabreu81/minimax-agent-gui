// AnchorCard — single anchor thumbnail in the VideoPanel library strip.
//
// Inline-styled to match VideoPanel's FrameDropzone / button look
// (the media panels use inline styles, not Tailwind classes).
//
// Props:
//   anchor      — { id, name, description, image: { path }, ... }
//   attached    — bool, currently attached to the generation
//   onToggleAttach — () => void
//   onEdit      — () => void
//   onDelete    — () => void

import { Image as ImageIcon, Trash2, Pencil, Check } from 'lucide-react'
import { assetUrl } from '../../lib/api.js'

const CARD_SIZE = 84

export default function AnchorCard({ anchor, attached, onToggleAttach, onEdit, onDelete }) {
  const imgSrc = anchor?.image?.path
    ? assetUrl(`/api/files/raw?path=${encodeURIComponent(anchor.image.path)}`)
    : null

  return (
    <div
      onClick={onToggleAttach}
      title={anchor.description || anchor.name}
      style={{
        position: 'relative',
        width: CARD_SIZE,
        height: CARD_SIZE,
        flexShrink: 0,
        borderRadius: 10,
        overflow: 'hidden',
        cursor: 'pointer',
        border: attached
          ? '2px solid hsl(var(--primary))'
          : '1px solid var(--app-border)',
        background: 'var(--app-surface)',
        transition: 'border-color 0.15s, transform 0.1s',
        transform: attached ? 'scale(0.97)' : 'scale(1)',
      }}
    >
      {/* Thumbnail (or placeholder if image missing) */}
      {imgSrc ? (
        <img
          src={imgSrc}
          alt={anchor.name}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          draggable={false}
        />
      ) : (
        <div style={{
          width: '100%', height: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--app-text-2)',
        }}>
          <ImageIcon size={18} />
        </div>
      )}

      {/* Bottom gradient + name */}
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        padding: '14px 6px 4px 6px',
        background: 'linear-gradient(to top, rgba(0,0,0,0.85), rgba(0,0,0,0))',
        color: '#fff',
        fontSize: 10.5,
        fontWeight: 500,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {anchor.name}
      </div>


      {/* Attached checkmark (top-right) */}
      {attached && (
        <div style={{
          position: 'absolute', top: 4, right: 4,
          width: 18, height: 18, borderRadius: 9,
          background: 'hsl(var(--primary))',
          color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Check size={11} strokeWidth={3} />
        </div>
      )}

      {/* Hover actions (edit / delete) — bottom-right, only on hover */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute', bottom: 4, right: 4,
          display: 'flex', gap: 2,
          opacity: 0,
          transition: 'opacity 0.15s',
        }}
        className="anchor-card-actions"
      >
        {onEdit && (
          <button
            onClick={onEdit}
            title="Edit anchor"
            style={{
              width: 20, height: 20, borderRadius: 5,
              background: 'rgba(0,0,0,0.65)', color: '#fff',
              border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 0,
            }}
          ><Pencil size={10} /></button>
        )}
        {onDelete && (
          <button
            onClick={onDelete}
            title="Delete anchor"
            style={{
              width: 20, height: 20, borderRadius: 5,
              background: 'rgba(220,38,38,0.85)', color: '#fff',
              border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 0,
            }}
          ><Trash2 size={10} /></button>
        )}
      </div>

      {/* Hover style — can't use :hover in inline, so inject a tiny style once. */}
      <style>{`
        .anchor-card:hover .anchor-card-actions { opacity: 1 !important; }
      `}</style>
    </div>
  )
}
