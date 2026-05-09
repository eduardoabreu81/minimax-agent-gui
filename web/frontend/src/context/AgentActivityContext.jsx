import { createContext, useContext, useState, useCallback, useMemo } from 'react'

const AgentActivityContext = createContext(null)

export function AgentActivityProvider({ children }) {
  const [steps, setSteps] = useState([])
  const [toolResults, setToolResults] = useState([])
  const [thinking, setThinking] = useState({ active: false, duration: 0, content: '' })
  const [lastTool, setLastTool] = useState(null)
  const [plan, setPlan] = useState({ items: [], sourcePrompt: '', sourceAttachment: null, approved: false })
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
    setPlan(prev => ({ ...prev, items: items.map((item, i) => ({ id: i, text: item, status: 'pending' })) }))
  }, [])

  const markPlanItemDone = useCallback((id) => {
    setPlan(prev => ({
      ...prev,
      items: prev.items.map(item => item.id === id ? { ...item, status: 'done' } : item)
    }))
  }, [])

  const createPlan = useCallback((items, sourcePrompt = '', sourceAttachment = null) => {
    setPlan({
      items: items.map((item, i) => ({ id: i, text: item, status: 'pending' })),
      sourcePrompt,
      sourceAttachment,
      approved: false,
    })
  }, [])

  const updatePlanItem = useCallback((id, text) => {
    setPlan(prev => ({
      ...prev,
      items: prev.items.map(item => item.id === id ? { ...item, text } : item)
    }))
  }, [])

  const togglePlanItem = useCallback((id) => {
    setPlan(prev => ({
      ...prev,
      items: prev.items.map(item =>
        item.id === id ? { ...item, status: item.status === 'done' ? 'pending' : 'done' } : item
      )
    }))
  }, [])

  const removePlanItem = useCallback((id) => {
    setPlan(prev => ({
      ...prev,
      items: prev.items.filter(item => item.id !== id).map((item, i) => ({ ...item, id: i }))
    }))
  }, [])

  const addPlanItem = useCallback((text) => {
    setPlan(prev => ({
      ...prev,
      items: [...prev.items, { id: prev.items.length, text, status: 'pending' }]
    }))
  }, [])

  const clearPlan = useCallback(() => {
    setPlan({ items: [], sourcePrompt: '', sourceAttachment: null, approved: false })
  }, [])

  const approvePlan = useCallback(() => {
    setPlan(prev => ({ ...prev, approved: true }))
  }, [])

  const clearActivity = useCallback(() => {
    setSteps([])
    setToolResults([])
    setThinking({ active: false, duration: 0, content: '' })
    setLastTool(null)
    setPlan({ items: [], sourcePrompt: '', sourceAttachment: null, approved: false })
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
    createPlan,
    updatePlanItem,
    togglePlanItem,
    removePlanItem,
    addPlanItem,
    clearPlan,
    approvePlan,
    clearActivity,
    acknowledgeActivity,
  }), [steps, toolResults, thinking, lastTool, plan, hasNewActivity, addStep, completeStep, addToolResult, setThinkingState, setThinkingDuration, updatePlan, markPlanItemDone, createPlan, updatePlanItem, togglePlanItem, removePlanItem, addPlanItem, clearPlan, approvePlan, clearActivity, acknowledgeActivity])

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
