# Generation Metadata Sidecars

**Date:** 2026-07-20
**Scope:** image / video / music / tts generation pipelines
**Status:** Proposed

## Problem

When the user generates an image, video, music track, or TTS clip, the
file lands under `workspace/generations/{images,videos,music,tts}/`
and shows up in the panel's "Recent Generations" list — but **the
prompt and parameters that produced it are not persisted**. The
`GET /api/generations` endpoint returns only filesystem metadata
(`name`, `path`, `size`, `modified_at`, `extension`). Once the user
navigates away or closes the panel, the inputs are gone; reproducing a
result means re-typing the prompt and re-entering every setting.

The user explicitly asked for the prompt to be saved alongside each
generated result. Scope (confirmed): apply to all four media types —
image, video, music, TTS. Save depth (confirmed): the prompt **plus**
the key parameters needed to reproduce the generation (model, seed,
aspect ratio, etc.). Manual upload image bytes (data URLs) are **not**
persisted in v1.

## Goal

- For every file written by an image / video / music / tts generation
  handler, also persist a sidecar JSON describing the prompt and the
  parameters used.
- Surface that metadata in "Recent Generations" via a per-item info
  button that opens a read-only modal.
- Keep file lifecycle and metadata lifecycle 1:1: deleting the media
  file deletes the sidecar, and out-of-band file deletion leaves no
  orphan metadata.

## Non-Goals

- "Load into form" / "Regenerate" buttons in the modal. The modal is
  read-only for v1 (YAGNI — the user can copy the prompt manually).
- DELETE endpoints for music / video / tts. Only the existing image
  DELETE is updated to also clean up its sidecar. New DELETEs are a
  separate task.
- Coding-session outputs surfacing in the gallery. Sidecars are
  written into `<coding-workspace>/outputs/<kind>/` too, but
  `GET /api/generations` continues to scan only the app workspace, so
  those entries remain invisible (no regression vs. today).
- Persisting manual-upload image bytes (data URLs). Anchor references
  are recorded by anchor ID; raw manual uploads are recorded as
  `null` so the user knows to re-upload.
- Prompt search / filtering across the gallery.

## Storage Model — per-file sidecar JSON

Each generated media file gets a sibling `.meta.json` with the same
basename in the same directory:

```
workspace/generations/images/
  image_web_1737283920.png
  image_web_1737283920.meta.json
  image_i2i_1737284001.png
  image_i2i_1737284001.meta.json
workspace/generations/videos/
  video_1737284500.mp4
  video_1737284500.meta.json
workspace/generations/music/
  rock_anthem_01.mp3
  rock_anthem_01.meta.json
workspace/generations/tts/
  tts_web_1737283920.mp3
  tts_web_1737283920.meta.json
```

**Why sidecar, not central manifest:** the existing
`workspace/anchors/anchors.json` is a central manifest because an
anchor is a *record* that owns an image. A generation result is the
opposite — a *file* that owns metadata. Co-locating the metadata with
the file means:

- File lifecycle and metadata lifecycle are 1:1 — no orphan manifest
  entries when a file is deleted out-of-band (Finder / Explorer).
- `DELETE /api/generations/image` extends by one line (also unlink the
  `.meta.json`).
- No single file becomes the bottleneck / corruption point for the
  whole gallery.
- Schema can evolve per-sidecar without rewriting a giant manifest.

The cost (2× file count inside the generation dirs) is acceptable: a
typical user generates tens to low hundreds of items, and the sidecars
are small JSON.

## Schema

A common envelope, with a discriminator (`media_type`) and a
type-specific `params` / `references` block.

```json
{
  "version": 1,
  "media_type": "image" | "video" | "music" | "tts",
  "created_at": "2026-07-20T11:27:00Z",
  "prompt": "<final text sent to model; for image, after style-sheet combine>",
  "user_prompt": "<original user input; equals prompt when no style sheet>",
  "model": "<model id>",
  "params": { },
  "references": { }
}
```

### Per-type fields

| Type | Endpoint(s) | `params` | `references` |
|---|---|---|---|
| `image` · `t2i` | `POST /api/image` (no `subject_reference`) | `aspect_ratio, width, height, n, seed, prompt_optimizer, watermark, style_sheet, mode: "t2i"` | (empty) |
| `image` · `i2i-live` | `POST /api/image` (with `subject_reference`) | same as t2i + `mode: "i2i-live"`, `model: "image-01-live"` | `subject_reference`: list of anchor IDs (frontend-supplied data URLs **not** stored) |
| `image` · `i2i-variation` | `POST /api/image/i2i` (legacy variations) | same as t2i + `mode: "i2i-variation"` | `reference_image`: workspace-relative path (e.g. `uploads/abc.png`) — **the path is what the handler receives; persistable as-is** |
| `video` | `POST /api/video` → `POST /api/video/download` | `duration, resolution, prompt_optimizer, mode` (`text2video`/`image2video`/`sef`/`s2v`) | `first_frame_image, last_frame_image`: anchor ID or workspace path; `subject_reference`: list of anchor IDs. Manual upload data URLs → `null` |
| `music` | `POST /api/music` | `audio_setting{format, bitrate, sample_rate}, mode` (`instrumental` / `lyrics` / `cover`) | `cover_audio`: workspace-relative path when a cover reference was used, else omitted |
| `tts` (single-shot) | `POST /api/minimax/speech/synthesize`, legacy `POST /api/tts` | `voice_id, speed, vol, pitch, audio_setting, format` | (none) |

**Data URL vs workspace path — where the conversion happens.** Two of
the three image modes ultimately send a data URL to the MiniMax API,
but only one of them receives a data URL at the handler level:

- `image · i2i-live`: frontend builds `subject_reference` with
  `image_file: <dataURL>` and sends it in the request body. The
  handler sees the data URL. Sidecar stores anchor IDs only (or `[]`
  if anchor IDs aren't propagated yet).
- `image · i2i-variation`: frontend sends `reference_image:
-  "uploads/abc.png"` (a workspace-relative path). The handler
  resolves `PROJECT_ROOT / image_path` to a file on disk and passes
  the path to `image_variations_sync`. The data URL conversion
  happens **inside `MiniMaxSyncClient.image_variations`**, below the
  handler — invisible to the sidecar. The sidecar therefore records
  the workspace path, which is genuinely persistable (the file lives
  under `workspace/uploads/`).
- `video`: same split — anchor references become anchor IDs, manual
  first/last-frame uploads come in as data URLs and are stored as
  `null`.

### Data URL policy (v1)

Manual-upload images arrive at the backend as base64 data URLs. Storing
the bytes in the sidecar would balloon the JSON and serve little purpose
— the user can re-upload. Instead:

- Anchor references → store anchor ID(s). The anchor library already
  persists the image bytes under `workspace/anchors/<id>.<ext>`, so
  re-attaching is one click.
- Manual first-frame / last-frame / subject uploads → store `null`.
- The modal renders `null` references as "Manual upload — not
  persisted. Re-upload to reproduce."

## Backend Changes

### New helpers (in `web/backend/main.py`, near the existing
`_media_output_dir` block around line 538)

```python
def _media_meta_sidecar_path(media_path: Path) -> Path:
    """image.png -> image.meta.json (same dir, same basename)."""
    return media_path.with_suffix(".meta.json")


def _write_media_meta(media_path: Path, meta: dict) -> None:
    """Atomic write (tmp + rename). Best-effort: failures are logged
    but never mask the successful media write."""
    sc = _media_meta_sidecar_path(media_path)
    sc.parent.mkdir(parents=True, exist_ok=True)
    tmp = sc.with_suffix(".json.tmp")
    try:
        tmp.write_text(json.dumps(meta, ensure_ascii=False, indent=2),
                       encoding="utf-8")
        tmp.replace(sc)
    except Exception:
        try:
            if tmp.exists():
                tmp.unlink()
        except Exception:
            pass
        _logger.warning("sidecar write failed for %s", media_path)


def _read_media_meta(media_path: Path) -> dict | None:
    sc = _media_meta_sidecar_path(media_path)
    if not sc.exists():
        return None
    try:
        return json.loads(sc.read_text(encoding="utf-8"))
    except Exception:
        return None
```

### Per-handler write paths

The four media types fall into three structural cases. **Image and
music and single-shot TTS** all have file-write and prompt in the same
handler. **Video and async-TTS** split the work across two endpoints.

#### Case 1 — same-handler write (image, music, single-shot TTS)

| Endpoint | Location | Sidecar written right after |
|---|---|---|
| `POST /api/image` | `main.py:3858` | `output_path` is written by `image_sync(...)` |
| `POST /api/image/i2i` | `main.py:3966` | `output_path` is written by `image_variations_sync(...)` |
| `POST /api/music` | `main.py:4880` | `output_path` is written inside the handler |
| `POST /api/minimax/speech/synthesize` | `main.py:4669` | audio saved to `out_path` |
| `POST /api/tts` (legacy) | `main.py:3781` | `output_path` is written by T2A call |

In each handler, after the success branch writes the media file:

```python
# Pseudocode for POST /api/image (covers both t2i and i2i-live modes;
# /api/image/i2i variation is a separate handler with a similar block
# but mode="i2i-variation" and references.reference_image set).
if success:
    _write_media_meta(output_path, {
        "version": 1,
        "media_type": "image",
        "created_at": datetime.utcnow().isoformat() + "Z",
        "prompt": final_prompt,
        "user_prompt": req.prompt,
        "model": model,
        "params": {
            "aspect_ratio": req.aspect_ratio,
            "width": req.width,
            "height": req.height,
            "n": n,
            "seed": req.seed,
            "prompt_optimizer": req.prompt_optimizer,
            "watermark": req.watermark,
            "style_sheet": style_sheet_used,
            "mode": "i2i-live" if subject_reference else "t2i",
        },
        # subject_reference_anchors is a parallel array of anchor IDs
        # the frontend sends alongside subject_reference (see "Anchor-ID
        # propagation" below). Same length, same order.
        "references": {
            "subject_reference": list(req.subject_reference_anchors or []),
        },
    })
    # ... existing return ...
```

The existing handlers don't currently propagate anchor IDs alongside
the `subject_reference` data URLs; the frontend must include anchor
IDs when it builds the request body (see Frontend section below) so
the sidecar can record them. Until that wiring lands, the
`subject_reference` entry will be an empty list — acceptable.

#### Case 2 — decoupled write (video)

`POST /api/video` (`main.py:5083`) returns `{task_id, ...}` and writes
no file. `POST /api/video/download` (`main.py:5166`) is called by the
frontend poll loop and currently receives only `{file_id}` — **the
backend has no prompt or params at download time.**

Resolution: **frontend includes the params in the download payload.**
The VideoPanel already holds `prompt`, `videoModel`, `resolution`,
`duration`, `promptOptimizer`, `firstFrame`, `lastFrame`,
`attachedAnchors` in component state during the poll, so no new state
is needed.

```js
// desktop/src/components/media/VideoPanel.jsx:620-624 — current
body: JSON.stringify({ file_id: fileId })

// changed
body: JSON.stringify({
  file_id: fileId,
  meta: {
    media_type: 'video',
    prompt,
    user_prompt: prompt,
    model: videoModel,
    params: {
      duration,
      resolution,
      prompt_optimizer: promptOptimizer,
      mode: deriveVideoMode({ firstFrame, lastFrame, subjectData }),
    },
    references: {
      first_frame_image: firstFrameAnchorId ?? null,
      last_frame_image: lastFrameAnchorId ?? null,
      subject_reference: attachedAnchors.map(a => a.id),
    },
  },
})
```

`/api/video/download` reads `req.get("meta")` and, after writing
`target`, calls `_write_media_meta(target, meta_with_created_at)`. If
`meta` is absent (older client), no sidecar is written — graceful.

This avoids the alternative of a backend `task_id -> prompt` pending
stash, which would add a stateful index file, a cleanup story
(expired tasks), and a new failure mode (pending missing at download).

#### Case 3 — decoupled write (async TTS)

`POST /api/minimax/speech/synthesize-async` (`main.py:4764`) returns a
`task_id`; the client polls `GET /api/minimax/speech/synthesize-async/{task_id}`
(`main.py:4829`). The current async path does **not** download the
resulting audio into the workspace automatically (it returns a
`file_id` / audio URL the frontend can fetch). Two options:

- **A (recommended):** when the frontend fetches the final audio, it
  re-POSTs the bytes to a small new endpoint
  `POST /api/minimax/speech/save` that writes the audio file under
  `generations/tts/` **plus** the sidecar in one call. The POST body
  carries `{ audio: <bytes or url>, meta: {...} }`.
- **B (deferred):** if async-TTS autosave into the gallery isn't wired
  yet, ship Case 3 in a follow-up. Only the **single-shot synthesize**
  (Case 1) gets a sidecar in v1; async-TTS results that aren't already
  in the gallery get nothing (no regression — they aren't listed
  today either).

Decision for v1: go with **B**. Single-shot synthesize is the dominant
TTS path; async is a long-text corner case. Adding a new save endpoint
just to wrap a sidecar around it is scope creep. Revisit when async-TTS
autosave is itself added. **The spec therefore covers single-shot
synthesize only; async-TTS is documented as deferred.**

### `GET /api/generations` merge (`main.py:5633`)

Inside the existing per-file loop, look up the sibling `.meta.json`
and attach it as `meta` on the returned item:

```python
for f in folder.iterdir():
    if not f.is_file():
        continue
    # Skip sidecars themselves — they aren't media.
    if f.suffix.lower() == ".json":
        continue
    stat = f.stat()
    result[subdir].append({
        "name": f.name,
        "path": str(f.relative_to(get_app_workspace_dir())).replace("\\", "/"),
        "type": subdir,
        "size": stat.st_size,
        "modified_at": datetime.fromtimestamp(stat.st_mtime).isoformat(),
        "extension": f.suffix.lower(),
        "meta": _read_media_meta(f),  # dict or None
    })
```

The `.json` skip prevents sidecars from appearing in the gallery as
their own items.

### `DELETE /api/generations/image` (`main.py:5661`) — sidecar cleanup

After the existing `target.unlink()`, also remove the sidecar:

```python
if target.exists() and target.is_file():
    target.unlink()
sc = _media_meta_sidecar_path(target)
if sc.exists():
    try:
        sc.unlink()
    except Exception:
        pass
```

Future DELETE endpoints (music / video / tts) repeat the same pattern.

## Frontend Changes

### New component: `desktop/src/components/media/GenerationMetaModal.jsx`

Props: `{ item, onClose }` where `item = { name, path, type, meta }`.

Layout:

```
┌─ Generation details ──────────────────────────── ✕ ┐
│                                                    │
│  [media preview — image thumbnail / audio / video] │
│                                                    │
│  Prompt                                            │
│  ┌──────────────────────────────────┐  [Copy]      │
│  │ <prompt text, scrollable>        │              │
│  └──────────────────────────────────┘              │
│                                                    │
│  User prompt (only if differs from prompt)         │
│  <user_prompt>                                     │
│                                                    │
│  Model        image-01                             │
│  Created at   2026-07-20 11:27                     │
│                                                    │
│  Parameters                                        │
│  ┌────────────────┬──────────────────┐             │
│  │ aspect_ratio   │ 16:9             │             │
│  │ seed           │ 12345            │             │
│  │ …              │ …                │             │
│  └────────────────┴──────────────────┘             │
│                                                    │
│  References                                        │
│  Subject: anchor "Hero — red cloak" (id abc…123)   │
│  First frame: (manual upload — not persisted)      │
│                                                    │
└────────────────────────────────────────────────────┘
```

- Read-only for v1.
- `meta === null` → empty state: "This generation has no saved
  metadata" (i18n key `metaModal.empty`). Hide all sections.
- Reference rendering: anchor IDs link to nothing for now (just show
  the ID + name lookup if available, else the ID); `null` shows the
  "manual upload" note; workspace paths are shown as monospace text.
- Copy button copies the prompt (primary), with a secondary menu for
  "copy full JSON".

Reuses the modal shell pattern from `AnchorEditor.jsx` /
`ArtifactViewerModal.jsx`.

### `RecentGenerations.jsx` — info button on every type

Add `onShowMeta?: (item) => void` prop. Render an info icon button:

- **Image grid cards** (lines 74–125): inside the existing hover
  overlay, alongside Download / Anchor / Delete, add a fourth icon
  (`Info` from `lucide-react`). Same size / styling.
- **music / tts list items** (127–155): next to the Download button
  in the footer row, add a small `Info` icon button.
- **video list items** (157–185): same pattern as music / tts.

When `item.meta === null` the button is rendered grayed out with
`title="No saved metadata"` (i18n `recentGenerations.noMeta`) and is
non-interactive — gives the user a visual signal that this is expected
for older files, not a bug.

The parent panel (ImagePanel / MusicPanel / SpeechPanel / VideoPanel)
owns the modal state:

```js
const [metaItem, setMetaItem] = useState(null)
// ...
<RecentGenerations onShowMeta={setMetaItem} ... />
{metaItem && (
  <GenerationMetaModal item={metaItem} onClose={() => setMetaItem(null)} />
)}
```

### `VideoPanel.jsx` — pass meta in download payload (Case 2)

Update the `fetch('/api/video/download', ...)` call (line 620) to
include the `meta` block described in the Backend Case 2 section. Also
forward anchor IDs alongside the existing data-URL `subject_reference`
array, so the sidecar can record them by ID instead of as opaque data
URLs.

### Anchor-ID propagation (image + video)

Today the frontend builds `subject_reference: [{type, image_file:
<dataURL>}]` and never tells the backend which anchor each entry came
from. To record anchor IDs in the sidecar, add a parallel
`subject_reference_anchors: [<id>, ...]` field to the `/api/image` and
`/api/video` request bodies. The backend ignores it for the actual API
call (MiniMax doesn't want it) but uses it when building the sidecar.
Cleanest: the frontend always sends both arrays in matched order.

### i18n

New keys (added to `en.json`, defaulted in the other five locales per
existing policy — empty string fallback is allowed):

- `recentGenerations.showMeta` — button title: "View prompt & settings"
- `recentGenerations.noMeta` — grayed-out title: "No saved metadata"
- `metaModal.title` — "Generation details"
- `metaModal.promptSection` — "Prompt"
- `metaModal.userPromptSection` — "User prompt"
- `metaModal.paramsSection` — "Parameters"
- `metaModal.referencesSection` — "References"
- `metaModal.modelLabel` — "Model"
- `metaModal.createdAtLabel` — "Created"
- `metaModal.copyPrompt` — "Copy prompt"
- `metaModal.copyJson` — "Copy full JSON"
- `metaModal.empty` — "This generation has no saved metadata."
- `metaModal.manualUpload` — "Manual upload — not persisted. Re-upload to reproduce."

## Files Touched

- `web/backend/main.py` — `_write_media_meta` / `_read_media_meta` /
  `_media_meta_sidecar_path` helpers; sidecar writes in
  `/api/image`, `/api/image/i2i`, `/api/music`,
  `/api/minimax/speech/synthesize`, legacy `/api/tts`,
  `/api/video/download`; `meta` field on `GET /api/generations` items;
  sidecar cleanup in `DELETE /api/generations/image`
- `desktop/src/components/media/GenerationMetaModal.jsx` — new
- `desktop/src/components/media/RecentGenerations.jsx` —
  `onShowMeta` prop + info button on all three type branches
- `desktop/src/components/media/{ImagePanel,MusicPanel,SpeechPanel,VideoPanel}.jsx`
  — modal state + `onShowMeta`; VideoPanel additionally sends `meta`
  in the download payload and forwards anchor IDs
- `desktop/src/i18n/{en,ko,es,ja,zh-CN,pt-BR}.json` — new keys
- `tests/test_generation_meta.py` — new test module

## Testing

### Backend (`tests/test_generation_meta.py`, pytest, no live API key)

Monkeypatch the MiniMax client calls so handlers return a canned
success payload that writes a real file under a tmp workspace.

- `test_image_write_creates_sidecar_with_full_params` — POST `/api/image`
  with prompt + aspect_ratio + seed; assert media file + sidecar both
  exist; sidecar JSON has `media_type: "image"`, `prompt`, `model`,
  the requested params, and `created_at`.
- `test_image_style_sheet_records_user_prompt_separately` — when a
  style sheet is attached, sidecar `prompt` is the combined text and
  `user_prompt` is the raw input.
- `test_video_download_writes_sidecar_from_meta_payload` — POST
  `/api/video/download` with `{ file_id, meta }`; assert sidecar
  written with provided meta (plus server-injected `created_at`).
- `test_video_download_without_meta_does_not_write_sidecar` — old
  client behavior, no regression.
- `test_generations_list_includes_meta_and_skips_sidecars` — seed a
  media file + sidecar + an orphan sidecar (no media); GET
  `/api/generations` returns the media item with `meta` populated,
  does NOT return the sidecar file as its own item.
- `test_delete_image_also_removes_sidecar` — POST seed, DELETE,
  assert both media and sidecar gone.
- `test_corrupt_sidecar_is_tolerated` — sidecar contains invalid
  JSON; GET `/api/generations` returns `meta: null` instead of 500.
- `test_sidecar_write_failure_does_not_break_media_save` — patch
  `_write_media_meta` to raise; assert the media file is still on
  disk and the response is still `success: true`.

### Frontend (Vitest, optional but cheap)

- `GenerationMetaModal.test.jsx` — renders with a populated `meta`
  and shows prompt / params / model; renders the empty state when
  `meta === null`.
- `RecentGenerations.test.jsx` — info button appears on each type
  branch, fires `onShowMeta(item)` on click, and renders grayed-out
  when `meta === null`.

## Risks

- **Sidecar write fails after media write succeeds.** Mitigated by
  the best-effort wrapper that logs and moves on. The gallery still
  shows the file; `meta` is `null`. The user is not blocked.
- **Old client + new backend (video).** Frontend predating this
  change sends `{file_id}` only. Backend gracefully writes no sidecar.
  No regression.
- **New client + old backend (video).** Frontend sends `{file_id,
  meta}`. Old backend ignores the extra field. No regression.
- **Orphan sidecars** (media file deleted out-of-band). Acceptable:
  GET skips entries whose media file is missing (the loop iterates
  media files and looks up sidecars, not the reverse, so orphans are
  invisible).
- **Data URLs for manual uploads.** Stored as `null` in v1; user
  must re-upload to reproduce. Documented in the modal.
- **Schema evolution.** `version: 1` is the discriminator; future
  versions add a migration read path. Don't need it now.
- **Coding-session outputs.** Sidecars land in
  `<coding-workspace>/outputs/<kind>/` alongside the media, but the
  gallery endpoint scans only the app workspace — so these stay
  invisible, identical to today's behavior. No regression, but worth
  flagging for a future "unified gallery" task.
