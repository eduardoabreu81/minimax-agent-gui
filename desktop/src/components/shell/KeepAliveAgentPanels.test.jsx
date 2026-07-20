import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import KeepAliveAgentPanels from './KeepAliveAgentPanels.jsx'

describe('KeepAliveAgentPanels', () => {
  it('mounts Chat and Code on first visit and keeps them mounted across tabs', async () => {
    const chatMounts = vi.fn()
    const codeMounts = vi.fn()
    let activeTab = 'chat'

    const renderChat = vi.fn((active) => {
      chatMounts()
      return <div data-testid="chat-panel">{active ? 'chat-active' : 'chat-hidden'}</div>
    })
    const renderCode = vi.fn((active) => {
      codeMounts()
      return <div data-testid="code-panel">{active ? 'code-active' : 'code-hidden'}</div>
    })

    const { rerender } = render(
      <KeepAliveAgentPanels
        activeTab={activeTab}
        renderChat={renderChat}
        renderCode={renderCode}
      />
    )

    // Chat is mounted and active
    expect(screen.getByTestId('agent-panel-chat')).toBeInTheDocument()
    expect(screen.getByTestId('agent-panel-chat')).not.toHaveAttribute('hidden')
    expect(screen.getByTestId('chat-panel')).toHaveTextContent('chat-active')
    // Code not yet mounted
    expect(screen.queryByTestId('agent-panel-code')).not.toBeInTheDocument()

    // Navigate to Code — Code mounts for first time, Chat stays mounted
    activeTab = 'code'
    rerender(
      <KeepAliveAgentPanels
        activeTab={activeTab}
        renderChat={renderChat}
        renderCode={renderCode}
      />
    )

    expect(screen.getByTestId('agent-panel-chat')).toBeInTheDocument()
    expect(screen.getByTestId('agent-panel-chat')).toHaveAttribute('hidden', '')
    expect(screen.getByTestId('chat-panel')).toHaveTextContent('chat-hidden')
    expect(screen.getByTestId('agent-panel-code')).toBeInTheDocument()
    expect(screen.getByTestId('code-panel')).toHaveTextContent('code-active')

    // Navigate to Settings — both stay mounted
    activeTab = 'settings'
    rerender(
      <KeepAliveAgentPanels
        activeTab={activeTab}
        renderChat={renderChat}
        renderCode={renderCode}
      />
    )

    expect(screen.getByTestId('agent-panel-chat')).toBeInTheDocument()
    expect(screen.getByTestId('agent-panel-chat')).toHaveAttribute('hidden', '')
    expect(screen.getByTestId('agent-panel-code')).toBeInTheDocument()
    expect(screen.getByTestId('agent-panel-code')).toHaveAttribute('hidden', '')

    // Back to Chat — both still mounted, one render call each (memo)
    activeTab = 'chat'
    rerender(
      <KeepAliveAgentPanels
        activeTab={activeTab}
        renderChat={renderChat}
        renderCode={renderCode}
      />
    )

    expect(screen.getByTestId('agent-panel-chat')).toBeInTheDocument()
    expect(screen.getByTestId('agent-panel-chat')).not.toHaveAttribute('hidden')
    expect(screen.getByTestId('agent-panel-code')).toBeInTheDocument()
    expect(screen.getByTestId('agent-panel-code')).toHaveAttribute('hidden', '')
  })
})
