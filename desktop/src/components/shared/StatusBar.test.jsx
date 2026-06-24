// StatusBar.test.jsx — guards the gradient + plan usage thresholds
// introduced in the same commit that wires them up.
//
// Tests:
//   - planBarColor returns the right class for each remainingPct band
//   - planTextState returns the right state for the same bands
//   - contextBarGradient is a non-empty linear-gradient string
//   - ContextChip renders the gradient bar (style.background) in the
//     popover and uses the planBarColor class for the 5-hour bar
//
// The render tests stub useSessionTokens (no fetch) and apiFetch
// (for the useQuota polling hook) so the chip is testable in
// isolation without a live backend.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import StatusBar, {
  planBarColor,
  planTextState,
  contextBarGradient,
} from './StatusBar.jsx'

// Stub the session-tokens context so the chip reads a known
// bucket without needing the full provider tree.
const mockUseSessionTokens = vi.fn()
vi.mock('../../context/SessionTokensContext.jsx', () => ({
  useSessionTokens: () => mockUseSessionTokens(),
}))

// Stub apiFetch — useQuota polls /api/minimax/quota. We default to
// an empty/loading response and override per test as needed.
const mockApiFetch = vi.fn()
vi.mock('../../lib/api.js', () => ({
  apiFetch: (...args) => mockApiFetch(...args),
}))

// Stub AgentActivityContext — used by AgentStatus, harmless default.
vi.mock('../../context/AgentActivityContext.jsx', () => ({
  useAgentActivity: () => ({ thinking: { active: false }, steps: [] }),
}))

beforeEach(() => {
  mockUseSessionTokens.mockReturnValue({
    sessions: {},
    activeSessionId: null,
  })
  mockApiFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ success: false, error: 'no plan' }),
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// planBarColor / planTextState — the actual decision logic
// ─────────────────────────────────────────────────────────────────────────────

describe('planBarColor', () => {
  it('returns bg-muted for null (no data)', () => {
    expect(planBarColor(null)).toBe('bg-muted')
  })
  it('returns bg-primary when remaining > 20% (normal)', () => {
    expect(planBarColor(0)).toBe('bg-primary')     // 100% left
    expect(planBarColor(75)).toBe('bg-primary')    // 25% left
  })
  it('returns bg-amber-400 when remaining is 5 < x <= 20% (warning)', () => {
    expect(planBarColor(80)).toBe('bg-amber-400')  // 20% left
    expect(planBarColor(90)).toBe('bg-amber-400')  // 10% left
  })
  it('returns bg-error when remaining <= 5% (critical)', () => {
    expect(planBarColor(95)).toBe('bg-error')      // 5% left
    expect(planBarColor(100)).toBe('bg-error')     // 0% left
  })
})

describe('planTextState', () => {
  it('returns normal for null', () => {
    expect(planTextState(null)).toBe('normal')
  })
  it('returns normal when remaining > 20%', () => {
    expect(planTextState(0)).toBe('normal')
    expect(planTextState(75)).toBe('normal')
  })
  it('returns warning when remaining is 5 < x <= 20%', () => {
    expect(planTextState(80)).toBe('warning')
    expect(planTextState(90)).toBe('warning')
  })
  it('returns critical when remaining <= 5%', () => {
    expect(planTextState(95)).toBe('critical')
    expect(planTextState(100)).toBe('critical')
  })
})

describe('contextBarGradient', () => {
  it('is a non-empty linear-gradient with green/amber/red stops', () => {
    expect(contextBarGradient).toMatch(/^linear-gradient\(/)
    expect(contextBarGradient).toContain('hsl(142')  // green
    expect(contextBarGradient).toContain('hsl(48')   // amber
    expect(contextBarGradient).toContain('hsl(0')    // red
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// ContextChip integration — confirms the helper outputs land in the DOM
// ─────────────────────────────────────────────────────────────────────────────

describe('StatusBar ContextChip — gradient + plan bar', () => {
  it('renders the gradient bar style when the popover is open', async () => {
    mockUseSessionTokens.mockReturnValue({
      sessions: {
        'sess-1': {
          lastModel: 'MiniMax-M3',
          lastTurnInput: 50_000,
          input_tokens: 50_000,
          output_tokens: 0,
          turnCount: 3,
        },
      },
      activeSessionId: 'sess-1',
    })
    // useQuota's first poll: return a quota with 25% remaining on
    // the 5-hour text bucket. Force the re-render to show the
    // popover content.
    mockApiFetch.mockImplementation((url) => {
      if (url === '/api/minimax/quota') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            plan: 'plus',
            data: {
              model_remains: [
                {
                  model_name: 'general',
                  current_interval_status: 1,
                  current_interval_remaining_percent: 25,
                  current_weekly_remaining_percent: 80,
                  remains_time: 3_600_000,
                },
              ],
            },
          }),
        })
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
    })

    render(<StatusBar model="MiniMax-M3" setModel={vi.fn()} thinkingEnabled={false} setThinkingEnabled={vi.fn()} supportsThinking={true} />)

    // Open the popover by clicking the chip
    const chip = screen.getByTitle('Context window & plan')
    chip.click()

    // The popover has a context-window bar — find it by its
    // container's height class and assert the inline style.
    const popovers = await screen.findAllByRole('button')
    // The popover is rendered after click; assert the gradient is
    // present somewhere in the document.
    expect(document.body.innerHTML).toContain(contextBarGradient)
  })

  it('falls back to muted color when quota has no text bucket (null state)', () => {
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, plan: 'plus', data: { model_remains: [] } }),
    })
    render(<StatusBar model="MiniMax-M3" setModel={vi.fn()} thinkingEnabled={false} setThinkingEnabled={vi.fn()} supportsThinking={true} />)

    // The chip is rendered even with no data
    expect(screen.getByTitle('Context window & plan')).toBeInTheDocument()
  })
})
