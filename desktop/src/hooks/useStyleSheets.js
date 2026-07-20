// useStyleSheets — thin wrapper around the style sheet CRUD client.
// Owns the in-memory list + a reload() function so consumers don't have
// to manage the load/success/error dance themselves.
//
// `remove(name)` deletes a sheet by name and updates local state
// optimistically after the server confirms the delete — if the server
// rejects, the local list is restored and the error is re-thrown so
// the caller can surface it.

import { useCallback, useEffect, useState } from 'react'
import { listStyleSheets, deleteStyleSheet as apiDelete } from '../lib/styleSheets.js'

export function useStyleSheets() {
  const [sheets, setSheets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await listStyleSheets()
      setSheets(list || [])
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }, [])

  const remove = useCallback(
    async (name) => {
      const previous = sheets
      // Optimistic remove so the row disappears immediately.
      setSheets((prev) => prev.filter((s) => s.name !== name))
      try {
        await apiDelete(name)
      } catch (e) {
        // Roll back on failure.
        setSheets(previous)
        throw e
      }
    },
    [sheets]
  )

  useEffect(() => {
    reload()
  }, [reload])

  return { sheets, loading, error, reload, remove }
}
