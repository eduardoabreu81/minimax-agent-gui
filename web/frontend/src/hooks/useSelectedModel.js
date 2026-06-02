import { useState, useEffect, useCallback, useRef } from 'react'

/**
 * useSelectedModel — fetches the currently selected chat model from /api/config.
 *
 * The backend's /api/config payload exposes `agent.model` (the chat model).
 * This hook:
 *  - Fetches the model on mount
 *  - Refetches when the window regains focus
 *  - Allows manual refresh() — useful after a media action that might
 *    trigger a config change
 *
 * Returns:
 *  - model: the current model id (e.g. 'MiniMax-M3') or the fallback
 *  - loading: true while the first fetch is in-flight
 *  - refresh(): force a refetch
 */
export function useSelectedModel({ fallback = 'MiniMax-M3' } = {}) {
  const [model, setModel] = useState(fallback)
  const [loading, setLoading] = useState(true)
  const mountedRef = useRef(true)

  const fetchModel = useCallback(async () => {
    try {
      const res = await fetch('/api/config')
      if (!mountedRef.current) return
      if (res.ok) {
        const data = await res.json()
        const next = data?.agent?.model || fallback
        setModel(next)
      }
    } catch {
      // network failure — keep the previous value
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [fallback])

  useEffect(() => {
    mountedRef.current = true
    fetchModel()
    const onFocus = () => fetchModel()
    window.addEventListener('focus', onFocus)
    return () => {
      mountedRef.current = false
      window.removeEventListener('focus', onFocus)
    }
  }, [fetchModel])

  return { model, loading, refresh: fetchModel }
}

export default useSelectedModel
