import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Wallet, RefreshCw, AlertCircle } from 'lucide-react'
import { apiFetch, apiWebSocketUrl } from '../lib/api.js'

/**
 * CreditBalanceWidget — small badge showing remaining credit balance.
 *
 * Reads from /api/minimax/quota. The backend payload exposes:
 *  - data.credit_balance (number, current balance)
 *  - data.credit_total   (number, total available this period)
 *
 * The widget refreshes:
 *  - On mount
 *  - Every 30s automatically
 *  - When window regains focus
 *  - When a `minimax:media-complete` window event is dispatched
 *    (any media panel can dispatch this to force a refresh after a
 *     generation completes)
 *
 * Props:
 *  - compact: show only the balance number (no label), useful in tight UIs
 *  - className: extra Tailwind classes to merge
 */
export default function CreditBalanceWidget({ compact = false, className = '' }) {
  const { t } = useTranslation()
  const [balance, setBalance] = useState(null)
  const [total, setTotal] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [lastUpdate, setLastUpdate] = useState(null)
  const mountedRef = useRef(true)

  const fetchBalance = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch('/api/minimax/quota')
      if (!mountedRef.current) return
      if (!res.ok) {
        setError('http_error')
        return
      }
      const data = await res.json()
      // Accept both shapes: { data: { credit_balance, ... } } and a flat object
      const payload = data?.data ?? data
      const bal = payload?.credit_balance
      const tot = payload?.credit_total
      // Only update if numeric values came back; if the backend hasn't migrated
      // yet, we just skip silently rather than wiping an existing display.
      if (typeof bal === 'number' && typeof tot === 'number') {
        setBalance(bal)
        setTotal(tot)
        setLastUpdate(Date.now())
      } else if (bal === null && tot === null) {
        // Explicit nulls — backend signals "not available"
        setBalance(null)
        setTotal(null)
      }
    } catch (e) {
      if (mountedRef.current) setError(e?.message || 'network_error')
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    fetchBalance()
    const interval = setInterval(fetchBalance, 30000)
    const onFocus = () => fetchBalance()
    const onMedia = () => fetchBalance()
    window.addEventListener('focus', onFocus)
    window.addEventListener('minimax:media-complete', onMedia)
    return () => {
      mountedRef.current = false
      clearInterval(interval)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('minimax:media-complete', onMedia)
    }
  }, [fetchBalance])

  const hasData = typeof balance === 'number' && typeof total === 'number'
  const pct = hasData && total > 0 ? Math.round((balance / total) * 100) : 0
  const lowBalance = hasData && balance / Math.max(total, 1) < 0.1

  if (!hasData) {
    // Hide silently when backend hasn't migrated yet — avoids cluttering UI
    return null
  }

  const baseClasses = 'flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[10px] font-medium transition-colors'
  const stateClasses = error
    ? 'bg-error/10 border-error/20 text-error'
    : lowBalance
      ? 'bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400'
      : 'bg-primary/5 border-primary/20 text-primary hover:bg-primary/10'

  const formattedBalance = balance.toLocaleString()
  const formattedTotal = total.toLocaleString()

  if (compact) {
    return (
      <div
        className={`${baseClasses} ${stateClasses} ${className}`}
        title={t('balance.tooltip', { balance: formattedBalance, total: formattedTotal })}
        onClick={fetchBalance}
        role="status"
        aria-live="polite"
      >
        <Wallet size={11} />
        <span>{formattedBalance}</span>
        {loading && <RefreshCw size={9} className="animate-spin opacity-60" />}
      </div>
    )
  }

  return (
    <div
      className={`${baseClasses} ${stateClasses} ${className}`}
      title={lastUpdate ? `Updated ${new Date(lastUpdate).toLocaleTimeString()}` : ''}
      onClick={fetchBalance}
      role="status"
      aria-live="polite"
    >
      <Wallet size={11} />
      <span className="text-foreground/80">{t('balance.credits')}:</span>
      <span>{formattedBalance}</span>
      <span className="text-muted-foreground/60">/</span>
      <span className="text-muted-foreground">{formattedTotal}</span>
      {lowBalance && <AlertCircle size={10} className="ml-0.5" />}
      {loading && <RefreshCw size={9} className="animate-spin opacity-60 ml-0.5" />}
    </div>
  )
}
