// desktop/src/components/coding/WorkspacePicker.jsx
//
// Folder picker for the CodingPanel header. Three states:
//
//   none     — no workspace set yet → show "Open folder…" CTA.
//   selected — workspace set, not yet locked → clickable chip + change
//              affordance. Clicking opens the picker to switch folders
//              (until the session locks).
//   locked   — workspace locked (first message sent) → chip with a
//              lock icon. No interaction.
//
// The picker delegates to:
//   • @tauri-apps/plugin-dialog  when running inside the Tauri shell
//     (native OS folder picker).
//   • browser fallback            when running in dev mode without
//     Tauri (uses <input type="file" webkitdirectory>).
//
// Both paths eventually call `onChange(path)` which the parent uses
// to call `PUT /api/coding/workspace`.

import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Folder, FolderOpen, Lock, ChevronDown, X } from 'lucide-react'

function isTauri() {
  return typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__
}

async function pickFolderTauri() {
  const { open } = await import('@tauri-apps/plugin-dialog')
  const result = await open({
    directory: true,
    multiple: false,
    title: 'Pick coding workspace folder',
  })
  // Plugin returns string | null. Some versions return an array even
  // with multiple:false — normalise to a single string.
  if (Array.isArray(result)) return result[0] || null
  return result || null
}

async function pickFolderBrowser() {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    // @ts-ignore — non-standard but supported in every modern browser
    input.webkitdirectory = true
    input.style.display = 'none'
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      if (!file) {
        document.body.removeChild(input)
        resolve(null)
        return
      }
      // webkitRelativePath looks like "MyProject/sub/file.txt" — we want
      // the first segment, which is the picked folder name.
      const seg = (file.webkitRelativePath || '').split('/')[0]
      // The browser intentionally hides the absolute path for security
      // (since the file API days). We can only return the folder name.
      document.body.removeChild(input)
      resolve(seg || null)
    })
    input.addEventListener('cancel', () => {
      document.body.removeChild(input)
      resolve(null)
    })
    document.body.appendChild(input)
    input.click()
  })
}

export default function WorkspacePicker({
  state,             // 'none' | 'selected' | 'locked'
  workspaceDir,      // string | null
  label,             // string | null — display name (folder basename)
  recentWorkspaces,  // [{path, label, last_used}] — VSCode-style list
  onChange,          // (path: string) => void
  onRemoveRecent,    // (path: string) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState(null)
  const ref = useRef(null)

  // Close popover on outside click.
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handlePick = async () => {
    if (picking) return
    setPicking(true)
    setError(null)
    try {
      const picked = isTauri()
        ? await pickFolderTauri()
        : await pickFolderBrowser()
      if (!picked) {
        // User cancelled — leave the picker open so they can pick again.
        return
      }
      await onChange(picked)
      setOpen(false)
    } catch (e) {
      setError(String(e?.message || e))
    } finally {
      setPicking(false)
    }
  }

  const handleRecent = (path) => {
    onChange(path)
    setOpen(false)
  }

  // --- Render --------------------------------------------------------

  // 1) nothing picked yet — full CTA
  if (state === 'none') {
    return (
      <div className="relative" ref={ref}>
        <button
          onClick={handlePick}
          disabled={picking}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 text-primary border border-primary/20 hover:border-primary rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
          title={t('coding.workspace.pickFolder')}
        >
          <Folder size={12} />
          {picking ? t('coding.workspace.opening') : t('coding.workspace.openFolder')}
        </button>
        {error && (
          <p className="absolute top-full mt-1 right-0 text-[10px] text-error whitespace-nowrap">
            {error}
          </p>
        )}
      </div>
    )
  }

  // 2) locked — chip with lock icon, no interaction
  if (state === 'locked') {
    return (
      <div
        className="flex items-center gap-1.5 px-3 py-1.5 bg-surface border border-border rounded-lg text-xs font-medium text-muted-foreground"
        title={workspaceDir || ''}
      >
        <Lock size={11} className="text-primary" />
        <span className="truncate max-w-[160px]">{label || workspaceDir}</span>
      </div>
    )
  }

  // 3) selected — clickable chip + change popover
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 text-primary border border-primary/20 hover:border-primary rounded-lg text-xs font-medium transition-colors"
        title={workspaceDir || ''}
      >
        <FolderOpen size={12} />
        <span className="truncate max-w-[160px]">{label || workspaceDir}</span>
        <ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1 w-80 bg-card border border-border rounded-xl shadow-lg z-50 py-2">
          <button
            onClick={handlePick}
            disabled={picking}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
          >
            <Folder size={12} />
            {picking ? t('coding.workspace.opening') : t('coding.workspace.changeFolder')}
          </button>
          {recentWorkspaces && recentWorkspaces.length > 0 && (
            <>
              <div className="border-t border-border my-1" />
              <p className="px-3 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                {t('coding.workspace.recent')}
              </p>
              <div className="max-h-64 overflow-y-auto">
                {recentWorkspaces.map((w) => (
                  <div
                    key={w.path}
                    className="flex items-center gap-2 px-3 py-1.5 hover:bg-surface transition-colors group cursor-pointer"
                    onClick={() => handleRecent(w.path)}
                  >
                    <Folder size={11} className="text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-foreground truncate">{w.label}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{w.path}</p>
                    </div>
                    {onRemoveRecent && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onRemoveRecent(w.path)
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-error/10 text-muted-foreground hover:text-error transition-opacity"
                        title={t('coding.workspace.removeFromRecent')}
                      >
                        <X size={10} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      {error && (
        <p className="absolute top-full mt-1 right-0 text-[10px] text-error whitespace-nowrap z-50">
          {error}
        </p>
      )}
    </div>
  )
}