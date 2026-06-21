// desktop/src/components/shared/GalleryHeader.jsx
//
// Full-width 52px header that sits above the gallery canvas.
// Mirrors mockup lines 456-459:
//
//   ┌────────────────────────────────────────────────────┐
//   │ Recent generations        Saved to workspace/.../ │
//   └────────────────────────────────────────────────────┘
//
// Title 13px weight 600. Subtitle 11.5px muted-foreground.

export default function GalleryHeader({ title, subtitle }) {
  return (
    <>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--app-text)' }}>
        {title}
      </span>
      {subtitle && (
        <span style={{ fontSize: 11.5, color: 'var(--app-text-2)' }}>
          {subtitle}
        </span>
      )}
    </>
  );
}