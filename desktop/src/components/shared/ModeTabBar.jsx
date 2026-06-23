// desktop/src/components/shared/ModeTabBar.jsx
//
// Pill-style tab bar rendered as a fixed top bar (between the panel header
// and the two-column body) when a panel exposes multiple sub-modes that
// rewire BOTH columns below. Used by Speech (4 modes) and Music (3 modes).
//
// Visual target — mockup lines 621-634 (Music) and 886-892 (Speech):
//
//   ┌──────────────────────────────────────────────────────┐
//   │ Compose   Cover   Lyrics                             │
//   └──────────────────────────────────────────────────────┘
//
// Mockup has compact text-only pills (no per-button icons, tight padding).
// That keeps the bar narrow enough to sit alongside the panel title in
// a 400px controls column without squeezing the title off-screen.
//
// • Container: surface bg, 0.5px border, 3px padding, 9px radius
// • Active pill: primary bg, white text
// • Inactive: transparent bg, muted-foreground text
// • Label only (text), font 12px / 600

export default function ModeTabBar({ modes, active, onChange }) {
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
            {m.label}
          </button>
        )
      })}
    </div>
  )
}
