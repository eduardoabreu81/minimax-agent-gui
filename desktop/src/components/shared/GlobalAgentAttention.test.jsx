// GlobalAgentAttention.test.jsx
//
// Tests:
//   - renders null when no sessions need attention
//   - shows notification for needs_input sessions
//   - shows notification for error+unread sessions
//   - dismiss button calls acknowledgeSession

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import GlobalAgentAttention from './GlobalAgentAttention.jsx'

vi.mock('../../context/AgentActivityContext', () => {
  const mockAcknowledge = vi.fn()
  let mockData = {}
  return {
    __esModule: true,
    _setMockData: (data) => { mockData = data },
    _mockAcknowledge: mockAcknowledge,
    useAgentActivity: () => mockData,
  }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k, fallback) => fallback || k }),
}))

import { _setMockData, _mockAcknowledge } from '../../context/AgentActivityContext'

function idleMock() {
  _setMockData({
    sessions: {
      'chat-1': { sessionId: 'chat-1', tabId: 'chat', status: 'idle', unread: false, attention: null },
    },
    selectGlobalSummary: () => ({ status: 'idle', runningCount: 0, attentionCount: 0, errorCount: 0, completedCount: 0, sessions: [] }),
    acknowledgeSession: _mockAcknowledge,
  })
}

function needsInputMock(toolName = 'edit_file') {
  _setMockData({
    sessions: {
      'chat-1': { sessionId: 'chat-1', tabId: 'chat', status: 'needs_input', unread: false, attention: { toolName } },
    },
    selectGlobalSummary: () => ({ status: 'needs_input', runningCount: 0, attentionCount: 1, errorCount: 0, completedCount: 0, sessions: [] }),
    acknowledgeSession: _mockAcknowledge,
  })
}

function errorMock() {
  _setMockData({
    sessions: {
      'code-1': { sessionId: 'code-1', tabId: 'code', status: 'error', unread: true, attention: null },
    },
    selectGlobalSummary: () => ({ status: 'error', runningCount: 0, attentionCount: 0, errorCount: 1, completedCount: 0, sessions: [] }),
    acknowledgeSession: _mockAcknowledge,
  })
}

describe('GlobalAgentAttention', () => {
  beforeEach(() => {
    _mockAcknowledge.mockClear()
    idleMock()
  })

  it('renders null when no sessions need attention', () => {
    idleMock()
    const { container } = render(<GlobalAgentAttention />)
    expect(container.innerHTML).toBe('')
  })

  it('shows notification for needs_input session', () => {
    needsInputMock('edit_file')
    render(<GlobalAgentAttention />)
    expect(screen.getByText(/Needs input/)).toBeTruthy()
    expect(screen.getByText(/edit_file/)).toBeTruthy()
  })

  it('shows notification for error+unread session', () => {
    errorMock()
    render(<GlobalAgentAttention />)
    expect(screen.getByText(/Error/)).toBeTruthy()
  })

  it('dismiss button calls acknowledgeSession', () => {
    needsInputMock('web_search')
    render(<GlobalAgentAttention />)
    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[0])
    expect(_mockAcknowledge).toHaveBeenCalledWith('chat-1')
  })
})
