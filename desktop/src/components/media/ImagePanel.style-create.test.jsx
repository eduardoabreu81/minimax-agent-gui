import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// vi.mock factories are hoisted above top-level const, so we declare the
// shared mock handles inside vi.hoisted() to keep them accessible from
// the factory closure. Same pattern as StyleSheetsTab.test.jsx.
const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    listStyleSheets: vi.fn(),
    createStyleSheet: vi.fn(),
    updateStyleSheet: vi.fn(),
    getStyleSheet: vi.fn(),
  },
}))
vi.mock('../../lib/styleSheets.js', () => mockApi)
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k, opts) => {
      if (opts && typeof opts === 'object') {
        let out = k
        for (const [kk, vv] of Object.entries(opts)) out = out.replace(`{{${kk}}}`, String(vv))
        return out
      }
      return k
    },
  }),
}))
vi.mock('../../hooks/useSessionProtection', () => ({
  useSessionProtection: () => ({ register: () => {} }),
}))
vi.mock('../shared/MediaPanelLayout', () => ({
  default: ({ controls }) => <div>{controls}</div>,
}))
vi.mock('../shared/ModeTabBar', () => ({ default: () => null }))
vi.mock('../shared/GalleryHeader', () => ({ default: () => null }))
vi.mock('../shared/ShapePreview', () => ({ default: () => null }))
vi.mock('./RecentGenerations', () => ({ default: () => null }))

import ImagePanel from './ImagePanel.jsx'

beforeEach(() => {
  for (const k of Object.keys(mockApi)) mockApi[k].mockReset()
  mockApi.listStyleSheets.mockResolvedValue([])
  window.localStorage.clear()
})

describe('ImagePanel inline style create', () => {
  it('opens the editor on + and merges+saves+selects on save', async () => {
    mockApi.createStyleSheet.mockResolvedValueOnce({
      name: 'wc', description: 'Watercolor', body: '{prompt}, watercolor',
    })
    render(<ImagePanel />)
    await waitFor(() => expect(mockApi.listStyleSheets).toHaveBeenCalled())
    fireEvent.click(screen.getByTitle('styleSheets.create'))
    // Fill the shared editor.
    await waitFor(() => expect(screen.getByPlaceholderText('watercolor-pastel')).toBeTruthy())
    fireEvent.change(screen.getByPlaceholderText('watercolor-pastel'), { target: { value: 'wc' } })
    fireEvent.change(screen.getByPlaceholderText('styleSheets.descriptionPlaceholder'), { target: { value: 'Watercolor' } })
    fireEvent.change(screen.getByPlaceholderText('styleSheets.bodyPlaceholder'), { target: { value: '{placeholder}' } })
    fireEvent.click(screen.getByText('image.saveAndApply'))
    await waitFor(() => expect(mockApi.createStyleSheet).toHaveBeenCalled())
    // The selector now reflects the new sheet.
    await waitFor(() => expect(window.localStorage.getItem('image-style-sheet')).toBe('wc'))
  })
})