# Changelog

All notable changes to **MiniMax Agent GUI** are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Note:** Pre-0.3.0 history lives in [docs/PROJECT_LOG.md](docs/PROJECT_LOG.md)
> and [git history](https://github.com/eduardoabreu81/minimax-agent-gui/commits/main).

## [0.4.0] — 2026-06-21 — Desktop-first migration (Tauri)

**Major milestone.** The desktop app (`desktop/`, Tauri 2 + Vite + React 18) is now the **primary interface**. The legacy web app (`web/`) is preserved but slated for a separate fork. Three major feature sprints landed on the backend that power the new desktop panels.

### Added — Backend

- **Speech (T2A) full stack** — `mini_max_mcp/client.py` gets 8 new methods (`speech_synthesize_v2`, `speech_synthesize_async_create`, `speech_synthesize_async_query`, `voices_list`, `voice_clone`, `voice_design`, `voice_delete`, `file_upload`). `web/backend/main.py` exposes them via 8 FastAPI endpoints: `POST /api/minimax/speech/{synthesize, synthesize-async, clone/upload, clone, design}`, `GET /api/minimax/speech/{voices, synthesize-async/{id}}`, `DELETE /api/minimax/speech/voices/{type}/{id}`. Error mapping: 2038→403 (no clone permission), 2013→400, 1008→402, 1002→429, 1042→422 (invalid chars), 1026→422.
- **Music Phase 2 (cover)** — `music_cover` + `music_cover_free` endpoints with quick/custom modes; `preprocess` endpoint validates uploaded reference audio (size + format) before the API round-trip. Cleared cached feature IDs when a new audio is uploaded.
- **Music Phase 3 (lyrics generation)** — `POST /api/minimax/music/lyrics` with `lyrics_generation` API; supports `write_full_song` and `edit` modes; returns `{song_title, style_tags, lyrics, trace_id}`.
- **Generation defaults** — `GET/PUT /api/config/defaults/audio` with full validation: `format ∈ {mp3, pcm, flac, wav}`, `sample_rate ∈ {8000, 16000, 22050, 24000, 32000, 44100}`, `bitrate ∈ {32000, 64000, 128000, 256000}`, `channel ∈ {1, 2}`.

### Added — Desktop (Tauri)

- **`desktop/`** — Tauri 2.x desktop scaffold. Vite + React 18 + Tailwind + shadcn-style components (`lucide-react`, `radix-ui`, `class-variance-authority`). Tauri Rust backend (`src-tauri/`) auto-spawns the PyInstaller FastAPI bundle on `:8765`. Same 7 panels as the web app, plus a Command Palette (Ctrl+K).
- **`SpeechPanel.jsx`** — 4 sub-modes per TAURI_SPEC §6b: **Synthesize** (standard + async, 8 models, voice_modify pitch/intensity/timbre/sound_effects, 41 language boosts, pause hint `<#0.5#>`), **Clone** (drag/drop, voice_id validator 8-256 chars + must start with letter, NR/VN toggles, "auto-deleted if unused 7 days" warning), **Design** (prompt + preview_text ≤500 + optional voice_id), **Voices** (3 buckets: system/cloning/generation with delete for non-system).
- **`SettingsPanel.jsx`** — Index rail (TAURI_SPEC §3 row Settings): 224px left rail with 11 entries, scroll-spy via IntersectionObserver, click-to-scroll. New **Generation defaults** section wired to `GET/PUT /api/config/defaults/audio` (format / sample_rate / bitrate / channel + Save).
- **`MusicPanel.jsx`** — Switched from `/api/config` (`.music.audio_setting`) to the dedicated `/api/config/defaults/audio` endpoint.
- **i18n** — 10 new keys (`generationDefaults`, `audioFormatDesc`, `audioSampleRateDesc`, `audioBitrateDesc`, `audioChannel`, `audioChannelDesc`, `audioChannelMono`, `audioChannelStereo`, `generationDefaultsSaved`, `generationDefaultsHint`) added across all 6 locales (en, pt-BR, es, ja, zh-CN, ko).

### Added — Tests

- **`tests/test_speech.py`** (NEW) — 32 tests covering all 8 Speech endpoints + error mapping.
- **`tests/test_generation_defaults.py`** (NEW) — 17 tests covering validation enums + persistence.
- **`tests/_run_all.py`, `tests/_run_speech.py`, `tests/_summarize.py`** (NEW) — Test runner helpers.
- Total: **104/104 tests passing** across 5 suites (speech 32, music_phase1 19, music_cover 20, music_lyrics 16, generation_defaults 17).

### Changed

- **AGENTS.md** — Project Overview updated for desktop-first; added **Token Plan video limits** (canonical per-tier caps) and **No CLI dependency for Token Plan operations** sections.
- **pyproject.toml** — Bumped to `0.4.0`.

### Removed

- **`/api/minimax/cli`** — `speech` removed from allowlist (no longer routes through mmx CLI).
- **`/api/minimax/voices`** — Deleted; replaced by `/api/minimax/speech/voices`.

### Deprecated

- **`web/`** — Legacy web app preserved but slated for a separate fork. The desktop app (`desktop/`) is now the primary interface. The web frontend will keep working but is no longer the focus of new development.

### Known follow-ups

- Audio output formats pcm and flac are wired through the backend but not all desktop panels surface them yet.
- MusicPanel lyrics tab ships in Phase 3 but the editor mode (`edit`) UI is minimal; polish pending.
- SpeechPanel "Voices" sub-mode lists all 3 buckets but lacks pagination (works fine for typical 30+30 voices).
- Tauri dev mode requires the PyInstaller backend bundle to be built; first `npm run tauri:dev` will rebuild it.

## [0.3.0] — 2026-06-02 — Token Plan migration (M2.7 → M3)

The biggest release since the project started: migrated from the legacy
M2.7 single-model deployment to the new **MiniMax Token Plan** (credit-based,
in USD) with **M3** as the default model and **M2.7 / M2.7-highspeed**
available as fallbacks. Tightened the UI for the model + thinking
controls and fixed a number of Token Plan API quirks.

### Added

- **MiniMax-M3 as default chat model** (1M context, agentic tool use,
  native image/video input, M3-only `thinking` block).
- **Per-turn model selector** below the chat/code composer (M3, M2.7,
  M2.7-highspeed). Persisted per panel via `localStorage`.
- **Per-toggle "Thinking" button** next to the model selector. M3
  supports Anthropic-style extended thinking; the button is hidden
  for non-M3 models and only sends the `thinking` param when ON.
  Persisted via `localStorage`.
- **Real-time token-by-token thinking + text streaming** via the
  Anthropic SDK's `messages.stream()`. The user sees the reasoning
  and response stream word-by-word instead of arriving as one
  payload.
- **Thinking block** rendered as its own message in the chat timeline
  (above the assistant's response), always-visible per user preference.
  The block shows a streaming spinner while chunks are still arriving.
- **Model tag** (`MiniMax-M3`, `MiniMax-M2.7`, etc.) on every assistant
  message so the user always knows which model produced the turn.
- **Copy button** on every assistant message (next to the model tag)
  with a "Copied" confirmation.
- **Session persistence via `localStorage`** — switching tabs or
  refreshing now keeps the same conversation. Only the explicit
  "New Chat" action creates a new session.
- **Token Plan auto-detection** — plan is inferred from the active MCP
  `model_remains[]` access flags (Plus / Max / Ultra). Falls back to
  the user-declared `minimax.plan` in `config/config.yaml` if mmx
  output is ambiguous.
- **Pricing/Plans UI in the Quota Dashboard** — Plus / Max / Ultra
  each render only the rows the user has access to. Video gen row
  is hidden on Plus (not included in the tier).
- **Plan badge in the sidebar** — auto-detected from the Token Plan
  status, no more "Starter" hardcoded fallback.

### Changed

- **Migrated LLM protocol** to MiniMax's Anthropic-compatible endpoint
  (`https://api.minimax.io/anthropic`). The backend automatically
  appends `/anthropic` to the configured `api_base`.
- **`config-example.yaml` default model** is now `MiniMax-M3` (was
  `MiniMax-M2.5`).
- **MCP server config moved to `config/config.yaml` top-level
  `mcp_servers` map** — the legacy `mcp.json` file is no longer the
  source of truth; the web backend reads `mcp_servers` directly and
  exposes CRUD via `/api/mcp/servers`.
- **Hardcoded Python path removed from `web/package.json`** — scripts
  now use `py -3.10` (the Windows Python launcher) so the project
  runs on any machine with Python 3.10+ registered, not just the
  original dev's local install.
- **Sidebar collapsed-state** persists in `localStorage` (`sidebar-collapsed`).
- **Chat/Code session IDs** are now persisted per panel
  (`chat-session-id` / `code-session-id`); "New Chat" wipes the key
  and generates a fresh UUID.

### Fixed

- **`web_search` 400 invalid params** — the built-in Token Plan
  search endpoint expects the query under the short key `q`, not
  `query`. The legacy code sent `query` + `recency_days` + `max_results`,
  which the new API rejects as unknown fields.
- **Plan auto-detection requires `mmx` CLI** — `/api/minimax/quota`
  used to shell out to `mmx quota` via subprocess. If the user
  didn't have `mmx` installed, the call silently failed and the
  GUI fell back to the `minimax.plan` value in `config.yaml`. The
  feature now calls the Token Plan `remains` endpoint directly
  (`GET /v1/api/openplatform/coding_plan/remains`) using `httpx`,
  with `mmx` as a fallback for users who happen to have it.
  Auto-detection now works out of the box.
- **`understand_image` attachment context** — the upload flow
  prepended a bare `[Attached image analysis: ...]` block that the
  agent treated as a stray note. Re-framed as
  `[User uploaded an image to the chat. Use the description below
  AS your view of the image when answering.]` so the agent actually
  answers about the image.
- **Anthropic SDK 10-minute timeout** — non-streaming calls were
  hard-blocked for any operation that might take >10 min. Switched to
  `messages.stream()` everywhere; long M3-with-thinking responses
  now complete reliably.
- **`get_minimax_config()` plan field** — mmx 1.0.16+ dropped the
  `plan` field from quota output. Added `_detect_plan_from_mmx()`
  that infers the tier from the `model_remains[].current_interval_status`
  access flags.
- **Stale "Starter" plan badge** in the sidebar — was defaulting to
  `starter` when the heuristic in `Sidebar.jsx` couldn't find
  `model_name` containing `minimax-m` (mmx 1.0.16+ renamed the
  buckets to `general`, `image`, `video`, etc.).
- **Conversation `default` session leakage** — the old
  `useState('default')` meant every panel mount reloaded the same
  conversation. Replaced with a fresh UUID per mount, then later
  switched to a `localStorage`-persisted ID.

### Removed

- **Legacy "Starter" plan tier** from the QuotaDashboard and
  Sidebar. The Token Plan has no free tier; the previous fallback
  was confusing.

## [Unreleased]

### Added

- **Multi-source skills (Kimi / agentskills.io spec)** — skills can
  now be loaded from five layers (priority = `User > Extra > Generic >
  Claude > Codex > Gemini > Built-in`), with the user dir writable
  and all other sources read-only.
  - **Loader** — `SkillLoader` refactored to accept
    `[(Path, SkillSource)]` lists. Each skill may live in a
    `<name>/SKILL.md` subdir (canonical) or a flat `<name>.md` file
    (Kimi single-file layout; subdir wins on collision). Frontmatter
    `name` and `description` are now optional with fallback chain
    (frontmatter → first body line, truncated 240 → skip). Schema
    validation per Kimi: name 1-64 chars `[a-z0-9-]+`, description
    1-1024 chars, `compatibility` ≤500 chars. `SkillSource` enum
    encodes origin, priority, and read-only flag.
  - **External paths** — auto-discovered on first call:
    `~/.claude/skills`, `~/.codex/skills`, `~/.gemini/skills`
    (brand group), `~/.config/agents/skills` / `~/.agents/skills`
    (generic). Missing dirs are silently skipped. On the Edu
    workstation this surfaces 20+ skills from Claude Code out of
    the box.
  - **API** — `GET /api/skills` returns merged list + grouped
    breakdown + scan errors. New endpoints:
    `GET /api/skills/{name}` (raw markdown),
    `POST /api/skills` (create in user dir),
    `PUT /api/skills/{name}` (edit; refuses non-user sources with
    403 — "Import to user" first),
    `DELETE /api/skills/{name}` (refuses non-user sources),
    `POST /api/skills/import` (GitHub URL → preview, no side
    effects),
    `POST /api/skills/discover` (force rescan),
    `GET /api/skills/sources` (paths + counts + read-only flag),
    `PUT /api/config/skills` (persist `merge_all_available_skills`,
    `extra_skill_dirs`, `user_dir`). Loader is cached + keyed by
    config signature; mutations auto-invalidate.
  - **System prompt** — `get_skills_metadata_prompt()` now groups
    skills by scope (omits empty groups), matching Kimi's order.
  - **WebSocket** — `/ws/chat/{sid}` `activate_skill` handler
    uses the cached multi-source loader; missing skill emits
    `skill_activate_failed` instead of silent no-op.
  - **Desktop UI** — new **Settings → Skills** sub-tab with:
    sources panel (paths + badges + counts, Add custom path, Re-scan),
    skills list grouped by scope (badge `[U]` User / `[B]` Built-in /
    `[C]` Claude / `[X]` Codex / `[G]` Gemini / `[E]` Extra /
    `·` Generic) with search, click-right context menu
    (View / Edit / Import to user / Copy path / Delete), **Create
    skill** modal with form (name + description + body + license +
    compatibility + allowed-tools) and **live SKILL.md preview**,
    **Import from GitHub** modal (URL → preview → install to user).
    All 6 i18n locales updated.
  - **Config** — new `skills:` block in `config.yaml`:
    `user_dir` (default `%APPDATA%/MiniMaxStudio/skills` on
    Windows, `~/.local/share/MiniMaxStudio/skills` on Linux),
    `extra_skill_dirs` (list of paths; supports `~` and `%ENV%`),
    `merge_all_available_skills` (reserved for the legacy
    first-match-only mode). Persisted cross-project (global, not
    workspace-scoped — by user decision).
- **Coding workspace isolation** — each coding session now binds to a
  folder the user picks (native picker via `tauri-plugin-dialog`,
  browser fallback `<input webkitdirectory>`). Once the first message
  is sent, the workspace locks: subsequent messages resolve relative
  paths against that folder, file/git/shell/upload/media endpoints
  all take a `session_id`, and conversations persist their
  `workspace_dir` so reloads restore the binding. Recent workspaces
  are remembered (top 10, MRU, dedupe, removable). Backed by 5 new
  endpoints (`/api/coding/workspace`, `/api/coding/recent-workspaces`,
  `/api/coding/session/{id}/lock`, etc) and `SessionManager` now
  accepts per-session `coding_workspace_dir`. 15 new tests in
  `tests/test_coding_workspace.py`.
- **Task Board agent ↔ user shared storage** — the agent can now
  `tasks_create` / `tasks_list` / `tasks_update` against the same
  `workspace/tasks.json` the user sees in the Task Board panel.
  Deletion is intentionally reserved for the user (agent is a
  guest, not an owner). Cards created by the agent display an
  `agent` badge so the user can tell who added what.
- **Backend startup healthcheck** — `App.jsx` now gates the real
  shell behind a `/api/config` poll (`useBackendReady.js`) so the
  React tree only mounts after the PyInstaller FastAPI sidecar is
  listening on `:8765`. Failed healthchecks show a fullscreen
  `BackendLoader` with retry. Timeout (30s) mirrors
  `HEALTHCHECK_TIMEOUT` in `lib.rs`.
- **MediaPanel layout unified** — `MediaPanelLayout` gains a
  full-width `topBar` slot and a `'full'` (single-column library)
  layout variant. New `ModeTabBar` (pill-style) drives sub-mode
  switching across Speech (4 modes) and Music (3 modes). `MediaHeader`
  gets a `right` slot for inline pills. Speech / Image / Music /
  Video panels refactored to consume the new shared layout.

### Added — Context Window (A→D)

- **Per-model percentage-based auto-compact** — `Agent._summarize_messages()`
  now triggers summarization based on `api_total_tokens / model_context_limit`
  instead of an absolute 80K floor. Thresholds: **80% auto** (respects
  user toggle, default ON), **90% force** (safety net, NEVER overridable
  even when the user disables auto-compact), **50% warn** (UI-only on M3).
  Thresholds live in `mini_agent.config.AgentConfig` and are exposed
  via `/api/config` for the frontend banner.
- **`MODEL_CONTEXT_LIMITS` per LLM client** — single source of truth
  for context windows (M3 = 1M, M2.7 / M2.7-highspeed = 204K).
  Mirrored in `desktop/src/lib/modelLimits.js`. Falls back to a 200K
  default if the client doesn't expose the map.
- **`ContextWarningBanner` 3-tier UI** — soft warn (50%, M3-only) with
  opt-in `[Compact now]` button, stronger auto banner at 80%, critical
  banner at 90%. State-based dismiss (analogia do tanque: o ponteiro
  marca meio tanque toda vez que está em meio, não só uma vez). i18n
  for `contextWindow.*` in en + pt-BR (other locales inherit English
  fallback).
- **`chat_websocket` compact handler** — accepts `{type: "compact"}`
  from the frontend and runs `agent._summarize_messages()` synchronously,
  emitting `compact_done {before_tokens, after_tokens, model}` or
  `compact_failed {detail}`. Re-emits `usage` so the StatusBar context
  chip updates without waiting for the next LLM call.
- **`daily_updated` window event** — `append_daily_turn()` emits
  `{date, path}` after each user / assistant turn so any open
  `ContextModal` / `DocViewer` / status widget refreshes in-place.
- **ContextModal a11y** — focus trap (Tab cycles inside, focus cannot
  escape into the backdrop), restore focus to the previously-focused
  element on close, `aria-modal="true"` + `aria-labelledby`, ESC +
  backdrop close.
- **`ConversationStore` Protocol + `JSONConversationStore`** —
  conversation persistence extracted behind a stable Protocol so the
  backend code talks to an interface instead of touching JSON files
  directly. `SQLiteConversationStore` stub documented as a roadmap
  placeholder (FTS5 + WAL mode hints).
- **Pytest suites recovered** — `test_speech.py` (32), `test_music_phase1.py`
  (19), `test_music_cover.py` (20), `test_music_lyrics.py` (16),
  `test_generation_defaults.py` (17) — total 104 tests referenced in
  commit `8b8de98` (v0.4.0) but never staged before that commit. They
  were already on disk with the correct content; this entry credits
  the recovery.
- **vitest for `AboutYouCard` + `ContextModal`** — 16 new tests
  (7 + 9) covering title/textarea/Save, MIN_CONTENT_CHARS validation
  banner, focus trap, ESC close, focus restore, daily auto-refresh
  via window event. Total frontend test suite: 7 files / 68 tests.

### Added — Observability

- **Structured compact-event logging** — every context-compact call
  (frontend-triggered via the WebSocket `compact` handler, and
  backend-triggered via the pre-LLM auto-compact in
  `Agent._summarize_messages`) now emits a JSON-encoded event line
  on the standard logger. The two paths share the same shape:
  - `mini_agent/agent.py` — new `_log_compact_event` helper called
    from inside `_summarize_messages`. Emits `started {before_tokens,
    pct_before, compact_reason: "force"|"auto"|"legacy", ...}`,
    `completed {after_tokens, pct_after, delta_tokens, delta_pct,
    summaries_created}`, `failed {error, error_type}`, and
    `skipped {reason}`. `Agent.__init__` accepts a new
    `session_id` kwarg (default `None`) so events carry the WS
    session id; `SessionManager.get_or_create_agent` sets it
    when binding the agent.
  - `web/backend/main.py` — new module-level
    `_log_compact_event` helper. The WS handler generates
    `compact_id = uuid.uuid4().hex[:12]` up front, snapshots
    `pct_before` from `agent.api_total_tokens / model_context_limit`,
    emits `started {triggered_by: "frontend", ...}`, then after
    `_summarize_messages` emits `completed {delta_tokens, ...}`
    and includes `compact_id` in the `compact_done` payload. On
    exception emits `failed` and the same `compact_id` in
    `compact_failed`. The `compact_done` event payload gains
    a `compact_id` field so the frontend can correlate.
  - Each call gets a unique `compact_id` (12-char hex) shared by
    the `started` and `completed` (or `failed`) events for
    correlation. Dashboards can ingest the JSON stream directly
    without grep-parsing f-strings.

### Added — StatusBar UI polish

- **Context window bar — continuous green → amber → red gradient**.
  Replaces the three discrete color bands in the ContextChip
  (chip + popover) with an inline `background: linear-gradient(...)`
  whose color at the leading edge always reflects the current fill
  level (50% shows ~amber at the edge, 95% shows ~red). Stripes
  are gone — the bar is one smooth gradient.
- **Plan usage thresholds — 5% / 20% remaining** (was based on %
  used at 70 / 90). The plan bar and the "X% left" label now
  flip when the user is **about to run out** rather than after
  they're already at 90% used: 5% left = critical (red, bold,
  AlertCircle icon), 20% left = warning (amber, bold, icon),
  >20% left = normal. Applied to both the 5-hour session bar
  and the weekly bar. Exports `planBarColor`, `planTextState`,
  and `contextBarGradient` for unit testing.

### Fixed

- **Token tracking in `last_usage`** — `Agent` was reading
  `response.usage.input_tokens` / `output_tokens`, but `TokenUsage`
  carries `prompt_tokens` / `completion_tokens` (the field names
  input_tokens / output_tokens were always 0 in this code path).
  Result: the StatusBar context chip drifted from the API-reported
  total. Now reads the correct fields; cache fields default to 0
  (acceptable cosmetic gap until `TokenUsage` grows cache slots).
- **i18next 23+ placeholder regression** — v23 changed the default
  interpolation prefix/suffix from `{name}` to `{{name}}` (mustache-style).
  Our locale JSON files still use single-curly, so every interpolated
  value rendered literally as `{count}`, `{pct}`, etc. — visible in
  the music char counter and the TaskBoard stats bar. Pinned back to
  v3-style delimiters in `desktop/src/i18n/index.js`. Companion typo
  fix: `MusicPanel.jsx` was reading `t('image.characters', ...)` for the
  music counter — the key lives under `music.*`, so the typo returned
  the key string. Now reads `t('music.characters', ...)`. Other locales
  (`es`, `ja`, `ko`, `zh-CN`) gain the `music.characters` key.
- **i18next interpolation follow-up: balance + media keys left in
  mustache** — the cffdad5 fix above only caught the `image.characters`
  typo and `music.characters`; it missed a batch of keys migrated to
  `{{var}}` in all 6 locales: `balance.tooltip`, `media.costLabel`,
  `media.dailyLabel`, `media.imageCostLabel`. With the config pinned
  to single-curly, the runtime couldn't resolve them and rendered them
  literally as `{{balance}} / {{total}}` in the StatusBar credit
  balance widget and as `{{credits}} credits (${{usd}})` in the
  Music/Video/Speech cost badges. 24 placeholders (4 keys × 6
  locales) converted back to single-curly. `media.imageCostLabel`
  has no caller today (dead key) but is fixed for parity.
  Guarded by `desktop/src/i18n/i18n.test.js` (4 new tests: no
  mustache anywhere, all 4 keys exist in all 6 locales, placeholder
  names are consistent across locales, and the real i18n instance
  correctly substitutes vars in all 6 locales). Total frontend test
  suite: 8 files / 72 tests.
- **`_safe_join` basename match** — rel_path == root.name now resolves
  to root itself, so the frontend's default `path=workspace` (or any
  path equal to the resolved root's basename) doesn't 404 on
  `root/workspace`. Path-traversal guarantees preserved (empty rel_path
  always resolves to root).
- **T2I + I2I unification on `/v1/image_generation`** — both modes
  now share the same endpoint and entry point
  (`MiniMaxSyncClient.image_generate`, `image_sync`). I2I is selected
  by passing `subject_reference=[{"type": "character", "image_file": ...}]`
  and `model="image-01-live"` instead of a separate code path. The
  sync wrapper exposes both `model` and `subject_reference` params
  so the agent can drive either mode.
- **`TaskBoard.jsx` status label fallback** — was reading
  `statusConfig.id === 'in-progress' ? ...` (a config key), which
  returned the wrong translation key for any non-`in-progress`
  status. Now reads the actual `task.status` value.

### Removed

- **Legacy PyQt6 `gui/` folder** — dropped (~1.8k LOC across
  `gui/main.py`, `gui/panels/*`, `gui/widgets/*`). The PyQt6 GUI was
  a pre-Tauri experiment that has not been actively maintained since
  the v0.4.0 desktop-first migration. Tauri 2 is the primary interface
  (`desktop/`); the web app moves to a separate fork. A separate
  PyQt6 redesign experiment (`web/gui/`) was moved out of the repo
  to `~/Documents/minimax-experiments/pyqt6-redesign/gui/`.

### Internal

- `desktop/design-reference/` (mockup HTML, screenshots,
  `TAURI_SPEC.md`, `support.js`) moved to `desktop/.gitignore` —
  working material, not part of the installable app.
- `App.jsx` trailing newline restored.

### Tests

- **`tests/test_compact_logging.py`** (NEW, 10 tests) — covers
  the structured compact-event logging on both trigger paths:
  - `Agent._summarize_messages` (backend-trigger):
    - force / auto / legacy compact_reason emitted correctly
    - force wins over auto when both apply
    - no trigger emits no `started` event (silent)
    - `completed` carries `delta_tokens`, `delta_pct`,
      `summaries_created`
    - `failed` is emitted on `_create_summary` exception with
      `error` + `error_type` populated; the exception re-raises
    - `session_id` propagates to every emitted event when set
  - Helpers:
    - `Agent._log_compact_event` echoes payload as a single JSON line
    - `main._log_compact_event` (web/backend) does the same for
      events that originate outside the agent

  Uses a stub LLM (no API key) and captures the
  `mini_agent.agent` logger output via `StringIO` `StreamHandler`
  so the tests assert on the actual JSON lines emitted. Total
  pytest: **269 passed** (was 259, +10 new), 20 failed (all
  pre-existing, unrelated to this change).

- **`desktop/src/components/shared/StatusBar.test.jsx`** (NEW, 11
  tests) — covers the gradient + plan usage thresholds:
  - `planBarColor` (pure): null → muted, >20% remaining →
    primary, 5<x≤20% remaining → amber-400, ≤5% → error
  - `planTextState` (pure): same thresholds, returns
    `normal` / `warning` / `critical`
  - `contextBarGradient` (pure): contains the three hsl stops
    (green, amber, red) as a `linear-gradient`
  - Render integration: StatusBar renders the chip with a stub
    `useSessionTokens`; clicking the chip opens the popover; the
    gradient is in the DOM; null quota state doesn't crash.

  The three helpers were exported alongside the `StatusBar`
  default export so the tests can hit the decision logic
  directly without rendering. Total vitest: **83 passed** (was
  72, +11 new), 9 files, zero regression.

- **`tests/test_token_attribution.py`** (NEW, 10 tests) —
  covers `Agent.estimate_by_source()`, the per-source token
  breakdown that powers the StatusBar popover "Breakdown by
  source" section. Tests cover: shape invariants (6 keys,
  total = sum of parts), section categorization (preamble →
  system, `## Available Skills` → skills, `## Custom MCP Tools`
  → tools, agent-context sections default to system, history
  → messages), `mcp_deferred` is always 0 today (TODO marked in
  the estimator), and the tiktoken fallback path. Catches a
  real bug in the regex split (a naive `\n## ` split attaches
  the leading newline to the preamble and silently misses
  every named section; the fix is `re.split(r"^## ",
  system_content, flags=re.MULTILINE)`). Total pytest: **279
  passed** (was 269, +10), 20 failed (all pre-existing).

- **`desktop/src/components/shared/StatusBar.test.jsx`**
  (extended, +3 tests) — covers the per-source breakdown
  rendering: hidden when `bucket.lastBySource` is null,
  renders all 5 row labels when present, percentages match
  expected. Total vitest: **86 passed** (was 83, +3 new), 9
  files, zero regression.

- **`desktop/src/components/settings/SettingsPanel.test.jsx`**
  (NEW, 4 tests) — covers the auto-compact toggle flow:
  renders with the i18n label + description, default state
  matches backend `auto_compact: true`, reflects backend
  `auto_compact: false` when returned, and clicking the
  toggle + Save button sends `auto_compact: false` in the
  PUT body (catches the bug where a user turning it off
  would round-trip as omitted and the toggle would silently
  re-enable on next load). Total vitest: **90 passed** (was
  86, +4 new), 10 files.

- **`desktop/src/components/settings/SettingsPanel.mcp.test.jsx`**
  (NEW, 4 tests) — covers the i18n label changes for the
  MiniMax MCP section: settings.tools maps to "MCP Servers
  (MiniMax)", settings.webSearch / settings.imageUnderstanding
  include the "(MCP)" suffix, settings.webSearchDesc calls
  out "MiniMax MCP server". Hard guard against reverting to
  the original generic "Tools" label. Total vitest: **94
  passed** (was 90, +4 new), 11 files.

### Added — Token attribution (by source)

- **`Agent.estimate_by_source()`** — new method that
  approximates how the current context window is split across
  content sources. Categories: `system` (agent context
  SOUL/IDENTITY/USER/MEMORY/daily + base preamble), `skills`
  (section whose header mentions skill), `tools` (section
  whose header mentions mcp tool / custom mcp / tool),
  `messages` (user/assistant/tool history), `mcp_deferred`
  (always 0 today — TODO: relevance-based MCP deferral
  strategy), `total` (sum of parts). Uses the same
  tiktoken cl100k_base encoder as `_estimate_tokens()` with a
  ~2.5 chars/token fallback when tiktoken is unavailable.
  Splits the system prompt by `^## ` headers
  (MULTILINE-flagged) and categorizes each section by header
  keyword. Best-effort: any section whose header doesn't
  match a known keyword falls into `system` (safe default).

- **WS `usage` event includes `by_source`** — both the
  per-turn `usage` event and the `assistant` event now carry
  a `by_source` field (the result of `estimate_by_source()`).
  Field is optional and the frontend is defensive: missing it
  just renders no breakdown. The estimator is wrapped in
  try/except so any failure doesn't break the response
  stream. Three emission sites updated: standalone `usage`
  event, `assistant` event fallback, and the re-emitted
  `usage` after a frontend-triggered compact (recalculates
  because the system prompt shrinks when summarization runs).

- **StatusBar popover renders "Breakdown by source"** — new
  sub-section inside the Context window section, rendered
  only when `bucket.lastBySource` is populated. Five rows
  (Messages / System / Skills / Tools / MCP deferred) each
  with a 1.5px-tall bar + label + percent of total. Hidden
  gracefully when no breakdown is available yet (no clutter
  on the first turn). Plumbed through `SessionTokensContext`
  (new `lastBySource` field on the bucket; `recordUsage()`
  accepts an optional 4th arg, bySource) and `ChatPanel`
  (two `recordUsage` call sites pass `data.by_source`).

### Added — Settings (auto-compact toggle + dedicated Agent Save)

- **Auto-compact toggle in Settings → Agent** — new Row
  with Toggle in the existing Agent Card. Label "Auto-compact
  at 80%" + description that makes the 90%-safety-net
  behavior explicit. The 80% auto-compact threshold respects
  the toggle; the 90% safety net is NEVER overridable (per
  invariant #14, AGENTS.local.md). Added `auto_compact:
  Optional[bool]` to `AgentConfigUpdate` on the backend and
  `cfg["auto_compact"]` write in the PUT handler. The
  frontend coerces to Boolean so a user turning the toggle
  OFF actually round-trips as `false`, not omitted.

- **Dedicated Save button in the Agent section** — the
  original Save button (in the API key row) was disabled
  when the API key field was empty, so the user could only
  persist agent settings by also typing a new API key.
  Added a dedicated Save button to the Agent Card, scoped to
  the agent settings (max_steps, auto_compact, region,
  api_base, model), wired to a new `handleSaveAgent()` that
  does only the PUT /api/config/agent. The API key save
  still uses the original `handleSave()`.

### Added — Settings (MCP Servers MiniMax label)

- **Settings → "Tools" and "MCP servers" merged into a
  single "MCP Servers" section** — the first attempt was to
  rename the "Tools" section to "MCP Servers (MiniMax)" and
  add a "(MCP)" suffix to the toggle labels. That kept the
  two adjacent sections separate and the suffix redundant.
  On second look the two were conceptually the same thing
  (MiniMax ships two built-in MCP servers, the user can
  add more) — the split was just historical. Now a single
  "MCP Servers" section (id `settings-mcp-servers` for the
  scroll-spy) with a single Card containing two sub-blocks:
  "MiniMax" (the built-in web_search + understand_image
  toggles, with toggle labels back to "Web Search" /
  "Image Understanding" without the now-redundant suffix) and
  "Your servers" (the user-configured MCP server list, with
  the existing add/edit/delete UI). The two sub-block labels
  are new i18n keys (`settings.mcpServersMinimax` and
  `settings.mcpServersYours`) translated to all 6 locales.
  The rail loses the separate "Tools" entry and keeps just
  the "MCP Servers" entry.

- **System prompt gets a unified "## MCP Servers" section**
  — the agent now sees both the MiniMax built-in servers
  AND the user-configured MCP servers in one place, with
  the same shape the Settings panel uses. The first version
  of this block only documented the two MiniMax servers
  (`web_search`, `understand_image`) and added a separate
  generic "## Custom MCP Tools" block that just said
  "additional tools are available". Eduardo caught that the
  two should be unified and the Custom block should list
  the actual configured servers, not a generic stub. New
  shape:
  ```
  ## MCP Servers
  ### MiniMax (built-in)
    - **web_search**: searches the web for real-time information...
    - **understand_image**: analyzes an image and returns a description...
  ### Custom (user-configured)   [omitted entirely if no custom servers]
    - **filesystem** (Local Filesystem) — 3 tool(s)
    - **github** (GitHub API) — 2 tool(s)
    Tool names are prefixed with `mcp_{server_id}_`. ...
  ```
  The Custom sub-block is omitted entirely when the user
  has no MCP servers configured (no empty placeholders).
  Tool counts are computed by grouping
  `ExternalMCPTool` instances by `server_id`. If a server
  config has no `name` field, the section shows the id alone
  ("**filesystem** — 3 tool(s)") rather than
  "**filesystem** (filesystem) — 3 tool(s)". Extracted to
  a pure `_build_mcp_section(mcp_tools)` function in
  `web/backend/main.py` for unit testing.

### Added — Anti-hallucination for `claude mcp list`

- **MCP system prompt block teaches the agent how MCP tools
  reach it** — the agent was trying to run `claude mcp list`
  via the bash tool to discover MCP servers. Root cause:
  training-data bleed from Claude Code CLI patterns. There
  is no `claude` binary in this app; MCP tools are exposed
  as native Anthropic `tool_use` functions in the request's
  `tools` array. Added an explicit "How MCP tools reach you"
  paragraph to `_build_mcp_section()` spelling out:
  - MCP tools come in as native function calls (same as
    `read_file`, `write_file`, `bash`), not behind a shell
    command.
  - NEVER run `claude mcp list`, `claude mcp add`,
    `npx @modelcontextprotocol/...`, `pip install mcp-...`.
  - There is no `claude` CLI in this app — the name is a
    coincidence with the protocol, not a tool.
  - To see what's available: read the `functions` array.
  - If a tool is missing → toggled OFF in Settings or
    server failed to start. Tell the user plainly, don't
    try to install.
  5 new tests in `tests/test_mcp_section.py` cover each
  claim. 18/18 `mcp_section` tests pass.

### Fixed — Onboarding wizard "still incomplete" after completion

- **IncompleteContextBanner kept showing after the wizard**
  — `MIN_CONTENT_CHARS = 500` in `web/backend/agent_context.py`
  requires each of SOUL/IDENTITY/USER/MEMORY to be ≥500 chars.
  The wizard wrote short scaffolds:
  - `preset.concise`: 418 chars ❌ (others 320-385 chars)
  - `role.{eng,reviewer,pm}`: ~50 chars ❌
  - `buildUserBody()`: ~125 chars ❌
  - `buildMemoryBody()`: ~90 chars ❌
  Even when the user "finished" the wizard, 3-4 files stayed
  below threshold → banner persisted. User feedback was
  "achei que o onboarding poderia ser mais completo".
  Expanded every wizard-written body with substantial new
  sections:

  PRESETS (SOUL.md, ~900-1150 chars each, en-US + pt-BR):
  - `## Response patterns` (how to open, structure, length)
  - `## When to ask vs decide` (decision-making framework)
  Each preset now teaches the agent how to behave, not just
  what to be.

  ROLES (IDENTITY.md, ~900-1100 chars each):
  - `## Out of scope` (what NOT to do)
  - `## Output format` (how to deliver)
  - `## Quality bar` (acceptance criteria)

  USER.md (`buildUserBody`, ~730 chars):
  - `## Communication preferences`
  - `## Current focus`

  MEMORY.md (`buildMemoryBody`, ~957 chars):
  - Seeded with 3 §-separated Hermes-style entries covering
    workspace conventions, banner behavior, persistence model.

  Threshold kept at 500 — meaningful for real user content,
  but the wizard seed counts as filled.

  10 new tests across `test_agent_context.py`,
  `test_agent_context_api.py`, `useAgentContext.test.jsx`:
  - per-preset and per-role threshold checks (en-US + pt-BR)
  - `buildUserBody`/`buildMemoryBody` size + structure
  - end-to-end "after wizard write, `is_complete=True`"
  - USER body clears threshold even with empty name

### Changed — Breakdown refactor (matches the Claude Code design)

- **`Agent.estimate_by_source()` returns 9 source categories
  + expandable sub-section detail** — bumped shape:
  `messages`, `skills`, `memory_files`, `custom_agents`,
  `system_prompt` (renamed from `system`),
  `mcp_tools` (currently loaded MCP tool schemas),
  `mcp_deferred`, `system_tools_deferred`,
  `free_space` (= `limit - total`), plus `total`, `limit`,
  and a `details` sub-dict with three lists:
  - `details.mcp_tools_list`: per-server summary
    (`{server_id, name, tool_count, tokens}`) computed by
    grouping `ExternalMCPTool` entries by `server_id` and
    tokenizing each tool's Anthropic schema.
  - `details.memory_files_list`: per-file
    (`{file, tokens}`) extracted from
    `(USER.md)`, `(MEMORY.md)`, `(SOUL.md)`,
    and the Hermes `MEMORY (agent notes)` marker.
  - `details.custom_agents_list`: per-agent
    (`{agent, tokens}`) extracted from
    `## Current Role (IDENTITY.md)`.

  Attribution is best-effort: section headers that don't
  match a known keyword fall into `system_prompt` (safe
  default). Old keys (`system`, `tools`) are gone — `test_old_keys_not_present_in_new_shape`
  guards against silent fallbacks.

- **StatusBar popover renders the Claude-Code-style breakdown**
  — new `BreakdownPanel` sub-component (extracted from
  `ContextChip` for unit testability):
  - 9 flat rows (Messages, Skills, Memory files, Custom
    agents, System prompt, MCP tools, MCP tools deferred,
    System tools deferred, Free space) — each with label +
    bar + token count + percent.
  - 3 expandable chevron rows below: MCP tools (per-server
    tool counts), Memory files, Custom agents — chevron
    rotates on click and the per-server/per-file entries
    slide in below.

  Layout matches the Claude Code reference: chevron +
  summary (`X.XXk · N tools`) on the collapsed row;
  per-entry with thin bar + count on expand.

  6 new vitest in `StatusBar.test.jsx`: shape, all 9 row
  labels, percentage computation, empty-details hidden,
  expandable click → per-server entries visible.

### Added — Context references (`@file:` / `@folder:` / `@diff` / `@staged` / `@git:N` / `@url:`)

Hermes-spec inline references. The user types `@file:src/main.py` in
the composer and the LLM sees the file contents under an
`--- Attached Context ---` block at send time. Closes the biggest
gap in the v0.5+ Hermes feature roadmap
(`docs/roadmap/v0.5-hermes-context-features.md`).

- **Backend** — new module `web/backend/context_refs.py`
  - **Parser** — 6 syntaxes (`@file:`, `@folder:`, `@diff`,
    `@staged`, `@git:N`, `@url:`). Strips trailing punctuation
    but preserves line-range colons (`@file:foo.py:10-25`).
  - **Sensitive path blocklist** — `~/.ssh`, `~/.aws`, `~/.gnupg`,
    `~/.kube`, `~/.netrc`, `~/.pgpass`, `~/.npmrc`, `~/.pypirc`,
    shell profiles, `.env`. Both exact file match and directory
    prefix match. Symlink-resolved (so `~/./ssh/id_rsa` is caught).
  - **Path resolution** — relative to `workspace_dir` only.
    Rejects absolute paths and `../` traversal via
    `.resolve() + relative_to()` check.
  - **File reader** — UTF-8 with `errors='replace'`, 1-indexed
    inclusive line ranges.
  - **Binary detection** — null-byte scan in the first 8KB.
  - **Folder tree** — recursive walk with max 200 entries
    (Hermes spec), dirs-before-files, truncation marker.
  - **Git ops** — `diff` / `staged` via subprocess
    (10s timeout, 5MB cap), `git:N` clamped to `[1, 10]`.
  - **URL fetcher** — `httpx` GET, 10s timeout, 50KB cap, HTML
    stripped (drops tags + script/style + decodes common entities
    + collapses whitespace). http/https only.
  - **Size limits** — soft 25% (warn, all refs still expand) /
    hard 50% (refuse all, original message unchanged). 1 token ≈
    4 bytes (matches `mini_agent/agent.py` fallback).
  - **Per-ref failure model** — sensitive path / binary / not
    found / path traversal / git error / URL error each become
    a `result.error` string. Errors do NOT abort other refs.

- **Backend endpoints** — registered in `web/backend/main.py`
  - `POST /api/context-refs/expand` — `{session_id, message}` →
    `{results, total_bytes, soft_warning, refused, refusal_reason, parsed_refs}`.
  - `POST /api/context-refs/list` — `{session_id, prefix, max_entries}` →
    `{entries: [{path, is_dir, size}], truncated}`. Powers the
    path autocomplete popover.

- **Frontend** — new components in `desktop/src/components/context-refs/`
  - `parseRefs.js` — JS port of the Python regex.
  - `partialRefAt()` — finds the in-progress `@`-ref at the cursor
    for the autocomplete popover.
  - `useContextRefs({draft, cursor, sessionId})` — pure-React hook
    that surfaces `parsed`, `partial`, `report` (debounced expand),
    `suggestions` (debounced list), `isExpanding`, `isListing`.
  - `<ContextRefChips>` — one chip per parsed ref. Green check
    for success, red triangle for errors, neutral for pending.
    Soft-limit warning as a full-width banner.
  - `<ContextRefAutocomplete>` — popover over the textarea.
    Shows the 6 ref types when user types `@` or `@<partial>`;
    shows file/folder path suggestions when user types
    `@file:` / `@folder:`. Outside-click closes. Escape closes.
  - **Composer.tsx** — wires it all up. On submit, re-runs
    `/api/context-refs/expand` to get fresh attached context,
    appends the `--- Attached Context ---` block to the message,
    and calls `onSend` with the augmented text. Hard-limit
    refusal blocks the send (alert + disabled button).
  - **ChatPanel.tsx** — passes `state.sessionId` to the Composer.

- **Tests** — 50 pytest (context_refs) + 13 pytest (endpoint) +
  27 vitest (parser + chips) + 7 vitest (Composer integration) =
  **97 new tests** across the feature. All green.
- **Docs** — `docs/roadmap/v0.5-hermes-context-features.md` updated
  with PR A marked complete (path forward for PR B is the
  memory tool).

### Added — Memory tool (`memory` agent tool)

Hermes-spec memory management. The agent can now save, replace,
or remove entries in MEMORY.md (2,200 chars) and USER.md
(1,375 chars) during a turn — unlocking the self-improvement
loop between sessions that the spec requires.

- **Backend** — new `MemoryTool` class in
  `mini_agent/tools/memory_tool.py`
  - **3 actions** dispatched via a single `action` parameter:
    `add` (append, with auto-duplicate prevention),
    `replace` (substring match on `old_text`),
    `remove` (substring match on `old_text`).
  - **Capacity check** before every write — if
    `current + new > limit`, returns error with
    `current_entries` list and usage string (Hermes spec
    format, paraphrased to our 2-target shape). The agent
    must consolidate (replace/remove) in the same turn
    before retrying.
  - **Substring matching** — `old_text` just needs to be a
    unique substring of exactly 1 entry. Multiple matches
    return error asking for a longer substring.
  - **Security scan** — prompt-injection patterns
    (ignore-previous, system-prompt-override, hidden HTML
    comments, credential exfiltration) + invisible Unicode
    (zero-width, bidi overrides) blocked.
  - **Atomic write** (tmp + replace) so a crash mid-write
    doesn't leave a half-written file.
  - **Audit log** — structured `memory_write` event via
    `logger.info` with extras `{action, target, old_chars,
    new_chars, delta, ts}`. Failed writes don't emit
    (only state changes log).
  - **write_approval gate** — when `config.minimax.memory.
    write_approval=true`, refuses with "awaiting approval"
    message. The staging queue is a future batch — for now,
    the gate just refuses.
  - **§-separated entries** — Hermes pattern. The leading
    `#` preamble (header + explanation) is preserved
    across add/replace/remove operations.

- **Agent registration** — `web/backend/main.py` appends
  `MemoryTool` to the per-session tool list. `agent_dir` is
  read from `<app_workspace>/.agent/` — the same path the
  context-files loader reads from. So a write via
  MemoryTool is immediately visible to `load_agent_context`
  on the next session (frozen snapshot pattern, per spec).

- **Tests** — 41 pytest (memory_tool.py unit tests) + 7 pytest
  (integration) = **48 new tests** across 2 test files. All green.
  - Unit: split/join round-trip (3), substring matching (4),
    security scan (8), add (6), replace (6), remove (3),
    validation (2), security integration (2), write_approval (2),
    audit log (3), split_preamble helper (3).
  - Integration: writes to expected path, capacity blocks,
    replace/remove, audit log emitted with extras, tool
    importable, tool list assembly includes MemoryTool.

- **Roadmap** — PR B marked complete in
  `docs/roadmap/v0.5-hermes-context-features.md`. PR C
  (Live Todo Progress) is next.

### Added — Live Todo Progress (CodingPanel side panel, imperative)

Hermes-spec live task list in the CodingPanel side panel
(per Edu's v0.5+ feedback: "imperative ficar na janela
lateral do code"). When the agent creates/updates tasks
during a coding turn, the side panel shows them in real-time
with progress X/Y, status icons, and auto-collapse when all
done.

- **Backend** — cross-session WebSocket broadcast
  - **`tasks_tool.py`** — `TasksBaseTool` accepts an optional
    `on_change` callback. `TasksCreateTool` and `TasksUpdateTool`
    call it after a successful write with `(task, action)`.
    Callback errors are caught (broadcast failures must NOT
    roll back the disk write). `source_session_id` parameter
    added to create (default None for back-compat).
  - **`web/backend/main.py`** — new module-level `_ws_registry`
    (session_id → set[WebSocket]). `chat_websocket` registers
    on accept + unregisters on disconnect (in a `finally`).
    New async `broadcast_task_event(task, action)` sends
    `{type: "task_updated", action, task}` to matching
    WebSockets — filtered by `source_session_id` (or ALL
    sessions for tasks without a source, which is the
    TaskBoard-panel case). Best-effort delivery — dead WS
    are silently skipped.
  - **Tool wiring** — the per-session tool instantiation
    passes a callback that stamps the session's id and
    schedules the broadcast via `asyncio.ensure_future` on
    the running event loop. Sync callback signature bridges
    to the async broadcast without blocking the tool return.

- **Frontend** — compact list component + WS subscription
  - **`<LiveTodoProgress>`** in `desktop/src/components/taskboard/`
    - Header: chevron + "Tasks" label + X/Y counter
    - Per-row icon: `Circle` (pending), `CircleDashed` (in-progress,
      with `animate-pulse`), `CheckCircle2` (done)
    - Done items: line-through + emerald-500 icon
    - Auto-collapses 2s after the last task is marked done
      (gives the user the "all green" moment before the panel
      quietly disappears)
    - Empty state: "No tasks yet" hint, takes minimal space
    - Sort: order asc, then created_at asc (matches TaskBoard)
  - **`useLiveTodos({sessionId, websocket})`** hook
    - Initial fetch via `GET /api/tasks`, filtered by
      `source_session_id` on the client
    - WebSocket event handler filters by session, ignores
      `task_updated` events for other sessions, ignores
      tasks with no source (TaskBoard-only), ignores
      non-JSON frames
    - Dedup on duplicate `create` events, field-merge on
      `update` events
  - **`WorkspaceSidebar` integration** — the existing
    "Todos (demo)" tab (renamed to "Todos") now renders
    `<LiveTodoProgress>` via `useLiveTodos`. `codingWs` +
    `codingSessionId` flow from `CodingPanel` through
    `WorkspaceSidebar` to the new `TodosPanel`.

- **Tests** — 19 new tests across 3 files
  - `test_tasks_tool_callback.py` (6): fires on create,
    fires on update, doesn't fire on invalid input, doesn't
    fire when no actual changes, callback exception is
    tolerated, no callback is fine
  - `test_task_ws_registry.py` (7): register/unregister
    round-trip, unregister unknown is safe, multiple WS per
    session, broadcast targets matching session, broadcast
    with no source goes to all, dead WS doesn't break
    broadcast, no listeners is a no-op
  - `LiveTodoProgress.test.jsx` (21, was 14 in the previous
    batch but I added 7 more this batch for the integration
    angle): empty state, header + counter, counter updates,
    collapse/expand, toggle on click, sort order, status
    icons, strikethrough on done, auto-collapse 2s after
    all-done, no collapse when some pending, initial fetch
    + filter, fetch failure graceful, create event, update
    event, ignore other sessions, ignore no-source, ignore
    non-task_updated events, dedup, ignore non-JSON
  - `WorkspaceSidebar.test.jsx` (5): renders live component
    on Todos tab, passes WS + sessionId, renders live tasks,
    counter reflects done count, fallback when no sessionId
  - **Total: 19 new tests + 14 already-shipped = 33 tests
    covering the feature**

- **Roadmap** — PR C marked complete in
  `docs/roadmap/v0.5-hermes-context-features.md`. Next
  pending: PR D (progressive subdirectory discovery),
  PR E (more personality presets), PR F (CLAUDE.md /
  .cursorrules detection).

  Test counts: pytest **311/311** pass (was 292, +19);
  vitest **102/102** pass (was 95, +7).

### Added — PR A polish (Composer consolidation + popover)

The PR A foundation (PR A in-place → Composer → spacious popover →
fixes) was added in a previous batch and is documented in the
"Added — Context references" section above. This entry covers the
polish batch that landed on top of it to make the @-ref autocomplete
feel like part of the same control surface as the slash menu.

- **`Composer` consolidates slash menu + attachment + @-ref** —
  the ChatPanel's inline `textarea + popover` wiring for `@`-refs
  was originally hand-rolled around the existing textarea
  (`PR A in-place`, `8a819d7`). The slash menu and paperclip
  attachment lived in a separate copy. Refactored to a single
  `Composer.tsx` component (`698afe7`) that owns the textarea,
  the slash menu, the @-ref autocomplete popover, and the
  attachment chip. ChatPanel lost ~315 lines of duplication.
  The Composer is the single source of truth for chat input;
  the CodingPanel still has its own inline textarea (separate
  migration, not in scope this batch).
- **Spacious autocomplete popover** (`945f350`) — popover went
  from 320px / 28px row / bare `path` label to 420px / 48px row /
  filename (medium mono) on top + parent dir (dim mono) below +
  right-aligned human-readable size (`1.2 KB` not `1234 bytes`).
  Folders grouped before files with a subtle "Folders" / "Files"
  header. Footer hint `↑↓ navigate · ↵ select · Esc close` makes
  the keyboard nav discoverable. ↑↓ arrow keys + Enter to select
  (no mouse needed). `shadow-xl` + folder icon in yellow for
  visual distinction.
- **Popover opens upward + responsive width** (`c6bb82a`) —
  mirrored the SlashMenu positioning pattern. `bottom-full left-0
  mb-1.5` (was `mt-1`) so the popover no longer covers the
  model/thinking status row below the composer. Width changed
  from hardcoded `w-[420px]` to `w-full max-w-[420px]` so it
  collapses gracefully on narrow viewports. Max-height bumped
  from `max-h-80` (320px) to `max-h-[28rem]` (448px) so the 6
  ref types + headers + footer all fit without scroll.
- **Cursor state stays in sync with text** (`c712026`) — when
  the user picked a type from the popover (e.g. "File"),
  `handleAutocompleteSelect` updated the React `text` state and
  the DOM `selectionRange` but never updated the React `cursor`
  state. Result: `partialRefAt('@file:', cursor=1)` computed the
  wrong partial on re-render, the popover reopened as the type
  picker (instead of file suggestions), and the next click
  duplicated `@file:` to `@file:file:`. Fixed by also calling
  `setCursor(newCursor)` inside the same functional update.
  Same fix adds `e.preventDefault()` to the Enter handler when
  `autocompleteOpen` (was relying on the popover's document-level
  handler, which only preventDefaults on truthy `insertion` —
  the empty-state row's Enter was inserting a stray newline).
  Regression test in `Composer.test.tsx`: pressing Enter twice
  on the type picker no longer duplicates the prefix.
- **Composer matches Coding textarea height** (`0b2936f`) —
  the Chat composer's empty state was `rows=1 / py-1.5` (~32px
  textarea + ~16px card padding = ~48px total), while the Coding
  AgentChat textarea was `rows=2 / py-3` (~64px + ~16px = ~80px).
  Bumped Chat to `rows=2 / py-2.5` (~60px + ~16px = ~76px) —
  close enough to Coding to feel like the same family of input.
  Auto-grow cap of 200px unchanged.
- **`ContextChip` tracks the live model picker** (`f3a7bbc`) —
  `modelId` was derived from `bucket?.lastModel || DEFAULT_MODEL`,
  so the moment the user switched the picker to M2.7 the chip
  still showed 1.0M until the first M2.7 usage landed. Now
  prefers the live `model` prop (App.jsx passes `activeModel`)
  and falls back to the bucket's `lastModel` then `DEFAULT_MODEL`.
- **`ContextChip` uses theme accent + 80% red warning**
  (`f3a7bbc`) — replaced the fixed green→amber→red gradient
  with the active theme's accent color (blue for default,
  cyan for ocean, green for forest, etc.). At `pct ≥ 80%` the
  bar flips to `#ef4444` as a hard warning — except when the
  theme is `minimax` (the red theme), where red is already
  the brand color and the flip would lose the signal. The
  `contextBarGradient` export is kept for the unit test but
  no longer used by the chip. Updated test asserts the theme
  accent appears in the DOM and the old gradient does NOT.

### Fixed — `get_minimax_config` UnboundLocalError

- **Chat WebSocket crashed on cold start with UnboundLocalError**
  (`869d1c2`) — `web/backend/main.py` referenced
  `get_minimax_config()` inside a try block but only assigned it
  in the except branch. On the success path the name was
  undefined → UnboundLocalError → WS disconnect. Reordered so
  the assignment happens unconditionally before the function
  is used.

### Fixed — M3 thinking reverts to spec-documented values

- **M3 thinking reverts to documented `adaptive` / `disabled`**
  (`f6bdf5c`) — earlier in the day a `2570ef2` commit switched
  M3's thinking from `{"type": "adaptive"}` to an invented
  `{"type": "enabled", "budget_tokens": 4096}` (intuition was
  "always force M3 to think so the ThinkingBlock never
  disappears"). The MiniMax Anthropic-compatible API spec only
  documents two valid values: `adaptive` (on, model decides
  reasoning depth) and `disabled` (off). The invented value
  was not in the spec. Reverted to `adaptive` and added an
  explicit `disabled` branch for `thinking=False`. The
  ThinkingToggle continues to control ON/OFF; for M3 with
  `adaptive`, the model can still skip reasoning on trivial
  turns (greetings, etc.) — that's documented behavior, not
  a bug. New rule registered: never invent model-specific
  parameter values — always cross-check the upstream spec
  before changing them.

- The Agent tab now lets users override the default MiniMax
  Anthropic-compatible endpoint. The backend validates the URL and
  persists it via the existing `PUT /api/config/agent` endpoint.
  The project uses Anthropic SDK as the single LLM protocol
  (MiniMax's docs recommend it for prompt-cache benefits); the
  `api_base` override is intended for proxies or advanced routing
  only.

### Added — Task planning discipline (system prompt + tool description)

- **System prompt gains a "Task Planning & Tracking" section**
  (`mini_agent/config/system_prompt.md`) — teaches the agent
  the discipline to apply before creating tasks via the
  `tasks_create` tool. Three quality filters: **certainty**
  (every task must have a verifiable definition of done),
  **coherence** (the task set must form a logical sequence
  with no duplicates or overlap), and **action-orientation**
  (titles start with a verb and name the outcome). The
  section also covers lifecycle discipline: create the full
  plan upfront, mark `in-progress` right before starting,
  mark `done` only after the work is actually verified
  (file saved and checked, test run and passed, output
  inspected), and never mark `done` to "move on" — that
  erodes the board's meaning.
- **`tasks_create` tool description references the new section**
  (`mini_agent/tools/tasks_tool.py`) — the inline description
  now tells the agent to use the tool only for 3+ step /
  multi-turn requests, requires a verifiable definition of
  done, and points to the system prompt section for the
  full discipline. Stops the agent from spamming the board
  with single-action or vague tasks.
- **Regression guard** — `tests/test_system_prompt.py`
  (NEW, 5 tests) parses the system prompt and asserts the
  section exists, references both `tasks_create` and
  `tasks_update`, covers the three quality filters, covers
  the lifecycle discipline, and explicitly warns against
  marking done prematurely. Catches accidental removal of
  the guidance.

## [0.3.1] — 2026-06-02 — Stub cleanup

Follow-up to 0.3.0: removes the last batch of UI stubs that survived
the original release. The Settings modal and the Code Workspace
sidebar are now honest about what they persist and what they don't.

### Fixed

- **Settings Modal: agent settings were a stub** — the "Agent" tab
  had fields for model, max_steps, workspace_dir, and region, but
  the Save button was a no-op (the API key was the only field
  wired up). Added `PUT /api/config/agent` (validates region
  against `global`/`cn`, max_steps between 1 and 1000) and
  extended `handleSave` to round-trip all four fields. Also fixed
  `/api/config` to return model / max_steps / workspace_dir under
  `data.agent.*` (the frontend was reading from there but the
  backend was returning an empty object, so the form always
  showed the JS-side fallbacks instead of the real values).
- **Settings Modal: System Prompt textarea was a stub** — the
  field was always empty (no `system_prompt` field exists in the
  config) and the Save button did nothing with it. Replaced with
  a note pointing to the `system_prompt.md` file in the config
  directory, which is what the agent loop actually loads.
- **Todos tab: hardcoded demo data** — the Todos tab in the Code
  Workspace showed a hardcoded 3-item list labelled "will be
  auto-generated by the agent in Plan mode" (it wasn't). Renamed
  the tab to "Todos (demo)" and added a "Demo data — coming soon"
  note. Toggling the demo items still works (it's harmless
  in-memory state) but the user is no longer misled about
  persistence.

See [docs/PROJECT_LOG.md](docs/PROJECT_LOG.md) for the full
pre-changelog history. Highlights:

- 2026-05-08: Session Protection, Conversation Search, Recent
  Generations gallery, public docs refresh.
- 2026-05-06: Sidebar redesign plan (`/` unified hub, modes
  Plan/Agent/YOLO), MiniMax official visual analysis.
- Earlier: full web app (Chat, Code Workspace, media panels),
  Skills system, MCP tools, theme system (9 themes).
