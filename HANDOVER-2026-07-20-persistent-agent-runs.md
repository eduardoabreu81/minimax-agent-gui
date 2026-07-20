# 인수인계서: Persistent Agent Runs Across Tabs

**작성일:** 2026-07-20  
**담당자:** AI Agent (oh-my-pi) → 차기 개발자  

---

## 1. 개요

**목적:** 탭 전환 시 에이전트 실행이 중단되는 문제 해결 + 실행 상태를 앱 전체에서 볼 수 있는 UI

**커밋 범위:** `e5cc061`..`1002d73` (9 commits)  
**관련 문서:**
- 설계 명세: `docs/superpowers/specs/2026-07-20-persistent-agent-runs-design.md`
- 구현 계획: `docs/superpowers/plans/2026-07-20-persistent-agent-runs.md`

---

## 2. 완료된 작업 ✅

### 2.1 세션 Activity Registry (`agentActivityState.js` + `AgentActivityContext.jsx`)

- **Reducer** (24 action types): register, unregister, run_started, run_completed, run_failed, fail_run_if_active, phase_changed, thinking_changed, thinking_duration, step_added, step_completed, tool_result, attention_requested, attention_resolved, attention_expired, session_acknowledged, session_cleared + 7 plan actions
- **`useSessionActivity(sessionId)`** — session-scoped hook. Actions bound via `actionsRef.current` + `[session, sessionId]` deps로 불필요한 리렌더 방지
- **Selector priority:** `needs_input > (error+unread) > (completed+unread) > running > idle`
- **`attention_expired`**: status를 `running`으로 복귀, `{tool, success: false, error}`를 toolResults에 추가
- **테스트:** 13/13 (6 reducer + 7 provider)

### 2.2 제어된 토큰 가시성 (`SessionTokensContext.jsx`)

- `activeSessionId` / `setActiveSessionId` 제거 → `visibleSessionId` prop 기반
- `useVisibleSessionTokens()` hook → `visibleSessionId`에 해당하는 bucket 반환
- Chat/CodingPanel: `onSessionIdChange(sid)` 콜백 → 부모(KeepAliveAgentPanels)가 session ID 추적
- 기존 `localStorage` persist + debounce(300ms) 유지
- **테스트:** 6/6 (controlled visibility, bucket swap, null prop)

### 2.3 패널 Keep-alive (`KeepAliveAgentPanels.jsx` + `App.jsx`)

- 최초 방문 시 mount, 이후 `hidden`/`aria-hidden` 전환만 수행
- `visitedRef`가 Set으로 방문한 탭 추적
- `SessionTokensProvider`에 `visibleSessionId` prop 전달
- Sidebar 탭 변경 guard 제거 — 비파괴적 내비게이션은 항상 허용
- **`useAgentActivity()` compat shim** — 첫 세션의 activity fields를 flat spread해서 기존 consumer(CodingPanel, WorkspaceSidebar, Titlebar, StatusBar)가 `{ thinking, steps, toolResults }` destructure에서 crash하지 않도록 보호
- **테스트:** 1/1 (mount lifetime)

### 2.4 백엔드 Permission Expiry (`web/backend/main.py`)

- permission_callback의 `asyncio.TimeoutError` branch에서 `{type: "permission_expired", request_id, tool_name, reason}` 전송 후 `return "rejected"`
- 120초 timeout은 변경 없음

### 2.5 로케일 (en.json + ko.json)

- `statusBar` namespace에 15개 키 + 6개 breakdown 키 추가
- 기존 `t is not defined` ReferenceError 수정 (StatusBar.jsx에 useTranslation import 추가)

---

## 3. 미완료 / 이관 필요 작업 🔶

### [P1] Chat/Coding 패널 → Registry Lifecycle 매핑

**중요도: 높음** — 현재 `startRun` / `completeRun` / `failRun` 호출 없음. compat shim이 crash는 막지만 registry 상태가 업데이트되지 않음.

**필요한 변경:**
- `ChatPanel.jsx` / `CodingPanel.jsx` WebSocket `onmessage` handler에 추가:
  - `sendMessage` 전: `activity.startRun(sessionId)`
  - final `assistant` event: `activity.completeRun(sessionId, { unread: !active })`
  - `error` event: `activity.failRun(sessionId, error, { unread: !active })`
  - `ws.onclose`: `activity.failRunIfActive(sessionId, 'Connection closed', { unread: !active })`
  - `permission_request`: `activity.requestAttention(sessionId, {...expiresAt: Date.now() + 120_000})`
  - `permission_expired`: `activity.expireAttention(requestId, reason)`
  - approval/rejection: `activity.resolveAttention(requestId, 'approved'|'rejected')`

- `useSessionActivity(sessionId)`로 `useAgentActivity()` 대체 (5개 consumer)
- compat shim 제거

### [P1] Agent Status UI Components

**중요도: 높음** — 사용자가 실행 상태를 볼 수 있는 UI

**필요한 컴포넌트 (신규 생성):**
- `AgentRunStatus.jsx` + `AgentRunStatus.test.jsx` — StatusBar에 표시될 실행 목록 popover
- `GlobalAgentAttention.jsx` + `GlobalAgentAttention.test.jsx` — 비활성 탭 권한 요청 전역 알림
- Sidebar badges — Chat/Coding 항목에 실행 상태 배지

**Sidebar.jsx badges:**
- `useAgentActivity()`에서 `selectTabSummary(state, tabId)` 사용
- Chat: `selectTabSummary(data, 'chat')` → badge: needs_input(amber) > error(red) > running(animated dot) > completed(green)
- Code: 동일

### [P2] CodingPanel WebSocket lifecycle (CodingPanel.jsx, ~1449 lines)

- CodingPanel의 `codingWs.onmessage`에 같은 매핑 적용
- `useSessionActivity(codingSessionId)`로 activity 접근
- Editor/XTerm refit: `active` prop → `display:none`에서 돌아올 때 resize
- Destructive guard: New Code Chat / conversation load/delete / workspace change

### [P2] WorkspaceSidebar migration (WorkspaceSidebar.jsx)

- PlanPanel, TasksPanel, AgentsPanel → `useSessionActivity(props.sessionId)`
- 현재는 unscoped `useAgentActivity()` 사용 중 → Coding 이벤트만 표시

### [P3] Localization — 5개 로케일 (pt-BR, es, ja, zh-CN)

- `en.json`과 동일한 `statusBar` namespace 키 추가
- 각 locale의 기존 `quota.*` 번역 참고

### [P3] Smoke Test (Tauri 실 실행)

- `cd desktop && npm run tauri:dev` 후:
  1. Chat에서 메시지 전송 → Coding 탭 이동 → Chat 응답 계속 수신
  2. Coding 실행 → Settings 이동 → 실행 유지
  3. Chat + Coding 동시 실행 → 탭 전환 시 모두 유지
  4. 권한 요청 발생 → 120초 timeout → `permission_expired` 수신

---

## 4. 아키텍처 다이어그램

```mermaid
flowchart TB
    subgraph App
        AppJSX[App.jsx]
        KA[KeepAliveAgentPanels]
        STP[SessionTokensProvider<br/>visibleSessionId prop]
        AAP[AgentActivityProvider<br/>state: Record<sessionId, SessionActivity>]
    end

    subgraph AgentPanels
        CP[ChatPanel<br/>useSessionActivity(chatId)]
        CDP[CodingPanel<br/>useSessionActivity(codeId)]
        WSB[WorkspaceSidebar<br/>useSessionActivity(codeId)]
    end

    subgraph ShellUI
        SB[Sidebar<br/>selectTabSummary]
        STB[StatusBar<br/>selectGlobalSummary]
        TB[Titlebar<br/>selectGlobalSummary]
    end

    subgraph Components
        GAA[GlobalAgentAttention]
        ARS[AgentRunStatus]
        SAG[SessionActionGuard]
    end

    KA --> CP
    KA --> CDP
    STP --> AppJSX
    AAP --> AppJSX
    CP -. onSessionIdChange .-> KA
    CDP -. onSessionIdChange .-> KA
    SB --> AAP
    STB --> AAP
    TB --> AAP
    GAA --> AAP
    ARS --> AAP
```

### Key Data Flow

```
1. User sends message in ChatPanel
   → WebSocket send
   → activity.startRun(chatSessionId)
   → Registry: chatSession status = 'running'

2. User switches to Code tab
   → KeepAliveAgentPanels: Chat hidden, Code visible
   → Chat WebSocket STAYS CONNECTED
   → Backend continues processing

3. Backend sends final assistant event
   → ChatPanel receives (still mounted, just hidden)
   → activity.completeRun(chatSessionId, { unread: true })
   → Registry: chatSession status = 'completed', unread=true

4. User sees:
   - Sidebar Chat badge: green dot (completed)
   - StatusBar: shows chat session in agent list
   - Titlebar: still shows "1 agent running" if Coding is active
```

---

## 5. 파일별 책임

| 파일 | 역할 | 상태 |
|---|---|---|
| `desktop/src/context/agentActivityState.js` | Pure reducer + selectors (no React) | ✅ 완료 |
| `desktop/src/context/AgentActivityContext.jsx` | React provider + hooks + compat shim | ✅ 완료 (shim은 P1에서 제거) |
| `desktop/src/context/SessionTokensContext.jsx` | Prop-based visible token ownership | ✅ 완료 |
| `desktop/src/components/shell/KeepAliveAgentPanels.jsx` | Keep-alive panel host | ✅ 완료 |
| `desktop/src/App.jsx` | Keep-alive integration, visibleSessionId wiring | ✅ 완료 |
| `desktop/src/components/shared/SessionActionGuard.jsx` | Destructive action confirm dialog | ✅ 생성됨 |
| `desktop/src/components/shared/AgentRunStatus.jsx` | StatusBar agent list popover | ❌ 미생성 |
| `desktop/src/components/shared/GlobalAgentAttention.jsx` | Cross-tab permission notice | ❌ 미생성 |
| `web/backend/main.py` | permission_expired event | ✅ 완료 |

---

## 6. 중요 주의사항

1. **compat shim 제거 시점:** 5개 consumer (Titlebar, StatusBar, CodingPanel, WorkspaceSidebar, AgentChatPanel)가 모두 `useSessionActivity()`로 마이그레이션된 후에 제거
2. **App.jsx keep-alive 구조:** Chat/Coding만 keep-alive. Settings, Help, Tasks, 미디어 패널은 여전히 조건부 렌더링
3. **`onSessionIdChange` 계약:** ChatPanel은 `sessionId` state, CodingPanel은 `codingSessionId` state가 변경될 때 호출. App.jsx가 `tabSessionIds` 업데이트
4. **Token bucket은 건드리지 않음:** `SessionTokensContext`의 `recordUsage`, `localStorage` persist, debounce는 변경 없음
5. **Builder 확인:** `npm run build` 성공 (desktop). `pytest`는 async plugin 누락으로 baseline failure 있음
