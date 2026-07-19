import { useState, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import ArtifactExtractor from './artifact/ArtifactExtractor.jsx'

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

export default function MarkdownRenderer({ content, className = '', onArtifactOpen }) {
  return (
    <div className={`markdown-body ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={makeComponents(onArtifactOpen)}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
