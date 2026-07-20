import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import GenerationMetaModal from './GenerationMetaModal'

describe('GenerationMetaModal', () => {
  it('renders empty state when meta is null', () => {
    render(<GenerationMetaModal item={{ name: 'x.png', type: 'image', meta: null }} onClose={() => {}} />)
    expect(screen.getByText('metaModal.empty')).toBeInTheDocument()
  })

  it('renders prompt and params when meta is populated', () => {
    const item = {
      name: 'img.png', type: 'image',
      meta: {
        media_type: 'image', prompt: 'a red apple', user_prompt: 'a red apple',
        model: 'image-01',
        params: { aspect_ratio: '16:9', seed: 42, mode: 't2i' },
        references: { subject_reference: [] },
        created_at: '2026-07-20T11:27:00Z',
      },
    }
    render(<GenerationMetaModal item={item} onClose={() => {}} />)
    expect(screen.getByText('a red apple')).toBeInTheDocument()
    expect(screen.getByText('image-01')).toBeInTheDocument()
    expect(screen.getByText('16:9')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
  })

  it('shows user_prompt separately when it differs from prompt', () => {
    const item = {
      name: 'img.png', type: 'image',
      meta: {
        media_type: 'image',
        prompt: 'a red apple, cinematic lighting, 35mm',
        user_prompt: 'a red apple',
        model: 'image-01', params: {}, references: {},
      },
    }
    render(<GenerationMetaModal item={item} onClose={() => {}} />)
    // Full combined prompt is shown
    // The raw user prompt is shown in its own section (key matches the
    // i18n mock's t() return; production renders the localized label).
    expect(screen.getByText('metaModal.userPromptSection')).toBeInTheDocument()
  })

  it('hides user_prompt section when it equals prompt', () => {
    const item = {
      name: 'img.png', type: 'image',
      meta: {
        media_type: 'image',
        prompt: 'a red apple',
        user_prompt: 'a red apple',
        model: 'image-01', params: {}, references: {},
      },
    }
    render(<GenerationMetaModal item={item} onClose={() => {}} />)
    expect(screen.queryByText('User prompt')).not.toBeInTheDocument()
  })

  it('fires onClose when close button clicked', () => {
    const onClose = vi.fn()
    render(<GenerationMetaModal item={{ name: 'x', type: 'image', meta: null }} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders manual-upload note for null references', () => {
    const item = {
      name: 'img.png', type: 'image',
      meta: {
        media_type: 'image',
        prompt: 'p', user_prompt: 'p', model: 'image-01',
        params: {},
        references: { first_frame_image: null },
      },
    }
    render(<GenerationMetaModal item={item} onClose={() => {}} />)
    expect(screen.getByText('metaModal.manualUpload')).toBeInTheDocument()
  })
})
