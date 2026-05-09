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
- **Image Generation** — Text-to-image and image-to-image with aspect ratio, batch, gallery, and prompt optimizer
- **Video** — Hailuo-2.3 text/image-to-video with multiple durations and resolutions
- **Music** — Music generation from prompts or lyrics, instrumental mode, cover from reference audio
- **Speech / TTS** — 30+ voices, speed control, streaming playback
- **MCP Tools** — Built-in web search and image understanding toggles; easy MCP access and configuration
- **Skills & Agent Workflows** — Slash commands, skill templates, and agent-driven multi-step tasks
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

### Code Workspace

Switch to the Code tab for a file explorer, editor, terminal, and persistent code-chat sessions. The agent can read, write, and edit files in your workspace.

### Agent Outputs

Generated media files are saved under `workspace/generations/`:

```
workspace/generations/
├── images/   # Generated images
├── videos/   # Generated videos
├── music/    # Generated music
└── tts/      # Generated speech
```

## Configuration

| File | Purpose |
|------|---------|
| `config/config.yaml` | API key, region (`global` or `cn`), default model, tool toggles |

Environment variables:

| Variable | Purpose |
|----------|---------|
| `MINIMAX_API_KEY` | Override API key |
| `MINIMAX_API_BASE` | Override base URL |

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

### Phase 1 — Foundation
- [ ] **Session Protection** — Prevent accidental context loss when navigating
- [ ] **Conversation Search** — Find past chats and code sessions

### Phase 2 — Productivity
- [ ] **Task Board (Kanban)** — Project planning with todo/in-progress/done columns
- [ ] **Agent Plan Mode** — Full plan-then-execute workflow with editable steps

### Phase 3 — Extensibility
- [ ] **Configurable MCP Servers** — Add custom MCP servers (stdio, SSE, HTTP)
- [ ] **Plugin System** — Community extensibility with custom tabs and backends
- [ ] **Custom Skills** — User-defined skill templates per project type

### Phase 4 — Polish
- [ ] **Sandboxed Preview** — Secure iframe preview for generated code
- [ ] **Permission System** — Granular auto/ask/reject per tool

## License

MIT — see [LICENSE](LICENSE)

---

<div align="center">

Made with ❤️ powered by MiniMax

**[Report Bug](https://github.com/eduardoabreu81/minimax-agent-gui/issues)** • **[Request Feature](https://github.com/eduardoabreu81/minimax-agent-gui/issues)**

</div>
