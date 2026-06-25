// screenshots.mjs — capture deterministic UI screenshots for the docs.
//
// The Tauri app renders the same React UI that Vite serves in a browser, so
// we drive it headless with Playwright instead of grabbing the native window
// (which would be non-reproducible: OS chrome, cursor, fonts, scaling).
//
// PREREQUISITE: the full dev stack must be running, because the app gates on
// the backend being reachable (see App.jsx / useBackendReady). The simplest
// way is:
//
//     npm run tauri:dev      # starts backend.exe + Vite on :1420
//
// ...then, in another terminal:
//
//     npm run shots
//
// Output: PNGs in desktop/docs/screenshots/, referenced by the generated
// README (see generate-readme.mjs).
//
// First-time setup:
//     npm install            # installs the `playwright` devDependency
//     npx playwright install chromium

import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT_DIR = path.resolve(__dirname, '../docs/screenshots')
const APP_URL = process.env.APP_URL || 'http://localhost:1420'
const VIEWPORT = { width: 1280, height: 800 }
// Force English so the nav labels we click on are stable regardless of the
// machine's locale. i18next's LanguageDetector reads this localStorage key.
const FORCE_LANG = 'en'

// Each shot: the accessible name of the sidebar button to click, and the
// output file name. Labels are the English nav strings (FORCE_LANG above).
// Panels that depend on a live Tauri command (e.g. the Code terminal) still
// render their shell here; anything truly native is simply not exercised.
// `subtabs` capture each mode of a media panel's ModeTabBar. The first
// entry is the panel's default mode, so it keeps the bare panel name
// (image.png, video.png, ...) that the README embeds; the rest get
// descriptive names. `tab` is the button label clicked inside <main>.
// `manual: true` marks a hand-curated screenshot (e.g. a real chat with a
// reasoning block + reply) that a clean automated run can't reproduce. The
// script never overwrites these — drop the curated PNG in docs/screenshots/
// and it survives `npm run docs`.
const SHOTS = [
  { nav: 'Chat', name: 'chat', manual: true },
  { nav: 'Code', name: 'coding' },
  {
    nav: 'Image',
    subtabs: [
      { tab: 'Text to image', name: 'image' },
      { tab: 'Image to image', name: 'image-i2i' },
    ],
  },
  {
    nav: 'Video',
    subtabs: [
      { tab: 'Text', name: 'video' },
      { tab: 'Image', name: 'video-image' },
      { tab: 'Frames', name: 'video-frames' },
      { tab: 'Subject', name: 'video-subject' },
    ],
  },
  {
    nav: 'Music',
    subtabs: [
      { tab: 'Compose', name: 'music' },
      { tab: 'Cover', name: 'music-cover' },
      { tab: 'Lyrics', name: 'music-lyrics' },
    ],
  },
  {
    nav: 'Speech',
    subtabs: [
      { tab: 'Synthesize', name: 'speech' },
      { tab: 'Clone', name: 'speech-clone' },
      { tab: 'Design', name: 'speech-design' },
      { tab: 'Voices', name: 'speech-voices' },
    ],
  },
  { nav: 'Tasks', name: 'tasks' },
  { nav: 'Help', name: 'help' },
  { nav: 'Settings', name: 'settings' },
]

async function run() {
  await mkdir(OUT_DIR, { recursive: true })

  const browser = await chromium.launch()
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2, // crisp 2x screenshots for README/retina
  })
  const page = await context.newPage()

  // Collect browser-side diagnostics so a failed run can explain itself.
  const consoleErrors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`))

  // Seed localStorage before the app boots: force English (stable nav
  // labels) and mark the first-launch onboarding tour + agent-context
  // wizard as already seen, so neither overlay covers the screenshots.
  await page.addInitScript((lang) => {
    try {
      localStorage.setItem('i18nextLng', lang)
      localStorage.setItem('minimax-onboarding-seen', 'true')
      localStorage.setItem('agent-context-wizard-seen', 'true')
    } catch {}
  }, FORCE_LANG)

  console.log(`→ opening ${APP_URL}`)
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' })

  // Wait for the real app shell (backend ready) rather than the loader.
  // The sidebar's Chat button only exists once <AppShell /> mounts.
  // `exact` + `.first()` avoids a strict-mode match against other "Chat"
  // controls (e.g. the panel's "New Chat" button).
  try {
    await page.getByRole('button', { name: 'Chat', exact: true }).first().waitFor({ timeout: 45000 })
  } catch {
    // Diagnose: does the Vite proxy actually reach the backend from this
    // browser context? This is the same /api/config call the app gates on.
    let apiStatus
    try {
      apiStatus = await page.evaluate(async () => {
        try {
          const r = await fetch('/api/config')
          return `${r.status} ${r.statusText}`
        } catch (e) {
          return `FETCH FAILED: ${e}`
        }
      })
    } catch (e) {
      apiStatus = `evaluate failed: ${e}`
    }

    const bodyText = (await page.evaluate(() => document.body?.innerText || '')).slice(0, 600)
    const debugShot = path.join(OUT_DIR, 'debug.png')
    await page.screenshot({ path: debugShot, fullPage: true })

    console.error('\n✗ App shell never appeared. Diagnostics:')
    console.error(`  GET /api/config (via Vite proxy) → ${apiStatus}`)
    console.error(`  page title: ${await page.title()}`)
    console.error(`  visible text:\n    ${bodyText.replace(/\n/g, '\n    ')}`)
    if (consoleErrors.length) {
      console.error(`  console errors (${consoleErrors.length}):`)
      for (const e of consoleErrors.slice(0, 15)) console.error(`    • ${e}`)
    } else {
      console.error('  console errors: none')
    }
    console.error(`  saved screenshot of current state → ${path.relative(process.cwd(), debugShot)}`)
    console.error(
      '\n  If /api/config is not 200, the backend (or the Vite proxy) is not\n' +
      '  reachable from the browser. Make sure `npm run tauri:dev` is running\n' +
      '  and its backend bound :8765.'
    )
    await browser.close()
    process.exit(1)
  }

  // Scope nav clicks to the main sidebar (first <aside>) and match by
  // substring, so labels with a trailing badge (e.g. "Code AGENT") and
  // ambiguous words (e.g. "Chat") still resolve to the right rail button.
  const sidebar = page.locator('aside').first()
  // Mode tabs live inside the panel content area, not the sidebar.
  const content = page.locator('main').first()

  const capture = async (name) => {
    const file = path.join(OUT_DIR, `${name}.png`)
    await page.screenshot({ path: file })
    console.log(`  ✓ ${path.relative(process.cwd(), file)}`)
  }

  for (const shot of SHOTS) {
    // Hand-curated shots are never regenerated/overwritten.
    if (shot.manual) {
      console.log(`  • ${shot.name}.png — manual, preserved (not captured)`)
      continue
    }
    const btn = sidebar.getByRole('button', { name: shot.nav }).first()
    if (await btn.count()) {
      await btn.click()
    } else {
      console.warn(`  ! nav "${shot.nav}" not found — capturing current view`)
    }
    // Let panel content settle (data fetches, transitions).
    await page.waitForTimeout(700)

    const tabs = shot.subtabs || [{ name: shot.name }]
    for (const t of tabs) {
      if (t.tab) {
        const tabBtn = content.getByRole('button', { name: t.tab }).first()
        if (await tabBtn.count()) {
          await tabBtn.click()
          await page.waitForTimeout(600)
        } else {
          console.warn(`  ! sub-tab "${t.tab}" not found in ${shot.nav}`)
        }
      }
      await capture(t.name)
    }
  }

  await browser.close()
  console.log(`Done. ${SHOTS.length} screenshots in ${path.relative(process.cwd(), OUT_DIR)}/`)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
