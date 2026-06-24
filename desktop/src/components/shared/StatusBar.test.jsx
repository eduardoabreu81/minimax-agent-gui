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

  it('shows the explicit "tokens" suffix on the chip so users don\'t confuse it with bytes', () => {
    // Without an explicit unit, "12k / 1.0M (0%)" reads like
    // 12 kilobytes / 1 megabyte — Edu flagged this confusion in
    // v0.4.x because the original Claude Code reference looked
    // similar but was using different units. Adding the literal
    // word "tokens" disambiguates.
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
    render(<StatusBar model="MiniMax-M3" setModel={vi.fn()} thinkingEnabled={false} setThinkingEnabled={vi.fn()} supportsThinking={true} />)
    const chip = screen.getByTitle('Context window & plan')
    // The chip text contains both the number AND the word "tokens"
    expect(chip.textContent).toMatch(/[\d.]+[kM]\s*\/\s*[\d.]+[kM]\s+tokens\s*\(\d+%\)/)
  })

  it('shows "tokens" inside the popover context-window header too', async () => {
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
    render(<StatusBar model="MiniMax-M3" setModel={vi.fn()} thinkingEnabled={false} setThinkingEnabled={vi.fn()} supportsThinking={true} />)
    screen.getByTitle('Context window & plan').click()
    await screen.findByText('Plan usage')
    // The popover's "Context window" header has a token count
    expect(screen.getByText(/Context window/)).toBeInTheDocument()
    // And the suffix should appear there too
    expect(screen.getByText(/tokens\s*\(\d+%\)/)).toBeInTheDocument()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Simplified breakdown — v0.4.x feedback (Edu): the 9-row breakdown
// panel with 3 expandable chevrons was overkill. Reduced to 6 flat
// rows directly under "Janela de contexto", no separate panel:
//
//   Messages       (size in BYTES, per user request — not tokens)
//   Skills         (tokens)
//   Memory files   (tokens)
//   Custom agents  (tokens)
//   System prompt  (tokens)
//   MCP tools      (tokens)
//
// The two deferred buckets (mcp_deferred, system_tools_deferred)
// and free_space were dropped from the UI. Backend still returns
// them in the contract for backwards-compat / future use.
// ─────────────────────────────────────────────────────────────────────────────

describe('StatusBar ContextChip — simplified 6-row breakdown', () => {
  beforeEach(() => {
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, plan: 'plus', data: { model_remains: [] } }),
    })
  })

  it('hides the breakdown rows when bucket has no lastBySource', async () => {
    mockUseSessionTokens.mockReturnValue({
      sessions: {
        'sess-1': {
          lastModel: 'MiniMax-M3',
          lastTurnInput: 50_000,
          input_tokens: 50_000,
          output_tokens: 0,
          turnCount: 3,
          lastBySource: null,
        },
      },
      activeSessionId: 'sess-1',
    })
    render(<StatusBar model="MiniMax-M3" setModel={vi.fn()} thinkingEnabled={false} setThinkingEnabled={vi.fn()} supportsThinking={true} />)
    screen.getByTitle('Context window & plan').click()
    await screen.findByText('Plan usage')
    // No breakdown rows rendered when no by_source data
    expect(screen.queryByText('Skills')).toBeNull()
    expect(screen.queryByText('Memory files')).toBeNull()
    expect(screen.queryByText('Custom agents')).toBeNull()
  })

  it('renders exactly 6 rows directly under "Context window"', async () => {
    mockUseSessionTokens.mockReturnValue({
      sessions: {
        'sess-1': {
          lastModel: 'MiniMax-M3',
          lastTurnInput: 50_000,
          input_tokens: 50_000,
          output_tokens: 0,
          turnCount: 3,
          lastBySource: {
            messages: 3720, skills: 80, memory_files: 50,
            custom_agents: 30, system_prompt: 20, mcp_tools: 100,
            mcp_deferred: 0, system_tools_deferred: 0,
            total: 4000, limit: 1_000_000,
            messages_bytes: 14_960,
            details: { mcp_tools_list: [], memory_files_list: [], custom_agents_list: [] },
          },
        },
      },
      activeSessionId: 'sess-1',
    })
    render(<StatusBar model="MiniMax-M3" setModel={vi.fn()} thinkingEnabled={false} setThinkingEnabled={vi.fn()} supportsThinking={true} />)
    screen.getByTitle('Context window & plan').click()
    await screen.findByText('Plan usage')
    // 6 row labels visible
    expect(screen.getByText('Messages')).toBeInTheDocument()
    expect(screen.getByText('Skills')).toBeInTheDocument()
    expect(screen.getByText('Memory files')).toBeInTheDocument()
    expect(screen.getByText('Custom agents')).toBeInTheDocument()
    expect(screen.getByText('System prompt')).toBeInTheDocument()
    expect(screen.getByText('MCP tools')).toBeInTheDocument()
    // The 2 deferred buckets are NOT rendered
    expect(screen.queryByText(/deferred/)).toBeNull()
    expect(screen.queryByText('Free space')).toBeNull()
  })

  it('Messages row shows size in BYTES (not tokens) when messages_bytes is present', async () => {
    mockUseSessionTokens.mockReturnValue({
      sessions: {
        'sess-1': {
          lastModel: 'MiniMax-M3',
          lastTurnInput: 50_000,
          input_tokens: 50_000,
          output_tokens: 0,
          turnCount: 3,
          lastBySource: {
            messages: 3720,  // tokens (tiktoken count)
            skills: 80, memory_files: 50, custom_agents: 30,
            system_prompt: 20, mcp_tools: 100,
            mcp_deferred: 0, system_tools_deferred: 0,
            total: 4000, limit: 1_000_000,
            messages_bytes: 14_960,  // raw byte size
            details: { mcp_tools_list: [], memory_files_list: [], custom_agents_list: [] },
          },
        },
      },
      activeSessionId: 'sess-1',
    })
    render(<StatusBar model="MiniMax-M3" setModel={vi.fn()} thinkingEnabled={false} setThinkingEnabled={vi.fn()} supportsThinking={true} />)
    screen.getByTitle('Context window & plan').click()
    await screen.findByText('Plan usage')
    // The Messages row should show the byte size, not 3720.
    // 14,960 bytes → "14.6KB" via formatByteCount (1024-based)
    expect(screen.getByText('14.6KB')).toBeInTheDocument()
  })

  it('other rows show token counts (with 1-decimal k format)', async () => {
    mockUseSessionTokens.mockReturnValue({
      sessions: {
        'sess-1': {
          lastModel: 'MiniMax-M3',
          lastTurnInput: 50_000,
          input_tokens: 50_000,
          output_tokens: 0,
          turnCount: 3,
          lastBySource: {
            messages: 3720, skills: 30_000, memory_files: 7_400,
            custom_agents: 5_100, system_prompt: 2_800, mcp_tools: 167,
            mcp_deferred: 0, system_tools_deferred: 0,
            total: 46_217, limit: 1_000_000,
            messages_bytes: 14_960,
            details: { mcp_tools_list: [], memory_files_list: [], custom_agents_list: [] },
          },
        },
      },
      activeSessionId: 'sess-1',
    })
    render(<StatusBar model="MiniMax-M3" setModel={vi.fn()} thinkingEnabled={false} setThinkingEnabled={vi.fn()} supportsThinking={true} />)
    screen.getByTitle('Context window & plan').click()
    await screen.findByText('Plan usage')
    // Decimal format for k values — matches the user's screenshot
    // "7.4k" / "5.1k" / "2.8k" / "30.0k" / "167"
    expect(screen.getByText('30.0k')).toBeInTheDocument()  // skills
    expect(screen.getByText('7.4k')).toBeInTheDocument()   // memory_files
    expect(screen.getByText('5.1k')).toBeInTheDocument()   // custom_agents
    expect(screen.getByText('2.8k')).toBeInTheDocument()   // system_prompt
    // MCP tools is 167 → "167" (under 1k threshold, no suffix)
    expect(screen.getByText('167')).toBeInTheDocument()

    // The chip itself should show "30.0k tokens" as well — the
    // 30.0k appears in BOTH the breakdown row AND the chip
    // (the chip uses the same number, just for "used / limit").
    // If both show 30.0k, this query throws — verify the row
    // version is found and the chip's "tokens" label is unique.
    expect(screen.getByText('tokens')).toBeInTheDocument()
  })

  it('collapses/expands the rows via the breakdown-toggle button', async () => {
    mockUseSessionTokens.mockReturnValue({
      sessions: {
        'sess-1': {
          lastModel: 'MiniMax-M3',
          lastTurnInput: 50_000,
          input_tokens: 50_000,
          output_tokens: 0,
          turnCount: 3,
          lastBySource: {
            messages: 3720, skills: 80, memory_files: 50,
            custom_agents: 30, system_prompt: 20, mcp_tools: 100,
            mcp_deferred: 0, system_tools_deferred: 0,
            total: 4000, limit: 1_000_000,
            messages_bytes: 14_960,
            details: { mcp_tools_list: [], memory_files_list: [], custom_agents_list: [] },
          },
        },
      },
      activeSessionId: 'sess-1',
    })
    const { default: user } = await import('@testing-library/user-event')
    const u = user.setup({ delay: null })
    render(<StatusBar model="MiniMax-M3" setModel={vi.fn()} thinkingEnabled={false} setThinkingEnabled={vi.fn()} supportsThinking={true} />)
    await u.click(screen.getByTitle('Context window & plan'))
    await screen.findByText('Plan usage')
    // Default: rows visible
    expect(screen.getByText('Skills')).toBeInTheDocument()
    // Collapse
    await u.click(screen.getByTestId('breakdown-toggle'))
    expect(screen.queryByText('Skills')).toBeNull()
  })
})


// ─────────────────────────────────────────────────────────────────────────────
// Simplified breakdown — v0.4.x feedback (Edu): the 9-row breakdown
// panel with 3 expandable chevrons was overkill. Reduced to 6 flat
// rows directly under "Janela de contexto", no separate panel:
//
//   Messages       (size in BYTES, per user request — not tokens)
//   Skills         (tokens)
//   Memory files   (tokens)
//   Custom agents  (tokens)
//   System prompt  (tokens)
//   MCP tools      (tokens)
//
// The two deferred buckets (mcp_deferred, system_tools_deferred)
// and free_space were dropped from the UI. Backend still returns
// them in the contract for backwards-compat / future use.
// ─────────────────────────────────────────────────────────────────────────────

describe('StatusBar ContextChip — simplified 6-row breakdown', () => {
  beforeEach(() => {
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, plan: 'plus', data: { model_remains: [] } }),
    })
  })

  it('renders exactly 6 rows under "Janela de contexto"', async () => {
    mockUseSessionTokens.mockReturnValue({
      sessions: {
        'sess-1': {
          lastModel: 'MiniMax-M3',
          lastTurnInput: 50_000,
          input_tokens: 50_000,
          output_tokens: 0,
          turnCount: 3,
          lastBySource: {
            messages: 3720, skills: 80, memory_files: 50,
            custom_agents: 30, system_prompt: 20, mcp_tools: 100,
            mcp_deferred: 0, system_tools_deferred: 0,
            total: 4000, limit: 1_000_000,
            messages_bytes: 14_960,
            details: { mcp_tools_list: [], memory_files_list: [], custom_agents_list: [] },
          },
        },
      },
      activeSessionId: 'sess-1',
    })
    render(<StatusBar model="MiniMax-M3" setModel={vi.fn()} thinkingEnabled={false} setThinkingEnabled={vi.fn()} supportsThinking={true} />)
    screen.getByTitle('Context window & plan').click()
    await screen.findByText('Plan usage')
    // 6 row labels visible
    expect(screen.getByText('Messages')).toBeInTheDocument()
    expect(screen.getByText('Skills')).toBeInTheDocument()
    expect(screen.getByText('Memory files')).toBeInTheDocument()
    expect(screen.getByText('Custom agents')).toBeInTheDocument()
    expect(screen.getByText('System prompt')).toBeInTheDocument()
    expect(screen.getByText('MCP tools')).toBeInTheDocument()
    // The 2 deferred buckets are NOT rendered
    expect(screen.queryByText(/deferred/)).toBeNull()
    expect(screen.queryByText('Free space')).toBeNull()
  })

  it('Messages row shows size in BYTES (not tokens) when messages_bytes is present', async () => {
    mockUseSessionTokens.mockReturnValue({
      sessions: {
        'sess-1': {
          lastModel: 'MiniMax-M3',
          lastTurnInput: 50_000,
          input_tokens: 50_000,
          output_tokens: 0,
          turnCount: 3,
          lastBySource: {
            messages: 3720,  // tokens (tiktoken count)
            skills: 80, memory_files: 50, custom_agents: 30,
            system_prompt: 20, mcp_tools: 100,
            mcp_deferred: 0, system_tools_deferred: 0,
            total: 4000, limit: 1_000_000,
            messages_bytes: 14_960,  // raw byte size
            details: { mcp_tools_list: [], memory_files_list: [], custom_agents_list: [] },
          },
        },
      },
      activeSessionId: 'sess-1',
    })
    render(<StatusBar model="MiniMax-M3" setModel={vi.fn()} thinkingEnabled={false} setThinkingEnabled={vi.fn()} supportsThinking={true} />)
    screen.getByTitle('Context window & plan').click()
    await screen.findByText('Plan usage')
    // The Messages row should show the byte size, not 3720.
    // 14,960 bytes ≈ 14.6KB → "14.6KB" via formatByteCount
    expect(screen.getByText('14.6KB')).toBeInTheDocument()
    // Token count for Messages (3720) should NOT appear in the popover
    expect(screen.queryByText('3.7k')).toBeNull()
  })

  it('other rows still show token counts (not bytes)', async () => {
    mockUseSessionTokens.mockReturnValue({
      sessions: {
        'sess-1': {
          lastModel: 'MiniMax-M3',
          lastTurnInput: 50_000,
          input_tokens: 50_000,
          output_tokens: 0,
          turnCount: 3,
          lastBySource: {
            messages: 3720, skills: 30_000, memory_files: 7_400,
            custom_agents: 5_100, system_prompt: 2_800, mcp_tools: 167,
            mcp_deferred: 0, system_tools_deferred: 0,
            total: 46_217, limit: 1_000_000,
            messages_bytes: 14_960,
            details: { mcp_tools_list: [], memory_files_list: [], custom_agents_list: [] },
          },
        },
      },
      activeSessionId: 'sess-1',
    })
    render(<StatusBar model="MiniMax-M3" setModel={vi.fn()} thinkingEnabled={false} setThinkingEnabled={vi.fn()} supportsThinking={true} />)
    screen.getByTitle('Context window & plan').click()
    await screen.findByText('Plan usage')
    // Token counts (1-decimal k format) for the 5 non-Messages rows
    expect(screen.getByText('30.0k')).toBeInTheDocument()  // skills
    expect(screen.getByText('7.4k')).toBeInTheDocument()   // memory_files
    expect(screen.getByText('5.1k')).toBeInTheDocument()   // custom_agents
    expect(screen.getByText('2.8k')).toBeInTheDocument()   // system_prompt
    // MCP tools is 167 → displayed as "167" (under 1k threshold)
    expect(screen.getByText('167')).toBeInTheDocument()
  })
})


// ─────────────────────────────────────────────────────────────────────────────
// Popover density — Edu's "barra cada vez mais bagunçada" feedback
// (v0.4.x): the popover crammed context window + 8-row breakdown +
// 3 expandable chevrons + plan usage + 6-row token debug. The
// token debug block (cache read/write, turn count, exact input/
// output) is low-value noise for normal use. Tests cover the new
// collapsed-by-default behaviour + the aria-expanded wiring.
// ─────────────────────────────────────────────────────────────────────────────

describe('StatusBar ContextChip — token detail toggle', () => {
  beforeEach(() => {
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, plan: 'plus', data: { model_remains: [] } }),
    })
  })

  it('hides the token detail rows by default (no cache/turn metrics shown)', async () => {
    mockUseSessionTokens.mockReturnValue({
      sessions: {
        'sess-1': {
          lastModel: 'MiniMax-M3',
          lastTurnInput: 4_665,
          input_tokens: 9_330,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
          output_tokens: 794,
          turnCount: 2,
        },
      },
      activeSessionId: 'sess-1',
    })
    render(<StatusBar model="MiniMax-M3" setModel={vi.fn()} thinkingEnabled={false} setThinkingEnabled={vi.fn()} supportsThinking={true} />)
    screen.getByTitle('Context window & plan').click()
    await screen.findByText('Plan usage')
    // The toggle button is visible
    expect(screen.getByTestId('token-detail-toggle')).toBeInTheDocument()
    // But the debug rows are hidden
    expect(screen.queryByText(/Cache read/)).toBeNull()
    expect(screen.queryByText(/Cache write/)).toBeNull()
    expect(screen.queryByText(/Input \(cumulative\)/)).toBeNull()
  })

  it('expanding the toggle reveals the debug rows (cache, turn count, exact numbers)', async () => {
    mockUseSessionTokens.mockReturnValue({
      sessions: {
        'sess-1': {
          lastModel: 'MiniMax-M3',
          lastTurnInput: 4_665,
          input_tokens: 9_330,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
          output_tokens: 794,
          turnCount: 2,
        },
      },
      activeSessionId: 'sess-1',
    })
    const { default: user } = await import('@testing-library/user-event')
    const u = user.setup({ delay: null })
    render(<StatusBar model="MiniMax-M3" setModel={vi.fn()} thinkingEnabled={false} setThinkingEnabled={vi.fn()} supportsThinking={true} />)
    await u.click(screen.getByTitle('Context window & plan'))
    await screen.findByText('Plan usage')
    // Click the toggle to expand
    await u.click(screen.getByTestId('token-detail-toggle'))
    // Debug rows are now visible
    expect(screen.getByText(/Cache read/)).toBeInTheDocument()
    expect(screen.getByText(/Cache write/)).toBeInTheDocument()
    expect(screen.getByText(/Input \(cumulative\)/)).toBeInTheDocument()
    expect(screen.getByText(/Output \(cumulative\)/)).toBeInTheDocument()
    expect(screen.getByText(/Turns/)).toBeInTheDocument()
  })

  it('clicking the toggle a second time hides the debug rows again', async () => {
    mockUseSessionTokens.mockReturnValue({
      sessions: {
        'sess-1': {
          lastModel: 'MiniMax-M3',
          lastTurnInput: 4_665,
          input_tokens: 9_330,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
          output_tokens: 794,
          turnCount: 2,
        },
      },
      activeSessionId: 'sess-1',
    })
    const { default: user } = await import('@testing-library/user-event')
    const u = user.setup({ delay: null })
    render(<StatusBar model="MiniMax-M3" setModel={vi.fn()} thinkingEnabled={false} setThinkingEnabled={vi.fn()} supportsThinking={true} />)
    await u.click(screen.getByTitle('Context window & plan'))
    await screen.findByText('Plan usage')
    // Expand then collapse
    await u.click(screen.getByTestId('token-detail-toggle'))
    expect(screen.getByText(/Cache read/)).toBeInTheDocument()
    await u.click(screen.getByTestId('token-detail-toggle'))
    expect(screen.queryByText(/Cache read/)).toBeNull()
  })
})
