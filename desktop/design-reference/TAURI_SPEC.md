# MiniMax Studio — Tauri Native Shell Spec

Implementation notes to turn the existing **web frontend** (`web/frontend`, React + Vite + Tailwind) into a native desktop app with the look defined in `MiniMax Studio.dc.html`. The mockup is the visual source of truth; this doc maps it onto your real codebase.

---

## 1. Window & titlebar

The pro look comes from **replacing the OS titlebar with a custom one** (the 44px bar in the mockup).

`src-tauri/tauri.conf.json`:
```jsonc
{
  "app": {
    "windows": [{
      "title": "MiniMax Studio",
      "width": 1320, "height": 860,
      "minWidth": 1040, "minHeight": 640,
      "decorations": false,        // we draw our own titlebar
      "transparent": false,
      "titleBarStyle": "Overlay"   // macOS; ignored on Windows
    }]
  }
}
```

- **Windows controls live on the RIGHT** (matches mockup): minimize / maximize / close, 46×44px each, close hover `#e81123`. Wire them to:
  ```js
  import { getCurrentWindow } from '@tauri-apps/api/window'
  const w = getCurrentWindow()
  w.minimize(); w.toggleMaximize(); w.close()
  ```
- **Drag region**: add `data-tauri-drag-region` to the titlebar container and its non-interactive children. Interactive items (command pill, model selector, status chip, window buttons) must NOT have it, or set `style="-webkit-app-region:no-drag"` equivalents.
- Disable text selection on the bar (`user-select:none`).
- Double-click on the drag region should toggle-maximize (Tauri does this automatically for `data-tauri-drag-region`).

### Titlebar contents (left → right)
1. App mark + `MiniMax Studio` + workspace breadcrumb (`minimax-agent-gui`) + git branch chip.
2. Center: **command pill** → opens existing `CommandPalette` (`Ctrl/Cmd+K` already wired in `App.jsx`). Just trigger `setPaletteOpen(true)`.
3. Right: **agent status chip** (bind to `AgentActivityContext` — running/idle/error), **model selector** (reuse `useSelectedModel` / `ModelThinkingControls`), divider, window controls.

---

## 2. Theme system — keep all 9 themes

The mockup reproduces your exact `themes.css` tokens (9 themes × light/dark) and applies them as CSS custom properties. **No change needed to your real theme layer** — `ThemeContext.jsx` + `themes.css` already do this via `data-theme` + `.dark`. The mockup proves every screen reads only from the tokens, so theme switching stays instant and global.

Token reference (HSL triples, used as `hsl(var(--x))`): `--background --foreground --card --primary --primary-foreground --secondary --muted-foreground --border --surface --success --error`. Native window chrome should also follow the theme — set the Tauri window background to `--background` so there's no white flash on launch:
```js
// on theme change
getCurrentWindow().setTheme(isDark ? 'dark' : 'light')
```

---

## 3. Screen → component mapping

| Mockup screen | Your component | Notes |
|---|---|---|
| Shell (sidebar + titlebar) | `App.jsx` + `Sidebar.jsx` | Add the custom titlebar above `<main>`; sidebar nav unchanged. Mockup widens nav to 236px, comfortable density. |
| Chat | `components/chat/ChatPanel.jsx` | Thinking block = `ThinkingBlock.jsx`; composer keeps model + thinking toggles. |
| Code Workspace | `components/coding/CodingPanel.jsx` (+ `WorkspaceSidebar`, `XTermTerminal`, `AgentChatPanel`) | The hero. 3-pane: explorer / editor+terminal / agent. Agent/Plan/YOLO toggle + permission-approval card already exist. |
| Image / Video / Music / Speech | `components/media/*` | Shared left-controls + right-gallery layout. `RecentGenerations` feeds the grid. |
| Tasks | `components/taskboard/TaskBoard.jsx` | Kanban: To Do / In Progress / Done. |
| Settings | `components/settings/SettingsModal.jsx` | Mockup shows it as a full page; keep as modal OR promote to a routed panel. Theme grid = `THEMES` from `ThemeContext`. |
| Command palette | `components/command-palette/CommandPalette.jsx` | Already `Ctrl+K`. |

---

## 4. Density & spacing (from mockup)

- Sidebar: 236px, nav items 9px/12px padding, 13px font, active = `primary/13%` bg + 2px inset left bar.
- Titlebar 44px; window control buttons 46×44.
- Cards: radius 11–14px, 1px `--border`, `--card` bg.
- Body font Inter; code/terminal JetBrains Mono. Min UI font 11px (chips), body 13–14px.
- Agent panel 380px; file explorer 230px.

---

## 5. Build wiring

- Add Tauri: `npm create tauri-app` into `web/`, or add `@tauri-apps/cli` and point `build.frontendDist` at Vite's `dist`, `build.devUrl` at `http://localhost:3000`.
- The FastAPI backend (`web/backend`) stays a separate process. Either: (a) ship it as a Tauri **sidecar** (`bundle.externalBin`) and spawn on startup, or (b) keep `npm run dev` for local. The frontend already calls `/api/...` — keep that base or expose backend port via env.
- CSP in `tauri.conf.json` must allow your backend origin and `fonts.googleapis.com` / `fonts.gstatic.com` (or self-host Inter + JetBrains Mono to avoid the network dependency — recommended for an offline-capable desktop app).

---

## 6. Nice-to-haves matching the mockup

- Native window background = theme `--background` (no launch flash).
- Persist sidebar collapsed + active tab + theme in `localStorage` (already done) — survives across launches.
- Agent status chip pulse animation (`@keyframes mmpulse`) ties to live agent activity.
- Consider `tauri-plugin-window-state` to remember window size/position.
