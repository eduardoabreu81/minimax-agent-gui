import { useState, useEffect, useCallback } from 'react'

/**
 * useThinkingToggle — per-panel thinking toggle for M3.
 *
 * The user can switch the thinking param on/off from the composer. The
 * choice is remembered in localStorage. Defaults to true on first use
 * (M3's thinking is one of its main features; turning it off is opt-in).
 *
 * Usage:
 *   const { thinkingEnabled, setThinkingEnabled } = useThinkingToggle({
 *     storageKey: 'chat-thinking-enabled',
 *   })
 */
export function useThinkingToggle({ storageKey = 'chat-thinking-enabled', defaultValue = true } = {}) {
  const [thinkingEnabled, setThinkingEnabledState] = useState(() => {
    try {
      const stored = localStorage.getItem(storageKey)
      if (stored === null) return defaultValue
      return stored === 'true'
    } catch {
      return defaultValue
    }
  })

  const setThinkingEnabled = useCallback((next) => {
    setThinkingEnabledState(next)
    try {
      localStorage.setItem(storageKey, String(next))
    } catch {
      // ignore
    }
  }, [storageKey])

  return { thinkingEnabled, setThinkingEnabled }
}

export default useThinkingToggle
