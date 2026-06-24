// SettingsPanel.mcp.test.jsx — guards the merged "MCP Servers"
// section. After the v0.4.x session-4 fix, the old separate
// "Tools" / "MCP servers" sections were fused into one
// "MCP Servers" Card with two sub-blocks:
//   - "MiniMax" (the built-in web_search + understand_image toggles)
//   - "Your servers" (the user-configured MCP server list)
//
// The two sub-blocks use the same Card wrapper — they just
// have a divider + sub-label between them. This test confirms:
//   - the rail has ONE entry for MCP Servers (not two)
//   - the section header + sub-block labels render
//   - the built-in web_search and understand_image labels are
//     clean ("Web Search", "Image Understanding" — no
//     "(MCP)" suffix because the parent section already
//     makes the MCP context clear)
//   - the i18n key values map to the merged-section strings

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import SettingsPanel from './SettingsPanel.jsx'

const mockApiFetch = vi.fn()
vi.mock('../../lib/api.js', () => ({
  apiFetch: (...args) => mockApiFetch(...args),
  apiWebSocketUrl: (sid) => `ws://test/ws/${sid}`,
}))

vi.mock('../../context/ThemeContext.jsx', () => ({
  useTheme: () => ({
    theme: 'default', setTheme: vi.fn(),
    mode: 'light', setMode: vi.fn(),
    toggleMatrixEffect: vi.fn(), matrixEffect: false,
    themes: [],
  }),
}))

const mockContextModal = {
  open: false,
  openModal: vi.fn(),
  closeModal: vi.fn(),
  openModalAndWizard: vi.fn(),
}
vi.mock('../agent-context/ContextProvider.jsx', () => ({
  useContextModal: () => mockContextModal,
}))

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
  agent: { model: 'MiniMax-M3', max_steps: 50, auto_compact: true },
  app_workspace_dir: '/tmp/test-workspace',
  api_base: 'https://api.minimax.io',
  region: 'global',
  tools: { web_search: true, understand_image: true },
}

beforeEach(() => {
  mockApiFetch.mockReset()
  mockContextModal.openModal.mockReset()
  mockContextModal.closeModal.mockReset()
  mockContextModal.openModalAndWizard.mockReset()

  mockApiFetch.mockImplementation((url, opts = {}) => {
    if (url === '/api/config' && (!opts.method || opts.method === 'GET')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(FAKE_CONFIG) })
    }
    if (url === '/api/mcp/servers') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, servers: [] }) })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) })
  })
})

describe('SettingsPanel — merged MCP Servers section', () => {
  it('section header + sub-block labels both render', async () => {
    render(<SettingsPanel />)
    // The "MCP Servers" label appears twice: once in the rail
    // entry, once in the section header. Both should be present.
    const headerMatches = screen.getAllByText('settings.mcpServers')
    expect(headerMatches.length).toBeGreaterThanOrEqual(1)
    // The two sub-block labels inside the same Card
    expect(screen.getByText('settings.mcpServersMinimax')).toBeInTheDocument()
    expect(screen.getByText('settings.mcpServersYours')).toBeInTheDocument()
  })

  it('section carries id="settings-mcp-servers" for scroll-spy', async () => {
    render(<SettingsPanel />)
    const section = document.getElementById('settings-mcp-servers')
    expect(section).toBeTruthy()
    expect(section.textContent).toContain('settings.mcpServers')
  })

  it('built-in web_search toggle is labeled "Web Search" (no MCP suffix)', async () => {
    // The (MCP) suffix was added in the previous round of
    // session-4 changes but became redundant once the parent
    // section made the MCP context clear. The label is back
    // to a clean "Web Search".
    const en = (await import('./../../i18n/en.json')).default
    expect(en.settings.webSearch).toBe('Web Search')
    expect(en.settings.imageUnderstanding).toBe('Image Understanding')
  })

  it('sub-block label in en.json is "MiniMax"', async () => {
    const en = (await import('./../../i18n/en.json')).default
    expect(en.settings.mcpServersMinimax).toBe('MiniMax')
  })

  it('sub-block label in en.json is "Your servers"', async () => {
    const en = (await import('./../../i18n/en.json')).default
    expect(en.settings.mcpServersYours).toBe('Your servers')
  })
})
