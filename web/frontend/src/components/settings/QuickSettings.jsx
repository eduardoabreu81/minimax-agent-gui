import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  X, Sliders, Moon, Sun, Key, Zap, Shield, Cpu, Layers,
  Check, AlertCircle, Globe, MapPin
} from 'lucide-react'

export default function QuickSettings({ isOpen, onClose, isDark, onToggleTheme }) {
  const { t, i18n } = useTranslation()
  const [config, setConfig] = useState({})
  const [apiKeySet, setApiKeySet] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    fetch('/api/config')
      .then(r => r.json())
      .then(data => {
        setConfig(data)
        setApiKeySet(!!data.api_key_configured)
      })
      .catch(() => setConfig({}))
  }, [isOpen])

  if (!isOpen) return null

  const model = config.agent?.model || 'MiniMax-M3'
  const maxSteps = config.agent?.max_steps || 50
  const workspaceDir = config.agent?.workspace_dir || './workspace'
  const region = config.region || 'global'

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 w-80 bg-card border-l border-border shadow-2xl z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Sliders size={16} className="text-primary" />
            <h2 className="text-sm font-semibold">{t('settings.title')}</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-surface text-muted">
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* API Status */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-muted uppercase tracking-wider flex items-center gap-1.5">
              <Globe size={12} /> Language
            </h3>
            <div className="grid grid-cols-2 gap-1.5">
              {[
                { code: 'en', label: 'English' },
                { code: 'pt-BR', label: 'Português' },
                { code: 'ja', label: '日本語' },
                { code: 'ko', label: '한국어' },
                { code: 'es', label: 'Español' },
                { code: 'zh-CN', label: '简体中文' },
              ].map((lang) => (
                <button
                  key={lang.code}
                  onClick={() => i18n.changeLanguage(lang.code)}
                  className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs transition-colors ${
                    i18n.language === lang.code
                      ? 'bg-primary/10 text-primary border border-primary/20'
                      : 'bg-surface border border-border text-foreground hover:border-primary'
                  }`}
                >
                  {i18n.language === lang.code && <Check size={10} />}
                  {lang.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-muted uppercase tracking-wider flex items-center gap-1.5">
              <Key size={12} /> {t('settings.apiStatus')}
            </h3>
            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${apiKeySet ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
              {apiKeySet ? (
                <Check size={14} className="text-green-500" />
              ) : (
                <AlertCircle size={14} className="text-amber-500" />
              )}
              <span className={`text-xs font-medium ${apiKeySet ? 'text-green-700' : 'text-amber-700'}`}>
                {apiKeySet ? t('settings.apiConfigured') : t('settings.apiMissing')}
              </span>
            </div>
          </div>

          {/* Model */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-muted uppercase tracking-wider flex items-center gap-1.5">
              <Cpu size={12} /> {t('settings.model')}
            </h3>
            <div className="space-y-1.5">
              {['MiniMax-M3', 'MiniMax-Hailuo-2.3', 'MiniMax-speech-2.8', 'MiniMax-image-01'].map(m => (
                <div
                  key={m}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors ${
                    model === m ? 'bg-primary/10 text-primary border border-primary/20' : 'bg-surface border border-border text-foreground'
                  }`}
                >
                  <Zap size={12} />
                  <span className="flex-1">{m}</span>
                  {model === m && <Check size={12} />}
                </div>
              ))}
            </div>
          </div>

          {/* Appearance */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-muted uppercase tracking-wider flex items-center gap-1.5">
              <Layers size={12} /> {t('settings.appearance')}
            </h3>
            <button
              onClick={onToggleTheme}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg bg-surface border border-border hover:border-primary transition-colors"
            >
              {isDark ? <Moon size={14} className="text-primary" /> : <Sun size={14} className="text-amber-500" />}
              <span className="text-xs text-foreground">{isDark ? t('settings.darkMode') : t('settings.lightMode')}</span>
              <span className="ml-auto text-[10px] text-muted">Click to toggle</span>
            </button>
          </div>

          {/* Agent Settings */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-muted uppercase tracking-wider flex items-center gap-1.5">
              <Shield size={12} /> {t('settings.agent')}
            </h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted">{t('settings.maxSteps')}</span>
                <span className="font-mono text-foreground">{maxSteps}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted">{t('settings.workspace')}</span>
                <span className="font-mono text-foreground truncate max-w-32">{workspaceDir}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border bg-surface/50">
          <p className="text-[10px] text-muted text-center">
            {t('settings.configHint')}
          </p>
        </div>
      </div>
    </>
  )
}
