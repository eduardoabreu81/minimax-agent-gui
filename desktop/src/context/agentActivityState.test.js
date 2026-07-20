import { describe, expect, it } from 'vitest'
import {
  agentActivityReducer,
  createSessionActivity,
  selectGlobalSummary,
  selectTabSummary,
} from './agentActivityState.js'

const reduce = (state, action) => agentActivityReducer(state, action)

function registered() {
  let state = {}
  state = reduce(state, { type: 'register', metadata: { sessionId: 'chat-1', tabId: 'chat', kind: 'chat', title: 'Chat one' } })
  state = reduce(state, { type: 'register', metadata: { sessionId: 'coding-1', tabId: 'code', kind: 'coding', title: 'Code one' } })
  return state
}

describe('agentActivityReducer', () => {
  it('updates one session without changing the other session object', () => {
    const before = registered()
    const codeBefore = before['coding-1']
    const after = reduce(before, { type: 'run_started', sessionId: 'chat-1', now: 100 })
    expect(after['chat-1'].status).toBe('running')
    expect(after['chat-1'].startedAt).toBe(100)
    expect(after['coding-1']).toBe(codeBefore)
  })

  it('tracks attention, timeout, and hidden completion as explicit states', () => {
    let state = registered()
    state = reduce(state, { type: 'run_started', sessionId: 'chat-1', now: 100 })
    state = reduce(state, {
      type: 'attention_requested', sessionId: 'chat-1', now: 200,
      permission: { requestId: 'req-1', toolName: 'bash', expiresAt: 120200 },
    })
    expect(state['chat-1'].status).toBe('needs_input')
    state = reduce(state, { type: 'attention_expired', sessionId: 'chat-1', requestId: 'req-1', reason: 'Timed out', now: 120200 })
    expect(state['chat-1'].status).toBe('running')
    expect(state['chat-1'].permissionRequest).toBeNull()
    expect(state['chat-1'].activity.toolResults.at(-1)).toMatchObject({ tool: 'bash', success: false, error: 'Timed out' })
    state = reduce(state, { type: 'run_completed', sessionId: 'chat-1', unread: true, now: 120300 })
    expect(state['chat-1']).toMatchObject({ status: 'completed', unread: true })
  })

  it('uses one shared global priority', () => {
    let state = registered()
    state = reduce(state, { type: 'run_started', sessionId: 'chat-1', now: 1 })
    state = reduce(state, { type: 'run_failed', sessionId: 'coding-1', error: 'socket closed', unread: true, now: 2 })
    expect(selectGlobalSummary(state).status).toBe('error')
    state = reduce(state, {
      type: 'attention_requested', sessionId: 'chat-1', now: 3,
      permission: { requestId: 'r', toolName: 'write_file', expiresAt: 120003 },
    })
    expect(selectGlobalSummary(state).status).toBe('needs_input')
    expect(selectTabSummary(state, 'chat').status).toBe('needs_input')
  })
})

describe('createSessionActivity', () => {
  it('creates isolated nested activity containers', () => {
    const a = createSessionActivity({ sessionId: 'a', tabId: 'chat', kind: 'chat', title: 'A' })
    const b = createSessionActivity({ sessionId: 'b', tabId: 'code', kind: 'coding', title: 'B' })
    expect(a.activity.steps).not.toBe(b.activity.steps)
    expect(a.activity.plan.items).not.toBe(b.activity.plan.items)
  })
})