import { Brain, Cpu, ChevronDown } from 'lucide-react'

/**
 * ModelThinkingControls — compact model selector + thinking toggle.
 *
 * Designed to live below the chat/code composer textarea. Provides:
 *   - Model selector dropdown (chat models only)
 *   - Thinking toggle button (visible only for M3)
 *
 * The thinking button reads/writes `thinkingEnabled`; if the model is
 * not M3, `supportsThinking` is false and the button is hidden.
 *
 * Props:
 *   - model, setModel: selected model id + setter
 *   - thinkingEnabled, setThinkingEnabled: thinking state + setter
 *   - supportsThinking: whether the selected model supports thinking
 *   - compact: smaller padding for tight spaces
 *   - disabled: disable both controls
 */
const CHAT_MODELS = [
  { id: 'MiniMax-M3', label: 'MiniMax-M3', desc: '1M context, agentic' },
  { id: 'MiniMax-M2.7', label: 'MiniMax-M2.7', desc: 'Faster, default' },
  { id: 'MiniMax-M2.7-highspeed', label: 'MiniMax-M2.7-highspeed', desc: 'Highest throughput' },
]

export default function ModelThinkingControls({
  model,
  setModel,
  thinkingEnabled,
  setThinkingEnabled,
  supportsThinking,
  compact = false,
  disabled = false,
}) {
  const padding = compact ? 'px-2 py-0.5' : 'px-2.5 py-1'
  const textSize = compact ? 'text-[10px]' : 'text-xs'
  const iconSize = compact ? 10 : 12

  return (
    <div className={`flex items-center gap-1.5 ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      {/* Model selector */}
      <div className="relative">
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          disabled={disabled}
          className={`appearance-none ${padding} pr-6 ${textSize} rounded-md
                     bg-surface border border-border text-foreground
                     hover:border-primary/40 transition-colors
                     focus:outline-none focus:border-primary/60
                     cursor-pointer font-medium`}
          title="Select chat model"
        >
          {CHAT_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={iconSize}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
        />
      </div>

      {/* Thinking toggle — only for M3 */}
      {supportsThinking && (
        <button
          type="button"
          onClick={() => setThinkingEnabled(!thinkingEnabled)}
          disabled={disabled}
          title={thinkingEnabled ? 'Thinking: ON (M3 will show its reasoning)' : 'Thinking: OFF (faster, no reasoning shown)'}
          className={`flex items-center gap-1 ${padding} ${textSize} rounded-md
                     border transition-colors font-medium
                     ${thinkingEnabled
                       ? 'bg-primary/10 border-primary/30 text-primary hover:bg-primary/20'
                       : 'bg-surface border-border text-muted hover:border-primary/40 hover:text-foreground'
                     }`}
        >
          <Brain size={iconSize} />
          <span>Thinking</span>
        </button>
      )}
    </div>
  )
}
