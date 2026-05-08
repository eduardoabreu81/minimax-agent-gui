import { createContext, useContext, useState, useEffect } from 'react'

const ThemeContext = createContext({
  theme: 'default',
  isDark: true,
  matrixEffect: false,
  setTheme: () => {},
  toggleDark: () => {},
  toggleMatrixEffect: () => {},
  themes: [],
})

export const THEMES = [
  { id: 'default', name: 'Default', color: 'bg-blue-500' },
  { id: 'ocean', name: 'Ocean', color: 'bg-cyan-500' },
  { id: 'forest', name: 'Forest', color: 'bg-green-500' },
  { id: 'rose', name: 'Rose', color: 'bg-rose-500' },
  { id: 'sunset', name: 'Sunset', color: 'bg-orange-500' },
  { id: 'berry', name: 'Berry', color: 'bg-purple-500' },
  { id: 'midnight', name: 'Midnight', color: 'bg-indigo-500' },
  { id: 'minimax', name: 'MiniMax', color: 'bg-red-500' },
  { id: 'matrix', name: 'Matrix', color: 'bg-green-600' },
]

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    try { return localStorage.getItem('app-theme') || 'default' } catch { return 'default' }
  })
  const [isDark, setIsDark] = useState(() => {
    try { return localStorage.getItem('app-dark') !== 'false' } catch { return true }
  })
  const [matrixEffect, setMatrixEffect] = useState(() => {
    try { return localStorage.getItem('matrix-effect') === 'true' } catch { return false }
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    if (isDark) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
    try {
      localStorage.setItem('app-theme', theme)
      localStorage.setItem('app-dark', String(isDark))
    } catch {}
  }, [theme, isDark])

  const setTheme = (newTheme) => {
    if (THEMES.find(t => t.id === newTheme)) setThemeState(newTheme)
  }

  const toggleDark = () => setIsDark(prev => !prev)
  const toggleMatrixEffect = () => {
    setMatrixEffect(prev => {
      const next = !prev
      try { localStorage.setItem('matrix-effect', String(next)) } catch {}
      return next
    })
  }

  return (
    <ThemeContext.Provider value={{ theme, isDark, matrixEffect, setTheme, toggleDark, toggleMatrixEffect, themes: THEMES }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => useContext(ThemeContext)
