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
  it('escapes </script in mermaid (HTML entity, since pre.mermaid is text content)', () => {
    const out = buildSrcDoc('mermaid', '</script><script>');
    // The mermaid body is rendered inside <pre class="mermaid">…</pre>, so
    // the user's </script> is text content — escapeHtml entity-encodes it
    // (which is sufficient; the browser does not treat it as a script
    // terminator inside <pre>). We assert both that the raw </script> is
    // not present and that the entity form is.
    expect(out).not.toContain('</script><script>');
    expect(out).toContain('&lt;/script&gt;&lt;script&gt;');
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
