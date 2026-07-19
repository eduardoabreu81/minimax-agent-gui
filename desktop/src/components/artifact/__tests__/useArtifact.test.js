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
