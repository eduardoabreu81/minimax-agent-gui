// DocViewer.test.jsx — covers the read-only viewer.
//
// The viewer is a controlled async component: parent passes a
// fetchFn, viewer calls it on mount, then renders the result.
// We mock fetchFn and assert loading / error / content states.
//
// We test the `memory` and `daily` modes (the 2 things the viewer
// supports). The viewer title is built via the i18n stub which
// returns the key — assertions are on those keys.

import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import DocViewer from './DocViewer.jsx'

function makeFetch(data, opts = {}) {
  return vi.fn(() => {
    if (opts.reject) return Promise.reject(new Error(opts.reject))
    if (opts.empty) return Promise.resolve(null)
    return Promise.resolve(data)
  })
}

describe('DocViewer — memory mode', () => {
  it('renders a loading indicator while the fetch is in flight', () => {
    let resolveFetch
    const fetchFn = vi.fn(() => new Promise(r => { resolveFetch = r }))
    render(<DocViewer mode="memory" fetchFn={fetchFn} />)
    expect(screen.getByText(/Loading/i)).toBeInTheDocument()
    // Resolve to clean up
    resolveFetch({ content: '# Memory', char_count: 1, char_limit: 2200 })
  })

  it('renders the content + usage header once fetch resolves', async () => {
    const fetchFn = makeFetch({
      content: '§ one\n§ two',
      char_count: 10,
      char_limit: 2200,
    })
    render(<DocViewer mode="memory" fetchFn={fetchFn} />)
    await waitFor(() =>
      expect(screen.getByText(/§ one/)).toBeInTheDocument(),
    )
    // The usage header is built via t('agentContext.viewer.memory.usageHeader',
    // { pct, used, limit }) — t() stub returns the key with param substitution.
    expect(screen.getByText(/agentContext\.viewer\.memory\.usageHeader/)).toBeInTheDocument()
  })

  it('renders an empty-state message when content is empty', async () => {
    const fetchFn = makeFetch({ content: '', char_count: 0, char_limit: 2200 })
    render(<DocViewer mode="memory" fetchFn={fetchFn} />)
    await waitFor(() =>
      expect(screen.getByText('agentContext.viewer.memory.empty')).toBeInTheDocument(),
    )
  })

  it('shows the append-only badge', async () => {
    const fetchFn = makeFetch({ content: 'x', char_count: 1, char_limit: 2200 })
    render(<DocViewer mode="memory" fetchFn={fetchFn} />)
    await waitFor(() => screen.getByText('agentContext.viewer.memory.appendOnly'))
  })

  it('shows the error message when the fetch rejects', async () => {
    const fetchFn = makeFetch(null, { reject: 'Network down' })
    render(<DocViewer mode="memory" fetchFn={fetchFn} />)
    await waitFor(() => expect(screen.getByText('Network down')).toBeInTheDocument())
  })
})

describe('DocViewer — daily mode', () => {
  it('passes the date to fetchFn', async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve({ date: '2026-06-23', content: '## 10:00 — user\nhi\n---', size: 25 }),
    )
    render(<DocViewer mode="daily" date="2026-06-23" fetchFn={fetchFn} />)
    await waitFor(() => expect(fetchFn).toHaveBeenCalledWith('2026-06-23'))
  })

  it('renders the daily title (date interpolation is a key+substitution thing)', async () => {
    const fetchFn = makeFetch({ date: '2026-06-23', content: 'log content', size: 12 })
    render(<DocViewer mode="daily" date="2026-06-23" fetchFn={fetchFn} />)
    // The t() stub returns the key with {date} → "2026-06-23"
    // substitution, but the actual key string is "Logs for {date}" so
    // the result is the key unchanged. We just verify the title key
    // shows up; the i18n's actual substitution is tested by the i18n
    // module's own tests.
    expect(await screen.findByText('agentContext.viewer.daily.title'))
      .toBeInTheDocument()
  })

  it('does NOT show the append-only badge in daily mode (it is in the title only)', async () => {
    // Daily title contains the append-only note; the badge is memory-only.
    const fetchFn = makeFetch({ date: '2026-06-23', content: 'x', size: 1 })
    const { container } = render(
      <DocViewer mode="daily" date="2026-06-23" fetchFn={fetchFn} />,
    )
    await waitFor(() => screen.getByText(/agentContext\.viewer\.daily\.title/))
    expect(container.textContent).not.toContain('agentContext.viewer.memory.appendOnly')
  })

  it('re-fetches when the date prop changes', async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve({ date: 'X', content: 'content', size: 7 }),
    )
    const { rerender } = render(<DocViewer mode="daily" date="2026-06-23" fetchFn={fetchFn} />)
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1))
    rerender(<DocViewer mode="daily" date="2026-06-24" fetchFn={fetchFn} />)
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(2))
    expect(fetchFn.mock.calls[0][0]).toBe('2026-06-23')
    expect(fetchFn.mock.calls[1][0]).toBe('2026-06-24')
  })
})
