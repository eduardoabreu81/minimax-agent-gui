import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Save, Sparkles, Upload, X, Wand2, Image as ImageIcon } from 'lucide-react'
import {
  createStyleSheet,
  updateStyleSheet,
  getStyleSheet,
  draftStyleSheetFromBrief,
  draftStyleSheetFromImage,
} from '../../lib/styleSheets.js'
import SessionActionGuard from '../shared/SessionActionGuard'

const PROMPT_MAX = 1500
const BODY_MAX = 1000
const PLACEHOLDER = '{prompt}'

function extractBody(raw) {
  if (!raw) return ''
  const m = String(raw).match(/^---\n.*?\n---\n?(.*)$/s)
  return m ? m[1].trim() : String(raw).trim()
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = reject
    r.readAsDataURL(file)
  })
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="text-[10.5px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">{label}</label>
      {children}
      {hint && <p className="text-[10px] text-muted-foreground mt-1">{hint}</p>}
    </div>
  )
}

/**
 * Shared editor used by both the Image panel and Settings.
 *
 * Three start tabs — direct / AI / image — feed the same shared form.
 * Drafts (AI or image) fill fields but never save. Saving goes through
 * createStyleSheet / updateStyleSheet and reports the saved sheet via
 * onSaved. Failures preserve all editor state.
 */
export default function StyleSheetEditor({
  mode = 'create',
  sheet,
  source = 'direct',
  initialImagePath = '',
  imagePrompt = '',
  saveLabel,
  onClose,
  onSaved,
  onError,
  onDirtyChange,
}) {
  const { t } = useTranslation()
  const isEdit = mode === 'edit'

  const [startTab, setStartTab] = useState(source === 'image' ? 'image' : 'direct')
  const [brief, setBrief] = useState('')
  const [imagePath, setImagePath] = useState(initialImagePath || '')
  const [uploadedDataUrl, setUploadedDataUrl] = useState('')
  const [uploadedName, setUploadedName] = useState('')

  const [name, setName] = useState(sheet?.name || '')
  const [description, setDescription] = useState(sheet?.description || '')
  const [body, setBody] = useState(extractBody(sheet?.raw_markdown) || '')

  // Snapshot of the values that came from `sheet` on mount (and after
  // the lazy edit-mode load resolves). `fieldsDirty` compares the live
  // form against THIS baseline, not against "any value present" — the
  // previous logic flagged the editor as dirty the moment it mounted in
  // edit mode (because name/description/body are pre-filled), which made
  // the parent's discard guard fire on save and on every close attempt.
  //
  // Stored as state (not a ref) so updating it re-runs the `fieldsDirty`
  // useMemo and notifies the parent via `onDirtyChange`. A ref would
  // mutate silently and leave the memo's cached value stuck on "true"
  // after a successful save.
  const [baseline, setBaseline] = useState({
    name: sheet?.name || '',
    description: sheet?.description || '',
    body: extractBody(sheet?.raw_markdown) || '',
    brief: '',
    imagePath: initialImagePath || '',
    uploadedDataUrl: '',
  })
  const resetBaseline = (snapshot) => {
    setBaseline(snapshot || { name, description, body, brief, imagePath, uploadedDataUrl })
  }

  const [drafting, setDrafting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [nameError, setNameError] = useState('')
  const [loadingSheet, setLoadingSheet] = useState(false)
  const [overwriteGuardOpen, setOverwriteGuardOpen] = useState(false)
  const [pendingDraftKind, setPendingDraftKind] = useState(null)
  // Inline error surfaced inside the modal body. Required because the
  // parent's onError path paints a banner that the modal's full-screen
  // overlay (z-40) covers — without this, validation failures look like
  // "the button does nothing" to the user.
  const [inlineError, setInlineError] = useState('')
  useEffect(() => {
    if (!inlineError) return
    const id = setTimeout(() => setInlineError(''), 4000)
    return () => clearTimeout(id)
  }, [inlineError])
  // Centralized error sink so every onError site (validation + draft +
  // save) renders inside the modal instead of being lost behind the
  // overlay.
  const reportError = (msg) => {
    setInlineError(msg)
    onError?.(msg)
  }
  // Edit mode: lazily fetch the full sheet (with raw_markdown) on mount.
  // Edit mode: lazily fetch the full sheet (with raw_markdown) on mount.
  useEffect(() => {
    if (!isEdit || !sheet?.name) return
    let cancelled = false
    setLoadingSheet(true)
    getStyleSheet(sheet.name)
      .then((s) => {
        if (cancelled) return
        const nextName = s.name || ''
        const nextDescription = s.description || ''
        const nextBody = extractBody(s.raw_markdown) || ''
        setName(nextName)
        setDescription(nextDescription)
        setBody(nextBody)
        // After a successful load, the baseline IS the loaded values —
        // the form should be clean, not dirty.
        setBaseline({
          name: nextName,
          description: nextDescription,
          body: nextBody,
          brief: '',
          imagePath: initialImagePath || '',
          uploadedDataUrl: '',
        })
      })
      .catch((e) => reportError(e.message || 'Failed to load style sheet'))
      .finally(() => { if (!cancelled) setLoadingSheet(false) })
    return () => { cancelled = true }
  }, [isEdit, sheet?.name])

  const validateName = (raw) => {
    const v = (raw || '').trim()
    if (!v) return t('styleSheets.nameRequired')
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(v)) return t('styleSheets.nameFormat')
    return ''
  }

  const placeholderCount = useMemo(
    () => (body.match(/\{prompt\}/g) || []).length,
    [body],
  )
  const bodyTooLong = body.length > BODY_MAX
  const tooManyPlaceholders = placeholderCount > 1

  const combinedPreview = useMemo(() => {
    const userPrompt = (imagePrompt || '').trim()
    if (body.includes('{prompt}')) return body.replace('{prompt}', userPrompt)
    if (!userPrompt) return body
    if (!body.trim()) return userPrompt
    return `${userPrompt}, ${body}`
  }, [body, imagePrompt])

  const previewMarkdown = useMemo(() => {
    if (!name && !description && !body) return ''
    const fm = ['---']
    if (name) fm.push(`name: ${name}`)
    if (description) fm.push(`description: ${description}`)
    fm.push('---', '')
    return fm.join('\n') + (body || '').trim() + '\n'
  }, [name, description, body])

  // Dirty = current form diverges from the baseline snapshot. The baseline
  // is updated on every successful save (so a save followed by a close
  // doesn't pop the discard dialog) and after the lazy edit-mode load.
  const fieldsDirty = useMemo(() => {
    return (
      name !== baseline.name ||
      description !== baseline.description ||
      body !== baseline.body ||
      brief !== baseline.brief ||
      imagePath !== baseline.imagePath ||
      uploadedDataUrl !== baseline.uploadedDataUrl
    )
  }, [name, description, body, brief, imagePath, uploadedDataUrl, baseline])

  useEffect(() => {
    onDirtyChange?.(fieldsDirty)
  }, [fieldsDirty, onDirtyChange])

   const performDraft = async (kind) => {
    setDrafting(true)
    try {
      const draft = kind === 'ai'
        ? await draftStyleSheetFromBrief(brief.trim())
        : await draftStyleSheetFromImage(
          imagePath ? { imagePath } : { imageDataUrl: uploadedDataUrl },
        )
      setName(draft.name || '')
      setDescription(draft.description || '')
      setBody(draft.body || '')
    } catch (e) {
      reportError(e.message || 'Draft failed')
    } finally {
      setDrafting(false)
    }
  }

  const runDraft = async (kind) => {
    if (kind === 'ai') {
      if (!brief.trim()) { reportError(t('styleSheets.briefRequired')); return }
    } else if (kind === 'image') {
      if (!imagePath && !uploadedDataUrl) { reportError(t('styleSheets.imageRequired')); return }
    } else {
      return
    }
    if (name || description || body) {
      setPendingDraftKind(kind)
      setOverwriteGuardOpen(true)
      return
    }
    await performDraft(kind)
  }

  const handleSave = async () => {
    const err = validateName(name)
    if (err) { setNameError(err); reportError(err); return }
    if (!description.trim()) { reportError(t('styleSheets.descriptionRequired')); return }
    if (bodyTooLong) { reportError(t('styleSheets.bodyTooLong', { max: BODY_MAX })); return }
    if (tooManyPlaceholders) { reportError(t('styleSheets.tooManyPlaceholders', { placeholder: PLACEHOLDER })); return }
    setSaving(true)
    try {
      const saved = isEdit
        ? await updateStyleSheet(sheet.name, { description: description.trim(), body })
        : await createStyleSheet({ name: name.trim(), description: description.trim(), body })
      // Treat the saved form as the new baseline. Without this, a save
      // followed by close would still pop the discard guard because the
      // form's current values would still diverge from the old baseline.
      resetBaseline()
      onSaved?.(saved)
    } catch (e) {
      reportError(e.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const onPickUpload = async (file) => {
    if (!file) { setUploadedDataUrl(''); setUploadedName(''); return }
    try {
      const url = await readFileAsDataURL(file)
      setUploadedDataUrl(url)
      setUploadedName(file.name)
      setImagePath('') // uploads win over path
    } catch { /* ignore */ }
  }

  if (loadingSheet) {
    return (
      <div className="py-10 text-center text-[12px] text-muted-foreground flex items-center justify-center gap-2">
        <Loader2 size={14} className="animate-spin" /> {t('common.loading') || 'Loading…'}
      </div>
    )
  }
  return (
    <>
    <div className="space-y-4">
      {/* Start-mode tabs (hidden in edit mode — edits only touch fields). */}
      {!isEdit && (
        <div className="flex items-center gap-1 bg-surface rounded-[10px] p-1 border border-border">
          <StartTab icon={Wand2} active={startTab === 'direct'} onClick={() => setStartTab('direct')}
            label={t('styleSheets.startMode.direct')} />
          <StartTab icon={Sparkles} active={startTab === 'ai'} onClick={() => setStartTab('ai')}
            label={t('styleSheets.startMode.ai')} />
          <StartTab icon={ImageIcon} active={startTab === 'image'} onClick={() => setStartTab('image')}
            label={t('styleSheets.startMode.image')} />
        </div>
      )}

      {/* Per-mode controls. */}
      {!isEdit && startTab === 'ai' && (
        <Field label={t('styleSheets.briefLabel')} hint={t('styleSheets.briefHint')}>
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            rows={3}
            placeholder={t('styleSheets.briefPlaceholder')}
            className="w-full bg-surface border border-border rounded-[8px] px-3 py-2 text-[12.5px] focus:outline-none focus:border-primary resize-none"
          />
          <DraftButton drafting={drafting} onClick={() => runDraft('ai')} label={t('styleSheets.createDraft')} />
        </Field>
      )}

      {!isEdit && startTab === 'image' && (
        <Field label={t('styleSheets.imageLabel')} hint={t('styleSheets.imageHint')}>
          <div className="space-y-2">
            {imagePath && (
              <div className="text-[11.5px] text-muted-foreground flex items-center gap-2">
                <ImageIcon size={12} />
                <code className="font-mono">{imagePath}</code>
                <button
                  className="ml-auto p-1 rounded hover:bg-surface"
                  onClick={() => setImagePath('')}
                  aria-label={t('common.remove') || 'Remove'}
                ><X size={11} /></button>
              </div>
            )}
            {!imagePath && (
              <ImageDropzone
                name={uploadedName}
                onPick={onPickUpload}
                placeholder={t('styleSheets.imageDropzone')}
              />
            )}
          </div>
          <DraftButton drafting={drafting} onClick={() => runDraft('image')} label={t('styleSheets.extractStyle')} />
        </Field>
      )}

      {/* Shared form. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="space-y-3">
          <Field label={t('styleSheets.nameLabel')} hint={isEdit ? t('styleSheets.nameLocked') : t('styleSheets.nameHint')}>
            <input
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); setNameError('') }}
              disabled={isEdit}
              placeholder="watercolor-pastel"
              className="w-full h-[34px] bg-surface border border-border rounded-[8px] px-3 font-mono text-[12.5px] focus:outline-none focus:border-primary disabled:opacity-50"
            />
            {nameError && <p className="text-[10.5px] text-error mt-1">{nameError}</p>}
          </Field>
          <Field label={t('styleSheets.descriptionLabel')} hint={t('styleSheets.descriptionHint')}>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder={t('styleSheets.descriptionPlaceholder')}
              className="w-full bg-surface border border-border rounded-[8px] px-3 py-2 text-[12.5px] focus:outline-none focus:border-primary resize-none"
            />
            <p className="text-[10px] text-muted-foreground mt-0.5">{description.length}/1024</p>
          </Field>
          <Field label={t('styleSheets.bodyLabel')} hint={t('styleSheets.bodyHint', { placeholder: PLACEHOLDER, max: BODY_MAX })}>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              placeholder={t('styleSheets.bodyPlaceholder', { placeholder: PLACEHOLDER })}
              className={`w-full bg-surface border rounded-[8px] px-3 py-2 font-mono text-[12px] focus:outline-none resize-none ${
                bodyTooLong || tooManyPlaceholders ? 'border-error focus:border-error' : 'border-border focus:border-primary'
              }`}
            />
            <div className="flex items-center justify-between mt-0.5 text-[10px]">
              <span className={tooManyPlaceholders ? 'text-error' : 'text-muted-foreground'}>
                {t('styleSheets.placeholderCount', { placeholder: PLACEHOLDER, count: placeholderCount })}
              </span>
              <span className={bodyTooLong ? 'text-error' : 'text-muted-foreground'}>{body.length}/{BODY_MAX}</span>
            </div>
          </Field>
        </div>
        <div className="flex flex-col">
          <div className="text-[11.5px] font-semibold text-muted-foreground mb-1.5">{t('styleSheets.combinedPreview')}</div>
          <pre className="bg-surface border border-border rounded-[8px] px-3 py-2.5 text-[11.5px] whitespace-pre-wrap break-words mb-2">{combinedPreview}</pre>
          <div className="text-[10.5px] text-muted-foreground mb-2">{combinedPreview.length} / {PROMPT_MAX}</div>
          <div className="text-[11.5px] font-semibold text-muted-foreground mb-1.5">{t('styleSheets.livePreview')}</div>
          <pre className="flex-1 min-h-[220px] bg-surface border border-border rounded-[8px] px-3 py-2.5 text-[11.5px] font-mono whitespace-pre-wrap break-words overflow-auto">
{previewMarkdown || t('styleSheets.previewEmpty')}
          </pre>
        </div>
      </div>

      {/* Inline error banner — sits above the action row so the user
          always sees it inside the modal. The modal's z-40 overlay
          hides the parent's onError banner; this is the only error
          surface that's guaranteed visible. */}
      {inlineError && (
        <div
          role="alert"
          data-testid="style-sheet-editor-error"
          className="mt-3 px-3 py-2 rounded-[8px] border border-error/40 bg-error/10 text-[12px] text-error"
        >
          {inlineError}
        </div>
      )}

      <div className="mt-3 flex items-center justify-end gap-2">
        <button onClick={onClose} className="h-[34px] px-4 rounded-[8px] border border-border text-[12px] hover:border-primary/50">
          {t('common.cancel') || 'Cancel'}
        </button>
        <button
          onClick={handleSave}
          disabled={saving || bodyTooLong || tooManyPlaceholders || !name.trim() || !description.trim()}
          className="flex items-center gap-1.5 h-[34px] px-4 rounded-[8px] bg-primary hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed text-white text-[12px] font-medium"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
          {saveLabel || (isEdit ? t('styleSheets.saveChanges') : t('styleSheets.createSheet'))}
        </button>
      </div>
    </div>
    <SessionActionGuard
      open={overwriteGuardOpen}
      title={t('styleSheets.overwriteTitle', { defaultValue: 'Overwrite draft fields?' })}
      description={t('styleSheets.confirmOverwriteDraft')}
      confirmLabel={t('styleSheets.overwrite', { defaultValue: 'Overwrite' })}
      cancelLabel={t('common.cancel', { defaultValue: 'Cancel' })}
      onCancel={() => { setOverwriteGuardOpen(false); setPendingDraftKind(null) }}
      onConfirm={() => {
        const kind = pendingDraftKind
        setOverwriteGuardOpen(false)
        setPendingDraftKind(null)
        if (kind) performDraft(kind)
      }}
    />
    </>
  )
}
function StartTab({ icon: Icon, active, onClick, label }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 h-[30px] rounded-[8px] text-[12px] font-medium transition-colors ${
        active ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      <Icon size={12} /> {label}
    </button>
  )
}

function DraftButton({ drafting, onClick, label }) {
  return (
    <button
      onClick={onClick}
      disabled={drafting}
      className="mt-2 flex items-center gap-1.5 h-[30px] px-3 rounded-[8px] bg-primary/10 text-primary border border-primary/20 text-[12px] font-medium hover:bg-primary/20 disabled:opacity-50"
    >
      {drafting ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
      {label}
    </button>
  )
}

function ImageDropzone({ name, onPick, placeholder }) {
  return (
    <label
      className="flex items-center justify-center gap-2 h-[96px] w-full rounded-[10px] border border-dashed border-border bg-surface cursor-pointer text-[11.5px] text-muted-foreground"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        const f = e.dataTransfer?.files?.[0]
        if (f && f.type.startsWith('image/')) onPick(f)
      }}
    >
      <input
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onPick(f)
          e.target.value = ''
        }}
      />
      {name ? (
        <span className="flex items-center gap-2">
          <Upload size={12} /> <code className="font-mono">{name}</code>
        </span>
      ) : (
        <span className="flex items-center gap-2"><Upload size={14} /> {placeholder}</span>
      )}
    </label>
  )
}