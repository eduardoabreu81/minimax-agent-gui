<div align="center">
  <img src="docs/assets/minimax-agent-gui-banner.png" alt="MiniMax Agent GUI" width="100%"/>
</div>

# 🤖 MiniMax Agent GUI

> A simple all-in-one web interface for MiniMax — Chat, Image, Video, Music, Speech, MCP tools, skills, and agent workflows in one place.
>
> Built with ❤️ for the MiniMax community.

[![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![Tailwind](https://img.shields.io/badge/Tailwind-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

## Product Positioning

MiniMax Agent GUI is a simple all-in-one web interface for MiniMax. It gives MiniMax users a practical GUI for chat, image, video, music, speech, MCP tools, skills, and agent workflows without jumping between CLI commands, scripts, and separate API calls.

The Code Workspace is part of the app, but it is not the whole product.

## Features

- **Chat** — Persistent conversations with file attachments, image understanding, markdown rendering, and code copy
- **Image Generation** — Text-to-image and image-to-image with aspect ratio, batch, gallery, prompt optimizer, and recent generations history
- **Video** — Hailuo-2.3 text/image-to-video with multiple durations, resolutions, and recent video history
- **Music** — Music generation from prompts or lyrics, instrumental mode, cover from reference audio, and recent music history
- **Speech / TTS** — 30+ voices, speed control, streaming playback, and recent speech history
- **MCP Tools** — Built-in Web Search and Image Understanding, configurable custom MCP servers, connection testing, tool discovery, and external MCP tools loaded into agent sessions
- **Skills & Agent Workflows** — Slash commands, skill templates, Plan Mode with editable approve-and-run drafts, tool permission approvals, and agent-driven multi-step tasks
- **Code Workspace** — File explorer, editor, terminal, and persistent code-chat sessions
- **Multi-language** — English, Português (BR), 日本語, 한국어, Español, 中文

## Install

Requires **Python 3.10+**, **Node.js 18+**, and a [MiniMax API key](https://platform.minimax.io).

```bash
git clone https://github.com/eduardoabreu81/minimax-agent-gui.git
cd minimax-agent-gui

# Core Python dependencies (CLI, MCP, agent framework)
pip install -e .

# Web backend dependencies (FastAPI, WebSocket, file upload)
pip install -r web/backend/requirements.txt

# Frontend dependencies
cd web && npm install
```

Configure your API key via `config/config.yaml` or the `MINIMAX_API_KEY` environment variable.

```bash
cp mini_agent/config/config-example.yaml config/config.yaml
# Edit config/config.yaml and add your key
```

## Quick Start

```bash
cd web
npm run dev
```

This starts:
- **Backend** — FastAPI on `http://localhost:8000`
- **Frontend** — Vite dev server on `http://localhost:3000`

Open `http://localhost:3000` and start chatting.

## Usage

### Chat

Upload images or text files, toggle Web Search and Image Understanding in Settings, and chat with M2.7. Conversations auto-save and can be renamed or deleted.

### Image Generation

```
Prompt: "A futuristic city at sunset"
Aspect Ratio: 16:9  |  Batch: 4  |  Prompt Optimizer: ON
→ Generate
```

Upload a reference image for character-consistent variations (I2I).

### Video

Describe a scene or upload an image to generate video with progress tracking.

### Music

Enter a prompt and optional lyrics to generate songs. Enable instrumental mode for background music or upload reference audio for cover generation.

### TTS

Type text, pick a voice, adjust speed, and generate speech.

### MCP Tools

Open **Settings > Tools** to manage built-in MiniMax tools and custom MCP servers. Custom MCP servers support **stdio** and **SSE** transports. You can add, edit, enable/disable, delete, and test connections. Enabled servers are loaded into new agent sessions; tool names are prefixed as `mcp_{server_id}_{tool_name}` to avoid collisions.

> **Note:** External MCP tools require approval in Agent mode; YOLO mode auto-approves them. HTTP transport is not implemented yet. MCP tools are loaded when a new agent session is created, so changing MCP server config may require starting a new chat or session to reload tools.

### Code Workspace

Switch to the Code tab for a file explorer, editor, terminal, and persistent code-chat sessions. The agent can read, write, and edit files in your workspace. You can switch between **Agent**, **Plan**, and **YOLO** modes. Plan mode creates an editable draft plan before execution; once approved, the agent receives the full plan and runs it step by step.

**Tool Permissions** — Agent mode asks for approval before risky tools (write/edit, shell, unknown, and external MCP tools) via an Approve / Reject modal. YOLO mode auto-approves all tools. Plan mode uses Agent permissions after Approve & Run.

### Agent Outputs

Generated media files are saved under `workspace/generations/`:

```
workspace/generations/
├── images/   # Generated images
├── videos/   # Generated videos
├── music/    # Generated music
└── tts/      # Generated speech
```

Each media panel also displays a **Recent Generations** gallery that surfaces outputs from `workspace/generations/` as well as compatible files in the workspace root, so you can preview and download past results without leaving the panel.

## Configuration

| File | Purpose |
|------|---------|
| `config/config.yaml` | API key, region (`global` or `cn`), default model, built-in tool toggles, custom MCP servers |

Environment variables:

| Variable | Purpose |
|----------|---------|
| `MINIMAX_API_KEY` | Override API key |
| `MINIMAX_API_BASE` | Override base URL |

Example MCP server configuration in `config/config.yaml`:

```yaml
mcp_servers:
  local-filesystem:
    name: Local Filesystem
    transport: stdio
    command: npx
    args:
      - "-y"
      - "@modelcontextprotocol/server-filesystem"
      - "./workspace"
    env: {}
    enabled: true
```

## Roadmap

### Shipped
- [x] Command Palette (Ctrl+K)
- [x] Live agent activity panel (steps, tools, thinking)
- [x] Quick Settings panel
- [x] MCP tool toggles (web search, image understanding)
- [x] Slash skills and agent workflows
- [x] Theme system (9 themes, light/dark)
- [x] Dual-layout code workspace (IDE mode / Agent mode)
- [x] Generations folder structure for media outputs
- [x] Session Protection — Guards against accidental context loss when navigating tabs, refreshing, or leaving the page
- [x] Conversation Search — Find past chats and code sessions by title, content, or attachment
- [x] Recent Generations in media panels — Image, Video, Music, and TTS panels show a browsable history of past outputs plus compatible files in the workspace
- [x] Agent Plan Mode — Editable plan draft with approve-and-run workflow in the Code Workspace
- [x] Configurable MCP Servers — Manage custom stdio/SSE MCP servers from Settings
- [x] MCP Connection Test & Tool Discovery — Test configured servers and preview discovered tools
- [x] External MCP Tool Runtime — Enabled MCP server tools are loaded into new agent sessions with safe prefixed names
- [x] Permission System — Agent tool execution policy with auto/ask/reject decisions and Code Workspace approve/reject modal

### Phase 1 — Foundation
_Complete. All Phase 1 items have shipped._

### Phase 2 — Productivity
- [ ] **Task Board (Kanban)** — Project planning with todo/in-progress/done columns

### Phase 3 — Extensibility
- [ ] **Plugin System** — Community extensibility with custom tabs and backends
- [ ] **Custom Skills** — User-defined skill templates per project type

### Phase 4 — Polish
- [ ] **Sandboxed Preview** — Secure iframe preview for generated code

## License

MIT — see [LICENSE](LICENSE)

---

<div align="center">

Made with ❤️ powered by MiniMax

**[Report Bug](https://github.com/eduardoabreu81/minimax-agent-gui/issues)** • **[Request Feature](https://github.com/eduardoabreu81/minimax-agent-gui/issues)**

</div>
