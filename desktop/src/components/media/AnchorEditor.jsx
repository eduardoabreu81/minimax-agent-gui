// AnchorEditor — create / edit modal for a video Anchor.
//
// Used by AnchorLibrary. Supports:
//   - Create from upload (drop/browse image)
//   - Create from image-history promotion (initialImagePath → fetched + sent)
//   - Edit existing anchor (name / description only; image immutable post-create)
//   - Auto-describe via VLM (pre-commit uses image_data_url; post-commit uses anchor_id)
//
// Tailwind-styled to match the SkillsTab / StyleSheetsTab ModalShell pattern.

import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Upload, Loader2, Sparkles, Image as ImageIcon } from 'lucide-react'
import {
  createAnchor, updateAnchor, describeAnchor, readFileAsDataURL,
} from '../../lib/anchors.js'
import { assetUrl } from '../../lib/api.js'

const NAME_MAX = 60
const DESC_MAX = 500

export default function AnchorEditor({ open, mode, anchor, initialImagePath, onClose, onSaved }) {
  const { t } = useTranslation()
  const isEdit = mode === 'edit'

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [imageDataUrl, setImageDataUrl] = useState('')   // for create mode
  const [imageName, setImageName] = useState('')
  const [saving, setSaving] = useState(false)
  const [describing, setDescribing] = useState(false)
  const [error, setError] = useState(null)
  const fileInputRef = useRef(null)

  // Reset state whenever the editor opens or the target anchor changes.
  useEffect(() => {
    if (!open) return
    setError(null)
    if (isEdit && anchor) {
      setName(anchor.name || '')
      setDescription(anchor.description || '')
      setImageDataUrl('')
      setImageName('')
    } else {
      setName('')
      setDescription('')
      setImageDataUrl('')
      setImageName('')
    }
  }, [open, isEdit, anchor])

  // Image-history promotion: when initialImagePath is provided on open,
  // fetch the image and convert to a data URL so the user can save it
  // as a new anchor without re-uploading.
  useEffect(() => {
    if (!open || !initialImagePath || isEdit) return
    let cancelled = false
    ;(async () => {
      try {
        const url = assetUrl(`/api/files/raw?path=${encodeURIComponent(initialImagePath)}`)
        const res = await fetch(url)
        if (!res.ok) throw new Error(`fetch failed: ${res.status}`)
        const blob = await res.blob()
        const reader = new FileReader()
        reader.onload = () => { if (!cancelled) {
          setImageDataUrl(reader.result)
          setImageName(initialImagePath.split('/').pop() || 'promoted')
        }}
        reader.readAsDataURL(blob)
      } catch (e) {
        if (!cancelled) setError(`Could not load image: ${e.message}`)
      }
    })()
    return () => { cancelled = true }
  }, [open, initialImagePath, isEdit])

  // ESC to close (matches ContextModal pattern).
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const pickFile = (file) => {
    if (!file || !file.type.startsWith('image/')) return
    setError(null)
    setImageName(file.name)
    readFileAsDataURL(file).then(setImageDataUrl).catch((e) => setError(e.message))
    // Default the name to the file stem if name is empty.
    if (!name) setName(file.name.replace(/\.[^.]+$/, '').slice(0, NAME_MAX))
  }

  const onDrop = (e) => {
    e.preventDefault()
    const f = e.dataTransfer?.files?.[0]
    if (f) pickFile(f)
  }

  const canSave = (() => {
    if (saving) return false
    if (!name.trim() || name.length > NAME_MAX) return false
    if (description.length > DESC_MAX) return false
    if (!isEdit && !imageDataUrl) return false   // create requires an image
    return true
  })()

  const handleAutoDescribe = async () => {
    setError(null)
    setDescribing(true)
    try {
      const desc = await describeAnchor({
        anchor_id: isEdit ? anchor.id : undefined,
        image_data_url: isEdit ? undefined : imageDataUrl,
      })
      setDescription(desc || '')
    } catch (e) {
      setError(e.message)
    } finally {
      setDescribing(false)
    }
  }

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      let saved
      if (isEdit) {
        saved = await updateAnchor(anchor.id, { name: name.trim(), description })
      } else {
        saved = await createAnchor({
          name: name.trim(),
          description,
          image_data_url: imageDataUrl,
          source: initialImagePath ? 'image-history' : 'upload',
          source_ref: initialImagePath || '',
        })
      }
      onSaved(saved)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const previewSrc = isEdit && anchor?.image?.path
    ? assetUrl(`/api/files/raw?path=${encodeURIComponent(anchor.image.path)}`)
    : imageDataUrl

  return (
    <div
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm flex items-center justify-center p-6"
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[560px] bg-card border border-border rounded-xl shadow-2xl flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <div className="flex items-center gap-2">
            <ImageIcon size={15} className="text-primary" />
            <h2 className="text-sm font-semibold text-foreground">
              {isEdit
                ? t('anchor.editTitle', { name: anchor.name })
                : t('anchor.createTitle', 'New anchor')}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-surface text-muted-foreground transition-colors"
            aria-label={t('common.close') || 'Close'}
          ><X size={15} /></button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          {/* Image dropzone (create mode) OR preview (edit mode) */}
          {isEdit ? (
            <div className="flex items-center gap-3">
              <div className="w-20 h-20 rounded-lg overflow-hidden border border-border bg-surface flex items-center justify-center">
                {previewSrc
                  ? <img src={previewSrc} alt="" className="w-full h-full object-cover" />
                  : <ImageIcon size={20} className="text-muted-foreground" />}
              </div>
              <div className="text-xs text-muted-foreground">
                {t('anchor.imageLocked', 'Image cannot be changed after creation. Delete and recreate to swap.')}
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-[11.5px] font-semibold text-muted-foreground mb-1.5">
                {t('anchor.imageLabel', 'Image')}
              </label>
              <div
                onClick={() => fileInputRef.current?.click()}
                onDrop={onDrop}
                onDragOver={(e) => e.preventDefault()}
                className="flex items-center gap-3 px-3 py-3 rounded-lg border border-dashed border-border hover:border-primary/60 cursor-pointer transition-colors bg-surface"
              >
                <div className="w-16 h-16 rounded-md overflow-hidden border border-border bg-card flex items-center justify-center flex-shrink-0">
                  {previewSrc
                    ? <img src={previewSrc} alt="" className="w-full h-full object-cover" />
                    : <Upload size={16} className="text-muted-foreground" />}
                </div>
                <div className="text-xs text-muted-foreground">
                  {imageName
                    ? <span className="text-foreground font-medium">{imageName}</span>
                    : t('anchor.dropHint', 'Drop an image or click to browse')}
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) pickFile(f); e.target.value = '' }}
                className="hidden"
              />
            </div>
          )}

          {/* Name */}
          <div>
            <label className="block text-[11.5px] font-semibold text-muted-foreground mb-1.5">
              {t('anchor.nameLabel', 'Name')}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={NAME_MAX}
              placeholder={t('anchor.namePlaceholder', 'e.g. "Hero — red jacket"')}
              className="w-full px-3 py-2 text-[12.5px] rounded-lg border border-border bg-surface text-foreground outline-none focus:border-primary/60"
            />
            <div className="text-[10px] text-muted-foreground mt-1 text-right tabular-nums">
              {name.length} / {NAME_MAX}
            </div>
          </div>


          {/* Description */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-[11.5px] font-semibold text-muted-foreground">
                {t('anchor.descriptionLabel', 'Description')}
              </label>
              <button
                onClick={handleAutoDescribe}
                disabled={!canAutoDescribe({ isEdit, imageDataUrl, describing })}
                title={t('anchor.autoDescribeHint', 'Generate a description via MiniMax VLM')}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-[10.5px] rounded-md border border-primary/40 text-primary hover:bg-primary/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {describing
                  ? <><Loader2 size={10} className="animate-spin" /> {t('common.generating', 'Generating…')}</>
                  : <><Sparkles size={10} /> {t('anchor.autoDescribe', 'Auto-describe')}</>}
              </button>
            </div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={DESC_MAX}
              rows={3}
              placeholder={t('anchor.descriptionPlaceholder', 'Stable visual identity — appearance, clothing, setting, lighting.')}
              className="w-full px-3 py-2 text-[12.5px] rounded-lg border border-border bg-surface text-foreground outline-none focus:border-primary/60 resize-none"
            />
            <div className="text-[10px] text-muted-foreground mt-1 text-right tabular-nums">
              {description.length} / {DESC_MAX}
            </div>
          </div>

          {error && (
            <div className="px-3 py-2 rounded-lg border border-error/30 bg-error/10 text-[11.5px] text-error">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-[12px] rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface transition-colors"
          >
            {t('common.cancel', 'Cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 text-[12px] font-semibold rounded-lg bg-primary text-white hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saving && <Loader2 size={12} className="animate-spin" />}
            {isEdit ? t('common.save', 'Save') : t('anchor.create', 'Create anchor')}
          </button>
        </div>
      </div>
    </div>
  )
}

function canAutoDescribe({ isEdit, imageDataUrl, describing }) {
  if (describing) return false
  // Edit mode: always available (reads from disk via anchor_id).
  // Create mode: needs the dropped image first.
  return isEdit || !!imageDataUrl
}
