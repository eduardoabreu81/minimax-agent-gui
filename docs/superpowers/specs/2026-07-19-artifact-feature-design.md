# Artifact 기능 (llamacoder 패턴 포팅) 설계

**작성일:** 2026-07-19
**대상:** `desktop/`의 활성 Tauri 데스크톱 UI + `web/backend/`
**참조:** `https://github.com/Nutlope/llamacoder` (architecture.md, code-runner, code-viewer, lib/utils.ts, lib/preview/*)
**대상 모델:** 기본 `MiniMax-M3` (M2.7 / M2.7-highspeed도 동일 규칙 적용)

## 1. 목표

MiniMax Agent GUI의 채팅과 코딩 워크플로에서 모델이 ` ```html ` / ` ```svg ` / ` ```mermaid ` / ` ```reactjs ` 코드 펜스로 작성한 단일 파일 아티팩트를 즉시 샌드박스 `<iframe>`에서 미리보기, 인라인 카드와 모달 뷰어 양쪽으로 노출한다. llamacoder의 "Claude Artifacts" UX를 Tauri 데스크톱 환경에 맞춰 경량으로 이식한다.

## 2. 현재 확인된 상태

- `main.jsx:3` → `App.jsx` (Vite가 `.jsx` 우선) 가 활성 엔트리. `App.tsx`와 `WorkPanel.tsx`는 `App.tsx`만 import 하는 데드코드(이번 작업 무관).
- 활성 메시지 렌더 경로는 단일 진입점 `desktop/src/components/MarkdownRenderer.jsx` (88줄) 이다.
  - `desktop/src/components/chat/ChatPanel.jsx:710` 에서 `<MarkdownRenderer content={msg.content} />` 호출
  - `desktop/src/components/coding/CodingPanel.jsx:1042` 에서 동일 호출
  - 현재 `MarkdownRenderer`는 `react-markdown`의 custom `code` 컴포넌트로 모든 펜스 블록을 `<pre><code>` 래퍼로 감싸고 복사 버튼만 제공한다. 코드 펜스를 별도 처리하지 않는다.
- 백엔드: `web/backend/main.py:1211` 부근에서 `system_prompt`을 조립한 뒤 `system_prompt += _build_mcp_section(...)` 으로 마무리. 이후 추가 문자열이 그대로 시스템 프롬프트로 들어간다.
- `web/backend/agent_context.py`: `IDENTITY.md`는 `workspace/.agent/IDENTITY.md` 에서 로드, `CHAR_LIMIT_IDENTITY = 2_000` 자 제한, 없거나 비어 있어도 graceful (system prompt는 기본 identity 로 폴백).
- Tauri CSP 는 `null` (lib.rs 미설정 → 외부에서 추가 설정 없이 `<iframe sandbox srcdoc>` 동작).
- `desktop/package.json` 에는 esbuild-wasm / mermaid / react-dom 등 artifact 런타임 의존성이 없으며, 이번 v0.5 범위에서 새로 추가하지 않는다.
- `desktop/src/components/chat/Composer.test.tsx` 가 vitest + @testing-library/react 예시로 존재 (테스트 컨벤션 확인됨).

## 3. 범위

### 포함

1. `html`, `svg`, `mermaid`, `reactjs` 4종 단일 파일 아티팩트의 렌더링 (단, 5.4.1 WebView 스파이크 결과에 따라 mermaid/reactjs 가 v0.5.0 에서 제외될 수 있음).
2. `MarkdownRenderer` 의 custom `code` 컴포넌트에서 펜스 헤더 언어를 감지해 (a) 인라인 `ArtifactInlineCard` 를 메시지 버블 안에 노출하고 (b) 메시지 클릭 시 `ArtifactViewerModal` 을 띄운다.
3. 샌드박스 `<iframe sandbox="allow-scripts" srcdoc={...}>` 기반 단일 진입 렌더러와 `postMessage` 기반 런타임 에러 브리지.
4. 시스템 프롬프트에 artifact 출력 규칙 4~6줄 자동 주입 (`web/backend/main.py` 의 `system_prompt += _build_mcp_section(...)` 직후).
5. `parseReplySegments` 의 경량 포팅 (스트리밍 safe, 닫히지 않은 펜스를 partial artifact 로 노출, `thinking` 블록 strip).
6. 단위 테스트:
   - `useArtifact.test.js` — `parseReplySegments` 의 12개 케이스 (헤더, `{path=...}` 속성, GLM 식 글루드 오프너, partial streaming, dedupe, thinking strip)
   - `artifactTemplates.test.js` — 4종 언어 × 1~2 fixture 의 srcdoc 스냅샷
   - `MarkdownRenderer.test.jsx` — 비-아티팩트 언어는 기존 `<pre><code>` 보존 + 아티팩트 언어 분기
7. 수동 검증: `npm run tauri:dev` 로 Chat 패널에서 ` ```html ` 그라디언트 버튼 + (스파이크 통과 시) ` ```mermaid ` 플로우차트 두 fixture 를 렌더.
8. Tauri WebView 스파이크: `<iframe sandbox srcdoc>` 내부에서 esm.sh ES module dynamic import 가 macOS / Windows / Linux 세 OS 모두 동작함을 `npm run tauri:dev` 의 DevTools 로 검증. 실패 시 fallback (5.4.1 §3).

### 제외 (v0.6+ 로 연기)

- `tsx` / `jsx` / `vue` / `svelte` 다중 파일, esbuild-wasm 번들, import map, vendored vendor.
  - Tauri 번들 +30MB, 첫 빌드 1~2s 부하. v0.6+ 에서 llamacoder `architecture.md` 그대로 포팅.
- `CodingPanel` 우측 사이드 패널( `WorkspaceSidebar` 옆 ) 슬라이드 인. v0.5 에서는 모달과 인터페이스만 준비하고 마운트는 다음 마일스톤.
- 공개 share URL, `app/share/[id]` 라우트, S3 업로드.
- 자동 fix, Tailwind 컴파일, 버전 히스토리, Refresh/Download 버튼.
- `App.tsx` / `WorkPanel.tsx` / `MessageBubble.tsx` 비활성 서브트리.
- WebView 스파이크가 실패한 OS 에서 mermaid/reactjs 지원. v0.5.0 은 html+svg 만.

## 4. 설계 원칙

- **단일 진입점 분기**: 메시지 content 의 펜스 처리는 `MarkdownRenderer` 의 custom `code` 컴포넌트 한 곳에서만 한다. Chat 패널과 Coding 패널이 같은 컴포넌트를 거치므로 양쪽에 자동 적용된다.
- **저장 0 변경**: 아티팩트는 메시지 content 안의 펜스 텍스트로만 존재. `JSONConversationStore` 의 스키마, `conv_store.py` 의 `Conversation` 메시지 구조, `web/backend/main.py` 의 WebSocket 페이드를 손대지 않는다. 렌더 시점에만 파싱한다.
- **샌드박스 일관성**: 모든 4종 아티팩트는 동일한 `<iframe sandbox="allow-scripts" srcdoc>` 한 가지 메커니즘을 사용한다. 메인 React 트리는 iframe 내부 JS / storage / `parent.opener` 접근 불가. `allow-same-origin` 을 일부러 주지 않아 iframe origin 은 `null` 이다.
- **외부 의존성 0 (번들)**: react / react-dom / mermaid 는 모두 `esm.sh` 의 pinned 버전을 srcdoc 안의 `<script type="importmap">` 로 주입한다. Tauri 번들 사이즈 영향 0. 단, 첫 아티팩트 렌더 시 CDN 페치 비용이 발생한다 (오프라인 환경에서는 fallback "Failed to load runtime" 토스트).
- **스트리밍 안전**: 닫히지 않은 펜스는 partial artifact 로 노출. 디바운스 200ms. 스트리밍 중에는 iframe `key` 를 누적된 `code` 해시로 바꿔 매 글자마다 iframe 을 다시 만들지 않는다.
- **React hook 호환성**: `new Function` 기반 reactjs 템플릿은 `useState` / `useEffect` / `useRef` / `useMemo` / `useCallback` / `useContext` / `useReducer` / `Fragment` / `createElement` 8개 바인딩을 모두 Function body 시작부에서 `const {…} = React;` 로 destructure 해 노출한다. 사용자가 `React.useState` 같은 점 표기나 직접 import 없이도 흔한 hook 을 자유롭게 쓸 수 있어야 한다.
- **기존 동작 보존**: `react-markdown` 의 다른 컴포넌트( `pre`, `p`, `ul`, … ) 와 비-아티팩트 언어(`python`, `bash`, `ts` 등) 의 렌더링은 1바이트도 바꾸지 않는다. 회귀 테스트로 명시.

## 5. 아키텍처

### 5.1 파일 변경/추가

```
desktop/src/components/artifact/         NEW
├── useArtifact.js                       parseReplySegments + parseFenceHeader + isArtifactLanguage + detectArtifacts
├── artifactTemplates.js                 buildSrcDoc(language, code) — html/svg/mermaid/reactjs 4종
├── ArtifactViewer.jsx                   <iframe sandbox srcdoc={...} /> + postMessage bridge
├── ArtifactInlineCard.jsx               메시지 버블 안 인라인 "Open Preview" 버튼 + 요약
├── ArtifactViewerModal.jsx              Dialog 래퍼 (radix Dialog) + close on Esc
├── ArtifactExtractor.jsx                MarkdownRenderer custom 'code' 컴포넌트에서 호출
├── __spike__/
│   └── webview-esm.html                 5.4.1 WebView 스파이크 페이지
└── __tests__/
    ├── useArtifact.test.js
    ├── artifactTemplates.test.js
    └── MarkdownRenderer.test.jsx        (desktop/src/components/MarkdownRenderer.test.jsx 동거)

desktop/src/components/MarkdownRenderer.jsx     CHANGED
  custom 'code' 컴포넌트에서 ArtifactExtractor 호출. 비-아티팩트 언어는 기존 <pre><code> 그대로.

desktop/src/components/chat/ChatPanel.jsx       CHANGED
  메시지 클릭 핸들러 (msg click) → ArtifactViewerModal 마운트. `messages.map` 의 assistant 메시지에 onClick 추가.

desktop/src/components/coding/CodingPanel.jsx   CHANGED
  동일 onClick 핸들러를 assistant 메시지 버블에 추가. 인터페이스는 동일 모달 재사용.

web/backend/main.py                              CHANGED
  _build_mcp_section 호출 직후, 4~6줄짜리 "## Artifacts" 섹션을 system_prompt 에 append.

desktop/src/components/ui/dialog.jsx             VERIFY (없으면 shadcn Dialog 1 파일 추가)
  radix-ui Dialog 가 이미 의존성에 있음 (@radix-ui/react-dialog ^1.1.2).
```

### 5.2 데이터 흐름

```
[LLM stream chunk]
  → useChat / useCodingChat WebSocket handler
  → append to msg.content
  → React re-render
  → <MarkdownRenderer content={msg.content} />
  → react-markdown → custom 'code' 컴포넌트
  → ArtifactExtractor(language, code)
    ├── not artifact  → <pre><code> (기존)
    └── is artifact   → <ArtifactInlineCard onOpen={…} code={…} language={…} />
  → 사용자 클릭 → ChatPanel state.showArtifact = { msgId, code, language }
  → <ArtifactViewerModal>
    → <ArtifactViewer code language />
      → <iframe sandbox="allow-scripts" srcdoc={buildSrcDoc(language, code)} />
      → iframe 내부 window.onerror / unhandledrejection → window.parent.postMessage(...)
      → ArtifactViewer 가 message 수신 → 토스트 표시
```

### 5.3 useArtifact.js 시그니처

```js
// 메시지 content 를 {type: 'text' | 'artifact', ...} 세그먼트로 분해.
// streaming safe: 닫히지 않은 마지막 펜스도 isPartial=true 로 반환.
// thinking 블록(GLM/일부 모델이 <thinking>...</thinking> 으로 추론 누출)은 텍스트에서 strip.
export function parseReplySegments(markdown: string): Segment[]

// 펜스 헤더에서 언어와 path 추출. ```tsx{path=src/App.tsx} 같은 글루드 케이스,
// ```tsx\n{path=src/types.ts}\n 코드 GLM 케이스, ```tsx{path=src/data.ts\n} 같은 brace 분리 케이스 처리.
function parseFenceHeader(tag: string): { language, path }
function parseAttributeLine(line: string): string | null
function resolveBlockPath(fenceTag, code): { language, path, code }

// 아티팩트 대상 언어 여부. 'html' / 'svg' / 'mermaid' / 'reactjs' (대소문자 무시).
// 'htm', 'xhtml' 는 false. 'mermaidjs' 는 true 로 정규화.
export function isArtifactLanguage(lang: string | undefined): boolean

// 메시지 content 에서 artifact 세그먼트만 추출. 디바운스/스트리밍용 hook.
export function detectArtifacts(content: string): ArtifactSegment[]
```

### 5.4 artifactTemplates.js

`buildSrcDoc(language, code) → string`. 4종 분기:

- `html` / `htm` — `<!doctype html><html><head><meta charset="utf-8">${escapeScriptContents(code)}</head><body>${extractBody(code)}</body></html>`. body 추출은 `<body>...</body>` 가 있으면 그 안, 없으면 code 전체.
- `svg` — `<!doctype html><html><body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#fff">${escapeScriptContents(code)}</body></html>`.
- `mermaid` — `<!doctype html><html><head>...<script type="module">import mermaid from 'https://esm.sh/mermaid@11.4.0'; mermaid.initialize({startOnLoad:true, theme:'default'});<\/script></head><body><pre class="mermaid">${escapeHtml(code)}</pre></body></html>`. `</script` 시퀀스는 `<\/script` 로 escape (`escapeScriptContents` 헬퍼).
- `reactjs` — `<!doctype html><html><head><script type="importmap">{"imports":{"react":"https://esm.sh/react@18.3.1","react-dom/client":"https://esm.sh/react-dom@18.3.1/client","react-dom":"https://esm.sh/react-dom@18.3.1"}}<\/script><script type="module">import React, {useState} from 'react'; import {createRoot} from 'react-dom/client'; const CODE_STRING = ${JSON.stringify(code)}; try { const fn = new Function('React', 'const {useState,useEffect,useRef,useMemo,useCallback,useContext,useReducer,Fragment,createElement} = React;' + CODE_STRING + '; return typeof App!=="undefined"?App:null;'); const App = fn(React); if (App) createRoot(document.getElementById('root')).render(React.createElement(App)); else document.getElementById('root').innerHTML = '<pre style="color:#b91c1c">No App component exported</pre>'; } catch(e) { document.getElementById('root').innerHTML = '<pre style="color:#b91c1c">'+e.message+'</pre>'; }<\/script></head><body><div id="root"></div></body></html>`. **JSON.stringify 로 백틱/줄바꿈/유니코드 모두 안전하게 escape. `new Function` 의 두 번째 인자는 destructure 1줄 + 모델이 작성한 본문 + 마지막에 App 반환하는 wrapper. 흔한 hook 8종을 Function body 시작부에서 const destructure 로 노출하므로 모델이 `useState`, `useEffect`, `useRef` 등을 점 표기나 import 없이 자유롭게 쓸 수 있다.**

### 5.4.1 WebView 런타임 호환성 스파이크 (Tauri)

Tauri 의 WebView2 (Windows) / WKWebView (macOS) / WebKitGTK (Linux) 는 opaque-origin (`<iframe sandbox="allow-scripts">` 의 origin = `null`) 일 때 cross-origin ES module 페치를 스톡 브라우저보다 엄격하게 거부하는 알려진 케이스가 있다. `reactjs`/`mermaid` 모두 esm.sh 모듈을 iframe 내부에서 동적 import 하므로 **구현 1단계 전에 spike를 통과시켜야 한다**.

스파이크 절차 (구현 Phase 0):

1. `desktop/src/components/artifact/__spike__/webview-esm.html` 10줄 짜리 정적 페이지를 만든다:
   ```html
   <!doctype html><iframe sandbox="allow-scripts" srcdoc="
   <script type='module'>
     import React from 'https://esm.sh/react@18.3.1';
     import mermaid from 'https://esm.sh/mermaid@11.4.0';
     window.onerror = (m) => parent.postMessage({type:'artifact:error', message:m}, '*');
     parent.postMessage({type:'artifact:ready', react: typeof React, mermaid: typeof mermaid}, '*');
   </script>
   "></iframe>
   <script>window.addEventListener('message', e => console.log(e.data));</script>
   ```
2. `npm run tauri:dev` 로 데스크탑 윈도우를 띄우고 F12 DevTools 콘솔에서 `{react:'object', mermaid:'function'}` 메시지를 확인한다.
3. 세 OS 중 하나라도 `artifact:error` 또는 모듈 페치 실패가 나오면 **fallback 정책**:
   - MVP(`v0.5.0`)는 `html` + `svg` 만 지원. `mermaid`/`reactjs` 는 v0.6+ 로 연기.
   - 시스템 프롬프트의 `## Artifacts` 섹션은 즉시 `mermaid` / `reactjs` 항목을 제거하고 `html` / `svg` 만 안내한다.
   - `isArtifactLanguage` 도 두 언어만 true 로 좁히고, `artifactTemplates.js` 도 두 분기만 남긴다 (dead-code 가 아니라 intentional no-op).
   - `<iframe>` 은 동일하게 유지하되 외부 import 가 없으므로 WebView 런타임과 무관하게 동작.
4. 스파이크가 통과한 OS 는 README 의 "지원 환경" 섹션에 명시. 통과하지 않은 OS 는 v0.6 까지 `html`/`svg` 만 사용 가능함을 안내.

이 스파이크는 v0.5 의 모든 후속 구현보다 **먼저** 끝나야 한다. 실패 시 후속 작업의 절반(`artifactTemplates.js` 4종 중 2종 + `useArtifact.test.js` 의 mermaid/reactjs 케이스 + `MarkdownRenderer.test.jsx` 의 mermaid/reactjs 분기 + 수동 검증의 mermaid/reactjs 시나리오)이 무의미해진다.

### 5.5 ArtifactViewer 런타임 에러 브리지

```js
// ArtifactViewer.jsx 내부
useEffect(() => {
  function onMessage(ev) {
    if (ev.source !== iframeRef.current?.contentWindow) return;
    if (ev.data?.type === 'artifact:error') toast.error(ev.data.message);
  }
  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
}, []);

// iframe srcdoc 안 <script> 에 다음 코드 주입 (모든 4종 공통):
//   window.onerror = (m, s, l, c, e) => parent.postMessage({type:'artifact:error', message:m}, '*');
//   window.onunhandledrejection = (e) => parent.postMessage({type:'artifact:error', message:String(e.reason)}, '*');
```

### 5.6 시스템 프롬프트 주입 (`web/backend/main.py`)

`system_prompt += _build_mcp_section(mcp_tools or [])` 직후, 다음 4줄을 `system_prompt +=` 로 추가:

```python
ARTIFACT_RULES = """## Artifacts
When the user asks for UI, a button/component, a diagram, a chart, an SVG illustration, or any self-contained visual artifact, ALWAYS respond with a single fenced code block:
- HTML page → ```html
- SVG illustration → ```svg
- Mermaid diagram (flowchart, sequence, ER, gantt, class) → ```mermaid
- Single-file React component (no JSX/TSX) → ```reactjs

Write the code so it is self-contained: inline CSS, pinned `esm.sh` URLs for any runtime (e.g. `react@18.3.1`, `mermaid@11.4.0`). No external assets, no multi-file project, no build step. Keep the code in ONE fence per artifact; the desktop app will render it in a sandboxed preview. For React, export a top-level `function App()` (or `const App = () => …`) and freely use `useState`, `useEffect`, `useRef`, `useMemo`, `useCallback`, `useContext`, `useReducer` — they are all available without import."""
system_prompt += "\n\n" + ARTIFACT_RULES
```

이 주입은 IDENTITY.md 유무와 무관하게 매 세션에 적용된다 (graceful degradation 유지).

## 6. 보안

- `<iframe sandbox="allow-scripts" srcdoc>` 사용. `allow-same-origin` 을 일부러 주지 않음 → iframe origin 이 `null` 이 되어 메인 origin 의 storage / cookie / `parent.opener` 접근 불가.
- srcdoc 내부 `<script>` 의 `</script` 시퀀스는 `<\/script` 로 escape (`escapeScriptContents` 헬퍼).
- `reactjs` 의 `new Function` 은 iframe sandbox 내부에서만 실행. 메인 React 트리에 영향 없음. Function body 시작부에서 React 객체를 destructure 하지만 그 외 외부 변수에 접근 불가.
- esm.sh CDN 페치는 iframe 내부에서만 일어남. 메인 origin 의 network 활동 없음.
- Tauri CSP `null` 이므로 추가 CSP 헤더 불필요. `index.html` 의 CSP 가 명시되면(향후) `frame-src 'self' data: blob:; script-src 'self' 'unsafe-inline' https://esm.sh;` 정도면 충분.

## 7. 테스트 설계

### 7.1 useArtifact.test.js (vitest, jsdom)

- `parseFenceHeader`: 일반 헤더, ` ```tsx{path=src/App.tsx} ` 글루드, brace 분리
- `parseAttributeLine`: `{path=src/types.ts}` 다음 줄, 알 수 없는 라인은 null
- `resolveBlockPath`: 헤더 우선, attribute 폴백, intelligent name 폴백
- `dedupePath`: 충돌 시 `-2`, `-3` 부착
- `parseReplySegments`: 텍스트/파일 혼합, partial streaming (닫히지 않은 마지막 펜스), thinking 블록 strip, 빈 입력, 다중 펜스
- `isArtifactLanguage`: html/svg/mermaid/reactjs 만 true, tsx/jsx/python/bash false, 대소문자 무시
- `detectArtifacts`: 메시지에서 artifact 세그먼트만 추출

### 7.2 artifactTemplates.test.js

- html: `<script>` escape 정확성, `<body>` 자동 분리
- svg: viewBox 자동 보존 여부
- mermaid: importmap 누락, `</script` escape
- reactjs:
  - import map 의 react@18.3.1 pin
  - Function body 시작부의 destructure 라인에 8개 hook 이 모두 포함됨
  - `JSON.stringify(code)` 가 모델 본문 안의 백틱 / 줄바꿈 / 유니코드를 안전하게 escape
  - 모델이 `useState` 외 `useEffect` / `useRef` / `useMemo` / `useCallback` / `useContext` / `useReducer` 를 점 표기 없이 써도 ReferenceError 가 나지 않음 (실제 iframe 안에서 렌더하지는 않고 코드 패턴만 검증)

### 7.3 MarkdownRenderer.test.jsx

- ` ```python ` → 기존 `<pre><code>` 그대로 (회귀 보호)
- ` ```html ` → ArtifactInlineCard 가 렌더되고 클릭 시 modal 트리거 가능
- inline backtick `` `code` `` → 기존 inline `<code>` 그대로
- 펜스가 없는 일반 텍스트 → 변화 없음

### 7.4 수동 검증 (Tauri)

- 5.4.1 WebView 스파이크를 먼저 통과시킬 것
- `npm run tauri:dev`
- Chat 패널에서 "그라디언트 버튼 하나 보여줘" → 모델이 ` ```html ` 응답 → 인라인 카드 → "Open Preview" → 모달 → 그라디언트 버튼이 iframe 안에서 동작
- (스파이크 통과 OS 한정) 같은 세션에서 "사용자 로그인 플로우 mermaid 로 그려줘" → 인라인 카드 + 모달에서 mermaid 다이어그램 렌더
- (스파이크 통과 OS 한정) "카운터 + 입력 폼 만들어줘" → reactjs 컴포넌트. `useState` 외 `useEffect` 로 자동 저장 시뮬레이션, `useRef` 로 input 포커스 등도 OK.
- Coding 패널에서 동일 시나리오 반복
- 모델이 `<thinking>...</thinking>` 으로 추론 누출하는 경우 → 텍스트에는 보이지 않고 artifact 추출에서도 제외됨

## 8. 검증

1. **Phase 0 RED (WebView 스파이크)** — `desktop/src/components/artifact/__spike__/webview-esm.html` 을 `npm run tauri:dev` 의 메인 페이지에 임시로 마운트하고, macOS / Windows / Linux 각각의 DevTools 콘솔에서 `artifact:ready` 수신 확인. 통과하지 못한 OS 가 있으면 fallback (5.4.1 §3) 적용 후 1번 재실행.
2. RED — `useArtifact.test.js`, `artifactTemplates.test.js`, `MarkdownRenderer.test.jsx` 실행: 12+ 케이스 실패 확인
3. GREEN — 위 3개 테스트가 모두 통과
4. 회귀 — `npm test` 전체 통과 (`Composer.test.tsx`, `WorkspaceSidebar.test.jsx` 등 기존 테스트 영향 없음)
5. 빌드 — `npm run build` Vite production build 성공
6. 수동 — `npm run tauri:dev` 에서 Chat + Coding 두 패널 모두 artifact 렌더 확인
7. 시크릿/로그 — `git diff` 로 `config/config.yaml`, `web/backend/main.py` 의 `api_key` 등 비밀이 변경되지 않았는지 확인

## 9. 완료 조건

- 5.4.1 WebView 스파이크 결과에 따라 `html` + `svg` (필수), `mermaid` / `reactjs` (스파이크 통과 OS 한정) 가 Chat + Coding 두 패널에서 렌더된다.
- 비-아티팩트 언어(`python`, `bash`, `ts`, 인라인 코드, 일반 마크다운)의 기존 렌더링이 1바이트도 바뀌지 않는다.
- `JSONConversationStore` 와 WebSocket 페이로드 스키마는 변경되지 않는다 (저장된 대화는 그대로 복원).
- 매 세션의 시스템 프롬프트에 artifact 출력 규칙이 자동 주입된다 (IDENTITY.md 유무 무관).
- reactjs 템플릿이 `useState` 외 `useEffect` / `useRef` / `useMemo` / `useCallback` / `useContext` / `useReducer` / `Fragment` / `createElement` 까지 destructure 로 노출하며, 단위 테스트가 이 8개 binding 존재를 검증한다.
- 단위 테스트 3종 + vitest 회귀 테스트 + production build 가 모두 통과한다.
- 비활성 `App.tsx` / `WorkPanel.tsx` / `MessageBubble.tsx` 는 수정하지 않는다.
- 다중 파일 React, esbuild-wasm, share URL, CodingPanel 사이드 패널, WebView 스파이크 실패 OS 에서의 mermaid/reactjs 는 이번 결과에서 완료된 것으로 보고하지 않는다.

## Phase 0 Spike Result

- macOS: **SKIPPED** per user decision (2026-07-19). User accepted all 4 languages (html, svg, mermaid, reactjs) shipping in v0.5.0 with the understanding that if any of the 3 Tauri WebView runtimes blocks the esm.sh ESM import inside `<iframe sandbox srcdoc>`, the artifact will render as an error bridge (red "Failed to load runtime" inside the iframe) rather than a graceful fallback. Fallback to `html+svg`-only (Task 2, Task 3 Step 5, Task 9 Step 2 narrow branch) remains available for any post-merge bug report.
- Windows: not tested on this machine.
- Linux: not tested on this machine.
- Languages shipping in v0.5.0: **html, svg, mermaid, reactjs** (optimistic default).

Spike HTML (`desktop/src/components/artifact/__spike__/webview-esm.html`) and its temporary `App.jsx` mount were reverted in commit following this entry; the spike file itself is retained as a developer reference for a future re-verification run.
