import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Tauri expects a fixed port; fail if it's not available.
// The /api and /ws proxies forward the React frontend's calls
// to the Python sidecar running on port 8765 (see
// desktop/src-tauri/src/lib.rs: start_backend sets PORT=8765).
// The proxy only works in DEV (vite dev). For production, the
// frontend detects the `tauri:` protocol and falls back to
// `invoke('get_backend_url')` — see src/lib/api.js.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: process.env.TAURI_DEV_HOST || false,
    hmr: process.env.TAURI_DEV_HOST
      ? {
          protocol: "ws",
          host: process.env.TAURI_DEV_HOST,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8765",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://127.0.0.1:8765",
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
