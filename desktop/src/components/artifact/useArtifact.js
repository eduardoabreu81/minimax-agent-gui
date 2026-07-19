// Fence parser + language detection for the artifact feature.
// Ported/adapted from llamacoder's lib/utils.ts but trimmed to the surface
// this app needs (no multi-file sandboxing, no path resolution for files
// outside the artifact fence).

const FENCE_RE = /```([^\n`]*)\n([\s\S]*?)\n?```/g;
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
    const stripped2 = lines.slice(1).join('\n');
    return { language, path: attrPath, code: stripped2.replace(/\n$/, '') };
  }
  // Fallback: intelligent filename from language (kept simple here).
  const ext = ({ html: 'html', svg: 'svg', mermaid: 'mmd', reactjs: 'js' })[language] || 'txt';
  const code2 = code || '';
  return { language, path: `file.${ext}`, code: code2.replace(/\n$/, '') };
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
      // Trim the boundary newline so text segments end at the fence opener.
      let end = start;
      if (end > cursor && stripped[end - 1] === '\n') end -= 1;
      if (end > cursor) segments.push({ type: 'text', content: stripped.slice(cursor, end) });
    }
    const { language, path, code } = resolveBlockPath(tag, body);
    const finalPath = dedupePath(path, used);
    used.add(finalPath);
    segments.push({ type: 'file', language, path: finalPath, code });
    cursor = start + full.length;
  }
  // Append trailing text (if any) and check for a partial last fence.
  const tail0 = stripped.slice(cursor);
  // Drop the boundary newline that follows a closed fence so it does not leak into trailing text.
  const tail = tail0.startsWith('\n') ? tail0.slice(1) : tail0;
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
