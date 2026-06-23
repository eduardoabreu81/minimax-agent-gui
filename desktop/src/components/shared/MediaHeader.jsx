// desktop/src/components/shared/MediaHeader.jsx
//
// Inline header for the media panels (top of the controls column).
// Mirrors mockup lines 394-401:
//
//   ┌───────────────────────────────────────────┐
//   │ [icon] Title                              │
//   │         Subtitle (muted, 11.5px)         │
//   └───────────────────────────────────────────┘
//
// 34×34 icon container with bg primary/.14 + primary color.
// Title 15px weight 600. Subtitle 11.5px muted-foreground.
//
// When `right` is provided (e.g. ModeTabBar), the subtitle is hidden —
// the right slot already conveys the same mode information visually, so
// keeping the subtitle would just cause it to wrap and squeeze the pills.

export default function MediaHeader({ icon, title, subtitle, right }) {
  const showSubtitle = subtitle && !right
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
      <div
        style={{
          width: 34,
          height: 34,
          flexShrink: 0,
          borderRadius: 9,
          background: 'hsl(var(--primary) / 0.14)',
          color: 'hsl(var(--primary))',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {icon}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{
          fontSize: 15, fontWeight: 600, color: 'var(--app-text)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {title}
        </div>
        {showSubtitle && (
          <div style={{
            fontSize: 11.5, color: 'var(--app-text-2)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {subtitle}
          </div>
        )}
      </div>
      {right && (
        <div style={{ flexShrink: 0 }}>
          {right}
        </div>
      )}
    </div>
  );
}