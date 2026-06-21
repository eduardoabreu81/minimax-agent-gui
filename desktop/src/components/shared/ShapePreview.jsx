// desktop/src/components/shared/ShapePreview.jsx
//
// Tiny visual rectangle used inside the aspect-ratio trigger and dropdown.
// Renders the actual aspect-ratio width × height from the data (already
// pre-sized — see mockup aspectDefs L1084-1093: 1:1 = 22×22, 16:9 = 26×15,
// 21:9 = 28×12, etc.). Closed trigger uses 90% height (mockup L1106).
//
// Style follows mockup L1094:
//   border-radius 3px, border 2px solid (active = pri, inactive = mfg),
//   background (active = pri/.2, inactive = transparent).

export default function ShapePreview({ width, height, active = false }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'block',
        width,
        height,
        borderRadius: 3,
        border: `2px solid ${active ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))'}`,
        background: active ? 'hsl(var(--primary) / 0.2)' : 'transparent',
        flexShrink: 0,
      }}
    />
  );
}