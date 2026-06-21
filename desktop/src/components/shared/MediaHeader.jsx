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

export default function MediaHeader({ icon, title, subtitle }) {
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
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--app-text)' }}>
          {title}
        </div>
        {subtitle && (
          <div style={{ fontSize: 11.5, color: 'var(--app-text-2)' }}>
            {subtitle}
          </div>
        )}
      </div>
    </div>
  );
}