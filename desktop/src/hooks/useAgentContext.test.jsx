// useAgentContext.test.jsx — unit tests for the hook.
//
// The hook calls apiFetch in a useEffect. We mock apiFetch to
// return canned responses and assert that the hook surfaces the
// right state (status, files, dailies, presets, roles) and that
// the save/fetch helpers hit the right URLs.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useAgentContext, buildUserBody, buildMemoryBody } from './useAgentContext.js'

// We mock ../lib/api.js so the hook doesn't try to reach a real
// backend. Each test sets the desired fetch response.
const mockApiFetch = vi.fn()
vi.mock('../lib/api.js', () => ({
  apiFetch: (...args) => mockApiFetch(...args),
}))

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => body,
  }
}

const CONFIG_OK = {
  agent_context: {
    missing: ['soul', 'user'],
    corrupt: [],
    banner_visible: true,
    char_usage: {
      soul: { used: 200, limit: 2000 },
      identity: { used: 0, limit: 2000 },
      user: { used: 50, limit: 1375 },
      memory: { used: 0, limit: 2200 },
    },
  },
}
const DAILIES_OK = { dailies: [{ date: '2026-06-23', size: 333, path: '/x' }] }
const PRESETS_OK = {
  presets: [
    { id: 'concise', name: 'Concise', desc: 'Direct', body: 'You are a senior engineer.' },
    { id: 'friendly', name: 'Friendly', desc: 'Warm', body: 'You are a warm partner.' },
  ],
}
const ROLES_OK = {
  roles: [
    { id: 'eng', name: 'Engineering partner', desc: 'Code', body: 'You are an eng.' },
    { id: 'custom', name: 'Custom', desc: 'Define' },  // no body
  ],
}

beforeEach(() => {
  mockApiFetch.mockReset()
  // Default: all 4 initial fetches succeed.
  mockApiFetch.mockImplementation((path) => {
    if (path === '/api/config') return Promise.resolve(jsonResponse(CONFIG_OK))
    if (path.startsWith('/api/agent-context/dailies')) return Promise.resolve(jsonResponse(DAILIES_OK))
    if (path === '/api/agent-context/presets') return Promise.resolve(jsonResponse(PRESETS_OK))
    if (path === '/api/agent-context/roles') return Promise.resolve(jsonResponse(ROLES_OK))
    return Promise.reject(new Error(`Unexpected path in mock: ${path}`))
  })
})

describe('useAgentContext — initial load', () => {
  it('fetches /config, /dailies, /presets, /roles in parallel on mount', async () => {
    const { result } = renderHook(() => useAgentContext())
    await waitFor(() => expect(result.current.loading).toBe(false))
    const calledPaths = mockApiFetch.mock.calls.map(c => c[0])
    expect(calledPaths).toContain('/api/config')
    expect(calledPaths.some(p => p.startsWith('/api/agent-context/dailies'))).toBe(true)
    expect(calledPaths).toContain('/api/agent-context/presets')
    expect(calledPaths).toContain('/api/agent-context/roles')
  })

  it('surfaces the agent_context status from /api/config', async () => {
    const { result } = renderHook(() => useAgentContext())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.status.banner_visible).toBe(true)
    expect(result.current.status.missing).toEqual(['soul', 'user'])
    expect(result.current.status.char_usage.soul.used).toBe(200)
  })

  it('surfaces the dailies list', async () => {
    const { result } = renderHook(() => useAgentContext())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.dailies).toEqual([
      { date: '2026-06-23', size: 333, path: '/x' },
    ])
  })

  it('surfaces the presets and roles', async () => {
    const { result } = renderHook(() => useAgentContext())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.presets).toHaveLength(2)
    expect(result.current.roles).toHaveLength(2)
  })

  it('does not crash if /config fails', async () => {
    mockApiFetch.mockImplementation((path) => {
      if (path === '/api/config') return Promise.reject(new Error('boom'))
      if (path.startsWith('/api/agent-context/dailies')) return Promise.resolve(jsonResponse(DAILIES_OK))
      if (path === '/api/agent-context/presets') return Promise.resolve(jsonResponse(PRESETS_OK))
      if (path === '/api/agent-context/roles') return Promise.resolve(jsonResponse(ROLES_OK))
    })
    const { result } = renderHook(() => useAgentContext())
    await waitFor(() => expect(result.current.loading).toBe(false))
    // Status is the default (empty) since /config failed.
    expect(result.current.status.banner_visible).toBe(false)
    expect(result.current.error).toBeTruthy()
  })
})

describe('useAgentContext — saveFile', () => {
  it('PUTs to /api/agent-context/{id} with JSON body', async () => {
    // First 4 calls are the initial load; the 5th is the PUT.
    const { result } = renderHook(() => useAgentContext())
    await waitFor(() => expect(result.current.loading).toBe(false))
    mockApiFetch.mockClear()
    mockApiFetch.mockResolvedValueOnce(
      jsonResponse({
        id: 'soul',
        char_count: 100,
        char_limit: 2000,
        sessions_invalidated: 0,
        status: CONFIG_OK.agent_context,
      }),
    )

    await act(async () => {
      await result.current.saveFile('soul', 'new content here')
    })

    const [path, init] = mockApiFetch.mock.calls[0]
    expect(path).toBe('/api/agent-context/soul')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({ content: 'new content here' })
  })

  it('updates the local files cache after a successful save', async () => {
    const { result } = renderHook(() => useAgentContext())
    await waitFor(() => expect(result.current.loading).toBe(false))
    mockApiFetch.mockResolvedValueOnce(
      jsonResponse({
        id: 'user', char_count: 12, char_limit: 1375,
        sessions_invalidated: 0, status: CONFIG_OK.agent_context,
      }),
    )
    await act(async () => {
      await result.current.saveFile('user', 'hello there')
    })
    expect(result.current.files.user.content).toBe('hello there')
    expect(result.current.files.user.char_count).toBe(12)
  })

  it('throws on 4xx with the backend detail', async () => {
    const { result } = renderHook(() => useAgentContext())
    await waitFor(() => expect(result.current.loading).toBe(false))
    mockApiFetch.mockResolvedValueOnce(
      jsonResponse({ detail: 'Content too long: 9999 > 2000' }, 413),
    )
    await expect(
      result.current.saveFile('soul', 'x'.repeat(9999)),
    ).rejects.toThrow(/Content too long/)
  })
})

describe('useAgentContext — saveBatch', () => {
  it('writes all entries in parallel and returns per-id results', async () => {
    const { result } = renderHook(() => useAgentContext())
    await waitFor(() => expect(result.current.loading).toBe(false))
    mockApiFetch.mockReset()
    mockApiFetch.mockImplementation((path, init) => {
      if (init?.method !== 'PUT') return Promise.resolve(jsonResponse(DAILIES_OK))
      return Promise.resolve(
        jsonResponse({
          id: path.split('/').pop(),
          char_count: 100,
          char_limit: 2000,
          sessions_invalidated: 0,
          status: CONFIG_OK.agent_context,
        }),
      )
    })

    const entries = [
      { id: 'soul', content: 's' },
      { id: 'user', content: 'u' },
    ]
    let results
    await act(async () => {
      results = await result.current.saveBatch(entries)
    })
    expect(results).toHaveLength(2)
    expect(results[0]).toMatchObject({ id: 'soul', ok: true })
    expect(results[1]).toMatchObject({ id: 'user', ok: true })
  })

  it('reports per-id errors when one fails', async () => {
    const { result } = renderHook(() => useAgentContext())
    await waitFor(() => expect(result.current.loading).toBe(false))
    mockApiFetch.mockReset()
    mockApiFetch.mockImplementation((path, init) => {
      if (init?.method !== 'PUT') return Promise.resolve(jsonResponse(DAILIES_OK))
      if (path.endsWith('/user')) {
        return Promise.resolve(jsonResponse({ detail: 'too long' }, 413))
      }
      return Promise.resolve(
        jsonResponse({
          id: path.split('/').pop(), char_count: 1, char_limit: 2000,
          sessions_invalidated: 0, status: CONFIG_OK.agent_context,
        }),
      )
    })

    const entries = [
      { id: 'soul', content: 's' },
      { id: 'user', content: 'u' },
    ]
    let results
    await act(async () => {
      results = await result.current.saveBatch(entries)
    })
    expect(results[0]).toMatchObject({ id: 'soul', ok: true })
    expect(results[1]).toMatchObject({ id: 'user', ok: false })
    expect(results[1].error).toMatch(/too long/)
  })
})

describe('useAgentContext — fetchDaily', () => {
  it('returns the parsed JSON for an existing date', async () => {
    const { result } = renderHook(() => useAgentContext())
    await waitFor(() => expect(result.current.loading).toBe(false))
    mockApiFetch.mockResolvedValueOnce(
      jsonResponse({ date: '2026-06-23', content: '## 10:00 — user\nhi\n---', size: 25 }),
    )
    const data = await result.current.fetchDaily('2026-06-23')
    expect(data.date).toBe('2026-06-23')
    expect(data.content).toContain('hi')
  })

  it('returns null for a 404 (no log on that day)', async () => {
    const { result } = renderHook(() => useAgentContext())
    await waitFor(() => expect(result.current.loading).toBe(false))
    mockApiFetch.mockResolvedValueOnce(jsonResponse({ detail: 'not found' }, 404))
    const data = await result.current.fetchDaily('2099-12-31')
    expect(data).toBeNull()
  })
})

describe('useAgentContext — preset/role body helpers', () => {
  it('getPresetBody returns the live body when available', async () => {
    const { result } = renderHook(() => useAgentContext())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.getPresetBody('concise')).toBe('You are a senior engineer.')
    expect(result.current.getPresetBody('friendly')).toBe('You are a warm partner.')
  })

  it('getPresetBody falls back to the JS map for unknown ids', async () => {
    const { result } = renderHook(() => useAgentContext())
    await waitFor(() => expect(result.current.loading).toBe(false))
    // 'mentor' isn't in the canned PRESETS_OK response, so the live
    // lookup fails and we fall back to the JS-side map.
    const body = result.current.getPresetBody('mentor')
    expect(body).toMatch(/Mentor|why|explanation/i)
  })

  it('getRoleBody returns empty for the custom role (no canonical body)', async () => {
    const { result } = renderHook(() => useAgentContext())
    await waitFor(() => expect(result.current.loading).toBe(false))
    // The live /roles response for 'custom' has no body field.
    expect(result.current.getRoleBody('custom')).toBe('')
  })

  it('getRoleBody returns the live body for eng', async () => {
    const { result } = renderHook(() => useAgentContext())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.getRoleBody('eng')).toBe('You are an eng.')
  })
})

describe('body builders', () => {
  it('buildUserBody includes the name + timezone + level', () => {
    const body = buildUserBody('Eduardo', 'America/Sao_Paulo', 'senior')
    expect(body).toContain('Eduardo')
    expect(body).toContain('America/Sao_Paulo')
    expect(body).toContain('senior')
  })

  it('buildMemoryBody is non-empty and starts with a header', () => {
    const body = buildMemoryBody()
    expect(body.length).toBeGreaterThan(20)
    expect(body).toMatch(/^#\s/)
  })
})
