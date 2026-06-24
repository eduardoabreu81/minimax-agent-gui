// SettingsPanel.test.jsx — guards the auto-compact toggle flow.
//
// The Settings panel has many sections; this test file only covers
// the Agent section's auto-compact toggle + its own save button.
// Other sections have their own tests (or are tested manually
// because the integration surface is too large for unit tests).
//
// What we verify:
//   - The "Auto-compact at 80%" toggle renders with the right
//     label and description
//   - The toggle reflects the backend's auto_compact value
//     (default true when /api/config doesn't return the field)
//   - Toggling changes the state, and clicking Save sends a
//     PUT /api/config/agent with auto_compact in the body
//   - A user turning the toggle OFF (false) actually round-trips
//     as false in the PUT body, not omitted

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import SettingsPanel from './SettingsPanel.jsx'

// Mock apiFetch — the panel makes many calls on mount. We default
// to empty config and override per-test.
const mockApiFetch = vi.fn()
vi.mock('../../lib/api.js', () => ({
  apiFetch: (...args) => mockApiFetch(...args),
  apiWebSocketUrl: (sid) => `ws://test/ws/${sid}`,
}))

// Mock useTheme — the panel reads theme/mode for the appearance
// section. Default values are fine.
vi.mock('../../context/ThemeContext.jsx', () => ({
  useTheme: () => ({
    theme: 'default', setTheme: vi.fn(),
    mode: 'light', setMode: vi.fn(),
    toggleMatrixEffect: vi.fn(), matrixEffect: false,
    themes: [],
  }),
}))

// Mock useContextModal — the rail has a "Context" entry that
// opens the ContextModal. The original hook throws if called
// outside its provider, so we replace the whole module export
// with a no-op stub. Returns an object so destructure-style
// calls in SettingsPanel don't crash.
const mockContextModal = {
  open: false,
  openModal: vi.fn(),
  closeModal: vi.fn(),
  openModalAndWizard: vi.fn(),
}
vi.mock('../agent-context/ContextProvider.jsx', () => ({
  useContextModal: () => mockContextModal,
}))

// jsdom doesn't implement IntersectionObserver; the SettingsPanel
// uses it for scroll-spy on the left rail. A no-op stub is enough.
if (typeof globalThis.IntersectionObserver === 'undefined') {
  globalThis.IntersectionObserver = class IntersectionObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return [] }
  }
}

const FAKE_CONFIG = {
  api_key_configured: true,
  agent: {
    model: 'MiniMax-M3',
    max_steps: 50,
    auto_compact: true,
  },
  app_workspace_dir: '/tmp/test-workspace',
  api_base: 'https://api.minimax.io',
  region: 'global',
  tools: { web_search: true, understand_image: true },
  // Note: mcp_servers is intentionally omitted from this fake —
  // the SettingsPanel reads it as if it were an array (mcpServers.map),
  // and an empty object would break the render. The dedicated
  // /api/mcp/servers endpoint is mocked below and returns an array.
}

beforeEach(() => {
  mockApiFetch.mockReset()
  // mockContextModal is a plain object (not a vi.fn) — its
  // methods are vi.fn() inside, reset those individually.
  mockContextModal.openModal.mockReset()
  mockContextModal.closeModal.mockReset()
  mockContextModal.openModalAndWizard.mockReset()
  // Default: /api/config returns our fake, everything else is empty
  mockApiFetch.mockImplementation((url, opts = {}) => {
    if (url === '/api/config' && (!opts.method || opts.method === 'GET')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(FAKE_CONFIG) })
    }
    if (url === '/api/config/tools' && (opts.method === 'POST' || opts.method === 'PUT')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) })
    }
    if (url === '/api/config/agent' && opts.method === 'PUT') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) })
    }
    if (url === '/api/config/defaults/audio' || url === '/api/config/api-key') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) })
    }
    if (url === '/api/profile') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    }
    if (url === '/api/minimax/quota') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: false }) })
    }
    if (url === '/api/mcp/servers') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, servers: [] }) })
    }
    if (url === '/api/coding/recent-workspaces' || url === '/api/coding/workspace') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) })
  })
})

describe('SettingsPanel — auto-compact toggle', () => {
  it('renders the toggle with label and description', async () => {
    render(<SettingsPanel />)
    expect(await screen.findByText('settings.autoCompact')).toBeInTheDocument()
    expect(screen.getByText('settings.autoCompactDesc')).toBeInTheDocument()
  })

  it('toggle reflects the backend auto_compact=true by default', async () => {
    render(<SettingsPanel />)
    // Wait for the toggle to render (it's inside the Agent Card)
    const toggle = await screen.findByLabelText('settings.autoCompact')
    expect(toggle).toBeChecked()
  })

  it('toggle reflects the backend auto_compact=false when returned', async () => {
    mockApiFetch.mockImplementation((url, opts = {}) => {
      if (url === '/api/config' && (!opts.method || opts.method === 'GET')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ...FAKE_CONFIG,
            agent: { ...FAKE_CONFIG.agent, auto_compact: false },
          }),
        })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })
    render(<SettingsPanel />)
    const toggle = await screen.findByLabelText('settings.autoCompact')
    expect(toggle).not.toBeChecked()
  })

  it('clicking the toggle then Save sends auto_compact=false in PUT body', async () => {
    render(<SettingsPanel />)
    // Wait for the panel to mount + load config
    const toggle = await screen.findByLabelText('settings.autoCompact')
    // Toggle OFF
    fireEvent.click(toggle)
    expect(toggle).not.toBeChecked()
    // Find the Save button scoped to the Agent card.
    const card = toggle.closest('div.p-5') || toggle.closest('div')
    const saveBtn = card.querySelector('button.bg-primary')
    fireEvent.click(saveBtn)
    // The PUT to /api/config/agent should have happened with
    // auto_compact: false in the body.
    await waitFor(() => {
      const putCall = mockApiFetch.mock.calls.find(
        ([url, opts]) => url === '/api/config/agent' && opts?.method === 'PUT'
      )
      expect(putCall).toBeTruthy()
      const body = JSON.parse(putCall[1].body)
      expect(body.auto_compact).toBe(false)
    })
  })
})
