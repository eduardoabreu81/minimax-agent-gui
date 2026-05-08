<div align="center">
  <img src="web/frontend/public/favicon.svg" alt="MiniMax Agent" width="64" height="64"/>
</div>

# 🤖 MiniMax Agent

> **Personal AI agent powered by MiniMax M2.7** — Chat, Code, Image, Video, Music, Speech, and MCP tools in a modern web interface.
>
> Built with ❤️ for the MiniMax community.

[![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![Tailwind](https://img.shields.io/badge/Tailwind-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

## Screenshots

| | |
|---|---|
| **Chat & Attachments** — Upload images, toggle tools, persistent history | **Image Generation** — T2I / I2I with aspect ratio picker and gallery |
| **Code Workspace** — File explorer, editor, terminal, and code-chat | **Settings & i18n** — 6 languages, tool toggles, model config |

## Features

- **Responsive Design** — Works seamlessly across desktop, tablet, and mobile
- **Persistent Chat** — Auto-save conversations with load, rename, and delete
- **Code Workspace** — Full IDE with file explorer, editor, terminal, git integration, and code-chat sessions
- **Image Generation** — Text-to-image and image-to-image with 8 aspect ratios, batch generation, and gallery
- **Video Generation** — Hailuo-2.3 text/image-to-video with multiple durations and resolutions
- **Music Generation** — Music-2.5 from prompts or lyrics, instrumental mode, cover from reference audio
- **Text-to-Speech** — Speech 2.8 with 30+ voices, speed control, and streaming playback
- **MCP Tools** — Web search and image understanding toggles, configurable per session
- **Multi-language** — English, Português (BR), 日本語, 한국어, Español, 中文 (简体)
- **Markdown Rendering** — Syntax-highlighted code blocks with one-click copy
- **File Attachments** — Upload images (analyzed via VLM) and text files to chat
- **WebSocket Streaming** — Real-time responses with typing indicators
- **Quota Dashboard** — Track API usage and remaining limits

## Quick Start

### Self-Hosted (Local)

The fastest way to run on your own machine. Requires **Python 3.10+** and **Node.js 18+**.

```bash
git clone https://github.com/eduardoabreu81/minimax-agent-gui.git
cd minimax-agent-gui

# Install Python dependencies (core + backend)
pip install -e .
pip install -r web/backend/requirements.txt

# Install frontend dependencies
cd web && npm install

# Configure your MiniMax API key
cp mini_agent/config/config-example.yaml config/config.yaml
# Edit config/config.yaml with your key
```

```yaml
minimax:
  api_key: sk-cp-your-key-here
  api_base: https://api.minimax.io
```

```bash
# Start both backend and frontend
npm run dev
```

Open `http://localhost:3000` — the app will discover your config automatically.

> Don't have Python or Node? Get them at [python.org](https://python.org) and [nodejs.org](https://nodejs.org).

### CLI Usage

You can also use the agent directly from the terminal without the web UI:

```bash
mini-agent
```

This starts an interactive CLI session with the same tools and configuration.

---

## Which option is right for you?

| | Web App (Self-Hosted) | CLI Only |
|---|---|---|
| **Best for** | Visual interaction with all features | Terminal users, scripting, automation |
| **How you access it** | Browser at `localhost:3000` | Terminal |
| **Setup** | Python + Node install | Python install only |
| **Chat history** | Persistent with UI | Session-based |
| **Image/Video/Music** | Full UI panels | Command-line only |
| **File explorer** | Yes | No |
| **Cost** | Free, open source | Free, open source |

> All options require your own MiniMax API subscription — this project provides the interface, not the AI.

---

## Security & Tools Configuration

**🔒 Important Notice**: MCP tools (Web Search, Image Understanding) are **available but disabled by default** in new sessions.

### Enabling Tools

1. Open **Settings** — Click the gear icon in the sidebar or use `Ctrl+Shift+S`
2. Go to the **Tools** tab
3. Toggle **Web Search** and/or **Image Understanding** as needed
4. Click **Save** — preferences are persisted to `config/config.yaml`

---

## Configuration

| File | Purpose |
|------|---------|
| `config/config.yaml` | API key, region (`global` or `cn`), default model, tool toggles |

Environment variables:

| Variable | Purpose |
|----------|---------|
| `MINIMAX_API_KEY` | Override API key |
| `MINIMAX_API_BASE` | Override base URL |

---

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

### Code Workspace

Switch to the Code tab for a full IDE with file explorer, editor, terminal, and persistent code-chat sessions.

### TTS

Type text, pick a voice, adjust speed, and generate speech.

### Music

Enter a prompt and optional lyrics to generate songs. Enable instrumental mode for background music or upload reference audio for cover generation.

### Video

Describe a scene or upload an image to generate video with progress tracking.

---

## Community & Support

- **Documentation** — This README and AGENTS.md for development details
- **Bug Reports** — [GitHub Issues](https://github.com/eduardoabreu81/minimax-agent-gui/issues)
- **Feature Requests** — [GitHub Issues](https://github.com/eduardoabreu81/minimax-agent-gui/issues)

---

## Acknowledgments

### Built With

- **MiniMax M2.7** — The AI engine powering conversations
- **FastAPI** — Python web framework for the backend
- **React 18** — UI library
- **Vite** — Fast build tool and dev server
- **Tailwind CSS** — Utility-first CSS framework
- **XTerm.js** — Terminal emulator for the code workspace

---

## License

MIT — see [LICENSE](LICENSE)

---

<div align="center">

Made with ❤️ powered by MiniMax

**[Report Bug](https://github.com/eduardoabreu81/minimax-agent-gui/issues)** • **[Request Feature](https://github.com/eduardoabreu81/minimax-agent-gui/issues)**

</div>
