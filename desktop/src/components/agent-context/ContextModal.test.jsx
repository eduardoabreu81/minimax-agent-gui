// ContextModal.test.jsx — covers the modal container, a11y, and
// DailyViewer auto-refresh.
//
// Tests:
//   - Doesn't render when open=false
//   - Renders all 6 cards (About You + 5 Agent Context + daily list)
//     when open=true
//   - ESC closes
//   - Backdrop click closes
//   - Focus moves into modal on open (a11y)
//   - Tab cycles within the modal (focus trap)
//   - DailyViewer opens on daily click
//   - DailyViewer auto-refreshes on `minimax:daily-updated` window event
//   - DailyViewer ESC closes (capture phase beats modal's bubble handler)

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import ContextModal from './ContextModal.jsx'

const mockUseContextModal = vi.fn()
const mockUseAgentContext = vi.fn()
const mockFetchFile = vi.fn()
const mockSaveFile = vi.fn()
const mockFetchDaily = vi.fn()
const mockRefreshStatus = vi.fn()

vi.mock('./ContextProvider.jsx', () => ({
  useContextModal: () => mockUseContextModal(),
}))

vi.mock('../../hooks/useAgentContext.js', () => ({
  useAgentContext: () => mockUseAgentContext(),
}))

beforeEach(() => {
  mockFetchFile.mockReset()
  mockSaveFile.mockReset()
  mockFetchDaily.mockReset()
  mockUseContextModal.mockReset()
  mockUseAgentContext.mockReset()

  // Default: modal closed, no dailies
  mockUseContextModal.mockReturnValue({
    open: false,
    closeModal: vi.fn(),
    openModalAndWizard: vi.fn(),
  })
  mockUseAgentContext.mockReturnValue({
    status: {
      banner_visible: false,
      missing: [],
      char_usage: {},
    },
    dailies: [],
    loading: false,
    fetchFile: mockFetchFile,
    saveFile: mockSaveFile,
    fetchDaily: mockFetchDaily,
    refreshStatus: mockRefreshStatus,
  })
})

function openModal(overrides = {}) {
  const closeModal = vi.fn()
  mockUseContextModal.mockReturnValue({
    open: true,
    closeModal,
    openModalAndWizard: vi.fn(),
    ...overrides,
  })
  return { closeModal, ...overrides }
}

describe('ContextModal', () => {
  it('does not render when open=false', () => {
    const { container } = render(<ContextModal />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the title + all 6 cards when open=true', () => {
    openModal()
    mockUseAgentContext.mockReturnValue({
      status: {
        banner_visible: false,
        missing: [],
        char_usage: {
          soul:     { used: 10, limit: 100 },
          identity: { used: 5,  limit: 100 },
          user:     { used: 0,  limit: 100 },
          memory:   { used: 20, limit: 100 },
        },
      },
      dailies: [],
      loading: false,
      fetchFile: mockFetchFile,
      saveFile: mockSaveFile,
      fetchDaily: mockFetchDaily,
      refreshStatus: mockRefreshStatus,
    })
    render(<ContextModal />)
    // Title
    expect(screen.getByText('agentContext.title')).toBeInTheDocument()
    // The 5 file labels from t(`agentContext.file.${id}`)
    expect(screen.getByText('agentContext.file.soul')).toBeInTheDocument()
    expect(screen.getByText('agentContext.file.identity')).toBeInTheDocument()
    expect(screen.getByText('agentContext.file.user')).toBeInTheDocument()
    expect(screen.getByText('agentContext.file.memory')).toBeInTheDocument()
    expect(screen.getByText('agentContext.file.daily')).toBeInTheDocument()
    // AboutYouCard also renders (it has the "A" avatar)
    expect(screen.getByText('settings.aboutYou')).toBeInTheDocument()
  })

  it('ESC closes the modal', () => {
    const { closeModal } = openModal()
    render(<ContextModal />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(closeModal).toHaveBeenCalledTimes(1)
  })

  it('backdrop click closes the modal', () => {
    const { closeModal } = openModal()
    render(<ContextModal />)
    // Find the backdrop (the outer fixed div)
    const backdrop = document.querySelector('.fixed.inset-0.z-\\[70\\]')
    fireEvent.click(backdrop, { target: backdrop })
    expect(closeModal).toHaveBeenCalledTimes(1)
  })

  it('focus moves into the modal on open (a11y)', async () => {
    openModal()
    render(<ContextModal />)
    // The first focusable element is the "Re-run onboarding" button.
    await waitFor(() => {
      const focused = document.activeElement
      // Could be the rerun button or the close (X) button depending on DOM order.
      // We just check focus is *inside* the modal.
      const modalRoot = document.querySelector('[role="dialog"][aria-modal="true"]')
      expect(modalRoot).toBeTruthy()
      expect(modalRoot.contains(focused)).toBe(true)
    })
  })

  it('Tab cycles within the modal (focus trap)', async () => {
    openModal()
    render(<ContextModal />)
    const modalRoot = document.querySelector('[role="dialog"][aria-modal="true"]')

    await waitFor(() => {
      // Focus must be inside
      expect(modalRoot.contains(document.activeElement)).toBe(true)
    })

    // Move focus to the LAST focusable inside the modal, then Tab
    const focusables = modalRoot.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
    const last = focusables[focusables.length - 1]
    last.focus()
    expect(document.activeElement).toBe(last)

    // Tab forward from the last → should wrap to the first
    fireEvent.keyDown(window, { key: 'Tab' })
    const first = focusables[0]
    expect(document.activeElement).toBe(first)

    // Shift+Tab from the first → should wrap to the last
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })

  describe('DailyViewer auto-refresh', () => {
    it('opens the viewer when a daily is clicked', async () => {
      const fakeDaily = { content: '# 2026-06-23\n\n## 12:00:00 — user\nHello' }
      mockFetchDaily.mockResolvedValue(fakeDaily)
      openModal()
      mockUseAgentContext.mockReturnValue({
        status: { banner_visible: false, missing: [], char_usage: {} },
        dailies: [{ date: '2026-06-23', size: 42 }],
        loading: false,
        fetchFile: mockFetchFile,
        saveFile: mockSaveFile,
        fetchDaily: mockFetchDaily,
        refreshStatus: mockRefreshStatus,
      })
      render(<ContextModal />)

      // Click the daily entry
      fireEvent.click(screen.getByText('2026-06-23'))

      await waitFor(() => {
        expect(mockFetchDaily).toHaveBeenCalledWith('2026-06-23')
      })
      // The viewer renders the daily content
      expect(screen.getByText(/Hello/)).toBeInTheDocument()
    })

    it('auto-refreshes when minimax:daily-updated fires for the open viewer', async () => {
      const initial = { content: '# 2026-06-23\n\n## 12:00:00 — user\nHello' }
      const refreshed = { content: '# 2026-06-23\n\n## 12:00:00 — user\nHello\n## 12:05:00 — assistant\nHi there' }
      mockFetchDaily
        .mockResolvedValueOnce(initial)
        .mockResolvedValueOnce(refreshed)

      openModal()
      mockUseAgentContext.mockReturnValue({
        status: { banner_visible: false, missing: [], char_usage: {} },
        dailies: [{ date: '2026-06-23', size: 42 }],
        loading: false,
        fetchFile: mockFetchFile,
        saveFile: mockSaveFile,
        fetchDaily: mockFetchDaily,
        refreshStatus: mockRefreshStatus,
      })
      render(<ContextModal />)

      // Open the viewer
      fireEvent.click(screen.getByText('2026-06-23'))
      await waitFor(() => expect(screen.getByText(/Hello/)).toBeInTheDocument())

      // Simulate the backend broadcasting a daily_updated event
      await act(async () => {
        window.dispatchEvent(new CustomEvent('minimax:daily-updated', {
          detail: { date: '2026-06-23', path: '/some/path' },
        }))
      })

      // The viewer should now show the refreshed content
      await waitFor(() => {
        expect(screen.getByText(/Hi there/)).toBeInTheDocument()
      })
      expect(mockFetchDaily).toHaveBeenCalledTimes(2)
    })

    it('ignores daily-updated events for non-open dates', async () => {
      mockFetchDaily.mockResolvedValue({ content: 'today' })
      openModal()
      mockUseAgentContext.mockReturnValue({
        status: { banner_visible: false, missing: [], char_usage: {} },
        dailies: [{ date: '2026-06-23', size: 5 }],
        loading: false,
        fetchFile: mockFetchFile,
        saveFile: mockSaveFile,
        fetchDaily: mockFetchDaily,
        refreshStatus: mockRefreshStatus,
      })
      render(<ContextModal />)

      // Fire event for a different date — should NOT trigger fetch
      await act(async () => {
        window.dispatchEvent(new CustomEvent('minimax:daily-updated', {
          detail: { date: '2026-06-22', path: '/other' },
        }))
      })

      expect(mockFetchDaily).not.toHaveBeenCalled()
    })
  })
})


// ─────────────────────────────────────────────────────────────────────────────
// Personality preset selector — the SOUL.md card has a dropdown of
// canonical bodies the user can apply in one click (without editing
// the textarea manually). Only the SOUL.md card opts in via the
// `presetSelector` prop; the others (IDENTITY/USER/MEMORY) just have
// the textarea editor.
// ─────────────────────────────────────────────────────────────────────────────

function openModalWithPresets(presets = []) {
  openModal()
  mockUseAgentContext.mockReturnValue({
    status: {
      banner_visible: false,
      missing: [],
      char_usage: {
        soul:     { used: 50, limit: 100 },
        identity: { used: 10, limit: 100 },
        user:     { used: 5,  limit: 100 },
        memory:   { used: 0,  limit: 100 },
      },
    },
    dailies: [],
    loading: false,
    fetchFile: mockFetchFile,
    saveFile: mockSaveFile,
    fetchDaily: mockFetchDaily,
    refreshStatus: mockRefreshStatus,
    presets,
    getPresetBody: (id) => presets.find((p) => p.id === id)?.body || '',
  })
}

const SAMPLE_PRESETS = [
  { id: 'concise',  name: 'Concise',  body: 'You are direct and minimal.' },
  { id: 'friendly', name: 'Friendly', body: 'You are warm and encouraging.' },
  { id: 'mentor',   name: 'Mentor',   body: 'You teach the why along the way.' },
  { id: 'expert',   name: 'Expert',   body: 'You are dense and technical.' },
  { id: 'creative', name: 'Creative', body: 'You generate options and angles.' },
]

describe('ContextModal — Personality preset selector', () => {
  it('renders the preset <select> with the 5 presets + Custom option', () => {
    openModalWithPresets(SAMPLE_PRESETS)
    render(<ContextModal />)
    const select = screen.getByTestId('preset-select-soul')
    expect(select).toBeInTheDocument()
    expect(select.tagName).toBe('SELECT')
    // 5 preset options + 1 "Custom" option
    expect(select.options.length).toBe(6)
    expect(select.options[0].value).toBe('')  // Custom is first
  })

  it('does NOT render preset selectors on other cards (identity/user/memory)', () => {
    openModalWithPresets(SAMPLE_PRESETS)
    render(<ContextModal />)
    expect(screen.queryByTestId('preset-select-identity')).toBeNull()
    expect(screen.queryByTestId('preset-select-user')).toBeNull()
    expect(screen.queryByTestId('preset-select-memory')).toBeNull()
  })

  it('disables the preset <select> when not editing', () => {
    openModalWithPresets(SAMPLE_PRESETS)
    render(<ContextModal />)
    const select = screen.getByTestId('preset-select-soul')
    expect(select).toBeDisabled()
  })

  it('updates the select value when a preset is picked (after clicking Edit)', async () => {
    openModalWithPresets(SAMPLE_PRESETS)
    mockFetchFile.mockResolvedValue({ content: 'old user-edited content' })
    render(<ContextModal />)

    // Click the Edit button on the SOUL.md card
    fireEvent.click(screen.getAllByText('agentContext.memory.edit')[0])

    // The preset <select> becomes enabled when editing=true. Wait
    // for that — at the same time fetchFile is resolving in the
    // background and setContent runs to populate the textarea.
    const select = await waitFor(() => {
      const s = screen.getByTestId('preset-select-soul')
      if (s.disabled) throw new Error('select still disabled')
      return s
    })

    // Pick the "mentor" preset
    fireEvent.change(select, { target: { value: 'mentor' } })

    // The select's own value flips synchronously to "mentor".
    // (The textarea body is also updated, but verifying that
    // requires the fetchFile race to settle — covered by the
    // 'saves the picked preset body when Save is clicked' test.)
    expect(select.value).toBe('mentor')
  })

  it('detects the active preset when loaded content matches a preset body', async () => {
    openModalWithPresets(SAMPLE_PRESETS)
    // The fetched SOUL.md body matches the "friendly" preset exactly
    mockFetchFile.mockResolvedValue({ content: 'You are warm and encouraging.' })
    render(<ContextModal />)
    fireEvent.click(screen.getAllByText('agentContext.memory.edit')[0])
    await waitFor(() => expect(mockFetchFile).toHaveBeenCalledWith('soul'))
    // The select should now show "friendly" as the active preset
    const select = screen.getByTestId('preset-select-soul')
    expect(select.value).toBe('friendly')
  })

  it('shows "Custom" when loaded content does not match any preset', async () => {
    openModalWithPresets(SAMPLE_PRESETS)
    mockFetchFile.mockResolvedValue({ content: 'totally custom personality' })
    render(<ContextModal />)
    fireEvent.click(screen.getAllByText('agentContext.memory.edit')[0])
    await waitFor(() => expect(mockFetchFile).toHaveBeenCalledWith('soul'))
    const select = screen.getByTestId('preset-select-soul')
    expect(select.value).toBe('')  // Custom
  })

  it('saves the picked preset body when Save is clicked', async () => {
    openModalWithPresets(SAMPLE_PRESETS)
    mockFetchFile.mockResolvedValue({ content: 'old' })
    mockSaveFile.mockResolvedValue({ status: 'ok' })
    render(<ContextModal />)
    fireEvent.click(screen.getAllByText('agentContext.memory.edit')[0])
    await waitFor(() => expect(mockFetchFile).toHaveBeenCalledWith('soul'))

    // Pick the "expert" preset, then save
    fireEvent.change(screen.getByTestId('preset-select-soul'), {
      target: { value: 'expert' },
    })
    fireEvent.click(screen.getByText('agentContext.common.save'))

    await waitFor(() => {
      expect(mockSaveFile).toHaveBeenCalledWith('soul', 'You are dense and technical.')
    })
  })
})
