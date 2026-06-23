// useBackendReady — healthcheck the FastAPI sidecar before mounting the app.
//
// During `npm run tauri:dev`, Vite serves the React frontend in ~300ms but
// the bundled backend.exe takes 1-2s to start uvicorn on port 8765. If
// the React tree mounts immediately, every panel fires off `fetch('/api/...')`
// calls that hit a closed port and the user sees a broken app.
//
// This hook polls `/api/config` (a cheap, idempotent endpoint that returns
// `api_key_configured` + `region`) until it responds 2xx or the timeout
// elapses. The matching timeout on the Rust side is
// `HEALTHCHECK_TIMEOUT = Duration::from_secs(30)` in
// desktop/src-tauri/src/lib.rs — keep them in sync.
//
// Why `/api/config` (and not `/` or `/healthz`):
//   - It already exists and is exercised on app boot by the StatusBar /
//     QuickSettings widgets.
//   - It returns a small JSON so a real 200 is unmistakable.
//   - It also doubles as the first config fetch — once ready, the app can
//     read region + api_key_configured without a second round-trip.
//
// Returns:
//   { ready, status, error, attempt, retry }
//   - status: 'connecting' | 'ready' | 'error'
//   - ready:  true once /api/config returned 2xx

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '../lib/api.js'

const POLL_INTERVAL_MS = 800
const TIMEOUT_MS = 30_000

export function useBackendReady() {
  const [state, setState] = useState({
    ready: false,
    status: 'connecting',
    error: null,
    attempt: 0,
  })

  const stoppedRef = useRef(false)
  const timerRef = useRef(null)

  const runPoll = useCallback(async () => {
    const startedAt = Date.now()
    let attempt = 0

    while (!stoppedRef.current) {
      attempt += 1
      setState((s) => ({ ...s, attempt }))

      // Hard timeout — matches lib.rs HEALTHCHECK_TIMEOUT.
      if (Date.now() - startedAt > TIMEOUT_MS) {
        setState({
          ready: false,
          status: 'error',
          error: `Backend did not respond within ${TIMEOUT_MS / 1000}s on port 8765. The bundled backend.exe may have failed to start — check the logs in %APPDATA%\\com.minimax.agent.desktop\\logs\\backend.stderr.log`,
          attempt,
        })
        return
      }

      try {
        const res = await apiFetch('/api/config', { method: 'GET' })
        if (res && res.ok) {
          setState({ ready: true, status: 'ready', error: null, attempt })
          return
        }
        // Non-2xx (404/500/etc) means the server is up but something is
        // wrong. Treat as still-booting and keep polling — a 500 here
        // usually means a config load race, which resolves on the next tick.
      } catch {
        // Network error — port not open yet. Keep polling.
      }

      // Sleep with cancellation awareness: if `stoppedRef` flips (retry
      // or unmount), bail out of the sleep early instead of waiting a
      // full interval.
      await new Promise((resolve) => {
        timerRef.current = setTimeout(resolve, POLL_INTERVAL_MS)
      })
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [])

  const retry = useCallback(() => {
    stoppedRef.current = true
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    // Microtask gap so any in-flight poll resolves cleanly first.
    setTimeout(() => {
      stoppedRef.current = false
      setState({ ready: false, status: 'connecting', error: null, attempt: 0 })
      runPoll()
    }, 50)
  }, [runPoll])

  useEffect(() => {
    stoppedRef.current = false
    runPoll()
    return () => {
      stoppedRef.current = true
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [runPoll])

  return { ...state, retry }
}