// AgentActivityContext.test.jsx — provider/hook contract tests.
//
// These tests prove the brief's Session 1 hooks actually behave the way
// downstream panels will rely on:
//
//   - useAgentActivity throws when consumed outside the provider
//   - registerSession creates independent session keys
//   - bound dispatchers update only the targeted session
//   - bound plan actions don't bleed across sessions
//   - hidden completion (unread) on one session leaves siblings untouched
//   - bound action identities stay stable across unrelated-session dispatches
//
// We use renderHook with the provider as `wrapper` so the React tree
// behaves exactly as in production — useReducer + context propagation
// is what we're testing, not a manual store.

import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  AgentActivityProvider,
  useAgentActivity,
  useSessionActivity,
} from './AgentActivityContext.jsx'

function withProvider() {
  return ({ children }) => (
    <AgentActivityProvider>{children}</AgentActivityProvider>
  )
}

describe('AgentActivityProvider', () => {
  it('throws if useAgentActivity is called outside the provider', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderHook(() => useAgentActivity())).toThrow(
      /must be used inside AgentActivityProvider/,
    )
    errSpy.mockRestore()
  })

  it('throws if useSessionActivity is called outside the provider', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderHook(() => useSessionActivity('chat-1'))).toThrow(
      /must be used inside AgentActivityProvider/,
    )
    errSpy.mockRestore()
  })

  it('registerSession creates independent keys for Chat and Coding', () => {
    const { result } = renderHook(
      () => {
        const ctx = useAgentActivity()
        return { ctx, hook: useSessionActivity('chat-1') }
      },
      { wrapper: withProvider() },
    )

    act(() => {
      result.current.ctx.registerSession({
        sessionId: 'chat-1',
        tabId: 'chat',
        kind: 'chat',
        title: 'Chat one',
      })
      result.current.ctx.registerSession({
        sessionId: 'coding-1',
        tabId: 'code',
        kind: 'coding',
        title: 'Code one',
      })
    })

    expect(Object.keys(result.current.ctx.sessions).sort()).toEqual([
      'chat-1',
      'coding-1',
    ])
    expect(result.current.ctx.sessions['chat-1'].tabId).toBe('chat')
    expect(result.current.ctx.sessions['coding-1'].tabId).toBe('code')
  })

  it('addStep on Chat does not change Coding', () => {
    const { result } = renderHook(
      () => {
        const ctx = useAgentActivity()
        return {
          chat: useSessionActivity('chat-1'),
          coding: useSessionActivity('coding-1'),
          ctx,
        }
      },
      { wrapper: withProvider() },
    )

    act(() => {
      result.current.ctx.registerSession({
        sessionId: 'chat-1',
        tabId: 'chat',
        kind: 'chat',
        title: 'Chat one',
      })
      result.current.ctx.registerSession({
        sessionId: 'coding-1',
        tabId: 'code',
        kind: 'coding',
        title: 'Code one',
      })
    })

    // Capture reducer-level session identity — what truly proves
    // isolation between siblings. Hook-level flattened objects can
    // reallocate per render without violating the isolation contract.
    const codingSessionBefore = result.current.ctx.sessions['coding-1']
    const chatSessionBefore = result.current.ctx.sessions['chat-1']

    act(() => {
      result.current.chat.addStep(1, 4)
    })

    // Reducer isolation: Coding session record is untouched by Chat dispatch.
    expect(result.current.ctx.sessions['coding-1']).toBe(codingSessionBefore)
    expect(result.current.ctx.sessions['coding-1'].activity.steps).toEqual([])
    // Chat got a new step record (session identity changes when reducer
    // produced a new session reference).
    expect(result.current.ctx.sessions['chat-1']).not.toBe(chatSessionBefore)
    expect(result.current.ctx.sessions['chat-1'].activity.steps).toHaveLength(1)
    expect(result.current.ctx.sessions['chat-1'].activity.steps[0]).toMatchObject({
      step: 1,
      maxSteps: 4,
      status: 'running',
    })
  })

  it('bound plan actions update only the selected Coding session', () => {
    const { result } = renderHook(
      () => {
        const ctx = useAgentActivity()
        return {
          chat: useSessionActivity('chat-1'),
          coding: useSessionActivity('coding-1'),
          ctx,
        }
      },
      { wrapper: withProvider() },
    )

    act(() => {
      result.current.ctx.registerSession({
        sessionId: 'chat-1',
        tabId: 'chat',
        kind: 'chat',
        title: 'Chat one',
      })
      result.current.ctx.registerSession({
        sessionId: 'coding-1',
        tabId: 'code',
        kind: 'coding',
        title: 'Code one',
      })
    })

    act(() => {
      result.current.coding.createPlan(['first', 'second'], 'plan prompt', null)
    })

    expect(result.current.coding.plan.items.map((i) => i.text)).toEqual([
      'first',
      'second',
    ])
    expect(result.current.coding.plan.sourcePrompt).toBe('plan prompt')
    expect(result.current.chat.plan.items).toEqual([])

    act(() => {
      result.current.coding.togglePlanItem(0)
    })
    expect(result.current.coding.plan.items[0].status).toBe('done')
    expect(result.current.chat.plan.items).toEqual([])

    act(() => {
      result.current.coding.updatePlanItem(1, 'SECOND')
    })
    expect(result.current.coding.plan.items[1].text).toBe('SECOND')
    expect(result.current.chat.plan.items).toEqual([])

    act(() => {
      result.current.coding.addPlanItem('third')
    })
    expect(result.current.coding.plan.items.map((i) => i.text)).toEqual([
      'first',
      'SECOND',
      'third',
    ])
    expect(result.current.chat.plan.items).toEqual([])

    act(() => {
      result.current.coding.removePlanItem(0)
    })
    expect(result.current.coding.plan.items.map((i) => i.text)).toEqual([
      'SECOND',
      'third',
    ])
    expect(result.current.chat.plan.items).toEqual([])

    act(() => {
      result.current.coding.approvePlan()
    })
    expect(result.current.coding.plan.approved).toBe(true)
    expect(result.current.chat.plan.approved).toBe(false)

    act(() => {
      result.current.coding.clearPlan()
    })
    expect(result.current.coding.plan.items).toEqual([])
    expect(result.current.coding.plan.sourcePrompt).toBe('')
    expect(result.current.coding.plan.approved).toBe(false)
    expect(result.current.chat.plan.items).toEqual([])
  })

  it('completing hidden Chat with unread leaves Coding status unchanged', () => {
    const { result } = renderHook(
      () => {
        const ctx = useAgentActivity()
        return {
          chat: useSessionActivity('chat-1'),
          coding: useSessionActivity('coding-1'),
          ctx,
        }
      },
      { wrapper: withProvider() },
    )

    act(() => {
      result.current.ctx.registerSession({
        sessionId: 'chat-1',
        tabId: 'chat',
        kind: 'chat',
        title: 'Chat one',
      })
      result.current.ctx.registerSession({
        sessionId: 'coding-1',
        tabId: 'code',
        kind: 'coding',
        title: 'Code one',
      })
      // Put Chat through a real run so completion is a meaningful transition.
      result.current.ctx.startRun('chat-1')
    })

    const codingStatusBefore = result.current.coding.status

    act(() => {
      result.current.chat.completeRun({ unread: true })
    })

    expect(result.current.chat.status).toBe('completed')
    expect(result.current.chat.unread).toBe(true)
    expect(result.current.coding.status).toBe(codingStatusBefore)
    expect(result.current.coding).not.toBe(result.current.chat)
  })

  it('keeps bound Coding action identities stable across unrelated Chat dispatches', () => {
    // Regression: bound dispatchers must be referentially stable when the
    // targeted session record does not change. Without actionsRef.current,
    // every Chat dispatch rebuilds Coding's returned object and every
    // bound arrow function — forcing downstream memoization to break.
    const { result } = renderHook(
      () => {
        const ctx = useAgentActivity()
        return {
          chat: useSessionActivity('chat-1'),
          coding: useSessionActivity('coding-1'),
          ctx,
        }
      },
      { wrapper: withProvider() },
    )

    act(() => {
      result.current.ctx.registerSession({
        sessionId: 'chat-1',
        tabId: 'chat',
        kind: 'chat',
        title: 'Chat one',
      })
      result.current.ctx.registerSession({
        sessionId: 'coding-1',
        tabId: 'code',
        kind: 'coding',
        title: 'Code one',
      })
    })

    // Snapshot every Coding bound dispatcher before unrelated churn.
    const codingBefore = {
      obj: result.current.coding,
      startRun: result.current.coding.startRun,
      setPhase: result.current.coding.setPhase,
      setThinkingState: result.current.coding.setThinkingState,
      setThinkingDuration: result.current.coding.setThinkingDuration,
      addStep: result.current.coding.addStep,
      completeStep: result.current.coding.completeStep,
      addToolResult: result.current.coding.addToolResult,
      requestAttention: result.current.coding.requestAttention,
      resolveAttention: result.current.coding.resolveAttention,
      expireAttention: result.current.coding.expireAttention,
      completeRun: result.current.coding.completeRun,
      failRun: result.current.coding.failRun,
      failRunIfActive: result.current.coding.failRunIfActive,
      acknowledgeSession: result.current.coding.acknowledgeSession,
      clearActivity: result.current.coding.clearActivity,
      createPlan: result.current.coding.createPlan,
      updatePlanItem: result.current.coding.updatePlanItem,
      togglePlanItem: result.current.coding.togglePlanItem,
      removePlanItem: result.current.coding.removePlanItem,
      addPlanItem: result.current.coding.addPlanItem,
      clearPlan: result.current.coding.clearPlan,
      approvePlan: result.current.coding.approvePlan,
    }

    // Drive multiple unrelated Chat dispatches.
    act(() => {
      result.current.chat.startRun()
      result.current.chat.setThinkingState(true, 'reasoning...')
      result.current.chat.addStep(1, 4)
      result.current.chat.completeStep(1)
      result.current.chat.addToolResult({ tool: 'write_file', success: true })
      result.current.chat.setThinkingDuration(3)
      result.current.chat.completeRun({ unread: true })
      result.current.chat.acknowledgeSession()
    })

    // Coding returned object + every bound action must be the same reference.
    expect(result.current.coding).toBe(codingBefore.obj)
    expect(result.current.coding.startRun).toBe(codingBefore.startRun)
    expect(result.current.coding.setPhase).toBe(codingBefore.setPhase)
    expect(result.current.coding.setThinkingState).toBe(codingBefore.setThinkingState)
    expect(result.current.coding.setThinkingDuration).toBe(codingBefore.setThinkingDuration)
    expect(result.current.coding.addStep).toBe(codingBefore.addStep)
    expect(result.current.coding.completeStep).toBe(codingBefore.completeStep)
    expect(result.current.coding.addToolResult).toBe(codingBefore.addToolResult)
    expect(result.current.coding.requestAttention).toBe(codingBefore.requestAttention)
    expect(result.current.coding.resolveAttention).toBe(codingBefore.resolveAttention)
    expect(result.current.coding.expireAttention).toBe(codingBefore.expireAttention)
    expect(result.current.coding.completeRun).toBe(codingBefore.completeRun)
    expect(result.current.coding.failRun).toBe(codingBefore.failRun)
    expect(result.current.coding.failRunIfActive).toBe(codingBefore.failRunIfActive)
    expect(result.current.coding.acknowledgeSession).toBe(codingBefore.acknowledgeSession)
    expect(result.current.coding.clearActivity).toBe(codingBefore.clearActivity)
    expect(result.current.coding.createPlan).toBe(codingBefore.createPlan)
    expect(result.current.coding.updatePlanItem).toBe(codingBefore.updatePlanItem)
    expect(result.current.coding.togglePlanItem).toBe(codingBefore.togglePlanItem)
    expect(result.current.coding.removePlanItem).toBe(codingBefore.removePlanItem)
    expect(result.current.coding.addPlanItem).toBe(codingBefore.addPlanItem)
    expect(result.current.coding.clearPlan).toBe(codingBefore.clearPlan)
    expect(result.current.coding.approvePlan).toBe(codingBefore.approvePlan)

    // Coding session record was never touched — its activity container
    // must remain in the initial idle shape.
    expect(result.current.coding.steps).toEqual([])
    expect(result.current.coding.toolResults).toEqual([])
    expect(result.current.coding.plan.items).toEqual([])
    expect(result.current.coding.thinking).toEqual({
      active: false,
      duration: 0,
      content: '',
    })
  })
})