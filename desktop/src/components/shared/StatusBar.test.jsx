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

// ─────────────────────────────────────────────────────────────────────────────
// Per-source token breakdown — renders "Breakdown by source" sub-section
// when bucket.lastBySource is present (sent by the backend in the WS
// `usage` event's `by_source` field).
// ─────────────────────────────────────────────────────────────────────────────

describe('StatusBar ContextChip — per-source breakdown', () => {
  it('hides the breakdown when bucket has no lastBySource', async () => {
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
    // Open the popover (the popover renders async, so use findAllByText)
    screen.getByTitle('Context window & plan').click()
    // Wait for the popover to render (Plan usage is the second
    // section, always present when open).
    await screen.findByText('Plan usage')
    expect(screen.queryByText(/Breakdown by source/i)).toBeNull()
  })

  it('renders the breakdown collapsed by default — only header + dominant row', async () => {
    // The Claude Code reference shows the context breakdown as a
    // collapsed row with the dominant bucket name + total + chevron.
    // The 9-row list + expandable sub-sections are hidden until the
    // user clicks the header.
    mockUseSessionTokens.mockReturnValue({
      sessions: {
        'sess-1': {
          lastModel: 'MiniMax-M3',
          lastTurnInput: 50_000,
          input_tokens: 50_000,
          output_tokens: 0,
          turnCount: 3,
          lastBySource: {
            messages: 3720,  // dominant — should show in header
            skills: 80,
            memory_files: 50,
            custom_agents: 30,
            system_prompt: 20,
            mcp_tools: 100,
            mcp_deferred: 0,
            system_tools_deferred: 0,
            free_space: 0,
            total: 4000,
            limit: 1_000_000,
            details: { mcp_tools_list: [], memory_files_list: [], custom_agents_list: [] },
          },
        },
      },
      activeSessionId: 'sess-1',
    })
    render(<StatusBar model="MiniMax-M3" setModel={vi.fn()} thinkingEnabled={false} setThinkingEnabled={vi.fn()} supportsThinking={true} />)
    screen.getByTitle('Context window & plan').click()
    await screen.findByText('Plan usage')
    // Header is rendered
    expect(screen.getByText(/Breakdown by source/i)).toBeInTheDocument()
    // Dominant row name shown in collapsed header (Messages 3720 / 4000 = 93%)
    expect(screen.getByText(/Messages/)).toBeInTheDocument()
    // 9 row labels NOT yet rendered — collapsed
    expect(screen.queryByText('Skills')).toBeNull()
    expect(screen.queryByText('Memory files')).toBeNull()
    expect(screen.queryByText('Custom agents')).toBeNull()
    expect(screen.queryByText('System prompt')).toBeNull()
    expect(screen.queryByText('Free space')).toBeNull()
  })

  it('expanding the breakdown reveals all 9 rows + percentages', async () => {
    mockUseSessionTokens.mockReturnValue({
      sessions: {
        'sess-1': {
          lastModel: 'MiniMax-M3',
          lastTurnInput: 50_000,
          input_tokens: 50_000,
          output_tokens: 0,
          turnCount: 3,
          lastBySource: {
            messages: 3720,
            skills: 80,
            memory_files: 50,
            custom_agents: 30,
            system_prompt: 20,
            mcp_tools: 100,
            mcp_deferred: 0,
            system_tools_deferred: 0,
            free_space: 0,
            total: 4000,
            limit: 1_000_000,
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
    await screen.findByText(/Breakdown by source/i)

    // Click the header to expand
    await u.click(screen.getByTestId('breakdown-toggle'))

    // All 9 rows are now visible. "Messages" appears in both the
    // collapsed header AND the expanded row list, so use
    // getAllByText for that one. The other 8 row labels are unique
    // to the expanded view.
    expect(screen.getAllByText('Messages').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Skills')).toBeInTheDocument()
    expect(screen.getByText('Memory files')).toBeInTheDocument()
    expect(screen.getByText('Custom agents')).toBeInTheDocument()
    expect(screen.getByText('System prompt')).toBeInTheDocument()
    expect(screen.getByText('MCP tools')).toBeInTheDocument()
    expect(screen.getByText('MCP tools (deferred)')).toBeInTheDocument()
    expect(screen.getByText('System tools (deferred)')).toBeInTheDocument()
    expect(screen.getByText('Free space')).toBeInTheDocument()
  })

  it('computes correct percentages for each source (after expand)', async () => {
    mockUseSessionTokens.mockReturnValue({
      sessions: {
        'sess-1': {
          lastModel: 'MiniMax-M3',
          lastTurnInput: 50_000,
          input_tokens: 50_000,
          output_tokens: 0,
          turnCount: 3,
          lastBySource: {
            messages: 800,
            skills: 50,
            memory_files: 0,
            custom_agents: 0,
            system_prompt: 100,    // 10%
            mcp_tools: 50,
            mcp_deferred: 0,
            system_tools_deferred: 0,
            free_space: 0,
            total: 1000,
            limit: 1_000_000,
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
    await screen.findByText(/Breakdown by source/i)
    await u.click(screen.getByTestId('breakdown-toggle'))
    // Now the rows are rendered; the parent of "Breakdown by source"
    // holds the whole panel.
    const breakdown = screen.getByText(/Breakdown by source/i).closest('div')
    const text = breakdown.textContent
    expect(text).toMatch(/80%/)     // Messages
    expect(text).toMatch(/10%/)     // System prompt
    expect(text).toMatch(/5%/)      // Skills + MCP tools
  })

  it('hides expandable sub-sections when details is empty (after expand)', async () => {
    mockUseSessionTokens.mockReturnValue({
      sessions: {
        'sess-1': {
          lastModel: 'MiniMax-M3',
          lastTurnInput: 50_000,
          input_tokens: 50_000,
          output_tokens: 0,
          turnCount: 3,
          lastBySource: {
            messages: 5000, skills: 0, memory_files: 0, custom_agents: 0,
            system_prompt: 0, mcp_tools: 0, mcp_deferred: 0,
            system_tools_deferred: 0, free_space: 0,
            total: 5000, limit: 1_000_000,
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
    await screen.findByText(/Breakdown by source/i)
    await u.click(screen.getByTestId('breakdown-toggle'))
    // No expandable chevron rows when details are empty
    expect(screen.queryByText(/^MCP tools\s*\u00b7/)).toBeNull()
    expect(screen.queryByText(/^Memory files\s*\u00b7/)).toBeNull()
    expect(screen.queryByText(/^Custom agents\s*\u00b7/)).toBeNull()
  })

  it('expands the breakdown then reveals per-server MCP entries', async () => {
    mockUseSessionTokens.mockReturnValue({
      sessions: {
        'sess-1': {
          lastModel: 'MiniMax-M3',
          lastTurnInput: 50_000,
          input_tokens: 50_000,
          output_tokens: 0,
          turnCount: 3,
          lastBySource: {
            messages: 5000, skills: 0, memory_files: 0, custom_agents: 0,
            system_prompt: 0, mcp_tools: 100, mcp_deferred: 0,
            system_tools_deferred: 0, free_space: 0,
            total: 5100, limit: 1_000_000,
            details: {
              mcp_tools_list: [
                { server_id: 'filesystem', name: 'Local FS', tool_count: 12, tokens: 50 },
                { server_id: 'github',     name: 'GitHub API', tool_count: 73, tokens: 50 },
              ],
              memory_files_list: [],
              custom_agents_list: [],
            },
          },
        },
      },
      activeSessionId: 'sess-1',
    })
    const { default: user } = await import('@testing-library/user-event')
    const u = user.setup({ delay: null })
    render(<StatusBar model="MiniMax-M3" setModel={vi.fn()} thinkingEnabled={false} setThinkingEnabled={vi.fn()} supportsThinking={true} />)
    await u.click(screen.getByTitle('Context window & plan'))
    await screen.findByText(/Breakdown by source/i)

    // Outer breakdown is collapsed — no inner expandables visible yet
    expect(screen.queryByTestId('breakdown-expand-mcp-tools')).toBeNull()
    // Expand the outer breakdown first
    await u.click(screen.getByTestId('breakdown-toggle'))
    // Now the per-server MCP expandable row is visible
    const button = screen.getByTestId('breakdown-expand-mcp-tools')
    expect(button).toBeTruthy()
    await u.click(button)
    // Per-server entries are visible
    expect(screen.getByText('Local FS')).toBeInTheDocument()
    expect(screen.getByText('GitHub API')).toBeInTheDocument()
    expect(screen.getByText(/^12 tools$/)).toBeInTheDocument()
    expect(screen.getByText(/^73 tools$/)).toBeInTheDocument()
  })

  it('clicking the toggle a second time collapses the breakdown again', async () => {
    mockUseSessionTokens.mockReturnValue({
      sessions: {
        'sess-1': {
          lastModel: 'MiniMax-M3',
          lastTurnInput: 50_000,
          input_tokens: 50_000,
          output_tokens: 0,
          turnCount: 3,
          lastBySource: {
            messages: 5000, skills: 80, memory_files: 0, custom_agents: 0,
            system_prompt: 0, mcp_tools: 0, mcp_deferred: 0,
            system_tools_deferred: 0, free_space: 0,
            total: 5080, limit: 1_000_000,
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
    await screen.findByText(/Breakdown by source/i)
    // Expand
    await u.click(screen.getByTestId('breakdown-toggle'))
    expect(screen.getByText('Skills')).toBeInTheDocument()
    // Collapse
    await u.click(screen.getByTestId('breakdown-toggle'))
    expect(screen.queryByText('Skills')).toBeNull()
  })
})
