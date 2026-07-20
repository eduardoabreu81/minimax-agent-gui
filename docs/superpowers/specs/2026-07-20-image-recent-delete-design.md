# Image Recent Generations — Delete from Gallery

**Date:** 2026-07-20
**Scope:** ImagePanel `RecentGenerations` (image type only)
**Status:** Proposed

## Problem

`ImagePanel` shows generated images in a "Recent Generations" gallery, but
there is no way to remove an unwanted image. Files accumulate under
`workspace/generations/images/` and the gallery grows without bound.

The user explicitly asked for the ability to delete images from the
Recent Generations list. We follow the deletion UX that already exists
for anchors, style sheets, voice clones, and skills.

## Goal

- Delete a single image from the Recent Generations list.
- Remove the corresponding file from disk so it does not return on
  refresh or app restart.
- Block accidental deletes with a confirm step.
- Give success / failure feedback.

## Non-Goals

- Deleting music / TTS / video from their panels. Not requested; can be
  added later with the same pattern.
- Bulk delete. Not requested.
- Undo / soft-delete / trash. Adds a manifest layer that isn't
  justified today.

## Design

### API: `DELETE /api/generations/image`

Request:

```
DELETE /api/generations/image?path=generations/images/image_1234.png
```

Why query string: matches the existing pattern used by `/api/files/download`
and `/api/files/raw` (`?path=...`). The path is the same workspace-relative
string returned by `/api/generations` so the frontend can pass it straight
back without translation.

Behavior:

1. Resolve `path` against the **app workspace** root using `_safe_join`.
2. Require the resolved target to live under
   `workspace/generations/images/`. Reject anything outside (403) so a
   crafted path cannot delete anchors, config, or arbitrary files.
3. If the file exists, `unlink()` it. Missing file is not an error
   (idempotent — the user already deleted it in another tab).
4. Return `{"success": true, "deleted": "<path>"}`.

Errors:

- 400 missing `path`
- 403 path escapes workspace or escapes `generations/images/`
- 500 unexpected I/O failure

### Frontend: `RecentGenerations` delete affordance

- New optional prop `onDeleteImage?: (item) => void | Promise<void>`.
- Only rendered when `type === 'image' && onDeleteImage` is provided.
- Image hover overlay gains a third icon button (red `Trash2`) after
  Download and Promote-to-anchor. Same size, same `bg-white/90` style.
- The whole grid keeps its current layout. The delete button stops
  click propagation so clicking it doesn't open the image.

### Frontend: `ImagePanel` delete handler

- `handleDeleteImage(item)`:
  1. `confirm(t('image.confirmDelete', { name: item.name }))` — match
     existing UX in AnchorLibrary / SkillsTab / StyleSheetsTab.
  2. `DELETE /api/generations/image?path=...`.
  3. On success: `setGallery(prev => prev.filter(i => i.path !== item.path))`
     + `showMessage(t('image.toastDeleted', { name: item.name }))`.
  4. On HTTP 404: treat as success (file already gone) and remove from
     gallery anyway.
  5. On any other error: `showMessage(err.message)` and leave gallery
     untouched.

### Toast / message

ImagePanel already runs an inline `showMessage`-style banner via the
existing pattern. Reuse it: a single message state cleared by a 2.5 s
`setTimeout`, matching `SkillsTab.showMessage` and
`StyleSheetsTab.showMessage`.

### i18n keys

- `image.confirmDelete`: "Delete image \"{name}\"? This cannot be undone."
- `image.toastDeleted`: "Image \"{name}\" deleted."
- `image.toastDeleteFailed`: "Could not delete image: {message}"
- Add to en, ko, es, ja, pt-BR, zh-CN (default values shown above; the
  other locales fall back to en if missing, per existing i18n policy).

## Files Touched

- `web/backend/main.py` — new `DELETE /api/generations/image` endpoint
- `desktop/src/components/media/RecentGenerations.jsx` — add delete
  button to image hover overlay, new `onDeleteImage` prop
- `desktop/src/components/media/ImagePanel.jsx` — `handleDeleteImage`,
  pass `onDeleteImage` to `RecentGenerations`, message state
- `desktop/src/i18n/{en,ko,es,ja,pt-BR,zh-CN}.json` — 3 new keys
- `tests/test_image_recent_delete.py` — endpoint + path-traversal tests

## Testing

Backend (pytest, no live API key):

- `test_delete_removes_file_and_returns_path` — create a fake png under
  `generations/images/`, DELETE, assert 200 + file gone.
- `test_delete_missing_file_is_idempotent` — DELETE on a path that
  doesn't exist returns 200 and does not raise.
- `test_delete_rejects_path_outside_workspace` — `../../etc/passwd`
  returns 403.
- `test_delete_rejects_path_outside_images_dir` — `generations/music/x.mp3`
  returns 403 (not in images scope).
- `test_delete_rejects_empty_path` — returns 400.

Frontend (Vitest + Testing Library, optional but cheap):

- `ImagePanel.test.jsx` — mock `apiFetch` and confirm: clicking the
  delete button, confirming, triggers `DELETE` and removes the item
  from the gallery.

## Risks

- A buggy client could craft `path` strings that escape the workspace.
  Mitigated by `_safe_join` (already in use) and the `generations/images/`
  scope check (new).
- Race: two tabs delete the same file. Backend handles it idempotently;
  the second tab's gallery refresh sees the file gone and drops it.
