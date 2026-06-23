// useAgentContext — front-end state for the 5-file Agent Context system.
//
// Owns the 4 single-file CRUD operations (SOUL/IDENTITY/USER/MEMORY) and
// the daily-log list/read, all backed by the backend endpoints shipped
// in `web/backend/main.py`. Components consume this hook to read the
// current state and to write changes; the hook also invalidates the
// in-memory agent cache on the backend by simply calling PUT.
//
// Caching strategy:
//   - `status` (banner / char usage) is read once on mount and after
//     every save — cheap, 4 file reads on the server, no LLM call.
//   - `files` (the actual content) is read on demand by components
//     that need to edit. The wizard reads them all in one batch.
//   - `dailies` is read once on mount and reloaded after each
//     successful save (so a new daily is visible immediately).
//
// The hook does NOT poll — `/api/config` is the single source of
// truth and components that care about the banner (IncompleteContextBanner)
// get their state from the same `status` object. If the user opens a
// different tab and the .agent/ files change from somewhere else, the
// `refresh()` method can be called manually.

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '../lib/api.js'

// File IDs the backend knows about. Lowercase, no extension.
export const FILE_IDS = ['soul', 'identity', 'user', 'memory']

// JS-side fallback preset/role bodies. Used only if the backend
// /presets or /roles endpoints fail. The single source of truth
// for the canonical bodies is `web/backend/i18n.py`; the wizard
// prefers the live response. Keep these short — the wizard is
// the consumer and only sees them if the backend is unreachable.
const FALLBACK_PRESETS = {
  concise: 'Direct, minimal prose. Substance > formality.',
  friendly: 'Warm and encouraging. Celebrate wins, explain patiently.',
  mentor: 'Patient. Explains the why before the how.',
  expert: 'Dense technical, cites trade-offs and edge cases.',
  creative: 'Generates options, explores unexpected angles.',
}

const FALLBACK_ROLES = {
  eng: 'Focused on writing and maintaining code.',
  reviewer: 'Reads code, identifies issues, suggests improvements.',
  pm: 'Organizes tasks, tracks progress, manages scope.',
  custom: 'You define the role.',
}

/**
 * Build the default USER.md body for the wizard.
 * @param {string} name — user-supplied name (e.g. "Eduardo")
 * @param {string} timezone — IANA tz (e.g. "America/Sao_Paulo")
 * @param {string} level — "beginner" | "mid" | "senior"
 */
export function buildUserBody(name, timezone, level) {
  return `# About ${name || 'you'}\n\n` +
    `- Name: ${name || ''}\n` +
    `- Timezone: ${timezone || ''}\n` +
    `- Technical level: ${level || 'mid'}\n\n` +
    `## How I like to work\n\n` +
    `_The agent updates this section as it learns._\n`
}

/**
 * Build the default MEMORY.md body. The actual content is appended
 * by the agent over time, but the file needs to exist so the loader
 * picks it up.
 */
export function buildMemoryBody() {
  return `# Project memory\n\n` +
    `Append-only notes. Updated by the agent as you work.\n\n` +
    `§ User prefers concise commits and clear scope.\n`
}

export function useAgentContext() {
  // `status` mirrors the /api/config agent_context payload:
  //   { missing, corrupt, banner_visible, char_usage }
  const [status, setStatus] = useState({
    missing: [],
    corrupt: [],
    banner_visible: false,
    char_usage: {},
  })
  // `files` is a cache of GET /api/agent-context/{id} responses.
  // Components that need to edit pull from here; if it's empty
  // they call fetchFile(id) on demand.
  const [files, setFiles] = useState({})   // { soul: { content, char_count, ... } }
  const [dailies, setDailies] = useState([]) // [{ date, size, path }]
  // `presets` and `roles` come from /api/agent-context/presets and
  // /roles. Loaded once on mount so the wizard can use the canonical
  // bodies (the single source of truth is web/backend/i18n.py).
  const [presets, setPresets] = useState([]) // [{ id, name, desc, body }]
  const [roles, setRoles] = useState([])     // [{ id, name, desc, body? }]
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const mountedRef = useRef(true)

  // -------- Loaders --------

  const refreshStatus = useCallback(async () => {
    try {
      const res = await apiFetch('/api/config')
      if (!mountedRef.current) return
      const data = await res.json()
      setStatus(data.agent_context || {
        missing: [],
        corrupt: [],
        banner_visible: false,
        char_usage: {},
      })
    } catch (e) {
      // Non-fatal — the banner will just show the last known state.
      console.warn('[useAgentContext] /api/config failed:', e)
      if (mountedRef.current) setError(e.message || 'config fetch failed')
    }
  }, [])

  const refreshDailies = useCallback(async () => {
    try {
      const res = await apiFetch('/api/agent-context/dailies?n=7')
      if (!mountedRef.current) return
      const data = await res.json()
      setDailies(data.dailies || [])
    } catch (e) {
      console.warn('[useAgentContext] /dailies failed:', e)
    }
  }, [])

  const refreshPresetsAndRoles = useCallback(async () => {
    // Fetch in parallel. Each falls back to the JS map if the backend
    // is unreachable (the wizard's preview cards still need *something*
    // to show).
    try {
      const [pRes, rRes] = await Promise.all([
        apiFetch('/api/agent-context/presets'),
        apiFetch('/api/agent-context/roles'),
      ])
      if (!mountedRef.current) return
      const pData = await pRes.json()
      const rData = await rRes.json()
      if (Array.isArray(pData.presets)) setPresets(pData.presets)
      if (Array.isArray(rData.roles)) setRoles(rData.roles)
    } catch (e) {
      console.warn('[useAgentContext] /presets or /roles failed:', e)
    }
  }, [])

  // Initial load — status + dailies + presets/roles, files are lazy.
  useEffect(() => {
    mountedRef.current = true
    setLoading(true)
    Promise.all([refreshStatus(), refreshDailies(), refreshPresetsAndRoles()])
      .finally(() => {
        if (mountedRef.current) setLoading(false)
      })
    return () => { mountedRef.current = false }
  }, [refreshStatus, refreshDailies, refreshPresetsAndRoles])

  // -------- File operations --------

  const fetchFile = useCallback(async (id) => {
    const res = await apiFetch(`/api/agent-context/${id}`)
    if (!res.ok) {
      const detail = (await res.json().catch(() => ({}))).detail || res.statusText
      throw new Error(`Failed to load ${id}: ${detail}`)
    }
    const data = await res.json()
    setFiles(prev => ({ ...prev, [id]: data }))
    return data
  }, [])

  const saveFile = useCallback(async (id, content) => {
    const res = await apiFetch(`/api/agent-context/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    })
    if (!res.ok) {
      const detail = (await res.json().catch(() => ({}))).detail || res.statusText
      throw new Error(`Save failed: ${detail}`)
    }
    const data = await res.json()
    // Refresh the cached file entry + the global status (banner visibility
    // may have flipped back to false if all 4 files are now filled).
    setFiles(prev => ({ ...prev, [id]: { ...(prev[id] || {}), content, char_count: data.char_count, char_limit: data.char_limit } }))
    if (data.status) setStatus(data.status)
    return data
  }, [])

  // Batch save — used by the onboarding wizard. Returns a list of
  // { id, ok, error? } so the wizard can show which (if any) failed.
  const saveBatch = useCallback(async (entries) => {
    const results = await Promise.all(entries.map(async ({ id, content }) => {
      try {
        const data = await saveFile(id, content)
        return { id, ok: true, data }
      } catch (error) {
        return { id, ok: false, error: error.message }
      }
    }))
    // Always refresh dailies too — wizard may have written MEMORY which
    // doesn't change dailies, but harmless.
    await refreshDailies()
    return results
  }, [saveFile, refreshDailies])

  const fetchDaily = useCallback(async (dateStr) => {
    const res = await apiFetch(`/api/agent-context/daily/${dateStr}`)
    if (!res.ok) {
      if (res.status === 404) return null
      const detail = (await res.json().catch(() => ({}))).detail || res.statusText
      throw new Error(`Failed to load ${dateStr}: ${detail}`)
    }
    return await res.json()
  }, [])

  return {
    status,
    files,
    dailies,
    presets,
    roles,
    loading,
    error,
    refreshStatus,
    refreshDailies,
    refreshPresetsAndRoles,
    fetchFile,
    saveFile,
    saveBatch,
    fetchDaily,

    // Helpers exposed for the wizard — fetches the body for a preset
    // or role by id. Prefers the live data from /presets + /roles;
    // falls back to the JS-side map if the backend is unreachable
    // (or the id isn't in the response). The 'custom' role has no
    // canonical body by design — both the live and JS paths return
    // '' so the wizard knows to use the user's typed text instead.
    getPresetBody: (presetId) => {
      const live = presets.find(p => p.id === presetId)
      if (live?.body) return live.body
      return FALLBACK_PRESETS[presetId] || ''
    },
    getRoleBody: (roleId) => {
      const live = roles.find(r => r.id === roleId)
      if (live) {
        // Live data present: trust the backend. custom = no body.
        return live.body || ''
      }
      return FALLBACK_ROLES[roleId] || ''
    },
  }
}
