// vitest.config.js — frontend test config for the Tauri desktop app.
//
// We use jsdom (not happy-dom) because the components we test rely
// on browser APIs (localStorage, window.matchMedia, etc.) that jsdom
// implements more faithfully. The setup file (vitest.setup.js) wires
// @testing-library/jest-dom matchers and stubs i18next so tests don't
// need a real language file.

import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.js'],
    include: ['src/**/*.{test,spec}.{js,jsx}'],
    css: false,  // don't bother parsing Tailwind in tests
  },
})
