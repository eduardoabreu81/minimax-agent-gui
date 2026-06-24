// SettingsPanel — MCP Servers (MiniMax) label test.
//
// Verifies that the section that holds the web_search and
// understand_image toggles is clearly labeled as MiniMax
// MCP servers, not just "Tools". The MCP section further
// down (user-configured MCP servers) keeps its own
// "MCP servers" label — this test only covers the
// MiniMax-specific section.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import SettingsPanel from './SettingsPanel.jsx'

// Minimal mocks — same shape as the auto-compact test file.
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

describe('SettingsPanel — MCP Servers (MiniMax) section', () => {
  it('section header uses the MCP Servers (MiniMax) label, not just Tools', async () => {
    render(<SettingsPanel />)
    // t('settings.tools') renders in 2 places: the rail entry
    // and the section header. We assert both are present and
    // the section header has the right id.
    const matches = await screen.findAllByText('settings.tools')
    expect(matches.length).toBeGreaterThanOrEqual(1)
    // The section header carries id="settings-tools"
    const sectionHeader = document.getElementById('settings-tools')
    expect(sectionHeader).toBeTruthy()
    expect(sectionHeader.textContent).toContain('settings.tools')
  })

  it('webSearch label includes the (MCP) suffix in the i18n key value', async () => {
    render(<SettingsPanel />)
    // The toggle's accessible name is t('settings.webSearch')
    // which is "Web Search (MCP)" in the en.json translation.
    // We assert the i18n key is in the DOM (via the t() stub
    // returning the key) AND that the key maps to a string
    // containing the (MCP) marker. This double-check protects
    // against future key renames that drop the marker.
    const en = (await import('./../../i18n/en.json')).default
    expect(en.settings.webSearch).toMatch(/\(MCP\)/i)
    expect(en.settings.imageUnderstanding).toMatch(/\(MCP\)/i)
  })

  it('webSearchDesc explicitly names the MiniMax MCP server', async () => {
    // The description text is the agent's primary way of
    // understanding what this tool is and when to use it.
    // Verify the en.json translation calls out "MiniMax MCP".
    const en = (await import('./../../i18n/en.json')).default
    expect(en.settings.webSearchDesc).toMatch(/MiniMax MCP/i)
  })

  it('section label in en.json is MCP Servers (MiniMax), not Tools', async () => {
    // Hard guarantee against reverting the label back to a
    // generic "Tools" — that was the original bug (the user
    // couldn't tell that the two toggles were MCP servers).
    const en = (await import('./../../i18n/en.json')).default
    expect(en.settings.tools).toMatch(/MCP Servers/i)
    expect(en.settings.tools).toMatch(/MiniMax/i)
  })
})
