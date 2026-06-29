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
      <div className="flex flex-col items-center gap-7 max-w-sm text-center px-6">
        {/* Brand mark */}
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-primary/[0.13] flex items-center justify-center">
            <Sparkles className="h-8 w-8 text-primary" />
          </div>
          <div className="text-xl font-semibold tracking-tight">MiniMax Studio</div>
        </div>

        {/* Progress: pulsing bar while connecting, solid red when errored */}
        <div className="w-56 h-1 rounded-full bg-surface overflow-hidden">
          <div
            className={`h-full rounded-full ${
              isError ? 'w-full bg-red-500/70' : 'w-full bg-primary/60 animate-pulse'
            }`}
          />
        </div>

        {/* Status row */}
        <div className="flex flex-col items-center gap-1.5 min-h-[40px]">
          <div className="flex items-center gap-2">
            {isError ? (
              <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
            ) : (
              <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0" />
            )}
            <span className="text-sm font-medium">
              {isError ? 'Backend failed to start' : 'Starting up…'}
            </span>
          </div>

          {isError && error ? (
            <p className="text-xs text-muted-foreground max-w-xs leading-relaxed mt-1">
              {error}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground/70">
              Connecting to the local engine
              {attempt > 1 && (
                <span className="text-muted-foreground/50"> · attempt {attempt}</span>
              )}
            </p>
          )}
        </div>

        {/* Retry — only when errored */}
        {isError && (
          <button
            onClick={onRetry}
            className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-hover text-white rounded-lg text-sm font-medium transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
            Retry
          </button>
        )}
      </div>
    </div>
  )
}