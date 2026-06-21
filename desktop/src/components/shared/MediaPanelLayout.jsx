// desktop/src/components/shared/MediaPanelLayout.jsx
//
// Two-zone shell for the media panels (Image, Video, Music, Speech).
// Mirrors the mockup at desktop/design-reference/MiniMax Studio.dc.html
// (lines 391-470 for Image, 475-588 for Video, 593-682 for Music,
// 686-781 for Speech):
//
//   ┌────────────┬──────────────────────────────────────────────────────┐
//   │  CONTROLS  │   GALLERY HEADER (52px)                               │
//   │  (variable │   ─────────────────────────────────────────────────  │
//   │   width)   │                                                       │
//   │            │                                                       │
//   │  header    │   CANVAS                                              │
//   │  inline    │   (flex: 1, min-width: 0)                             │
//   │            │                                                       │
//   └────────────┴──────────────────────────────────────────────────────┘
//
// Consumers wire {controlsHeader} (inline at top of the controls column,
// exactly where the mockup puts the icon + title + subtitle), {controls}
// (rest of the left column, vertical), and {canvas} (right column free-form).
//
// controlsWidth defaults to 360 (matches mockup L393 for Image). Video,
// Music, Speech panels override it to 380/380/400 respectively.

export default function MediaPanelLayout({
  controlsWidth = 360,
  controlsHeader,       // ReactNode — icon + title + subtitle, inline
  controls,             // ReactNode — left column body
  galleryHeader,        // ReactNode — title + subtitle, full-width 52px
  canvas,               // ReactNode — right column body
}) {
  return (
    <div
      style={{
        display: 'flex',
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        background: 'var(--app-bg)',
        overflow: 'hidden',
      }}
    >
      {/* CONTROLS — sidebar with optional inline header */}
      <div
        style={{
          width: controlsWidth,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          borderRight: '0.5px solid var(--app-border)',
          overflowY: 'auto',
          overflowX: 'hidden',
        }}
      >
        {/* Inline header (icon + title + subtitle) — mockup L394-401 */}
        {controlsHeader && (
          <div
            style={{
              padding: '22px 22px 0',
              flexShrink: 0,
            }}
          >
            {controlsHeader}
          </div>
        )}

        {/* Controls body — mockup L403 (gap 18px between fields) */}
        <div
          style={{
            padding: controlsHeader ? '18px 22px' : '22px',
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
          }}
        >
          {controls}
        </div>

        {/* Spacer so the Generate button sticks to the bottom */}
        <div style={{ flex: 1 }} />
      </div>

      {/* CANVAS — gallery with optional header */}
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
    </div>
  );
}