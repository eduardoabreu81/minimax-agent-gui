// generate-readme.mjs — build the standalone User Guide from the in-app Help.
//
// The help markdown under desktop/src/help/ is the single source of truth for
// both the in-app Help panel and the published guide, so docs are written
// once. This script reads the English articles (the guide's language) plus the
// manifest and writes a self-contained page at <repo>/docs/USER_GUIDE.md. The
// root README links to it; it is NOT injected into any README.
//
//     npm run guide     # regenerate docs/USER_GUIDE.md from current help
//     npm run docs      # screenshots + guide in one go
//
// Screenshots come from `npm run shots` (desktop/docs/screenshots/*.png) and
// are embedded only when the file actually exists, so the guide never shows a
// broken image before shots have been captured.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DESKTOP = path.resolve(__dirname, '..')       // desktop/
const REPO = path.resolve(DESKTOP, '..')            // repo root
const HELP_DIR = path.join(DESKTOP, 'src', 'help')
const SHOTS_DIR = path.join(DESKTOP, 'docs', 'screenshots')
const GUIDE = path.join(REPO, 'docs', 'USER_GUIDE.md')
const GUIDE_LANG = 'en'

// Screenshot embedded under each topic. Path is written relative to the guide
// file (repo/docs/), so it points back into desktop/docs/screenshots/.
const TOPIC_SHOT = {
  chat: 'chat.png',
  coding: 'coding.png',
  media: 'image.png',
  tasks: 'tasks.png',
  settings: 'settings.png',
}
const shotHref = (file) => `../desktop/docs/screenshots/${file}`

// Demote a topic's headings by one level so the guide keeps a single H1:
// the leading "# Title" is dropped (we emit the manifest title as "## ..."),
// and any deeper headings shift down one.
function embedBody(raw) {
  const lines = raw.split(/\r?\n/)
  if (lines[0]?.startsWith('# ')) lines.shift()
  return lines
    .map((line) => (/^#{2,5} /.test(line) ? '#' + line : line))
    .join('\n')
    .trim()
}

function buildGuide() {
  const manifest = JSON.parse(readFileSync(path.join(HELP_DIR, 'manifest.json'), 'utf8'))
  const topics = manifest.topics.filter((t) => t.readme !== false)
  const titleOf = (t) => t.title[GUIDE_LANG] || t.title.en || t.id

  const toc = topics
    .map((t) => {
      const title = titleOf(t)
      const anchor = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      return `- [${title}](#${anchor})`
    })
    .join('\n')

  const sections = topics.map((t) => {
    const title = titleOf(t)
    const file = path.join(HELP_DIR, GUIDE_LANG, `${t.id}.md`)
    const body = existsSync(file) ? embedBody(readFileSync(file, 'utf8')) : '_Documentation pending._'

    const shot = TOPIC_SHOT[t.id]
    const imgMd = shot && existsSync(path.join(SHOTS_DIR, shot))
      ? `\n<img src="${shotHref(shot)}" alt="${title}" width="100%" />\n`
      : ''

    return `## ${title}\n${imgMd}\n${body}`
  })

  return [
    '<!--',
    '  GENERATED FILE — do not edit by hand.',
    '  Source: desktop/src/help/<lang>/*.md  ·  Rebuild: cd desktop && npm run docs',
    '-->',
    '',
    '# MiniMax Agent — User Guide',
    '',
    'This guide mirrors the in-app Help (press `F1` or `?` inside the app). It is',
    'written in English here; the app shows it in whichever of the six languages',
    'you have selected (English, Português, Español, 日本語, 한국어, 中文), falling',
    'back to English for any untranslated topic.',
    '',
    '## Contents',
    '',
    toc,
    '',
    sections.join('\n\n'),
    '',
    '---',
    '',
    '<sub>Generated from the in-app Help · `npm run docs`</sub>',
    '',
  ].join('\n')
}

function main() {
  const guide = buildGuide()
  mkdirSync(path.dirname(GUIDE), { recursive: true })
  writeFileSync(GUIDE, guide)
  console.log('✓ Wrote User Guide')
  console.log(`  ${path.relative(process.cwd(), GUIDE)}`)
}

main()
