// AnchorLibrary — horizontal strip of saved anchor cards shown at the
// top of the VideoPanel controls column. Click a card to toggle attach
// to the current generation; hover to edit / delete.
//
// Also listens for window event `minimax:anchor-promote` dispatched by
// ImagePanel when the user clicks "Save as video anchor" on a generated
// image. The event carries { imagePath } and opens the editor with the
// image pre-loaded.
//
// Contract:
//   Props:
//     attachedAnchors   — Anchor[] currently attached (owned by parent)
//     onAttachedChange  — (nextAttachedAnchors: Anchor[]) => void
//
//   The parent owns the attached array (it's what builds the /api/video
//   payload as subject_reference[]). This component just renders the library
//   and bubbles attach/detach events up as the next array state.

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Loader2, Anchor } from 'lucide-react'
import AnchorCard from './AnchorCard.jsx'
import AnchorEditor from './AnchorEditor.jsx'
import { listAnchors, deleteAnchor } from '../../lib/anchors.js'

const MAX_ANCHORS = 4  // max attached per generation (subject_reference[] cap)

export default function AnchorLibrary({ attachedAnchors = [], onAttachedChange }) {
  const { t } = useTranslation()
  const [anchors, setAnchors] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Editor state
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorMode, setEditorMode] = useState('create')
  const [editingAnchor, setEditingAnchor] = useState(null)
  const [initialImagePath, setInitialImagePath] = useState(null)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await listAnchors()
      setAnchors(list)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  // Image-history promotion listener (from ImagePanel).
  // Two delivery paths because only the active tab is mounted:
  //   1. sessionStorage token — survives the Image→Video tab switch
  //      (set before the nav event, consumed on AnchorLibrary mount).
  //   2. window event — same-tab fallback for when AnchorLibrary is
  //      already mounted (rare; e.g. user is on Video tab and drops
  //      an image from another source).
  useEffect(() => {
    // Path 1: pending token from a cross-tab promotion.
    try {
      const raw = sessionStorage.getItem('minimax:pendingAnchorPromote')
      if (raw) {
        sessionStorage.removeItem('minimax:pendingAnchorPromote')
        const parsed = JSON.parse(raw)
        if (parsed?.imagePath) {
          setEditorMode('create')
          setEditingAnchor(null)
          setInitialImagePath(parsed.imagePath)
          setEditorOpen(true)
          return  // don't also register the window listener this cycle
        }
      }
    } catch { /* sessionStorage unavailable */ }

    // Path 2: same-tab window event fallback.
    const onPromote = (e) => {
      const imagePath = e.detail?.imagePath
      if (!imagePath) return
      setEditorMode('create')
      setEditingAnchor(null)
      setInitialImagePath(imagePath)
      setEditorOpen(true)
    }
    window.addEventListener('minimax:anchor-promote', onPromote)
    return () => window.removeEventListener('minimax:anchor-promote', onPromote)
  }, [])

  // Attached-id Set derived from the parent's attachedAnchors array.
  // Used for O(1) membership checks in toggle/edit/delete handlers.
  const attachedIds = useMemo(
    () => new Set(attachedAnchors.map((a) => a.id)),
    [attachedAnchors],
  )

  const handleToggleAttach = (anchor) => {
    if (attachedIds.has(anchor.id)) {
      // Detach.
      onAttachedChange(attachedAnchors.filter((a) => a.id !== anchor.id))
      return
    }
    // Attach — enforce total cap (subject_reference[] accepts a list).
    if (attachedAnchors.length >= MAX_ANCHORS) {
      setError(t('anchor.capExceeded', {
        defaultValue: `Max ${MAX_ANCHORS} anchors per generation`,
        cap: MAX_ANCHORS,
      }))
      setTimeout(() => setError(null), 3000)
      return
    }
    onAttachedChange([...attachedAnchors, anchor])
  }

  const handleEdit = (anchor) => {
    setEditorMode('edit')
    setEditingAnchor(anchor)
    setInitialImagePath(null)
    setEditorOpen(true)
  }

  const handleDelete = async (anchor) => {
    if (!confirm(t('anchor.confirmDelete', {
      defaultValue: `Delete anchor "${anchor.name}"? This cannot be undone.`,
      name: anchor.name,
    }))) return
    try {
      await deleteAnchor(anchor.id)
      if (attachedIds.has(anchor.id)) {
        onAttachedChange(attachedAnchors.filter((a) => a.id !== anchor.id))
      }
      await fetchAll()
    } catch (e) {
      setError(e.message)
    }
  }

  const handleNew = () => {
    setEditorMode('create')
    setEditingAnchor(null)
    setInitialImagePath(null)
    setEditorOpen(true)
  }

  const handleSaved = async (savedAnchor) => {
    setEditorOpen(false)
    setEditingAnchor(null)
    setInitialImagePath(null)
    await fetchAll()
    // If the saved anchor was currently attached, refresh its data in the
    // attached array so the parent has the updated description/type.
    if (savedAnchor && attachedIds.has(savedAnchor.id)) {
      onAttachedChange(attachedAnchors.map((a) =>
        a.id === savedAnchor.id ? { ...savedAnchor, image: a.image } : a
      ))
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Anchor size={12} style={{ color: 'var(--app-text-2)' }} />
          <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--app-text-2)' }}>
            {t('anchor.libraryLabel', { defaultValue: 'Anchors' })}
          </label>
          {anchors.length > 0 && (
            <span style={{
              fontSize: 10, color: 'var(--app-text-2)',
              background: 'var(--app-surface)', border: '0.5px solid var(--app-border)',
              borderRadius: 999, padding: '1px 6px',
            }}>{anchors.length}</span>
          )}
        </div>
        <button
          onClick={handleNew}
          title={t('anchor.createNew', { defaultValue: 'New anchor' })}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '3px 8px', borderRadius: 7,
            fontSize: 10.5, fontWeight: 500,
            color: 'hsl(var(--primary))',
            background: 'hsl(var(--primary) / 0.08)',
            border: '0.5px solid hsl(var(--primary) / 0.25)',
            cursor: 'pointer',
          }}
        >
          <Plus size={11} /> {t('anchor.new', { defaultValue: 'New' })}
        </button>
      </div>

      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--app-text-2)', padding: '8px 0' }}>
          <Loader2 size={11} className="animate-spin" /> {t('common.loading', { defaultValue: 'Loading…' })}
        </div>
      )}

      {error && (
        <div style={{
          fontSize: 10.5, color: 'hsl(var(--error))',
          background: 'hsl(var(--error) / 0.08)',
          border: '0.5px solid hsl(var(--error) / 0.2)',
          borderRadius: 7, padding: '5px 8px', marginBottom: 6,
        }}>{error}</div>
      )}

      {!loading && anchors.length === 0 && (
        <div style={{
          fontSize: 10.5, color: 'var(--app-text-2)',
          padding: '10px 8px', textAlign: 'center',
          border: '1px dashed var(--app-border)', borderRadius: 9,
        }}>
          {t('anchor.emptyHint', {
            defaultValue: 'No anchors yet. Create one to lock a subject or scene across generations.',
          })}
        </div>
      )}

      {!loading && anchors.length > 0 && (
        <div style={{ display: 'flex', gap: 7, overflowX: 'auto', paddingBottom: 4 }}>
          {anchors.map((a) => (
            <AnchorCard
              key={a.id}
              anchor={a}
              attached={attachedIds.has(a.id)}
              onToggleAttach={() => handleToggleAttach(a)}
              onEdit={() => handleEdit(a)}
              onDelete={() => handleDelete(a)}
            />
          ))}
        </div>
      )}

      <AnchorEditor
        open={editorOpen}
        mode={editorMode}
        anchor={editingAnchor}
        initialImagePath={initialImagePath}
        onClose={() => setEditorOpen(false)}
        onSaved={handleSaved}
      />
    </div>
  )
}
