# Contributing to MiniMax Agent

Thanks for your interest in contributing. This document covers the **development workflow** — for the public-facing product documentation, see [README.md](README.md). For architecture decisions, conventions, and gotchas, see [AGENTS.md](AGENTS.md).

> If you're **using** MiniMax Agent and want to install the app, you don't need this page — go to the [latest release](https://github.com/<owner>/minimax-agent-gui/releases/latest) and grab the installer.

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| **Python** | 3.10+ | Use `py -3.10` on Windows if you have multiple Pythons on PATH. The PyInstaller sidecar is built against 3.10. |
| **Node.js** | 18+ | Vite 5 + React 18 toolchain. |
| **Rust** | stable | Install via [rustup](https://rustup.rs/). Tauri 2.1 + the system WebView (WebView2 on Windows, WebKitGTK on Linux, WebKit on macOS). |
| **Tauri CLI** | `cargo install tauri-cli --version "^2.0"` | Only needed for `tauri build` (production); `npm run tauri:dev` uses the bundled version. |
| **Git** | recent | For cloning and pre-commit hooks (none enforced, but recommended). |

### OS-specific deps

- **Linux** — `sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf build-essential`
- **macOS** — Xcode Command Line Tools (`xcode-select --install`)
- **Windows** — Microsoft Visual Studio Build Tools with the "Desktop development with C++" workload (MSVC toolchain is **already installed** on the project's reference machine — don't reinstall)

## First-time setup

```bash
# 1. Clone
git clone https://github.com/<owner>/minimax-agent-gui.git
cd minimax-agent-gui

# 2. Python deps (root: the reusable agent library)
pip install -e .
pip install -r web/backend/requirements.txt

# 3. Desktop deps (frontend + Tauri shell)
cd desktop
npm install
cd ..

# 4. (Optional) playwright deps if you'll be regenerating docs
cd desktop
npx playwright install chromium
```

## Dev workflow

`npm run tauri:dev` is the single command that boots everything in dev mode:

```bash
cd desktop
npm run tauri:dev
```

What it does:

- Spawns **Vite** on `http://localhost:1420` for the React frontend (hot module reload)
- Spawns **`backend.exe`** (the PyInstaller-bundled FastAPI) on `http://localhost:8765` automatically via the Tauri shell
- The Tauri webview points at the Vite dev server; the Vite proxy forwards `/api` and `/ws` to the sidecar

The first run compiles the Rust deps from scratch (~3–5 minutes). Subsequent runs are fast — Vite HMR picks up React changes instantly, and Rust only rebuilds when files under `src-tauri/` change.

### Iteration patterns

- **Frontend only** — `cd desktop && npm run dev` (just Vite, no Tauri). Faster, but you lose the IPC bridge — most panels still work because they hit the sidecar directly via `apiFetch`.
- **Backend only** — `cd web/backend && python main.py` (FastAPI standalone, port 8765). Use `web/backend/main.py > get_app_workspace_dir` to point at a temp workspace if you don't want to touch the user's.
- **Rust only** — `cd desktop/src-tauri && cargo check` (type-check) or `cargo clippy` (lint).
- **Re-build the sidecar** — `cd web/backend && pyinstaller --onefile --name backend main.py --distpath ../desktop/src-tauri/binaries`. Only needed when you change Python deps; in dev, the sidecar is loaded from the existing bundle, so Python changes don't hot-reload.

## Tests

```bash
# Frontend (Vitest)
cd desktop && npm test

# Backend (pytest, requires py -3.10 on Windows)
py -3.10 -m pytest tests/

# Rust lint
cd desktop/src-tauri && cargo clippy
```

The frontend test suite uses Vitest + jsdom + @testing-library. Tests live next to source as `*.test.{ts,tsx,jsx}`. Mocks go in `vitest.setup.js`.

The backend suite is `pytest` + `pytest-asyncio`. Some tests require a live API key in `config/config.yaml`; unit tests for tools run without one. **Use `py -3.10` on Windows** — the hermes venv is on 3.10; calling plain `pytest` from a 3.11 venv produces ~16 spurious failures.

## Build a production installer

```bash
cd desktop
npm run tauri:build
```

Produces native installers in `desktop/src-tauri/target/release/bundle/`:

| OS | Output |
|---|---|
| **Windows** | `.msi` (WiX) + NSIS `.exe` |
| **macOS** | `.dmg` + `.app` bundle |
| **Linux** | `.AppImage` + `.deb` |

To exercise the auto-updater pipeline locally, build → install → bump `desktop/package.json` + `desktop/src-tauri/tauri.conf.json` versions → rebuild → push a `v*` tag → the running app should detect the update on next Check.

## Releases

Releases are driven by GitHub Actions (`.github/workflows/release.yml`). Pushing a `v*` tag triggers a matrix build (ubuntu/windows/macos), signs the bundles with `TAURI_SIGNING_PRIVATE_KEY`, and uploads everything as a GitHub Release. See `AGENTS.md > Auto-updater` for the full setup, including generating the signing key.

## Project conventions

- **Python** — PEP 8, Python 3.10+ union syntax (`str | None`), triple-double-quote docstrings, snake_case functions, PascalCase classes, `logging.getLogger(__name__)`, tools return `ToolResult(success=False, error=...)` rather than raising.
- **TypeScript / React** — match the existing patterns; prefer `function` declarations for components, hooks at the top of the function body, Tailwind utility classes (no inline `style={{}}` for colors — use theme tokens).
- **Commits** — Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, etc). Local during dev, pushed only after visual validation.
- **i18n** — 6 locales (en, pt-BR, es, ja, ko, zh-CN). New user-facing strings go in all 6. The `i18next` config pins single-curly placeholders (`{name}`), not the v23+ mustache default.

Read **[AGENTS.md](AGENTS.md)** before opening a PR — it's the canonical guide and lists every "common pitfall" worth knowing about this codebase.

## Filing issues

When filing a bug, please include:

- OS + version (Windows 10/11, macOS 14, Ubuntu 24.04, etc)
- App version (Settings → About)
- Reproduction steps (what you did, what you expected, what happened)
- Backend logs if relevant (`workspace/logs/`)
- Screenshots / screen recordings when applicable

## License

MIT — see [LICENSE](LICENSE). By contributing, you agree your contributions are licensed under MIT.