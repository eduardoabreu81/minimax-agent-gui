# Changelog

All notable changes to **MiniMax Agent GUI** are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Note:** Pre-0.3.0 history lives in [docs/PROJECT_LOG.md](docs/PROJECT_LOG.md)
> and [git history](https://github.com/eduardoabreu81/minimax-agent-gui/commits/main).

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

- **Settings Modal: custom API base URL** — the Agent tab now lets
  users override the default MiniMax Anthropic-compatible endpoint.
  The backend validates the URL and persists it via the existing
  `PUT /api/config/agent` endpoint. The project uses Anthropic SDK
  as the single LLM protocol (MiniMax's docs recommend it for
  prompt-cache benefits); the `api_base` override is intended for
  proxies or advanced routing only.

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
