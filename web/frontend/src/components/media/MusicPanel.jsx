import { useState, useEffect } from 'react'
import { Music, Loader2, Play, Save, Wand2, Guitar, Mic2, AudioLines, Check } from 'lucide-react'
import { useSessionProtection } from '../../hooks/useSessionProtection'
import RecentGenerations from './RecentGenerations'

const MUSIC_MODELS = [
  { id: 'music-2.6', label: 'Music 2.6', desc: 'Best quality' },
  { id: 'music-2.6-free', label: 'Music 2.6 Free', desc: 'Unlimited (default)' },
  { id: 'music-2.5+', label: 'Music 2.5+', desc: 'Legacy+' },
  { id: 'music-2.5', label: 'Music 2.5', desc: 'Legacy' },
]

const STRUCTURE_TAGS = ['Intro', 'Verse', 'Pre Chorus', 'Chorus', 'Interlude', 'Bridge', 'Outro', 'Post Chorus', 'Hook', 'Inst']

export default function MusicPanel() {
  const [mode, setMode] = useState('original')
  const [model, setModel] = useState('music-2.6-free')
  const [prompt, setPrompt] = useState('')
  const [lyrics, setLyrics] = useState('')
  const [useLyricsOptimizer, setUseLyricsOptimizer] = useState(false)
  const [instrumental, setInstrumental] = useState(false)
  const [vocals, setVocals] = useState('')
  const [genre, setGenre] = useState('')
  const [mood, setMood] = useState('')
  const [instruments, setInstruments] = useState('')
  const [tempo, setTempo] = useState('')
  const [bpm, setBpm] = useState('')
  const [key, setKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const { register } = useSessionProtection()

  useEffect(() => {
    register('music-loading', loading, 'Music generation in progress')
  }, [loading, register])

  useEffect(() => {
    register('music-prompt', prompt.trim().length > 0 || lyrics.trim().length > 0, 'Unsaved music prompt or lyrics')
  }, [prompt, lyrics, register])

  const fetchHistory = async () => {
    setHistoryLoading(true)
    try {
      const res = await fetch('/api/generations')
      const data = await res.json()
      let music = []
      if (data.success) music = data.data.music || []

      const wsRes = await fetch('/api/files?path=workspace')
      const wsData = await wsRes.json()
      if (wsData.entries) {
        const wsMusic = wsData.entries
          .filter(e => !e.is_dir && /\.(mp3|wav|flac|m4a)$/i.test(e.name))
          .filter(e => /^(music_|music_web|generated_music)/i.test(e.name))
          .map(e => ({ name: e.name, path: e.path, size: 0 }))
        const seen = new Set(music.map(i => i.path))
        wsMusic.forEach(m => {
          if (!seen.has(m.path)) music.push(m)
        })
      }

      music.sort((a, b) => {
        if (a.modified_at && b.modified_at) return b.modified_at.localeCompare(a.modified_at)
        return b.name.localeCompare(a.name)
      })

      setHistory(music)
    } catch (e) { /* ignore */ }
    setHistoryLoading(false)
  }

  useEffect(() => {
    fetchHistory()
  }, [])

  const insertTag = (tag) => {
    setLyrics(prev => prev + (prev ? '\n' : '') + `[${tag}] `)
  }

  const generate = async () => {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const args = ['--model', model]

      if (prompt) args.push('--prompt', prompt)

      if (mode === 'instrumental') {
        args.push('--instrumental')
      } else if (lyrics && !useLyricsOptimizer) {
        args.push('--lyrics', lyrics)
      } else if (useLyricsOptimizer) {
        args.push('--lyrics-optimizer')
      }

      if (vocals) args.push('--vocals', vocals)
      if (genre) args.push('--genre', genre)
      if (mood) args.push('--mood', mood)
      if (instruments) args.push('--instruments', instruments)
      if (tempo) args.push('--tempo', tempo)
      if (bpm) args.push('--bpm', bpm)
      if (key) args.push('--key', key)

      const outFile = `workspace/music_${Date.now()}.mp3`
      args.push('--out', outFile)

      const res = await fetch('/api/minimax/cli', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: 'music generate',
          args,
        }),
      })
      const data = await res.json()
      if (data.success && data.returncode === 0) {
        setResult(outFile)
        fetchHistory()
      } else {
        setError(data.stderr || data.stdout || 'Music generation failed')
      }
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }

  return (
    <div className="flex flex-col h-full bg-card overflow-y-auto">
      <div className="h-14 flex items-center px-6 border-b border-border bg-surface/50">
        <Music size={18} className="text-primary mr-2" />
        <h2 className="text-sm font-semibold">Music Generation</h2>
        <span className="ml-auto text-[10px] text-muted bg-surface px-2 py-1 rounded-full border border-border">music-2.6</span>
      </div>

      <div className="flex-1 p-6 max-w-4xl mx-auto w-full space-y-5">
        <div className="bg-surface border border-border rounded-xl p-4">
          <p className="text-sm text-muted">MiniMax Music-2.6 — Text-to-music with lyrics, instrumental, and cover generation</p>
        </div>

        {/* Mode selector */}
        <div className="flex gap-2">
          {[
            { id: 'original', label: 'Original', icon: Music, tip: 'Generate original music with lyrics and vocals' },
            { id: 'instrumental', label: 'Instrumental', icon: AudioLines, tip: 'Generate music without vocals' },
            { id: 'cover', label: 'Cover', icon: Mic2, tip: 'Create a cover version of an existing song' },
          ].map((m) => {
            const Icon = m.icon
            return (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors border ${
                  mode === m.id
                    ? 'bg-primary text-white border-primary'
                    : 'bg-surface border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon size={14} />
                <span title={m.tip}>{m.label}</span>
              </button>
            )
          })}
        </div>

        {/* Model */}
        <div>
          <label className="text-sm font-medium text-foreground mb-2 block">Model</label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {MUSIC_MODELS.map((m) => (
              <button
                key={m.id}
                onClick={() => setModel(m.id)}
                className={`flex flex-col items-start gap-0.5 px-3 py-2 rounded-lg border transition-colors ${
                  model === m.id
                    ? 'bg-primary/10 border-primary text-primary'
                    : 'bg-surface border-border text-foreground hover:border-primary'
                }`}
              >
                <span className="text-xs font-medium">{m.label}</span>
                <span className="text-[10px] text-muted">{m.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Prompt */}
        <div>
          <label className="text-sm font-medium text-foreground mb-2 flex items-center gap-1.5">
            <Guitar size={14} /> Style / Prompt
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value.slice(0, 2000))}
            placeholder="e.g. Upbeat jazz song about a summer beach, cinematic orchestral..."
            className="w-full bg-card border border-border rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted resize-none focus:outline-none focus:border-primary transition-colors"
            rows={3}
          />
          <div className="flex items-center justify-between mt-1">
            <p className="text-xs text-muted">{prompt.length.toLocaleString()} / 2,000 characters</p>
            {prompt.length > 2000 && <p className="text-xs text-error">Exceeds limit!</p>}
          </div>
        </div>

        {/* Music attributes */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div>
            <label className="text-xs font-medium text-muted mb-1 block">Genre</label>
            <input
              type="text"
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
              placeholder="pop, jazz, folk..."
              className="w-full bg-card border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted mb-1 block">Mood</label>
            <input
              type="text"
              value={mood}
              onChange={(e) => setMood(e.target.value)}
              placeholder="warm, melancholic..."
              className="w-full bg-card border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted mb-1 block">Instruments</label>
            <input
              type="text"
              value={instruments}
              onChange={(e) => setInstruments(e.target.value)}
              placeholder="piano, guitar..."
              className="w-full bg-card border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted mb-1 block">Tempo</label>
            <input
              type="text"
              value={tempo}
              onChange={(e) => setTempo(e.target.value)}
              placeholder="fast, slow..."
              className="w-full bg-card border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted mb-1 block">BPM</label>
            <input
              type="number"
              value={bpm}
              onChange={(e) => setBpm(e.target.value)}
              placeholder="120"
              className="w-full bg-card border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted mb-1 block">Musical Key</label>
            <input
              type="text"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="C major..."
              className="w-full bg-card border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted focus:outline-none focus:border-primary"
            />
          </div>
        </div>

        {/* Vocal style */}
        {!instrumental && mode !== 'instrumental' && (
          <div>
            <label className="text-sm font-medium text-foreground mb-2 flex items-center gap-1.5">
              <Mic2 size={14} /> Vocal Style
            </label>
            <input
              type="text"
              value={vocals}
              onChange={(e) => setVocals(e.target.value)}
              placeholder="e.g. warm male baritone, bright female soprano, duet with harmonies"
              className="w-full bg-card border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-primary"
            />
          </div>
        )}

        {/* Lyrics */}
        {mode !== 'instrumental' && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-foreground flex items-center gap-1.5">
                <Music size={14} /> Lyrics
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useLyricsOptimizer}
                  onChange={(e) => setUseLyricsOptimizer(e.target.checked)}
                  className="rounded border-border text-primary focus:ring-primary"
                />
                <span className="text-xs text-foreground flex items-center gap-1" title="Let MiniMax automatically write lyrics based on your style prompt">
                  <Wand2 size={12} /> Auto-generate lyrics
                </span>
              </label>
            </div>
            {!useLyricsOptimizer && (
              <>
                <div className="flex flex-wrap gap-1 mb-2">
                  {STRUCTURE_TAGS.map((tag) => (
                    <button
                      key={tag}
                      onClick={() => insertTag(tag)}
                      className="px-2 py-0.5 bg-surface border border-border rounded text-[10px] text-muted hover:border-primary hover:text-foreground transition-colors"
                    >
                      +{tag}
                    </button>
                  ))}
                </div>
                <textarea
                  value={lyrics}
                  onChange={(e) => setLyrics(e.target.value.slice(0, 3500))}
                  placeholder={`[Verse] La da dee, sunny day\n[Chorus] Summer vibes all the way...`}
                  className="w-full bg-card border border-border rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted resize-none focus:outline-none focus:border-primary transition-colors font-mono"
                  rows={6}
                />
                <div className="flex items-center justify-between mt-1">
                  <p className="text-xs text-muted">{lyrics.length.toLocaleString()} / 3,500 characters</p>
                  {lyrics.length > 3500 && <p className="text-xs text-error">Exceeds limit!</p>}
                </div>
              </>
            )}
          </div>
        )}

        <button
          onClick={generate}
          disabled={loading || (!prompt.trim() && !lyrics.trim() && !useLyricsOptimizer)}
          className="w-full py-3 bg-primary hover:bg-primary-hover disabled:opacity-40 text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
        >
          {loading ? <Loader2 size={18} className="animate-spin" /> : <Music size={18} />}
          {loading ? 'Generating...' : `Generate ${mode === 'instrumental' ? 'Instrumental' : 'Music'}`}
        </button>

        {error && (
          <div className="bg-error/10 border border-error/20 rounded-xl p-4 text-sm text-error">{error}</div>
        )}

        {result && (
          <div className="bg-surface border border-border rounded-xl p-4 space-y-3">
            <p className="text-sm text-muted flex items-center gap-2">
              <Check size={14} className="text-success" /> Music generated
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
          type="music"
          items={history}
          loading={historyLoading}
          onRefresh={fetchHistory}
          emptyMessage="No generated music yet"
        />
      </div>
    </div>
  )
}
