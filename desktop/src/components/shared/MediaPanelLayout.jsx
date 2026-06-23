// desktop/src/components/shared/MediaPanelLayout.jsx
//
// Two-zone shell for the media panels (Image, Video, Music, Speech).
// Layout per mockup at desktop/design-reference/MiniMax Studio.dc.html:
//
//   ┌──────────────────────────────────────────────────────────────────────┐
//   │ TOP BAR (optional, full-width — icon + title + sub-mode pills)       │
//   ├────────────┬─────────────────────────────────────────────────────────┤
//   │  CONTROLS  │   CANVAS                                                 │
//   │  (variable │   (flex: 1, min-width: 0)                                │
//   │   width)   │                                                          │
//   │            │   — optional inner header inside canvas body             │
//   │            │     (e.g. "History" for Speech/Clone/Design)             │
//   └────────────┴─────────────────────────────────────────────────────────┘
//
// Consumers wire:
//   {topBar}          — full-width bar above both columns (sub-mode switcher).
//                       When present, both columns start below it.
//   {controlsHeader}  — optional inline header at top of controls column
//                       (used by panels that don't have a topBar but still
//                        need an icon + title block).
//   {controls}        — left column body
//   {galleryHeader}   — optional 52px bar above the canvas (e.g. for Image
//                       panel's "Recent generations" header).
//   {canvas}          — right column body (free-form — put inner "History"
//                       title inside here if needed)
//
// controlsWidth defaults to 360 (matches mockup L393 for Image). Video,
// Music, Speech panels override it to 380/380/400 respectively.

export default function MediaPanelLayout({
  controlsWidth = 360,
  layout = 'split',     // 'split' (controls + canvas) | 'full' (single column for library views)
  controlsHeader,       // ReactNode — icon + title + subtitle, inline at top of controls
  topBar,               // ReactNode — full-width bar above the columns
  controls,             // ReactNode — left column body
  galleryHeader,        // ReactNode — title + subtitle, full-width 52px
  canvas,               // ReactNode — right column body
}) {
  const hasTopLevelHeader = !!(controlsHeader || topBar)
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        background: 'var(--app-bg)',
        overflow: 'hidden',
      }}
    >
      {/* TOP BAR — full-width bar above both columns. Used by Speech/Music
          for the icon + title + sub-mode pills. When present, the controls
          column and canvas start below this bar (not inside the controls
          column). Bottom border separates it from the columns. */}
      {topBar && (
        <div
          style={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            height: 56,
            padding: '0 22px',
            borderBottom: '0.5px solid var(--app-border)',
            background: 'var(--app-bg)',
          }}
        >
          {topBar}
        </div>
      )}

      {/* COLUMNS — controls (left) + canvas (right) */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, minWidth: 0 }}>
        {/* CONTROLS — sidebar (or full-width in 'full' layout) */}
        <div
          style={{
            width: layout === 'full' ? '100%' : controlsWidth,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            borderRight: layout === 'full' ? 'none' : '0.5px solid var(--app-border)',
            overflowY: 'auto',
            overflowX: 'hidden',
          }}
        >
          {/* Inline header — only if no topBar (the topBar serves as the header) */}
          {controlsHeader && !topBar && (
            <div
              style={{
                padding: '22px 22px 0',
                flexShrink: 0,
              }}
            >
              {controlsHeader}
            </div>
          )}

          {/* Controls body */}
          <div
            style={{
              padding: hasTopLevelHeader ? '18px 22px' : '22px',
              display: 'flex',
              flexDirection: 'column',
              gap: layout === 'full' ? 24 : 18,
            }}
          >
            {controls}
          </div>

          {/* Spacer so the Generate button sticks to the bottom */}
          <div style={{ flex: 1 }} />
        </div>

        {/* CANVAS — gallery with optional header (hidden in 'full' layout) */}
        {layout !== 'full' && (
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {/* Gallery header — mockup L456-459 (52px, padding 0 24px) */}
            {galleryHeader && (
              <div
                style={{
                  height: 52,
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0 24px',
                  borderBottom: '0.5px solid var(--app-border)',
                }}
              >
                {galleryHeader}
              </div>
            )}

            {/* Canvas body */}
            <div
              style={{
                flex: 1,
                padding: 24,
                minWidth: 0,
                overflow: 'auto',
              }}
            >
              {canvas}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}