import { useMemo } from 'react'
import { Search } from 'lucide-react'
import { useAgentActivity } from '../../context/AgentActivityContext'

// Agent status surfaced in the titlebar chip. Bound to AgentActivityContext
// (thinking + steps + toolResults) instead of the Python backend process —
// this matches the mockup's "Agent running" semantics and reads identically
// regardless of which panel is open.
const STATUS = {
  idle:    { hsl: '215 18% 68%',     label: 'Agent idle',    pulse: false },
  running: { hsl: '142 71% 45%',     label: 'Agent running', pulse: true  },
  error:   { hsl: '0 63% 51%',       label: 'Agent error',   pulse: false },
}

export default function Titlebar({ onOpenPalette }) {
  const { thinking, steps, toolResults } = useAgentActivity()

  // Derived status: thinking or any running step → running; recent failed
  // tool call → error; otherwise idle. `running` and `error` are sticky
  // for the duration of the activity so the chip doesn't flicker.
  const status = useMemo(() => {
    if (thinking.active) return 'running'
    if (steps.some((s) => s.status === 'running')) return 'running'
    if (toolResults.some((r) => !r.success)) return 'error'
    return 'idle'
  }, [thinking.active, steps, toolResults])

  const s = STATUS[status]

  const winAction = async (action) => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      const w = getCurrentWindow()
      if (action === 'min') await w.minimize()
      else if (action === 'max') await w.toggleMaximize()
      else if (action === 'close') await w.close()
    } catch {
      /* window controls only work inside the Tauri shell */
    }
  }

  return (
    <header
      data-tauri-drag-region
      className="h-11 flex-none flex items-center gap-3.5 pl-3 bg-surface border-b border-border select-none"
    >
      {/* Left: app mark + workspace breadcrumb + git branch */}
      <div data-tauri-drag-region className="flex items-center gap-2.5 flex-none">
        <div
          className="w-[22px] h-[22px] flex items-center justify-center shrink-0"
          style={{
            borderRadius: 6,
            background: 'linear-gradient(135deg, hsl(var(--primary)), hsl(var(--primary) / 0.55))',
            boxShadow: '0 1px 3px rgba(0,0,0,0.35)',
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="hsl(var(--primary-foreground))" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 19V7l5 5 3-4 3 4 5-5v12" />
          </svg>
        </div>
        <div className="flex items-center gap-1.5 text-[12.5px]">
          <span className="font-semibold tracking-[-0.01em] text-foreground">MiniMax Studio</span>
        </div>
      </div>

      {/* Center: command palette trigger */}
      <div data-tauri-drag-region className="flex-1 flex justify-center">
        <button
          onClick={onOpenPalette}
          className="flex items-center gap-2.5 w-[min(440px,46%)] min-w-[280px] h-7 px-3 rounded-lg border border-border bg-background/60 text-muted-foreground text-[12.5px] hover:border-primary/50 transition-colors"
        >
          <Search size={14} aria-hidden="true" />
          <span className="flex-1 text-left truncate">Search or run a command</span>
          <span className="flex items-center gap-0.5 text-[10.5px] font-semibold">
            <kbd className="px-[5px] py-px rounded bg-secondary border border-border">Ctrl</kbd>
            <kbd className="px-[5px] py-px rounded bg-secondary border border-border">K</kbd>
          </span>
        </button>
      </div>

      {/* Right: agent status + window controls */}
      <div className="flex items-center gap-2.5 flex-none">
        <div
          className="flex items-center gap-[7px] px-2.5 py-1 rounded-[7px] border"
          style={{ backgroundColor: `hsl(${s.hsl} / 0.12)`, borderColor: `hsl(${s.hsl} / 0.25)` }}
        >
          <span
            className={`w-[7px] h-[7px] rounded-full ${s.pulse ? 'animate-mmpulse' : ''}`}
            style={{ backgroundColor: `hsl(${s.hsl})` }}
          />
          <span className="text-[11.5px] font-medium" style={{ color: `hsl(${s.hsl})` }}>
            {s.label}
          </span>
        </div>

        <div className="w-px h-[18px] bg-border mx-0.5" />

        <div className="flex items-center h-11">
          <button
            onClick={() => winAction('min')}
            title="Minimize"
            aria-label="Minimize"
            className="w-[46px] h-11 flex items-center justify-center text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
          >
            {/* Mockup L74: horizontal bar inside 12×12 viewBox */}
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <rect x="1.5" y="5.5" width="9" height="1" fill="currentColor" />
            </svg>
          </button>
          <button
            onClick={() => winAction('max')}
            title="Maximize"
            aria-label="Maximize"
            className="w-[46px] h-11 flex items-center justify-center text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
          >
            {/* Mockup L77: outlined square inside 11×11 viewBox */}
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
              <rect x="1.5" y="1.5" width="9" height="9" />
            </svg>
          </button>
          <button
            onClick={() => winAction('close')}
            title="Close"
            aria-label="Close"
            className="w-[46px] h-11 flex items-center justify-center text-muted-foreground transition-colors hover:bg-[#e81123] hover:text-white"
          >
            {/* Mockup L80: X strokes inside 12×12 viewBox */}
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
              <path d="M1.5 1.5 10.5 10.5M10.5 1.5 1.5 10.5" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  )
}
