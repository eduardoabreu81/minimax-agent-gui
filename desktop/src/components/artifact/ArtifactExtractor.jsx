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
