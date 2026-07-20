# Inline Style Sheet Creation — Design Spec

**Date:** 2026-07-20
**Status:** Approved
**Scope:** Let users create, AI-draft, and image-extract image style sheets without leaving the Image panel. Existing style sheet storage, CRUD semantics, and image prompt application remain unchanged.

## Problem

The Image panel can select and apply a style sheet, but creating one requires leaving the generation workflow and opening Settings → Style Sheets. Users must also manually translate a natural-language style idea or a generated image's visual treatment into a reusable style fragment.

The Image panel needs an inline creation flow that supports:

1. direct authoring;
2. an AI-generated draft from a natural-language brief; and
3. a draft extracted from either a generated image or an image uploaded inside the editor.

AI and image-analysis results must remain editable drafts. Nothing is persisted until the user explicitly saves it.

## Goals

- Create a style sheet beside the Image panel's existing selector.
- Reuse one editor and one validation path for direct, AI, and image-based creation.
- Allow generated image cards to start an image-extraction flow.
- Extract only transferable visual style: medium, art direction, palette, lighting, texture, line work, and rendering treatment.
- Exclude subject identity, objects, scene content, logos, and visible text from extracted style sheets.
- Select and apply a newly saved style sheet immediately.
- Preserve the existing `STYLE.md` data model and `/api/image` prompt-combination behavior.

## Non-goals

- Persisting source images with style sheets.
- Automatically saving any AI-produced draft.
- Conversational, multi-turn style refinement.
- Multiple style sheets applied to one generation.
- Style sheets for video, music, or speech.
- Parameter presets such as aspect ratio, seed, batch count, or prompt optimizer.
- Changes to MiniMax's `/v1/image_generation` request shape.

## Existing System

Style sheets are user-only prompt fragments stored under the platform user-data directory as `<name>/STYLE.md`. Each file contains YAML frontmatter and a body. The existing loader validates:

- name: `^[a-z0-9][a-z0-9-]{0,63}$`;
- description: 1–1024 characters;
- body: 1–1000 characters; and
- `{prompt}`: zero or one occurrence.

The Image panel loads `GET /api/style-sheets`, persists the selected name under `localStorage['image-style-sheet']`, and sends that name as `style_sheet` to `POST /api/image`. The backend resolves the sheet and combines its body with the user prompt immediately before image generation.

This design adds an authoring surface and a draft-generation endpoint. It does not replace the current loader, CRUD routes, storage location, or prompt-combination code.

## User Experience

### Style sheet selector row

Replace the current full-width selector with one row:

- the existing single-select control fills the available width;
- a `+` button is always available and opens the shared editor in create mode;
- when a style sheet is selected, an edit button opens that sheet in edit mode; and
- the existing combined-prompt character budget remains visible.

A style-sheet list failure must not block image generation. The selector shows a compact retryable warning instead of silently hiding the failure.

### Shared editor

The editor has three start modes at the top and one shared form below them.

#### Direct

The user directly enters name, description, and body.

#### AI draft

The user enters a natural-language style brief, for example:

> 1990s Japanese animation, cel shading, warm sunset light

`Create draft` calls the draft endpoint. A successful response fills the shared name, description, and body fields. It does not save the style sheet.

#### Extract from image

The user supplies an image in either of two ways:

- drops or selects an image inside the editor; or
- clicks **Save as style** on a generated-image card, which opens the editor on this mode with that image preselected.

`Extract style` calls the draft endpoint. Analysis starts only after this explicit action. The response fills the shared fields but does not persist the source image or the style sheet.

### Shared form

All three start modes feed the same editable fields:

- name;
- description;
- body;
- live name/body/placeholder validation;
- `{prompt}` occurrence count;
- 1,000-character body budget;
- a preview combined with the Image panel's current prompt; and
- the resulting 1,500-character image-prompt budget.

The primary action is **Save and apply** when opened from the Image panel. On success, the modal closes, the returned sheet is merged into the local list, selected immediately, and persisted to `localStorage['image-style-sheet']`.

The Settings surface uses the same editor but retains its existing **Create style sheet** and **Save changes** wording.

### Destructive transitions

- Closing a dirty editor asks before discarding changes.
- Running AI draft or image extraction over non-empty edited fields asks before replacing them.
- A failed draft or save preserves the brief, selected image, and all form fields.

## Frontend Architecture

### Shared modules

Extract the editor currently nested in `StyleSheetsTab.jsx` into shared style-sheet modules.

#### `StyleSheetEditor`

Owns:

- direct/AI/image start mode;
- brief and image-source state;
- name, description, and body state;
- live validation and prompt preview;
- draft request lifecycle; and
- save request lifecycle.

It accepts the current Image prompt as an optional preview input. It reports the saved `style_sheet` object to its parent.

#### `StyleSheetModal`

Owns only modal mechanics:

- overlay and focus boundary;
- title and close action;
- scroll containment; and
- responsive size.

It wraps `StyleSheetEditor` in both Image and Settings surfaces.

#### `desktop/src/lib/styleSheets.js`

Provides typed-by-convention API helpers for:

- list;
- get;
- create;
- update;
- delete;
- create draft from a brief; and
- create draft from an image.

Every helper normalizes FastAPI `detail`, application `error`, non-JSON responses, and non-2xx status codes into an `Error` with a user-displayable message.

### Parent responsibilities

#### `ImagePanel`

Owns:

- style-sheet list;
- selected style-sheet name;
- selector/list warning state;
- create/edit modal state;
- current prompt passed into the editor preview; and
- merging and selecting the saved result.

Draft requests do not share the Image panel's image-generation `loading` state. Users can distinguish “creating a style draft” from “generating an image.”

#### `StyleSheetsTab`

Continues to own:

- the management list;
- search;
- view;
- create/edit modal selection; and
- delete.

It delegates form, validation, and save behavior to the shared editor.

#### `RecentGenerations`

Gains an optional `onSaveAsStyle(item)` callback. The component only renders the action and returns the selected item. It has no style-sheet API or editor knowledge.

Unlike the existing Image-to-Video anchor promotion, this interaction stays within the mounted Image panel, so it needs no `sessionStorage` handoff.

## Draft API

### Endpoint

`POST /api/style-sheets/draft`

The endpoint creates a draft only. It must not call `write_style_sheet`, create a directory, or modify any existing sheet.

### Natural-language request

```json
{
  "mode": "description",
  "brief": "1990s Japanese animation, cel shading, warm sunset light"
}
```

Rules:

- `brief` is required and trimmed;
- blank or oversized briefs are rejected with HTTP 400; and
- model-generated descriptions and style fragments are concise, reusable image-generation text. Validation is language-agnostic.

### Image requests

Existing generated image:

```json
{
  "mode": "image",
  "image_path": "generations/images/image_web_123.png"
}
```

Uploaded in the modal:

```json
{
  "mode": "image",
  "image_data_url": "data:image/png;base64,..."
}
```

Rules:

- image mode requires exactly one of `image_path` or `image_data_url`;
- `image_path` is relative to the app workspace and is resolved through `_safe_join`;
- a path must resolve to a regular image file inside the app workspace;
- inline data accepts only supported raster-image MIME types;
- decoded inline image size is capped at 10 MiB; and
- inline data is written to a temporary file only for VLM analysis and removed in `finally` on success or failure.

### Response

```json
{
  "success": true,
  "draft": {
    "name": "warm-cel-anime",
    "description": "Warm 1990s cel-animation treatment",
    "body": "{prompt}, 1990s Japanese cel animation, hand-painted cels, warm sunset palette, clean ink outlines"
  }
}
```

### Draft invariants

Before returning a draft, the server guarantees:

- `name` satisfies the existing name schema;
- `name` does not currently collide with a stored sheet;
- collisions are resolved predictably with `-2`, `-3`, and so on while staying within 64 characters;
- `description` satisfies the existing description limit;
- `body` contains `{prompt}` exactly once;
- `body` is at most 1,000 characters; and
- image-derived content contains transferable style only.

The server asks the model for structured `name`, `description`, and `style_fragment` fields. The model does not author YAML or the final body. After parsing and validating the structured response, the server constructs:

```text
{prompt}, <validated style_fragment>
```

This prevents model output from omitting, duplicating, or corrupting the `{prompt}` placeholder.

## Model Flow

### Natural-language draft

Use the configured agent model through the existing `LLMClient` abstraction. The call has no tools and no conversation history. Its system instruction requires one strict JSON object with:

- a lowercase kebab-case name proposal;
- a concise description; and
- a concise reusable visual-style fragment.

The fragment must not repeat the user's scene or subject content as style. The backend parses the JSON, rejects malformed or incomplete output, normalizes the name, applies collision handling, and validates the final fields.

### Image extraction

Reuse the existing `MiniMaxMCPClient.understand_image` path. The analysis prompt explicitly requests only:

- medium and art direction;
- palette and color treatment;
- lighting treatment;
- surface texture and material rendering;
- line work, brushwork, or edge treatment; and
- rendering/photographic characteristics.

It explicitly forbids:

- identifying or describing people;
- clothing or identity details;
- enumerating objects;
- describing the depicted scene or action;
- copying logos, captions, or visible text; and
- inferring sensitive attributes.

The VLM returns the same structured fields as the natural-language path. The backend applies the same normalization and validation before constructing the final body.

## Error Semantics

| Condition | Status | Behavior |
|---|---:|---|
| API key missing | 400 | Show configuration-required error; preserve editor state |
| Invalid mode or request combination | 400 | Show request validation error |
| Blank/oversized brief | 400 | Keep brief focused for correction |
| Unsupported MIME, invalid base64, or oversized image | 400 | Keep editor open; allow replacing image |
| Workspace path escape | 403 | Reject without reading the target |
| Generated image missing | 404 | Keep editor open; allow upload fallback |
| Model/VLM upstream failure | 502 | Show retryable analysis error |
| Malformed or invalid model output | 502 | Do not return a partial draft |
| Duplicate name at final save | 400 | Keep modal open and let the user rename |
| Existing CRUD validation failure | 400 | Map message to the relevant form field when possible |

Draft failures never clear the current fields. Save failures never close the modal.

## Security and Resource Controls

- Generated-image paths are resolved only under `get_app_workspace_dir()` via `_safe_join`.
- The server checks file existence, regular-file status, and supported image type before VLM access.
- Base64 data is size-checked before and after decoding.
- Temporary files are unlinked in `finally`.
- Model output is treated as untrusted data, parsed as JSON, length-limited, normalized, and passed through existing style-sheet validators.
- The draft endpoint is read-only with respect to style-sheet storage.
- No source image bytes or path are written into `STYLE.md`.

## Validation and Verification

### Backend tests

Cover:

- natural-language brief produces a valid draft;
- image path and image data URL both reach the VLM path;
- image mode rejects missing or simultaneous sources;
- path traversal and files outside the app workspace are rejected;
- missing files, unsupported MIME, malformed base64, and oversized data are rejected;
- temporary files are removed after successful and failed analysis;
- malformed JSON, incomplete fields, and oversized model output return 502;
- generated bodies contain exactly one `{prompt}` and satisfy the 1,000-character limit;
- name normalization and collision suffixing;
- non-English briefs still produce schema-valid descriptions and style fragments; and
- calling the draft endpoint creates no `STYLE.md` or style-sheet directory.

Existing style-sheet loader, CRUD, and `/api/image` combination tests remain unchanged and must still pass.

### Frontend tests

Cover:

- the `+` button opens the shared editor in direct mode;
- AI brief and image extraction fill but do not save shared fields;
- a separate upload and a generated-image card both start image mode;
- saving merges and selects the returned style sheet;
- the selected name is persisted in `localStorage`;
- list, draft, and save failures preserve editor state;
- dirty close and draft-overwrite confirmation behavior;
- combined prompt budget uses the current Image prompt; and
- Settings create/edit behavior remains intact after extraction of the shared editor.

### End-to-end smoke check

In the running desktop UI:

1. create and apply one style sheet by direct authoring;
2. create a natural-language draft, edit it, save it, and verify immediate selection;
3. upload an image, extract visual style, edit, save, and apply it;
4. use **Save as style** on a generated image and repeat extraction/save;
5. generate an image and confirm the request contains the selected `style_sheet`; and
6. confirm generated output uses the existing combined prompt path without changes to image-generation parameters.

## Compatibility and Migration

No migration is required. Existing `STYLE.md` files, CRUD endpoints, localStorage selection, and image requests continue to work. The Settings management UI changes implementation ownership but not observable behavior.
