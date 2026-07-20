import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  X, ChevronRight, ChevronLeft, MessageSquare, Code2, Layout,
  Volume2, Image, Music, Video, Sparkles, Check
} from 'lucide-react'

// Step ids stay in code (we map them to i18n keys at render time).
// Icons + accent colors live in JSX so they don't go through i18n.
const STEPS = [
  { id: 'welcome', icon: Sparkles, color: 'text-primary' },
  { id: 'chat',    icon: MessageSquare, color: 'text-blue-500' },
  { id: 'media',   icon: Image, color: 'text-purple-500' },
  { id: 'code',    icon: Code2, color: 'text-green-500' },
  { id: 'tasks',   icon: Layout, color: 'text-amber-500' },
  { id: 'tips',    icon: Sparkles, color: 'text-primary' },
]

export default function Onboarding({ onComplete }) {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)

  useEffect(() => {
    const seen = localStorage.getItem('minimax-onboarding-seen')
    if (!seen) {
      setIsOpen(true)
    }
  }, [])

  const handleClose = () => {
    setIsOpen(false)
    localStorage.setItem('minimax-onboarding-seen', 'true')
    onComplete?.()
  }

  const handleNext = () => {
    if (currentStep === STEPS.length - 1) handleClose()
    else setCurrentStep(s => Math.min(STEPS.length - 1, s + 1))
  }

  const handlePrev = () => {
    setCurrentStep(s => Math.max(0, s - 1))
  }

  if (!isOpen) return null

  const step = STEPS[currentStep]
  const Icon = step.icon
  const progress = ((currentStep + 1) / STEPS.length) * 100

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={(e) => e.target === e.currentTarget && handleClose()}>
      <div className="w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
        {/* Progress bar */}
        <div className="h-1 bg-surface">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="p-8">
          {/* Header */}
          <div className="flex items-start justify-between mb-6">
            <div className={`w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center ${step.color}`}>
              <Icon size={24} />
            </div>
            <button
              onClick={handleClose}
              className="p-1.5 rounded-lg hover:bg-surface text-muted-foreground transition-colors"
              title={t('onboarding.wizardClose')}
            >
              <X size={16} />
            </button>
          </div>

          {/* Content */}
          <h2 className="text-lg font-semibold text-foreground mb-2">{t(`onboarding.${step.id}`)}</h2>
          <p className="text-sm text-muted-foreground leading-relaxed mb-8">{t(`onboarding.${step.id}Desc`)}</p>

          {/* Step indicators */}
          <div className="flex items-center gap-1.5 mb-8">
            {STEPS.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrentStep(i)}
                className={`h-1.5 rounded-full transition-all ${
                  i === currentStep ? 'w-6 bg-primary' : i < currentStep ? 'w-1.5 bg-primary/50' : 'w-1.5 bg-border'
                }`}
              />
            ))}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between">
            <button
              onClick={handleClose}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {t('onboarding.skip')}
            </button>
            <div className="flex items-center gap-2">
              {currentStep > 0 && (
                <button
                  onClick={handlePrev}
                  className="px-4 py-2 bg-surface border border-border hover:border-primary text-foreground rounded-lg text-xs font-medium transition-colors flex items-center gap-1"
                >
                  <ChevronLeft size={14} /> {t('onboarding.back')}
                </button>
              )}
              <button
                onClick={handleNext}
                className="px-4 py-2 bg-primary hover:bg-primary-hover text-white rounded-lg text-xs font-medium transition-colors flex items-center gap-1"
              >
                {currentStep === STEPS.length - 1 ? (
                  <><Check size={14} /> {t('onboarding.getStarted')}</>
                ) : (
                  <>{t('onboarding.next')} <ChevronRight size={14} /></>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
