<div align="center">
  <img src="web/frontend/public/favicon.svg" alt="MiniMax Agent" width="64" height="64"/>
</div>

# 🤖 MiniMax Agent GUI

<div align="center">

[![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![Tailwind](https://img.shields.io/badge/Tailwind-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> **Personal AI agent powered by MiniMax M2.7** — with integrated Chat, Coding IDE, TTS, Image Generation, Music, Video, and MCP tools.

</div>

---

## 📋 Table of Contents

- [Features](#-features)
- [Screenshots](#-screenshots)
- [Installation](#-installation)
- [Web App](#-web-app)
- [Desktop GUI](#-desktop-gui)
- [Project Structure](#-project-structure)
- [Token Plans](#-token-plans)
- [API Endpoints](#-api-endpoints)
- [Changelog](#-changelog)
- [License](#-license)

---

## ✨ Features

### 💬 Chat & Code

- **Persistent Conversations** — Auto-save chat history with load, rename, and delete
- **Code Workspace** — Full IDE with file explorer, editor, terminal, git, and code-chat
- **File Attachments** — Upload images (analyzed via `understand_image`) and text files
- **Markdown Rendering** — `react-markdown` + `remark-gfm` with syntax-highlighted code blocks and copy buttons
- **Enter to Send** — Shift+Enter for newlines
- **WebSocket** — Real-time streaming responses

### 🎨 Image Generation

- **Text-to-Image** — MiniMax `image-01` with 8 aspect ratios
- **Image-to-Image** — Upload reference image or paste URL for character-consistent variations
- **Batch Generation** — Generate 1-9 images at once
- **Prompt Optimizer** — Let MiniMax improve your prompt automatically
- **Gallery** — Browse previously generated images with download
- **Resolutions** — 1024×1024, 1280×720, 720×1280, 1152×864, 1248×832, 832×1248, 864×1152, 1344×576

### 🔊 Text-to-Speech

- **Speech 2.8 HD** — High-quality voice synthesis
- **Voice Selection** — Filter by language (English, Chinese, Cantonese, etc.)
- **Speed Control** — Adjust playback speed
- **Batch TTS** — Generate multiple audio files

### 🎵 Music & 🎬 Video

- **Music Generation** — Create songs from prompts or lyrics (Music-2.5)
- **Video Generation** — Hailuo-2.3 text/image-to-video with multiple durations and resolutions

### 🛠️ MCP Tools

- **Web Search** — Real-time web search via MiniMax MCP (`/v1/coding_plan/search`)
- **Image Understanding** — Analyze images via MiniMax VLM (`/v1/coding_plan/vlm`)
- **Toggle Switches** — Enable/disable tools in Settings

### 🌍 Internationalization

- **6 Languages** — English, Português (BR), 日本語, 한국어, Español, 中文 (简体)
- **Language Switcher** — Instant switching without reload

---

## 📸 Screenshots

<div align="center">
  <p><em>Chat Panel with conversation history and file upload</em></p>
  <p><em>Image Generation with T2I / I2I tabs and aspect ratio picker</em></p>
  <p><em>Code Workspace with file explorer, terminal, and persistent code-chat</em></p>
</div>

---

## 📦 Installation

### Prerequisites

- Python 3.10+
- Node.js 18+
- MiniMax API key from [platform.minimax.io](https://platform.minimax.io)

### 1. Clone & Install Python Dependencies

```bash
git clone https://github.com/eduardoabreu81/minimax-agent-gui.git
cd minimax-agent-gui
pip install -e .
```

### 2. Configure API Key

```bash
# Copy the example config
cp mini_agent/config/config-example.yaml config/config.yaml

# Edit with your API key
nano config/config.yaml
```

```yaml
minimax:
  api_key: sk-cp-your-key-here
  api_base: https://api.minimax.io
```

### 3. Install Web Dependencies

```bash
cd web
npm install
```

---

## 🌐 Web App

The web app provides a modern browser-based interface with React 18, Vite, and Tailwind CSS.

### Run Development Servers

```bash
cd web
npm run dev
```

This starts both:
- **Backend** — FastAPI on `http://localhost:8000`
- **Frontend** — Vite dev server on `http://localhost:3000`

### Build for Production

```bash
cd web/frontend
npm run build
```

### Web App Architecture

```
web/
├── backend/
│   └── main.py              # FastAPI: WebSocket chat, API endpoints, file upload
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── chat/        # ChatPanel with persistent history
│   │   │   ├── coding/      # CodingPanel IDE workspace
│   │   │   ├── media/       # ImagePanel, MusicPanel, VideoPanel, TTSPanel
│   │   │   ├── settings/    # SettingsPanel with Tools toggles
│   │   │   └── MarkdownRenderer.jsx
│   │   └── i18n/            # 6-language i18n config
│   └── vite.config.js       # Vite + proxy config
└── package.json             # Concurrently runs backend + frontend
```

---

## 🖥️ Desktop GUI

A PyQt6 desktop application is also available.

```bash
# Run the GUI
python -m gui.main
# or
mini-agent-gui
```

```bash
# Run the CLI
mini-agent
```

---

## 🗂️ Project Structure

```
minimax-agent-gui/
├── web/                        # Web app (FastAPI + React)
│   ├── backend/main.py         # API endpoints, WebSocket, upload
│   └── frontend/src/           # React components
├── mini_agent/                 # Core agent framework
│   ├── agent.py                # Async agent loop with tool execution
│   ├── cli.py                  # Interactive terminal CLI
│   ├── llm/                    # Anthropic + OpenAI clients
│   └── tools/                  # Bash, File, Note, MCP tools
├── mini_max_mcp/               # MiniMax-specific integrations
│   ├── client.py               # TTS, Image, Video sync/async clients
│   └── mcp_tools.py            # web_search, understand_image
├── tests/                      # pytest suite
├── config/                     # User configuration (gitignored)
├── workspace/                  # Conversations, uploads, outputs
└── examples/                   # Progressive usage examples
```

---

## 💳 Token Plans

All plans include M2.7 access. Choose based on your usage needs.

### Standard Plans

| Feature | Standard | Plus ($20/mo) | Premium ($50/mo) |
|---------|----------|---------------|------------------|
| M2.7 | 1,500 req/5hrs | 4,500 req/5hrs | 15,000 req/5hrs |
| Speech 2.8 | — | 4,000 chars/day | 11,000 chars/day |
| image-01 | — | 50 images/day | 120 images/day |
| Hailuo-2.3-Fast 768P 6s | — | — | 2/day |
| Music-2.5 | — | — | 4 songs/day |

### MCP Tools

| Feature | Availability |
|---------|--------------|
| web_search | Unlimited (with active subscription) |
| understand_image | Unlimited (with active subscription) |

---

## 🔌 API Endpoints

### REST API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/config` | GET/POST | Load/save configuration |
| `/api/config/tools` | POST | Toggle MCP tools |
| `/api/image` | POST | Text-to-image generation |
| `/api/image/i2i` | POST | Image-to-image generation |
| `/api/tts` | POST | Text-to-speech synthesis |
| `/api/music` | POST | Music generation |
| `/api/video` | POST | Video generation |
| `/api/upload` | POST | File upload (returns path) |
| `/api/files` | GET | List files in directory |
| `/api/files/download` | GET | Download/serve a file |
| `/api/conversations` | GET | List saved conversations |
| `/api/minimax/quota` | GET | Check API quota |

### WebSocket

| Endpoint | Description |
|----------|-------------|
| `/ws/chat/{session_id}` | Real-time chat with history |
| `/ws/shell` | Terminal session |

---

## 📝 Changelog

### v0.3.0 — Web App & Persistent Conversations

- **Web App** — New FastAPI + React 18 + Vite + Tailwind interface
- **Persistent Conversations** — Chat and Code panels with auto-save, load, rename, delete
- **Image-to-Image** — Upload reference image or URL for character-consistent variations
- **File Upload** — Attach images and text files to chat (analyzed via VLM)
- **Markdown Copy Buttons** — Copy code blocks with one click
- **Language Filter** — System prompt prevents Chinese character mixing
- **Gallery** — Browse generated images with hover download
- **6-Language i18n** — EN, PT-BR, JA, KO, ES, ZH-CN
- **Tools Toggles** — Settings panel to enable/disable Web Search and Image Understanding

### v0.2.0 — Desktop GUI Expansion

- **Coding Panel** — IDE with file explorer, editor, terminal, git integration
- **Music Panel** — Music-2.5 generation from prompts/lyrics
- **Video Panel** — Hailuo-2.3 text/image-to-video
- **Settings Panel** — Theme, language, model, tools configuration
- **TTS Voices** — Language-filtered voice selection

### v0.1.0 — Initial Release

- **Agent Chat** — Conversational AI with M2.7
- **TTS** — Speech 2.8 synthesis
- **Image Gen** — image-01 text-to-image
- **MCP Tools** — web_search, understand_image
- **PyQt6 GUI** — Dark-themed desktop interface

---

## 📄 License

MIT — see [LICENSE](LICENSE)

---

<div align="center">

Made with ❤️ powered by MiniMax

**[Report Bug](https://github.com/eduardoabreu81/minimax-agent-gui/issues)** • **[Request Feature](https://github.com/eduardoabreu81/minimax-agent-gui/issues)**

</div>
