import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { ThemeProvider } from './context/ThemeContext'
import './i18n'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import '@fontsource/jetbrains-mono/600.css'
import './index.css'

// Global error handler for debugging
window.onerror = (msg, url, line, col, err) => {
  const debug = document.getElementById('debug-fallback')
  const msgEl = document.getElementById('debug-msg')
  if (debug && msgEl) {
    debug.style.display = 'flex'
    debug.style.background = '#300'
    debug.style.color = '#f55'
    msgEl.innerHTML = `<b>JS Error:</b><br>${msg}<br>at ${url}:${line}:${col}<br><br>Check DevTools (F12) → Console for full stack.`
  }
  console.error('Global error:', msg, err)
}

window.onunhandledrejection = (e) => {
  const debug = document.getElementById('debug-fallback')
  const msgEl = document.getElementById('debug-msg')
  if (debug && msgEl) {
    debug.style.display = 'flex'
    debug.style.background = '#300'
    debug.style.color = '#f55'
    msgEl.innerHTML = `<b>Promise Rejection:</b><br>${e.reason}<br><br>Check DevTools (F12) → Console.`
  }
  console.error('Unhandled rejection:', e.reason)
}

const root = document.getElementById('root')
if (!root) {
  document.body.innerHTML = '<div style="color:red;padding:20px;">Error: #root not found</div>'
} else {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </React.StrictMode>,
  )
}
