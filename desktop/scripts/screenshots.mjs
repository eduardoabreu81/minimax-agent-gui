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
const SHOTS = [
  { nav: 'Chat', name: 'chat' },
  { nav: 'Code', name: 'coding' },
  { nav: 'Image', name: 'image' },
  { nav: 'Video', name: 'video' },
  { nav: 'Music', name: 'music' },
  { nav: 'Speech', name: 'speech' },
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

  // Seed locale before the app boots so detection picks it up.
  await page.addInitScript((lang) => {
    try { localStorage.setItem('i18nextLng', lang) } catch {}
  }, FORCE_LANG)

  console.log(`→ opening ${APP_URL}`)
  await page.goto(APP_URL, { waitUntil: 'networkidle' })

  // Wait for the real app shell (backend ready) rather than the loader.
  // The sidebar's Chat button only exists once <AppShell /> mounts.
  try {
    await page.getByRole('button', { name: 'Chat' }).waitFor({ timeout: 30000 })
  } catch {
    console.error(
      '✗ App shell never appeared. Is the backend running? ' +
      'Start the full stack with `npm run tauri:dev` first.'
    )
    await browser.close()
    process.exit(1)
  }

  for (const shot of SHOTS) {
    const btn = page.getByRole('button', { name: shot.nav, exact: true }).first()
    if (await btn.count()) {
      await btn.click()
    } else {
      console.warn(`  ! nav "${shot.nav}" not found — capturing current view`)
    }
    // Let panel content settle (data fetches, transitions).
    await page.waitForTimeout(700)
    const file = path.join(OUT_DIR, `${shot.name}.png`)
    await page.screenshot({ path: file })
    console.log(`  ✓ ${path.relative(process.cwd(), file)}`)
  }

  await browser.close()
  console.log(`Done. ${SHOTS.length} screenshots in ${path.relative(process.cwd(), OUT_DIR)}/`)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
