# Image Style Sheets — Design

**Date:** 2026-07-20
**Status:** Approved
**Scope:** Image generation panel only (T2I + I2I). Other media panels out of scope.

## Problem

Image generation prompts reuse the same style fragments ("수채화, 파스텔톤",
"cinematic, 35mm, moody lighting") across many generations. Currently users
retype or paste these every time. We need reusable, named, editable prompt
fragments — "style sheets" — selectable from the image panel.

## Core Decisions

| Decision | Choice |
|---|---|
| Content scope | Prompt text only (no parameter presets) |
| Storage layer | Separate subsystem mirroring the skills pattern |
| Application mode | Single-select, replace-on-switch |
| UI placement | Hybrid — ImagePanel picks, Settings manages |
| Source scheme | User-only, single directory |
| Prompt combination | `{prompt}` placeholder interpolation |

## Data Model

Mirrors skills layout (`mini_agent/tools/skill_loader.py`) — one directory
per style sheet, one `STYLE.md` inside.

```
~/.local/share/MiniMaxStudio/style-sheets/        # macOS/Linux (XDG_DATA_HOME-respected)
%APPDATA%/MiniMaxStudio/style-sheets/             # Windows
├── watercolor-pastel/
│   └── STYLE.md
└── cinematic-dark/
    └── STYLE.md
```

**`STYLE.md` format** (YAML frontmatter + body):

```markdown
---
name: watercolor-pastel
description: "연한 수채화, 파스텔톤, 부드러운 빛"
created_at: 2026-07-20T05:11:00Z
updated_at: 2026-07-20T05:11:00Z
---

수채화로 그린 {prompt}, 파스텔톤, 부드러운 아침 햇살, 젖은 수채화 종이 질감
```

The body is plain text. The `{prompt}` placeholder:
- **0 occurrences** → default combine: `<user_prompt>, <body>`
- **1 occurrence** → user prompt is substituted at that position
- **≥ 2 occurrences** → validation rejects (prevents ambiguity)

## Validation Rules

New module `mini_agent/tools/style_sheet_loader.py` mirrors
`skill_loader.py`'s validation pattern:

- **name**: `^[a-z0-9][a-z0-9-]{0,63}$` (identical to skills)
- **description**: 1–1024 chars (identical to skills)
- **body**: 1–1000 chars (leaves ≥500 chars for user prompt under `PROMPT_MAX=1500`)
- **`{prompt}` count**: 0 or 1
- Raises `StyleSheetValidationError(ValueError)` on violation

CRUD signatures mirror skills but drop the source concept (user_dir only):

```python
def write_style_sheet(user_dir: Path, name: str, description: str, body: str) -> StyleSheet: ...
def read_style_sheet_raw(user_dir: Path, name: str) -> Optional[Tuple[dict, str, Path]]: ...
def update_style_sheet(user_dir: Path, name: str, *, description=None, body=None) -> StyleSheet: ...
def delete_style_sheet(user_dir: Path, name: str) -> bool: ...
def list_style_sheets(user_dir: Path) -> List[StyleSheet]: ...
def get_default_user_dir() -> Path: ...
```

`StyleSheet` dataclass: `name, description, body, created_at, updated_at, path`.

## Backend API

New routes in `web/backend/main.py`, modeled on the `/api/skills/*` block
(lines 1874–2153):

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/style-sheets` | List all (name, description, body_length, updated_at) |
| GET | `/api/style-sheets/{name}` | Single (body + raw markdown) |
| POST | `/api/style-sheets` | Create |
| PUT | `/api/style-sheets/{name}` | Update |
| DELETE | `/api/style-sheets/{name}` | Delete |

Pydantic models `StyleSheetCreate`, `StyleSheetUpdate`. No
`/sources`, `/discover`, `/import`, `/config` routes — user-only policy.

## Prompt Combination

`/api/image` handler (`main.py:3719`) — applied just before `image_sync(...)`
when the request includes a `style_sheet` name:

```python
def _combine_prompt(user_prompt: str, style_body: str) -> str:
    if "{prompt}" in style_body:
        return style_body.replace("{prompt}", user_prompt, 1)
    if not user_prompt.strip():
        return style_body
    if not style_body.strip():
        return user_prompt
    return f"{user_prompt}, {style_body}"
```

If combined length exceeds 1500 → `HTTP 422` with `combined_length` and
`excess` in the response. Frontend pre-checks, so this is defensive.

`ImageRequest` gains an optional `style_sheet: Optional[str] = None` field.
The handler resolves the sheet by name from the user dir; if missing → 404.

## Frontend — ImagePanel

`desktop/src/components/media/ImagePanel.jsx`:

- Above the prompt textarea, a row with:
  - `<select>` populated from `GET /api/style-sheets`, first option "None"
  - Right-side char budget: `(user_prompt_len + sheet_body_len) / 1500`
    - ≥80% yellow, =100% red, disables Generate
- Selection persisted in `localStorage` under `image-style-sheet` (panel-local, same pattern as `chat-model-override`)
- Request body gains `style_sheet: name | null`

## Frontend — StyleSheetsTab

`desktop/src/components/settings/StyleSheetsTab.jsx` — same shape as
`SkillsTab.jsx`, minus source badges / rescan / addPath / import:

- Left list (name + description), right editor (description input + body textarea)
- Create / Edit / Delete buttons
- Search box
- Live preview under body textarea: shows `{prompt}` position + 1500-char budget bar

Wired into `SettingsPanel.jsx` as a new tab next to Skills.

## i18n

Six languages. New namespaces `styleSheets.*` (settings tab) and
`image.styleSheet*` (panel). English source written first; other languages
fall back to English and can be progressively translated (existing pattern).

## Tests

- `tests/test_style_sheets.py` — validation boundaries, `{prompt}` count
  rejection, CRUD round-trip, `_combine_prompt` 4 cases, char-budget 422,
  API routes via FastAPI TestClient
- `desktop/src/components/settings/StyleSheetsTab.test.jsx` — render, CRUD
  flows (mirror `SkillsTab.test.jsx` if one exists)
- `desktop/src/components/media/ImagePanel.test.jsx` — dropdown render,
  char budget states, request body includes `style_sheet`

## Out of Scope (intentional)

- Extension to Speech / Video / Music panels — data model is simple enough
  to extend later, but for now image-only
- Built-in shipped sheets — users start from empty; ship in a follow-up if wanted
- Sharing/export — SkillsTab's GitHub import analog; excluded under user-only policy
- Multi-select stacking — single-select to start; checkbox extension is non-breaking
