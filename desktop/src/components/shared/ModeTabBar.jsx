// desktop/src/components/shared/ModeTabBar.jsx

import { useTranslation } from 'react-i18next'

// Pill-style tab bar rendered as a fixed top bar (between the panel header
// and the two-column body) when a panel exposes multiple sub-modes that
// rewire BOTH columns below. Used by Speech (4 modes) and Music (3 modes).
//
// Modes expose `labelKey` for i18n; the bar resolves it via `useTranslation`.
// Callers that want a literal label can pass `label` instead.
export default function ModeTabBar({ modes, active, onChange }) {
  const { t } = useTranslation()
  return (
    <div
      style={{
        display: 'flex',
        gap: 2,
        background: 'var(--app-surface)',
        padding: 3,
        borderRadius: 9,
        border: '0.5px solid var(--app-border)',
        width: 'fit-content',
      }}
    >
      {modes.map((m) => {
        const isActive = active === m.id
        return (
          <button
            key={m.id}
            onClick={() => onChange(m.id)}
            style={{
              padding: '5px 11px',
              borderRadius: 7,
              border: 'none',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
              background: isActive ? 'hsl(var(--primary))' : 'transparent',
              color: isActive ? '#fff' : 'var(--app-text-2)',
              transition: 'all 0.15s',
              whiteSpace: 'nowrap',
            }}
          >
            {m.labelKey ? t(m.labelKey) : m.label}
          </button>
        )
      })}
    </div>
  )
}
