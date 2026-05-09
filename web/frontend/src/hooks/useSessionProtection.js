/**
 * Session Protection — global risk registry for unsaved work / ongoing operations.
 *
 * Components register their risk state via useSessionProtection().
 * App.jsx and beforeunload check hasAnyRisk() synchronously.
 *
 * This uses a module-level Map to avoid re-renders in App.jsx.
 */

import { useEffect, useCallback, useRef } from 'react'

const riskRegistry = new Map()

export function hasAnyRisk() {
  return riskRegistry.size > 0
}

export function getRiskReasons() {
  return Array.from(riskRegistry.values())
}

export function useSessionProtection() {
  const idsRef = useRef(new Set())

  const register = useCallback((id, active, reason = '') => {
    if (active) {
      riskRegistry.set(id, reason || id)
      idsRef.current.add(id)
    } else {
      riskRegistry.delete(id)
      idsRef.current.delete(id)
    }
  }, [])

  const unregisterAll = useCallback(() => {
    idsRef.current.forEach((id) => riskRegistry.delete(id))
    idsRef.current.clear()
  }, [])

  // Auto-unregister on unmount so stale risks don't leak when a panel is swapped out
  useEffect(() => {
    return () => {
      unregisterAll()
    }
  }, [unregisterAll])

  return { register, unregisterAll, hasAnyRisk }
}
