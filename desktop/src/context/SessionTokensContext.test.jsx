// SessionTokensContext.test.jsx — provider/hook contract tests for
// Task 2's controlled visibility.
//
// The provider no longer owns an internal "active" session id. The
// App (or any parent) passes `visibleSessionId` as a prop, and
// `useVisibleSessionTokens()` reads that exact bucket. Panels
// report their own current session id via `onSessionIdChange`.
//
// These tests prove:
//   - useVisibleSessionTokens returns the bucket for visibleSessionId
//     and null when no prop is passed or no bucket exists yet
//   - rerendering the provider with a different visibleSessionId
//     changes the returned bucket
//   - recordUsage keeps accumulating into BOTH buckets regardless of
//     which is currently visible (rerendering does not delete either)
//   - the legacy `useActiveSessionTokens` helper is gone; only the
//     visible hook survives
//
// IMPORTANT: recordUsage is a parent setState. Calling it from inside
// a child's render body creates an infinite render loop (provider
// re-renders, child renders, child calls recordUsage, repeat). All
// seeding here happens in useEffect callbacks (Recorder) or is driven
// from the test body via act() (continuous-record test).

import { describe, expect, it, beforeEach } from 'vitest'
import React, { useEffect } from 'react'
import { act, render } from '@testing-library/react'
import {
  SessionTokensProvider,
  useSessionTokens,
  useVisibleSessionTokens,
} from './SessionTokensContext.jsx'

// Tiny harness — mirrors the brief's "render a provider through a
// small harness" recipe. Lets us drive `visibleSessionId` from the
// outside and observe what the hook returns under both keepalive
// panels.
function Harness({ visibleSessionId, children }) {
  return (
    <SessionTokensProvider visibleSessionId={visibleSessionId}>
      {children}
    </SessionTokensProvider>
  )
}

// Recorder — wraps `recordUsage` calls in a one-shot effect so we
// never setState on the parent from inside a child's render. Takes
// a list of [sessionId, usage] tuples so a single component can
// seed multiple buckets in one effect.
function Recorder({ sessions }) {
  const { recordUsage } = useSessionTokens()
  useEffect(() => {
    for (const [sid, usage] of sessions) recordUsage(sid, usage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

beforeEach(() => {
  // Each test starts from a clean persisted store — localStorage is
  // already cleared by vitest.setup.js's afterEach, but be explicit.
  if (typeof localStorage !== 'undefined') localStorage.clear()
})

describe('SessionTokensProvider — controlled visibility', () => {
  it('exposes useVisibleSessionTokens that reads the controlled prop', () => {
    let observed = null
    function Probe() {
      observed = useVisibleSessionTokens()
      return null
    }
    render(
      <Harness visibleSessionId="chat-1">
        <Probe />
      </Harness>,
    )
    // No usage recorded yet → bucket is null.
    expect(observed).toBeNull()
  })

  it('returns the bucket for the visible session id once usage is recorded', () => {
    let observed = null
    function Probe() {
      observed = useVisibleSessionTokens()
      return null
    }
    render(
      <Harness visibleSessionId="chat-1">
        <Recorder sessions={[
          ['chat-1', { input_tokens: 100, output_tokens: 50 }],
          ['coding-1', { input_tokens: 999, output_tokens: 0 }],
        ]} />
        <Probe />
      </Harness>,
    )
    expect(observed).toMatchObject({
      input_tokens: 100,
      output_tokens: 50,
    })
  })

  it('rerendering with a different visibleSessionId swaps the bucket (without dropping the other)', () => {
    let observed = null
    function Probe() {
      observed = useVisibleSessionTokens()
      return null
    }
    const seed = [
      ['chat-1', { input_tokens: 100, output_tokens: 50 }],
      ['coding-1', { input_tokens: 300, output_tokens: 75 }],
    ]
    const { rerender } = render(
      <Harness visibleSessionId="chat-1">
        <Recorder sessions={seed} />
        <Probe />
      </Harness>,
    )
    expect(observed.input_tokens).toBe(100)
    expect(observed.output_tokens).toBe(50)

    // Switch visibility to coding-1 — chat-1 bucket must remain.
    rerender(
      <Harness visibleSessionId="coding-1">
        <Recorder sessions={seed} />
        <Probe />
      </Harness>,
    )
    expect(observed.input_tokens).toBe(300)
    expect(observed.output_tokens).toBe(75)

    // Both buckets still readable through useSessionTokens directly.
    let sessions = null
    function SessionsProbe() {
      sessions = useSessionTokens().sessions
      return null
    }
    rerender(
      <Harness visibleSessionId="coding-1">
        <Recorder sessions={seed} />
        <Probe />
        <SessionsProbe />
      </Harness>,
    )
    expect(Object.keys(sessions).sort()).toEqual(['chat-1', 'coding-1'])
    expect(sessions['chat-1'].input_tokens).toBe(100)
    expect(sessions['coding-1'].input_tokens).toBe(300)
  })

  it('records into both buckets continuously — visibility swap does not lose accumulated totals', () => {
    let observed = null
    let ctxRef = null
    function Probe() {
      observed = useVisibleSessionTokens()
      return null
    }
    function ContextHolder() {
      ctxRef = useSessionTokens()
      return null
    }
    const { rerender } = render(
      <Harness visibleSessionId="chat-1">
        <ContextHolder />
        <Probe />
      </Harness>,
    )
    // Drive recordUsage from the test body via the captured ctxRef.
    // act() flushes the resulting setState synchronously.
    act(() => {
      ctxRef.recordUsage('chat-1', { input_tokens: 10, output_tokens: 1 })
      ctxRef.recordUsage('chat-1', { input_tokens: 5, output_tokens: 1 })
    })
    expect(observed.input_tokens).toBe(15)

    // Rerender with coding-1 visible. Record more into coding-1.
    rerender(
      <Harness visibleSessionId="coding-1">
        <ContextHolder />
        <Probe />
      </Harness>,
    )
    act(() => {
      ctxRef.recordUsage('coding-1', { input_tokens: 7, output_tokens: 2 })
      ctxRef.recordUsage('coding-1', { input_tokens: 3, output_tokens: 2 })
    })
    expect(observed.input_tokens).toBe(10)
    expect(observed.output_tokens).toBe(4)

    // Switch back to chat-1 — its 15/2 should still be there.
    rerender(
      <Harness visibleSessionId="chat-1">
        <ContextHolder />
        <Probe />
      </Harness>,
    )
    expect(observed.input_tokens).toBe(15)
    expect(observed.output_tokens).toBe(2)
  })

  it('returns null when visibleSessionId is null (no controlled owner yet)', () => {
    let observed = 'unset'
    function Probe() {
      observed = useVisibleSessionTokens()
      return null
    }
    render(
      <SessionTokensProvider>
        <Probe />
      </SessionTokensProvider>,
    )
    expect(observed).toBeNull()
  })

  it('does not expose an internal activeSessionId — visibility is a prop, not state', () => {
    // The controlled contract: the provider hands out sessions, but
    // does NOT own a "current" id internally. Backwards-compat
    // callers of useSessionTokens() should no longer see
    // activeSessionId / setActiveSessionId on the context object.
    let ctx = null
    function Probe() {
      ctx = useSessionTokens()
      return null
    }
    render(
      <Harness visibleSessionId="chat-1">
        <Probe />
      </Harness>,
    )
    expect(ctx).toHaveProperty('sessions')
    expect(ctx).toHaveProperty('visibleSessionId')
    expect(ctx).toHaveProperty('recordUsage')
    expect(ctx).toHaveProperty('resetSession')
    expect(ctx).toHaveProperty('clearAll')
    expect(ctx).not.toHaveProperty('activeSessionId')
    expect(ctx).not.toHaveProperty('setActiveSessionId')
  })
})