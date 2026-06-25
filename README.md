<div align="center">

<img src="docs/assets/minimax-agent-gui-banner.png" alt="MiniMax Agent" width="100%" />

# MiniMax Agent ☄

**The all-in-one desktop workspace for MiniMax M3.** Chat, code, generate image / video / music / speech, run skills and MCP tools, and let an autonomous agent carry the work across sessions — in one self-updating Tauri app.

[![Tauri](https://img.shields.io/badge/Tauri-2.1-FFC131?style=for-the-badge&logo=tauri&logoColor=white)](https://tauri.app/)
[![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=white)](https://react.dev/)
[![FastAPI](https://img.shields.io/badge/FastAPI-Python-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![License](https://img.shields.io/badge/License-MIT-22c55e?style=for-the-badge)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.4.0-3b82f6?style=for-the-badge)](CHANGELOG.md)

**[⬇ Download](https://github.com/eduardoabreu81/minimax-agent-gui/releases)** ·
**[📖 User Guide](docs/USER_GUIDE.md)** ·
**[🗺️ Roadmap](#-roadmap)** ·
**[🐛 Report a Bug](https://github.com/eduardoabreu81/minimax-agent-gui/issues)**

</div>

---

MiniMax Agent puts the whole MiniMax platform behind a single native window. It talks to **MiniMax M3** with a 1M-token context and a thinking block streamed live next to the reply, runs an autonomous **code agent** in a real workspace, generates media, and remembers who you are between sessions through a small set of `.agent/*.md` files. The backend is a bundled FastAPI sidecar — no CLI to install, no browser tabs, no separate web app.

> **Heads up:** this is a desktop-first app. The Tauri shell is the only installable interface — everything (chat, media, code, settings) lives in one window that updates itself from signed GitHub releases.

## ✨ Features

<table>
<tr>
<td width="50%" valign="top">

### 🧠 Chat with M3
1M-token context with native image and video input. The adaptive **thinking block** streams live alongside the answer. Per-turn model picker and thinking toggle, file attachments, `@`-ref autocomplete, and conversation search — all from one **Composer** shared with the Code panel.

</td>
<td width="50%" valign="top">

### 💻 Code Agent
A real workspace: file explorer, editor, and an integrated **xterm.js** terminal. Three execution modes — **Agent** (approve risky tools), **Plan** (edit the plan first), **YOLO** (hands-off). Live step-by-step activity stream.

</td>
</tr>
<tr>
<td width="50%" valign="top">

### 🎬 Media Studio
**Image** (text-to-image + subject reference), **Video** (Hailuo text/image-to-video), **Music** (prompt or full lyrics, cover from reference), and **Speech** (30+ voices, voice clone, voice design). Each panel keeps a *Recent Generations* gallery.

</td>
<td width="50%" valign="top">

### 🧠 Agent Memory
`SOUL / IDENTITY / USER / MEMORY` files persist the agent's personality and context across sessions, plus a daily session log. A `memory` tool lets long-running agents write back without losing the thread.

</td>
</tr>
<tr>
<td width="50%" valign="top">

### 🔌 Skills & MCP
Built-in web search and image understanding. Bring-your-own MCP servers (stdio / SSE) from Settings. Reusable **skills** as slash-command templates, merged from a multi-source loader.

</td>
<td width="50%" valign="top">

### 📋 Task Board
When the agent plans multi-step work, todos appear in a board — **locked** while running, marked **done** only after the agent verifies. A live counter shows progress; tasks survive reloads.

</td>
</tr>
<tr>
<td width="50%" valign="top">

### 🔄 Self-updating
`tauri-plugin-updater` pulls signed releases from GitHub. Settings → About → **Check for updates**, then click *Restart*. That's it.

</td>
<td width="50%" valign="top">

### 🌍 6 Languages
English, Português (BR), Español, 日本語, 한국어, 中文 — UI **and** in-app help. Press `F1` or `?` anywhere for context-aware documentation.

</td>
</tr>
</table>

## 📸 A look inside

<img src="desktop/docs/screenshots/chat.png" alt="Chat with M3 — thinking block streamed alongside the reply" width="100%" />

<table>
<tr>
<td><img src="desktop/docs/screenshots/coding.png" alt="Code Agent" /></td>
<td><img src="desktop/docs/screenshots/image.png" alt="Media Studio — Image" /></td>
</tr>
<tr>
<td align="center"><sub><b>Code Agent</b></sub></td>
<td align="center"><sub><b>Media Studio</b></sub></td>
</tr>
</table>

> 📖 Full walkthroughs of every panel are in the **[User Guide](docs/USER_GUIDE.md)** — generated from the same markdown as the in-app Help, available in all six languages.

## ⚡ Quick Start

You install the app like any other desktop application — there's nothing to compile, no environment to set up, and no CLI to install.

### 1. Download

Grab the installer for your platform from the [latest release](https://github.com/eduardoabreu81/minimax-agent-gui/releases/latest):

| OS | File |
|---|---|
| **Windows** (x64) | `MiniMax-Agent_x.x.x_x64-setup.exe` |
| **macOS** (Apple Silicon + Intel) | `MiniMax-Agent_x.x.x_universal.dmg` |
| **Linux** (x64) | `MiniMax-Agent_x.x.x_amd64.AppImage` or `.deb` |

### 2. Install

- **Windows** — double-click the `.exe`, follow the wizard
- **macOS** — open the `.dmg`, drag **MiniMax Agent** into **Applications**
- **Linux** — `chmod +x MiniMax-Agent_*.AppImage && ./MiniMax-Agent_*.AppImage`, or `sudo dpkg -i MiniMax-Agent_*.deb`

### 3. Open & set up

The first launch walks you through connecting your **MiniMax API key** (get one at [platform.minimax.io](https://platform.minimax.io)). The key is stored locally in `config/config.yaml` (gitignored) and never leaves your machine.

### 4. Stay up to date

Future versions roll out automatically — **Settings → About → Check for updates** pulls signed releases from GitHub and prompts a restart. No manual download required.

## 🏗️ Architecture

```
┌────────────────────────────────────────────────────────────┐
│                      Tauri shell (Rust)                     │
│  ┌──────────────────────┐   ┌───────────────────────────┐  │
│  │   React frontend     │   │   Bundled sidecar         │  │
│  │   Vite + Tailwind    │◄──┤   FastAPI + Python        │  │
│  │   (localhost:1420)   │   │   (localhost:8765)        │  │
│  └──────────────────────┘   └───────────────────────────┘  │
│          ▲                            ▲                     │
│          │ tauri-plugin-updater       │ direct HTTP         │
│          │ (signed GitHub releases)   │ (no CLI)            │
└────────────────────────────────────────────────────────────┘
```

| Layer | Where | What |
|---|---|---|
| **Frontend** | `desktop/src/` | React 18 + Vite + Tailwind, single SPA with tab routing |
| **Backend** | `web/backend/` | FastAPI + WebSocket streaming; all MiniMax calls via direct HTTP |
| **Agent** | `mini_agent/` | Async agent loop, tool execution, token summarization |
| **Sidecar** | `desktop/src-tauri/` | PyInstaller-bundled FastAPI, built per-platform |

The shell auto-spawns the sidecar on launch; in dev, the Vite proxy forwards `/api` and `/ws` to the local backend.

## ⚙️ Configuration

| File | Purpose |
|---|---|
| `config/config.yaml` | API key, region, default model, MCP servers, skills dirs (gitignored — secrets stay local) |
| `desktop/src-tauri/tauri.conf.json` | Window, bundle targets, updater pubkey/endpoints, sidecar path |
| `desktop/src/i18n/*.json` | The six locale files |

Environment variables override the config: `MINIMAX_API_KEY` and `MINIMAX_API_BASE`.

## 🔄 Updates

The app updates itself. **Settings → About → Check for updates** polls GitHub Releases; when a newer signed version is available it downloads in the background and prompts you to restart. No manual download required.

## 🗺️ Roadmap

**Shipped (v0.4.0 — desktop-first):**
Tauri 2 shell · full Speech stack (clone + design) · Settings index rail · live Status Bar · multi-source Skills · Agent Context (`.agent/*.md`) · shared Composer · Task Board · subdirectory hints · auto-updater · bilingual in-app Help.

**Next:**
- [ ] Personality presets (concise / friendly / mentor / expert / creative)
- [ ] `CLAUDE.md` / `.cursorrules` startup loading
- [ ] Quota Dashboard refinements
- [ ] First fully-signed GitHub Release, end to end

## 📖 Documentation

- **[User Guide](docs/USER_GUIDE.md)** — full walkthrough of every panel, generated from the in-app Help.
- **In-app Help** — press `F1` or `?` anywhere (when not typing), in any of the six languages.
- **[AGENTS.md](AGENTS.md)** — the canonical guide for AI agents working on this codebase.

## 🤝 Contributing

Issues and PRs are welcome at [github.com/eduardoabreu81/minimax-agent-gui/issues](https://github.com/eduardoabreu81/minimax-agent-gui/issues).

- **Want to hack on the app?** [CONTRIBUTING.md](CONTRIBUTING.md) has the full dev setup — prerequisites, dev workflow, build pipeline, tests, and conventions.
- **Architecture, gotchas, and the canonical guide for AI agents** live in [AGENTS.md](AGENTS.md).

## 📜 License

MIT — see [LICENSE](LICENSE).

---

<div align="center">
<sub>Made with care for the MiniMax community · Powered by <b>MiniMax M3</b></sub>
</div>
