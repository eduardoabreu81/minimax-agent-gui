// src/lib/api.js
//
// Single source of truth for backend URLs in the React frontend.
//
// In **Tauri production** (window.location.protocol === 'tauri:'),
// the React window is loaded from a custom protocol and Vite's dev
// proxy is not running. We must hit the sidecar's absolute URL
// (PORT=8765, see desktop/src-tauri/src/lib.rs). The Tauri command
// `get_backend_url` returns the canonical origin.
//
// In **Tauri dev** (tauri dev) and in **plain web dev** (npm run dev
// in web/frontend), Vite serves the React app from http://localhost
// and the Vite proxy in vite.config.js forwards /api and /ws to the
// Python backend. A relative path is enough.
//
// This module is loaded in BOTH the desktop/ and web/frontend/ trees
// (kept in sync). The web build does NOT install @tauri-apps/api, so
// the import has to be lazy and the call guarded.

const IS_TAURI =
  typeof window !== "undefined" && window.location?.protocol === "tauri:";

// Lazy import so the web build (no @tauri-apps/api installed) does
// not crash. If anything goes wrong, we fall back to a relative path
// and let the caller surface a network error.
let invokePromise = null;
async function tryInvoke(command, args) {
  if (!IS_TAURI) return null;
  if (invokePromise === null) {
    invokePromise = (async () => {
      try {
        // Build the specifier at runtime so Rollup/Vite cannot
        // resolve it statically. The web build does not have
        // @tauri-apps/api installed (only the desktop Tauri build
        // does), so a static import would fail.
        const specifier = "@tauri" + "-apps/api/core";
        const mod = await import(/* @vite-ignore */ specifier);
        return mod.invoke;
      } catch (err) {
        // Module not installed or invoke unavailable. Treat as no-Tauri.
        // eslint-disable-next-line no-console
        console.warn(
          "[api] @tauri-apps/api not available, falling back to relative URLs:",
          err,
        );
        return null;
      }
    })();
  }
  const invoke = await invokePromise;
  if (!invoke) return null;
  try {
    return await invoke(command, args);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[api] invoke('${command}') failed:`, err);
    return null;
  }
}

/**
 * Resolve the absolute URL for a backend path.
 *
 * @param {string} path - must start with "/" (e.g. "/api/minimax/quota")
 * @returns {Promise<string>} absolute URL string
 */
export async function apiUrl(path) {
  if (!IS_TAURI) return path;
  const base = await tryInvoke("get_backend_url");
  // Fallback: hardcoded port matching desktop/src-tauri/src/lib.rs.
  // Better than failing the request when the user is on `tauri://`
  // but the IPC bridge is somehow unreachable.
  const origin = base || "http://127.0.0.1:8765";
  return `${origin}${path}`;
}

/**
 * Fetch wrapper that mirrors the global `fetch` signature but routes
 * the URL through `apiUrl` so the same call works in dev (vite
 * proxy) and in Tauri production (absolute URL).
 */
export async function apiFetch(path, init) {
  const url = await apiUrl(path);
  return fetch(url, init);
}

/**
 * Build a WebSocket URL. Mirrors `apiUrl` but swaps the scheme.
 *
 * @param {string} path - e.g. "/ws/chat/<sid>"
 */
export async function apiWebSocketUrl(path) {
  if (!IS_TAURI) {
    // Dev: Vite proxy rewrites ws://localhost:<devport>/ws → ws://127.0.0.1:8765/ws
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}${path}`;
  }
  const base = await tryInvoke("get_backend_url");
  const origin = base || "http://127.0.0.1:8765";
  // base looks like "http://127.0.0.1:8765"; swap http→ws, https→wss.
  const wsOrigin = origin.replace(/^http/, "ws");
  return `${wsOrigin}${path}`;
}

export const isTauri = IS_TAURI;
