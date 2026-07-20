import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import ImageLightbox from './ImageLightbox'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k, opts) => opts?.defaultValue ?? _k }),
}))

const ITEM = { name: 'cat.png', path: '/tmp/cat.png' }

describe('ImageLightbox', () => {
  afterEach(() => {
    cleanup()
    document.body.style.overflow = ''
    document.body.innerHTML = ''
  })

  afterEach(() => {
    cleanup()
    document.body.style.overflow = ''
    document.body.innerHTML = ''
  })

  it('renders nothing when item is null', () => {
    const { container } = render(<ImageLightbox item={null} onClose={() => {}} />)
    expect(container.firstChild).toBeNull()
  })

  it('closes on backdrop click', () => {
    const onClose = vi.fn()
    render(<ImageLightbox item={ITEM} onClose={onClose} />)
    // Backdrop is the outer dialog div (role=dialog)
    const backdrop = screen.getByRole('dialog')
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does NOT close when clicking inside the image surface', () => {
    const onClose = vi.fn()
    render(<ImageLightbox item={ITEM} onClose={onClose} />)
    const img = screen.getByAltText(ITEM.name)
    fireEvent.click(img)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('zooms in and out via toolbar buttons', () => {
    const onClose = vi.fn()
    render(<ImageLightbox item={ITEM} onClose={onClose} />)
    // Initial 100%
    expect(screen.getByText('100%')).toBeInTheDocument()

    const zoomIn = screen.getByLabelText('Zoom in')
    fireEvent.click(zoomIn)
    // 100% + 50% = 150%
    expect(screen.getByText('150%')).toBeInTheDocument()

    const zoomOut = screen.getByLabelText('Zoom out')
    fireEvent.click(zoomOut)
    fireEvent.click(zoomOut)
    fireEvent.click(zoomOut)
    // 150% - 1.5 = 0%, clamped to 100%
    expect(screen.getByText('100%')).toBeInTheDocument()
  })

  it('closes on Escape key', () => {
    const onClose = vi.fn()
    render(<ImageLightbox item={ITEM} onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('locks body scroll while open and restores on close', () => {
    const onClose = vi.fn()
    const prev = document.body.style.overflow
    document.body.style.overflow = 'auto'
    const { unmount } = render(<ImageLightbox item={ITEM} onClose={onClose} />)
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('auto')
    document.body.style.overflow = prev
  })
})
