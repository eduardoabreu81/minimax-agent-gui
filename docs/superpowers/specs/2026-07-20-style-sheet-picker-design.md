# Style Sheet Picker — Atelier

**Status:** Approved (verbal, via brainstorming Q&A)
**Scope:** Image panel → style sheet selector. Replaces the native `<select>` with a custom popover that integrates add/edit/delete and surfaces full description + body preview via hover.

## Problem

The current Image-panel selector has three issues:

1. **No delete affordance.** Users must open Settings → Style Sheets to delete a sheet. Image-panel users have no in-flow way to remove a sheet they no longer want.
2. **Description is squashed into the `<option>` label**, clipped at the OS dropdown width. The full description is invisible in the picker context — only the name (or first 50 chars of description) shows.
3. **Add-from-the-panel exists as a small `+` button**, but it's tucked into a label row. The mental model — "I'm picking a sheet, and I can also manage them right here" — isn't surfaced.

## Goals

- One picker surface that supports: **select, create, edit, delete, hover-preview**.
- Full description + body preview on **hover**, so the user doesn't have to open Settings just to read what a sheet says.
- Add / edit / delete inline in the same panel — no Settings round-trip.
- Disabled state when name/description is missing in the editor so users don't press "Save" and see nothing happen.

## Non-goals

- Reordering (drag-to-sort). The list is alphabetical by name today; keep it.
- Multi-select. One sheet per generation, same as before.
- Replacing the Settings → Style Sheets tab. It stays as the bulk-management surface.
- Visual changes to the StyleSheetEditor body (form fields, preview pane). Only fix the disabled / error-visibility bugs called out below.

## Design — Atelier aesthetic

Visual language: **index-card atelier**. Each sheet is a small card with a thin border, monospace name, and a single-line description in ellipsis. The trigger chip is the selected card front; the popover is the file drawer.

### Trigger (chip)

Two states:

- **None**: dashed-border placeholder reading `No style sheet`. A small `+` icon on the right opens the picker to "new sheet" flow.
- **Selected**: solid border, monospace name in primary color, description as a one-line caption underneath (ellipsized). A small caret indicates the popover; an inline trash icon appears on hover for quick delete.

Width matches the existing prompt textarea column. Height ≈ 56px.

### Popover

Anchored under the trigger (same column width, max ~360px tall, scrollable if many sheets).

Header: `Style sheets` (title) + `+ New` action on the right.

Body:

1. Search input (`Search sheets…`, filters by name + description).
2. List of rows:
   - **None** row — same row design as a sheet, no description.
   - **Sheet rows** — radio dot (selected = filled), monospace name, description (1 line, ellipsized). Hover reveals a **trash** icon at the right. Click anywhere else on the row selects the sheet.
   - Each row has `data-testid="style-sheet-row-<name>"`.

Hover-only floating tooltip (CSS `:hover` on the row, not a popover — so it never collides with the trash button):

```
┌─────────────────────────────────┐
│ watercolor-pastel               │
│ ───────────────────────────────│
│ 수채화, 파스텔톤, 부드러운 아침 │
│ 햇살, 젖은 종이 질감            │
│                                 │
│ {prompt} placeholder: 1        │
│ Body preview:                   │
│   Watercolor of {prompt}, ...   │
└─────────────────────────────────┘
```

The tooltip reads `raw_markdown` from a lazy `getStyleSheet(name)` call, cached per name for the session. If the fetch fails, fall back to description only.

### Add / Edit / Delete

- **Add**: `+ New` opens the existing `StyleSheetEditor` in create mode. On save, picker merges the new sheet into its list and selects it (same as today).
- **Edit**: small pencil icon on each row (or click on the name). Opens `StyleSheetEditor` in edit mode, prefilled.
- **Delete**: hover trash icon → confirm modal reusing `SessionActionGuard` — `Delete style sheet "X"? This removes the sheet directory.` On confirm, DELETE then refresh list. If the deleted sheet was selected, fall back to `None`.

### StyleSheetEditor fix — disabled + visible error

Two independent bugs the user hit while authoring the previous turn:

1. **Save button was not disabled when name/description was empty.** The button only checked `bodyTooLong || tooManyPlaceholders`. Result: users could click it and see nothing happen, since the next thing that fires is an `onError` to the parent — which paints a banner the modal's `z-40` overlay covers. Users perceived this as "button does nothing".
2. **Validation errors were invisible inside the modal.** The parent's `onError` shows an ImagePanel error banner that sits behind the `StyleSheetModal`'s full-screen overlay.

Fix:

- Add `name.trim() === '' || description.trim() === ''` to the save button's `disabled` expression.
- Add an `inlineError` state inside `StyleSheetEditor`. Every `onError?.(...)` call site routes through a new `reportError(msg)` that sets `inlineError` first, then optionally forwards to `onError`. The inline error renders as a red banner inside the modal body, above the action row. Auto-clears after 4 s.

This is the same fix already started by the previous patch — finish it here so the picker and the editor are consistent.

## Component surface

New file: `desktop/src/components/style-sheets/StyleSheetPicker.jsx` (+ test).

```
<StyleSheetPicker
  value={styleSheet}                       // '' | name
  sheets={styleSheets}                     // array from useStyleSheets()
  onChange={(name) => setStyleSheet(name)} // '' clears
  onCreate={() => setEditor({mode:'create'})}
  onEdit={(sheet) => setEditor({mode:'edit', sheet})}
  onDelete={async (name) => { /* calls deleteStyleSheet, returns boolean */ }}
  overBudget={overBudget}
  combinedLen={combinedLen}
  promptMax={PROMPT_MAX}
/>
```

The picker is presentation-only. State for editor modal + delete confirm lives in ImagePanel (same pattern as today's `styleEditorState`). The picker raises callbacks; the panel owns the side effects.

## Data flow

- `useStyleSheets()` — small hook in `desktop/src/hooks/useStyleSheets.js` that wraps `listStyleSheets` and re-fetches on demand. Returns `{ sheets, reload, remove(name) }`.
- `useStyleSheetTooltip(name)` — tiny hook that lazy-fetches `getStyleSheet(name)` on hover via a `useRef` + mouseenter handler, caches per name. Returns `{ data, loading, error }`. No UI; picker reads from it to render the floating tooltip.

## Files

| Path | Action |
|---|---|
| `desktop/src/components/style-sheets/StyleSheetPicker.jsx` | create |
| `desktop/src/components/style-sheets/StyleSheetPicker.test.jsx` | create |
| `desktop/src/components/style-sheets/index.js` | modify — export picker |
| `desktop/src/components/style-sheets/StyleSheetEditor.jsx` | modify — add `inlineError`, route `onError` through `reportError`, extend save `disabled` |
| `desktop/src/components/media/ImagePanel.jsx` | modify — replace native `<select>` block with `<StyleSheetPicker>`; add delete-confirm state |
| `desktop/src/hooks/useStyleSheets.js` | create |
| `desktop/src/hooks/useStyleSheetTooltip.js` | create |
| `desktop/src/i18n/en.json` + 5 others | modify — new keys under `styleSheets.*` and `image.*` |

## i18n keys

```
styleSheets.search             "Search sheets…"
styleSheets.searchEmpty        "No sheets match \"{query}\"."
styleSheets.noneChip           "No style sheet"
styleSheets.bodyPreview        "Body preview"
styleSheets.placeholderFound   "{placeholder} placeholder: {count} found"
styleSheets.deleteHint         "Delete this style sheet"
image.styleSheetOverBudgetHint "Combined prompt exceeds 1500 chars…"
```

Existing `styleSheets.delete` / `styleSheets.edit` / `styleSheets.create` / `styleSheets.none` / `styleSheets.confirmDelete` stay as-is and are reused.

## Verification

- Unit tests: `npm test -- --run StyleSheetPicker` (new) + existing `StyleSheetEditor.test.jsx` + `ImagePanel.style-create.test.jsx`.
- Browser smoke: open Image panel, create a sheet, see it appear in the picker, hover for tooltip, delete with confirm.
- i18n parity: every new key present in all six locales (`en`, `ko`, `ja`, `zh-CN`, `es`, `pt-BR`). Missing keys fall back to `en`.

## Risks

- **Popover z-index / click-outside**: must close on outside click + Escape. Use a `useRef` on the popover + document `mousedown` listener.
- **Tooltip fetch storm**: hovering many rows in quick succession could fire many `getStyleSheet` calls. The cache (Map per name) prevents re-fetches within the session.
- **Native focus / keyboard**: native `<select>` gave free keyboard nav. The picker must support Up/Down/Enter/Escape for keyboard parity.
