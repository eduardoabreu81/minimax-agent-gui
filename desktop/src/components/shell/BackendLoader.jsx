// BackendLoader — fullscreen placeholder shown while useBackendReady
// healthchecks the FastAPI sidecar.
//
// Three states map 1:1 to useBackendReady.status:
//   - 'connecting' → spinner + "Starting backend..."
//   - 'ready'      → not rendered (App.jsx skips the gate)
//   - 'error'      → AlertCircle + reason + Retry button
//
// Visuals match the rest of the app: bg-background/text-foreground so it
// adapts to the active theme, primary-tinted spinner, muted secondary text.

import { AlertCircle, Loader2, RefreshCw, Sparkles } from 'lucide-react'

export default function BackendLoader({ status, error, attempt, onRetry }) {
  const isError = status === 'error'

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-background text-foreground">
      <div className="flex flex-col items-center gap-6 max-w-md text-center px-6">
        {/* Brand */}
        <div className="flex items-center gap-3 text-2xl font-semibold tracking-tight">
          <Sparkles className="h-7 w-7 text-primary" />
          <span>MiniMax Agent</span>
        </div>

        {/* Status row */}
        <div className="flex items-center gap-3 min-h-[28px]">
          {isError ? (
            <AlertCircle className="h-5 w-5 text-red-500 shrink-0" />
          ) : (
            <Loader2 className="h-5 w-5 text-primary animate-spin shrink-0" />
          )}
          <span className="text-sm font-medium">
            {isError ? 'Backend failed to start' : 'Starting backend…'}
          </span>
        </div>

        {/* Detail line */}
        {isError && error ? (
          <p className="text-xs text-muted-foreground max-w-sm leading-relaxed">
            {error}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground/70 max-w-sm">
            Connecting to FastAPI sidecar on port 8765
            {attempt > 1 && (
              <span className="text-muted-foreground/50">
                {' '}· attempt {attempt}
              </span>
            )}
          </p>
        )}

        {/* Retry — only when errored */}
        {isError && (
          <button
            onClick={onRetry}
            className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-hover text-primary-foreground rounded-lg text-sm font-medium transition-colors mt-2"
          >
            <RefreshCw className="h-4 w-4" />
            Retry
          </button>
        )}
      </div>
    </div>
  )
}