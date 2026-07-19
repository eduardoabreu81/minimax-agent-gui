# 한국어 번역 전수 검사 및 보완 설계

**작성일:** 2026-07-19  
**대상:** `desktop/`의 활성 Tauri 데스크톱 UI  
**기준 로케일:** `desktop/src/i18n/en.json`  
**대상 로케일:** `desktop/src/i18n/ko.json`

## 1. 목표

한국어 선택 시 활성 데스크톱 UI의 레이블, 버튼, 도움말, placeholder, 접근성 레이블, 검증·오류 문구에 의도하지 않은 영어 또는 raw i18n key가 노출되지 않도록 한다. 구조 누락을 복구하는 데서 끝내지 않고, 의미가 잘못된 기존 번역과 i18n을 우회하는 활성 컴포넌트 문자열까지 보완한다.

## 2. 현재 확인된 상태

영문 로케일은 leaf key 547개, 한국어 로케일은 342개다.

- 한국어 누락: 206개
  - `music`: 112개
  - `agentContext`: 71개
  - `settings`: 17개
  - `contextWindow`: 6개
- 구조 충돌: 1개
  - 영문의 `settings.update`는 객체지만 한국어는 문자열이다.
- placeholder 이름 불일치: 현재 공통 key 기준 0개
- 완전 미번역: `music.instrumentalActiveHint`
- 의미 오류:
  - `music.unlimitedDefault`: “무제한(기본)”은 영문의 “Free tier (lower RPM)”과 의미가 다르다.
  - `music.bestQuality`: 영문의 Token Plan 조건이 빠졌다.
  - `palette.results`: 현재 호출 방식과 결합하면 부자연스러운 한국어 어순이 된다.
- 잘못된 호출 namespace:
  - `IncompleteContextBanner.jsx`는 모든 로케일에 없는 `agentContext.banner.file.*`을 참조한다.

기존 `i18n.test.js`는 주석과 달리 전체 키 완전성을 검사하지 않는다. 네 개의 고정 interpolation key만 존재 여부와 placeholder를 확인하므로 현재 대규모 누락에도 통과한다.

## 3. 범위

### 포함

1. `ko.json`의 영문 기준 구조·타입·placeholder parity 복구
2. 기존 한국어 번역의 확인된 의미·문체 오류 수정
3. `main.jsx → App.jsx`에서 실제 도달 가능한 컴포넌트의 사용자 노출 하드코딩 영어 제거
4. 한국어 구조 drift와 알려진 질적 오류를 방지하는 회귀 테스트
5. 한국어로 활성 화면을 직접 순회하는 브라우저 검증

### 제외

1. `App.tsx`를 통해서만 도달하는 비활성 프로토타입 서브트리
   - `AppSidebar.tsx`
   - `ChatPanel.tsx`
   - `WorkPanel.tsx`
   - `MessageBubble.tsx`
2. 예외적으로 `Composer.tsx`는 `CodingPanel.jsx`에서 사용하므로 포함한다.
3. FastAPI HTTP/WebSocket 오류 계약과 Tauri Rust sidecar 이벤트의 코드화·다국어화
4. pt-BR, ja, es, zh-CN 로케일의 구조 누락 보완
5. `MiniMax 에이전트`와 `MiniMax Studio` 중 하나로 브랜드 정책을 재결정하는 작업

백엔드나 Rust에서 영어 원문으로 전달되는 메시지는 별도 프로토콜 변경이 필요한 후속 범위다. 이번 작업은 프론트엔드가 직접 소유하는 활성 UI 문구를 완결한다.

## 4. 번역 원칙

- 자연스러운 존댓말 한국어를 사용한다.
- `MiniMax`, `MiniMax Studio`, `Token Plan`, `MCP`, `API`, `Git`, 모델명, 파일 형식, URL, Voice ID와 같은 고유명사·식별자는 유지한다.
- 영어 어순을 직역하지 않고 실제 호출부와 interpolation 위치를 기준으로 문장을 구성한다.
- `{pct}`, `{used}`, `{limit}`, `{version}`, `{file}` 등의 placeholder 이름은 영문과 정확히 일치시킨다.
- 사용자 행동은 일관된 동사로 번역한다: Save=저장, Delete=삭제, Retry=다시 시도, Dismiss=닫기.
- 단위와 제한 조건은 생략하지 않는다. 유료/무료 티어, 길이 제한, 만료, 비가역 작업 같은 의미 정보는 반드시 보존한다.
- API에 전달되는 enum 값과 모델 식별자는 번역하지 않는다. 표시 전용 label만 번역한다.

## 5. 설계

### 5.1 단계 A — 로케일 구조 및 품질 복구

`en.json`을 기준으로 `ko.json`의 누락 206개 leaf key를 동일한 객체 구조에 추가한다.

- `settings`: 오디오 기본값과 업데이트 상태 문구
- `music`: 작곡, 커버, 가사 생성, 음성 합성·복제·디자인·보이스 라이브러리, delivery, metadata, 검증 문구
- `contextWindow`: 경고, 자동 압축, 강제 압축, 실행·진행·닫기 문구
- `agentContext`: 배너, 설정 마법사, personality, identity, memory, daily, viewer, common, presets, roles, file label

`settings.update` 충돌은 다음처럼 해소한다.

- 일반 “업데이트” 버튼은 `settings.updateAction`을 사용한다.
- `settings.update`는 영문과 동일한 상태 객체로 통일한다.
- 기존 `t('settings.update')` 호출 두 곳을 `t('settings.updateAction')`으로 이동한다.

질적 오류는 구조 parity와 별도로 수정한다.

- `music.instrumentalActiveHint`: 보컬과 가사가 없는 연주곡이라는 의미로 번역
- `music.unlimitedDefault`: 무료 티어와 낮은 RPM 의미 명시
- `music.bestQuality`: Token Plan 조건 명시
- `palette.results`: `{count}`를 번역 문자열 안으로 이동해 “결과 {count}개”로 렌더링한다. `CommandPalette.jsx` 호출부를 `t('palette.results', { count: flatItems.length })`로 바꾸고, 모든 로케일에 동일한 `{count}` placeholder를 추가해 호출부·로케일·placeholder 검사를 한 단위로 변경한다.
- `music.banner`: 현재 구현에 이미 존재하는 커버·가사 기능을 “Phase 2/3에서 제공 예정”이라고 되돌리지 않는다. 현재 기능을 정확히 설명하는 한국어를 유지한다.

### 5.2 단계 B — 활성 컴포넌트 하드코딩 제거

각 후보는 수정 전 import 경로를 `main.jsx → App.jsx`에서 추적한다. 활성 경로가 확인된 문자열만 수정한다.

우선순위는 다음과 같다.

1. 매 실행마다 보이는 셸
   - `BackendLoader.jsx`
   - `Titlebar.jsx`
   - `Sidebar.jsx`
   - `StatusBar.jsx`
2. 핵심 작업 흐름
   - `ChatPanel.jsx`
   - `CodingPanel.jsx`
   - `Composer.tsx`
   - `WorkspaceSidebar.jsx`
   - `AgentChatPanel.jsx`
3. 미디어
   - `ImagePanel.jsx`
   - `MusicPanel.jsx`
   - `SpeechPanel.jsx`
   - `VideoPanel.jsx`
   - `RecentGenerations.jsx`
4. 설정과 보조 화면
   - `SettingsPanel.jsx`
   - `SkillsTab.jsx`
   - `CommandPalette.jsx`
   - `TaskBoard.jsx`
   - 활성 Agent Context 컴포넌트

처리 규칙:

- 기존 key가 의미상 맞으면 재사용한다.
- 다른 의미를 같은 key에 억지로 합치지 않는다.
- 새 key가 필요하면 먼저 `en.json`에 기준 문구를 추가하고 `ko.json`에 한국어를 추가한다.
- 이번 한국어 작업으로 다른 언어에서 raw key가 노출되지 않도록, 신규 기준 key에는 기존 영어 UI 문구를 다른 로케일의 명시적 fallback 값으로 추가한다. 기존 4개 비영어 로케일의 대규모 번역 자체는 범위에 포함하지 않는다.
- 모듈 스코프의 선택지 배열에는 `t()`를 호출하지 않는다. `ImagePanel.jsx`의 `ASPECT_RATIOS`/`IMAGE_MODES`, `MusicPanel.jsx`의 `MUSIC_MODES`, `VideoPanel.jsx`의 `VIDEO_MODES`, `WorkspaceSidebar.jsx`의 `TABS`처럼 모듈 스코프에 있는 배열은 `labelKey`만 저장하고 렌더 시 `t(item.labelKey)`로 해석한다. 이미 컴포넌트 내부에 있고 `useTranslation()` 뒤에 선언된 배열은 직접 `t()`를 사용할 수 있다.
- title, aria-label, placeholder, confirm/alert, validation state, empty/loading/error state를 시각 텍스트와 동일하게 다룬다.
- 모델 ID, API enum, URL 예시, 파일 확장자, 키 형식 예시는 번역 대상에서 제외한다.

`agentContext.banner.file.*` 호출은 새 잘못된 namespace를 만드는 대신 기존 `agentContext.file.*`을 참조하도록 수정한다.

### 5.3 단계 분리

단계 A와 단계 B는 별도 검증 게이트로 실행한다.

- 단계 A가 테스트와 빌드를 통과한 뒤 단계 B를 시작한다.
- 단계 B는 컴포넌트 군별로 작은 변경 단위로 진행한다.
- 각 군은 관련 렌더링 테스트 또는 실제 화면 확인 뒤 다음 군으로 이동한다.

이 순서는 순수 데이터 복구를 행동 코드 변경에 묻히지 않게 하고, 회귀 발생 시 원인을 좁힌다.

## 6. 테스트 설계

### 6.1 구조 parity 테스트

기존 `i18n.test.js`에 재귀 검사를 추가한다.

- 영문과 한국어의 전체 key path 집합 일치
- 각 노드의 객체/문자열 타입 일치
- leaf 값은 비어 있지 않은 문자열
- 모든 interpolation placeholder 집합 일치
- mustache 형태 `{{name}}` 금지 유지

이 테스트는 구현 전에 실행해 현재 누락 206개와 `settings.update` 타입 충돌로 실패하는 것을 확인한다.

다른 네 비영어 로케일은 이미 구조가 뒤처져 있으므로 이번 parity gate의 대상은 `en`과 `ko`다. 기존 6개 로케일의 고정 interpolation 테스트는 유지한다.

### 6.2 질적 회귀 테스트

구조 비교로 검출할 수 없는 알려진 오류를 한국어 런타임 렌더링으로 고정한다.

- `music.instrumentalActiveHint`에 영어 원문이 남지 않음
- `music.bestQuality`에 `Token Plan` 포함
- `music.unlimitedDefault`에 무료 티어와 낮은 RPM 의미 포함
- `palette.results`에 count를 전달하면 자연스러운 “결과 5개” 렌더링
- `settings.update.available`의 `{version}` 치환
- `contextWindow.*`와 `agentContext.*`의 주요 placeholder 치환

### 6.3 컴포넌트 테스트

기존 테스트가 있는 고위험 컴포넌트는 한국어로 렌더링해 다음을 검증한다.

- raw key 미노출
- 고정 영어 label·aria-label·placeholder 미노출
- 기존 click/submit 동작 유지
- `IncompleteContextBanner`가 `agentContext.file.*` label을 표시

새 테스트는 문구의 전체 문장보다 사용자에게 관찰되는 계약과 key 해석 여부를 검증한다.

## 7. 검증

1. 단계 A RED: 한국어 parity 테스트가 현재 206개 누락과 타입 충돌로 실패
2. 단계 A GREEN: i18n 테스트와 관련 컴포넌트 테스트 통과
3. 단계 A 빌드: `desktop` Vite production build 성공
4. 단계 B: 컴포넌트 군별 테스트 통과
5. 전체 프론트엔드 테스트: `npm test`
6. production build: `npm run build`
7. 실제 Vite 앱을 한국어로 실행하고 다음을 순회
   - 첫 실행/백엔드 로더
   - 채팅과 코딩 입력·대화 목록
   - 이미지·음악(작곡/커버/가사)·음성(합성/복제/디자인/보이스)·비디오
   - 설정의 오디오, 업데이트, Skills
   - Agent Context 배너, 마법사, 파일 뷰어
   - 명령 팔레트, 상태 바, 작업 보드
8. 각 화면에서 raw key, 의도치 않은 영어 문장, 잘린 문구, placeholder 미치환 여부 확인

## 8. 완료 조건

- `en.json`과 `ko.json`의 전체 구조, 노드 타입, placeholder 집합이 일치한다.
- 확인된 206개 누락과 `settings.update` 충돌이 사라진다.
- 확인된 네 가지 질적 번역 오류가 수정되고 회귀 테스트로 보호된다.
- 활성 컴포넌트의 프론트엔드 소유 사용자 문구가 i18n을 거친다.
- 비활성 `App.tsx` 서브트리는 수정하지 않는다.
- 전체 프론트엔드 테스트와 production build가 성공한다.
- 한국어 실제 화면 순회에서 raw key와 의도치 않은 영어 노출이 발견되지 않는다.
- 백엔드/Rust 원문 오류와 다른 로케일의 대규모 구조 drift는 이번 결과에 완료된 것으로 보고하지 않는다.
