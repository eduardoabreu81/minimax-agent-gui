import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
} from 'react'
import {
  ACTIVE_RUN_STATUSES,
  agentActivityReducer,
  selectGlobalSummary,
  selectSession,
  selectTabSummary,
} from './agentActivityState.js'

// AgentActivityContext — React surface for the per-session activity
// registry. The provider owns a single reducer state (Record<sessionId,
// SessionActivity>) and exposes both a global view and a per-session hook
// bound to a specific session id.
//
// Consumers fall into two camps:
//
//   1. Per-session panels (Coding, future Chat) call useSessionActivity(id)
//      which flattens the session's `activity` container with bound
//      dispatchers — preserving the legacy single-session API surface
//      so existing components can migrate incrementally.
//
//   2. Shell-level consumers (Titlebar, StatusBar) currently rely on the
//      legacy global flat shape. They will migrate to useAgentActivity in
//      a follow-up; until then the global hook returns `{ sessions, ... }`
//      per the brief.

const EMPTY_SESSION = Object.freeze({
  sessionId: null,
  tabId: null,
  kind: null,
  title: null,
  status: 'idle',
  phase: null,
  startedAt: null,
  updatedAt: 0,
  currentStep: null,
  lastTool: null,
  permissionRequest: null,
  unread: false,
  error: null,
  activity: {
    steps: [],
    toolResults: [],
    thinking: { active: false, duration: 0, content: '' },
    plan: { items: [], sourcePrompt: '', sourceAttachment: null, approved: false },
    hasNewActivity: false,
  },
})

const AgentActivityContext = createContext(null)

function emptyActionShim() {
  // Stable no-op for actions dispatched against an unregistered session.
  // Panels are expected to registerSession() before they start sending
  // events, so this path is a defensive fallback.
  return undefined
}

export function AgentActivityProvider({ children }) {
  const [state, dispatch] = useReducer(agentActivityReducer, {})

  // Stable dispatcher builders. We keep them memoized with `useCallback`
  // and an empty deps array — React's dispatch from useReducer is already
  // stable, but each individual action factory must also be stable so
  // children that destructure them don't re-render on every provider
  // state change.
  const registerSession = useCallback((metadata) => {
    dispatch({ type: 'register', metadata })
  }, [])

  const removeSession = useCallback((sessionId) => {
    dispatch({ type: 'unregister', sessionId })
  }, [])

  const startRun = useCallback((sessionId, options) => {
    dispatch({ type: 'run_started', sessionId, ...(options || {}) })
  }, [])

  const setPhase = useCallback((sessionId, phase) => {
    dispatch({ type: 'phase_changed', sessionId, phase })
  }, [])

  const setThinkingState = useCallback((sessionId, active, content = '') => {
    dispatch({ type: 'thinking_changed', sessionId, active, content })
  }, [])

  const setThinkingDuration = useCallback((sessionId, duration) => {
    dispatch({ type: 'thinking_duration', sessionId, duration })
  }, [])

  const addStep = useCallback((sessionId, step, maxSteps) => {
    dispatch({ type: 'step_added', sessionId, step, maxSteps })
  }, [])

  const completeStep = useCallback((sessionId, step) => {
    dispatch({ type: 'step_completed', sessionId, step })
  }, [])

  const addToolResult = useCallback((sessionId, data) => {
    dispatch({ type: 'tool_result', sessionId, data })
  }, [])

  const requestAttention = useCallback((sessionId, permission) => {
    dispatch({ type: 'attention_requested', sessionId, permission })
  }, [])

  const resolveAttention = useCallback((sessionId, requestId, resolution) => {
    dispatch({ type: 'attention_resolved', sessionId, requestId, resolution })
  }, [])

  const expireAttention = useCallback((sessionId, requestId, reason) => {
    dispatch({ type: 'attention_expired', sessionId, requestId, reason })
  }, [])

  const completeRun = useCallback((sessionId, options) => {
    dispatch({ type: 'run_completed', sessionId, options })
  }, [])

  const failRun = useCallback((sessionId, error, options) => {
    dispatch({ type: 'run_failed', sessionId, error, options })
  }, [])

  const failRunIfActive = useCallback((sessionId, error, options) => {
    dispatch({ type: 'fail_run_if_active', sessionId, error, options })
  }, [])

  const acknowledgeSession = useCallback((sessionId) => {
    dispatch({ type: 'session_acknowledged', sessionId })
  }, [])

  const clearActivity = useCallback((sessionId) => {
    dispatch({ type: 'session_cleared', sessionId })
  }, [])

  const createPlan = useCallback((sessionId, items, sourcePrompt = '', sourceAttachment = null) => {
    dispatch({ type: 'plan_created', sessionId, items, sourcePrompt, sourceAttachment })
  }, [])

  const updatePlanItem = useCallback((sessionId, id, text) => {
    dispatch({ type: 'plan_item_updated', sessionId, id, text })
  }, [])

  const togglePlanItem = useCallback((sessionId, id) => {
    dispatch({ type: 'plan_item_toggled', sessionId, id })
  }, [])

  const removePlanItem = useCallback((sessionId, id) => {
    dispatch({ type: 'plan_item_removed', sessionId, id })
  }, [])

  const addPlanItem = useCallback((sessionId, text) => {
    dispatch({ type: 'plan_item_added', sessionId, text })
  }, [])

  const clearPlan = useCallback((sessionId) => {
    dispatch({ type: 'plan_cleared', sessionId })
  }, [])

  const approvePlan = useCallback((sessionId) => {
    dispatch({ type: 'plan_approved', sessionId })
  }, [])

  const actions = useMemo(
    () => ({
      registerSession,
      removeSession,
      startRun,
      setPhase,
      setThinkingState,
      setThinkingDuration,
      addStep,
      completeStep,
      addToolResult,
      requestAttention,
      resolveAttention,
      expireAttention,
      completeRun,
      failRun,
      failRunIfActive,
      acknowledgeSession,
      clearActivity,
      createPlan,
      updatePlanItem,
      togglePlanItem,
      removePlanItem,
      addPlanItem,
      clearPlan,
      approvePlan,
    }),
    [
      registerSession,
      removeSession,
      startRun,
      setPhase,
      setThinkingState,
      setThinkingDuration,
      addStep,
      completeStep,
      addToolResult,
      requestAttention,
      resolveAttention,
      expireAttention,
      completeRun,
      failRun,
      failRunIfActive,
      acknowledgeSession,
      clearActivity,
      createPlan,
      updatePlanItem,
      togglePlanItem,
      removePlanItem,
      addPlanItem,
      clearPlan,
      approvePlan,
    ],
  )

  const globalValue = useMemo(
    () => ({
      sessions: state,
      selectSession: (sessionId) => selectSession(state, sessionId),
      selectTabSummary: (tabId) => selectTabSummary(state, tabId),
      selectGlobalSummary: () => selectGlobalSummary(state),
      activeRunStatuses: ACTIVE_RUN_STATUSES,
      ...actions,
    }),
    [state, actions],
  )

  return (
    <AgentActivityContext.Provider value={globalValue}>
      {children}
    </AgentActivityContext.Provider>
  )
}

export function useAgentActivity() {
  const ctx = useContext(AgentActivityContext)
  if (!ctx) {
    throw new Error('useAgentActivity must be used inside AgentActivityProvider')
  }
  return ctx
}

// useSessionActivity — flatten the session's `activity` container and bind
// the global action dispatchers to a specific session id. Panels always
// register before sending, but we still return a stable empty value when
// the session is unknown so the hook can be called during mount.
export function useSessionActivity(sessionId) {
  const ctx = useContext(AgentActivityContext)
  if (!ctx) {
    throw new Error('useSessionActivity must be used inside AgentActivityProvider')
  }

  // Ref keeps the latest actions snapshot without forcing the merged
  // object to recompute on every dispatch. We rebuild only when the
  // underlying session record identity changes.
  const actionsRef = useRef(ctx)
  actionsRef.current = ctx

  const session = sessionId ? ctx.sessions[sessionId] : null

  return useMemo(() => {
    if (!session) {
      return {
        ...EMPTY_SESSION,
        sessionId,
        addStep: emptyActionShim,
        completeStep: emptyActionShim,
        addToolResult: emptyActionShim,
        setThinkingState: emptyActionShim,
        setThinkingDuration: emptyActionShim,
        startRun: emptyActionShim,
        setPhase: emptyActionShim,
        requestAttention: emptyActionShim,
        resolveAttention: emptyActionShim,
        expireAttention: emptyActionShim,
        completeRun: emptyActionShim,
        failRun: emptyActionShim,
        failRunIfActive: emptyActionShim,
        acknowledgeSession: emptyActionShim,
        clearActivity: emptyActionShim,
        createPlan: emptyActionShim,
        updatePlanItem: emptyActionShim,
        togglePlanItem: emptyActionShim,
        removePlanItem: emptyActionShim,
        addPlanItem: emptyActionShim,
        clearPlan: emptyActionShim,
        approvePlan: emptyActionShim,
      }
    }
    const { activity, ...rest } = session
    return {
      ...rest,
      ...activity,
      startRun: (options) => ctx.startRun(sessionId, options),
      setPhase: (phase) => ctx.setPhase(sessionId, phase),
      setThinkingState: (active, content = '') =>
        ctx.setThinkingState(sessionId, active, content),
      setThinkingDuration: (duration) => ctx.setThinkingDuration(sessionId, duration),
      addStep: (step, maxSteps) => ctx.addStep(sessionId, step, maxSteps),
      completeStep: (step) => ctx.completeStep(sessionId, step),
      addToolResult: (data) => ctx.addToolResult(sessionId, data),
      requestAttention: (permission) => ctx.requestAttention(sessionId, permission),
      resolveAttention: (requestId, resolution) =>
        ctx.resolveAttention(sessionId, requestId, resolution),
      expireAttention: (requestId, reason) =>
        ctx.expireAttention(sessionId, requestId, reason),
      completeRun: (options) => ctx.completeRun(sessionId, options),
      failRun: (error, options) => ctx.failRun(sessionId, error, options),
      failRunIfActive: (error, options) => ctx.failRunIfActive(sessionId, error, options),
      acknowledgeSession: () => ctx.acknowledgeSession(sessionId),
      clearActivity: () => ctx.clearActivity(sessionId),
      createPlan: (items, sourcePrompt, sourceAttachment) =>
        ctx.createPlan(sessionId, items, sourcePrompt, sourceAttachment),
      updatePlanItem: (id, text) => ctx.updatePlanItem(sessionId, id, text),
      togglePlanItem: (id) => ctx.togglePlanItem(sessionId, id),
      removePlanItem: (id) => ctx.removePlanItem(sessionId, id),
      addPlanItem: (text) => ctx.addPlanItem(sessionId, text),
      clearPlan: () => ctx.clearPlan(sessionId),
      approvePlan: () => ctx.approvePlan(sessionId),
    }
    // session object identity changes when reducer creates a new session;
    // actions are stable via useCallback upstream.
  }, [session, sessionId, ctx])
}

// Internal helper for tests — exports the stable empty session shape so
// provider tests can assert that an unknown session id returns the
// documented defaults. Not part of the public brief contract.
export const __test__ = { EMPTY_SESSION, ACTIVE_RUN_STATUSES }