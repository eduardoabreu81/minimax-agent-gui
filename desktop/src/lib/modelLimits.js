// Shared model metadata. Used by SettingsPanel (model picker) and StatusBar
// (context-window progress bar). Authoritative values per MiniMax product
// spec as of 2026-06-20.

export const MODEL_CONTEXT_LIMITS = {
  'MiniMax-M3.1-Flash-Preview': 1_000_000,
  'MiniMax-M3': 1_000_000,
  'MiniMax-M2.7': 204_800,
  'MiniMax-M2.7-highspeed': 204_800,
}

// Auto-compact warning thresholds per model. Drives ContextWarningBanner
// tier (none / suggest / auto / force). The 50% "suggest" tier is limited
// to the 1M-context models — M2.7 has a smaller context window so an
// aggressive proactive nudge doesn't add value. 80% (auto) and 90%
// (force-compact safety net) apply to all models. Spec source:
// AGENTS.local.md §"Context Window".
export const MODEL_COMPACT_THRESHOLDS = {
  'MiniMax-M3.1-Flash-Preview': { warn: 0.50, auto: 0.80, max: 0.90 },
  'MiniMax-M3':            { warn: 0.50, auto: 0.80, max: 0.90 },
  'MiniMax-M2.7':          { warn: null, auto: 0.80, max: 0.90 },
  'MiniMax-M2.7-highspeed':{ warn: null, auto: 0.80, max: 0.90 },
}

// Default window used by the StatusBar context chip until the user has
// picked a model (no limit known -> fall back to the default model).
export const DEFAULT_MODEL = 'MiniMax-M3'

// Models that expose Anthropic-style thinking blocks. The rest of the
// Token Plan chat models ignore the `thinking` param entirely, so the
// composer hides the control for them.
export const THINKING_SUPPORTED_MODELS = new Set([
  'MiniMax-M3.1-Flash-Preview',
  'MiniMax-M3',
])

// Models that reason unconditionally: MiniMax turns thinking on by
// default and offers no way to disable it, so the on/off ThinkingToggle
// is meaningless. Depth is picked with `output_config.effort` instead,
// which is why the composer swaps the toggle for an effort selector.
export const EFFORT_MODELS = new Set(['MiniMax-M3.1-Flash-Preview'])

// `output_config.effort` levels accepted by the MiniMax Anthropic API.
// `xhigh` is documented by MiniMax but missing from the Anthropic SDK's
// own Literal — it serializes fine, so keep it.
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']
export const DEFAULT_EFFORT = 'max'

// True when the model's thinking depth is tuned with `effort` rather
// than an on/off toggle.
export function usesEffortControl(modelId) {
  return EFFORT_MODELS.has(modelId)
}

export function getContextLimit(modelId) {
  return MODEL_CONTEXT_LIMITS[modelId] || MODEL_CONTEXT_LIMITS[DEFAULT_MODEL]
}

export function getCompactThresholds(modelId) {
  return (
    MODEL_COMPACT_THRESHOLDS[modelId] ||
    MODEL_COMPACT_THRESHOLDS[DEFAULT_MODEL]
  )
}

// Compact display: 1000 -> "1.0k", 1_000_000 -> "1.0M", 204_800 -> "204.8k".
// Always shows 1 decimal for k values to match Edu's screenshot
// (e.g. "7.4k" for memory_files, not the old rounded "7k"). Under
// 1000, returns the integer with no suffix (e.g. "167" for mcp_tools).
export function formatTokenCount(n) {
  if (n === null || n === undefined) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

// Detailed display: 1000 -> "1,000", 1_000_000 -> "1,000,000".
export function formatTokenCountExact(n) {
  if (n === null || n === undefined) return '0'
  return n.toLocaleString('en-US')
}

// Compact byte display: 1024 -> "1KB", 1_048_576 -> "1.0MB", etc.
// Uses binary (KiB/MiB) suffixes — closer to how `ls -lh` reports
// file sizes. The Messages row uses this instead of the token
// count because the user asked for "tamanho em bytes" — the
// byte count is what the conversation actually weighs in
// memory/disk, independent of the model's tokenizer.
export function formatByteCount(n) {
  if (n === null || n === undefined) return '0'
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)}MB`
  if (n >= 1024) return `${(n / 1024).toFixed(1)}KB`
  return `${n}B`
}
