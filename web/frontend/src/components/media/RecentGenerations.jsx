import { RefreshCw, Save, Loader2 } from 'lucide-react'

/**
 * RecentGenerations — reusable history gallery for media panels.
 *
 * Props:
 *   title         — section header text (default: "Recent Generations")
 *   type          — 'image' | 'music' | 'video' | 'tts'
 *   items         — array of file objects { name, path, size, modified_at }
 *   loading       — boolean
 *   error         — string | null
 *   onRefresh     — () => void
 *   emptyMessage  — string (default: "No recent generations")
 */
export default function RecentGenerations({
  title = 'Recent Generations',
  type,
  items = [],
  loading = false,
  error = null,
  onRefresh,
  emptyMessage = 'No recent generations',
}) {
  const mediaUrl = (path) => `/api/files/download?path=${encodeURIComponent(path)}`

  const formatSize = (size) => {
    if (!size) return ''
    if (size > 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
    return `${(size / 1024).toFixed(1)} KB`
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-foreground">{title}</h3>
          {items.length > 0 && (
            <span className="text-[10px] text-muted bg-surface border border-border rounded-full px-2 py-0.5">
              {items.length}
            </span>
          )}
        </div>
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={loading}
            className="p-1.5 rounded-lg hover:bg-surface text-muted hover:text-foreground transition-colors"
            title="Refresh"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
        )}
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-xs text-muted py-2">
          <Loader2 size={12} className="animate-spin" /> Loading...
        </div>
      )}

      {error && !loading && (
        <p className="text-xs text-error py-2">{error}</p>
      )}

      {!loading && !error && items.length === 0 && (
        <p className="text-xs text-muted py-2">{emptyMessage}</p>
      )}

      {!loading && !error && items.length > 0 && (
        <>
          {type === 'image' && (
            <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
              {items.map((item) => (
                <div
                  key={item.path}
                  className="bg-surface border border-border rounded-xl overflow-hidden group"
                >
                  <div className="relative aspect-square">
                    <img
                      src={mediaUrl(item.path)}
                      alt={item.name}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                      <a
                        href={mediaUrl(item.path)}
                        download={item.name}
                        className="p-1.5 bg-white/90 rounded-lg hover:bg-white transition-colors"
                        title="Download"
                      >
                        <Save size={12} className="text-black" />
                      </a>
                    </div>
                  </div>
                  <p className="px-2 py-1.5 text-[10px] text-muted truncate" title={item.name}>
                    {item.name}
                  </p>
                </div>
              ))}
            </div>
          )}

          {(type === 'music' || type === 'tts') && (
            <div className="space-y-2">
              {items.map((item) => (
                <div
                  key={item.path}
                  className="bg-surface border border-border rounded-xl p-3 space-y-2"
                >
                  <p className="text-xs font-medium text-foreground truncate" title={item.name}>
                    {item.name}
                  </p>
                  <audio
                    controls
                    className="w-full h-8"
                    src={mediaUrl(item.path)}
                  />
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] text-muted">{formatSize(item.size)}</p>
                    <a
                      href={mediaUrl(item.path)}
                      download={item.name}
                      className="px-3 py-1 bg-primary hover:bg-primary-hover text-white text-xs rounded-lg transition-colors flex items-center gap-1"
                    >
                      <Save size={10} /> Download
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}

          {type === 'video' && (
            <div className="space-y-2">
              {items.map((item) => (
                <div
                  key={item.path}
                  className="bg-surface border border-border rounded-xl p-3 space-y-2"
                >
                  <p className="text-xs font-medium text-foreground truncate" title={item.name}>
                    {item.name}
                  </p>
                  <video
                    controls
                    className="w-full h-32 rounded-lg border border-border object-cover"
                    src={mediaUrl(item.path)}
                  />
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] text-muted">{formatSize(item.size)}</p>
                    <a
                      href={mediaUrl(item.path)}
                      download={item.name}
                      className="px-3 py-1 bg-primary hover:bg-primary-hover text-white text-xs rounded-lg transition-colors flex items-center gap-1"
                    >
                      <Save size={10} /> Download
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
