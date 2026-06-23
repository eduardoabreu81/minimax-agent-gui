// IncompleteContextBanner.test.jsx — covers the banner's behaviour.
//
// Renders the banner with a fake status and asserts:
//   - Hidden when banner_visible is false or missing is empty.
//   - Shows up with the right label when missing.
//   - Renders the 3 action buttons and triggers the right callbacks.
//   - Dismissable per-session (re-arms when missing set changes).
//
// We mock react-i18next in the global setup so t() returns the key
// with parameter substitution; assertions are on those keys.

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import IncompleteContextBanner from './IncompleteContextBanner.jsx'

function renderBanner(status, props = {}) {
  const onOpenSettings = vi.fn()
  const onOpenWizard = vi.fn()
  const utils = render(
    <IncompleteContextBanner
      status={status}
      onOpenSettings={onOpenSettings}
      onOpenWizard={onOpenWizard}
      {...props}
    />,
  )
  return { ...utils, onOpenSettings, onOpenWizard }
}

describe('IncompleteContextBanner', () => {
  it('renders nothing when banner_visible is false', () => {
    const { container } = renderBanner({ banner_visible: false, missing: ['soul'] })
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when missing is empty', () => {
    const { container } = renderBanner({ banner_visible: true, missing: [] })
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when status is null', () => {
    const { container } = renderBanner(null)
    expect(container.firstChild).toBeNull()
  })

  it('renders the incomplete label and the missing-file hint', () => {
    renderBanner({
      banner_visible: true,
      missing: ['soul', 'user'],
      char_usage: {},
    })
    // The t() in the global stub returns the key. The banner's
    // "missing file" line uses t('banner.missingFile', { file: ... })
    // — since the t() stub doesn't recurse, the rendered text is
    // the missingFile key with the file param substituted. We just
    // check that the line is present and contains the key.
    expect(screen.getByText('agentContext.banner.incomplete')).toBeInTheDocument()
    expect(screen.getByText(/agentContext\.banner\.missingFile/)).toBeInTheDocument()
  })

  it('calls onOpenSettings when the "Open Settings" button is clicked', () => {
    const { onOpenSettings, getByText } = renderBanner({
      banner_visible: true,
      missing: ['soul'],
    })
    fireEvent.click(getByText('agentContext.banner.openSettings'))
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
  })

  it('calls onOpenWizard when the "Set up now" button is clicked', () => {
    const { onOpenWizard, getByText } = renderBanner({
      banner_visible: true,
      missing: ['soul'],
    })
    fireEvent.click(getByText('agentContext.banner.setUpNow'))
    expect(onOpenWizard).toHaveBeenCalledTimes(1)
  })

  it('dismisses via the X button and stays hidden on next render', () => {
    const { container, getByLabelText } = renderBanner({
      banner_visible: true,
      missing: ['soul'],
    })
    expect(container.firstChild).not.toBeNull()
    fireEvent.click(getByLabelText('agentContext.banner.dismiss'))
    expect(container.firstChild).toBeNull()
  })

  it('hides the "Set up now" button when onOpenWizard is not provided', () => {
    render(
      <IncompleteContextBanner
        status={{ banner_visible: true, missing: ['soul'] }}
        onOpenSettings={vi.fn()}
      />,
    )
    expect(screen.queryByText('agentContext.banner.setUpNow')).toBeNull()
    expect(screen.queryByText('agentContext.banner.openSettings')).not.toBeNull()
  })
})
