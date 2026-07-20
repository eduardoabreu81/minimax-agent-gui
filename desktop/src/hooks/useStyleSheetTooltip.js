// useStyleSheetTooltip — lazy-load a style sheet's body for the picker
// tooltip. The list endpoint (/api/style-sheets) returns name/description
// but no body. To render the body preview inside the picker tooltip, we
// fetch the full record on first hover per name and cache the result
// for the rest of the session.
//
// Why session-only: style sheets mutate only through the editor, and the
// picker reloads the list after every save. Caching the body here keeps
// the picker from re-fetching on every hover — but stale cache is fine
// because any edit closes + reopens the picker anyway.
//
// Returns { data, loading, error } where `data` is the sheet returned by
// getStyleSheet (or null while loading / on failure).

import { useEffect, useState } from 'react'
import { getStyleSheet } from '../lib/styleSheets.js'

const cache = new Map() // name -> {status: 'ok'|'err', value?: any, error?: Error}

function read(name) {
  const hit = cache.get(name)
  if (!hit) return undefined
  if (hit.status === 'ok') return hit.value
  throw hit.error
}

export function useStyleSheetTooltip(name) {
  const initial = (() => {
    if (!name) return { status: 'idle' }
    try {
      return { status: 'ok', value: read(name) }
    } catch (e) {
      return { status: 'err', error: e }
    }
  })()

  const [state, setState] = useState(() => {
    if (!name) return { data: null, loading: false, error: null }
    if (initial.status === 'ok') return { data: initial.value, loading: false, error: null }
    if (initial.status === 'err') return { data: null, loading: false, error: initial.error }
    return { data: null, loading: true, error: null }
  })

  useEffect(() => {
    if (!name) {
      setState({ data: null, loading: false, error: null })
      return
    }
    if (cache.has(name)) {
      try {
        setState({ data: read(name), loading: false, error: null })
      } catch (e) {
        setState({ data: null, loading: false, error: e })
      }
      return
    }
    let cancelled = false
    setState({ data: null, loading: true, error: null })
    getStyleSheet(name)
      .then((value) => {
        cache.set(name, { status: 'ok', value })
        if (!cancelled) setState({ data: value, loading: false, error: null })
      })
      .catch((error) => {
        cache.set(name, { status: 'err', error })
        if (!cancelled) setState({ data: null, loading: false, error })
      })
    return () => {
      cancelled = true
    }
  }, [name])

  return state
}

// Test-only — drop the in-memory cache between unit tests so leftover
// fetches don't leak across cases.
export function __resetStyleSheetTooltipCacheForTests() {
  cache.clear()
}
