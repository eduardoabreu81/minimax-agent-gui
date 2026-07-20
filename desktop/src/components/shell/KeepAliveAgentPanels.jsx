import { memo, useRef, useEffect } from 'react'

/**
 * KeepAliveAgentPanels — mounts Chat and Coding on first visit and keeps
 * them mounted for the lifetime of the host. Inactive panels are visually
 * hidden and excluded from focus/accessibility navigation but their
 * WebSockets and React state survive.
 *
 * Props:
 *   activeTab: 'chat' | 'code' | other string
 *   renderChat: (active: boolean) => ReactNode   — stable callback
 *   renderCode: (active: boolean) => ReactNode   — stable callback
 */
function KeepAliveAgentPanels({ activeTab, renderChat, renderCode }) {
  const visitedRef = useRef(new Set())
  const visited = visitedRef.current

  // Register a tab on its first visit.
  if (activeTab === 'chat' || activeTab === 'code') {
    visited.add(activeTab)
  }

  return (
    <>
      {visited.has('chat') && (
        <section
          key="chat"
          data-testid="agent-panel-chat"
          hidden={activeTab !== 'chat'}
          aria-hidden={activeTab !== 'chat'}
          className="flex-1 min-h-0 flex-col"
        >
          {renderChat(activeTab === 'chat')}
        </section>
      )}
      {visited.has('code') && (
        <section
          key="code"
          data-testid="agent-panel-code"
          hidden={activeTab !== 'code'}
          aria-hidden={activeTab !== 'code'}
          className="flex-1 min-h-0 flex-col"
        >
          {renderCode(activeTab === 'code')}
        </section>
      )}
    </>
  )
}

export default memo(KeepAliveAgentPanels)
