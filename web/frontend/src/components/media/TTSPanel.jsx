import { useState, useEffect } from 'react'
import { Volume2, Play, Save, Loader2, RefreshCw, Mic, Gauge, Check } from 'lucide-react'
import { useSessionProtection } from '../../hooks/useSessionProtection'
import RecentGenerations from './RecentGenerations'

export default function TTSPanel() {
  const [text, setText] = useState('')
  const [voice, setVoice] = useState('English_expressive_narrator')
  const [speed, setSpeed] = useState(1.0)
  const [volume, setVolume] = useState(1.0)
  const [pitch, setPitch] = useState(0)
  const [format, setFormat] = useState('mp3')
  const [loading, setLoading] = useState(false)
  const [voicesLoading, setVoicesLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [voices, setVoices] = useState([])
  const [voiceFilter, setVoiceFilter] = useState('')
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const { register } = useSessionProtection()

  useEffect(() => {
    register('tts-loading', loading, 'TTS synthesis in progress')
  }, [loading, register])

  useEffect(() => {
    register('tts-text', text.trim().length > 0, 'Unsaved TTS text')
  }, [text, register])

  const fetchHistory = async () => {
    setHistoryLoading(true)
    try {
      const res = await fetch('/api/generations')
      const data = await res.json()
      let tts = []
      if (data.success) tts = data.data.tts || []

      const wsRes = await fetch('/api/files?path=workspace')
      const wsData = await wsRes.json()
      if (wsData.entries) {
        const wsTts = wsData.entries
          .filter(e => !e.is_dir && /\.(mp3|wav|flac|pcm)$/i.test(e.name))
          .filter(e => /^(tts_|tts_web|tts_output)/i.test(e.name))
          .map(e => ({ name: e.name, path: e.path, size: 0 }))
        const seen = new Set(tts.map(i => i.path))
        wsTts.forEach(t => {
          if (!seen.has(t.path)) tts.push(t)
        })
      }

      tts.sort((a, b) => {
        if (a.modified_at && b.modified_at) return b.modified_at.localeCompare(a.modified_at)
        return b.name.localeCompare(a.name)
      })

      setHistory(tts)
    } catch (e) { /* ignore */ }
    setHistoryLoading(false)
  }

  useEffect(() => {
    fetchHistory()
  }, [])

  const fetchVoices = async () => {
    setVoicesLoading(true)
    try {
      const res = await fetch('/api/minimax/voices')
      const data = await res.json()
      if (data.success && Array.isArray(data.data?.voices)) {
        setVoices(data.data.voices)
      } else if (Array.isArray(data.data)) {
        setVoices(data.data)
      } else {
        // Fallback voices from CLI docs
        setVoices([
          { id: 'English_expressive_narrator', name: 'Expressive Narrator', language: 'English' },
          { id: 'English_magnetic_voiced_man', name: 'Magnetic Voiced Man', language: 'English' },
          { id: 'Chinese (Mandarin)_Warm_Female', name: 'Warm Female', language: 'Chinese' },
          { id: 'male-qn-qingque', name: 'Qingque', language: 'Chinese' },
          { id: 'female-nuo-yan', name: 'Nuo Yan', language: 'Chinese' },
        ])
      }
    } catch (e) {
      setError('Failed to load voices: ' + e.message)
    } finally {
      setVoicesLoading(false)
    }
  }

  // Load voices once on mount
  useEffect(() => {
    fetchVoices()
  }, [])

  const generate = async () => {
    if (!text.trim()) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/minimax/cli', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: 'speech synthesize',
          args: [
            '--text', text,
            '--voice', voice,
            '--speed', String(speed),
            '--volume', String(volume),
            '--pitch', String(pitch),
            '--format', format,
            '--out', `workspace/tts_${Date.now()}.${format}`,
          ],
        }),
      })
      const data = await res.json()
      if (data.success && data.returncode === 0) {
        // Try to parse result or use stdout
        let outputPath = null
        try {
          const jsonOut = JSON.parse(data.stdout)
          outputPath = jsonOut.file_path || jsonOut.path
        } catch {
          // Extract path from stdout
          const match = data.stdout.match(/workspace[\\/]tts_\d+\./)
          if (match) outputPath = match[0]
        }
        setResult(outputPath || `workspace/tts_${Date.now()}.${format}`)
        fetchHistory()
      } else {
        setError(data.stderr || data.stdout || 'TTS failed')
      }
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }

  const filteredVoices = voices.filter(v => 
    !voiceFilter || (v.language || '').toLowerCase().includes(voiceFilter.toLowerCase())
  )

  return (
    <div className="flex flex-col h-full bg-card overflow-y-auto">
      <div className="h-14 flex items-center px-6 border-b border-border bg-surface/50">
        <Volume2 size={18} className="text-primary mr-2" />
        <h2 className="text-sm font-semibold">Text-to-Speech</h2>
        <span className="ml-auto text-[10px] text-muted bg-surface px-2 py-1 rounded-full border border-border">Speech 2.8 HD</span>
      </div>

      <div className="flex-1 p-6 max-w-4xl mx-auto w-full space-y-5">
        {/* Info + Quota hint */}
        <div className="bg-surface border border-border rounded-xl p-4 flex items-center justify-between">
          <p className="text-sm text-muted">MiniMax Speech 2.8 HD — Up to 10k characters per request</p>
          <button
            onClick={fetchVoices}
            disabled={voicesLoading}
            className="flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <RefreshCw size={10} className={voicesLoading ? 'animate-spin' : ''} /> Refresh Voices
          </button>
        </div>

        {/* Text input */}
        <div>
          <label className="text-sm font-medium text-foreground mb-2 block">Text to Synthesize</label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Enter text to synthesize... (up to 10,000 characters)"
            className="w-full bg-card border border-border rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted resize-none focus:outline-none focus:border-primary transition-colors"
            rows={6}
          />
          <div className="flex items-center justify-between mt-1">
            <p className="text-xs text-muted">{text.length.toLocaleString()} / 10,000 characters</p>
            {text.length > 10000 && <p className="text-xs text-error">Exceeds limit!</p>}
          </div>
        </div>

        {/* Voice selection */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-foreground flex items-center gap-1.5" title="Select a voice for speech synthesis">
              <Mic size={14} /> Voice
            </label>
            <select
              value={voiceFilter}
              onChange={(e) => setVoiceFilter(e.target.value)}
              className="text-xs bg-surface border border-border rounded-lg px-2 py-1"
            >
              <option value="">All Languages</option>
              {Array.from(new Set(voices.map(v => v.language).filter(Boolean))).sort().map(lang => (
                <option key={lang} value={lang.toLowerCase()}>{lang}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-48 overflow-y-auto p-1">
            {filteredVoices.map((v) => (
              <button
                key={v.id || v.voice_id}
                onClick={() => setVoice(v.id || v.voice_id)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs border transition-colors text-left ${
                  voice === (v.id || v.voice_id)
                    ? 'bg-primary/10 border-primary text-primary'
                    : 'bg-surface border-border text-foreground hover:border-primary'
                }`}
              >
                <Volume2 size={12} />
                <div className="flex-1 min-w-0">
                  <div className="truncate font-medium">{v.name || v.id || v.voice_id}</div>
                  <div className="text-[10px] text-muted truncate">{v.language || v.gender || 'General'}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Advanced settings */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-sm font-medium text-foreground mb-2 flex items-center gap-1.5">
              <Gauge size={14} /> Speed: {speed}x
            </label>
            <input
              type="range"
              min="0.5"
              max="2.0"
              step="0.1"
              value={speed}
              onChange={(e) => setSpeed(parseFloat(e.target.value))}
              className="w-full accent-primary"
            />
            <div className="flex justify-between text-[10px] text-muted mt-1">
              <span>0.5x</span><span>1.0x</span><span>2.0x</span>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-foreground mb-2 block" title="Adjust the loudness of the speech (0.1x = very quiet, 2.0x = very loud)">Volume: {volume}x</label>
            <input
              type="range"
              min="0.1"
              max="2.0"
              step="0.1"
              value={volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              className="w-full accent-primary"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-foreground mb-2 block" title="Adjust the voice pitch (-10 = very deep, +10 = very high)">Pitch: {pitch}</label>
            <input
              type="range"
              min="-10"
              max="10"
              step="1"
              value={pitch}
              onChange={(e) => setPitch(parseInt(e.target.value))}
              className="w-full accent-primary"
            />
          </div>
        </div>

        <div>
          <label className="text-sm font-medium text-foreground mb-2 block" title="Select the output audio file format">Audio Format</label>
          <div className="flex gap-2">
            {['mp3', 'wav', 'pcm', 'flac'].map((f) => (
              <button
                key={f}
                onClick={() => setFormat(f)}
                className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                  format === f
                    ? 'bg-primary/10 border-primary text-primary'
                    : 'bg-surface border-border text-foreground hover:border-primary'
                }`}
              >
                {f.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Generate */}
        <button
          onClick={generate}
          disabled={loading || !text.trim() || text.length > 10000}
          className="w-full py-3 bg-primary hover:bg-primary-hover disabled:opacity-40 text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
        >
          {loading ? <Loader2 size={18} className="animate-spin" /> : <Volume2 size={18} />}
          {loading ? 'Synthesizing...' : 'Synthesize Speech'}
        </button>

        {error && (
          <div className="bg-error/10 border border-error/20 rounded-xl p-4 text-sm text-error">
            {error}
          </div>
        )}

        {result && (
          <div className="bg-surface border border-border rounded-xl p-4 space-y-3">
            <p className="text-sm text-muted flex items-center gap-2">
              <Check size={14} className="text-success" /> Audio generated successfully
            </p>
            <audio controls className="w-full" src={`/api/files/content?path=${encodeURIComponent(result)}`} />
            <div className="flex gap-2">
              <a
                href={`/api/files/content?path=${encodeURIComponent(result)}`}
                download
                className="px-4 py-2 bg-primary hover:bg-primary-hover text-white text-sm rounded-lg transition-colors flex items-center gap-2"
              >
                <Save size={14} /> Download
              </a>
            </div>
          </div>
        )}

        <RecentGenerations
          title="Recent Generations"
          type="tts"
          items={history}
          loading={historyLoading}
          onRefresh={fetchHistory}
          emptyMessage="No generated speech yet"
        />
      </div>
    </div>
  )
}
