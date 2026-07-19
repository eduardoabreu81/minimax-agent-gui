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
  return doc(escapeScriptContents(body));
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
