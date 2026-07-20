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
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('micromark')) {
              return 'vendor-micromark';
            }
            if (id.includes('xterm')) {
              return 'vendor-xterm';
            }
            if (id.includes('lucide-react') || id.includes('lucide-static')) {
              return 'vendor-lucide';
            }
            if (id.includes('i18next') || id.includes('react-i18next')) {
              return 'vendor-i18n';
            }
            if (id.includes('react-markdown') || id.includes('remark-') || id.includes('unified') || id.includes('hast') || id.includes('mdast') || id.includes('vfile') || id.includes('bail') || id.includes('trough') || id.includes('trim-lines')) {
              return 'vendor-markdown';
            }
            return 'vendor';
          }
        },
      },
    },
  },
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
