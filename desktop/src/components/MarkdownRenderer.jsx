import { useState, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Copy, Check } from 'lucide-react'

function CodeBlock({ children, ...props }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    const text = children?.props?.children || ''
    if (typeof text === 'string') {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
    }
  }, [children])

  return (
    <div className="relative group my-2">
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 p-1.5 rounded-md bg-white/10 hover:bg-white/20 text-white/70 hover:text-white opacity-0 group-hover:opacity-100 transition-all z-10"
        title="Copy to clipboard"
      >
        {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
      </button>
      <pre className="bg-black/40 rounded-lg p-3 overflow-x-auto text-xs border border-border/50 pt-8">
        <code className="text-xs font-mono" {...props}>
          {children}
        </code>
      </pre>
    </div>
  )
}

export default function MarkdownRenderer({ content, className = '' }) {
  return (
    <div className={`markdown-body ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          code: ({ inline, children, ...props }) =>
            inline ? (
              <code className="bg-black/30 px-1.5 py-0.5 rounded text-xs font-mono text-primary" {...props}>
                {children}
              </code>
            ) : (
              <code className="text-xs font-mono" {...props}>
                {children}
              </code>
            ),
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
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
