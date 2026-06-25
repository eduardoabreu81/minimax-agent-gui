# AGENTS.md

> This file provides guidance to AI coding agents working with this repository.
> Expect the reader to know nothing about the project.

## Project Overview

**MiniMax Agent GUI** is a personal AI agent application powered by the MiniMax M3 model (with M2.7 and M2.7-highspeed as selectable options). It provides:
1. A **desktop app** (`desktop/`, Tauri 2 + Vite + React 18 + Tailwind) — primary and only installable interface
2. A **CLI framework** (`mini_agent/cli.py`) — terminal-based interactive agent

The project wraps MiniMax MCP tools (`web_search`, `understand_image`) as standard agent tools and provides media generation (TTS, Image, Music, Video) via MiniMax APIs. The FastAPI backend (`web/backend/`) is bundled by the Tauri shell as a sidecar — there is no separate web app in this repo.

- **Name**: `minimax-agent-gui`
- **Version**: `0.4.0`
- **License**: MIT
- **Python**: `>=3.10`
- **Node**: `>=18`
- **Status**: Active development — desktop-first migration complete (Tauri scaffold + speech 4 sub-modes + settings index rail + skills system + agent context system)

## Technology Stack

### Desktop App
- **Shell**: Tauri 2 (Rust) + Vite + React 18 + Tailwind CSS
- **Component library**: shadcn-style components (`lucide-react`, `radix-ui`, `class-variance-authority`)
- **Markdown**: `react-markdown` + `remark-gfm`
- **i18n**: `react-i18next` (6 languages)
- **Icons**: `lucide-react`
- **Bundled backend**: PyInstaller-bundled FastAPI sidecar on `:8765`

### Backend (`web/backend/`)
- **Framework**: FastAPI, Uvicorn, WebSocket
- **HTTP Client**: `httpx` (sync and async)
- **Data Validation**: Pydantic v2
- **Configuration**: YAML (`pyyaml`)

### Core Framework
- **LLM Providers**: Anthropic (Claude) and OpenAI-compatible APIs via `mini_agent.llm`
- **API Backend**: MiniMax API (`api.minimax.io` / `api.minimaxi.com`)
- **Token Counting**: `tiktoken` (cl100k_base encoder)
- **CLI Framework**: `prompt-toolkit`
- **Build System**: `hatchling`

## Project Structure

```
minimax-agent-gui/
├── desktop/                    # Tauri 2 desktop app (only installable interface)
│   ├── src/                    # React 18 + Vite + Tailwind frontend
│   │   ├── components/         # Chat, Coding, media, settings, agent-context, shared
│   │   ├── hooks/              # useSessionProtection, AgentActivityContext, useAgentContext
│   │   ├── i18n/               # 6-language i18n config
│   │   ├── App.jsx             # Top-level shell + tab routing
│   │   ├── themes.css          # 9 color themes
│   │   └── main.jsx
│   ├── src-tauri/              # Rust backend (tauri 2.1 + tauri-plugin-shell 2.0)
│   │   └── src/lib.rs          # start_backend() spawns the FastAPI sidecar
│   ├── vite.config.js          # Vite + proxy (/api, /ws → :8765)
│   ├── tauri.conf.json         # productName "MiniMax Agent", identifier com.minimax.agent.desktop
│   └── package.json
├── web/                        # Backend only (bundled by Tauri sidecar)
│   └── backend/
│       ├── main.py             # FastAPI: REST API + WebSocket chat
│       ├── agent_context.py    # .agent/*.md loader (SOUL/IDENTITY/USER/MEMORY)
│       ├── conv_store.py       # Conversation persistence (JSON)
│       ├── i18n.py             # Backend i18n (89 keys × en-US/pt-BR)
│       ├── mcp_agent_tools.py  # MCP runtime
│       ├── mcp_runtime.py      # MCP server lifecycle
│       └── subdirectory_hints.py  # Progressive subdirectory discovery (AGENTS.md, CLAUDE.md)
├── mini_agent/                 # Core agent framework (reusable library)
│   ├── agent.py                # Async agent loop, tool execution, token summarization
│   ├── cli.py                  # Interactive CLI entry point
│   ├── config.py               # Pydantic-based config loader
│   ├── llm/                    # LLMClient (Anthropic/OpenAI routing)
│   └── tools/                  # Bash, File, Note, MCP, Skill tools
├── mini_max_mcp/               # MiniMax-specific integrations
│   ├── client.py               # MiniMaxSyncClient / MiniMaxClient
│   │                           # TTS, Image (T2I + I2I), Video, Music APIs
│   ├── mcp_tools.py            # MiniMaxMCPClient (web_search, understand_image)
│   └── mcp_tool_wrapper.py     # Tool wrappers for Agent
├── tests/                      # pytest test suite
├── config/                     # User configuration (gitignored, contains secrets)
│   └── config.yaml
├── workspace/                  # Runtime working directory
│   ├── conversations/          # Auto-saved chat histories (JSON)
│   ├── uploads/                # Uploaded files from chat/code panels
│   └── logs/                   # Application logs
└── examples/                   # Progressive usage examples
```

## Entry Points

### Desktop App
```bash
cd desktop
npm run tauri:dev          # Launches Tauri shell + auto-spawns backend sidecar
```

### CLI
```bash
mini-agent
```

## Build and Install Commands

```bash
# Python dependencies
pip install -e .

# Desktop app dependencies
cd desktop && npm install

# Run desktop app (Tauri dev mode)
cd desktop && npm run tauri:dev

# Run tests
pytest -v
```

## Configuration

### User Config (`config/config.yaml`)

Gitignored file containing secrets:

```yaml
minimax:
  api_key: sk-cp-...
  api_base: https://api.minimax.io
  region: global  # or "cn" for api.minimaxi.com
tools:
  web_search: true
  understand_image: true
```

The backend exposes `/api/config` (returns `api_key_configured: boolean`, never the key string) and `/api/config/tools` (POST to toggle tools).

## Backend Architecture (`web/backend/`)

FastAPI server with:
- **REST endpoints** — `/api/image`, `/api/tts`, `/api/music`, `/api/video`, `/api/upload`, `/api/files/*`, `/api/conversations/*`, `/api/config`, `/api/skills/*`, `/api/agent-context/*`
- **WebSocket** — `/ws/chat/{session_id}` for real-time streaming chat
- **SessionManager** — Creates agent per session with ReadTool, WriteTool, BashTool, and optional WebSearchTool/UnderstandImageTool
- **Conversation Persistence** — Auto-saves every message to `workspace/conversations/{id}.json`
  - Chat uses plain IDs; Code uses `coding-{id}` IDs
  - Backend filters via `?type=coding` query param
- **File Upload** — `POST /api/upload` saves to `workspace/uploads/`, returns path
- **File Download** — `GET /api/files/download?path=` serves files (images, audio, etc.)
- **Agent Context** — `.agent/*.md` (SOUL/IDENTITY/USER/MEMORY/dailies) loaded at session start, snapshotted into system prompt
- **Skills** — multi-source loader (`User > Extra > Generic > Claude > Codex > Gemini > Built-in`)
- **Subdirectory Hints** — `AGENTS.md`/`CLAUDE.md`/`.cursorrules` progressively discovered on file reads

## Key Frontend Patterns

### Persistent Conversations

Both Chat and Code panels follow the same pattern:
1. `sessionId` / `codingSessionId` state — current conversation ID
2. `conversations` state — list fetched from `/api/conversations` or `/api/conversations?type=coding`
3. Dropdown in header with load/delete/rename actions
4. `newChat()` / `newCodingChat()` — generates new UUID, clears messages, reconnects WebSocket
5. History sent as single `{"type": "history", "messages": [...]}` event on WebSocket connect
6. Messages rendered with `<MarkdownRenderer />`

### File Attachment Flow

1. User selects file → `POST /api/upload` → backend saves to `workspace/uploads/`
2. Frontend stores `{name, path, type}` in `attachment` state
3. On send: WebSocket payload includes `{message, attachment}`
4. Backend: if image → calls `understand_image` MCP and prepends description to prompt
5. Backend: if text → reads content and prepends to prompt
6. Message saved with `attachment` field for display on reload

### MarkdownRenderer

- Wrapper around `react-markdown` + `remark-gfm`
- `className` on wrapper `<div>`, NOT on `<ReactMarkdown>` (v9 removes className prop)
- Custom `pre` component with copy button (hover to reveal, checkmark feedback)
- Custom `code` component for inline vs block styling

## Code Organization & Architecture

### 1. Agent Loop (`mini_agent/agent.py`)

Async loop: receive message → call LLM → execute tool_calls → repeat until done.
- Token summarization at ~80k tokens
- Cancellation via `asyncio.Event`

### 2. LLM Abstraction (`mini_agent/llm/`)

- `LLMClient` routes to Anthropic or OpenAI based on `provider`
- For MiniMax endpoints, auto-appends `/anthropic` suffix

### 3. MiniMax Integration (`mini_max_mcp/`)

- `MiniMaxSyncClient` — sync TTS, Image (T2I + I2I), Video, Music via `requests`
- `MiniMaxClient` — async versions via `httpx`
- `MiniMaxMCPClient` — `web_search` and `understand_image` tools
- Endpoints:
  - TTS: `/v1/t2a_v2`
  - Image: `/v1/image_generation`
  - Video: `/v1/video_generation`
  - Music: `/v1/music_generation`
  - Web Search: `/v1/coding_plan/search`
  - Understand Image: `/v1/coding_plan/vlm`

### 4. MCP Tools (`mini_max_mcp/mcp_tools.py`)

Response format uses `base_resp` for error codes and `content` for VLM text / `organic` array for search results.

> **Important:** The Token Plan search endpoint expects the query under
> the short key `"q"`, NOT `"query"`. The legacy `recency_days` /
> `max_results` fields are no longer accepted (return HTTP 400 invalid
> params). Match the working `minimax-coding-plan-mcp` server's
> request shape: `{"q": "<query>"}`.

## Key Features (as of 0.4.0)

### Per-turn Model + Thinking Controls

Every chat/code panel composer has a compact **ModelThinkingControls**
row below the textarea:

- **Model selector** (`<select>`): M3, M2.7, M2.7-highspeed. Persisted
  per-panel via `localStorage` (`chat-model-override` /
  `code-model-override`).
- **Thinking toggle** (button with Brain icon): only visible for M3.
  When ON, sends the Anthropic `thinking: {type: "adaptive"}` param.
  Persisted via `localStorage` (`chat-thinking-enabled` /
  `code-thinking-enabled`).

The model and thinking override are sent in the WebSocket payload
and forwarded to `agent.run(model_override, thinking_override)`,
which passes them to `llm.generate(model=..., thinking=...)`.

### Real-time Thinking + Text Streaming

The LLM client uses the Anthropic SDK's `messages.stream()` to stream
content_block_delta events as they arrive. The chat/code panels
receive `thinking_delta` and `text_delta` events over the WebSocket
and append them to the in-flight message so the user sees the
reasoning and response stream **word-by-word** in real time.

The final `assistant` event from the backend freezes the streaming
message (no duplication) and attaches the model tag + any metadata.

### Thinking Block

`ThinkingBlock` (in `desktop/src/components/shared/`) renders the
model's reasoning as its own message in the chat timeline (above the
assistant's response). Always visible (per user preference). Shows a
streaming spinner while chunks are still arriving. A separate
`{type: 'thinking', streaming: true}` message handles the live
accumulation; the final assistant message freezes it.

### Session Persistence

Chat and code session IDs are persisted in `localStorage`
(`chat-session-id` / `code-session-id`). Switching tabs or refreshing
the page keeps the same conversation. Only the explicit "New Chat"
action clears the storage key and generates a fresh UUID.

### Plan Auto-Detection

The Token Plan API returns each model entry with a
`current_interval_status` field (1 = active for this plan, 3 =
inactive). The backend infers the user's tier from `model_remains[]`
in `_detect_plan_from_api()` (`web/backend/main.py`):
- `video` status=1 → max+ (default `max`; Ultra is a superset)
- `image`/`speech`/`music` status=1 → plus
- only `general` status=1 → plus (lowest paid tier; no "starter")
- nothing active → `unknown`, falls back to `config.minimax.plan`

## Testing Strategy

- **Framework**: `pytest` with `pytest-asyncio`
- Some tests require live API key in `config/config.yaml`
- Unit tests for tools can run without API key

## Repository layout (v0.4.0)

Starting with v0.4.0, this repo ships **only the Tauri desktop app** as
the installable interface. The legacy web frontend has been removed from
this repo (the React SPA exists in a separate fork under
`eduardoabreu81/minimax-agent-gui-web` if you need it).

| Path | Repo | Notes |
|---|---|---|
| `desktop/` | this | Tauri 2 desktop app (only installable interface) |
| `web/backend/` | this | FastAPI — bundled by Tauri sidecar, shared |
| `mini_agent/`, `mini_max_mcp/`, `tests/` | this | Core + tests |

The active development target is `desktop/`. If you need to mirror a
feature back to the web SPA, do it in the fork.

## Code Style Guidelines

- **PEP 8** with Python 3.10+ union syntax (`str | None`)
- **Docstrings**: triple-double-quotes (`"""`)
- **Naming**: `snake_case` functions/variables, `PascalCase` classes
- **Logging**: `logging.getLogger(__name__)`
- **Error Handling**: Tools return `ToolResult(success=False, error=...)` rather than raising

## Security Considerations

- **API Keys**: Stored in `config/config.yaml` (gitignored). Backend NEVER returns the key string.
- **Bash Tool**: Executes arbitrary shell commands. On Windows uses PowerShell; on Unix uses bash.
- **File Tools**: Respect `workspace_dir`; paths resolved relative to workspace.
- **File Download Endpoint**: `GET /api/files/download?path=` checks path is within `PROJECT_ROOT`.

## Windows-Specific Notes

- **Paths**: Backend uses `Path` objects; frontend receives paths with `/` separators

## Common Pitfalls for Agents

- **Do not** assume `config/config.yaml` exists in a fresh clone — it is gitignored.
- When editing `main.py`, the server may need manual restart (Uvicorn StatReload can hang).
- The `MiniMaxSyncClient` and `MiniMaxClient` have **separate** method signatures — sync uses `requests`, async uses `httpx`.
- The `image_variations` (I2I) method uses `subject_reference` with `image_file` (data URL), not `image_base64`.
- Conversation IDs starting with `coding-` are filtered by backend as coding sessions.
- **Skill sources priority is `User > Extra > Generic > Claude > Codex > Gemini > Built-in`** — Edit/Delete via `PUT/DELETE /api/skills/{name}` refuse non-User sources with HTTP 403 and a hint to "Import to user first". Use `POST /api/skills/import` to promote an external skill to the user dir.
- **Skill name schema (Kimi / agentskills.io)** — `^[a-z0-9][a-z0-9-]{0,63}$`. Description 1-1024 chars. Validation lives in `mini_agent/tools/skill_loader.py` (`_validate_name`, `_validate_description`) and raises `SkillValidationError` → HTTP 400.
- **Skills `config` block is cross-project** — `skills.extra_skill_dirs` lives in `config/config.yaml` (not workspace-local, by user decision). Default `user_dir` is `%APPDATA%/MiniMaxStudio/skills` on Windows, `~/.local/share/MiniMaxStudio/skills` on Unix. External brand dirs (`~/.claude/skills`, `~/.codex/skills`, `~/.gemini/skills`) are auto-discovered and silently skipped if missing.
- **Token Plan web_search uses `"q"` not `"query"`** — see the
  warning in section 4 above. Hardcoding the legacy field name
  silently breaks the tool with HTTP 400.
- **Default model is MiniMax-M3**, not M2.7 or M2.5. The settings
  picker offers M3 / M2.7 / M2.7-highspeed.
- **Anthropic SDK blocks non-streaming calls >10 min.** Any LLM
  call must use `messages.stream()` (already the default in
  `anthropic_client.py`).
- **mmx CLI 1.0.16+ renamed model buckets** (`general`, `image`,
  `video`, `speech`, `music`). The legacy `minimax-m2.7` etc. names
  no longer appear. If you grep for them, you'll find nothing.
- **Model is user-selectable in Settings** — system prompts use the `{model}` placeholder, do not hardcode M3 (or M2.7) in new code.

## Auto-updater

- **Plugin:** `@tauri-apps/plugin-updater` (Rust) + `@tauri-apps/plugin-updater` (npm).
  Wired in `desktop/src-tauri/src/lib.rs` via `tauri_plugin_updater::Builder::new().build()`.
- **Configuration:** `desktop/src-tauri/tauri.conf.json > plugins.updater`. Endpoints
  point at `https://github.com/<owner>/minimax-agent-gui/releases/latest/download/...`.
  The `pubkey` field MUST be replaced with the Ed25519 public key from `tauri signer generate`
  before the first release — until then the updater rejects everything.
- **Capabilities:** `desktop/src-tauri/capabilities/default.json` grants
  `updater:default`, `process:default` (the latter covers `relaunch()` —
  the plugin only exposes `allow-exit` and `allow-restart`, but `relaunch`
  works through `process:default`).
- **Frontend UI:** Settings → About → Update row (auto-update check, download,
  relaunch). State machine in `SettingsPanel.jsx`: `idle | checking | upToDate | available | downloading | readyToRestart | error`.
- **Release pipeline:** `.github/workflows/release.yml` runs on `v*` tag push.
  Builds ubuntu/windows/macos in parallel, signs with `TAURI_SIGNING_PRIVATE_KEY`
  (from GitHub Secrets), generates per-target `*-updater.json`, uploads to GitHub
  Release. The updater plugin polls those JSONs to detect new versions.
- **Required GitHub Secrets (set in repo Settings → Secrets):**
  - `TAURI_SIGNING_PRIVATE_KEY` — output of `tauri signer generate`
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — passphrase (empty string if none)
  - `APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD` / `APPLE_SIGNING_IDENTITY` —
    macOS only; optional for first releases, required before distributing `.dmg`
- **Generating the signing key (one-time, locally):**
  ```bash
  cargo install tauri-cli --version "^2.0"
  tauri signer generate -w ~/.tauri/minimax-agent.key.json
  # Public key (safe to commit) → desktop/src-tauri/tauri.conf.json > plugins.updater.pubkey
  # Private key contents → GitHub Secret TAURI_SIGNING_PRIVATE_KEY
  ```
- **macOS caveat:** `.dmg` won't install via the updater without Apple Developer ID
  signing ($99/yr). Windows users get a SmartScreen warning without EV cert signing.

## Token Plan video limits (canonical)

Backend `web/backend/main.py` (`_detect_plan_from_api` + the quota
endpoint) enforces these per-tier daily caps and **the frontend
must not redefine them**:

- **Plus** — `video_daily_limit = null` (no video access; status=3 in
  `model_remains[video]`). The QuotaDashboard `parse()` filters Plus
  out via `if (limit == null) return null`.
- **Max** — `video_daily_limit = 3` (default; also used for
  auto-detected Max since `_detect_plan_from_api` can't tell Max from
  Ultra — they share the same `model_remains` access flags).
- **Ultra** — `video_daily_limit = 5`, **only when `minimax.plan: ultra`
  is explicitly set in `config/config.yaml`**. Without that, the
  auto-detector returns "max" and the user sees the conservative 3/day.

QuotaDashboard `OFFICIAL_MODELS[video]` is gated by `plan: 'max'` and
reads `data.video_daily_limit/used` directly (no percentage math).

## No CLI dependency

The app is **fully independent of the `mmx` CLI**. Every MiniMax API
call goes through direct HTTP (`mini_max_mcp/client.py`,
`MiniMaxSyncClient._post_json` / `MiniMaxClient` async helpers). The
backend never shells out to `mmx`; users do **not** need the `mmx` CLI
installed to run the app.

- Token Plan: direct HTTP to `/v1/api/openplatform/coding_plan/remains`
- Speech: `/api/minimax/speech/*` (T2A sync/async, voices, clone, design)
- Music: `/api/music` (uses `MiniMaxSyncClient.music_generate`)
- Video: `/api/video` (uses `MiniMaxSyncClient.video_generate` + poll)
- Image: `/api/image` (uses `MiniMaxSyncClient.image_generate`)
- Web search / VLM: direct HTTP via `MiniMaxMCPClient`

## Roadmap references (Hermes upstream docs)

Hermes is the upstream agent that this project mirrors. These pages
are the canonical references for the Agent Context feature work —
keep them open when designing any context-window / memory / persona
change so we stay compatible with the Hermes spec:

- **Memory** — https://hermes-agent.nousresearch.com/docs/user-guide/features/memory
  Hermes memory file structure (SOUL/IDENTITY/USER/MEMORY + daily logs),
  append-only patterns, char budgets per slot, banner-trigger rules.
- **Context files** — https://hermes-agent.nousresearch.com/docs/user-guide/features/context-files
  How the four `.agent/*.md` files get read at session start, the
  snapshot-into-system-prompt semantics, and the per-file char limits.
- **Context references** — https://hermes-agent.nousresearch.com/docs/user-guide/features/context-references
  How Memory writes back into the files (append-only via `§`), daily
  log rotation, and the agent→memory feedback loop.
- **Personality** — https://hermes-agent.nousresearch.com/docs/user-guide/features/personality
  The 5 SOUL.md presets (concise / friendly / mentor / expert / creative)
  and how the personality slot fits into the system prompt.

When designing the v0.5+ Advanced Controls panel (approval mode,
command allowlist, working directory, compression thresholds, etc.)
these pages are the starting point — match Hermes conventions unless
we have an explicit reason to diverge.
