# Video Anchor — Design Spec

**Date:** 2026-07-20
**Status:** Approved (simplified — character reference image library)
**Scope:** Add reusable image "anchor" cards to the Video panel, sent as `subject_reference[]` to the MiniMax Hailuo API so a character or subject maintains visual consistency throughout the generated video and across multiple generations.

## Motivation

When a character appears throughout a generated video, the model needs a visual reference to keep that character looking the same. The Video panel previously had no persistence layer for reference images — each generation was stateless. Users who wanted a consistent character across multiple generations had no way to save and re-attach the reference.

## What an Anchor Is (and Isn't)

An anchor is **a simple image** used as a character/subject visual reference.

- ✅ An anchor IS a reusable image card in a persistent library.
- ✅ Anchors map to MiniMax's `subject_reference[]` parameter — the API's mechanism for subject/character visual consistency.
- ❌ An anchor is NOT a `first_frame_image` (the starting frame of the video is a separate concept, handled by the existing image2video mode's manual dropzone).
- ❌ An anchor is NOT a text prompt expansion. The image itself is the reference; no description is injected into the prompt.
- ❌ No type system (subject/scene). All anchors are the same — reference images. The model infers their role from the prompt context.

## API Mapping

| Attached anchors | MiniMax API param |
|---|---|
| 0–4 anchor images | `subject_reference[]` (list of data URLs) |

The frontend fetches each anchor's saved image via `/api/files/raw`, converts to a base64 data URL, and sends the list as `subject_reference` in the `/api/video` payload. The `/api/video` endpoint itself is **unchanged** — it already passes `subject_reference` straight through.

The existing manual frame dropzones (`first_frame_image`, `last_frame_image`, `subject_image` for s2v mode) work independently. When anchors are attached, they take precedence over the manual `subject_image` dropzone.

## Data Model

### Anchor object

```json
{
  "id": "uuid-v4",
  "name": "string (1–60 chars) — user-facing label",
  "description": "string (0–500 chars) — optional user note / auto-generated caption",
  "image": {
    "path": "anchors/<id>.<ext>     // workspace-relative",
    "source": "upload" | "image-history",
    "source_ref": "string | null"
  },
  "created_at": "ISO 8601",
  "updated_at": "ISO 8601"
}
```

### Library manifest

- File: `workspace/anchors/anchors.json`
- Schema: `{ "version": 1, "anchors": [Anchor, ...] }`
- Image files stored alongside as `workspace/anchors/<id>.<ext>`.

## Backend (`web/backend/main.py`)

CRUD + one VLM wrapper. The video generation path is untouched.

| Endpoint | Purpose |
|---|---|
| `GET /api/anchors` | List library |
| `POST /api/anchors` | Create — JSON body with `image_data_url` (base64), `name`, `description` |
| `PUT /api/anchors/{id}` | Update name / description |
| `DELETE /api/anchors/{id}` | Delete (removes image file too) |
| `POST /api/anchors/describe` | VLM auto-describe — body `{ anchor_id }` XOR `{ image_data_url }`. Works pre-commit (editor modal) and post-commit (re-describe from library). |

## Frontend

### Components

- `desktop/src/lib/anchors.js` — API client + `anchorToDataUrl` helper (fetches saved image, converts to data URL for the API payload).
- `desktop/src/components/media/AnchorCard.jsx` — thumbnail card (image + name).
- `desktop/src/components/media/AnchorEditor.jsx` — create/edit modal: image dropzone, name, description + auto-describe button.
- `desktop/src/components/media/AnchorLibrary.jsx` — library strip + attach/detach state. Max 4 anchors per generation.

### VideoPanel integration

- `attachedAnchors` state owned by VideoPanel.
- AnchorLibrary renders at the top of the controls column.
- Attached anchors shown as chips (name only).
- In `generate()`: attached anchors → `subject_reference[]` as data URLs. Falls back to manual `subjectImage` dropzone when no anchors attached.
- `first_frame_image` / `last_frame_image` from manual dropzones are unaffected.
- `prompt_optimizer` stays under user control (no forced-off — anchors don't inject text into the prompt).

### Image-history promotion

ImagePanel has a "Save as video anchor" button on each generated image. Uses a `sessionStorage` token (`minimax:pendingAnchorPromote`) to survive the Image→Video tab switch (only the active tab is mounted), then opens the AnchorEditor with the image pre-loaded.

## Verification

- **Backend**: `pytest tests/test_anchors_api.py` — 18 tests covering CRUD lifecycle, validation, 404s, VLM describe (mocked). No live API key needed for CRUD.
- **Frontend**: `npm run build` succeeds. Smoke test in browser: AnchorLibrary renders, attach works, anchor images sent as `subject_reference[]`.

## Design History

This feature went through one major pivot:
1. **v1 (wrong)**: Typed anchors (subject/scene). Scene anchors → `first_frame_image`, subject anchors → `subject_reference[]`. Description injected as prompt preamble with `prompt_optimizer` forced off. — User clarified: an anchor is NOT a first frame; it's a character reference for visual consistency. The type system and preamble injection were over-engineered.
2. **v2 (current)**: Simplified to pure character reference images → `subject_reference[]`. No types, no preamble, no optimizer override.
