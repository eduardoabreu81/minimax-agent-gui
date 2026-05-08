import { createContext, useContext, useState, useCallback, useMemo } from 'react'

const AgentActivityContext = createContext(null)

export function AgentActivityProvider({ children }) {
  const [steps, setSteps] = useState([])
  const [toolResults, setToolResults] = useState([])
  const [thinking, setThinking] = useState({ active: false, duration: 0, content: '' })
  const [lastTool, setLastTool] = useState(null)
  const [plan, setPlan] = useState({ items: [] })
  const [hasNewActivity, setHasNewActivity] = useState(false)

  const addStep = useCallback((step, maxSteps) => {
    setSteps(prev => {
      const exists = prev.find(s => s.step === step)
      if (exists) {
        return prev.map(s => s.step === step ? { ...s, status: 'running', timestamp: Date.now() } : s)
      }
      return [...prev, { step, maxSteps, status: 'running', timestamp: Date.now() }]
    })
    setHasNewActivity(true)
  }, [])

  const completeStep = useCallback((step) => {
    setSteps(prev => prev.map(s => s.step === step ? { ...s, status: 'done' } : s))
  }, [])

  const addToolResult = useCallback((data) => {
    const entry = {
      tool: data.tool,
      arguments: data.arguments,
      success: data.success,
      content: data.content,
      error: data.error,
      timestamp: Date.now(),
    }
    setToolResults(prev => [...prev, entry])
    setLastTool(entry)
    setHasNewActivity(true)
  }, [])

  const setThinkingState = useCallback((active, content = '') => {
    setThinking({ active, duration: active ? thinking.duration : 0, content })
  }, [thinking.duration])

  const setThinkingDuration = useCallback((duration) => {
    setThinking(prev => ({ ...prev, duration }))
  }, [])

  const updatePlan = useCallback((items) => {
    setPlan({ items: items.map((item, i) => ({ id: i, text: item, status: 'pending' })) })
  }, [])

  const markPlanItemDone = useCallback((id) => {
    setPlan(prev => ({
      items: prev.items.map(item => item.id === id ? { ...item, status: 'done' } : item)
    }))
  }, [])

  const clearActivity = useCallback(() => {
    setSteps([])
    setToolResults([])
    setThinking({ active: false, duration: 0, content: '' })
    setLastTool(null)
    setPlan({ items: [] })
    setHasNewActivity(false)
  }, [])

  const acknowledgeActivity = useCallback(() => {
    setHasNewActivity(false)
  }, [])

  const value = useMemo(() => ({
    steps,
    toolResults,
    thinking,
    lastTool,
    plan,
    hasNewActivity,
    addStep,
    completeStep,
    addToolResult,
    setThinkingState,
    setThinkingDuration,
    updatePlan,
    markPlanItemDone,
    clearActivity,
    acknowledgeActivity,
  }), [steps, toolResults, thinking, lastTool, plan, hasNewActivity, addStep, completeStep, addToolResult, setThinkingState, setThinkingDuration, updatePlan, markPlanItemDone, clearActivity, acknowledgeActivity])

  return (
    <AgentActivityContext.Provider value={value}>
      {children}
    </AgentActivityContext.Provider>
  )
}

export function useAgentActivity() {
  const ctx = useContext(AgentActivityContext)
  if (!ctx) throw new Error('useAgentActivity must be used inside AgentActivityProvider')
  return ctx
}
