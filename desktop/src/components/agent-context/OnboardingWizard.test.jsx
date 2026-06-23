// OnboardingWizard.test.jsx — covers the 4-step first-run setup.
//
// Tests:
//   - Doesn't render when `open=false`.
//   - Shows the title + step 1 (about) on first open.
//   - Step dots are clickable; clicking advances/regresses.
//   - "Skip" calls onClose and sets the localStorage flag.
//   - Step 2 (personality) shows the 5 preset cards.
//   - Step 4 (review) shows the 4 files that will be created.
//   - "Create 4 files" calls saveBatch with the right entries.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import OnboardingWizard, { WIZARD_SEEN_KEY } from './OnboardingWizard.jsx'

// The wizard uses the useAgentContext hook internally. Mock it so
// the test doesn't have to deal with a real backend roundtrip.
const mockSaveBatch = vi.fn(() => Promise.resolve([
  { id: 'soul', ok: true },
  { id: 'identity', ok: true },
  { id: 'user', ok: true },
  { id: 'memory', ok: true },
]))
const mockRefreshStatus = vi.fn(() => Promise.resolve())
const mockGetPresetBody = vi.fn((id) => `# ${id}\n\nbody for ${id}`)
const mockGetRoleBody = vi.fn((id) => `role body for ${id}`)

vi.mock('../../hooks/useAgentContext.js', () => ({
  useAgentContext: () => ({
    saveBatch: mockSaveBatch,
    refreshStatus: mockRefreshStatus,
    getPresetBody: mockGetPresetBody,
    getRoleBody: mockGetRoleBody,
    presets: [
      { id: 'concise', name: 'Concise', desc: 'Direct', body: '...' },
      { id: 'friendly', name: 'Friendly', desc: 'Warm', body: '...' },
    ],
    roles: [
      { id: 'eng', name: 'Engineering partner', desc: 'Code', body: '...' },
      { id: 'custom', name: 'Custom', desc: 'You define' },
    ],
  }),
  buildUserBody: (name, tz, level) => `# User\n${name}\n${tz}\n${level}`,
  buildMemoryBody: () => '# Memory\nplaceholder',
}))

beforeEach(() => {
  mockSaveBatch.mockClear()
  mockRefreshStatus.mockClear()
  mockGetPresetBody.mockClear()
  mockGetRoleBody.mockClear()
  localStorage.clear()
})

function renderWizard(props = {}) {
  const onClose = vi.fn()
  const utils = render(<OnboardingWizard open={true} onClose={onClose} {...props} />)
  return { ...utils, onClose }
}

describe('OnboardingWizard', () => {
  it('does not render when open=false', () => {
    const { container } = render(<OnboardingWizard open={false} onClose={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows the title + subtitle + step 1 (About you) on first open', () => {
    renderWizard()
    // The t() stub returns the key.
    expect(screen.getByText('agentContext.wizard.title')).toBeInTheDocument()
    expect(screen.getByText('agentContext.wizard.subtitle')).toBeInTheDocument()
    // Step 1 has the "name" field.
    expect(screen.getByText('agentContext.wizard.name')).toBeInTheDocument()
  })

  it('renders the timezone field with the browser default', () => {
    renderWizard()
    const tzInput = screen.getByPlaceholderText('America/Sao_Paulo')
    expect(tzInput).toBeInTheDocument()
    expect(tzInput.value).toMatch(/.+/)  // jsdom provides a tz
  })

  it('shows 3 level buttons (beginner / mid / senior)', () => {
    renderWizard()
    expect(screen.getByText('agentContext.wizard.levelBeginner')).toBeInTheDocument()
    expect(screen.getByText('agentContext.wizard.levelMid')).toBeInTheDocument()
    expect(screen.getByText('agentContext.wizard.levelSenior')).toBeInTheDocument()
  })

  it('Skip button closes the wizard WITHOUT setting the seen flag', () => {
    // Skip = "I'll do it later" — the banner should keep showing so
    // the user can come back to it. The seen flag is only set on
    // the full "Create 4 files" path (which auto-dismisses the
    // banner by populating all 4 files).
    const { onClose } = renderWizard()
    fireEvent.click(screen.getByText('agentContext.wizard.skip'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(WIZARD_SEEN_KEY)).toBeNull()
  })

  it('Clicking a step dot jumps to that step', () => {
    renderWizard()
    // Find dots by aria-label (the dot is a button with
    // aria-label = step name from the i18n stub).
    const dots = screen.getAllByRole('button', { name: /agentContext\.wizard\.step\./ })
    // Click the 3rd step (identity).
    fireEvent.click(dots[2])
    expect(screen.getByText('agentContext.wizard.identityQ')).toBeInTheDocument()
  })

  it('advances to step 2 (personality) when Next is clicked', () => {
    renderWizard()
    fireEvent.click(screen.getByText('agentContext.wizard.next'))
    expect(screen.getByText('agentContext.wizard.personalityQ')).toBeInTheDocument()
  })

  it('step 2 shows the 5 preset cards', () => {
    renderWizard()
    fireEvent.click(screen.getByText('agentContext.wizard.next'))  // go to step 2
    // 5 preset cards. The wizard prefers the live /presets name from
    // the hook (already i18n-resolved by the backend); falls back to
    // the frontend t() key for offline mode. The mock hook returns
    // the resolved English names.
    expect(screen.getByText('Concise')).toBeInTheDocument()
    expect(screen.getByText('Friendly')).toBeInTheDocument()
  })

  it('step 4 (review) shows the 4 files to be created', async () => {
    renderWizard()
    // 3 nexts: 1→2, 2→3, 3→4
    fireEvent.click(screen.getByText('agentContext.wizard.next'))
    fireEvent.click(screen.getByText('agentContext.wizard.next'))
    fireEvent.click(screen.getByText('agentContext.wizard.next'))
    expect(screen.getByText('agentContext.wizard.reviewQ')).toBeInTheDocument()
    // The 4 file labels are pulled from t(`agentContext.file.${id}`).
    expect(screen.getByText('agentContext.file.soul')).toBeInTheDocument()
    expect(screen.getByText('agentContext.file.identity')).toBeInTheDocument()
    expect(screen.getByText('agentContext.file.user')).toBeInTheDocument()
    expect(screen.getByText('agentContext.file.memory')).toBeInTheDocument()
  })

  it('"Create 4 files" calls saveBatch with 4 entries and closes', async () => {
    const { onClose } = renderWizard()
    // 3 nexts to reach step 4
    fireEvent.click(screen.getByText('agentContext.wizard.next'))
    fireEvent.click(screen.getByText('agentContext.wizard.next'))
    fireEvent.click(screen.getByText('agentContext.wizard.next'))
    // Click "Create 4 files" — t() returns "agentContext.wizard.create" with {n} → 4
    const createBtn = screen.getByText('agentContext.wizard.create')
    fireEvent.click(createBtn)

    await waitFor(() => expect(mockSaveBatch).toHaveBeenCalledTimes(1))
    const entries = mockSaveBatch.mock.calls[0][0]
    expect(entries).toHaveLength(4)
    expect(entries.map(e => e.id).sort()).toEqual(['identity', 'memory', 'soul', 'user'])
    // soul body comes from getPresetBody (mocked to return `# {id}\n\nbody for {id}`)
    const soul = entries.find(e => e.id === 'soul')
    expect(soul.content).toContain('concise')  // default preset
    // identity body from getRoleBody
    const identity = entries.find(e => e.id === 'identity')
    expect(identity.content).toContain('eng')  // default role
    // user body from buildUserBody
    const user = entries.find(e => e.id === 'user')
    expect(user.content).toMatch(/^# User/m)
    // memory body from buildMemoryBody
    const memory = entries.find(e => e.id === 'memory')
    expect(memory.content).toMatch(/^# Memory/m)

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('shows an error message if saveBatch reports failures', async () => {
    mockSaveBatch.mockResolvedValueOnce([
      { id: 'soul', ok: false, error: 'too long' },
      { id: 'identity', ok: true },
      { id: 'user', ok: true },
      { id: 'memory', ok: true },
    ])
    renderWizard()
    fireEvent.click(screen.getByText('agentContext.wizard.next'))
    fireEvent.click(screen.getByText('agentContext.wizard.next'))
    fireEvent.click(screen.getByText('agentContext.wizard.next'))
    fireEvent.click(screen.getByText('agentContext.wizard.create'))
    await waitFor(() =>
      expect(screen.getByText(/soul: too long/)).toBeInTheDocument(),
    )
  })

  it('"custom" role shows the textarea', () => {
    renderWizard()
    fireEvent.click(screen.getByText('agentContext.wizard.next'))  // step 2
    fireEvent.click(screen.getByText('agentContext.wizard.next'))  // step 3
    // The wizard prefers the live /roles name; mock returns "Custom".
    fireEvent.click(screen.getByText('Custom'))
    expect(screen.getByPlaceholderText('agentContext.identity.customPlaceholder'))
      .toBeInTheDocument()
  })
})
