# Persistent Agent Runs Across Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep one Chat run and one Coding run alive concurrently while users navigate the desktop app, with session-correct sidebar badges, a global run list, and visible permission attention.

**Architecture:** Chat and Coding mount through a keep-alive host and become CSS-hidden rather than unmounted. A pure reducer plus `AgentActivityContext` stores execution state by `sessionId`; panel WebSocket handlers update only their own entry. `AppShell.activeTab` controls the visible token bucket, while Sidebar, StatusBar, Titlebar, and a global attention banner consume shared activity selectors.

**Tech Stack:** React 18.3.1, Vite 5.4, Vitest 2.1.9, Testing Library 16.3, Tailwind CSS 3.4, FastAPI WebSocket, pytest/pytest-asyncio, Tauri 2.

## Global Constraints

- Ordinary tab navigation MUST NOT unmount Chat or Coding and MUST NOT close either panel's WebSocket.
- Supported concurrency is exactly one active Chat turn plus one active Coding turn; do not add per-panel queues or multi-conversation background execution.
- App refresh, backend restart, and application restart do not preserve an in-flight turn.
- Background permission requests never auto-approve because a tab is hidden; the existing 120-second backend timeout remains.
- The timeout emits `permission_expired` before returning `rejected`, and the frontend surfaces that rejection explicitly.
- `needs_input` → unread `error` → `running` → unread `completed` → `idle` is the single status priority used by Sidebar, StatusBar, and Titlebar.
- Token usage stays keyed by session; only `AppShell.activeTab` chooses the visible context bucket.
- No new npm or Python dependency.
- Every new user-visible label is present in `en`, `ko`, `pt-BR`, `es`, `ja`, and `zh-CN` locale JSON.
- Preserve existing conversation JSON and WebSocket event shapes except for the additive `permission_expired` event.
- TDD per task: failing contract test, observed failure, minimal implementation, focused pass, then commit.
- Implementation commits use `feat(agent-runs): ...`, `fix(agent-runs): ...`, or `test(agent-runs): ...`.

---

## File Structure

### New files

- `desktop/src/context/agentActivityState.js` — pure session factory, reducer, and status selectors; no React imports.
- `desktop/src/context/agentActivityState.test.js` — reducer isolation and selector-priority contracts.
- `desktop/src/context/AgentActivityContext.test.jsx` — provider and bound session-hook contracts.
- `desktop/src/components/shell/KeepAliveAgentPanels.jsx` — visited-panel mounting and hidden-state ownership.
- `desktop/src/components/shell/KeepAliveAgentPanels.test.jsx` — proves navigation hides without cleanup/unmount.
- `desktop/src/components/shared/SessionActionGuard.jsx` — reusable destructive-session confirmation dialog.
- `desktop/src/components/shared/AgentRunStatus.jsx` — global StatusBar summary and run-list popover.
- `desktop/src/components/shared/AgentRunStatus.test.jsx` — summary priority, row count, and navigation.
- `desktop/src/components/shared/GlobalAgentAttention.jsx` — cross-tab permission notice and countdown.
- `desktop/src/components/shared/GlobalAgentAttention.test.jsx` — persistent notice and Review navigation.
- `desktop/src/components/Sidebar.test.jsx` — accessible per-tab run badges.
- `desktop/src/context/SessionTokensContext.test.jsx` — controlled visible-session token selection.
- `tests/test_permission_timeout_event.py` — backend timeout event contract.

### Modified files

- `desktop/src/context/AgentActivityContext.jsx` — React provider around the pure registry and session-bound actions.
- `desktop/src/context/SessionTokensContext.jsx` — replace mount-winner active state with controlled `visibleSessionId`.
- `desktop/src/App.jsx` — keep-alive host, visible session mapping, non-destructive navigation, and global attention.
- `desktop/src/components/chat/ChatPanel.jsx` — session registration, event transitions, expiration handling, and destructive-action guards.
- `desktop/src/components/coding/CodingPanel.jsx` — coding-scoped transitions, expiration handling, activation resize, and guards.
- `desktop/src/components/coding/WorkspaceSidebar.jsx` — bind plan/steps/tools to the supplied Coding `sessionId`.
- `desktop/src/components/coding/XTermTerminal.jsx` — refit when its keep-alive panel becomes visible.
- `desktop/src/components/coding/useCodingChat.js` — remove mount-based token-session ownership from the unused alternate panel path.
- `desktop/src/components/Sidebar.jsx` — Chat/Coding status badges.
- `desktop/src/components/shared/StatusBar.jsx` — mount `AgentRunStatus`, consume visible token ID, and accept navigation callback.
- `desktop/src/components/shared/StatusBar.test.jsx` — update context mocks for new APIs.
- `desktop/src/components/shell/Titlebar.jsx` — shared global selector rather than singleton fields.
- `web/backend/main.py` — emit explicit permission expiry event.
- `desktop/src/i18n/{en,ko,pt-BR,es,ja,zh-CN}.json` — complete run-state and permission copy.

---

### Task 1: Build the session activity reducer and React provider

**Files:**
- Create: `desktop/src/context/agentActivityState.js`
- Create: `desktop/src/context/agentActivityState.test.js`
- Create: `desktop/src/context/AgentActivityContext.test.jsx`
- Modify: `desktop/src/context/AgentActivityContext.jsx`

**Interfaces:**
- Produces pure exports:
  - `createSessionActivity(metadata)`
  - `agentActivityReducer(state, action)`
  - `selectSession(state, sessionId)`
  - `selectTabSummary(state, tabId)`
  - `selectGlobalSummary(state)`
  - `ACTIVE_RUN_STATUSES = new Set(['running', 'needs_input'])`
- Produces React exports:
  - `AgentActivityProvider`
  - `useAgentActivity()` — global `{ sessions, ...actions }`
  - `useSessionActivity(sessionId)` — flattened current session plus bound actions
- Global actions: `registerSession(metadata)`, `removeSession(sessionId)`, `startRun(sessionId)`, `setPhase(sessionId, phase)`, `setThinkingState(sessionId, active, content)`, `setThinkingDuration(sessionId, duration)`, `addStep(sessionId, step, maxSteps)`, `completeStep(sessionId, step)`, `addToolResult(sessionId, data)`, `requestAttention(sessionId, permission)`, `resolveAttention(sessionId, requestId, resolution)`, `expireAttention(sessionId, requestId, reason)`, `completeRun(sessionId, options)`, `failRun(sessionId, error, options)`, `failRunIfActive(sessionId, error, options)`, `acknowledgeSession(sessionId)`, `clearActivity(sessionId)`, `createPlan(sessionId, items, sourcePrompt, sourceAttachment)`, `updatePlanItem(sessionId, id, text)`, `togglePlanItem(sessionId, id)`, `removePlanItem(sessionId, id)`, `addPlanItem(sessionId, text)`, `clearPlan(sessionId)`, and `approvePlan(sessionId)`.

- [ ] **Step 1: Write reducer tests that fail against the current singleton context**

Create `agentActivityState.test.js` with these contracts:

```js
import { describe, expect, it } from 'vitest'
import {
  agentActivityReducer,
  createSessionActivity,
  selectGlobalSummary,
  selectTabSummary,
} from './agentActivityState.js'

const reduce = (state, action) => agentActivityReducer(state, action)

function registered() {
  let state = {}
  state = reduce(state, { type: 'register', metadata: { sessionId: 'chat-1', tabId: 'chat', kind: 'chat', title: 'Chat one' } })
  state = reduce(state, { type: 'register', metadata: { sessionId: 'coding-1', tabId: 'code', kind: 'coding', title: 'Code one' } })
  return state
}

describe('agentActivityReducer', () => {
  it('updates one session without changing the other session object', () => {
    const before = registered()
    const codeBefore = before['coding-1']
    const after = reduce(before, { type: 'run_started', sessionId: 'chat-1', now: 100 })
    expect(after['chat-1'].status).toBe('running')
    expect(after['chat-1'].startedAt).toBe(100)
    expect(after['coding-1']).toBe(codeBefore)
  })

  it('tracks attention, timeout, and hidden completion as explicit states', () => {
    let state = registered()
    state = reduce(state, { type: 'run_started', sessionId: 'chat-1', now: 100 })
    state = reduce(state, {
      type: 'attention_requested', sessionId: 'chat-1', now: 200,
      permission: { requestId: 'req-1', toolName: 'bash', expiresAt: 120200 },
    })
    expect(state['chat-1'].status).toBe('needs_input')
    state = reduce(state, { type: 'attention_expired', sessionId: 'chat-1', requestId: 'req-1', reason: 'Timed out', now: 120200 })
    expect(state['chat-1'].status).toBe('running')
    expect(state['chat-1'].permissionRequest).toBeNull()
    expect(state['chat-1'].activity.toolResults.at(-1)).toMatchObject({ tool: 'bash', success: false, error: 'Timed out' })
    state = reduce(state, { type: 'run_completed', sessionId: 'chat-1', unread: true, now: 120300 })
    expect(state['chat-1']).toMatchObject({ status: 'completed', unread: true })
  })

  it('uses one shared global priority', () => {
    let state = registered()
    state = reduce(state, { type: 'run_started', sessionId: 'chat-1', now: 1 })
    state = reduce(state, { type: 'run_failed', sessionId: 'coding-1', error: 'socket closed', unread: true, now: 2 })
    expect(selectGlobalSummary(state).status).toBe('error')
    state = reduce(state, {
      type: 'attention_requested', sessionId: 'chat-1', now: 3,
      permission: { requestId: 'r', toolName: 'write_file', expiresAt: 120003 },
    })
    expect(selectGlobalSummary(state).status).toBe('needs_input')
    expect(selectTabSummary(state, 'chat').status).toBe('needs_input')
  })
})

describe('createSessionActivity', () => {
  it('creates isolated nested activity containers', () => {
    const a = createSessionActivity({ sessionId: 'a', tabId: 'chat', kind: 'chat', title: 'A' })
    const b = createSessionActivity({ sessionId: 'b', tabId: 'code', kind: 'coding', title: 'B' })
    expect(a.activity.steps).not.toBe(b.activity.steps)
    expect(a.activity.plan.items).not.toBe(b.activity.plan.items)
  })
})
```

- [ ] **Step 2: Run the reducer test and observe the missing module failure**

Run: `cd desktop && npm test -- --run src/context/agentActivityState.test.js`  
Expected: FAIL because `agentActivityState.js` does not exist.

- [ ] **Step 3: Implement the pure registry**

Implement `createSessionActivity` with this exact top-level shape:

```js
{
  sessionId, tabId, kind, title,
  status: 'idle', phase: null,
  startedAt: null, updatedAt: now,
  currentStep: null, lastTool: null,
  permissionRequest: null, unread: false, error: null,
  activity: {
    steps: [], toolResults: [],
    thinking: { active: false, duration: 0, content: '' },
    plan: { items: [], sourcePrompt: '', sourceAttachment: null, approved: false },
    hasNewActivity: false,
  },
}
```

Use immutable per-session updates. `register` merges metadata without resetting an existing run. `session_cleared` resets only the nested activity and idle metadata for that session. `run_started` resets error/unread/permission, records `startedAt`, and sets thinking active. `run_completed`/`run_failed` stop thinking and clear permission. `attention_expired` appends a failed tool result for the expired tool and returns to `running` because the backend continues the turn with a rejected permission.

`selectGlobalSummary` returns:

```js
{
  status, runningCount, attentionCount, errorCount, completedCount,
  sessions: Object.values(state).filter(s =>
    s.status === 'running' || s.status === 'needs_input' || s.unread
  ).sort((a, b) => a.updatedAt - b.updatedAt),
}
```

- [ ] **Step 4: Replace `AgentActivityContext` with reducer-backed actions and bound hooks**

Keep all dispatch callbacks stable with `useCallback`. `useSessionActivity(sessionId)` returns the selected session flattened with `activity` fields so existing Coding consumers can migrate incrementally:

```js
return {
  ...session,
  ...session.activity,
  startRun: (options) => actions.startRun(sessionId, options),
  setPhase: (phase) => actions.setPhase(sessionId, phase),
  setThinkingState: (active, content = '') => actions.setThinkingState(sessionId, active, content),
  setThinkingDuration: (duration) => actions.setThinkingDuration(sessionId, duration),
  addStep: (step, maxSteps) => actions.addStep(sessionId, step, maxSteps),
  completeStep: (step) => actions.completeStep(sessionId, step),
  addToolResult: (data) => actions.addToolResult(sessionId, data),
  requestAttention: (permission) => actions.requestAttention(sessionId, permission),
  resolveAttention: (requestId, resolution) => actions.resolveAttention(sessionId, requestId, resolution),
  expireAttention: (requestId, reason) => actions.expireAttention(sessionId, requestId, reason),
  completeRun: (options) => actions.completeRun(sessionId, options),
  failRun: (error, options) => actions.failRun(sessionId, error, options),
  failRunIfActive: (error, options) => actions.failRunIfActive(sessionId, error, options),
  acknowledgeSession: () => actions.acknowledgeSession(sessionId),
  clearActivity: () => actions.clearActivity(sessionId),
  createPlan: (items, prompt, attachment) => actions.createPlan(sessionId, items, prompt, attachment),
  updatePlanItem: (id, text) => actions.updatePlanItem(sessionId, id, text),
  togglePlanItem: (id) => actions.togglePlanItem(sessionId, id),
  removePlanItem: (id) => actions.removePlanItem(sessionId, id),
  addPlanItem: (text) => actions.addPlanItem(sessionId, text),
  clearPlan: () => actions.clearPlan(sessionId),
  approvePlan: () => actions.approvePlan(sessionId),
}
```

Unknown sessions are read through a stable empty value but mutations other than `registerSession` do nothing; panels register before sending.

- [ ] **Step 5: Add provider tests**

Use `renderHook` with `AgentActivityProvider` to prove:

- `useAgentActivity` throws outside the provider.
- Registering Chat and Coding creates two keys.
- `useSessionActivity('chat-1').addStep(1, 4)` does not change Coding.
- Bound plan actions update only the selected Coding session.
- Completing hidden Chat with `{ unread: true }` leaves Coding status unchanged.

- [ ] **Step 6: Run focused tests**

Run: `cd desktop && npm test -- --run src/context/agentActivityState.test.js src/context/AgentActivityContext.test.jsx`  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/src/context/agentActivityState.js desktop/src/context/agentActivityState.test.js desktop/src/context/AgentActivityContext.jsx desktop/src/context/AgentActivityContext.test.jsx
git commit -m "feat(agent-runs): add session activity registry"
```

---

### Task 2: Make visible token ownership controlled by App

**Files:**
- Create: `desktop/src/context/SessionTokensContext.test.jsx`
- Modify: `desktop/src/context/SessionTokensContext.jsx`
- Modify: `desktop/src/components/chat/ChatPanel.jsx`
- Modify: `desktop/src/components/coding/CodingPanel.jsx`
- Modify: `desktop/src/components/coding/useCodingChat.js`
- Modify: `desktop/src/components/shared/StatusBar.jsx`
- Modify: `desktop/src/components/shared/StatusBar.test.jsx`

**Interfaces:**
- `SessionTokensProvider({ children, visibleSessionId })`
- Context value: `{ sessions, visibleSessionId, recordUsage, resetSession, clearAll }`
- `useVisibleSessionTokens()` replaces `useActiveSessionTokens()`.
- Chat/Coding accept `onSessionIdChange(sessionId)` and call it whenever their current session changes.

- [ ] **Step 1: Write the controlled-visible-session test**

Render a provider through a small harness with `visibleSessionId="chat-1"`, record distinct usage for `chat-1` and `coding-1`, and assert `useVisibleSessionTokens()` returns Chat. Rerender the provider with `visibleSessionId="coding-1"` while keeping both buckets mounted and assert it returns Coding. Also assert rerendering does not delete either bucket.

- [ ] **Step 2: Run the test and observe the API mismatch**

Run: `cd desktop && npm test -- --run src/context/SessionTokensContext.test.jsx`  
Expected: FAIL because the provider owns `activeSessionId` internally and `useVisibleSessionTokens` is absent.

- [ ] **Step 3: Implement controlled visibility**

Remove `activeSessionId` state and `setActiveSessionId`. Accept `visibleSessionId = null` as a provider prop. Export:

```js
export const useVisibleSessionTokens = () => {
  const { sessions, visibleSessionId } = useSessionTokens()
  return visibleSessionId ? (sessions[visibleSessionId] || null) : null
}
```

Keep the existing debounced `localStorage` persistence and token accumulation unchanged.

- [ ] **Step 4: Remove mount-winner calls from both panels and alternate hook**

In ChatPanel and CodingPanel, retain `recordUsage` but remove effects that set/clear the active ID on mount. Add:

```js
useEffect(() => {
  onSessionIdChange?.(sessionId)
}, [sessionId, onSessionIdChange])
```

Use `codingSessionId` in CodingPanel. In `useCodingChat.js`, remove only the `setActiveSessionId` registration effect; continue recording usage.

- [ ] **Step 5: Update StatusBar token consumption and tests**

Replace reads of `activeSessionId` with `visibleSessionId`. Update the StatusBar test mock to provide `visibleSessionId` and the same `sessions` map. Do not change context-window math.

- [ ] **Step 6: Run token and StatusBar tests**

Run: `cd desktop && npm test -- --run src/context/SessionTokensContext.test.jsx src/components/shared/StatusBar.test.jsx`  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/src/context/SessionTokensContext.jsx desktop/src/context/SessionTokensContext.test.jsx desktop/src/components/chat/ChatPanel.jsx desktop/src/components/coding/CodingPanel.jsx desktop/src/components/coding/useCodingChat.js desktop/src/components/shared/StatusBar.jsx desktop/src/components/shared/StatusBar.test.jsx
git commit -m "feat(agent-runs): control visible token session from app"
```

---

### Task 3: Keep Chat and Coding mounted across navigation

**Files:**
- Create: `desktop/src/components/shell/KeepAliveAgentPanels.jsx`
- Create: `desktop/src/components/shell/KeepAliveAgentPanels.test.jsx`
- Modify: `desktop/src/App.jsx`

**Interfaces:**
- `KeepAliveAgentPanels({ activeTab, renderChat, renderCode })`, where each render callback receives `active: boolean` and returns the panel element.
- App supplies stable `renderChat(active)` / `renderCode(active)` callbacks that pass `active` and `onSessionIdChange` to their panel.
- `SessionTokensProvider` receives `visibleSessionId` derived from `{ chat, code }` session IDs and `activeTab`.

- [ ] **Step 1: Write a mount-lifetime test**

Use child probes whose `useEffect` increments mount and cleanup counters. Render with Chat active, switch to Code, switch to Settings, then return to Chat. Assert Chat mounted once and never cleaned up; Code mounts once on first visit and never cleans up; each inactive section has `hidden` and `aria-hidden="true"`.

- [ ] **Step 2: Run the test and observe the missing host**

Run: `cd desktop && npm test -- --run src/components/shell/KeepAliveAgentPanels.test.jsx`  
Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the host**

Use a `Set` initialized with the initial agent tab when applicable. On `activeTab` changes, add only `chat` or `code`. Render stable keyed sections; invoke only a visited panel's render callback:

```jsx
{visited.has(tabId) && (
  <section
    key={tabId}
    data-testid={`agent-panel-${tabId}`}
    hidden={activeTab !== tabId}
    aria-hidden={activeTab !== tabId}
    className="flex-1 min-h-0 flex-col"
  >
    {renderPanel(activeTab === tabId)}
  </section>
)}
```

Memoize the component so unrelated parent renders do not recreate panel subtrees. Never change a panel `key` on navigation.

- [ ] **Step 4: Integrate AppShell**

Add `tabSessionIds = { chat: null, code: null }` state and stable callbacks. Compute:

```js
const visibleSessionId = activeTab === 'chat' || activeTab === 'code'
  ? tabSessionIds[activeTab]
  : null
```

Pass it to `SessionTokensProvider`. Render `KeepAliveAgentPanels` for Chat/Coding and render only the selected non-agent panel beside it. Pass `active={activeTab === id}` and `onSessionIdChange` to each agent panel.

Remove session-risk checks from `handleNavigate` and Sidebar `onTabChange`; both call `setActiveTab` directly. Restrict command-palette guarding to destructive `new-chat` and `clear-chat`. Opening Tasks, Help, Settings, or media is non-destructive.

- [ ] **Step 5: Run the host test and production build**

Run: `cd desktop && npm test -- --run src/components/shell/KeepAliveAgentPanels.test.jsx && npm run build`  
Expected: test PASS and Vite build succeeds.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/components/shell/KeepAliveAgentPanels.jsx desktop/src/components/shell/KeepAliveAgentPanels.test.jsx desktop/src/App.jsx
git commit -m "feat(agent-runs): keep agent panels mounted across tabs"
```

---

### Task 4: Wire Chat into the session registry and guard destructive actions

**Files:**
- Create: `desktop/src/components/shared/SessionActionGuard.jsx`
- Modify: `desktop/src/components/chat/ChatPanel.jsx`
- Test: `desktop/src/context/AgentActivityContext.test.jsx`

**Interfaces:**
- ChatPanel props now include `active` and `onSessionIdChange`.
- `SessionActionGuard({ open, title, description, confirmLabel, cancelLabel, onConfirm, onCancel })`.
- Chat registry metadata: `{ sessionId, tabId: 'chat', kind: 'chat', title }`.

- [ ] **Step 1: Extend context tests for the Chat event sequence**

Drive bound actions through: register → start → thinking → attention → resolve → responding → complete. Assert the final Chat entry is completed/unread while Coding remains byte-for-byte unchanged. Add a second case proving `failRunIfActive` changes running Chat to error but leaves idle Chat idle.

- [ ] **Step 2: Run the added tests**

Run: `cd desktop && npm test -- --run src/context/AgentActivityContext.test.jsx`  
Expected: FAIL until any missing bound actions are added.

- [ ] **Step 3: Register Chat and map WebSocket events**

In ChatPanel:

- Register/update metadata when `sessionId` or title changes; remove the old registry entry only after a confirmed session replacement.
- On send, call `startRun` before sending the WebSocket payload.
- Map `status`, `thinking`, `thinking_delta`, `step_start`, `tool_result`, and `text_delta` to the current session's phase/activity.
- For medium/high `permission_request`, keep the existing local modal and call `requestAttention` with `expiresAt: Date.now() + 120_000`.
- On approval/rejection, call `resolveAttention` after sending the response.
- On final `assistant`, call `completeRun({ unread: !active })`.
- On `error`, call `failRun(error, { unread: !active })`.
- On socket close, call `failRunIfActive` with an interruption message; idle disconnects remain connection-only failures.
- When `active` becomes true, call `acknowledgeSession`.

Keep low-risk Chat auto-approval unchanged and do not create attention state for auto-approved requests.

- [ ] **Step 4: Disable a second send during the active turn**

Set Composer `disabled={!isConnected || isThinking || !!permissionRequest}`. This enforces the one-run-per-Chat slot without adding a queue.

- [ ] **Step 5: Add local destructive-session confirmation**

Track Composer dirty state in ChatPanel in addition to the existing `useSessionProtection` registration. Route New Chat, loading another conversation, and deleting the active conversation through `SessionActionGuard` when Chat is running, awaiting permission, or has an unsent draft. Confirming performs the existing action, which changes/remounts the session and closes only that Chat WebSocket; cancelling changes nothing.

- [ ] **Step 6: Run focused context tests and build**

Run: `cd desktop && npm test -- --run src/context/AgentActivityContext.test.jsx && npm run build`  
Expected: PASS and build succeeds with no stale singleton activity access in ChatPanel.

- [ ] **Step 7: Commit**

```bash
git add desktop/src/components/shared/SessionActionGuard.jsx desktop/src/components/chat/ChatPanel.jsx desktop/src/context/AgentActivityContext.test.jsx
git commit -m "feat(agent-runs): track persistent chat activity"
```

---

### Task 5: Wire Coding and WorkspaceSidebar into its own session

**Files:**
- Modify: `desktop/src/components/coding/CodingPanel.jsx`
- Modify: `desktop/src/components/coding/WorkspaceSidebar.jsx`
- Modify: `desktop/src/components/coding/XTermTerminal.jsx`
- Modify: `desktop/src/components/coding/WorkspaceSidebar.test.jsx`

**Interfaces:**
- CodingPanel props include `active` and `onSessionIdChange`.
- Coding registry metadata: `{ sessionId, tabId: 'code', kind: 'coding', title }`.
- `WorkspaceSidebar` already receives `sessionId`; every activity panel now calls `useSessionActivity(sessionId)`.
- `XTermTerminal({ onReady, active = true })` refits after `active` changes false → true.

- [ ] **Step 1: Add a WorkspaceSidebar isolation test**

Provide registry entries with distinct Chat and Coding steps/plans, render `WorkspaceSidebar sessionId="coding-1"`, and assert only Coding plan/step/tool text appears. Updating Chat must not change the rendered Coding sidebar.

- [ ] **Step 2: Run the test and observe singleton leakage**

Run: `cd desktop && npm test -- --run src/components/coding/WorkspaceSidebar.test.jsx`  
Expected: FAIL because WorkspaceSidebar currently consumes unscoped global fields.

- [ ] **Step 3: Bind CodingPanel events to `codingSessionId`**

Replace `const activity = useAgentActivity()` with `useSessionActivity(codingSessionId)`. Register metadata and map the same lifecycle as Chat:

- send/approved plan → `startRun`
- status/thinking/step/tool/text → Coding session only
- permission → `requestAttention` with a 120-second frontend deadline
- approval/rejection → `resolveAttention`
- final assistant → `completeRun({ unread: !active })`
- error/active socket close → session-scoped error
- active tab return → acknowledge

Do not set Coding thinking false merely because a tool result arrived; phase becomes `tool` and the run remains active until final assistant/error.

- [ ] **Step 4: Scope every WorkspaceSidebar child**

Pass `sessionId` into `PlanPanel`, `TasksPanel`, and `AgentsPanel`; each calls `useSessionActivity(sessionId)`. The collapsed activity badge and all plan editing actions use that same bound session. Keep `TodosPanel`'s existing backend task filtering unchanged.

- [ ] **Step 5: Guard Coding destructive actions**

Route New Code Chat, loading another Coding conversation, deleting the active conversation, and workspace replacement through `SessionActionGuard` when Coding is running, awaiting permission, has an unsent draft, or has unsaved file changes. Confirm performs the existing action; cancel preserves session, files, WebSocket, and draft.

Disable the Coding Composer while disconnected, running, or awaiting permission.

- [ ] **Step 6: Refit XTerm when the panel becomes visible**

Pass `active` from CodingPanel to XTermTerminal. Extract its current resize body into `fitAndNotify`, then add:

```js
useEffect(() => {
  if (!active) return
  const frame = requestAnimationFrame(fitAndNotify)
  return () => cancelAnimationFrame(frame)
}, [active, fitAndNotify])
```

Keep the terminal WebSocket connected while hidden. A refit failure logs once and does not affect the agent run.

- [ ] **Step 7: Run Coding tests and build**

Run: `cd desktop && npm test -- --run src/components/coding/WorkspaceSidebar.test.jsx src/context/AgentActivityContext.test.jsx && npm run build`  
Expected: PASS and build succeeds.

- [ ] **Step 8: Commit**

```bash
git add desktop/src/components/coding/CodingPanel.jsx desktop/src/components/coding/WorkspaceSidebar.jsx desktop/src/components/coding/XTermTerminal.jsx desktop/src/components/coding/WorkspaceSidebar.test.jsx
git commit -m "feat(agent-runs): isolate persistent coding activity"
```

---

### Task 6: Add sidebar badges, global run list, and permission attention

**Files:**
- Create: `desktop/src/components/Sidebar.test.jsx`
- Create: `desktop/src/components/shared/AgentRunStatus.jsx`
- Create: `desktop/src/components/shared/AgentRunStatus.test.jsx`
- Create: `desktop/src/components/shared/GlobalAgentAttention.jsx`
- Create: `desktop/src/components/shared/GlobalAgentAttention.test.jsx`
- Modify: `desktop/src/components/Sidebar.jsx`
- Modify: `desktop/src/components/shared/StatusBar.jsx`
- Modify: `desktop/src/components/shell/Titlebar.jsx`
- Modify: `desktop/src/App.jsx`

**Interfaces:**
- `AgentRunStatus({ onNavigate })`
- `GlobalAgentAttention({ onNavigate })`
- Sidebar reads `selectTabSummary(sessions, item.id)` for only `chat` and `code`.
- StatusBar accepts `onNavigate` and delegates the agent portion to `AgentRunStatus`.

- [ ] **Step 1: Write UI contract tests**

Cover:

- Sidebar: Chat running dot and Coding attention exclamation can appear simultaneously; collapsed buttons retain descriptive `aria-label` text.
- AgentRunStatus: zero sessions says idle; two running sessions say two running; attention overrides error/running in the chip while the popover still lists all rows; clicking a Coding row calls `onNavigate('code')`.
- GlobalAgentAttention: displays owning tab, tool name, countdown, and Review; Review calls the owning tab; no attention sessions render nothing.

- [ ] **Step 2: Run the tests and observe missing components/status badges**

Run: `cd desktop && npm test -- --run src/components/Sidebar.test.jsx src/components/shared/AgentRunStatus.test.jsx src/components/shared/GlobalAgentAttention.test.jsx`  
Expected: FAIL.

- [ ] **Step 3: Implement Sidebar badges**

Render a visually distinct badge for `needs_input`, `error`, `running`, and unread `completed`. Use translated accessible labels and `aria-live="polite"`; do not rely only on color. Preserve the existing `AGENT` product badge only if it does not collide with the runtime badge; otherwise replace that badge position with runtime status while active.

- [ ] **Step 4: Implement `AgentRunStatus`**

Use `selectGlobalSummary(sessions)` and one local popover-open state. Derive elapsed time from `startedAt` with a one-second interval only while a listed session is running/awaiting input. Rows show kind/title, phase or last tool, elapsed time, and a navigation arrow. No cancel control is added.

- [ ] **Step 5: Implement the global attention notice**

Select the earliest-expiring `needs_input` session. Compute remaining seconds from `permissionRequest.expiresAt`; the backend event remains authoritative for expiry. Render above panel content through App's provider tree so hidden panels cannot hide it. Review calls `onNavigate(session.tabId)`.

- [ ] **Step 6: Unify Titlebar and StatusBar**

Titlebar consumes `selectGlobalSummary` and renders only the compact dot/status label. StatusBar replaces its singleton `AgentStatus` with `AgentRunStatus`. Both use the same priority selector; remove all reads of global `thinking`, `steps`, or `toolResults`.

Pass `onNavigate={setActiveTab}` to StatusBar and GlobalAgentAttention from App.

- [ ] **Step 7: Run UI tests**

Run: `cd desktop && npm test -- --run src/components/Sidebar.test.jsx src/components/shared/AgentRunStatus.test.jsx src/components/shared/GlobalAgentAttention.test.jsx src/components/shared/StatusBar.test.jsx`  
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add desktop/src/components/Sidebar.jsx desktop/src/components/Sidebar.test.jsx desktop/src/components/shared/AgentRunStatus.jsx desktop/src/components/shared/AgentRunStatus.test.jsx desktop/src/components/shared/GlobalAgentAttention.jsx desktop/src/components/shared/GlobalAgentAttention.test.jsx desktop/src/components/shared/StatusBar.jsx desktop/src/components/shell/Titlebar.jsx desktop/src/App.jsx
git commit -m "feat(agent-runs): surface cross-tab agent status"
```

---

### Task 7: Make permission expiry explicit end to end

**Files:**
- Create: `tests/test_permission_timeout_event.py`
- Modify: `web/backend/main.py`
- Modify: `desktop/src/components/chat/ChatPanel.jsx`
- Modify: `desktop/src/components/coding/CodingPanel.jsx`

**Interfaces:**
- New additive server event:

```json
{
  "type": "permission_expired",
  "request_id": "<uuid>",
  "tool_name": "<tool name>",
  "reason": "Permission request timed out after 120 seconds."
}
```

- Internal backend helper:
  - `async _expire_permission_request(send, request_id, request, deferred_messages, deferred) -> str`

- [ ] **Step 1: Write the backend helper test**

Import `web/backend/main.py` using the existing `mcp_runtime` stub pattern. Call `_expire_permission_request` with an async `send` recorder, one outer deferred list, and one locally buffered message. Assert:

```python
assert result == "rejected"
assert outer_deferred == [{"type": "chat", "message": "keep me"}]
assert sent == [{
    "type": "permission_expired",
    "request_id": "req-1",
    "tool_name": "bash",
    "reason": "Permission request timed out after 120 seconds.",
}]
```

- [ ] **Step 2: Run the backend test and observe the missing helper**

Run: `pytest -q tests/test_permission_timeout_event.py`  
Expected: FAIL because `_expire_permission_request` does not exist.

- [ ] **Step 3: Implement and call the helper**

Place the helper near the WebSocket utilities. It first restores buffered messages, then awaits `send(permission_expired_payload)`, then returns `"rejected"`. Replace the timeout branch at `main.py:3433-3436` with:

```python
except asyncio.TimeoutError:
    _logger.warning(f"Permission request {req_id} timed out")
    return await _expire_permission_request(
        _safe_send,
        req_id,
        request,
        _deferred_messages,
        deferred,
    )
```

Do not change the 120-second timeout or disconnect cancellation.

- [ ] **Step 4: Handle expiry in both panels**

Before generic final-event handling, match `permission_expired` by `request_id`. Clear the matching local permission modal, call bound `expireAttention(requestId, reason)`, and append one translated system message naming the tool and timeout. Do not mark the whole run as transport error; it remains running until the backend emits its final assistant/error event.

- [ ] **Step 5: Run backend and reducer tests**

Run: `pytest -q tests/test_permission_timeout_event.py && cd desktop && npm test -- --run src/context/agentActivityState.test.js src/context/AgentActivityContext.test.jsx`  
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add web/backend/main.py tests/test_permission_timeout_event.py desktop/src/components/chat/ChatPanel.jsx desktop/src/components/coding/CodingPanel.jsx
git commit -m "fix(agent-runs): surface permission request expiry"
```

---

### Task 8: Localize all run-state and guard copy

**Files:**
- Modify: `desktop/src/i18n/en.json`
- Modify: `desktop/src/i18n/ko.json`
- Modify: `desktop/src/i18n/pt-BR.json`
- Modify: `desktop/src/i18n/es.json`
- Modify: `desktop/src/i18n/ja.json`
- Modify: `desktop/src/i18n/zh-CN.json`
- Modify: `desktop/src/i18n/i18n.test.js`
- Modify touched Chat/Coding/shared components to replace raw literals with keys.

**Interfaces:**
- Add an `agentRuns` namespace with the same key set in every locale:
  - `idle`, `runningOne`, `runningMany`, `needsAttention`, `error`, `completed`
  - `chat`, `code`, `thinking`, `usingTool`, `responding`
  - `review`, `permissionRequired`, `permissionCountdown`, `permissionExpired`
  - `badgeRunning`, `badgeNeedsAttention`, `badgeCompleted`, `badgeError`
  - `destructiveTitle`, `destructiveDescription`, `stay`, `stopAndContinue`
  - `interrupted`

- [ ] **Step 1: Extend i18n key-parity tests**

Add assertions that every supported locale contains every `agentRuns` key and that interpolation renders `runningMany` with `{count}`, `usingTool` with `{tool}`, and `permissionCountdown` with `{seconds}`.

- [ ] **Step 2: Run i18n tests and observe missing keys**

Run: `cd desktop && npm test -- --run src/i18n/i18n.test.js`  
Expected: FAIL listing the absent `agentRuns` keys.

- [ ] **Step 3: Add exact English and Korean source copy**

English:

```json
{
  "idle": "Agent idle",
  "runningOne": "1 agent running",
  "runningMany": "{count} agents running",
  "needsAttention": "{count} needs attention",
  "error": "{count} agent error",
  "completed": "Completed",
  "chat": "Chat",
  "code": "Code",
  "thinking": "Thinking",
  "usingTool": "Running {tool}",
  "responding": "Responding",
  "review": "Review",
  "permissionRequired": "{tab} needs permission to run {tool}.",
  "permissionCountdown": "Auto-rejects in {seconds}s",
  "permissionExpired": "Permission for {tool} expired after 120 seconds and was rejected.",
  "badgeRunning": "Agent running",
  "badgeNeedsAttention": "Agent needs attention",
  "badgeCompleted": "Agent completed",
  "badgeError": "Agent error",
  "destructiveTitle": "Stop the active agent?",
  "destructiveDescription": "This action will stop the current {tab} run and discard its in-flight output.",
  "stay": "Keep running",
  "stopAndContinue": "Stop and continue",
  "interrupted": "The agent run was interrupted because its connection closed."
}
```

Korean:

```json
{
  "idle": "에이전트 대기 중",
  "runningOne": "에이전트 1개 실행 중",
  "runningMany": "에이전트 {count}개 실행 중",
  "needsAttention": "확인 필요 {count}개",
  "error": "에이전트 오류 {count}개",
  "completed": "완료됨",
  "chat": "채팅",
  "code": "코딩",
  "thinking": "생각 중",
  "usingTool": "{tool} 실행 중",
  "responding": "응답 작성 중",
  "review": "확인하기",
  "permissionRequired": "{tab}에서 {tool} 실행 권한이 필요합니다.",
  "permissionCountdown": "{seconds}초 후 자동 거부",
  "permissionExpired": "{tool} 권한 요청이 120초 후 만료되어 거부되었습니다.",
  "badgeRunning": "에이전트 실행 중",
  "badgeNeedsAttention": "에이전트 확인 필요",
  "badgeCompleted": "에이전트 완료",
  "badgeError": "에이전트 오류",
  "destructiveTitle": "실행 중인 에이전트를 중단할까요?",
  "destructiveDescription": "이 작업은 현재 {tab} 실행을 중단하고 아직 완료되지 않은 출력을 버립니다.",
  "stay": "계속 실행",
  "stopAndContinue": "중단하고 계속",
  "interrupted": "연결이 종료되어 에이전트 실행이 중단되었습니다."
}
```

- [ ] **Step 4: Add equivalent complete copy to Portuguese, Spanish, Japanese, and Simplified Chinese**

Use the identical key set and preserve `{count}`, `{tool}`, `{tab}`, and `{seconds}` verbatim. Translate the semantic distinction between running, attention, completed, error, and destructive stop; do not rely on English fallback.

- [ ] **Step 5: Replace raw permission/status/guard strings**

Use `t('agentRuns.…')` in Sidebar, AgentRunStatus, GlobalAgentAttention, SessionActionGuard callers, ChatPanel, CodingPanel, Titlebar, and StatusBar. Remove the touched hardcoded English permission modal headings/buttons and interruption text.

- [ ] **Step 6: Run localization and UI tests**

Run: `cd desktop && npm test -- --run src/i18n/i18n.test.js src/components/Sidebar.test.jsx src/components/shared/AgentRunStatus.test.jsx src/components/shared/GlobalAgentAttention.test.jsx`  
Expected: PASS in all six locale resources.

- [ ] **Step 7: Commit**

```bash
git add desktop/src/i18n desktop/src/components/Sidebar.jsx desktop/src/components/chat/ChatPanel.jsx desktop/src/components/coding/CodingPanel.jsx desktop/src/components/shared desktop/src/components/shell/Titlebar.jsx
git commit -m "feat(agent-runs): localize persistent run status"
```

---

### Task 9: Verify the full user flow and clean obsolete navigation behavior

**Files:**
- Modify only files implicated by observed failures.
- Remove obsolete App state/imports made unnecessary by non-destructive navigation: `pendingTab`, tab-specific guard action branches, and stale singleton activity comments.

**Interfaces:** No new interfaces.

- [ ] **Step 1: Run the complete focused frontend suite**

Run:

```bash
cd desktop && npm test -- --run \
  src/context/agentActivityState.test.js \
  src/context/AgentActivityContext.test.jsx \
  src/context/SessionTokensContext.test.jsx \
  src/components/shell/KeepAliveAgentPanels.test.jsx \
  src/components/Sidebar.test.jsx \
  src/components/shared/AgentRunStatus.test.jsx \
  src/components/shared/GlobalAgentAttention.test.jsx \
  src/components/shared/StatusBar.test.jsx \
  src/components/coding/WorkspaceSidebar.test.jsx \
  src/i18n/i18n.test.js
```

Expected: all focused tests PASS.

- [ ] **Step 2: Run backend timeout verification**

Run: `pytest -q tests/test_permission_timeout_event.py tests/test_task_ws_registry.py`  
Expected: all tests PASS; the additive event does not regress WebSocket registry behavior.

- [ ] **Step 3: Run full build and project suites**

Run:

```bash
cd desktop && npm test -- --run && npm run build
cd .. && pytest -q
```

Expected: Vitest PASS, Vite build succeeds, pytest PASS. Live-key tests may skip according to their existing markers; no new failure is accepted.

- [ ] **Step 4: Smoke-test the desktop behavior in a real browser/Tauri session**

Launch the existing app and exercise these scenarios with real WebSockets:

1. Start a multi-step Chat request, navigate Chat → Coding → Settings → Chat, and confirm the same Chat WebSocket remains connected and the response continues streaming.
2. Start Coding while Chat still runs; confirm both Sidebar badges animate and StatusBar lists two rows.
3. Return to each panel and confirm output is complete and session-specific.
4. Trigger a protected Coding tool, navigate away, confirm the global countdown/Review notice stays visible, return, approve, and confirm the run resumes.
5. Leave a permission request unanswered and confirm explicit expiry replaces attention without creating a transport error.
6. Return to Coding with Terminal visible and confirm dimensions/typing are correct after refit.
7. Complete a hidden run and confirm its green unread badge clears only after opening its tab.
8. Attempt New Chat/conversation replacement while running and confirm cancel leaves the run intact while confirm stops only that panel's run.

- [ ] **Step 5: Remove obsolete code only after smoke success**

Delete App's unused tab-switch guard state and branches, stale `onProcessingChange` plumbing in ChatPanel, and comments claiming activity is singleton or cleared on tab unmount. Do not delete `AgentChatPanel.jsx` or `useCodingChat.js`; they are outside the active route but remain user-owned code.

- [ ] **Step 6: Re-run the focused suite after cleanup**

Run: the commands from Steps 1–3.  
Expected: unchanged PASS/build results.

- [ ] **Step 7: Commit final cleanup**

```bash
git add desktop/src/App.jsx desktop/src/components desktop/src/context web/backend/main.py tests/test_permission_timeout_event.py
git commit -m "fix(agent-runs): finalize cross-tab run lifecycle"
```

## Final Acceptance Checklist

- [ ] Chat and Coding components do not unmount during ordinary navigation.
- [ ] Their WebSocket cleanup functions do not run during ordinary navigation.
- [ ] One Chat and one Coding turn finish concurrently without event/state contamination.
- [ ] Sidebar, StatusBar, and Titlebar derive status from the same selector priority.
- [ ] StatusBar token context follows the visible panel, not the most recently mounted panel.
- [ ] A hidden permission request is globally visible with countdown and Review navigation.
- [ ] Permission timeout emits and renders `permission_expired` before backend rejection.
- [ ] Destructive same-panel actions remain guarded; non-destructive tab changes are immediate.
- [ ] Coding terminal refits after hidden → visible without reconnecting.
- [ ] All six locale files contain all new user-visible copy.
- [ ] Focused tests, full Vitest, Vite build, pytest, and real smoke scenarios pass.
