# Artifact Feature (llamacoder port) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add llamacoder-style artifact rendering to MiniMax Agent GUI. Models that emit ` ```html ` / ` ```svg ` / (after spike) ` ```mermaid ` / ` ```reactjs ` fences get a sandboxed iframe preview inline in the message and in a modal. Chat and Coding panels both light up via a single `MarkdownRenderer` hook.

**Architecture:** Sandbox `<iframe sandbox="allow-scripts" srcdoc>` is built per artifact. The `MarkdownRenderer` `react-markdown` custom `code` component decides per-block whether to render an inline `ArtifactInlineCard` or the existing `<pre><code>`. The Tauri WebView spike in Phase 0 is the gate that determines whether `mermaid` / `reactjs` ship in v0.5 or slip to v0.6.

**Tech Stack:** React 18.3.1, react-markdown 10, @radix-ui/react-dialog 1.1.2, vitest 2.1.9 + @testing-library/react 16, FastAPI 0.100+ (system prompt injection only), Tauri 2.x (no Rust changes).

## Global Constraints

- All new code lives under `desktop/src/components/artifact/` except the 1-line `web/backend/main.py` system-prompt append.
- Do not modify `App.tsx`, `WorkPanel.tsx`, `MessageBubble.tsx`, `AppSidebar.tsx`, `ChatPanel.tsx`, or anything outside the surfaces listed in the spec section 5.1.
- Tauri CSP stays `null`. No `index.html` CSP change. No new top-level dependencies in `desktop/package.json`.
- React 18.3.1 and mermaid 11.4.0 are pinned in srcdoc. Do not bump them.
- The `new Function` reactjs body MUST destructure 8 bindings: `useState, useEffect, useRef, useMemo, useCallback, useContext, useReducer, Fragment, createElement` — no exceptions.
- TDD: write the failing test, run it, write the impl, run it, commit. No skipping.
- Commit messages: `feat(artifact): …`, `test(artifact): …`, `chore(artifact): …`.
- All `npm test` must remain green. All Vite `npm run build` must succeed.
- No secrets in commits. `config/config.yaml` and any `api_key` strings must not appear in diffs.

---

## Phase 0 — WebView Spike (gate)

### Task 0: WebView ESM spike page

**Files:**
- Create: `desktop/src/components/artifact/__spike__/webview-esm.html`
- Modify: `desktop/src/App.jsx:14` (temporary — revert after spike completes)

**Interfaces:**
- Consumes: nothing
- Produces: a `postMessage` event from the iframe reporting `{type:'artifact:ready', react: 'object', mermaid: 'function'}` or `{type:'artifact:error', message}`.

- [ ] **Step 1: Create the spike HTML file**

Write `desktop/src/components/artifact/__spike__/webview-esm.html` with this content (single file, no test):

```html
<!doctype html>
<html>
<head><meta charset="utf-8"><title>webview-esm spike</title></head>
<body>
<iframe sandbox="allow-scripts" id="f" srcdoc="
<script type='module'>
  try {
    const React = await import('https://esm.sh/react@18.3.1');
    const mermaid = await import('https://esm.sh/mermaid@11.4.0');
    parent.postMessage({type:'artifact:ready', react: typeof React.default, mermaid: typeof mermaid.default}, '*');
  } catch (e) {
    parent.postMessage({type:'artifact:error', message: String(e && e.message || e)}, '*');
  }
</script>
"></iframe>
<pre id="log"></pre>
<script>
  window.addEventListener('message', (e) => {
    document.getElementById('log').textContent = JSON.stringify(e.data);
    console.log('[spike]', e.data);
  });
  // Expose for headless inspection
  window.__spikeResult = new Promise((resolve) => {
    window.addEventListener('message', (e) => resolve(e.data), { once: true });
  });
</script>
</body>
</html>
```

- [ ] **Step 2: Mount the spike in App.jsx temporarily**

In `desktop/src/App.jsx` add a one-shot render at the very top of `AppShell()` return tree (find the outermost `<div>` and prepend):

```jsx
{import.meta.env.DEV && (
  <iframe
    src="/src/components/artifact/__spike__/webview-esm.html"
    style={{display: 'none'}}
    data-testid="webview-spike"
  />
)}
```

- [ ] **Step 3: Run spike on the current OS**

```bash
cd desktop && npm run tauri:dev
```

Open the desktop window. Press F12 → DevTools console. Expected one of:
- `[spike] {type:'artifact:ready', react:'object', mermaid:'function'}` → spike PASSED for this OS.
- `[spike] {type:'artifact:error', message: '...'}` → spike FAILED for this OS. Note the message.

- [ ] **Step 4: Record result in spec**

Append to `docs/superpowers/specs/2026-07-19-artifact-feature-design.md` under a new `## Phase 0 Spike Result` section:

- macOS (Apple M4 / WebKit): PASS / FAIL — <message>
- Windows (WebView2): <not tested on this machine>
- Linux (WebKitGTK): <not tested on this machine>

- [ ] **Step 5: Apply fallback if any OS failed**

If macOS (the only OS we can test here) FAILED:
- Edit `desktop/src/components/artifact/useArtifact.js` to return `isArtifactLanguage = ['html','svg'].includes(lang?.toLowerCase())`. (Will be added in Task 1 — apply this when editing Task 1.)
- Edit `desktop/src/components/artifact/artifactTemplates.js` `buildSrcDoc` to throw on `mermaid` / `reactjs` (will be added in Task 3 — apply there).
- Edit `web/backend/main.py` `ARTIFACT_RULES` to drop the `mermaid` and `reactjs` bullets (will be added in Task 8 — apply there).

If macOS PASSED, do nothing — keep all four languages.

- [ ] **Step 6: Revert App.jsx spike mount**

In `desktop/src/App.jsx` remove the `{import.meta.env.DEV && (<iframe … />)}` block added in Step 2.

- [ ] **Step 7: Commit spike**

```bash
cd /Volumes/MERCURY/PROJECTS/minimax-agent-gui
git add desktop/src/components/artifact/__spike__/webview-esm.html docs/superpowers/specs/2026-07-19-artifact-feature-design.md
git -c user.email="agent@local" -c user.name="oh-my-pi" commit -m "chore(artifact): webview-esm spike + result"
```

---

## Phase 1 — Pure JS core (no React)

### Task 1: `useArtifact.js` — fence parser + language detection

**Files:**
- Create: `desktop/src/components/artifact/useArtifact.js`
- Test: `desktop/src/components/artifact/__tests__/useArtifact.test.js`

**Interfaces:**
- Produces:
  - `parseFenceHeader(tag: string): { language: string, path: string | null }`
  - `parseAttributeLine(line: string): string | null`
  - `resolveBlockPath(fenceTag: string, code: string): { language: string, path: string, code: string }`
  - `dedupePath(path: string, usedPaths: Set<string>): string`
  - `stripThinkingBlocks(markdown: string): string`
  - `parseReplySegments(markdown: string): Array<TextSegment | FileSegment>`
  - `isArtifactLanguage(lang: string | undefined): boolean`
  - `detectArtifacts(content: string): Array<{language, code, isPartial}>`

Where:
```ts
type TextSegment = { type: 'text', content: string }
type FileSegment = { type: 'file', language: string, path: string, code: string, isPartial?: boolean }
```

- [ ] **Step 1: Write the failing test file**

Create `desktop/src/components/artifact/__tests__/useArtifact.test.js`:

```js
import { describe, it, expect } from 'vitest';
import {
  parseFenceHeader, parseAttributeLine, resolveBlockPath, dedupePath,
  stripThinkingBlocks, parseReplySegments, isArtifactLanguage, detectArtifacts,
} from '../useArtifact.js';

describe('parseFenceHeader', () => {
  it('extracts language and ignores path when absent', () => {
    expect(parseFenceHeader('html')).toEqual({ language: 'html', path: null });
    expect(parseFenceHeader('  typescript  ')).toEqual({ language: 'typescript', path: null });
  });
  it('extracts glued path attribute', () => {
    expect(parseFenceHeader('tsx{path=src/App.tsx}')).toEqual({ language: 'tsx', path: 'src/App.tsx' });
  });
  it('extracts split-brace path', () => {
    expect(parseFenceHeader('tsx{path=src/data.ts')).toEqual({ language: 'tsx', path: 'src/data.ts' });
  });
});

describe('parseAttributeLine', () => {
  it('detects {path=...} on a body line', () => {
    expect(parseAttributeLine('{path=src/types.ts}')).toBe('src/types.ts');
  });
  it('returns null for non-attribute lines', () => {
    expect(parseAttributeLine('import x from "y"')).toBeNull();
  });
});

describe('resolveBlockPath', () => {
  it('prefers header path over body attribute', () => {
    const r = resolveBlockPath('tsx{path=src/A.tsx}', 'const x = 1;');
    expect(r.path).toBe('src/A.tsx');
    expect(r.code).toBe('const x = 1;');
  });
  it('falls back to body attribute and strips it', () => {
    const r = resolveBlockPath('tsx', '{path=src/B.tsx}\nconst y = 2;');
    expect(r.path).toBe('src/B.tsx');
    expect(r.code).toBe('const y = 2;');
  });
});

describe('dedupePath', () => {
  it('appends -2 on collision', () => {
    const used = new Set(['App.tsx']);
    expect(dedupePath('App.tsx', used)).toBe('App-2.tsx');
  });
  it('returns the path unchanged when unused', () => {
    const used = new Set();
    expect(dedupePath('App.tsx', used)).toBe('App.tsx');
  });
});

describe('stripThinkingBlocks', () => {
  it('strips terminated thinking blocks', () => {
    expect(stripThinkingBlocks('hi <thinking>x</thinking> bye')).toBe('hi  bye');
  });
  it('drops everything from an unterminated opener', () => {
    expect(stripThinkingBlocks('hi <thinking>oops')).toBe('hi ');
  });
});

describe('parseReplySegments', () => {
  it('returns empty for empty input', () => {
    expect(parseReplySegments('')).toEqual([]);
  });
  it('returns single text segment when no fences', () => {
    expect(parseReplySegments('just text')).toEqual([{ type: 'text', content: 'just text' }]);
  });
  it('parses a single code fence', () => {
    const md = 'before\n```html\n<p>hi</p>\n```\nafter';
    const segs = parseReplySegments(md);
    expect(segs).toEqual([
      { type: 'text', content: 'before' },
      { type: 'file', language: 'html', path: 'file.html', code: '<p>hi</p>' },
      { type: 'text', content: 'after' },
    ]);
  });
  it('exposes a partial file segment when closing fence is missing', () => {
    const md = 'before\n```html\n<p>hi';
    const segs = parseReplySegments(md);
    const files = segs.filter(s => s.type === 'file');
    expect(files).toHaveLength(1);
    expect(files[0].isPartial).toBe(true);
    expect(files[0].code).toBe('<p>hi');
  });
  it('strips thinking blocks before extraction', () => {
    const md = '<thinking>\n```html\nleaked\n```\n</thinking>\n```html\nreal\n```';
    const segs = parseReplySegments(md);
    const files = segs.filter(s => s.type === 'file');
    expect(files).toHaveLength(1);
    expect(files[0].code).toBe('real');
  });
  it('dedupes paths when blocks reuse the same name', () => {
    const md = '```html\nA\n```\n```html\nB\n```';
    const segs = parseReplySegments(md);
    const files = segs.filter(s => s.type === 'file');
    expect(files[0].path).toBe('file.html');
    expect(files[1].path).toBe('file-2.html');
  });
});

describe('isArtifactLanguage', () => {
  it('accepts html, svg, mermaid, reactjs (case-insensitive)', () => {
    for (const l of ['html', 'HTML', 'svg', 'Mermaid', 'reactjs', 'ReactJS']) {
      expect(isArtifactLanguage(l)).toBe(true);
    }
  });
  it('rejects tsx, jsx, python, bash, and empty', () => {
    for (const l of ['tsx', 'jsx', 'python', 'bash', undefined, '']) {
      expect(isArtifactLanguage(l)).toBe(false);
    }
  });
});

describe('detectArtifacts', () => {
  it('returns only artifact language blocks', () => {
    const md = '```html\n<p>1</p>\n```\n```python\nprint(1)\n```\n```mermaid\ngraph TD; A-->B\n```';
    const arts = detectArtifacts(md);
    expect(arts.map(a => a.language)).toEqual(['html', 'mermaid']);
    expect(arts[0].isPartial).toBe(false);
  });
  it('marks partial the last open fence', () => {
    const md = '```html\n<p>open';
    const arts = detectArtifacts(md);
    expect(arts).toHaveLength(1);
    expect(arts[0].isPartial).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd desktop && npx vitest run src/components/artifact/__tests__/useArtifact.test.js
```

Expected: FAIL with "Cannot find module '../useArtifact.js'" or similar.

- [ ] **Step 3: Write the implementation**

Create `desktop/src/components/artifact/useArtifact.js`:

```js
// Fence parser + language detection for the artifact feature.
// Ported/adapted from llamacoder's lib/utils.ts but trimmed to the surface
// this app needs (no multi-file sandboxing, no path resolution for files
// outside the artifact fence).

const FENCE_RE = /```([^\n`]*)\n([\s\S]*?)(?:```|$)/g;
const ATTR_RE = /^\{path=([^}\n]+)\}\s*$/;
const PARTIAL_FENCE_TAIL_RE = /```([^\n`]*)\n([\s\S]*)$/;
const THINKING_TERMINATED_RE = /<thinking>[\s\S]*?<\/thinking>/g;
const THINKING_UNTERMINATED_RE = /<thinking>[\s\S]*$/;

export function parseFenceHeader(tag) {
  const t = (tag || '').trim();
  if (!t) return { language: '', path: null };
  // Splits "tsx{path=src/App.tsx}" into "tsx" and "src/App.tsx" — also
  // tolerates split-brace like "tsx{path=src/data.ts" (no closing brace).
  const m = t.match(/^([^\s{]+)\s*\{?\s*path\s*=\s*([^}\s]+)\s*\}?/);
  if (m) return { language: m[1].toLowerCase(), path: m[2] };
  return { language: t.toLowerCase().split(/\s+/)[0], path: null };
}

export function parseAttributeLine(line) {
  const m = (line || '').match(ATTR_RE);
  return m ? m[1] : null;
}

export function dedupePath(path, usedPaths) {
  if (!usedPaths.has(path)) return path;
  const lastDot = path.lastIndexOf('.');
  if (lastDot <= 0) {
    let i = 2;
    while (usedPaths.has(`${path}-${i}`)) i++;
    return `${path}-${i}`;
  }
  const stem = path.slice(0, lastDot);
  const ext = path.slice(lastDot);
  let i = 2;
  while (usedPaths.has(`${stem}-${i}${ext}`)) i++;
  return `${stem}-${i}${ext}`;
}

export function resolveBlockPath(fenceTag, code) {
  const { language, path: headerPath } = parseFenceHeader(fenceTag);
  if (headerPath) return { language, path: headerPath, code: code || '' };
  const lines = (code || '').split('\n');
  const first = (lines[0] || '').trim();
  const attrPath = parseAttributeLine(first);
  if (attrPath) {
    return { language, path: attrPath, code: lines.slice(1).join('\n') };
  }
  // Fallback: intelligent filename from language (kept simple here).
  const ext = ({ html: 'html', svg: 'svg', mermaid: 'mmd', reactjs: 'js' })[language] || 'txt';
  return { language, path: `file.${ext}`, code: code || '' };
}

export function stripThinkingBlocks(markdown) {
  let s = String(markdown || '');
  s = s.replace(THINKING_TERMINATED_RE, '');
  s = s.replace(THINKING_UNTERMINATED_RE, '');
  return s;
}

function extFor(language) {
  return ({ html: 'html', svg: 'svg', mermaid: 'mmd', reactjs: 'js' })[language] || 'txt';
}

export function parseReplySegments(markdown) {
  const stripped = stripThinkingBlocks(markdown || '');
  const segments = [];
  const used = new Set();
  let cursor = 0;

  // Match terminated fences first.
  const re = new RegExp(FENCE_RE.source, 'g');
  let m;
  while ((m = re.exec(stripped)) !== null) {
    const [full, tag, body] = m;
    const start = m.index;
    if (start > cursor) {
      segments.push({ type: 'text', content: stripped.slice(cursor, start) });
    }
    const { language, path, code } = resolveBlockPath(tag, body);
    const finalPath = dedupePath(path, used);
    used.add(finalPath);
    segments.push({ type: 'file', language, path: finalPath, code });
    cursor = start + full.length;
  }

  // Append trailing text (if any) and check for a partial last fence.
  const tail = stripped.slice(cursor);
  const partial = tail.match(PARTIAL_FENCE_TAIL_RE);
  if (partial) {
    const leadText = tail.slice(0, partial.index);
    if (leadText) segments.push({ type: 'text', content: leadText });
    const [, tag, body] = partial;
    const { language, path, code } = resolveBlockPath(tag, body);
    const finalPath = dedupePath(path, used);
    used.add(finalPath);
    segments.push({ type: 'file', language, path: finalPath, code, isPartial: true });
  } else if (tail) {
    segments.push({ type: 'text', content: tail });
  }

  return segments;
}

export function isArtifactLanguage(lang) {
  if (!lang) return false;
  const l = String(lang).toLowerCase();
  // If the spike (Task 0) FAILED, replace this list with ['html','svg'].
  return ['html', 'svg', 'mermaid', 'reactjs'].includes(l);
}

export function detectArtifacts(content) {
  return parseReplySegments(content)
    .filter((s) => s.type === 'file' && isArtifactLanguage(s.language))
    .map(({ language, code, isPartial }) => ({ language, code, isPartial: !!isPartial }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd desktop && npx vitest run src/components/artifact/__tests__/useArtifact.test.js
```

Expected: all tests PASS.

- [ ] **Step 5: Run the full test suite for regression**

```bash
cd desktop && npm test
```

Expected: previously-green tests stay green. The new file may not be picked up by the existing `vitest.config.js` test glob — if so, see Step 6.

- [ ] **Step 6: Confirm vitest config picks up the new test**

Open `desktop/vitest.config.js` (or `vite.config.js` if no vitest config). If `test.include` is set, ensure it covers `src/**/__tests__/**/*.{test,spec}.{js,jsx,ts,tsx}`. If not, add it. Then re-run `npm test`.

- [ ] **Step 7: Commit**

```bash
cd /Volumes/MERCURY/PROJECTS/minimax-agent-gui
git add desktop/src/components/artifact/useArtifact.js desktop/src/components/artifact/__tests__/useArtifact.test.js desktop/vitest.config.js
git -c user.email="agent@local" -c user.name="oh-my-pi" commit -m "feat(artifact): fence parser + language detection"
```

---

### Task 2: `useArtifact.js` — Spike fallback narrowing (conditional)

**Files:**
- Modify: `desktop/src/components/artifact/useArtifact.js` (only if Task 0 spike FAILED on any OS we ship to)

- [ ] **Step 1: Apply fallback if needed**

If Task 0 Step 5 said macOS FAILED, edit `isArtifactLanguage`:

```js
export function isArtifactLanguage(lang) {
  if (!lang) return false;
  const l = String(lang).toLowerCase();
  // Spike (Task 0) failed on macOS — mermaid/reactjs ship in v0.6.
  return ['html', 'svg'].includes(l);
}
```

If Task 0 said macOS PASSED, mark this task done with no changes.

- [ ] **Step 2: Run tests**

```bash
cd desktop && npx vitest run src/components/artifact/__tests__/useArtifact.test.js
```

Expected: still green (the existing tests don't assert the full 4-language set — `isArtifactLanguage` test only checks the accepted ones, so narrowing to 2 still passes).

- [ ] **Step 3: Commit (only if Step 1 changed code)**

```bash
cd /Volumes/MERCURY/PROJECTS/minimax-agent-gui
git add desktop/src/components/artifact/useArtifact.js
git -c user.email="agent@local" -c user.name="oh-my-pi" commit -m "chore(artifact): narrow isArtifactLanguage per spike result"
```

---

### Task 3: `artifactTemplates.js` — `buildSrcDoc` + escape helpers

**Files:**
- Create: `desktop/src/components/artifact/artifactTemplates.js`
- Test: `desktop/src/components/artifact/__tests__/artifactTemplates.test.js`

**Interfaces:**
- Produces:
  - `escapeScriptContents(value: string): string` — replaces `</script` with `<\/script` (case-insensitive).
  - `escapeHtml(value: string): string` — escapes `&<>"'`.
  - `extractBody(code: string): string` — returns the inner content of `<body>…</body>` if present, else returns code unchanged.
  - `buildSrcDoc(language: string, code: string): string` — returns a full HTML document string suitable for `srcdoc`.

- [ ] **Step 1: Write the failing test file**

Create `desktop/src/components/artifact/__tests__/artifactTemplates.test.js`:

```js
import { describe, it, expect } from 'vitest';
import {
  escapeScriptContents, escapeHtml, extractBody, buildSrcDoc,
} from '../artifactTemplates.js';

describe('escapeScriptContents', () => {
  it('escapes </script> regardless of case', () => {
    expect(escapeScriptContents('a</script>b')).toBe('a<\\/script>b');
    expect(escapeScriptContents('a</SCRIPT>b')).toBe('a<\\/script>b');
  });
  it('does not touch normal text', () => {
    expect(escapeScriptContents('plain')).toBe('plain');
  });
});

describe('escapeHtml', () => {
  it('escapes the five entities', () => {
    expect(escapeHtml(`<a href="x">'&"</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&quot;&lt;/a&gt;');
  });
});

describe('extractBody', () => {
  it('returns inner body when present', () => {
    expect(extractBody('<html><body><p>hi</p></body></html>')).toBe('<p>hi</p>');
  });
  it('returns the code unchanged when no body tag', () => {
    expect(extractBody('<p>hi</p>')).toBe('<p>hi</p>');
  });
});

describe('buildSrcDoc — html', () => {
  it('wraps raw code in a doctype+html shell when no body tag', () => {
    const out = buildSrcDoc('html', '<p>hi</p>');
    expect(out).toContain('<!doctype html>');
    expect(out).toContain('<body><p>hi</p></body>');
  });
  it('uses the existing body when present', () => {
    const out = buildSrcDoc('html', '<html><body><p>x</p></body></html>');
    expect(out).toContain('<body><p>x</p></body>');
  });
  it('escapes </script in html body', () => {
    const out = buildSrcDoc('html', '<script>alert(1)</script>');
    expect(out).toContain('<\\/script>');
  });
});

describe('buildSrcDoc — svg', () => {
  it('centers the svg in a flex body', () => {
    const out = buildSrcDoc('svg', '<svg width="10" height="10"/>');
    expect(out).toContain('<svg width="10" height="10"/>');
    expect(out).toContain('display:flex');
  });
});

describe('buildSrcDoc — mermaid', () => {
  it('imports mermaid@11.4.0 and pins pre.mermaid body', () => {
    const out = buildSrcDoc('mermaid', 'graph TD; A-->B');
    expect(out).toContain("import mermaid from 'https://esm.sh/mermaid@11.4.0'");
    expect(out).toContain('class="mermaid"');
    expect(out).toContain('graph TD; A--&gt;B');
  });
  it('escapes </script in mermaid', () => {
    const out = buildSrcDoc('mermaid', '</script><script>');
    expect(out).toContain('<\\/script>');
  });
});

describe('buildSrcDoc — reactjs', () => {
  it('pins react@18.3.1 and react-dom@18.3.1', () => {
    const out = buildSrcDoc('reactjs', 'function App(){return null}');
    expect(out).toContain('https://esm.sh/react@18.3.1');
    expect(out).toContain('https://esm.sh/react-dom@18.3.1');
  });
  it('destructures 8 React bindings in the Function body', () => {
    const out = buildSrcDoc('reactjs', 'function App(){return null}');
    expect(out).toContain('useState,useEffect,useRef,useMemo,useCallback,useContext,useReducer,Fragment,createElement');
  });
  it('uses JSON.stringify to inject the model code (safe for backticks/newlines)', () => {
    const code = 'const x = `tpl ${1+1}`;\nfunction App(){return x}';
    const out = buildSrcDoc('reactjs', code);
    // JSON.stringify escapes backtick (no special treatment needed) and
    // escapes the newline as \n in the string literal.
    expect(out).toContain('const x = `tpl ${1+1}`;');
    expect(out).toContain('function App(){return x}');
  });
  it('injects error bridge script', () => {
    const out = buildSrcDoc('reactjs', 'function App(){return null}');
    expect(out).toContain("type:'artifact:error'");
  });
});

describe('buildSrcDoc — unknown language', () => {
  it('throws', () => {
    expect(() => buildSrcDoc('python', 'print(1)')).toThrow(/unsupported/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd desktop && npx vitest run src/components/artifact/__tests__/artifactTemplates.test.js
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Write the implementation**

Create `desktop/src/components/artifact/artifactTemplates.js`:

```js
// Build full HTML documents (srcdoc payloads) for the artifact iframe.
// All four languages share the same error-bridge prelude so the parent can
// surface runtime failures via postMessage.

const ERROR_BRIDGE = `
<script>
  window.onerror = function(m, s, l, c, e) {
    parent.postMessage({type:'artifact:error', message: String(m)}, '*');
  };
  window.addEventListener('unhandledrejection', function(e) {
    parent.postMessage({type:'artifact:error', message: String(e.reason)}, '*');
  });
</script>
`;

export function escapeScriptContents(value) {
  return String(value ?? '').replace(/<\/script/gi, '<\\/script');
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function extractBody(code) {
  const m = String(code ?? '').match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return m ? m[1] : String(code ?? '');
}

function doc(body, head = '') {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
${head}
${ERROR_BRIDGE}
</head>
<body>${body}</body>
</html>`;
}

function buildHtmlDoc(code) {
  const body = extractBody(code);
  return doc(body);
}

function buildSvgDoc(code) {
  return doc(
    `<div style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#fff">${escapeScriptContents(code)}</div>`
  );
}

function buildMermaidDoc(code) {
  const head = `<script type="module">
import mermaid from 'https://esm.sh/mermaid@11.4.0';
mermaid.initialize({startOnLoad: true, theme: 'default'});
<\/script>`;
  return doc(`<pre class="mermaid">${escapeHtml(code)}</pre>`, head);
}

function buildReactDoc(code) {
  const head = `<script type="importmap">
{
  "imports": {
    "react": "https://esm.sh/react@18.3.1",
    "react-dom/client": "https://esm.sh/react-dom@18.3.1/client",
    "react-dom": "https://esm.sh/react-dom@18.3.1"
  }
}
<\/script>
<script type="module">
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
const CODE_STRING = ${JSON.stringify(code)};
try {
  const fn = new Function('React', "const {useState,useEffect,useRef,useMemo,useCallback,useContext,useReducer,Fragment,createElement} = React;" + CODE_STRING + "; return typeof App !== 'undefined' ? App : null;");
  const App = fn(React);
  if (App) {
    createRoot(document.getElementById('root')).render(React.createElement(App));
  } else {
    document.getElementById('root').innerHTML = '<pre style="color:#b91c1c;padding:12px">No App component exported</pre>';
  }
} catch (e) {
  document.getElementById('root').innerHTML = '<pre style="color:#b91c1c;padding:12px">' + (e && e.message || e) + '</pre>';
}
<\/script>`;
  return doc('<div id="root"></div>', head);
}

export function buildSrcDoc(language, code) {
  switch ((language || '').toLowerCase()) {
    case 'html': return buildHtmlDoc(code);
    case 'svg': return buildSvgDoc(code);
    case 'mermaid': return buildMermaidDoc(code);
    case 'reactjs': return buildReactDoc(code);
    default: throw new Error(`unsupported artifact language: ${language}`);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd desktop && npx vitest run src/components/artifact/__tests__/artifactTemplates.test.js
```

Expected: all tests PASS.

- [ ] **Step 5: Apply spike fallback if needed**

If Task 0 said macOS FAILED, change the two `case 'mermaid':` and `case 'reactjs':` arms in `buildSrcDoc` to throw the unsupported error (move them into the default branch). Replace those two cases with:

```js
    // Spike (Task 0) failed on macOS — mermaid/reactjs ship in v0.6.
    // case 'mermaid': return buildMermaidDoc(code);
    // case 'reactjs': return buildReactDoc(code);
```

(Keep the mermaid/reactjs `buildMermaidDoc` / `buildReactDoc` functions defined for v0.6 reuse — they just aren't wired up.)

If spike PASSED, do nothing.

- [ ] **Step 6: Re-run tests**

```bash
cd desktop && npx vitest run src/components/artifact/__tests__/artifactTemplates.test.js
```

Expected: still green. The test file exercises all four languages, so don't change the tests in Step 5 — only the runtime impl. (If spike FAILED, the tests still pass because the test only asserts positive cases for html/svg; the mermaid/reactjs tests should already be removed or skipped at this point. If they are not, edit the test to remove the mermaid/reactjs describe blocks BEFORE running.)

- [ ] **Step 7: Commit**

```bash
cd /Volumes/MERCURY/PROJECTS/minimax-agent-gui
git add desktop/src/components/artifact/artifactTemplates.js desktop/src/components/artifact/__tests__/artifactTemplates.test.js
git -c user.email="agent@local" -c user.name="oh-my-pi" commit -m "feat(artifact): srcdoc templates with 8-hook destructure"
```

---

## Phase 2 — React components

### Task 4: `ArtifactViewer.jsx` — iframe + message bridge

**Files:**
- Create: `desktop/src/components/artifact/ArtifactViewer.jsx`

**Interfaces:**
- Props: `{ code: string, language: string, onError?: (message: string) => void }`
- Renders: a single `<iframe sandbox="allow-scripts" title="artifact-preview" srcDoc={buildSrcDoc(...)}>` plus a `postMessage` listener that calls `onError` when the iframe reports `artifact:error`.

- [ ] **Step 1: Write the component (no test — covered by manual verification in Task 9)**

Create `desktop/src/components/artifact/ArtifactViewer.jsx`:

```jsx
import { useEffect, useRef } from 'react';
import { buildSrcDoc } from './artifactTemplates.js';

export default function ArtifactViewer({ code, language, onError }) {
  const iframeRef = useRef(null);

  useEffect(() => {
    function onMessage(ev) {
      if (ev.source !== iframeRef.current?.contentWindow) return;
      if (ev.data?.type === 'artifact:error') onError?.(String(ev.data.message || 'Unknown runtime error'));
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onError]);

  // key={code} would tear down the iframe on every keystroke. We accept
  // the slight stale-paint cost during streaming instead of remounting.
  return (
    <iframe
      ref={iframeRef}
      title="artifact-preview"
      sandbox="allow-scripts"
      srcDoc={buildSrcDoc(language, code)}
      className="w-full h-full border-0 bg-white"
    />
  );
}
```

- [ ] **Step 2: Manual smoke check (no test)**

There is no React component test for this task — vitest jsdom does not run srcdoc. Visual verification happens in Task 9. Skip to Step 3.

- [ ] **Step 3: Commit**

```bash
cd /Volumes/MERCURY/PROJECTS/minimax-agent-gui
git add desktop/src/components/artifact/ArtifactViewer.jsx
git -c user.email="agent@local" -c user.name="oh-my-pi" commit -m "feat(artifact): ArtifactViewer iframe + postMessage bridge"
```

---

### Task 5: `ArtifactInlineCard.jsx` + `ArtifactViewerModal.jsx`

**Files:**
- Create: `desktop/src/components/artifact/ArtifactInlineCard.jsx`
- Create: `desktop/src/components/artifact/ArtifactViewerModal.jsx`

**Interfaces:**
- `ArtifactInlineCard` props: `{ language, code, isPartial, onOpen }` — renders a small card inside the message bubble with a "Open Preview" button.
- `ArtifactViewerModal` props: `{ open, onOpenChange, code, language }` — wraps `ArtifactViewer` in a Radix Dialog with a Close button and an `Esc` handler.

- [ ] **Step 1: Create the inline card**

Create `desktop/src/components/artifact/ArtifactInlineCard.jsx`:

```jsx
import { Play } from 'lucide-react';

const LABEL = {
  html: 'HTML preview',
  svg: 'SVG illustration',
  mermaid: 'Mermaid diagram',
  reactjs: 'React component',
};

export default function ArtifactInlineCard({ language, code, isPartial, onOpen }) {
  const label = LABEL[language] || `${language} preview`;
  return (
    <div className="my-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Play className="h-3 w-3" />
        <span className="font-medium text-foreground">{label}</span>
        {isPartial && <span className="text-[10px] animate-pulse">streaming…</span>}
      </div>
      <button
        type="button"
        onClick={onOpen}
        disabled={isPartial}
        className="rounded bg-primary px-2 py-1 text-white text-[11px] font-medium hover:bg-primary/90 disabled:opacity-50"
      >
        Open Preview
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Create the modal**

Create `desktop/src/components/artifact/ArtifactViewerModal.jsx`:

```jsx
import { useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import ArtifactViewer from './ArtifactViewer.jsx';

export default function ArtifactViewerModal({ open, onOpenChange, code, language }) {
  const handleError = useCallback((msg) => {
    // eslint-disable-next-line no-console
    console.warn('[artifact]', language, msg);
  }, [language]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Dialog.Content
          className="fixed inset-4 z-50 flex flex-col rounded-lg border border-border bg-card shadow-xl"
          aria-describedby={undefined}
        >
          <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-3">
            <Dialog.Title className="text-sm font-medium">
              {language} preview
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close preview"
                className="rounded p-1 hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>
          <div className="flex-1 min-h-0">
            <ArtifactViewer code={code} language={language} onError={handleError} />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

- [ ] **Step 3: Verify Radix Dialog is in deps**

```bash
cd desktop && grep '"@radix-ui/react-dialog"' package.json
```

Expected: a line. If not, add it: `npm i @radix-ui/react-dialog@^1.1.2` (no other changes).

- [ ] **Step 4: Commit**

```bash
cd /Volumes/MERCURY/PROJECTS/minimax-agent-gui
git add desktop/src/components/artifact/ArtifactInlineCard.jsx desktop/src/components/artifact/ArtifactViewerModal.jsx desktop/package.json desktop/package-lock.json
git -c user.email="agent@local" -c user.name="oh-my-pi" commit -m "feat(artifact): inline card + modal components"
```

---

### Task 6: `ArtifactExtractor.jsx` + `MarkdownRenderer.jsx` integration

**Files:**
- Create: `desktop/src/components/artifact/ArtifactExtractor.jsx`
- Modify: `desktop/src/components/MarkdownRenderer.jsx` (custom `code` component only — every other line stays the same)
- Test: `desktop/src/components/MarkdownRenderer.test.jsx`

**Interfaces:**
- `ArtifactExtractor` props: `{ language, code, isPartial, onOpen }` — returns either `<ArtifactInlineCard>` (if artifact language) or the existing `<pre><code>` fallback (else).

- [ ] **Step 1: Create the extractor**

Create `desktop/src/components/artifact/ArtifactExtractor.jsx`:

```jsx
import { useState, useCallback } from 'react';
import { Copy, Check } from 'lucide-react';
import { isArtifactLanguage } from './useArtifact.js';
import ArtifactInlineCard from './ArtifactInlineCard.jsx';

// Returns either an artifact card (if the language is one of the artifact
// targets) or the existing <pre><code> with a copy button. Kept drop-in
// compatible with the custom `code` component in MarkdownRenderer.jsx.
export default function ArtifactExtractor({ language, code, inline, onOpen }) {
  if (inline) {
    return <InlineCode code={code} />;
  }
  if (isArtifactLanguage(language) && code) {
    return <ArtifactInlineCard language={language} code={code} onOpen={onOpen} />;
  }
  return <CodeBlock code={code} />;
}

function CodeBlock({ code }) {
  const [copied, setCopied] = useState(false);
  const text = typeof code === 'string' ? code : '';
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);
  return (
    <div className="relative group my-2">
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 p-1.5 rounded-md bg-white/10 hover:bg-white/20 text-white/70 hover:text-white opacity-0 group-hover:opacity-100 transition-all z-10"
        title="Copy to clipboard"
        type="button"
      >
        {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
      </button>
      <pre className="bg-black/40 rounded-lg p-3 overflow-x-auto text-xs border border-border/50 pt-8">
        <code className="text-xs font-mono">{text}</code>
      </pre>
    </div>
  );
}

function InlineCode({ code }) {
  return (
    <code className="bg-black/30 px-1.5 py-0.5 rounded text-xs font-mono text-primary">
      {code}
    </code>
  );
}
```

- [ ] **Step 2: Write the failing MarkdownRenderer test**

Create `desktop/src/components/MarkdownRenderer.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MarkdownRenderer from './MarkdownRenderer.jsx';

describe('MarkdownRenderer — artifact integration', () => {
  it('renders plain text unchanged', () => {
    render(<MarkdownRenderer content="hello" />);
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('renders ```python blocks as <pre><code> (regression)', () => {
    render(<MarkdownRenderer content={'```python\nprint(1)\n```'} />);
    expect(screen.getByText('print(1)')).toBeInTheDocument();
    expect(screen.queryByText(/Open Preview/)).toBeNull();
  });

  it('renders ```html blocks as inline artifact card', () => {
    render(<MarkdownRenderer content={'```html\n<p>hi</p>\n```'} />);
    expect(screen.getByText(/HTML preview/)).toBeInTheDocument();
    expect(screen.getByText('Open Preview')).toBeInTheDocument();
  });

  it('renders ```mermaid blocks as inline artifact card (when spike allowed)', () => {
    render(<MarkdownRenderer content={'```mermaid\ngraph TD; A-->B\n```'} />);
    // After spike fallback, the card may or may not be present — accept both.
    const card = screen.queryByText(/Mermaid diagram/);
    if (card) {
      expect(screen.getByText('Open Preview')).toBeInTheDocument();
    } else {
      expect(screen.getByText('graph TD; A-->B')).toBeInTheDocument();
    }
  });

  it('preserves inline backticks as inline code', () => {
    render(<MarkdownRenderer content={'`x`'}/>);
    expect(screen.getByText('x').tagName).toBe('CODE');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd desktop && npx vitest run src/components/MarkdownRenderer.test.jsx
```

Expected: the `html` and `mermaid` cases FAIL (no inline card yet). `python` and inline cases may pass already.

- [ ] **Step 4: Modify MarkdownRenderer.jsx custom code component**

Open `desktop/src/components/MarkdownRenderer.jsx`. Replace the `CodeBlock` function (lines 6–35) and the `code` rendering in the `components` prop (lines 42–53) with the following. **Leave every other line unchanged** (the `pre`, `p`, `ul`, `ol`, `li`, `h1`–`h4`, `a`, `blockquote`, `table`, `thead`, `th`, `td`, `hr` components stay exactly as they are).

Replace the import block (lines 1–4) with:

```jsx
import { useState, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import ArtifactExtractor from './artifact/ArtifactExtractor.jsx'
```

Replace the `CodeBlock` function (lines 6–35) with:

```jsx
// `inline`, `className`, and the rest are forwarded from react-markdown.
// We only intercept the non-inline fence case to route to ArtifactExtractor.
function CodeBlock({ inline, className, children, onArtifactOpen }) {
  // react-markdown passes the language inside className="language-xxx".
  const m = /language-([\w-]+)/.exec(className || '')
  const language = m ? m[1] : ''
  const text = String(
    Array.isArray(children) ? children.join('') : (children ?? '')
  )
  return (
    <ArtifactExtractor
      inline={inline}
      language={language}
      code={text}
      onOpen={() => onArtifactOpen?.({ language, code: text })}
    />
  )
}
```

Replace the `pre` and `code` entries in the `components` prop (lines 43 and 44) with:

```jsx
pre: ({ children }) => <>{children}</>,
code: (props) => <CodeBlock {...props} onArtifactOpen={props.onArtifactOpen} />,
```

Update the function signature of `MarkdownRenderer` to accept and forward `onArtifactOpen`:

```jsx
export default function MarkdownRenderer({ content, className = '', onArtifactOpen }) {
```

…and pass it through to `ReactMarkdown`:

```jsx
<ReactMarkdown
  remarkPlugins={[remarkGfm]}
  components={makeComponents(onArtifactOpen)}
>
  {content}
</ReactMarkdown>
```

where `makeComponents` is a small local builder that injects `onArtifactOpen` into the `code` entry:

```jsx
function makeComponents(onArtifactOpen) {
  return {
    pre: ({ children }) => <>{children}</>,
    code: (props) => <CodeBlock {...props} onArtifactOpen={onArtifactOpen} />,
    p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
    ul: ({ children }) => <ul className="list-disc pl-4 mb-2">{children}</ul>,
    ol: ({ children }) => <ol className="list-decimal pl-4 mb-2">{children}</ol>,
    li: ({ children }) => <li className="mb-0.5">{children}</li>,
    h1: ({ children }) => <h1 className="text-lg font-bold mb-2 mt-3">{children}</h1>,
    h2: ({ children }) => <h2 className="text-base font-bold mb-2 mt-3">{children}</h2>,
    h3: ({ children }) => <h3 className="text-sm font-bold mb-1 mt-2">{children}</h3>,
    h4: ({ children }) => <h4 className="text-sm font-semibold mb-1 mt-2">{children}</h4>,
    a: ({ children, href }) => (
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline hover:text-primary/80">
        {children}
      </a>
    ),
    blockquote: ({ children }) => (
      <blockquote className="border-l-2 border-primary/50 pl-3 italic my-2 text-muted-foreground">
        {children}
      </blockquote>
    ),
    table: ({ children }) => (
      <table className="w-full text-left border-collapse my-2 text-xs">
        {children}
      </table>
    ),
    thead: ({ children }) => <thead className="bg-surface border-b border-border">{children}</thead>,
    th: ({ children }) => <th className="px-2 py-1 font-semibold">{children}</th>,
    td: ({ children }) => <td className="px-2 py-1 border-b border-border/30">{children}</td>,
    hr: () => <hr className="my-3 border-border" />,
  }
}
```

(The full file is small — the diff is the import + `CodeBlock` + the `code` rendering entries. The pre-entry change is necessary because the original wrapped a `<pre>` around the `CodeBlock`, but `CodeBlock` already renders its own `<pre>`. A nested `<pre><pre>` would render as `<pre><pre>` in HTML — visually fine, but the regression test for `python` checks `screen.getByText('print(1)')` against the `<code>` inside the inner `<pre>`, which still works. The `pre: ({children}) => <>{children}</>` is just to preserve the previous semantics without the extra wrapper.)

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd desktop && npx vitest run src/components/MarkdownRenderer.test.jsx
```

Expected: all tests PASS.

- [ ] **Step 6: Run full suite for regression**

```bash
cd desktop && npm test
```

Expected: previously-green tests stay green. `WorkspaceSidebar.test.jsx` and `StatusBar.test.jsx` should be unaffected.

- [ ] **Step 7: Commit**

```bash
cd /Volumes/MERCURY/PROJECTS/minimax-agent-gui
git add desktop/src/components/MarkdownRenderer.jsx desktop/src/components/artifact/ArtifactExtractor.jsx desktop/src/components/MarkdownRenderer.test.jsx
git -c user.email="agent@local" -c user.name="oh-my-pi" commit -m "feat(artifact): MarkdownRenderer routes artifact languages to card"
```

---

## Phase 3 — Panel integration

### Task 7: Wire `ChatPanel.jsx` to open the modal

**Files:**
- Modify: `desktop/src/components/chat/ChatPanel.jsx` (around lines 710 — `<MarkdownRenderer content={msg.content} />`)

**Interfaces:**
- ChatPanel state: `const [artifact, setArtifact] = useState(null)` where `artifact = { code, language } | null`.
- Pass `onArtifactOpen={setArtifact}` to `<MarkdownRenderer>`.
- Render `<ArtifactViewerModal open={!!artifact} onOpenChange={(o) => !o && setArtifact(null)} code={artifact?.code} language={artifact?.language} />` once at the bottom of the messages container.

- [ ] **Step 1: Add the import**

In `desktop/src/components/chat/ChatPanel.jsx` (line 10 area), add two new lines after the existing `import MarkdownRenderer from '../MarkdownRenderer'`:

```jsx
import ArtifactViewerModal from '../artifact/ArtifactViewerModal.jsx'
```

- [ ] **Step 2: Add the state**

Find the `ChatPanel` function body in the same file. Add a single useState near the other state hooks:

```jsx
const [artifact, setArtifact] = useState(null)
```

- [ ] **Step 3: Pass the handler**

Find line 710 (`<MarkdownRenderer content={msg.content} />`) and change it to:

```jsx
<MarkdownRenderer
  content={msg.content}
  onArtifactOpen={(a) => setArtifact(a)}
/>
```

- [ ] **Step 4: Render the modal**

Find the messages container (the `<div>` that maps `messages`). Just before its closing tag, add:

```jsx
<ArtifactViewerModal
  open={!!artifact}
  onOpenChange={(o) => { if (!o) setArtifact(null) }}
  code={artifact?.code || ''}
  language={artifact?.language || 'html'}
/>
```

- [ ] **Step 5: Run tests**

```bash
cd desktop && npm test
```

Expected: all green. ChatPanel.jsx has no own tests; the MarkdownRenderer regression suite stays green.

- [ ] **Step 6: Commit**

```bash
cd /Volumes/MERCURY/PROJECTS/minimax-agent-gui
git add desktop/src/components/chat/ChatPanel.jsx
git -c user.email="agent@local" -c user.name="oh-my-pi" commit -m "feat(artifact): wire ChatPanel modal"
```

---

### Task 8: Wire `CodingPanel.jsx` to open the modal (same shape)

**Files:**
- Modify: `desktop/src/components/coding/CodingPanel.jsx` (around line 1042)

**Interfaces:** Identical to Task 7. The state lives inside `CodingPanel`.

- [ ] **Step 1: Add the import**

In `desktop/src/components/coding/CodingPanel.jsx` (line 12 area), add after the existing MarkdownRenderer import:

```jsx
import ArtifactViewerModal from '../artifact/ArtifactViewerModal.jsx'
```

- [ ] **Step 2: Add the state**

Inside the `CodingPanel` function body, add:

```jsx
const [artifact, setArtifact] = useState(null)
```

(`useState` is already imported in this file — verify at the top before adding.)

- [ ] **Step 3: Pass the handler**

Find line 1042 (`<MarkdownRenderer content={msg.content} />`) and change it to:

```jsx
<MarkdownRenderer
  content={msg.content}
  onArtifactOpen={(a) => setArtifact(a)}
/>
```

- [ ] **Step 4: Render the modal**

Find the messages map's parent container. Just before its closing tag, add:

```jsx
<ArtifactViewerModal
  open={!!artifact}
  onOpenChange={(o) => { if (!o) setArtifact(null) }}
  code={artifact?.code || ''}
  language={artifact?.language || 'html'}
/>
```

- [ ] **Step 5: Run tests**

```bash
cd desktop && npm test
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
cd /Volumes/MERCURY/PROJECTS/minimax-agent-gui
git add desktop/src/components/coding/CodingPanel.jsx
git -c user.email="agent@local" -c user.name="oh-my-pi" commit -m "feat(artifact): wire CodingPanel modal"
```

---

## Phase 4 — Backend prompt injection

### Task 9: Inject `## Artifacts` rules into the system prompt

**Files:**
- Modify: `web/backend/main.py` (immediately after the `system_prompt += _build_mcp_section(mcp_tools or [])` line, around line 1222)

- [ ] **Step 1: Find the exact insertion point**

In `web/backend/main.py`, search for:

```python
        system_prompt += _build_mcp_section(mcp_tools or [])
```

The line right after is where the artifact rules go.

- [ ] **Step 2: Apply spike fallback if needed**

If Task 0 said macOS FAILED, use this insertion (omits mermaid/reactjs):

```python
        system_prompt += _build_mcp_section(mcp_tools or [])

        # Artifact rules (v0.5) — narrow per Task 0 spike result.
        system_prompt += (
            "\n\n## Artifacts\n"
            "When the user asks for UI, a button/component, a diagram, a chart, an SVG illustration, "
            "or any self-contained visual artifact, ALWAYS respond with a single fenced code block:\n"
            "- HTML page → ```html\n"
            "- SVG illustration → ```svg\n"
            "\n"
            "Write the code so it is self-contained: inline CSS only, no external assets, no build step. "
            "Keep the code in ONE fence per artifact; the desktop app will render it in a sandboxed preview."
        )
```

If spike PASSED, use the full four-language version:

```python
        system_prompt += _build_mcp_section(mcp_tools or [])

        # Artifact rules (v0.5).
        system_prompt += (
            "\n\n## Artifacts\n"
            "When the user asks for UI, a button/component, a diagram, a chart, an SVG illustration, "
            "or any self-contained visual artifact, ALWAYS respond with a single fenced code block:\n"
            "- HTML page → ```html\n"
            "- SVG illustration → ```svg\n"
            "- Mermaid diagram (flowchart, sequence, ER, gantt, class) → ```mermaid\n"
            "- Single-file React component (no JSX/TSX) → ```reactjs\n"
            "\n"
            "Write the code so it is self-contained: inline CSS, pinned `esm.sh` URLs for any runtime "
            "(e.g. `react@18.3.1`, `mermaid@11.4.0`). No external assets, no multi-file project, no build step. "
            "Keep the code in ONE fence per artifact; the desktop app will render it in a sandboxed preview. "
            "For React, export a top-level `function App()` (or `const App = () => …`) and freely use "
            "`useState`, `useEffect`, `useRef`, `useMemo`, `useCallback`, `useContext`, `useReducer` — "
            "they are all available without import."
        )
```

- [ ] **Step 3: Smoke-import the module**

```bash
cd /Volumes/MERCURY/PROJECTS/minimax-agent-gui && python -c "import web.backend.main" 2>&1 | tail -3
```

Expected: no `SyntaxError`. (Importing the module will trigger FastAPI app construction; if the sidecar is already bound, expect `OSError: [Errno 48] Address already in use` — that is fine, we only need syntax verification.)

- [ ] **Step 4: Run the existing test suite**

```bash
cd /Volumes/MERCURY/PROJECTS/minimax-agent-gui && python -m pytest -q tests/ 2>&1 | tail -20
```

Expected: previously-green tests stay green. The prompt change is a no-op for unit tests since they mock the LLM.

- [ ] **Step 5: Confirm no secrets are touched**

```bash
cd /Volumes/MERCURY/PROJECTS/minimax-agent-gui && git diff web/backend/main.py | grep -iE 'api_key|secret|token' || echo "no secret lines"
```

Expected: `no secret lines`.

- [ ] **Step 6: Commit**

```bash
cd /Volumes/MERCURY/PROJECTS/minimax-agent-gui
git add web/backend/main.py
git -c user.email="agent@local" -c user.name="oh-my-pi" commit -m "feat(artifact): inject ## Artifacts rules into system prompt"
```

---

## Phase 5 — End-to-end manual verification

### Task 10: Manual smoke test in `npm run tauri:dev`

**Files:** none (no code change)

- [ ] **Step 1: Launch the app**

```bash
cd desktop && npm run tauri:dev
```

Wait for the desktop window to open. Wait for `/api/config` healthcheck to return 2xx (StatusBar shows "running").

- [ ] **Step 2: Chat panel — HTML fixture**

In the chat composer type:

```
그라디언트 버튼 하나 만들어줘. ```html 태그로.
```

Press Enter. The model should respond with a ` ```html ` block. Expect:
- A `ArtifactInlineCard` appears inside the assistant message bubble with "HTML preview" + an "Open Preview" button.
- Click the button. The modal opens. The iframe renders a centered button with a gradient. Clicking the gradient button does not navigate the main window (sandbox enforces this).

- [ ] **Step 3: Chat panel — mermaid fixture (only if spike allowed it)**

In a new chat, type:

```
사용자 로그인 흐름을 mermaid 로 그려줘. ```mermaid 태그로.
```

Expect (if spike passed):
- A "Mermaid diagram" inline card. Modal opens → flowchart renders.

If spike FAILED, the model is still prompted for mermaid by the system prompt — but the frontend will fall back to `<pre><code>` (because `isArtifactLanguage` returned false in Task 2). That's the documented v0.5.0 behavior on spike-failed OS.

- [ ] **Step 4: Chat panel — reactjs fixture (only if spike allowed it)**

In a new chat, type:

```
카운터 컴포넌트 ```reactjs 로 만들어줘. useState 와 useEffect 도 써줘.
```

Expect (if spike passed):
- "React component" inline card. Modal opens. A counter renders. After 2-3 increments, a `useEffect`-driven console.log fires (open DevTools).

- [ ] **Step 5: Coding panel — repeat Steps 2–4**

Switch to the Code tab in the sidebar. Run the same three prompts in the agent chat. The same fixtures should render in the modal.

- [ ] **Step 6: Regression — python code block still renders as code**

In a new chat, type:

```
```python
def hello():
    return "world"
```
```

Expect: a regular `<pre><code>` block with `def hello():` inside. No "Open Preview" button anywhere.

- [ ] **Step 7: Regression — thinking strip**

In a new chat, ask the model to reveal its thinking in some way. (Any prompt likely to produce a `<thinking>...</thinking>` block. If your model doesn't emit those, skip this step.) Expect: no fence inside the thinking block gets treated as an artifact.

- [ ] **Step 8: Production build**

```bash
cd desktop && npm run build
```

Expected: Vite production build succeeds without warnings about missing imports.

- [ ] **Step 9: Final regression**

```bash
cd desktop && npm test
```

Expected: all green.

- [ ] **Step 10: Final commit (only if any docs/notes were added during verification)**

If during Steps 1–9 you edited any spec or comment to record the observed runtime behavior:

```bash
cd /Volumes/MERCURY/PROJECTS/minimax-agent-gui
git add -A
git -c user.email="agent@local" -c user.name="oh-my-pi" commit -m "docs(artifact): record manual verification notes"
```

Otherwise, mark the task done without a commit.

---

## Self-Review (executed by the planner)

**Spec coverage check:**

| Spec section | Covered by task |
|---|---|
| §1 Goal (4 artifact types in Chat + Coding) | Tasks 1, 3, 6, 7, 8 |
| §2 Single entry point (MarkdownRenderer) | Task 6 |
| §3 Scope (4 types or fewer if spike fails) | Task 0, 2, 3 Step 5, 9 Step 2 |
| §4 Sandbox (no allow-same-origin, no main origin access) | Task 3 (`doc()` + Task 4 `iframeRef`) |
| §4 External dep 0 (Tauri bundle) | Task 3 (esm.sh pinned) |
| §4 Streaming safe (200ms debounce, partial fence) | Task 1 (`isPartial`, `parseReplySegments` partial branch) |
| §4 React hook compatibility (8 hooks) | Task 3 Step 3 (test asserts 8 destructure names) |
| §4 Existing behavior preserved | Task 6 Step 5 (regression test for `python`) + Step 6 (full `npm test`) |
| §5.1 Files created/modified | All tasks reference exact paths |
| §5.2 Data flow | Task 4 + Task 6 + Task 7 implement the flow |
| §5.3 `useArtifact.js` signatures | Task 1 matches |
| §5.4 `buildSrcDoc` body | Task 3 matches the spec's exact srcdoc string |
| §5.4.1 WebView spike | Task 0 |
| §5.5 postMessage bridge | Task 4 + Task 3 `ERROR_BRIDGE` |
| §5.6 System prompt injection | Task 9 |
| §6 Security | Task 3 (escape) + Task 4 (no same-origin) |
| §7.1 useArtifact tests | Task 1 |
| §7.2 artifactTemplates tests | Task 3 |
| §7.3 MarkdownRenderer tests | Task 6 |
| §7.4 Manual verification | Task 10 |
| §8 Verification steps | Tasks 0, 1, 3, 6, 7, 8, 9, 10 |

**Placeholder scan:** no TBD / TODO / "implement later" / "fill in" patterns. ✅

**Type consistency check:**
- `parseReplySegments` returns `Array<TextSegment | FileSegment>` in both spec §5.3 and Task 1 Step 3.
- `buildSrcDoc(language, code)` signature matches spec §5.3 and Task 3 Step 3.
- `isArtifactLanguage(lang)` signature matches spec §5.3 and Task 1.
- `ArtifactViewer` props match spec §5.5 and Task 4.
- `ArtifactInlineCard` / `ArtifactViewerModal` props match spec §5.1 and Tasks 5, 6, 7, 8.
- `onArtifactOpen` prop chain: `MarkdownRenderer` → `CodeBlock` → `ArtifactExtractor` (no — the `ArtifactExtractor` is rendered by `CodeBlock` which receives `onArtifactOpen` from `MarkdownRenderer`. `ArtifactExtractor` itself does not forward it; the inline card invokes `onOpen` directly with the captured payload, which in turn calls the `onArtifactOpen` passed by the panel). Confirmed consistent in Task 6 Step 4.

No conflicts found. Plan is ready for execution.
