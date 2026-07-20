// agentActivityState.js — pure registry for per-session agent activity.
//
// State shape: a Record<sessionId, SessionActivity> keyed by session id.
// Each SessionActivity owns its own nested `activity` container so sessions
// (Chat and Coding) cannot accidentally share step/plan/tool arrays.
//
// Reducer is intentionally framework-free so the same logic can back the
// React provider, server-side aggregation, or unit tests. Selectors are
// derived on demand; the reducer never holds derived data.

export const ACTIVE_RUN_STATUSES = new Set(['running', 'needs_input'])

// buildSessionActivity — internal helper that owns the canonical shape.
function buildSessionActivity(metadata, now = Date.now()) {
  const { sessionId, tabId = null, kind = null, title = null } = metadata || {}
  return {
    sessionId,
    tabId,
    kind,
    title,
    status: 'idle',
    phase: null,
    startedAt: null,
    updatedAt: now,
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
  }
}

// Public alias; tests import this directly to assert isolation.
export function createSessionActivity(metadata, now = Date.now()) {
  return buildSessionActivity(metadata, now)
}

// updateSession — immutable per-session update helper.
function updateSession(state, sessionId, updater) {
  const current = state[sessionId]
  if (!current) return state
  const next = updater(current)
  if (next === current) return state
  return { ...state, [sessionId]: next }
}

function withUpdatedAt(session, now) {
  if (now == null) return session
  if (session.updatedAt === now) return session
  return { ...session, updatedAt: now }
}

function nowFrom(action) {
  if (typeof action.now === 'number') return action.now
  return Date.now()
}

export function agentActivityReducer(state, action) {
  switch (action.type) {
    case 'register': {
      const { metadata } = action
      if (!metadata || !metadata.sessionId) return state
      const existing = state[metadata.sessionId]
      const now = nowFrom(action)
      if (existing) {
        // Merge metadata only — preserve any in-flight run state. Existing
        // runs are not reset by re-registering the same session id.
        const merged = { ...existing, updatedAt: now }
        if (metadata.tabId != null && existing.tabId == null) merged.tabId = metadata.tabId
        if (metadata.kind != null && existing.kind == null) merged.kind = metadata.kind
        if (metadata.title != null && existing.title == null) merged.title = metadata.title
        return updateSession(state, metadata.sessionId, () => merged)
      }
      const created = buildSessionActivity(metadata, now)
      return { ...state, [metadata.sessionId]: created }
    }

    case 'unregister': {
      const { sessionId } = action
      if (!state[sessionId]) return state
      const next = { ...state }
      delete next[sessionId]
      return next
    }

    case 'run_started': {
      const { sessionId } = action
      const now = nowFrom(action)
      return updateSession(state, sessionId, (session) => ({
        ...session,
        status: 'running',
        startedAt: now,
        updatedAt: now,
        error: null,
        unread: false,
        permissionRequest: null,
        currentStep: null,
        activity: {
          ...session.activity,
          thinking: { ...session.activity.thinking, active: true },
          hasNewActivity: false,
        },
      }))
    }

    case 'run_completed': {
      const { sessionId, options } = action
      const now = nowFrom(action)
      // Allow both `{ options: { unread } }` (preferred) and a top-level
      // `unread` flag for direct reducer dispatchers.
      const unread = !!(options && options.unread) || !!action.unread
      return updateSession(state, sessionId, (session) => ({
        ...session,
        status: 'completed',
        updatedAt: now,
        unread,
        error: null,
        permissionRequest: null,
        activity: {
          ...session.activity,
          thinking: { ...session.activity.thinking, active: false, duration: 0 },
        },
      }))
    }

    case 'run_failed': {
      const { sessionId, error, options } = action
      const now = nowFrom(action)
      const unread = !!(options && options.unread)
      return updateSession(state, sessionId, (session) => ({
        ...session,
        status: 'error',
        updatedAt: now,
        unread,
        error: error == null ? null : String(error),
        permissionRequest: null,
        activity: {
          ...session.activity,
          thinking: { ...session.activity.thinking, active: false, duration: 0 },
        },
      }))
    }

    case 'fail_run_if_active': {
      const { sessionId } = action
      const current = state[sessionId]
      if (!current) return state
      if (!ACTIVE_RUN_STATUSES.has(current.status)) return state
      return agentActivityReducer(state, { ...action, type: 'run_failed' })
    }

    case 'phase_changed': {
      const { sessionId, phase } = action
      const now = nowFrom(action)
      return updateSession(state, sessionId, (session) =>
        withUpdatedAt({ ...session, phase: phase ?? null }, now),
      )
    }

    case 'thinking_changed': {
      const { sessionId, active, content } = action
      const now = nowFrom(action)
      return updateSession(state, sessionId, (session) => ({
        ...session,
        updatedAt: now,
        activity: {
          ...session.activity,
          thinking: {
            ...session.activity.thinking,
            active: !!active,
            content: content != null ? String(content) : '',
            // Stopping thinking clears duration; starting preserves it.
            duration: active ? session.activity.thinking.duration : 0,
          },
        },
      }))
    }

    case 'thinking_duration': {
      const { sessionId, duration } = action
      const now = nowFrom(action)
      return updateSession(state, sessionId, (session) => ({
        ...session,
        updatedAt: now,
        activity: {
          ...session.activity,
          thinking: { ...session.activity.thinking, duration: Number(duration) || 0 },
        },
      }))
    }

    case 'step_added': {
      const { sessionId, step, maxSteps } = action
      const now = nowFrom(action)
      return updateSession(state, sessionId, (session) => {
        const existing = session.activity.steps.find((s) => s.step === step)
        const steps = existing
          ? session.activity.steps.map((s) =>
              s.step === step ? { ...s, status: 'running', timestamp: now } : s,
            )
          : [
              ...session.activity.steps,
              { step, maxSteps, status: 'running', timestamp: now },
            ]
        return {
          ...session,
          updatedAt: now,
          currentStep: step,
          activity: {
            ...session.activity,
            steps,
            hasNewActivity: true,
          },
        }
      })
    }

    case 'step_completed': {
      const { sessionId, step } = action
      const now = nowFrom(action)
      return updateSession(state, sessionId, (session) => ({
        ...session,
        updatedAt: now,
        currentStep: session.currentStep === step ? null : session.currentStep,
        activity: {
          ...session.activity,
          steps: session.activity.steps.map((s) =>
            s.step === step ? { ...s, status: 'done' } : s,
          ),
        },
      }))
    }

    case 'tool_result': {
      const { sessionId, data } = action
      const now = nowFrom(action)
      return updateSession(state, sessionId, (session) => {
        const entry = {
          tool: data && data.tool,
          arguments: data && data.arguments,
          success: !!(data && data.success),
          content: data && data.content,
          error: data && data.error,
          timestamp: now,
        }
        return {
          ...session,
          updatedAt: now,
          lastTool: entry,
          activity: {
            ...session.activity,
            toolResults: [...session.activity.toolResults, entry],
            hasNewActivity: true,
          },
        }
      })
    }

    case 'attention_requested': {
      const { sessionId, permission } = action
      const now = nowFrom(action)
      return updateSession(state, sessionId, (session) => ({
        ...session,
        status: 'needs_input',
        updatedAt: now,
        permissionRequest: permission || null,
        activity: {
          ...session.activity,
          thinking: { ...session.activity.thinking, active: false },
        },
      }))
    }

    case 'attention_resolved': {
      const { sessionId, resolution } = action
      const now = nowFrom(action)
      return updateSession(state, sessionId, (session) => ({
        ...session,
        status: 'running',
        updatedAt: now,
        permissionRequest: null,
        activity: {
          ...session.activity,
          thinking: { ...session.activity.thinking, active: true },
        },
      }))
      // resolution is intentionally unused at the reducer level — the
      // backend applies the allow/deny decision and continues the turn.
      void resolution
    }

    case 'attention_expired': {
      const { sessionId, requestId, reason } = action
      const now = nowFrom(action)
      return updateSession(state, sessionId, (session) => {
        const toolName =
          (session.permissionRequest && session.permissionRequest.toolName) ||
          (session.permissionRequest && session.permissionRequest.tool) ||
          'unknown'
        const failed = {
          tool: toolName,
          arguments: null,
          success: false,
          content: null,
          error: reason == null ? 'Timed out' : String(reason),
          timestamp: now,
          permissionRequestId: requestId,
        }
        return {
          ...session,
          // Backend continues the turn with the rejected permission, so
          // the run is still active — status returns to running.
          status: 'running',
          updatedAt: now,
          permissionRequest: null,
          activity: {
            ...session.activity,
            toolResults: [...session.activity.toolResults, failed],
            hasNewActivity: true,
            thinking: { ...session.activity.thinking, active: true },
          },
        }
      })
    }

    case 'session_acknowledged': {
      const { sessionId } = action
      const now = nowFrom(action)
      return updateSession(state, sessionId, (session) =>
        withUpdatedAt({ ...session, unread: false }, now),
      )
    }

    case 'session_cleared': {
      const { sessionId } = action
      const now = nowFrom(action)
      return updateSession(state, sessionId, (session) => ({
        ...session,
        status: 'idle',
        phase: null,
        startedAt: null,
        updatedAt: now,
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
      }))
    }

    case 'plan_created': {
      const { sessionId, items, sourcePrompt, sourceAttachment } = action
      const now = nowFrom(action)
      return updateSession(state, sessionId, (session) => ({
        ...session,
        updatedAt: now,
        activity: {
          ...session.activity,
          plan: {
            items: (items || []).map((item, i) => ({
              id: i,
              text: String(item),
              status: 'pending',
            })),
            sourcePrompt: sourcePrompt == null ? '' : String(sourcePrompt),
            sourceAttachment: sourceAttachment ?? null,
            approved: false,
          },
        },
      }))
    }

    case 'plan_item_updated': {
      const { sessionId, id, text } = action
      const now = nowFrom(action)
      return updateSession(state, sessionId, (session) => ({
        ...session,
        updatedAt: now,
        activity: {
          ...session.activity,
          plan: {
            ...session.activity.plan,
            items: session.activity.plan.items.map((item) =>
              item.id === id ? { ...item, text } : item,
            ),
          },
        },
      }))
    }

    case 'plan_item_toggled': {
      const { sessionId, id } = action
      const now = nowFrom(action)
      return updateSession(state, sessionId, (session) => ({
        ...session,
        updatedAt: now,
        activity: {
          ...session.activity,
          plan: {
            ...session.activity.plan,
            items: session.activity.plan.items.map((item) =>
              item.id === id
                ? { ...item, status: item.status === 'done' ? 'pending' : 'done' }
                : item,
            ),
          },
        },
      }))
    }

    case 'plan_item_removed': {
      const { sessionId, id } = action
      const now = nowFrom(action)
      return updateSession(state, sessionId, (session) => ({
        ...session,
        updatedAt: now,
        activity: {
          ...session.activity,
          plan: {
            ...session.activity.plan,
            items: session.activity.plan.items
              .filter((item) => item.id !== id)
              .map((item, i) => ({ ...item, id: i })),
          },
        },
      }))
    }

    case 'plan_item_added': {
      const { sessionId, text } = action
      const now = nowFrom(action)
      return updateSession(state, sessionId, (session) => ({
        ...session,
        updatedAt: now,
        activity: {
          ...session.activity,
          plan: {
            ...session.activity.plan,
            items: [
              ...session.activity.plan.items,
              { id: session.activity.plan.items.length, text, status: 'pending' },
            ],
          },
        },
      }))
    }

    case 'plan_cleared': {
      const { sessionId } = action
      const now = nowFrom(action)
      return updateSession(state, sessionId, (session) => ({
        ...session,
        updatedAt: now,
        activity: {
          ...session.activity,
          plan: { items: [], sourcePrompt: '', sourceAttachment: null, approved: false },
        },
      }))
    }

    case 'plan_approved': {
      const { sessionId } = action
      const now = nowFrom(action)
      return updateSession(state, sessionId, (session) => ({
        ...session,
        updatedAt: now,
        activity: {
          ...session.activity,
          plan: { ...session.activity.plan, approved: true },
        },
      }))
    }

    default:
      return state
  }
}

// Selectors ---------------------------------------------------------------

export function selectSession(state, sessionId) {
  if (!state || !sessionId) return null
  return state[sessionId] || null
}

const STATUS_PRIORITY = ['needs_input', 'error', 'running', 'completed', 'idle']

function deriveStatus(sessions) {
  for (const status of STATUS_PRIORITY) {
    if (sessions.some((s) => s.status === status)) return status
  }
  return 'idle'
}

function summarizeSessions(sessions) {
  const runningCount = sessions.filter((s) => s.status === 'running').length
  const attentionCount = sessions.filter((s) => s.status === 'needs_input').length
  const errorCount = sessions.filter((s) => s.status === 'error').length
  const completedCount = sessions.filter((s) => s.status === 'completed').length
  return {
    status: deriveStatus(sessions),
    runningCount,
    attentionCount,
    errorCount,
    completedCount,
    sessions: sessions
      .filter((s) => s.status === 'running' || s.status === 'needs_input' || s.unread)
      .sort((a, b) => a.updatedAt - b.updatedAt),
  }
}

export function selectGlobalSummary(state) {
  const sessions = state ? Object.values(state) : []
  return summarizeSessions(sessions)
}

export function selectTabSummary(state, tabId) {
  if (!state || !tabId) {
    return summarizeSessions([])
  }
  const sessions = Object.values(state).filter((s) => s && s.tabId === tabId)
  return summarizeSessions(sessions)
}