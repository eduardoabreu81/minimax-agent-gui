// helpLoader — single source of truth for in-app Help content.
//
// Help articles live as markdown at `src/help/<lang>/<id>.md` and are
// described by `src/help/manifest.json`. The SAME files feed the generated
// README (see desktop/scripts/generate-readme.mjs), so there is exactly one
// place to edit documentation.
//
// Locale resolution mirrors i18next's `fallbackLng: 'en'`: when a topic has
// no markdown for the requested language we fall back to English, so the
// panel never renders a blank article for a partially-translated locale.

import manifest from '../../help/manifest.json'

// Eagerly inline every help markdown file as a raw string. Vite resolves the
// glob at build time; keys look like `../../help/en/chat.md`.
const modules = import.meta.glob('../../help/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
})

const FALLBACK_LANG = 'en'

// Build a { [lang]: { [id]: content } } lookup from the glob keys.
const byLangThenId = {}
for (const [path, content] of Object.entries(modules)) {
  const match = path.match(/\/help\/([^/]+)\/([^/]+)\.md$/)
  if (!match) continue
  const [, lang, id] = match
  if (!byLangThenId[lang]) byLangThenId[lang] = {}
  byLangThenId[lang][id] = content
}

/**
 * The ordered list of help topics from the manifest.
 * @returns {Array<{ id: string, icon: string, readme?: boolean, title: Record<string, string> }>}
 */
export function getTopics() {
  return manifest.topics
}

/**
 * Resolve a topic's display title for a language, falling back to English
 * then to the raw id.
 * @param {{ id: string, title: Record<string, string> }} topic
 * @param {string} lang
 * @returns {string}
 */
export function getTopicTitle(topic, lang) {
  return topic.title?.[lang] || topic.title?.[FALLBACK_LANG] || topic.id
}

/**
 * Markdown body for a topic in the requested language, falling back to
 * English when that locale has no article for the topic.
 * @param {string} id
 * @param {string} lang
 * @returns {string}
 */
export function getTopicContent(id, lang) {
  return (
    byLangThenId[lang]?.[id] ??
    byLangThenId[FALLBACK_LANG]?.[id] ??
    ''
  )
}

/**
 * Normalize an i18next language tag (e.g. `pt-BR`, `en-US`) to a help locale
 * that actually has content, preferring an exact match, then the base
 * language, then English.
 * @param {string} lang
 * @returns {string}
 */
export function resolveHelpLang(lang) {
  if (!lang) return FALLBACK_LANG
  if (byLangThenId[lang]) return lang
  const base = lang.split('-')[0]
  if (byLangThenId[base]) return base
  // Some locales (e.g. pt-BR) only exist in hyphenated form — match by prefix.
  const prefixed = Object.keys(byLangThenId).find((l) => l.split('-')[0] === base)
  return prefixed || FALLBACK_LANG
}

export { FALLBACK_LANG }
