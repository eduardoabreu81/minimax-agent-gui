# Korean Localization Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore complete Korean locale parity and remove unintended English from every UI path reachable from `desktop/src/main.jsx → App.jsx`.

**Architecture:** Phase A first makes `en.json` and `ko.json` structurally identical and protects that contract with recursive locale tests. Phase B converts only reachable frontend-owned strings to `react-i18next`, resolving module-scope option arrays through `labelKey` fields at render time. Backend/Rust message contracts and the orphaned `App.tsx` subtree remain untouched.

**Tech Stack:** React 18, react-i18next/i18next, Vitest, Testing Library, Vite, Tauri desktop shell.

## Global Constraints

- Translation tone: natural Korean honorific UI copy.
- Keep `MiniMax`, `MiniMax Studio`, `Token Plan`, `MCP`, `API`, `Git`, model IDs, URLs, file formats, and Voice IDs unchanged.
- `en.json` is the reference locale; enforce full tree/type/placeholder parity only for `en` and `ko`.
- Do not bulk-translate pt-BR, ja, es, or zh-CN. When Phase B adds a new reference key, add the current English UI text as that key's explicit fallback in those four locale files.
- Exclude `App.tsx`, `AppSidebar.tsx`, `ChatPanel.tsx`, `WorkPanel.tsx`, and `MessageBubble.tsx`; they are unreachable from `main.jsx`.
- Include `Composer.tsx`; `CodingPanel.jsx` imports it directly.
- Do not localize FastAPI HTTP/WebSocket payloads or Rust sidecar events in this change.
- Do not call `t()` at module scope. Module-scope display arrays store `labelKey`/`titleKey`; components resolve them with `t()` while rendering.
- Preserve all single-brace placeholders exactly: `{count}`, `{pct}`, `{used}`, `{limit}`, `{version}`, `{file}`, `{date}`, `{n}`, `{khz}`, `{kbps}`, `{format}`.
- Keep the user-owned `desktop/package-lock.json` change out of every commit.

---

### Task 1: Add the failing Korean locale contract

**Files:**
- Modify: `desktop/src/i18n/i18n.test.js:64-192`

**Interfaces:**
- Consumes: imported `en`, `ko`, and existing `extractVars(str)`.
- Produces: recursive locale-tree contract used by every later task.

- [ ] **Step 1: Add recursive shape helpers and failing parity tests**

Add helpers that retain both branch and leaf paths so an object/string mismatch is visible:

```js
function nodeType(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? 'object'
    : typeof value
}

function collectNodes(value, prefix = '', out = new Map()) {
  if (prefix) out.set(prefix, { type: nodeType(value), value })
  if (nodeType(value) === 'object') {
    for (const [key, child] of Object.entries(value)) {
      collectNodes(child, prefix ? `${prefix}.${key}` : key, out)
    }
  }
  return out
}
```

Add four tests:

```js
it('keeps the Korean locale tree identical to English', () => {
  const enNodes = collectNodes(en)
  const koNodes = collectNodes(ko)
  expect([...koNodes.keys()].sort()).toEqual([...enNodes.keys()].sort())
  for (const [key, enNode] of enNodes) {
    expect(koNodes.get(key)?.type, `ko.${key} has a different node type`).toBe(enNode.type)
  }
})

it('keeps every Korean leaf non-empty', () => {
  for (const [key, node] of collectNodes(ko)) {
    if (node.type === 'string') expect(node.value.trim(), `ko.${key} is empty`).not.toBe('')
  }
})

it('keeps placeholders aligned between English and Korean', () => {
  const koNodes = collectNodes(ko)
  for (const [key, node] of collectNodes(en)) {
    if (node.type !== 'string') continue
    expect(extractVars(koNodes.get(key)?.value || ''), `ko.${key} placeholder drift`).toEqual(extractVars(node.value))
  }
})

it('pins known Korean semantic translations', async () => {
  await i18n.changeLanguage('ko')
  expect(i18n.t('music.instrumentalActiveHint')).toBe('이 곡은 보컬과 가사 없이 연주곡으로 생성됩니다.')
  expect(i18n.t('music.bestQuality')).toContain('Token Plan')
  expect(i18n.t('music.unlimitedDefault')).toBe('무료 티어(낮은 RPM)')
  expect(i18n.t('palette.results', { count: 5 })).toBe('결과 5개')
})
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
cd desktop && npm test -- src/i18n/i18n.test.js
```

Expected: FAIL. The shape test reports 206 missing Korean leaf keys and the `settings.update` object/string collision; the semantic test reports the untranslated/incorrect music values and count order.

- [ ] **Step 3: Commit the failing contract**

```bash
git add desktop/src/i18n/i18n.test.js
git commit -m "test(i18n): require complete Korean locale parity"
```

---

### Task 2: Restore the Korean settings and context trees

**Files:**
- Modify: `desktop/src/i18n/en.json:88-292`
- Modify: `desktop/src/i18n/ko.json:88-274`
- Modify: `desktop/src/i18n/pt-BR.json`
- Modify: `desktop/src/i18n/ja.json`
- Modify: `desktop/src/i18n/es.json`
- Modify: `desktop/src/i18n/zh-CN.json`
- Modify: `desktop/src/components/settings/SettingsPanel.jsx:919,1187`
- Modify: `desktop/src/components/command-palette/CommandPalette.jsx:323`

**Interfaces:**
- Consumes: Task 1 locale contract and existing single-brace interpolation config.
- Produces: `settings.updateAction: string`, `settings.update: object`, complete Korean `contextWindow` and `agentContext` branches, and parameterized `palette.results`.

- [ ] **Step 1: Add the coordinated reference keys and callers**

Add `settings.updateAction: "Update"` to English and `settings.updateAction: "업데이트"` to Korean. Add explicit minimal fallback values to the remaining locales: pt-BR `"Atualizar"`, ja `"更新"`, es `"Actualizar"`, zh-CN `"更新"`.

Change both generic update buttons in `SettingsPanel.jsx`:

```jsx
{t('settings.updateAction')}
```

Do not change updater-state calls such as `t('settings.update.check')`.

Change `palette.results` and its caller atomically:

```json
// en
"results": "{count} results"
// pt-BR
"results": "{count} resultados"
// ja
"results": "結果 {count} 件"
// ko
"results": "결과 {count}개"
// es
"results": "{count} resultados"
// zh-CN
"results": "{count} 个结果"
```

```jsx
<span className="ml-auto">{t('palette.results', { count: flatItems.length })}</span>
```

- [ ] **Step 2: Replace Korean `settings.update` and add missing settings copy**

Use these exact Korean values:

```json
"audio": "오디오",
"audioDefaults": "음악 생성 기본값",
"audioDefaultsDesc": "이 기본값은 음악 패널의 모든 요청과 함께 전송됩니다. 음악 패널은 마운트 시 이 값을 읽고, 요청에서 생략되면 백엔드가 기본값으로 사용합니다.",
"audioSampleRate": "샘플레이트",
"audioBitrate": "비트레이트",
"audioFormat": "형식",
"audioLowBitrateWarn": "낮은 비트레이트({kbps}kbps)를 선택했습니다. 오디오가 눈에 띄게 압축되어 들릴 수 있으므로 음악에는 128kbps 이상을 권장합니다.",
"audioHighBitrateHint": "선택한 프리셋: {khz}kHz · {kbps}kbps · {format}. 비트레이트가 높을수록 파일은 커지지만 더 많은 디테일을 유지합니다.",
"updateAction": "업데이트",
"update": {
  "check": "업데이트 확인",
  "checking": "확인 중…",
  "upToDate": "최신 버전입니다",
  "available": "업데이트 사용 가능: v{version}",
  "download": "다운로드 및 설치",
  "downloading": "다운로드 중…",
  "restart": "다시 시작하여 적용",
  "error": "업데이트를 확인할 수 없습니다"
},
"audioSaved": "오디오 설정이 저장되었습니다."
```

- [ ] **Step 3: Add the complete Korean context-window and agent-context branches**

Use the following values, preserving the existing `roles.eng/reviewer/pm` and `presetDesc` values:

```json
"contextWindow": {
  "warnText": "컨텍스트 사용량이 {pct}%입니다. 다음 턴을 위한 공간을 확보하려면 지금 압축하세요.",
  "autoText": "컨텍스트 사용량이 {pct}%입니다. 대화를 계속할 수 있도록 자동으로 압축합니다.",
  "maxText": "컨텍스트 사용량이 {pct}%입니다. 강제로 압축하며, 90% 아래로 내려가면 턴 입력을 재개합니다.",
  "compactNow": "지금 압축",
  "compacting": "압축 중…",
  "dismiss": "닫기"
},
"agentContext": {
  "title": "에이전트 컨텍스트",
  "contextLabel": "컨텍스트",
  "subtitle": "5개의 파일이 이 워크스페이스에서 에이전트의 동작 방식을 정의합니다.",
  "userOnly": "사용자 전용",
  "youAndAgent": "사용자 + 에이전트",
  "agentAppends": "에이전트 자동 추가",
  "slot1": "슬롯 #1",
  "charCount": "{used} / {limit}자",
  "percent": "{pct}% 사용",
  "gracefulDegradation": "파일이 비어 있어도 어떤 조합이든 사용할 수 있습니다. 필수 정보가 빠지면 에이전트는 가능한 범위에서 동작하고 배너로 알려줍니다.",
  "banner": {
    "incomplete": "에이전트 컨텍스트가 완전하지 않습니다",
    "missingFile": "{file} 파일이 없어 에이전트가 사용자에 대해 제한된 정보만 알고 있습니다.",
    "setUpNow": "지금 설정",
    "openSettings": "설정 열기",
    "dismiss": "닫기"
  },
  "wizard": {
    "title": "MiniMax Studio 설정을 시작합니다",
    "subtitle": "간단한 4단계입니다. 건너뛰고 나중에 설정할 수도 있습니다.",
    "step": { "about": "사용자 정보", "personality": "성격", "identity": "역할", "review": "검토" },
    "skip": "건너뛰기",
    "back": "뒤로",
    "next": "다음",
    "create": "파일 {n}개 만들기",
    "name": "어떻게 불러드릴까요?",
    "namePh": "에이전트가 사용할 호칭을 입력하세요",
    "timezone": "시간대",
    "level": "기술 수준",
    "personalityQ": "어떤 말투로 답할까요?",
    "identityQ": "이 워크스페이스에서 에이전트의 기본 역할은 무엇인가요?",
    "reviewQ": "생성할 파일을 확인하세요",
    "levelBeginner": "초급",
    "levelMid": "중급",
    "levelSenior": "고급"
  },
  "personality": {
    "preset": "프리셋",
    "reset": "기본값으로 재설정",
    "customPlaceholder": "사용자 지정 성격…",
    "customOption": "사용자 지정(직접 편집)",
    "choosePreset": "프리셋을 선택하거나 자유롭게 편집하세요",
    "appliedHint": "프리셋이 적용되었습니다. 저장을 눌러 유지하세요."
  },
  "identity": { "quickSwitch": "빠른 전환", "customPlaceholder": "사용자 지정 역할 설명…" },
  "memory": { "view": "보기", "edit": "편집", "revert": "템플릿으로 되돌리기" },
  "daily": { "empty": "아직 로그가 없습니다.", "today": "오늘", "yesterday": "어제", "turns": "{n}턴" },
  "viewer": {
    "memory": {
      "title": "에이전트 메모리",
      "usageHeader": "MEMORY(에이전트 메모) · {pct}% — {used}/{limit}자",
      "empty": "비어 있습니다. 작업하면서 에이전트가 내용을 채웁니다.",
      "appendOnly": "추가 전용 · 에이전트가 업데이트"
    },
    "daily": { "title": "{date} 로그", "appendOnly": "추가 전용 · 에이전트가 매 턴 생성" }
  },
  "rerunOnboarding": "온보딩 다시 실행",
  "common": { "save": "저장", "cancel": "취소", "delete": "삭제" },
  "presets": { "concise": "간결함", "friendly": "친근함", "mentor": "멘토", "expert": "전문가", "creative": "창의적" },
  "roles": { "eng": "엔지니어링 파트너", "reviewer": "코드 리뷰어", "pm": "프로젝트 매니저", "custom": "사용자 지정" },
  "file": { "soul": "성격", "identity": "현재 역할", "user": "사용자 프로필", "memory": "프로젝트 메모리", "daily": "일일 로그" },
  "presetDesc": {
    "concise": "직접적이고 간결함. 형식보다 본질.",
    "friendly": "따뜻하고 격려하는 스타일. 성과를 축하하고 차분히 설명.",
    "mentor": "인내심 있음. 방법보다 이유를 먼저 설명.",
    "expert": "밀도 높고 기술적. 트레이드오프와 엣지 케이스를 언급.",
    "creative": "여러 선택지를 만들고 예상치 못한 관점을 탐색."
  }
}
```

- [ ] **Step 4: Run the focused test**

```bash
cd desktop && npm test -- src/i18n/i18n.test.js
```

Expected: still FAIL only on the remaining Korean `music.*` keys and semantic music assertions.

- [ ] **Step 5: Commit the settings/context slice**

```bash
git add desktop/src/i18n/*.json desktop/src/components/settings/SettingsPanel.jsx desktop/src/components/command-palette/CommandPalette.jsx
git commit -m "fix(i18n): restore Korean settings and context copy"
```

---

### Task 3: Restore the Korean music, cover, lyrics, and speech copy

**Files:**
- Modify: `desktop/src/i18n/ko.json:344-400`
- Test: `desktop/src/i18n/i18n.test.js`

**Interfaces:**
- Consumes: every `music.*` key in `en.json`.
- Produces: Korean values for all 112 missing music/speech keys and corrected existing model-tier semantics.

- [ ] **Step 1: Fill every missing `music.*` leaf in English key order**

Use these terminology rules as exact mappings throughout the full branch:

| English term | Korean value |
|---|---|
| Generate / Compose | 생성 / 음악 만들기 |
| Cover | 커버 |
| Lyrics | 가사 |
| Keep original lyrics | 원본 가사 유지 |
| Rewrite the lyrics | 가사 다시 쓰기 |
| Extract lyrics | 가사 추출 |
| Reference Audio | 참조 오디오 |
| Cover feature ID | 커버 기능 ID |
| Synthesize / Clone / Design / Voices | 합성 / 복제 / 디자인 / 보이스 |
| Delivery / Standard (sync) / Async | 처리 방식 / 표준(동기) / 비동기 |
| Sample audio / Prompt audio | 샘플 오디오 / 프롬프트 오디오 |
| Voice ID | Voice ID |
| Noise reduction / Volume normalization | 노이즈 감소 / 음량 정규화 |
| Voice library / System voices / Cloned voices / Designed voices | 보이스 라이브러리 / 시스템 보이스 / 복제한 보이스 / 디자인한 보이스 |
| Theme / Brief | 테마 / 개요 |
| Existing Lyrics / Generated Lyrics | 기존 가사 / 생성된 가사 |
| Sample rate / Channels / Bitrate / Size | 샘플레이트 / 채널 / 비트레이트 / 크기 |

Use the following exact checked JSON for all 112 missing leaves. The key set and every single-brace placeholder have already been structurally compared with the missing English `music.*` branch. Merge it in English key order:

```json
{
  "modeGenerate": "생성",
  "modeCover": "커버",
  "coverModeLabel": "커버 모드",
  "coverModeQuick": "원래 가사 유지",
  "coverModeCustom": "가사 다시 쓰기",
  "coverModeHintQuick": "오디오에서 자동 인식된 원래 가사를 그대로 유지합니다.",
  "coverModeHintCustom": "가사를 추출하여 생성 전에 수정할 수 있습니다.",
  "coverExtractCta": "1단계 — 오디오에서 가사 추출",
  "coverReExtract": "다시 추출",
  "coverLyricsLocked": "가사를 수정하려면 먼저 추출하세요.",
  "coverLyricsPlaceholderQuick": "선택 사항. 비워두면 참조 오디오에서 자동 추출합니다.",
  "coverModelLabel": "커버 모델",
  "coverModelCover": "Music Cover (Token Plan)",
  "coverModelCoverFree": "Music Cover Free",
  "coverReferenceAudio": "참조 오디오",
  "coverReferenceAudioHint": "업로드하거나 URL을 붙여넣으세요 — mp3, wav, flac, m4a (6초–6분, 최대 50 MB).",
  "coverUploadCta": "클릭하여 업로드하거나 드래그 앤 드롭",
  "coverOrPasteUrl": "…또는 외부 URL 붙여넣기",
  "coverUrlPlaceholder": "https://example.com/song.mp3",
  "coverPreprocess": "가사 추출",
  "coverPreprocessLoading": "가사 추출 중…",
  "coverPreprocessSuccess": "가사 추출 완료 — 생성 전에 검토하고 수정하세요.",
  "coverPromptHint": "커버 스타일을 설명하는 10–300자.",
  "coverLyricsHintQuick": "선택 사항. 비워두면 ASR로 참조 오디오에서 가사를 자동 추출합니다.",
  "coverLyricsHintCustom": "10–1000자. 전처리 기능 사용 시 필수입니다.",
  "coverLyricsRequired": "먼저 \"가사 추출\"을 클릭하거나 직접 붙여넣으세요 (10–1000자).",
  "coverGenerate": "커버 생성",
  "coverGenerating": "커버 생성 중…",
  "coverFeatureIdLabel": "커버 기능 ID",
  "coverFeatureCached": "캐시됨 — 새로고침하려면 다시 추출",
  "coverFeatureExpired": "이 기능 ID가 만료되었습니다 — 가사를 다시 추출하세요.",
  "coverPreprocessFailed": "전처리 실패. 오디오 파일을 확인하고 다시 시도하세요.",
  "coverUploadFailed": "업로드 실패. 더 작은 파일을 사용하거나 형식을 확인하세요.",
  "coverUrlInvalid": "올바른 http(s) URL을 입력하거나 파일을 업로드하세요.",
  "coverSuccess": "커버 생성 완료",
  "modeLyrics": "가사",
  "lyricsModeLabel": "가사 모드",
  "lyricsModeWrite": "전체 곡 작성",
  "modeSynthesize": "합성",
  "modeClone": "복제",
  "modeDesign": "디자인",
  "modeVoices": "보이스",
  "delivery": "처리 방식",
  "deliveryStandard": "표준(동기)",
  "deliveryAsync": "비동기 · 긴 텍스트",
  "speechModelLabel": "모델",
  "speechEmotionLabel": "감정",
  "speechVoiceSettings": "보이스 설정",
  "speechVoiceEffects": "보이스 효과(후처리)",
  "speechLanguageBoost": "언어 부스트",
  "speechCloneSampleAudio": "샘플 오디오",
  "speechCloneSampleHint": "mp3, m4a 또는 wav — 10초~5분, 최대 20 MB.",
  "speechCloneSamplePlaceholder": "클립을 드롭하거나 클릭하여 업로드",
  "speechCloneVoiceId": "Voice ID",
  "speechCloneVoiceIdHint": "8–256자, 문자로 시작, [A-Za-z0-9_-], 끝에 -/_ 불가.",
  "speechClonePrompt": "정확도 프롬프트(선택)",
  "speechClonePromptHint": "유사도 향상 — 8초 미만 클립과 전사가 필요합니다.",
  "speechClonePromptAudio": "프롬프트 오디오(8초 이하 클립)",
  "speechClonePromptText": "프롬프트 전사",
  "speechCloneNoiseReduction": "노이즈 감소",
  "speechCloneVolumeNorm": "볼륨 정규화",
  "speechClonePreview": "미리듣기 합성",
  "speechCloneSevenDayNote": "복제한 보이스는 7일 동안 사용하지 않으면 삭제됩니다.",
  "speechDesignPrompt": "보이스 설명",
  "speechDesignPromptPlaceholder": "따뜻하고 차분한 영국 억양의 중년 남성 내레이터.",
  "speechDesignPreviewText": "미리듣기 텍스트",
  "speechDesignPreviewTextPlaceholder": "옛날 옛적에…",
  "speechDesignVoiceId": "커스텀 Voice ID(선택)",
  "speechVoicesLibrary": "보이스 라이브러리",
  "speechSystemVoices": "시스템 보이스",
  "speechClonedVoices": "복제된 보이스",
  "speechDesignedVoices": "디자인된 보이스",
  "speechVoiceEmpty": "아직 불러온 보이스가 없습니다.",
  "speechDeleteVoice": "보이스 삭제",
  "speechConfirmDeleteVoice": "이 보이스를 삭제할까요? 삭제 후에는 되돌릴 수 없습니다.",
  "speechUploadFailed": "샘플 업로드 실패. 형식과 크기를 확인하세요.",
  "speechCloneFailed": "보이스 복제 실패.",
  "speechDesignFailed": "보이스 디자인 실패.",
  "speechTaskPending": "생성 중 — 잠시 후 다시 조회하세요…",
  "speechTaskSuccess": "완료 — 오디오가 준비되었습니다.",
  "speechTaskFailed": "생성 실패.",
  "speechTaskExpired": "작업이 만료되었습니다 — 다시 시도하세요.",
  "lyricsModeEdit": "기존 가사 수정",
  "lyricsThemePrompt": "주제 / 간략 설명",
  "lyricsThemePlaceholder": "비 오는 밤에 관한 소울풀한 블루스 곡",
  "lyricsExisting": "기존 가사",
  "lyricsExistingPlaceholder": "다듬을 가사를 붙여넣으세요…",
  "lyricsTitle": "곡 제목(선택)",
  "lyricsTitlePlaceholder": "비워두면 자동 생성",
  "lyricsGenerate": "가사 생성",
  "lyricsGenerating": "가사 생성 중…",
  "lyricsResult": "생성된 가사",
  "lyricsCopy": "복사",
  "lyricsCopied": "복사됨!",
  "lyricsUseInCompose": "Compose에서 사용",
  "lyricsWriteWithAi": "AI로 작성",
  "lyricsFailed": "가사 생성 실패",
  "lyricsPromptRequired": "주제는 필수입니다.",
  "lyricsPromptTooLong": "테마가 2,000자 제한을 초과했습니다.",
  "lyricsEditNeedsSource": "수정 모드에서는 기존 가사가 필요합니다.",
  "lyricsEditTooLong": "기존 가사가 3,500자 제한을 초과했습니다.",
  "modelHint": "Music 2.6은 유료 Token Plan 모델입니다. 무료 모델은 RPM이 더 낮지만 모든 API 키 사용자가 이용할 수 있습니다.",
  "filename": "파일명(선택)",
  "filenamePlaceholder": "비워두면 타임스탬프 자동 적용",
  "lyricsRequired": "가사가 필요합니다(또는 가사 자동 생성을 켜세요).",
  "instrumentalNeedsPrompt": "연주곡 모드에는 스타일 프롬프트가 필요합니다.",
  "promptTooLong": "프롬프트가 2,000자 제한을 초과했습니다.",
  "metadata": {
    "duration": "재생 시간",
    "sampleRate": "샘플레이트",
    "channels": "채널",
    "bitrate": "비트레이트",
    "size": "크기"
  }
}
```

Then apply these exact corrected existing values:

```json
"instrumentalActiveHint": "이 곡은 보컬과 가사 없이 연주곡으로 생성됩니다.",
"bestQuality": "최고 품질(Token Plan)",
"unlimitedDefault": "무료 티어(낮은 RPM)",
"modelHint": "Music 2.6은 유료 Token Plan 모델입니다. 무료 모델은 RPM이 더 낮지만 모든 API 키 사용자가 이용할 수 있습니다.",
"lyricsRequired": "가사가 필요합니다(또는 가사 자동 생성을 켜세요).",
"instrumentalNeedsPrompt": "연주곡 모드에는 스타일 프롬프트가 필요합니다.",
"promptTooLong": "프롬프트가 2,000자 제한을 초과했습니다.",
"coverFeatureExpired": "이 기능 ID가 만료되었습니다. 가사를 다시 추출하세요.",
"speechCloneSevenDayNote": "복제한 보이스는 7일 동안 사용하지 않으면 삭제됩니다.",
"speechConfirmDeleteVoice": "이 보이스를 삭제할까요? 삭제 후에는 되돌릴 수 없습니다.",
"lyricsPromptTooLong": "테마가 2,000자 제한을 초과했습니다.",
"lyricsEditTooLong": "기존 가사가 3,500자 제한을 초과했습니다.",
"banner": "MiniMax Music-2.6 — 텍스트로 음악·연주곡·커버·가사를 생성합니다"
```

- [ ] **Step 2: Run the locale contract and verify GREEN**

```bash
cd desktop && npm test -- src/i18n/i18n.test.js
```

Expected: all i18n tests pass; `en` and `ko` have identical paths, node types, non-empty leaves, and placeholders.

- [ ] **Step 3: Run the Phase A production build gate**

```bash
cd desktop && npm run build
```

Expected: Vite production build exits 0. This specifically catches malformed JSON before component refactoring begins.

- [ ] **Step 4: Commit Phase A**

```bash
git add desktop/src/i18n/ko.json
git commit -m "fix(i18n): complete Korean music and speech translations"
```

---

### Task 4: Localize the always-visible shell and shared controls

**Files:**
- Create: `desktop/src/components/shell/ShellLocalization.test.jsx`
- Modify: `desktop/src/components/Sidebar.jsx`
- Modify: `desktop/src/components/QuotaDashboard.jsx`
- Modify: `desktop/src/components/shell/BackendLoader.jsx`
- Modify: `desktop/src/components/shell/Titlebar.jsx`
- Modify: `desktop/src/components/shared/StatusBar.jsx`
- Modify: `desktop/src/components/shared/StatusBar.test.jsx`
- Modify: `desktop/src/components/shared/ThinkingBlock.jsx`
- Modify: `desktop/src/components/shared/CopyButton.jsx`
- Modify: `desktop/src/components/shared/SlashMenu.jsx`
- Modify: `desktop/src/components/MarkdownRenderer.jsx`
- Modify: all six `desktop/src/i18n/*.json`

**Interfaces:**
- Produces namespaces: `backend.*`, `titlebar.*`, `statusBar.*`, and reusable `common.copy*`/`common.retry` actions.
- Module-scope contract: `Titlebar.STATUS` stores `labelKey`; `StatusBar` model IDs stay literal while descriptions use keys.

- [ ] **Step 1: Write failing observable render tests**

Cover these exact shell contracts:

```jsx
render(<BackendLoader status="connecting" attempt={1} onRetry={vi.fn()} />)
expect(screen.getByText('backend.startingUp')).toBeInTheDocument()
expect(screen.getByText('backend.connecting')).toBeInTheDocument()

render(<BackendLoader status="error" error="boom" attempt={2} onRetry={vi.fn()} />)
expect(screen.getByRole('button', { name: 'backend.retry' })).toBeInTheDocument()

render(<Titlebar onOpenPalette={vi.fn()} />)
expect(screen.getByLabelText('titlebar.minimize')).toBeInTheDocument()
expect(screen.getByLabelText('titlebar.maximize')).toBeInTheDocument()
expect(screen.getByLabelText('titlebar.close')).toBeInTheDocument()
```

Update `StatusBar.test.jsx` assertions from hardcoded English to keys returned by the global i18n mock, including `statusBar.contextAndPlan`, `statusBar.contextWindow`, `statusBar.planUsage`, and the six `statusBar.breakdown.*` labels.

- [ ] **Step 2: Run shell/status tests and verify RED**

```bash
cd desktop && npm test -- src/components/shell/ShellLocalization.test.jsx src/components/shared/StatusBar.test.jsx
```

Expected: FAIL because the components still render literal English.

- [ ] **Step 3: Implement with render-time key resolution**

Use this module-scope pattern in `Titlebar.jsx`:

```jsx
const STATUS = {
  idle: { labelKey: 'titlebar.status.idle', dot: 'bg-muted-foreground' },
  running: { labelKey: 'titlebar.status.running', dot: 'bg-success' },
  error: { labelKey: 'titlebar.status.error', dot: 'bg-error' },
}
// inside component
const { t } = useTranslation()
const statusMeta = STATUS[status] || STATUS.idle
// render
{t(statusMeta.labelKey)}
```

`Sidebar` must use existing `t('nav.tts')`. `QuotaDashboard` translates display descriptions, availability/limit/reset/loading/empty/refresh labels while preserving plan/model names and interval IDs. `BackendLoader`, `ThinkingBlock`, `CopyButton`, `SlashMenu`, and `MarkdownRenderer` add `useTranslation()` and resolve their visible/title/aria copy. Preserve model identifiers and token numbers as data.

Add these exact Korean shell values:

```json
"backend": {
  "startingUp": "시작하는 중…",
  "failedToStart": "백엔드를 시작하지 못했습니다",
  "connecting": "로컬 엔진에 연결 중",
  "attempt": "{attempt}번째 시도",
  "retry": "다시 시도"
},
"titlebar": {
  "search": "검색 또는 명령 실행",
  "minimize": "최소화",
  "maximize": "최대화",
  "close": "닫기",
  "status": { "idle": "에이전트 대기 중", "running": "에이전트 실행 중", "error": "에이전트 오류" }
}
```

Add current English values as explicit fallback for the same new paths in pt-BR/ja/es/zh-CN; do not translate unrelated keys.

- [ ] **Step 4: Verify GREEN**

```bash
cd desktop && npm test -- src/components/shell/ShellLocalization.test.jsx src/components/shared/StatusBar.test.jsx src/i18n/i18n.test.js
```

- [ ] **Step 5: Commit**

```bash
git add desktop/src/components/shell desktop/src/components/Sidebar.jsx desktop/src/components/QuotaDashboard.jsx desktop/src/components/shared desktop/src/components/MarkdownRenderer.jsx desktop/src/i18n/*.json
git commit -m "fix(i18n): localize desktop shell controls"
```

---

### Task 5: Localize chat and command-palette flows

**Files:**
- Create: `desktop/src/components/chat/ChatLocalization.test.jsx`
- Create: `desktop/src/components/command-palette/CommandPalette.test.jsx`
- Modify: `desktop/src/components/chat/ChatPanel.jsx`
- Modify: `desktop/src/components/chat/Composer.tsx`
- Modify: `desktop/src/components/chat/Composer.test.tsx`
- Modify: `desktop/src/components/context-refs/ContextRefAutocomplete.jsx`
- Modify: `desktop/src/components/context-refs/ContextRefChips.jsx`
- Modify: `desktop/src/components/context-refs/parseRefs.test.jsx`
- Modify: `desktop/src/components/command-palette/CommandPalette.jsx`
- Modify: all six locale JSON files

**Interfaces:**
- Module-scope arrays `NAV_ITEMS`, `ACTION_ITEMS`, and `SETTINGS_ITEMS` expose `labelKey`, never translated text.
- Shared permission keys live under `permissions.*`; chat counters live under `chat.*`.

- [ ] **Step 1: Add failing tests for visible contracts**

Assert the key-resolved conversation actions, message counts, empty history, Composer aria labels, busy placeholder, keyboard hint, context-limit alert prefix, context-reference type/group/state labels, command item labels, no-results message, and parameterized result count.

Update the existing Composer refusal assertion:

```js
expect(mockAlert.mock.calls[0][0]).toContain('chat.contextTooLarge')
```

- [ ] **Step 2: Verify RED**

```bash
cd desktop && npm test -- src/components/chat/ChatLocalization.test.jsx src/components/chat/Composer.test.tsx src/components/context-refs/parseRefs.test.jsx src/components/command-palette/CommandPalette.test.jsx
```

- [ ] **Step 3: Convert module-scope palette arrays**

```js
const NAV_ITEMS = [
  { id: 'chat', labelKey: 'nav.chat', icon: MessageSquare, keywords: 'chat conversation messages agent' },
  { id: 'tts', labelKey: 'nav.tts', icon: Volume2, keywords: 'tts voice audio speech' },
  { id: 'image', labelKey: 'nav.image', icon: Image, keywords: 'image picture photo generate' },
  { id: 'music', labelKey: 'nav.music', icon: Music, keywords: 'music audio song generate' },
  { id: 'video', labelKey: 'nav.video', icon: Video, keywords: 'video movie generate' },
  { id: 'code', labelKey: 'nav.code', icon: Code2, keywords: 'code coding workspace editor' },
  { id: 'tasks', labelKey: 'nav.tasks', icon: Layout, keywords: 'tasks board kanban' },
]
```

Resolve `label: t(item.labelKey)` inside `allItems`. Keep English search keywords as hidden matching metadata; they are not user-visible.

- [ ] **Step 4: Convert chat and context-reference copy**

Use existing `chat.newChat`, `chat.placeholder`, and common action keys where meanings match. Add Korean keys for conversation rename/delete, no previous conversations, `{count}개 메시지`, waiting for expert, composer keyboard hint, permission fields/actions, and context compaction messages. In `ContextRefAutocomplete`, store `labelKey`/`descKey` on module-scope `REF_TYPES` and translate folder/file groups, empty state, and keyboard footer at render. In `ContextRefChips`, translate only frontend-owned expanding/error/pending/byte labels; preserve `report.soft_warning` and `result.error` backend payloads verbatim. Do not translate WebSocket error payload content; translate only the frontend-owned prefix/status around it.

- [ ] **Step 5: Verify and commit**

```bash
cd desktop && npm test -- src/components/chat src/components/context-refs src/components/command-palette src/i18n/i18n.test.js
git add desktop/src/components/chat desktop/src/components/context-refs desktop/src/components/command-palette desktop/src/i18n/*.json
git commit -m "fix(i18n): localize chat context references and command palette"
```

---

### Task 6: Localize the coding workspace

**Files:**
- Modify: `desktop/src/components/coding/CodingPanel.jsx`
- Modify: `desktop/src/components/coding/WorkspaceSidebar.jsx`
- Modify: `desktop/src/components/coding/WorkspaceSidebar.test.jsx`
- Modify: `desktop/src/components/coding/AgentChatPanel.jsx`
- Modify: `desktop/src/components/coding/XTermTerminal.jsx`
- Modify: `desktop/src/components/taskboard/LiveTodoProgress.jsx`
- Modify: `desktop/src/components/taskboard/LiveTodoProgress.test.jsx`
- Create: `desktop/src/components/coding/CodingLocalization.test.jsx`
- Modify: all six locale JSON files

**Interfaces:**
- `WorkspaceSidebar.TABS` uses `labelKey`; `CodingPanel.MODES` is component-local and can call `t()` directly.
- Default plan-item strings remain stable internal values; display labels and generated user-visible plan copy use `coding.planItems.*`.

- [ ] **Step 1: Write failing render tests**

Cover sidebar tabs, empty plan guidance, approve/copy/clear actions, coding empty state, conversation actions, terminal disconnected actions, permission dialog, and `LiveTodoProgress` empty state.

- [ ] **Step 2: Verify RED**

```bash
cd desktop && npm test -- src/components/coding/WorkspaceSidebar.test.jsx src/components/coding/CodingLocalization.test.jsx src/components/taskboard/LiveTodoProgress.test.jsx
```

- [ ] **Step 3: Apply the module-scope pattern and translate frontend-owned copy**

`WorkspaceSidebar.TABS` becomes:

```js
const TABS = [
  { id: 'plan', labelKey: 'workspaceSidebar.tabs.plan', icon: Search },
  { id: 'todos', labelKey: 'workspaceSidebar.tabs.todos', icon: CheckSquare },
  { id: 'tasks', labelKey: 'workspaceSidebar.tabs.tasks', icon: ListTodo },
  { id: 'agents', labelKey: 'workspaceSidebar.tabs.agents', icon: Bot },
]
```

Call `const { t } = useTranslation()` in every component that currently imports but does not invoke it (`WorkspaceSidebar`, `AgentChatPanel`). Add it to `XTermTerminal`.

Translate visible strings under `coding.*`, `workspaceSidebar.*`, `terminal.*`, and shared `permissions.*`. Keep code contents, filenames, terminal output, Git branch names, tool names, and backend error details unchanged.

- [ ] **Step 4: Verify GREEN and commit**

```bash
cd desktop && npm test -- src/components/coding src/components/taskboard/LiveTodoProgress.test.jsx src/components/chat/Composer.test.tsx src/i18n/i18n.test.js
git add desktop/src/components/coding desktop/src/components/taskboard/LiveTodoProgress* desktop/src/i18n/*.json
git commit -m "fix(i18n): localize coding workspace"
```

---

### Task 7: Localize image and music panels

**Files:**
- Create: `desktop/src/components/media/ImageMusicLocalization.test.jsx`
- Modify: `desktop/src/components/media/ImagePanel.jsx`
- Modify: `desktop/src/components/media/MusicPanel.jsx`
- Modify: `desktop/src/components/media/RecentGenerations.jsx`
- Modify: all six locale JSON files

**Interfaces:**
- `ASPECT_RATIOS`, `IMAGE_MODES`, `MUSIC_MODES`, and display-only music model descriptions use keys.
- API values (`1:1`, `image-01`, `music-2.6`, structure tags) remain unchanged.

- [ ] **Step 1: Write failing panel tests**

Render each panel with API calls mocked. Assert translated mode labels, drop-zone text, validation messages, aria labels, placeholders, recent-generation controls, and cover/lyrics tabs through key output.

- [ ] **Step 2: Verify RED**

```bash
cd desktop && npm test -- src/components/media/ImageMusicLocalization.test.jsx
```

- [ ] **Step 3: Convert module-scope arrays safely**

```js
const ASPECT_RATIOS = [
  { labelKey: 'image.aspectRatios.square', value: '1:1', shapeW: 22, shapeH: 22, res: '1024 × 1024' },
  // remaining ratios
]
const IMAGE_MODES = [
  { id: 'text', labelKey: 'image.textToImage', titleKey: 'image.textToImage', model: 'image-01' },
  { id: 'subject', labelKey: 'image.imageToImage', titleKey: 'image.imageToImage', model: 'image-01-live' },
]
const MUSIC_MODES = [
  { id: 'generate', labelKey: 'music.modeGenerate', icon: Music },
  { id: 'cover', labelKey: 'music.modeCover', icon: Disc3 },
  { id: 'lyrics', labelKey: 'music.modeLyrics', icon: NotebookPen },
]
```

Resolve each key in JSX. Do not translate `STRUCTURE_TAGS`, model IDs, formats, paths, or numeric resolution labels.

- [ ] **Step 4: Verify and commit**

```bash
cd desktop && npm test -- src/components/media/ImageMusicLocalization.test.jsx src/i18n/i18n.test.js
git add desktop/src/components/media desktop/src/i18n/*.json
git commit -m "fix(i18n): localize image and music panels"
```

---

### Task 8: Localize speech and video panels

**Files:**
- Create: `desktop/src/components/media/SpeechVideoLocalization.test.jsx`
- Modify: `desktop/src/components/media/SpeechPanel.jsx`
- Modify: `desktop/src/components/media/VideoPanel.jsx`
- Modify: all six locale JSON files

**Interfaces:**
- Display arrays use `labelKey`; request bodies continue to use their unchanged `value` fields.
- `CAMERA_COMMANDS`, resolutions, durations, model IDs, and uploaded filenames stay literal.

- [ ] **Step 1: Write failing tests for validation and visible controls**

Cover synthesize/clone/design/voices modes, text-required and length validation, sample/Voice-ID validation, delete confirmation copy, voice search/actions, video modes, frame drop zones, camera search labels, video failure copy, and prompt placeholders.

- [ ] **Step 2: Verify RED**

```bash
cd desktop && npm test -- src/components/media/SpeechVideoLocalization.test.jsx
```

- [ ] **Step 3: Convert display-only arrays**

Apply `labelKey` to `SPEECH_MODES`, `EMOTIONS`, `SOUND_EFFECT_CHIPS`, `DESIGN_TRAITS`, `DELIVERY_OPTIONS`, `LANGUAGE_BOOST_OPTIONS`, and `VIDEO_MODES`. Preserve each item's API `value` unchanged. Model labels remain identifiers; only descriptive text becomes translated.

- [ ] **Step 4: Replace hardcoded validation and accessibility copy**

Use the completed `music.speech*` keys when semantically identical. Add dedicated keys only for missing contracts such as text-required/text-too-long, clone sample required, Voice ID shape, design preview limits, voice search/reload/use/delete, camera command search/no-match, and frame upload instructions.

- [ ] **Step 5: Verify and commit**

```bash
cd desktop && npm test -- src/components/media/SpeechVideoLocalization.test.jsx src/i18n/i18n.test.js
git add desktop/src/components/media/SpeechPanel.jsx desktop/src/components/media/VideoPanel.jsx desktop/src/components/media/SpeechVideoLocalization.test.jsx desktop/src/i18n/*.json
git commit -m "fix(i18n): localize speech and video panels"
```

---

### Task 9: Localize settings, skills, task board, and agent context

**Files:**
- Modify: `desktop/src/components/settings/QuickSettings.jsx`
- Modify: `desktop/src/components/settings/SettingsPanel.jsx`
- Modify: `desktop/src/components/settings/SettingsPanel.test.jsx`
- Modify: `desktop/src/components/settings/SkillsTab.jsx`
- Create: `desktop/src/components/settings/SkillsTab.test.jsx`
- Modify: `desktop/src/components/taskboard/TaskBoard.jsx`
- Modify: `desktop/src/components/agent-context/IncompleteContextBanner.jsx`
- Modify: `desktop/src/components/agent-context/IncompleteContextBanner.test.jsx`
- Modify: `desktop/src/components/agent-context/OnboardingWizard.jsx`
- Modify: `desktop/src/components/agent-context/OnboardingWizard.test.jsx`
- Modify: `desktop/src/components/agent-context/ContextModal.jsx`
- Modify: `desktop/src/components/agent-context/DocViewer.jsx`
- Create: `desktop/src/components/help/HelpPanel.test.jsx`
- Modify: `desktop/src/components/help/HelpPanel.jsx`
- Modify: all six locale JSON files

**Interfaces:**
- `IncompleteContextBanner` resolves `agentContext.file.${firstMissing}`.
- `SOURCE_BADGES` stores `labelKey`; source identifiers and precedence are unchanged.
- Language self-names, domains, model IDs, paths, and license examples are not translated.

- [ ] **Step 1: Write failing tests**

Add observable assertions for Skills rescan/add/search/read-only/import/delete-confirm copy, settings section aria label, System theme mode, Quick Settings toggle hint, Agent Context missing-file label, timezone helper/placeholder, wizard close/creation failure, modal/viewer loading states, and the Help empty-content fallback.

Explicitly update the banner test to prove the corrected namespace:

```js
expect(screen.getByText(/agentContext\.file\.soul/)).toBeInTheDocument()
```

- [ ] **Step 2: Verify RED**

```bash
cd desktop && npm test -- src/components/settings src/components/agent-context src/components/taskboard src/components/help
```

- [ ] **Step 3: Implement localized copy**

Use `labelKey` in module-scope `SOURCE_BADGES`. Keep source IDs (`builtin`, `user`, `claude`, `codex`, `gemini`) unchanged. Translate user-visible source labels, help text, confirmations, toasts, placeholders, accessibility labels, Quick Settings' toggle hint, Agent Context loading states, and Help's no-content fallback.

Fix the namespace source defect:

```jsx
const fileLabel = t(`agentContext.file.${firstMissing}`)
```

Do not use `|| firstMissing`; i18next returns the key when missing, so the Phase A parity test is the invariant that guarantees the value exists.

- [ ] **Step 4: Verify and commit**

```bash
cd desktop && npm test -- src/components/settings src/components/agent-context src/components/taskboard src/components/help src/i18n/i18n.test.js
git add desktop/src/components/settings desktop/src/components/taskboard desktop/src/components/agent-context desktop/src/components/help desktop/src/i18n/*.json
git commit -m "fix(i18n): localize settings tasks context and help"
```

---

### Task 10: Run the end-to-end Korean UI verification

**Files:**
- Modify only if verification exposes a real active-path gap; add that gap to the nearest existing task test before fixing it.

**Interfaces:**
- Consumes: all Phase A and B changes.
- Produces: verified desktop behavior, not a new API.

- [ ] **Step 1: Run the complete frontend suite**

```bash
cd desktop && npm test
```

Expected: zero failed tests.

- [ ] **Step 2: Run the production build**

```bash
cd desktop && npm run build
```

Expected: Vite build exits 0 with no JSON parse, import-time `t` reference, or bundle errors.

- [ ] **Step 3: Start the real Vite app**

Run `npm run dev` from `desktop` using the harness process manager, open `http://127.0.0.1:1420`, set the interface language to 한국어, and retain the same browser tab for the complete walkthrough.

- [ ] **Step 4: Walk every active surface**

Check, in order:

1. Backend loader error/loading states and retry.
2. Titlebar, sidebar, status bar popovers, model/thinking controls.
3. Chat conversation menu, composer attachment/send states, thinking/copy controls, permission modal.
4. Command palette navigation/actions/settings/no-results/result count.
5. Coding modes, session list, plan/todo/task/agent sidebar, editor preview, Git, terminal, permission modal.
6. Image text/image modes, ratios, validation, history controls.
7. Music compose/cover/lyrics modes, every validation state and metadata label.
8. Speech synthesize/clone/design/voices modes and delete confirmation.
9. Video text/image/frames/subject modes, command picker, validation, history.
10. Settings audio/update/MCP/Skills and the System theme option.
11. Agent Context banner, setup wizard, file cards, memory/daily viewers.
12. Task board empty/loading/error/modal/action states.

For each screen, verify no raw keys, literal `{placeholder}`, unintended English sentence, clipped Korean label, or import-time blank panel. English is acceptable only for the proper nouns/identifiers listed in Global Constraints or backend/Rust payload detail explicitly excluded from scope.

- [ ] **Step 5: Re-run focused regression after any discovered fix**

Write a failing observable test for each newly found frontend-owned gap, apply the smallest fix, then rerun that test, `npm test`, and `npm run build`.

- [ ] **Step 6: Commit final verified corrections**

```bash
git add path/to/regression-test path/to/verified-fix
git commit -m "fix(i18n): close Korean UI verification gaps"
```

Skip this commit when the walkthrough finds no additional gaps.
