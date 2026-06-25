import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import * as Icons from 'lucide-react'
import { HelpCircle } from 'lucide-react'
import MarkdownRenderer from '../MarkdownRenderer'
import {
  getTopics,
  getTopicContent,
  getTopicTitle,
  resolveHelpLang,
} from './helpLoader'

// Resolve a lucide icon component by the name stored in the manifest,
// falling back to a generic help glyph if the name is unknown.
function TopicIcon({ name, ...props }) {
  const Icon = Icons[name] || HelpCircle
  return <Icon {...props} />
}

// HelpPanel — in-app documentation. Topics and content come from
// `src/help/` via helpLoader, the same source the README generator reads, so
// docs are written once. Language follows the active i18next locale and
// falls back to English for untranslated topics.
export default function HelpPanel() {
  const { t, i18n } = useTranslation()
  const lang = resolveHelpLang(i18n.language)
  const topics = getTopics()
  const [activeId, setActiveId] = useState(topics[0]?.id)

  const activeTopic = topics.find((tp) => tp.id === activeId) || topics[0]
  const content = activeTopic ? getTopicContent(activeTopic.id, lang) : ''

  return (
    <div className="flex h-full min-h-0 bg-background">
      {/* Topic list */}
      <nav className="w-60 shrink-0 border-r border-border bg-card overflow-y-auto py-3 px-2">
        <div className="px-3 pb-2 flex items-center gap-2 text-muted-foreground">
          <HelpCircle size={16} aria-hidden="true" />
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em]">
            {t('nav.help', 'Help')}
          </span>
        </div>
        <div className="space-y-0.5">
          {topics.map((topic) => {
            const isActive = topic.id === activeTopic?.id
            return (
              <button
                key={topic.id}
                onClick={() => setActiveId(topic.id)}
                className={`
                  relative w-full flex items-center gap-3 rounded-lg px-3 py-2.5
                  text-left transition-all duration-150
                  ${isActive
                    ? 'bg-primary/[0.13] text-primary'
                    : 'text-muted-foreground hover:bg-surface hover:text-foreground'
                  }
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50
                `}
                aria-current={isActive ? 'page' : undefined}
              >
                {isActive && (
                  <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-primary" aria-hidden="true" />
                )}
                <TopicIcon name={topic.icon} size={18} aria-hidden="true" />
                <span className="flex-1 text-[13px] font-medium truncate">
                  {getTopicTitle(topic, lang)}
                </span>
              </button>
            )
          })}
        </div>
      </nav>

      {/* Article */}
      <main className="flex-1 min-w-0 overflow-y-auto">
        <article className="max-w-2xl mx-auto px-8 py-8 text-sm text-foreground leading-relaxed">
          {content
            ? <MarkdownRenderer content={content} />
            : <p className="text-muted-foreground">No content available.</p>}
        </article>
      </main>
    </div>
  )
}
