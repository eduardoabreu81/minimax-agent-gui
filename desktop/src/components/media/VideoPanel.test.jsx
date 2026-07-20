import { describe, it, expect } from 'vitest'
import { deriveVideoMode } from './VideoPanel'

describe('deriveVideoMode', () => {
  it('returns text2video when no frames or subject', () => {
    expect(deriveVideoMode({})).toBe('text2video')
    expect(deriveVideoMode()).toBe('text2video')
  })

  it('returns image2video when only firstFrame', () => {
    expect(deriveVideoMode({ firstFrame: 'data:image/png;base64,xxx' })).toBe('image2video')
  })

  it('returns sef when both frames present', () => {
    expect(deriveVideoMode({
      firstFrame: 'data:image/png;base64,xxx',
      lastFrame: 'data:image/png;base64,yyy',
    })).toBe('sef')
  })

  it('returns s2v when subject_reference non-empty', () => {
    expect(deriveVideoMode({ subject_reference: ['data:image/png;base64,xxx'] })).toBe('s2v')
  })

  it('prioritizes s2v over sef when both subject and frames present', () => {
    // s2v is the most specific mode (subject lock); the others are
    // frame-based. When both are supplied the subject wins.
    expect(deriveVideoMode({
      firstFrame: 'x', lastFrame: 'y', subject_reference: ['z'],
    })).toBe('s2v')
  })

  it('treats empty subject_reference array as absent', () => {
    expect(deriveVideoMode({ subject_reference: [] })).toBe('text2video')
  })

  it('treats null/undefined frame values as absent', () => {
    expect(deriveVideoMode({ firstFrame: null, lastFrame: undefined })).toBe('text2video')
  })
})
