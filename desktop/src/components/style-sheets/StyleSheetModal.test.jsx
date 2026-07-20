import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import StyleSheetModal from './StyleSheetModal.jsx'

describe('StyleSheetModal', () => {
  it('renders title and children', () => {
    render(
      <StyleSheetModal onClose={() => {}} title="Hello">
        <p>body</p>
      </StyleSheetModal>,
    )
    expect(screen.getByText('Hello')).toBeTruthy()
    expect(screen.getByText('body')).toBeTruthy()
  })

  it('fires onClose on backdrop and X button', () => {
    const onClose = vi.fn()
    const { container } = render(
      <StyleSheetModal onClose={onClose} title="t">
        <p>x</p>
      </StyleSheetModal>,
    )
    fireEvent.click(container.firstChild) // backdrop
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByLabelText('Close'))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
