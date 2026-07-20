// AgentRunStatus.test.jsx — guards the session list popover
//
// Tests:
//   - renders the orb button
//   - shows count when sessions are running
//   - opens popover on click
//   - shows session rows with status icons

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import AgentRunStatus from './AgentRunStatus.jsx'

vi.mock('../../context/AgentActivityContext', () => ({
  useAgentActivity: () => ({
    sessions: {
      'chat-1': { sessionId: 'chat-1', tabId: 'chat', status: 'running', unread: false, runStart: Date.now() - 5000 },
      'code-1': { sessionId: 'code-1', tabId: 'code', status: 'completed', unread: true, runStart: null },
    },
    selectGlobalSummary: () => ({
      status: 'running',
      runningCount: 1,
      attentionCount: 0,
      errorCount: 0,
      completedCount: 1,
      sessions: [],
    }),
    selectSession: () => null,
    selectTabSummary: () => ({ status: 'idle', runningCount: 0, errorCount: 0, completedCount: 0, attentionCount: 0, sessions: [] }),
  }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k, fallback) => fallback || k }),
}))

describe('AgentRunStatus', () => {
  it('renders the orb button', () => {
    const { container } = render(<AgentRunStatus />)
    expect(container.querySelector('button')).toBeTruthy()
  })

  it('shows count badge when sessions are running', () => {
    render(<AgentRunStatus />)
    expect(screen.getByText('2')).toBeTruthy()
  })

  it('opens popover on click', () => {
    render(<AgentRunStatus />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('chat')).toBeTruthy()
    expect(screen.getByText('code')).toBeTruthy()
  })

  it('shows status labels inside popover', () => {
    render(<AgentRunStatus />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('running')).toBeTruthy()
    expect(screen.getByText('completed')).toBeTruthy()
  })
})
