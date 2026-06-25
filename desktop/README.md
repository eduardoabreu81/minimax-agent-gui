# MiniMax Agent — Desktop (Tauri)

Professional desktop application for the **MiniMax Agent** platform, built with
**Tauri 2.x + React 18 + shadcn/ui + Tailwind CSS**. Wraps the existing
`web/` FastAPI backend as a sidecar process.

## Stack

- **Tauri 2.x** — Rust shell, ~10MB bundle, WebView2 on Windows / WebKit on macOS
- **React 18** + **TypeScript** + **Vite** — frontend
- **shadcn/ui** + **Tailwind CSS** — design system
- **FastAPI** (sidecar) — runs the existing `web/backend/main.py` as a child process

## Prerequisites (Windows)

| Tool | Why | Install |
|---|---|---|
| **Rust 1.77+** | Tauri shell | `winget install Rustlang.Rustup` |
| **MSVC Build Tools 2022** | `link.exe` + Windows SDK (canonical toolchain for Tauri on Windows) | `winget install Microsoft.VisualStudio.2022.BuildTools` with the "Desktop development with C++" workload |
| **Node 18+** | Frontend tooling | `winget install OpenJS.NodeJS.LTS` |
| **Python 3.10** | Backend sidecar (dev only — the production app bundles a frozen exe via PyInstaller) | `winget install Python.Python.3.10` |
| **WebView2 Runtime** | Web rendering | Pre-installed on Win 10 22H2+ / Win 11 |

> **Why MSVC?**
> Tauri 2's `windows-rs` bindings, the bundled WebView2 loader, and the
> Job Object code that owns the backend sidecar all link against the
> MSVC runtime. Sticking with the MSVC toolchain is the path of least
> resistance on Windows — `rustup default stable-x86_64-pc-windows-msvc`
> and the `desktop/scripts/dev.ps1` helper handle the rest.
>
> **GNU fallback (not recommended):** if you cannot install the
> Build Tools, you can switch to the GNU toolchain with
> `rustup default stable-x86_64-pc-windows-gnu` and add
> `C:\msys64\mingw64\bin` to your PATH. The Job Object path is
> gated by `#[cfg(windows)]` and works on both, but you lose
> the `dev.ps1` helper and may hit `windres` / `dlltool` lookup
> issues with `tauri-winres`.

## Switch Rust to MSVC toolchain (one-time)

```bash
rustup default stable-x86_64-pc-windows-msvc
```

The `desktop/scripts/dev.ps1` helper automatically calls
`vcvars64.bat` from your Build Tools 2022 install before invoking
`cargo`, so the MSVC linker (`link.exe`) and the Windows SDK
are on `PATH` for the duration of the build.

## Development

```bash
cd desktop
npm install
npm run tauri:dev
```

This will:
1. Start Vite dev server on `:1420`
2. Compile the Rust shell
3. Open a native window
4. Spawn the FastAPI sidecar at `127.0.0.1:8765`

## Build installer

```bash
npm run tauri:build
```

Output:
- **Windows:** `src-tauri/target/release/bundle/msi/MiniMax Agent_0.1.0_x64_en-US.msi`
- **Windows NSIS:** `src-tauri/target/release/bundle/nsis/MiniMax Agent_0.1.0_x64-setup.exe`
- **macOS:** `src-tauri/target/release/bundle/dmg/MiniMax Agent_0.1.0_x64.dmg`
- **Linux:** `src-tauri/target/release/{deb,appimage}/...`

## Project layout

```
desktop/
├── src/                  # React frontend
│   ├── components/
│   │   ├── ui/          # shadcn-style primitives (Button, Card, Input, Tabs)
│   │   ├── sidebar/     # Left Experts sidebar
│   │   ├── chat/        # Center chat panel
│   │   └── workpanel/   # Right work panel (Files/Diff/Terminal/Preview)
│   ├── lib/utils.ts     # cn() helper
│   ├── App.tsx          # 3-column shell
│   └── main.tsx
├── src-tauri/
│   ├── src/
│   │   ├── main.rs      # Entry point
│   │   └── lib.rs       # Tauri commands (start_backend, stop_backend, ...)
│   ├── capabilities/    # Permission allowlist
│   ├── icons/           # App icons (TODO: generate)
│   ├── tauri.conf.json  # Window + bundle config
│   ├── Cargo.toml
│   └── build.rs
├── public/
├── index.html
├── package.json
├── tailwind.config.js
├── vite.config.ts
└── tsconfig.json
```

## Phase status

- [x] **Phase 1** — Tauri shell + 3-column layout + FastAPI sidecar boot
- [ ] **Phase 2** — WebSocket chat wired to `web/backend/main.py` `/ws/chat`
- [ ] **Phase 3** — Code Workspace, Image/Music/Video/TTS panels
- [ ] **Phase 4** — Multi-Expert routing, persistent memory
- [ ] **Phase 5** — Auto-update, signed installers

## Why not Electron?

- **Bundle size:** Tauri ~10MB vs Electron ~150MB
- **Memory:** Tauri uses OS WebView (~80MB) vs Electron's bundled Chromium (~400MB)
- **Startup:** Tauri <1s, Electron 2-3s
- **Native feel:** Tauri is built on Rust + OS webviews, not a web page in a window

<!-- AUTOGEN:HELP:START -->

> This section is generated from the in-app Help content by
> `npm run docs`. Edit the markdown under `src/help/`, not here.

## User Guide

- [Getting Started](#getting-started)
- [Chat](#chat)
- [Code Agent](#code-agent)
- [Media Studio](#media-studio)
- [Task Board](#task-board)
- [Settings](#settings)
- [Keyboard Shortcuts](#keyboard-shortcuts)

## Getting Started

MiniMax Agent is a desktop workspace for the MiniMax platform — chat with
expert models, run an autonomous coding agent, generate media, and track
work, all from one window.

### First launch

When the app starts it waits for the local backend to come online (a brief
loading screen), then opens on the **Chat** panel. If a setup wizard
appears, it walks you through connecting your MiniMax account and filling in
your project context.

### The workspace at a glance

- **Sidebar** (left) — switch between Chat, Code, Image, Video, Music,
  Speech, and Tasks. Collapse it with the chevron to reclaim space.
- **Title bar** (top) — app identity and the command palette button.
- **Status bar** (bottom) — the active model and the extended-thinking
  toggle. Whatever you pick here is what the next message uses.
- **Settings & Help** (sidebar footer) — account, models, theme, and this
  help.

### Picking a model

Use the model picker in the status bar to choose which model handles your
next message. Extended thinking is available on `MiniMax-M3`; the toggle is
disabled for models that don't support it.

### Next steps

- Open the **Chat** panel and send your first message.
- Try the **Code Agent** for hands-on coding tasks.
- Press `Ctrl/Cmd + K` to open the command palette from anywhere.

## Chat

The Chat panel is a conversation with MiniMax expert models. Use it for
questions, drafting, analysis, and anything that doesn't need to touch your
filesystem.

### Sending a message

Type in the composer at the bottom and press `Enter` to send (`Shift + Enter`
inserts a newline). The model streams its reply token by token.

### Composer features

- **Slash commands** — type `/` at the start of the composer to open the
  command menu.
- **@-references** — type `@` to attach context (files or other references)
  to your message as chips.
- **Attachments** — add files for the model to read alongside your prompt.

### Model & thinking

The active model and the extended-thinking toggle live in the status bar at
the bottom of the window and are shared with the Code Agent — switching here
affects the next message in either panel.

### Starting fresh

Use the command palette (`Ctrl/Cmd + K`) and choose **New chat** to clear the
conversation and start over.

## Code Agent

The Code Agent (the **Code** panel) is an autonomous coding workspace. Unlike
Chat, it can read and write files and run commands in a real workspace to
carry out multi-step engineering tasks.

### How it works

Describe what you want — a feature, a fix, a refactor — and the agent plans,
edits files, and runs commands to get there. Its progress streams live, with
a todo list showing the steps it's working through.

### The terminal

An integrated terminal shows the commands the agent runs and their output.
This runs against the real backend, so it reflects actual execution rather
than a simulation.

### Model & thinking

Like Chat, the Code Agent uses the model and extended-thinking setting from
the status bar. `MiniMax-M3` with thinking enabled is the strongest option
for complex tasks.

### Tips

- Be specific about the outcome you want and any constraints.
- Review the agent's plan and diffs as they stream in.
- Keep tasks focused — smaller, well-scoped requests run more reliably.

## Media Studio

The media panels turn prompts into images, video, music, and speech using
MiniMax generation models. Each lives in its own sidebar entry.

### Image

Describe the image you want and generate it. Use the character counter to
keep prompts within limits, and download or reuse results.

### Video

Generate short video clips from a prompt. Video generation is the most
compute-intensive feature and may be gated to higher subscription tiers.

### Music

Generate music tracks from a text description of style, mood, and
instrumentation.

### Speech (TTS)

Turn text into spoken audio. Pick a voice and generate narration or replies.

### Credits

Media generation consumes credits. The sidebar's credit widget shows your
current balance and refreshes after each generation completes.

## Task Board

The Task Board (the **Tasks** panel) tracks work items in a simple board so
you can see what's planned, in progress, and done.

### Working with tasks

Create tasks, move them between columns as work progresses, and use the
stats bar to see counts at a glance.

### Why it's here

Long-running agent work and multi-step projects are easier to follow when
the steps are visible. The board gives you a persistent place to capture
that, separate from any single conversation.

## Settings

The Settings panel (sidebar footer) is where you configure your account,
models, and appearance.

### Account & API

Connect your MiniMax account and manage the API configuration the app uses
to reach the platform. Your subscription tier (Plus / Max / Ultra) is
detected here and controls which features are available.

### Models

Review the available models. The default model for new messages is chosen in
the status bar, but model-related preferences live here.

### Appearance

Switch between light and dark themes. Some themes include extra visual
effects that you can toggle on or off.

### Language

The interface is available in several languages. Changing the language also
switches this help content to the matching language where a translation
exists, falling back to English otherwise.

### Project context

The Agent Context system lets you describe your project once so the agent has
the background it needs. You can open it from the setup wizard or the context
banner.

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl / Cmd + K` | Open the command palette |
| `F1` or `?` | Open Help |
| `Enter` | Send the current message |
| `Shift + Enter` | New line in the composer |
| `/` | Slash commands (start of composer) |
| `@` | Attach a context reference |

### Command palette

The command palette (`Ctrl/Cmd + K`) is the fastest way to navigate and run
actions — jump to any panel, start a new chat, open settings, or toggle the
theme without leaving the keyboard.

<!-- AUTOGEN:HELP:END -->
