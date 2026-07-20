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
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          // Only split at self-contained package boundaries.
          // NEVER split CJS from its ESM wrapper (e.g., react/ from
          // react/cjs/react.production.min.js) — that breaks imports.
          // These are pure ESM with no CJS re-export chains:
          if (id.includes("lucide-react")) return "vendor-lucide";
          if (id.includes("micromark") || id.includes("remark") || id.includes("react-markdown")) return "vendor-markdown";
          // Separate ESM-only packages from CJS packages to prevent
          // Rollup scope-hoisting TDZ between module formats.
          if (id.includes("/i18next/") || id.includes("/react-i18next/")) return "vendor-i18n";
          if (id.includes("/@radix-ui/") || id.includes("react-remove-scroll") || id.includes("aria-hidden") || id.includes("react-style-singleton") || id.includes("use-callback-ref") || id.includes("use-sidecar") || id.includes("get-nonce") || id.includes("react-focus") || id.includes("tslib")) return "vendor-radix";
          if (id.includes("/@tauri-apps/")) return "vendor-tauri";
          // Everything else stays together (mostly CJS + ESM wrappers)
          return "vendor";
        },
      },
    },
  },
});
