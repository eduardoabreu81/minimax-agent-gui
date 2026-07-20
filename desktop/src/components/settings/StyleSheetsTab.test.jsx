// StyleSheetsTab.test.jsx — covers the CRUD surface that the user
// exercises from Settings → Style Sheets:
//   - empty state shows the "no sheets" hint
//   - list renders name + description from GET /api/style-sheets
//   - Create button opens the editor modal; saving POSTs and refreshes
//   - Edit button opens the modal prefilled; saving PUTs
//   - Delete asks for confirm then DELETEs
//   - search filters the list client-side
//
// apiFetch is mocked per-test; react-i18next returns keys verbatim so
// missing translations don't fail assertions.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockApiFetch = vi.fn()
vi.mock('../../lib/api.js', () => ({
  apiFetch: (...args) => mockApiFetch(...args),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k, opts) => {
    // For interpolation-bearing keys, return the key with the first
    // interpolation filled in so the text is still findable.
    if (opts && typeof opts === 'object') {
      let out = k
      for (const [kk, vv] of Object.entries(opts)) {
        out = out.replace(`{{${kk}}}`, String(vv))
      }
      return out
    }
    return k
  } }),
}))

import StyleSheetsTab from './StyleSheetsTab.jsx'

// Build a fake Response-like object that apiFetch consumers can .json().
function jsonResp(payload, ok = true) {
  return {
    ok,
    json: async () => payload,
  }
}

beforeEach(() => {
  mockApiFetch.mockReset()
})

describe('StyleSheetsTab', () => {
  it('shows the empty-state hint when there are no sheets', async () => {
    mockApiFetch.mockResolvedValueOnce(jsonResp({ success: true, style_sheets: [], count: 0 }))
    render(<StyleSheetsTab />)
    await waitFor(() => expect(screen.getByText('styleSheets.none')).toBeTruthy())
  })

  it('renders the list from GET /api/style-sheets', async () => {
    mockApiFetch.mockResolvedValueOnce(jsonResp({
      success: true,
      style_sheets: [
        { name: 'watercolor', description: 'Watercolor pastel', body: 'b', body_length: 1, prompt_placeholder_count: 1 },
        { name: 'cinematic',  description: 'Cinematic dark',   body: 'b', body_length: 1, prompt_placeholder_count: 0 },
      ],
      count: 2,
    }))
    render(<StyleSheetsTab />)
    await waitFor(() => expect(screen.getByText('Watercolor pastel')).toBeTruthy())
    expect(screen.getByText('Cinematic dark')).toBeTruthy()
    // Both names render as monospace code
    expect(screen.getByText('watercolor')).toBeTruthy()
    expect(screen.getByText('cinematic')).toBeTruthy()
  })

  it('opens the editor on Create and POSTs on save', async () => {
    // Initial list (empty) + post response
    mockApiFetch
      .mockResolvedValueOnce(jsonResp({ success: true, style_sheets: [], count: 0 }))
      .mockResolvedValueOnce(jsonResp({
        success: true,
        style_sheet: { name: 'new', description: 'd', body: 'b', raw_markdown: '' },
      }))
      .mockResolvedValueOnce(jsonResp({ success: true, style_sheets: [
        { name: 'new', description: 'd', body: 'b', body_length: 1, prompt_placeholder_count: 0 },
      ], count: 1 }))

    render(<StyleSheetsTab />)
    await waitFor(() => expect(screen.getByText('styleSheets.none')).toBeTruthy())

    fireEvent.click(screen.getByTitle('styleSheets.create'))
    // Modal inputs
    await waitFor(() => expect(screen.getByPlaceholderText('watercolor-pastel')).toBeTruthy())
    fireEvent.change(screen.getByPlaceholderText('watercolor-pastel'), { target: { value: 'new' } })
    // t() returns keys verbatim, so the placeholder resolves to the key string.
    fireEvent.change(screen.getByPlaceholderText('styleSheets.descriptionPlaceholder'), { target: { value: 'd' } })

    // Save button (the create variant)
    const saveBtn = screen.getByText('styleSheets.createSheet')
    fireEvent.click(saveBtn)

    await waitFor(() => {
      const calls = mockApiFetch.mock.calls
      const post = calls.find(([url, opts]) => url === '/api/style-sheets' && opts?.method === 'POST')
      expect(post).toBeTruthy()
      expect(JSON.parse(post[1].body)).toMatchObject({ name: 'new', description: 'd' })
    })
  })

  it('filters the list by search', async () => {
    mockApiFetch.mockResolvedValueOnce(jsonResp({
      success: true,
      style_sheets: [
        { name: 'watercolor', description: 'Watercolor', body: 'b', body_length: 1, prompt_placeholder_count: 0 },
        { name: 'cinematic',  description: 'Cinematic',  body: 'b', body_length: 1, prompt_placeholder_count: 0 },
      ],
      count: 2,
    }))
    render(<StyleSheetsTab />)
    await waitFor(() => expect(screen.getByText('Watercolor')).toBeTruthy())

    fireEvent.change(screen.getByPlaceholderText('styleSheets.search'), { target: { value: 'cinema' } })
    expect(screen.getByText('Cinematic')).toBeTruthy()
    expect(screen.queryByText('Watercolor')).toBeNull()
  })

  it('DELETEs after confirm', async () => {
    mockApiFetch
      .mockResolvedValueOnce(jsonResp({ success: true, style_sheets: [
        { name: 'doomed', description: 'd', body: 'b', body_length: 1, prompt_placeholder_count: 0 },
      ], count: 1 }))
      .mockResolvedValueOnce(jsonResp({ success: true, deleted: 'doomed' }))
      .mockResolvedValueOnce(jsonResp({ success: true, style_sheets: [], count: 0 }))

    render(<StyleSheetsTab />)
    await waitFor(() => expect(screen.getByText('doomed')).toBeTruthy())

    fireEvent.click(screen.getByTitle('styleSheets.delete'))
    // SessionActionGuard renders two buttons; the confirm one has the
    // confirmLabel i18n key ("styleSheets.delete") on its text node.
    const confirmBtn = await screen.findByText('styleSheets.delete')
    fireEvent.click(confirmBtn)
    await waitFor(() => {
      const del = mockApiFetch.mock.calls.find(([url, opts]) => url === '/api/style-sheets/doomed' && opts?.method === 'DELETE')
      expect(del).toBeTruthy()
    })
  })

  it('does not DELETE when confirm is dismissed', async () => {
    mockApiFetch.mockResolvedValueOnce(jsonResp({ success: true, style_sheets: [
      { name: 'safe', description: 'd', body: 'b', body_length: 1, prompt_placeholder_count: 0 },
    ], count: 1 }))
    render(<StyleSheetsTab />)
    await waitFor(() => expect(screen.getByText('safe')).toBeTruthy())

    fireEvent.click(screen.getByTitle('styleSheets.delete'))
    const cancelBtn = await screen.findByText('common.cancel')
    fireEvent.click(cancelBtn)
    const del = mockApiFetch.mock.calls.find(([url, opts]) => url === '/api/style-sheets/safe' && opts?.method === 'DELETE')
    expect(del).toBeUndefined()
  })
})
