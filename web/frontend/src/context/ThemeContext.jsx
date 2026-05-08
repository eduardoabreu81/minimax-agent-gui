import { createContext, useContext, useState, useEffect, useCallback } from 'react'

const ThemeContext = createContext({
  theme: 'default',
  isDark: true,
  mode: 'system',
  matrixEffect: false,
  setTheme: () => {},
  setMode: () => {},
  toggleDark: () => {},
  toggleMatrixEffect: () => {},
  themes: [],
})

export const THEMES = [
  { id: 'default', name: 'Default', color: 'bg-blue-500', preview: { lightBg: '#f1f5f9', lightText: '#2563eb', darkBg: '#0f172a', darkText: '#60a5fa' } },
  { id: 'ocean', name: 'Ocean', color: 'bg-cyan-500', preview: { lightBg: '#ecfeff', lightText: '#06b6d4', darkBg: '#083344', darkText: '#22d3ee' } },
  { id: 'forest', name: 'Forest', color: 'bg-green-700', preview: { lightBg: '#f4f7f5', lightText: '#4a6741', darkBg: '#1a2417', darkText: '#7a9e72' } },
  { id: 'rose', name: 'Rose', color: 'bg-rose-500', preview: { lightBg: '#fff1f2', lightText: '#e11d48', darkBg: '#4c0519', darkText: '#fb7185' } },
  { id: 'sunset', name: 'Sunset', color: 'bg-orange-500', preview: { lightBg: '#fff7ed', lightText: '#f97316', darkBg: '#431407', darkText: '#fb923c' } },
  { id: 'berry', name: 'Berry', color: 'bg-purple-500', preview: { lightBg: '#faf5ff', lightText: '#9333ea', darkBg: '#3b0764', darkText: '#c084fc' } },
  { id: 'midnight', name: 'Midnight', color: 'bg-indigo-500', preview: { lightBg: '#eef2ff', lightText: '#4f46e5', darkBg: '#1e1b4b', darkText: '#818cf8' } },
  { id: 'minimax', name: 'MiniMax', color: 'bg-red-600', preview: { lightBg: '#fef2f2', lightText: '#dc2626', darkBg: '#450a0a', darkText: '#ef4444' } },
  { id: 'matrix', name: 'Matrix', color: 'bg-green-600', preview: { lightBg: '#f0fdf4', lightText: '#15803d', darkBg: '#052e16', darkText: '#4ade80' } },
]

function getSystemDark() {
  if (typeof window === 'undefined') return true
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    try { return localStorage.getItem('app-theme') || 'default' } catch { return 'default' }
  })
  const [mode, setModeState] = useState(() => {
    try { return localStorage.getItem('app-mode') || 'system' } catch { return 'system' }
  })
  const [matrixEffect, setMatrixEffect] = useState(() => {
    try { return localStorage.getItem('matrix-effect') === 'true' } catch { return false }
  })

  const isDark = mode === 'system' ? getSystemDark() : mode === 'dark'

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    if (isDark) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
    try {
      localStorage.setItem('app-theme', theme)
      localStorage.setItem('app-mode', mode)
    } catch {}
  }, [theme, isDark, mode])

  // Listen for system theme changes when in system mode
  useEffect(() => {
    if (mode !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = () => {
      if (mq.matches) {
        document.documentElement.classList.add('dark')
      } else {
        document.documentElement.classList.remove('dark')
      }
    }
    mq.addEventListener('change', handleChange)
    return () => mq.removeEventListener('change', handleChange)
  }, [mode])

  const setTheme = useCallback((newTheme) => {
    if (THEMES.find(t => t.id === newTheme)) setThemeState(newTheme)
  }, [])

  const setMode = useCallback((newMode) => {
    if (['light', 'dark', 'system'].includes(newMode)) setModeState(newMode)
  }, [])

  const toggleDark = useCallback(() => {
    setModeState(prev => {
      const next = prev === 'dark' ? 'light' : 'dark'
      return next
    })
  }, [])

  const toggleMatrixEffect = useCallback(() => {
    setMatrixEffect(prev => {
      const next = !prev
      try { localStorage.setItem('matrix-effect', String(next)) } catch {}
      return next
    })
  }, [])

  return (
    <ThemeContext.Provider value={{
      theme, isDark, mode, matrixEffect,
      setTheme, setMode, toggleDark, toggleMatrixEffect,
      themes: THEMES,
    }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => useContext(ThemeContext)
