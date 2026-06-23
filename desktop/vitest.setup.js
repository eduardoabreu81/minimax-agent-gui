// vitest.setup.js — runs before each test file.
//
// - Wires @testing-library/jest-dom matchers (toBeInTheDocument etc.)
// - Stubs i18next so components can call t() without a real i18n
//   bundle. The t() function returns the key, so tests can assert
//   on the key value (or override per-test via vi.mocked).
// - Cleans up the DOM + localStorage between tests.

import '@testing-library/jest-dom/vitest'
import { vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Mock i18n BEFORE components import useTranslation. The default
// t() returns the key (with param substitution) so tests can assert
// on the key directly.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, params) => {
      if (params && typeof params === 'object') {
        return Object.entries(params).reduce(
          (s, [k, v]) => s.replace(`{${k}}`, String(v)),
          key,
        )
      }
      return key
    },
    i18n: { changeLanguage: vi.fn(), language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  Trans: ({ children }) => children,
}))

afterEach(() => {
  cleanup()
  if (typeof localStorage !== 'undefined') {
    localStorage.clear()
  }
})
