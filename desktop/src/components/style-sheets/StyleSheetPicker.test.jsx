import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockApi = {
  getStyleSheet: vi.fn(),
  listStyleSheets: vi.fn(),
}
vi.mock('../../lib/styleSheets.js', () => mockApi)
vi.mock('../../hooks/useStyleSheetTooltip.js', () => ({
  useStyleSheetTooltip: () => ({ data: null, loading: false, error: null }),
}))
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

import StyleSheetPicker from './StyleSheetPicker.jsx'

const SHEETS = [
  { name: 'watercolor', description: 'Watercolor pastel', body_length: 12, prompt_placeholder_count: 1 },
  { name: 'cinematic', description: 'Cinematic dark tones', body_length: 8, prompt_placeholder_count: 0 },
  { name: 'cel-anime', description: '90s cel anime', body_length: 20, prompt_placeholder_count: 1 },
]

beforeEach(() => {
  for (const k of Object.keys(mockApi)) mockApi[k].mockReset()
  // Make getStyleSheet resolve to a placeholder body so the tooltip body
  // preview can render. The picker doesn't assert on it — we only test
  // that the tooltip element shows up.
  mockApi.getStyleSheet.mockResolvedValue({
    name: 'x',
    description: 'd',
    body: 'b',
    raw_markdown: '---\nname: x\ndescription: d\n---\nb',
  })
  // jsdom doesn't ship getBoundingClientRect for every node; provide a
  // safe fallback that lets the tooltip's pos snapshot be a real rect.
  if (!Element.prototype.getBoundingClientRect) {
    Element.prototype.getBoundingClientRect = function () {
      return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }
    }
  }
})

describe('StyleSheetPicker', () => {
  it('renders "No style sheet" placeholder when value is empty', () => {
    render(<StyleSheetPicker value="" sheets={SHEETS} onChange={() => {}} />)
    expect(screen.getByTestId('style-sheet-trigger')).toHaveTextContent(/styleSheets\.noneChip/)
  })

  it('renders selected sheet name in the trigger', () => {
    render(<StyleSheetPicker value="cinematic" sheets={SHEETS} onChange={() => {}} />)
    const trigger = screen.getByTestId('style-sheet-trigger')
    expect(trigger).toHaveTextContent('cinematic')
    expect(trigger).toHaveTextContent('Cinematic dark tones')
  })

  it('opens the popover on trigger click', () => {
    render(<StyleSheetPicker value="" sheets={SHEETS} onChange={() => {}} />)
    fireEvent.click(screen.getByTestId('style-sheet-trigger'))
    expect(screen.getByTestId('style-sheet-popover')).toBeTruthy()
    // Popover lists all sheets + the None row
    expect(screen.getByTestId('style-sheet-row-watercolor')).toBeTruthy()
    expect(screen.getByTestId('style-sheet-row-cinematic')).toBeTruthy()
    expect(screen.getByTestId('style-sheet-row-cel-anime')).toBeTruthy()
    expect(screen.getByTestId('style-sheet-row-none')).toBeTruthy()
  })

  it('filters rows by query (name and description)', async () => {
    render(<StyleSheetPicker value="" sheets={SHEETS} onChange={() => {}} />)
    fireEvent.click(screen.getByTestId('style-sheet-trigger'))
    fireEvent.change(screen.getByTestId('style-sheet-search'), {
      target: { value: 'cinema' },
    })
    await waitFor(() => {
      expect(screen.queryByTestId('style-sheet-row-watercolor')).toBeNull()
      expect(screen.queryByTestId('style-sheet-row-cel-anime')).toBeNull()
      expect(screen.getByTestId('style-sheet-row-cinematic')).toBeTruthy()
    })
  })

  it('calls onChange when a row is clicked', () => {
    const onChange = vi.fn()
    render(<StyleSheetPicker value="" sheets={SHEETS} onChange={onChange} />)
    fireEvent.click(screen.getByTestId('style-sheet-trigger'))
    fireEvent.click(screen.getByTestId('style-sheet-row-cinematic'))
    expect(onChange).toHaveBeenCalledWith('cinematic')
  })

  it('None row clears the selection', () => {
    const onChange = vi.fn()
    render(<StyleSheetPicker value="cinematic" sheets={SHEETS} onChange={onChange} />)
    fireEvent.click(screen.getByTestId('style-sheet-trigger'))
    fireEvent.click(screen.getByTestId('style-sheet-row-none'))
    expect(onChange).toHaveBeenCalledWith('')
  })

  it('+ New calls onCreate', () => {
    const onCreate = vi.fn()
    render(
      <StyleSheetPicker
        value=""
        sheets={SHEETS}
        onChange={() => {}}
        onCreate={onCreate}
      />
    )
    fireEvent.click(screen.getByTestId('style-sheet-trigger'))
    fireEvent.click(screen.getByTestId('style-sheet-new'))
    expect(onCreate).toHaveBeenCalled()
  })

  it('trash icon opens the delete confirm modal', () => {
    const onDelete = vi.fn()
    render(
      <StyleSheetPicker
        value="cinematic"
        sheets={SHEETS}
        onChange={() => {}}
        onDelete={onDelete}
      />
    )
    fireEvent.click(screen.getByTestId('style-sheet-trigger'))
    // Hover-style trigger: fire mouseEnter + mouseLeave on the row first
    // (the trash button is opacity-0 until hover, but fireEvent still hits it).
    fireEvent.click(screen.getByTestId('style-sheet-delete-watercolor'))
    // i18n key is rendered verbatim in tests (no real provider).
    expect(
      screen.getByText(/styleSheets\.confirmDelete/)
    ).toBeTruthy()
    // Confirm button calls onDelete + falls back to None when deleting
    // the active selection.
    fireEvent.click(screen.getByText('styleSheets.delete'))
  })

  it('shows char-budget chip only when a sheet is selected', () => {
    const { rerender } = render(
      <StyleSheetPicker value="" sheets={SHEETS} onChange={() => {}} combinedLen={0} promptMax={1500} />
    )
    expect(screen.queryByTestId('style-sheet-budget')).toBeNull()
    rerender(
      <StyleSheetPicker
        value="cinematic"
        sheets={SHEETS}
        onChange={() => {}}
        combinedLen={1200}
        promptMax={1500}
      />
    )
    expect(screen.getByTestId('style-sheet-budget')).toHaveTextContent('1200/1500')
  })
})
