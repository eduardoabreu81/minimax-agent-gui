import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockApi = vi.hoisted(() => ({
  listStyleSheets: vi.fn(),
  getStyleSheet: vi.fn(),
  createStyleSheet: vi.fn(),
  updateStyleSheet: vi.fn(),
  deleteStyleSheet: vi.fn(),
  draftStyleSheetFromBrief: vi.fn(),
  draftStyleSheetFromImage: vi.fn(),
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

import StyleSheetEditor from './StyleSheetEditor.jsx'

beforeEach(() => {
  for (const k of Object.keys(mockApi)) mockApi[k].mockReset()
})

describe('StyleSheetEditor', () => {
  it('direct mode saves via createStyleSheet', async () => {
    mockApi.createStyleSheet.mockResolvedValueOnce({ name: 'wc', description: 'd', body: '{prompt}, water' })
    render(
      <StyleSheetEditor
        mode="create"
        onClose={() => {}}
        onSaved={() => {}}
        onError={() => {}}
      />,
    )
    fireEvent.change(screen.getByPlaceholderText('watercolor-pastel'), { target: { value: 'wc' } })
    fireEvent.change(screen.getByPlaceholderText('styleSheets.descriptionPlaceholder'), { target: { value: 'd' } })
    fireEvent.change(screen.getByPlaceholderText('styleSheets.bodyPlaceholder'), { target: { value: '{placeholder}' } })
    fireEvent.click(screen.getByText('styleSheets.createSheet'))
    await waitFor(() => expect(mockApi.createStyleSheet).toHaveBeenCalled())
    const payload = mockApi.createStyleSheet.mock.calls[0][0]
    expect(payload).toMatchObject({ name: 'wc', description: 'd' })
  })

  it('AI draft fills but does not save', async () => {
    mockApi.draftStyleSheetFromBrief.mockResolvedValueOnce({
      name: 'cel-anime', description: 'Cel', body: '{prompt}, cel anime',
    })
    render(<StyleSheetEditor mode="create" onClose={() => {}} onSaved={() => {}} onError={() => {}} />)
    fireEvent.click(screen.getByText('styleSheets.startMode.ai'))
    fireEvent.change(screen.getByPlaceholderText('styleSheets.briefPlaceholder'), {
      target: { value: 'cel anime' },
    })
    fireEvent.click(screen.getByText('styleSheets.createDraft'))
    await waitFor(() => expect(mockApi.draftStyleSheetFromBrief).toHaveBeenCalledWith('cel anime'))
    // Form fields are now populated from the draft.
    await waitFor(() => expect(screen.getByDisplayValue('cel-anime')).toBeTruthy())
    expect(screen.getByDisplayValue('Cel')).toBeTruthy()
    expect(mockApi.createStyleSheet).not.toHaveBeenCalled()
  })

  it('AI draft failure preserves fields and surfaces error', async () => {
    mockApi.draftStyleSheetFromBrief.mockRejectedValueOnce(new Error('rate limited'))
    const onError = vi.fn()
    render(<StyleSheetEditor mode="create" onClose={() => {}} onSaved={() => {}} onError={onError} />)
    fireEvent.click(screen.getByText('styleSheets.startMode.ai'))
    fireEvent.change(screen.getByPlaceholderText('styleSheets.briefPlaceholder'), {
      target: { value: 'x' },
    })
    fireEvent.click(screen.getByText('styleSheets.createDraft'))
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.stringMatching(/rate limited/)))
    // Brief is still there.
    expect(screen.getByDisplayValue('x')).toBeTruthy()
  })

  it('edit mode loads the sheet then PUTs', async () => {
    mockApi.getStyleSheet.mockResolvedValueOnce({
      name: 'old', description: 'Old', body: '{prompt}, x', raw_markdown: '---\nname: old\ndescription: Old\n---\n{prompt}, x',
    })
    mockApi.updateStyleSheet.mockResolvedValueOnce({ name: 'old', description: 'New', body: '{prompt}, y' })
    render(
      <StyleSheetEditor
        mode="edit"
        sheet={{ name: 'old' }}
        onClose={() => {}}
        onSaved={() => {}}
        onError={() => {}}
      />,
    )
    await waitFor(() => expect(mockApi.getStyleSheet).toHaveBeenCalledWith('old'))
    fireEvent.change(screen.getByPlaceholderText('styleSheets.descriptionPlaceholder'), {
      target: { value: 'New' },
    })
    fireEvent.click(screen.getByText('styleSheets.saveChanges'))
    await waitFor(() => expect(mockApi.updateStyleSheet).toHaveBeenCalled())
    const [name, patch] = mockApi.updateStyleSheet.mock.calls[0]
    expect(name).toBe('old')
    expect(patch).toMatchObject({ description: 'New' })
  })

  it('image tab from initialImagePath calls draftStyleSheetFromImage', async () => {
    mockApi.draftStyleSheetFromImage.mockResolvedValueOnce({
      name: 'impasto', description: 'd', body: '{prompt}, impasto',
    })
    render(
      <StyleSheetEditor
        mode="create"
        source="image"
        initialImagePath="generations/images/x.png"
        onClose={() => {}}
        onSaved={() => {}}
        onError={() => {}}
      />,
    )
    // Image mode is active; click extract.
    fireEvent.click(screen.getByText('styleSheets.extractStyle'))
    await waitFor(() =>
      expect(mockApi.draftStyleSheetFromImage).toHaveBeenCalledWith({ imagePath: 'generations/images/x.png' }),
    )
  })
})