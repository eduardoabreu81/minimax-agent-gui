# AGENTS.md

> This file provides guidance to AI coding agents working with this repository.
> Expect the reader to know nothing about the project.

## Project Overview

**MiniMax Agent GUI** is a personal AI agent application powered by the MiniMax M3 model (with M2.7 and M2.7-highspeed as selectable options). It provides:
1. A **desktop app** (`desktop/`, Tauri 2 + Vite + React 18 + Tailwind) — primary and recommended interface
2. A **web app** (`web/`, FastAPI + React 18 + Vite + Tailwind) — legacy, slated for a separate fork
3. A **CLI framework** (`mini_agent/cli.py`) — terminal-based interactive agent

> Note: The PyQt6 desktop GUI exists in `gui/` but is no longer actively maintained.

The project wraps MiniMax MCP tools (`web_search`, `understand_image`) as standard agent tools and provides media generation (TTS, Image, Music, Video) via MiniMax APIs.

- **Name**: `minimax-agent-gui`
- **Version**: `0.4.0`
- **License**: MIT
- **Python**: `>=3.10`
- **Node**: `>=18`
- **Status**: Active development — desktop-first migration complete (Tauri scaffold + speech 4 sub-modes + settings index rail)

## Technology Stack

### Web App
- **Backend**: FastAPI, Uvicorn, WebSocket
- **Frontend**: React 18, Vite, Tailwind CSS
- **HTTP Client**: `httpx` (backend), `fetch` (frontend)
- **Markdown**: `react-markdown` + `remark-gfm`
- **i18n**: `react-i18next` (6 languages)
- **Icons**: `lucide-react`

### Core Framework
- **LLM Providers**: Anthropic (Claude) and OpenAI-compatible APIs via `mini_agent.llm`
- **API Backend**: MiniMax API (`api.minimax.io` / `api.minimaxi.com`)
- **HTTP Client**: `httpx` (sync and async)
- **Data Validation**: Pydantic v2
- **Configuration**: YAML (`pyyaml`)
- **Token Counting**: `tiktoken` (cl100k_base encoder)
- **CLI Framework**: `prompt-toolkit`
- **Build System**: `hatchling`

## Project Structure

```
minimax-agent-gui/
├── web/                        # Web app (FastAPI + React 18)
│   ├── backend/
│   │   └── main.py             # FastAPI: REST API + WebSocket chat
│   ├── frontend/
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── chat/       # ChatPanel.jsx — persistent conversations
│   │   │   │   ├── coding/     # CodingPanel.jsx — IDE workspace
│   │   │   │   ├── media/      # ImagePanel, MusicPanel, VideoPanel, TTSPanel
│   │   │   │   ├── settings/   # SettingsPanel — tools toggles, theme, lang
│   │   │   │   └── MarkdownRenderer.jsx
│   │   │   ├── i18n/           # 6-language i18n config
│   │   │   └── App.jsx
│   │   └── vite.config.js      # Vite + proxy (/api → :8000, /ws → :8000)
│   └── package.json            # npm run dev = concurrently backend + frontend
├── gui/                        # PyQt6 desktop application
│   ├── main.py                 # MainWindow, entry point
│   └── panels/                 # Chat, TTS, Image, Code, Music, Video panels
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

### Web App
```bash
cd web
npm run dev          # Starts FastAPI (:8000) + Vite (:3000) concurrently
```

### CLI
```bash
mini-agent
```

## Build and Install Commands

```bash
# Python dependencies
pip install -e .

# Web dependencies
cd web && npm install

# Run web app
cd web && npm run dev

# Run desktop GUI
python -m gui.main

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

## Web App Architecture

### Backend (`web/backend/main.py`)

FastAPI server with:
- **REST endpoints** — `/api/image`, `/api/tts`, `/api/music`, `/api/video`, `/api/upload`, `/api/files/*`, `/api/conversations/*`, `/api/config`
- **WebSocket** — `/ws/chat/{session_id}` for real-time streaming chat
- **SessionManager** — Creates agent per session with ReadTool, WriteTool, BashTool, and optional WebSearchTool/UnderstandImageTool
- **Conversation Persistence** — Auto-saves every message to `workspace/conversations/{id}.json`
  - Chat uses plain IDs; Code uses `coding-{id}` IDs
  - Backend filters via `?type=coding` query param
- **File Upload** — `POST /api/upload` saves to `workspace/uploads/`, returns path
- **File Download** — `GET /api/files/download?path=` serves files (images, audio, etc.)

### Frontend (`web/frontend/src/`)

React 18 with Vite and Tailwind CSS:
- **ChatPanel** — Persistent conversations, file attachment, markdown rendering, Enter-to-send
- **CodingPanel** — File explorer, editor, terminal, git, persistent code-chat with context injection
- **ImagePanel** — T2I + I2I tabs, aspect ratio picker, gallery, batch generation
- **TTSPanel** — Voice selection with language filter, speed control, batch generation
- **MusicPanel** — Prompt/lyrics generation with optimizer
- **VideoPanel** — Text/image-to-video with duration/resolution selection
- **SettingsPanel** — Tools toggles, theme, language, model settings

### Vite Proxy Config

```js
proxy: {
  '/api': { target: 'http://localhost:8000' },
  '/ws': { target: 'ws://localhost:8000', ws: true }
}
```

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

## Key Features (as of 0.3.0)

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

`ThinkingBlock` (in `web/frontend/src/components/shared/`) renders the
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

## Repository layout (post v0.4.0)

Starting with v0.4.0, this repo ships **only the Tauri desktop app** as
the installable interface. The legacy web frontend is being moved to a
separate fork (`eduardoabreu81/minimax-agent-gui-web`).

| Path | Repo | Notes |
|---|---|---|
| `desktop/` | this | Tauri 2 desktop app (primary, installable) |
| `web/backend/` | this | FastAPI — also bundled by Tauri sidecar, shared |
| `mini_agent/`, `mini_max_mcp/`, `tests/` | this | Core + tests |
| `web/frontend/` | fork `minimax-agent-gui-web` | Legacy React web app — preserved on a `web-archive` branch before the split, then moved to the fork |

When working in this repo, **do not edit `web/frontend/*`** — it's
frozen and the active development target is `desktop/`. If you need to
mirror a feature back to the web app, do it in the fork.

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

- **Subprocess**: `subprocess.run("mmx ...", shell=True)` required because `mmx` is a `.cmd`
- **Paths**: Backend uses `Path` objects; frontend receives paths with `/` separators

## Common Pitfalls for Agents

- **Do not** assume `config/config.yaml` exists in a fresh clone — it is gitignored.
- **Do not** modify the `web/` directory's `node_modules` — use `npm install` in `web/`.
- When editing `main.py`, the server may need manual restart (Uvicorn StatReload can hang).
- The `MiniMaxSyncClient` and `MiniMaxClient` have **separate** method signatures — sync uses `requests`, async uses `httpx`.
- The `image_variations` (I2I) method uses `subject_reference` with `image_file` (data URL), not `image_base64`.
- Frontend WebSocket connects directamente to `ws://localhost:8000` (not through Vite proxy for `/ws/chat/`).
- Conversation IDs starting with `coding-` are filtered by backend as coding sessions.
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

## No CLI dependency for Token Plan operations

As of the mmx→API migration, the backend **only** uses direct HTTP
calls to the Token Plan API (`/v1/api/openplatform/coding_plan/remains`)
for plan detection and quota enrichment. The mmx CLI subprocess and
the `_fetch_quota_via_mmx` helper were removed. Subsequent PRs migrate
the remaining `/api/minimax/cli` and `/api/minimax/voices` endpoints
to direct API calls (see migration roadmap).
