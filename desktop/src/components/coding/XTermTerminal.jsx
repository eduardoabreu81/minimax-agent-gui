import { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { Power, RotateCcw, Wifi, WifiOff } from 'lucide-react'

export default function XTermTerminal({ onReady }) {
  const containerRef = useRef(null)
  const terminalRef = useRef(null)
  const fitAddonRef = useRef(null)
  const wsRef = useRef(null)
  const [isConnected, setIsConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [shellName, setShellName] = useState('')

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    setIsConnecting(true)
    const ws = new WebSocket(`ws://${window.location.host}/ws/shell`)
    wsRef.current = ws

    ws.onopen = () => {
      setIsConnected(true)
      setIsConnecting(false)
      // Focus terminal
      setTimeout(() => terminalRef.current?.focus(), 100)
    }

    ws.onclose = () => {
      setIsConnected(false)
      setIsConnecting(false)
      wsRef.current = null
    }

    ws.onerror = () => {
      setIsConnected(false)
      setIsConnecting(false)
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === 'output' && msg.data) {
          terminalRef.current?.write(msg.data)
        } else if (msg.type === 'connected') {
          setShellName(msg.shell || 'shell')
        }
      } catch {
        // If not JSON, treat as raw output
        terminalRef.current?.write(event.data)
      }
    }
  }, [])

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    setIsConnected(false)
  }, [])

  const restart = useCallback(() => {
    disconnect()
    terminalRef.current?.clear()
    setTimeout(connect, 300)
  }, [disconnect, connect])

  // Initialize xterm.js
  useEffect(() => {
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Consolas, "Courier New", monospace',
      theme: {
        background: '#0c0c0c',
        foreground: '#cccccc',
        cursor: '#cccccc',
        selectionBackground: '#264f78',
        black: '#0c0c0c',
        red: '#c50f1f',
        green: '#13a10e',
        yellow: '#c19c00',
        blue: '#0037da',
        magenta: '#881798',
        cyan: '#3a96dd',
        white: '#cccccc',
        brightBlack: '#767676',
        brightRed: '#e74856',
        brightGreen: '#16c60c',
        brightYellow: '#f9f1a5',
        brightBlue: '#3b78ff',
        brightMagenta: '#b4009e',
        brightCyan: '#61d6d6',
        brightWhite: '#f2f2f2',
      },
      scrollback: 5000,
      allowProposedApi: true,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)

    if (containerRef.current) {
      term.open(containerRef.current)
      fitAddon.fit()
    }

    // Handle keyboard input
    term.onData((data) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'input', data }))
      }
    })

    terminalRef.current = term
    fitAddonRef.current = fitAddon

    // Handle resize
    const handleResize = () => {
      fitAddon.fit()
      const { cols, rows } = term
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'resize', cols, rows }))
      }
    }
    window.addEventListener('resize', handleResize)

    // Auto-connect
    connect()

    if (onReady) onReady(term)

    return () => {
      window.removeEventListener('resize', handleResize)
      disconnect()
      term.dispose()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col h-full bg-[#0c0c0c]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#1e1e1e] border-b border-[#333]">
        <div className="flex items-center gap-2">
          {isConnected ? (
            <Wifi size={12} className="text-green-400" />
          ) : (
            <WifiOff size={12} className="text-red-400" />
          )}
          <span className="text-xs text-gray-400 font-mono">
            {isConnecting ? 'Connecting...' : isConnected ? shellName || 'shell' : 'Disconnected'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={connect}
            disabled={isConnected || isConnecting}
            className="p-1 rounded hover:bg-[#333] disabled:opacity-30 transition-colors"
            title="Connect"
          >
            <Power size={12} className="text-gray-400" />
          </button>
          <button
            onClick={restart}
            className="p-1 rounded hover:bg-[#333] transition-colors"
            title="Restart"
          >
            <RotateCcw size={12} className="text-gray-400" />
          </button>
        </div>
      </div>

      {/* Terminal */}
      <div ref={containerRef} className="flex-1 p-2" />

      {/* Connection overlay */}
      {!isConnected && !isConnecting && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60">
          <div className="text-center">
            <WifiOff size={32} className="text-gray-500 mx-auto mb-3" />
            <p className="text-sm text-gray-400 mb-3">Terminal disconnected</p>
            <button
              onClick={connect}
              className="px-4 py-2 bg-primary hover:bg-primary-hover text-white rounded-lg text-sm font-medium transition-colors"
            >
              Connect
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
