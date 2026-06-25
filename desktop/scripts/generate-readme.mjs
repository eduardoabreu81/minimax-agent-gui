// generate-readme.mjs — build README sections from the in-app Help content.
//
// The help markdown under src/help/ is the single source of truth for both
// the in-app Help panel and the README, so docs are written once. This script
// reads the English articles (the README's language) plus the manifest, and
// writes the result into desktop/README.md between AUTOGEN markers — anything
// outside the markers (badges, install notes, license) is preserved.
//
//     npm run readme     # regenerate from current help content
//     npm run docs       # screenshots + readme in one go
//
// Screenshots come from `npm run shots` (docs/screenshots/*.png) and are
// embedded only when the file actually exists, so the README never shows a
// broken image before shots have been captured.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const HELP_DIR = path.join(ROOT, 'src', 'help')
const README = path.join(ROOT, 'README.md')
const README_LANG = 'en'

const START = '<!-- AUTOGEN:HELP:START -->'
const END = '<!-- AUTOGEN:HELP:END -->'

// Screenshot to embed under each topic section (relative to desktop/).
// Topics not listed (or whose file is missing) render without an image.
const TOPIC_IMAGE = {
  chat: 'docs/screenshots/chat.png',
  coding: 'docs/screenshots/coding.png',
  media: 'docs/screenshots/image.png',
  tasks: 'docs/screenshots/tasks.png',
  settings: 'docs/screenshots/settings.png',
}

// Demote a topic's headings by one level so the README keeps a single H1:
// the leading "# Title" is dropped (we emit the manifest title as "## ..."),
// and any deeper headings shift down one.
function embedBody(raw) {
  const lines = raw.split(/\r?\n/)
  // Drop the first H1 line if present.
  if (lines[0]?.startsWith('# ')) lines.shift()
  return lines
    .map((line) => (/^#{2,5} /.test(line) ? '#' + line : line))
    .join('\n')
    .trim()
}

function buildSection() {
  const manifest = JSON.parse(readFileSync(path.join(HELP_DIR, 'manifest.json'), 'utf8'))
  const topics = manifest.topics.filter((t) => t.readme !== false)

  const toc = topics
    .map((t) => {
      const title = t.title[README_LANG] || t.title.en || t.id
      const anchor = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      return `- [${title}](#${anchor})`
    })
    .join('\n')

  const sections = topics.map((t) => {
    const title = t.title[README_LANG] || t.title.en || t.id
    const file = path.join(HELP_DIR, README_LANG, `${t.id}.md`)
    const body = existsSync(file) ? embedBody(readFileSync(file, 'utf8')) : '_Documentation pending._'

    const img = TOPIC_IMAGE[t.id]
    const imgMd = img && existsSync(path.join(ROOT, img))
      ? `\n![${title}](${img})\n`
      : ''

    return `## ${title}\n${imgMd}\n${body}`
  })

  return [
    START,
    '',
    '> This section is generated from the in-app Help content by',
    '> `npm run docs`. Edit the markdown under `src/help/`, not here.',
    '',
    '## User Guide',
    '',
    toc,
    '',
    sections.join('\n\n'),
    '',
    END,
  ].join('\n')
}

function main() {
  const section = buildSection()

  let readme = existsSync(README) ? readFileSync(README, 'utf8') : `# MiniMax Agent — Desktop\n\n`

  if (readme.includes(START) && readme.includes(END)) {
    const before = readme.slice(0, readme.indexOf(START))
    const after = readme.slice(readme.indexOf(END) + END.length)
    readme = `${before}${section}${after}`
    console.log('✓ Updated AUTOGEN section in README.md')
  } else {
    readme = `${readme.trimEnd()}\n\n${section}\n`
    console.log('✓ Appended AUTOGEN section to README.md (markers were absent)')
  }

  writeFileSync(README, readme)
  console.log(`  ${path.relative(process.cwd(), README)}`)
}

main()
