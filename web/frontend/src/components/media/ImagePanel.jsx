import { useState, useEffect, useRef } from 'react'
import { Image, Loader2, Download, Wand2, Copy, Grid3x3, Trash2, Eye, Upload, Link2, X } from 'lucide-react'
import { useSessionProtection } from '../../hooks/useSessionProtection'
import RecentGenerations from './RecentGenerations'

const ASPECT_RATIOS = [
  { label: '1:1 Square', value: '1:1', width: 1024, height: 1024 },
  { label: '16:9 Widescreen', value: '16:9', width: 1280, height: 720 },
  { label: '9:16 Portrait', value: '9:16', width: 720, height: 1280 },
  { label: '4:3 Classic', value: '4:3', width: 1152, height: 864 },
  { label: '3:2 Photo', value: '3:2', width: 1248, height: 832 },
  { label: '2:3 Portrait', value: '2:3', width: 832, height: 1248 },
  { label: '3:4 Portrait', value: '3:4', width: 864, height: 1152 },
  { label: '21:9 Cinema', value: '21:9', width: 1344, height: 576 },
]

export default function ImagePanel() {
  const [activeTab, setActiveTab] = useState('t2i') // 't2i' | 'i2i'
  const [prompt, setPrompt] = useState('')
  const [aspectRatio, setAspectRatio] = useState('1:1')
  const [customWidth, setCustomWidth] = useState(1024)
  const [customHeight, setCustomHeight] = useState(1024)
  const [useCustomSize, setUseCustomSize] = useState(false)
  const [batchCount, setBatchCount] = useState(1)
  const [promptOptimizer, setPromptOptimizer] = useState(false)
  const [watermark, setWatermark] = useState(false)
  const [seed, setSeed] = useState('')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState([])
  const [error, setError] = useState(null)
  const [gallery, setGallery] = useState([])
  const [galleryLoading, setGalleryLoading] = useState(false)

  // I2I state
  const [referenceImage, setReferenceImage] = useState(null) // { name, path, url }
  const [referenceUrl, setReferenceUrl] = useState('')
  const fileInputRef = useRef(null)

  const { register } = useSessionProtection()

  useEffect(() => {
    register('image-loading', loading, 'Image generation in progress')
  }, [loading, register])

  useEffect(() => {
    register('image-prompt', prompt.trim().length > 0, 'Unsaved image prompt')
  }, [prompt, register])

  useEffect(() => {
    register('image-reference', !!referenceImage, 'Reference image selected')
  }, [referenceImage, register])

  useEffect(() => { fetchGallery() }, [])

  const fetchGallery = async () => {
    setGalleryLoading(true)
    try {
      // Primary source: /api/generations (has size, modified_at)
      const genRes = await fetch('/api/generations')
      const genData = await genRes.json()
      let images = []
      if (genData.success && genData.data?.images) {
        images = genData.data.images
      }

      // Fallback: scan workspace root for image files with generation patterns
      const wsRes = await fetch('/api/files?path=workspace')
      const wsData = await wsRes.json()
      if (wsData.entries) {
        const wsImages = wsData.entries
          .filter(e => !e.is_dir && /\.(png|jpg|jpeg|webp|gif)$/i.test(e.name))
          .filter(e => /^(image_|generated_image)/i.test(e.name))
          .map(e => ({ name: e.name, path: e.path, size: 0 }))
        // Merge, avoiding duplicates by path
        const seen = new Set(images.map(i => i.path))
        wsImages.forEach(img => {
          if (!seen.has(img.path)) images.push(img)
        })
      }

      // Sort by modified_at desc, fallback to name desc
      images.sort((a, b) => {
        if (a.modified_at && b.modified_at) return b.modified_at.localeCompare(a.modified_at)
        return b.name.localeCompare(a.name)
      })

      setGallery(images)
    } catch (e) { /* ignore */ }
    setGalleryLoading(false)
  }

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const formData = new FormData()
    formData.append('file', file)
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData })
      const data = await res.json()
      if (data.success) {
        setReferenceImage({ name: file.name, path: data.path })
        setReferenceUrl('')
      }
    } catch (err) { console.error('Upload failed:', err) }
    e.target.value = ''
  }

  const downloadUrl = (path) => `/api/files/download?path=${encodeURIComponent(path)}`

  const generate = async () => {
    if (!prompt.trim()) return
    if (activeTab === 'i2i' && !referenceImage && !referenceUrl) {
      setError('Please upload a reference image or provide a URL')
      return
    }
    setLoading(true)
    setError(null)
    setResults([])
    try {
      const body = {
        prompt,
        aspect_ratio: useCustomSize ? undefined : aspectRatio,
        width: useCustomSize ? customWidth : undefined,
        height: useCustomSize ? customHeight : undefined,
        n: batchCount,
        prompt_optimizer: promptOptimizer,
        watermark: watermark,
        seed: seed ? parseInt(seed) : undefined,
      }

      const endpoint = activeTab === 'i2i' ? '/api/image/i2i' : '/api/image'
      if (activeTab === 'i2i') {
        body.reference_image = referenceImage ? referenceImage.path : referenceUrl
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.success) {
        setResults([{ path: data.file_path }])
        fetchGallery()
      } else {
        setError(data.error || 'Image generation failed')
      }
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }

  return (
    <div className="flex flex-col h-full bg-card overflow-y-auto">
      <div className="h-14 flex items-center px-6 border-b border-border bg-surface/50">
        <Image size={18} className="text-primary mr-2" />
        <h2 className="text-sm font-semibold">Image Generation</h2>
        <span className="ml-auto text-[10px] text-muted bg-surface px-2 py-1 rounded-full border border-border">image-01</span>
      </div>

      <div className="flex-1 p-6 max-w-4xl mx-auto w-full space-y-5">
        {/* Tabs */}
        <div className="flex bg-surface border border-border rounded-xl p-1">
          <button
            onClick={() => setActiveTab('t2i')}
            className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${
              activeTab === 't2i' ? 'bg-primary text-white' : 'text-muted hover:text-foreground'
            }`}
          >
            Text to Image
          </button>
          <button
            onClick={() => setActiveTab('i2i')}
            className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${
              activeTab === 'i2i' ? 'bg-primary text-white' : 'text-muted hover:text-foreground'
            }`}
          >
            Image to Image
          </button>
        </div>

        {/* Reference image for I2I */}
        {activeTab === 'i2i' && (
          <div className="bg-surface border border-border rounded-xl p-4 space-y-3">
            <label className="text-sm font-medium text-foreground block">Reference Image</label>

            {/* Upload or URL */}
            <div className="flex gap-2">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleImageUpload}
                accept="image/*"
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 px-3 py-2 bg-card border border-border rounded-lg text-xs hover:border-primary transition-colors"
              >
                <Upload size={14} /> Upload Image
              </button>
              <div className="flex-1 flex items-center gap-2">
                <Link2 size={14} className="text-muted" />
                <input
                  type="text"
                  value={referenceUrl}
                  onChange={(e) => { setReferenceUrl(e.target.value); setReferenceImage(null) }}
                  placeholder="Or paste image URL..."
                  className="flex-1 bg-card border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted focus:outline-none focus:border-primary"
                />
              </div>
            </div>

            {/* Preview */}
            {referenceImage && (
              <div className="relative w-fit">
                <img
                  src={downloadUrl(referenceImage.path)}
                  alt="Reference"
                  className="max-w-[200px] max-h-[150px] rounded-lg border border-border object-cover"
                />
                <button
                  onClick={() => setReferenceImage(null)}
                  className="absolute -top-2 -right-2 p-1 bg-error text-white rounded-full"
                >
                  <X size={12} />
                </button>
                <p className="text-[10px] text-muted mt-1">{referenceImage.name}</p>
              </div>
            )}
            {referenceUrl && !referenceImage && (
              <div className="relative w-fit">
                <img
                  src={referenceUrl}
                  alt="Reference"
                  className="max-w-[200px] max-h-[150px] rounded-lg border border-border object-cover"
                  onError={(e) => { e.target.style.display = 'none' }}
                />
                <button
                  onClick={() => setReferenceUrl('')}
                  className="absolute -top-2 -right-2 p-1 bg-error text-white rounded-full"
                >
                  <X size={12} />
                </button>
                <p className="text-[10px] text-muted mt-1 truncate max-w-[200px]">{referenceUrl}</p>
              </div>
            )}
          </div>
        )}

        {/* Prompt */}
        <div>
          <label className="text-sm font-medium text-foreground mb-2 block">
            {activeTab === 'i2i' ? 'Prompt (describe the transformation)' : 'Prompt'}
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value.slice(0, 2000))}
            placeholder={activeTab === 'i2i' ? "Describe how to transform the reference image..." : "Describe the image you want to generate..."}
            className="w-full bg-card border border-border rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted resize-none focus:outline-none focus:border-primary transition-colors"
            rows={4}
          />
          <div className="flex items-center justify-between mt-1">
            <p className="text-xs text-muted">{prompt.length.toLocaleString()} / 2,000 characters</p>
            {prompt.length > 2000 && <p className="text-xs text-error">Exceeds limit!</p>}
          </div>
        </div>

        {/* Aspect Ratio */}
        <div>
          <label className="text-sm font-medium text-foreground mb-2 flex items-center gap-1.5">
            <Grid3x3 size={14} /> Aspect Ratio
          </label>
          <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
            {ASPECT_RATIOS.map((ar) => (
              <button
                key={ar.value}
                onClick={() => { setAspectRatio(ar.value); setUseCustomSize(false) }}
                className={`flex flex-col items-center gap-1 px-2 py-2 rounded-lg border transition-colors ${
                  aspectRatio === ar.value && !useCustomSize
                    ? 'bg-primary/10 border-primary text-primary'
                    : 'bg-surface border-border text-foreground hover:border-primary'
                }`}
              >
                <div
                  className="border-2 border-current rounded"
                  style={{
                    width: ar.value === '1:1' ? 20 : ar.value === '16:9' ? 28 : ar.value === '9:16' ? 12 : ar.value === '4:3' ? 24 : ar.value === '3:2' ? 26 : ar.value === '2:3' ? 12 : ar.value === '3:4' ? 14 : ar.value === '21:9' ? 32 : 20,
                    height: ar.value === '1:1' ? 20 : ar.value === '16:9' ? 16 : ar.value === '9:16' ? 22 : ar.value === '4:3' ? 18 : ar.value === '3:2' ? 17 : ar.value === '2:3' ? 22 : ar.value === '3:4' ? 20 : ar.value === '21:9' ? 7 : 20,
                  }}
                />
                <span className="text-[9px] leading-tight text-center">{ar.label.split(' ')[0]}</span>
                <span className="text-[8px] text-muted">{ar.width}×{ar.height}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Custom size toggle */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setUseCustomSize(!useCustomSize)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs border transition-colors ${
              useCustomSize ? 'bg-primary/10 border-primary text-primary' : 'bg-surface border-border text-foreground'
            }`}
          >
            <Copy size={12} /> Custom Size
          </button>
          {useCustomSize && (
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={customWidth}
                onChange={(e) => setCustomWidth(parseInt(e.target.value) || 512)}
                min={512}
                max={2048}
                step={8}
                className="w-20 bg-card border border-border rounded-lg px-2 py-1 text-xs text-foreground"
              />
              <span className="text-muted text-xs">×</span>
              <input
                type="number"
                value={customHeight}
                onChange={(e) => setCustomHeight(parseInt(e.target.value) || 512)}
                min={512}
                max={2048}
                step={8}
                className="w-20 bg-card border border-border rounded-lg px-2 py-1 text-xs text-foreground"
              />
              <span className="text-[10px] text-muted">512-2048, multiple of 8</span>
            </div>
          )}
        </div>

        {/* Advanced options */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-sm font-medium text-foreground mb-2 flex items-center gap-1.5">
              <Copy size={14} /> Batch Count
            </label>
            <input
              type="number"
              min={1}
              max={4}
              value={batchCount}
              onChange={(e) => setBatchCount(Math.min(4, Math.max(1, parseInt(e.target.value) || 1)))}
              className="w-full bg-card border border-border rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-foreground mb-2 block">Seed (optional)</label>
            <input
              type="number"
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              placeholder="Random"
              className="w-full bg-card border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-primary"
            />
          </div>
          <div className="space-y-2 pt-6">
            <label className="flex items-center gap-2 cursor-pointer" title="Let MiniMax improve and expand your prompt for better image quality">
              <input
                type="checkbox"
                checked={promptOptimizer}
                onChange={(e) => setPromptOptimizer(e.target.checked)}
                className="rounded border-border text-primary focus:ring-primary"
              />
              <span className="text-xs text-foreground flex items-center gap-1">
                <Wand2 size={12} /> Prompt Optimizer
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer" title="Add an invisible digital watermark to identify the image as AI-generated">
              <input
                type="checkbox"
                checked={watermark}
                onChange={(e) => setWatermark(e.target.checked)}
                className="rounded border-border text-primary focus:ring-primary"
              />
              <span className="text-xs text-foreground">AIGC Watermark</span>
            </label>
          </div>
        </div>

        <button
          onClick={generate}
          disabled={loading || !prompt.trim()}
          className="w-full py-3 bg-primary hover:bg-primary-hover disabled:opacity-40 text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
        >
          {loading ? <Loader2 size={18} className="animate-spin" /> : <Image size={18} />}
          {loading ? `Generating ${batchCount > 1 ? batchCount + ' images' : '...'}` : `Generate ${batchCount > 1 ? batchCount + ' Images' : 'Image'}`}
        </button>

        {error && (
          <div className="bg-error/10 border border-error/20 rounded-xl p-4 text-sm text-error">{error}</div>
        )}

        {/* Generated results */}
        {results.length > 0 && (
          <div className="space-y-3">
            <p className="text-sm text-muted">Generated {results.length} image(s)</p>
            <div className={`grid gap-3 ${results.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {results.map((r, i) => (
                <div key={i} className="bg-surface border border-border rounded-xl p-3 space-y-2">
                  <img
                    src={downloadUrl(r.path)}
                    alt={`Generated ${i + 1}`}
                    className="w-full rounded-lg border border-border"
                    onError={(e) => { e.target.style.display = 'none' }}
                  />
                  <div className="flex gap-2">
                    <a
                      href={downloadUrl(r.path)}
                      download={r.path.split('/').pop()}
                      className="flex-1 px-3 py-1.5 bg-primary hover:bg-primary-hover text-white text-xs rounded-lg transition-colors flex items-center justify-center gap-1.5"
                    >
                      <Download size={12} /> Save
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent Generations */}
        <RecentGenerations
          title="Recent Generations"
          type="image"
          items={gallery}
          loading={galleryLoading}
          onRefresh={fetchGallery}
          emptyMessage="No generated images yet"
        />
      </div>
    </div>
  )
}
