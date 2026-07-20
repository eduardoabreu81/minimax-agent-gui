import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'

// SessionTokensContext — per-session token usage tracker.
//
// The agent's WebSocket emits a final `assistant` event whose payload
// includes Anthropic `usage` fields (input_tokens, output_tokens,
// cache_read_input_tokens, cache_creation_input_tokens). ChatPanel and
// CodingPanel call `recordUsage(sessionId, usage)` after each turn. The
// StatusBar reads the aggregate for the currently-VISIBLE session and
// renders the context-window chip + popover.
//
// Task 2: visibility is now controlled by the parent (App). The provider
// receives `visibleSessionId` as a prop and exposes it on the context.
// Chat/Coding panels call `onSessionIdChange(sessionId)` from an effect so
// the parent always knows which id is in front of the user. Keeping
// sessions as a per-id map lets both panels record usage into their own
// bucket even while the other is offscreen — switching visible session
// does not delete either bucket.
//
// State is persisted to localStorage so a refresh doesn't wipe the
// running total. Each session is keyed by its id (chat or coding).

const STORAGE_KEY = 'minimax-session-tokens-v1'

const SessionTokensContext = createContext({
  sessions: {},
  visibleSessionId: null,
  recordUsage: () => {},
  resetSession: () => {},
  clearAll: () => {},
})

function loadFromStorage() {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

function saveToStorage(sessions) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
  } catch { /* ignore quota errors */ }
}

// Empty token bucket — used by recordUsage to merge incremental updates.
function emptyBucket() {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    lastModel: null,
    lastUpdated: 0,
    turnCount: 0,
    // Token breakdown by source (system/skills/tools/messages/
    // mcp_deferred/total). Filled in from the WS `usage` event's
    // `by_source` field, computed by the backend's
    // Agent.estimate_by_source(). Optional — older turns or
    // estimation failures leave this as null and the StatusBar
    // falls back to no breakdown.
    lastBySource: null,
  }
}

// Anthropic sends cumulative usage per turn (input includes cache reads +
// cache creation). For a real-time context-window meter we want the
// freshest "input_tokens of the LAST turn" since that's what determines
// whether the next send fits. We keep both:
//   - cumulative: how much has flowed through the session
//   - lastTurnInput: the most recent input_tokens value (drives the bar)
function emptySession() {
  return {
    ...emptyBucket(),
    lastTurnInput: 0,
  }
}

export function SessionTokensProvider({ children, visibleSessionId = null }) {
  const [sessions, setSessions] = useState(() => {
    const initial = loadFromStorage()
    // Migrate any old bucket (missing lastTurnInput) so consumers don't blow up.
    for (const id of Object.keys(initial)) {
      if (typeof initial[id].lastTurnInput !== 'number') {
        initial[id] = { ...emptySession(), ...initial[id] }
      }
      if (typeof initial[id].lastBySource === 'undefined') {
        initial[id] = { ...initial[id], lastBySource: null }
      }
    }
    return initial
  })
  const saveTimerRef = useRef(null)

  // Debounced persist — writes are tiny but avoid hammering storage.
  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => saveToStorage(sessions), 300)
    return () => clearTimeout(saveTimerRef.current)
  }, [sessions])

  // Record usage from a single assistant event. Anthropic usage is
  // cumulative per turn; we ADD input/output/cache to the running total
  // and remember the latest input_tokens value separately (for the bar).
  // Optional `bySource` carries Agent.estimate_by_source() output
  // (system/skills/tools/messages/mcp_deferred/total) so the StatusBar
  // popover can render a per-source breakdown.
  const recordUsage = useCallback((sessionId, usage, model = null, bySource = null) => {
    if (!sessionId || !usage) return
    console.log('[recordUsage]', { sessionId, input: usage.input_tokens, output: usage.output_tokens, cacheRead: usage.cache_read_input_tokens, cacheWrite: usage.cache_creation_input_tokens, model, hasBySource: !!bySource })
    setSessions((prev) => {
      const cur = prev[sessionId] || emptySession()
      const next = {
        ...cur,
        input_tokens: cur.input_tokens + (usage.input_tokens || 0),
        output_tokens: cur.output_tokens + (usage.output_tokens || 0),
        cache_read_input_tokens: cur.cache_read_input_tokens + (usage.cache_read_input_tokens || 0),
        cache_creation_input_tokens: cur.cache_creation_input_tokens + (usage.cache_creation_input_tokens || 0),
        lastTurnInput: usage.input_tokens || 0,
        lastModel: model || cur.lastModel,
        lastUpdated: Date.now(),
        turnCount: cur.turnCount + 1,
        // Only overwrite lastBySource when the backend actually sent
        // a new breakdown — keeps the popover stable if a future turn
        // doesn't include the field for any reason.
        lastBySource: bySource ?? cur.lastBySource,
      }
      return { ...prev, [sessionId]: next }
    })
  }, [])

  const resetSession = useCallback((sessionId) => {
    setSessions((prev) => {
      const next = { ...prev }
      delete next[sessionId]
      return next
    })
  }, [])

  const clearAll = useCallback(() => {
    setSessions({})
  }, [])

  const value = {
    sessions,
    visibleSessionId,
    recordUsage,
    resetSession,
    clearAll,
  }

  return (
    <SessionTokensContext.Provider value={value}>
      {children}
    </SessionTokensContext.Provider>
  )
}

export const useSessionTokens = () => useContext(SessionTokensContext)

// id has no recorded usage yet. Used by StatusBar.ContextChip to read
// the chip's fill / popover breakdown. The id is controlled — it
// comes from the parent's `visibleSessionId` prop, not internal state.
export const useVisibleSessionTokens = () => {
  const { sessions, visibleSessionId } = useSessionTokens()
  return visibleSessionId ? (sessions[visibleSessionId] || null) : null
}
