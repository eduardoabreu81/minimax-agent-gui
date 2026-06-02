import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Video, Loader2, Save, RefreshCw, Image, Film, User, Check, Coins, AlertTriangle } from 'lucide-react'
import { useSessionProtection } from '../../hooks/useSessionProtection'
import RecentGenerations from './RecentGenerations'

const VIDEO_MODELS = [
  { id: 'MiniMax-Hailuo-2.3', label: 'Hailuo 2.3', desc: 'Quality (768P 6s)' },
  { id: 'MiniMax-Hailuo-2.3-Fast', label: 'Hailuo 2.3 Fast', desc: 'Faster generation' },
]

export default function VideoPanel() {
  const { t } = useTranslation()
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState('MiniMax-Hailuo-2.3')
  const [mode, setMode] = useState('text2video')
  const [firstFrame, setFirstFrame] = useState('')
  const [lastFrame, setLastFrame] = useState('')
  const [subjectImage, setSubjectImage] = useState('')
  const [loading, setLoading] = useState(false)
  const [taskId, setTaskId] = useState(null)
  const [status, setStatus] = useState(null)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState(null)
  const [cost, setCost] = useState(null)
  const [videoDailyLimit, setVideoDailyLimit] = useState(null)
  const [videoDailyUsed, setVideoDailyUsed] = useState(null)
  const [error, setError] = useState(null)
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const { register } = useSessionProtection()

  useEffect(() => {
    register('video-loading', loading || !!taskId, 'Video generation in progress')
  }, [loading, taskId, register])

  useEffect(() => {
    register('video-prompt', prompt.trim().length > 0, 'Unsaved video prompt')
  }, [prompt, register])

  const fetchHistory = async () => {
    setHistoryLoading(true)
    try {
      const res = await fetch('/api/generations')
      const data = await res.json()
      let videos = []
      if (data.success) videos = data.data.videos || []

      const wsRes = await fetch('/api/files?path=workspace')
      const wsData = await wsRes.json()
      if (wsData.entries) {
        const wsVideos = wsData.entries
          .filter(e => !e.is_dir && /\.(mp4|mov|webm)$/i.test(e.name))
          .filter(e => /^(video_|generated_video)/i.test(e.name))
          .map(e => ({ name: e.name, path: e.path, size: 0 }))
        const seen = new Set(videos.map(i => i.path))
        wsVideos.forEach(v => {
          if (!seen.has(v.path)) videos.push(v)
        })
      }

      videos.sort((a, b) => {
        if (a.modified_at && b.modified_at) return b.modified_at.localeCompare(a.modified_at)
        return b.name.localeCompare(a.name)
      })

      setHistory(videos)
    } catch (e) { /* ignore */ }
    setHistoryLoading(false)
  }

  // Fetch video daily quota (limit/used) from /api/minimax/quota
  const fetchDailyQuota = async () => {
    try {
      const res = await fetch('/api/minimax/quota')
      if (!res.ok) return
      const data = await res.json()
      const payload = data?.data ?? data
      if (typeof payload?.video_daily_limit === 'number') {
        setVideoDailyLimit(payload.video_daily_limit)
      }
      if (typeof payload?.video_daily_used === 'number') {
        setVideoDailyUsed(payload.video_daily_used)
      }
    } catch { /* ignore */ }
  }

  useEffect(() => {
    fetchHistory()
    fetchDailyQuota()
  }, [])

  // Refresh daily quota when notified that a media action completed
  useEffect(() => {
    const onMedia = () => fetchDailyQuota()
    window.addEventListener('minimax:media-complete', onMedia)
    return () => window.removeEventListener('minimax:media-complete', onMedia)
  }, [])

  const generate = async () => {
    if (!prompt.trim()) return
    setLoading(true)
    setError(null)
    setResult(null)
    setCost(null)
    setProgress(0)
    try {
      const args = [
        '--prompt', prompt,
        '--async',
      ]

      if (model.includes('Fast')) args.push('--model', model)
      if (firstFrame) args.push('--first-frame', firstFrame)
      if (lastFrame) args.push('--last-frame', lastFrame)
      if (subjectImage) args.push('--subject-image', subjectImage)

      const res = await fetch('/api/minimax/cli', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: 'video generate',
          args,
        }),
      })
      const data = await res.json()
      if (data.success && data.returncode === 0) {
        // Capture cost from top-level or from stdout JSON
        let parsedOut = null
        try { parsedOut = JSON.parse(data.stdout) } catch { /* ignore */ }
        const cc = data.cost_credits ?? parsedOut?.cost_credits
        const cu = data.cost_usd ?? parsedOut?.cost_usd
        if (typeof cc === 'number' || typeof cu === 'number') {
          setCost({ cost_credits: cc, cost_usd: cu })
        }
        // Optimistically bump daily-used so the UI updates even before
        // the polling round-trip finishes.
        if (typeof videoDailyUsed === 'number') setVideoDailyUsed(videoDailyUsed + 1)
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('minimax:media-complete'))
        }

        try {
          const jsonOut = parsedOut
          const tid = jsonOut?.task_id || jsonOut?.taskId
          if (tid) {
            setTaskId(tid)
            setStatus('Task created. Waiting for completion...')
          } else {
            setError('No task ID returned')
            setLoading(false)
          }
        } catch {
          // Try to extract task ID from stdout
          const match = data.stdout.match(/task[-_]?id[:\s]+([\w-]+)/i)
          if (match) {
            setTaskId(match[1])
            setStatus('Task created. Waiting for completion...')
          } else {
            setError('Could not parse task response')
            setLoading(false)
          }
        }
      } else {
        setError(data.stderr || data.stdout || 'Video generation failed')
        setLoading(false)
      }
    } catch (e) {
      setError(e.message)
      setLoading(false)
    }
  }

  // Poll for task status
  useEffect(() => {
    if (!taskId) return
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/minimax/cli', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            command: 'video task get',
            args: ['--task-id', taskId],
          }),
        })
        const data = await res.json()
        if (data.success && data.returncode === 0) {
          try {
            const jsonOut = JSON.parse(data.stdout)
            const taskStatus = jsonOut.status || jsonOut.data?.status
            const fileId = jsonOut.file_id || jsonOut.data?.file_id

            if (taskStatus === 'Success' || taskStatus === ' success') {
              setStatus('Video ready!')
              setProgress(100)
              setLoading(false)
              if (fileId) {
                // Download the video
                const videoPath = `workspace/video_${Date.now()}.mp4`
                const dlRes = await fetch('/api/minimax/cli', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    command: 'video download',
                    args: ['--file-id', fileId, '--out', videoPath],
                  }),
                })
                const dlData = await dlRes.json()
                if (dlData.success && dlData.returncode === 0) {
                  setResult(videoPath)
                  // Capture cost from the download response if not already set
                  if (!cost) {
                    const cc = dlData.cost_credits
                    const cu = dlData.cost_usd
                    if (typeof cc === 'number' || typeof cu === 'number') {
                      setCost({ cost_credits: cc, cost_usd: cu })
                    }
                  }
                  fetchHistory()
                  // Refresh authoritative daily quota after a successful gen
                  fetchDailyQuota()
                  if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('minimax:media-complete'))
                  }
                }
              }
              clearInterval(interval)
            } else if (taskStatus === 'Failed' || taskStatus === 'failed') {
              setError('Video generation failed')
              setLoading(false)
              clearInterval(interval)
            } else {
              setStatus(`Status: ${taskStatus || 'Processing'}...`)
              setProgress(prev => Math.min(prev + 10, 90))
            }
          } catch {
            setStatus('Processing...')
          }
        }
      } catch (e) {
        setError(e.message)
        setLoading(false)
        clearInterval(interval)
      }
    }, 8000)

    return () => clearInterval(interval)
  }, [taskId])

  return (
    <div className="flex flex-col h-full bg-card overflow-y-auto">
      <div className="h-14 flex items-center px-6 border-b border-border bg-surface/50">
        <Video size={18} className="text-primary mr-2" />
        <h2 className="text-sm font-semibold">Video Generation</h2>
        <span className="ml-auto text-[10px] text-muted bg-surface px-2 py-1 rounded-full border border-border">Hailuo 2.3</span>
      </div>

      <div className="flex-1 p-6 max-w-4xl mx-auto w-full space-y-5">
        <div className="bg-surface border border-border rounded-xl p-4">
          <p className="text-sm text-muted">MiniMax Hailuo-2.3 — T2V, I2V, SEF, and S2V modes</p>
        </div>

        {/* Mode selector */}
        <div className="flex gap-2">
          {[
            { id: 'text2video', label: 'Text to Video', icon: Video, tip: 'Generate video from a text description' },
            { id: 'image2video', label: 'Image to Video', icon: Image, tip: 'Animate a starting image into a video' },
            { id: 'sef', label: 'Start-End Frames', icon: Film, tip: 'Generate video transitioning from a start image to an end image' },
            { id: 's2v', label: 'Subject to Video', icon: User, tip: 'Keep a subject consistent across the video' },
          ].map((m) => {
            const Icon = m.icon
            return (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors border ${
                  mode === m.id
                    ? 'bg-primary text-white border-primary'
                    : 'bg-surface border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon size={12} />
                <span title={m.tip}>{m.label}</span>
              </button>
            )
          })}
        </div>

        {/* Model */}
        <div>
          <label className="text-sm font-medium text-foreground mb-2 block">Model</label>
          <div className="grid grid-cols-2 gap-2">
            {VIDEO_MODELS.map((m) => (
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
          <label className="text-sm font-medium text-foreground mb-2 block">Prompt</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe the video scene, motion, and style..."
            className="w-full bg-card border border-border rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted resize-none focus:outline-none focus:border-primary transition-colors"
            rows={4}
          />
          <div className="flex items-center justify-between mt-1">
            <p className={`text-xs ${prompt.length > 2000 ? 'text-error' : 'text-muted'}`}>{prompt.length.toLocaleString()} / 2,000 characters</p>
            {prompt.length > 2000 && <p className="text-xs text-error">Exceeds limit!</p>}
          </div>
        </div>

        {/* Image inputs for advanced modes */}
        {(mode === 'image2video' || mode === 'sef' || mode === 's2v') && (
          <div className="space-y-3">
            {(mode === 'image2video' || mode === 'sef') && (
              <div>
                <label className="text-sm font-medium text-foreground mb-2 flex items-center gap-1.5">
                  <Image size={14} /> First Frame (image path or URL)
                </label>
                <input
                  type="text"
                  value={firstFrame}
                  onChange={(e) => setFirstFrame(e.target.value)}
                  placeholder="./first_frame.png or https://..."
                  className="w-full bg-card border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-primary"
                />
              </div>
            )}
            {mode === 'sef' && (
              <div>
                <label className="text-sm font-medium text-foreground mb-2 flex items-center gap-1.5">
                  <Film size={14} /> Last Frame (image path or URL)
                </label>
                <input
                  type="text"
                  value={lastFrame}
                  onChange={(e) => setLastFrame(e.target.value)}
                  placeholder="./last_frame.png or https://..."
                  className="w-full bg-card border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-primary"
                />
              </div>
            )}
            {mode === 's2v' && (
              <div>
                <label className="text-sm font-medium text-foreground mb-2 flex items-center gap-1.5">
                  <User size={14} /> Subject Reference (image path or URL)
                </label>
                <input
                  type="text"
                  value={subjectImage}
                  onChange={(e) => setSubjectImage(e.target.value)}
                  placeholder="./subject.png or https://..."
                  className="w-full bg-card border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-primary"
                />
              </div>
            )}
          </div>
        )}

        <button
          onClick={generate}
          disabled={loading || !prompt.trim()}
          className="w-full py-3 bg-primary hover:bg-primary-hover disabled:opacity-40 text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
        >
          {loading ? <Loader2 size={18} className="animate-spin" /> : <Video size={18} />}
          {loading ? 'Submitting Task...' : 'Generate Video'}
        </button>

        {/* Progress */}
        {loading && taskId && (
          <div className="bg-surface border border-border rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-3">
              <RefreshCw size={16} className="text-primary animate-spin" />
              <div className="flex-1">
                <p className="text-sm text-muted">{status}</p>
                <p className="text-[10px] text-muted font-mono">Task ID: {taskId}</p>
              </div>
              <span className="text-xs font-mono text-primary">{progress}%</span>
            </div>
            <div className="h-2 bg-card rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-1000"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {error && (
          <div className="bg-error/10 border border-error/20 rounded-xl p-4 text-sm text-error">{error}</div>
        )}

        {result && (
          <div className="bg-surface border border-border rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <p className="text-sm text-muted flex items-center gap-2">
                <Check size={14} className="text-success" /> Video generated
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                {cost && (
                  <div
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/5 border border-primary/20 text-[10px] font-medium text-primary"
                    title="Cost for this generation"
                  >
                    <Coins size={11} />
                    <span>
                      {t('media.costLabel', {
                        credits: cost.cost_credits ?? 0,
                        usd: typeof cost.cost_usd === 'number' ? cost.cost_usd.toFixed(4) : '0.0000',
                      })}
                    </span>
                  </div>
                )}
                {videoDailyLimit !== null && videoDailyLimit !== undefined && (
                  <div
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-medium ${
                      (videoDailyUsed ?? 0) >= videoDailyLimit
                        ? 'bg-error/10 border-error/20 text-error'
                        : (videoDailyUsed ?? 0) / Math.max(videoDailyLimit, 1) >= 0.8
                          ? 'bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400'
                          : 'bg-surface border-border text-muted-foreground'
                    }`}
                    title="Daily video generation quota"
                  >
                    {(videoDailyUsed ?? 0) >= videoDailyLimit && <AlertTriangle size={10} />}
                    <span>{t('media.dailyLabel', { used: videoDailyUsed ?? 0, limit: videoDailyLimit })}</span>
                  </div>
                )}
              </div>
            </div>
            <video
              controls
              className="w-full rounded-lg border border-border"
              src={`/api/files/content?path=${encodeURIComponent(result)}`}
            />
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
          type="video"
          items={history}
          loading={historyLoading}
          onRefresh={fetchHistory}
          emptyMessage="No generated videos yet"
        />
      </div>
    </div>
  )
}
