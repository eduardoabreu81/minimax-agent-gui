import { useState, useEffect, useCallback } from 'react'

/**
 * useModelOverride — per-turn model selection for chat/code composers.
 *
 * The user can switch the model on a per-panel basis (Chat vs Code). The
 * choice is remembered in localStorage so subsequent visits inherit it.
 * Falls back to the server-config default when no override is set.
 *
 * Usage:
 *   const { model, setModel, supportsThinking } = useModelOverride({
 *     fallback: 'MiniMax-M3',
 *     storageKey: 'chat-model-override',
 *   })
 */
export function useModelOverride({ fallback = 'MiniMax-M3', storageKey = 'chat-model-override' } = {}) {
  const [model, setModelState] = useState(() => {
    try {
      const stored = localStorage.getItem(storageKey)
      return stored || fallback
    } catch {
      return fallback
    }
  })

  const setModel = useCallback((next) => {
    setModelState(next)
    try {
      localStorage.setItem(storageKey, next)
    } catch {
      // ignore — localStorage may be unavailable (private browsing etc.)
    }
  }, [storageKey])

  // M3 is the only model that supports Anthropic-style thinking blocks.
  // Mirrors mini_agent/llm/anthropic_client.py:THINKING_SUPPORTED.
  const supportsThinking = model === 'MiniMax-M3'

  return { model, setModel, supportsThinking }
}

export default useModelOverride
