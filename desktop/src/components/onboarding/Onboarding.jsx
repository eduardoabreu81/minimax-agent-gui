import { useState, useEffect } from 'react'
import {
  X, ChevronRight, ChevronLeft, MessageSquare, Code2, Layout,
  Volume2, Image, Music, Video, Sparkles, Check
} from 'lucide-react'

const STEPS = [
  {
    id: 'welcome',
    title: 'Welcome to MiniMax Agent',
    description: 'Your all-in-one platform for MiniMax Token Plan. Chat, generate media, code, and manage tasks — all in one place.',
    icon: Sparkles,
    color: 'text-primary',
  },
  {
    id: 'chat',
    title: 'Agent Chat',
    description: 'Chat with the MiniMax AI agent. Ask questions, get help with coding, or brainstorm ideas. Use Ctrl+Enter to send messages.',
    icon: MessageSquare,
    color: 'text-blue-500',
  },
  {
    id: 'media',
    title: 'Media Generation',
    description: 'Generate text-to-speech, images, music, and videos using MiniMax APIs. Switch between panels using the sidebar.',
    icon: Image,
    color: 'text-purple-500',
  },
  {
    id: 'code',
    title: 'Coding Workspace',
    description: 'Explore files, edit code with syntax highlighting, use the integrated terminal, and manage Git — all without leaving the app.',
    icon: Code2,
    color: 'text-green-500',
  },
  {
    id: 'tasks',
    title: 'Task Board',
    description: 'Organize your work with a Kanban board. Create tasks, track progress with subtasks, and manage priorities.',
    icon: Layout,
    color: 'text-amber-500',
  },
  {
    id: 'tips',
    title: 'Pro Tips',
    description: 'Press Ctrl+K to open the Command Palette from anywhere. Use Ctrl+Enter to send chat messages. Your tasks are saved automatically.',
    icon: Sparkles,
    color: 'text-primary',
  },
]

export default function Onboarding({ onComplete }) {
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
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(s => s + 1)
    } else {
      handleClose()
    }
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
            >
              <X size={16} />
            </button>
          </div>

          {/* Content */}
          <h2 className="text-lg font-semibold text-foreground mb-2">{step.title}</h2>
          <p className="text-sm text-muted-foreground leading-relaxed mb-8">{step.description}</p>

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
              Skip tour
            </button>
            <div className="flex items-center gap-2">
              {currentStep > 0 && (
                <button
                  onClick={handlePrev}
                  className="px-4 py-2 bg-surface border border-border hover:border-primary text-foreground rounded-lg text-xs font-medium transition-colors flex items-center gap-1"
                >
                  <ChevronLeft size={14} /> Back
                </button>
              )}
              <button
                onClick={handleNext}
                className="px-4 py-2 bg-primary hover:bg-primary-hover text-white rounded-lg text-xs font-medium transition-colors flex items-center gap-1"
              >
                {currentStep === STEPS.length - 1 ? (
                  <><Check size={14} /> Get Started</>
                ) : (
                  <><>Next</> <ChevronRight size={14} /></>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
