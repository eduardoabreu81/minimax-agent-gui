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
