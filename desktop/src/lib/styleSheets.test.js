import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockApiFetch = vi.fn()
vi.mock('./api.js', () => ({
  apiFetch: (...args) => mockApiFetch(...args),
}))

import {
  listStyleSheets, getStyleSheet, createStyleSheet, updateStyleSheet,
  deleteStyleSheet, draftStyleSheetFromBrief, draftStyleSheetFromImage,
} from './styleSheets.js'

function jsonResp(payload, ok = true) {
  return { ok, json: async () => payload }
}

beforeEach(() => {
  mockApiFetch.mockReset()
})

describe('styleSheets.js', () => {
  it('listStyleSheets returns the array', async () => {
    mockApiFetch.mockResolvedValueOnce(jsonResp({ success: true, style_sheets: [{ name: 'a' }], count: 1 }))
    const out = await listStyleSheets()
    expect(mockApiFetch).toHaveBeenCalledWith('/api/style-sheets')
    expect(out).toEqual([{ name: 'a' }])
  })

  it('listStyleSheets throws on non-success payload', async () => {
    mockApiFetch.mockResolvedValueOnce(jsonResp({ success: false, error: 'boom' }, false))
    await expect(listStyleSheets()).rejects.toThrow(/boom/)
  })

  it('getStyleSheet encodes the name', async () => {
    mockApiFetch.mockResolvedValueOnce(jsonResp({ success: true, style_sheet: { name: 'a b' } }))
    await getStyleSheet('a/b')
    expect(mockApiFetch).toHaveBeenCalledWith('/api/style-sheets/a%2Fb')
  })

  it('createStyleSheet POSTs name/description/body', async () => {
    mockApiFetch.mockResolvedValueOnce(jsonResp({ success: true, style_sheet: { name: 'x' } }))
    const out = await createStyleSheet({ name: 'x', description: 'd', body: 'b' })
    expect(mockApiFetch).toHaveBeenCalledWith('/api/style-sheets', expect.objectContaining({ method: 'POST' }))
    expect(out).toEqual({ name: 'x' })
  })

  it('updateStyleSheet PUTs only provided fields', async () => {
    mockApiFetch.mockResolvedValueOnce(jsonResp({ success: true, style_sheet: { name: 'x' } }))
    await updateStyleSheet('x', { body: 'b2' })
    const [, opts] = mockApiFetch.mock.calls[0]
    expect(opts.method).toBe('PUT')
    expect(JSON.parse(opts.body)).toEqual({ body: 'b2' })
  })

  it('deleteStyleSheet DELETEs by name', async () => {
    mockApiFetch.mockResolvedValueOnce(jsonResp({ success: true, deleted: 'x' }))
    await deleteStyleSheet('x')
    const [url, opts] = mockApiFetch.mock.calls[0]
    expect(url).toBe('/api/style-sheets/x')
    expect(opts.method).toBe('DELETE')
  })

  it('deleteStyleSheet surfaces FastAPI detail on failure', async () => {
    mockApiFetch.mockResolvedValueOnce(jsonResp({ detail: 'nope' }, false))
    await expect(deleteStyleSheet('x')).rejects.toThrow(/nope/)
  })

  it('draftStyleSheetFromBrief POSTs description mode', async () => {
    mockApiFetch.mockResolvedValueOnce(jsonResp({ success: true, draft: { name: 'n', description: 'd', body: 'b' } }))
    const out = await draftStyleSheetFromBrief('cel anime')
    const [url, opts] = mockApiFetch.mock.calls[0]
    expect(url).toBe('/api/style-sheets/draft')
    expect(JSON.parse(opts.body)).toEqual({ mode: 'description', brief: 'cel anime' })
    expect(out).toEqual({ name: 'n', description: 'd', body: 'b' })
  })

  it('draftStyleSheetFromImage with path', async () => {
    mockApiFetch.mockResolvedValueOnce(jsonResp({ success: true, draft: { name: 'n', description: 'd', body: 'b' } }))
    await draftStyleSheetFromImage({ imagePath: 'generations/images/x.png' })
    expect(JSON.parse(mockApiFetch.mock.calls[0][1].body)).toEqual({
      mode: 'image', image_path: 'generations/images/x.png',
    })
  })

  it('draftStyleSheetFromImage with data URL', async () => {
    mockApiFetch.mockResolvedValueOnce(jsonResp({ success: true, draft: { name: 'n', description: 'd', body: 'b' } }))
    await draftStyleSheetFromImage({ imageDataUrl: 'data:image/png;base64,AAA' })
    expect(JSON.parse(mockApiFetch.mock.calls[0][1].body)).toEqual({
      mode: 'image', image_data_url: 'data:image/png;base64,AAA',
    })
  })

  it('draftStyleSheetFromImage rejects when neither source', async () => {
    await expect(draftStyleSheetFromImage({})).rejects.toThrow(/imagePath or imageDataUrl/)
  })

  it('draftStyleSheetFromImage rejects when both sources', async () => {
    await expect(draftStyleSheetFromImage({
      imagePath: 'x', imageDataUrl: 'y',
    })).rejects.toThrow(/exactly one/)
  })
})
