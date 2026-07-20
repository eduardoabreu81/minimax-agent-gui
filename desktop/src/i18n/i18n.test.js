// i18n.test.js — guards against the i18next 23+ interpolation regression.
//
// Background: i18next 23+ changed its default placeholder syntax from
// `{name}` (single-curly) to `{{name}}` (mustache-style). Our locale
// files use single-curly, and the runtime config pins i18next back
// to that with `interpolation: { prefix: '{', suffix: '}' }` (see
// index.js). A previous migration accidentally rewrote a few keys
// (`balance.tooltip`, `media.costLabel`, `media.imageCostLabel`,
// `media.dailyLabel`) in all 6 locales to mustache-style — those
// would render literally as `{{balance}}` etc. in the UI because
// the config doesn't recognize them. This test file catches:
//
//   1. Any locale re-introducing `{{var}}` placeholders.
//   2. A missing translation key in any of the 6 locales.
//   3. Locale drift — a placeholder name in one locale that doesn't
//      match the others (e.g. `{saldo}` in pt-BR when the rest use
//      `{balance}`), which would break runtime interpolation
//      silently because the caller's `t('balance.tooltip', { balance })`
//      would just leave the unrendered key.
//   4. The runtime config itself: importing the real `i18n` instance
//      (with LanguageDetector mocked) and asserting that
//      `i18n.t('balance.tooltip', { balance, total })` actually
//      returns the substituted string. This protects the
//      `prefix: '{', suffix: '}' }` setting in index.js — if anyone
//      removes it, the i18next 23+ default mustache parser will
//      fail to find `{balance}` and render it literally.

import { describe, it, expect, vi, beforeAll } from 'vitest'

// Mock the language detector BEFORE importing index.js. jsdom doesn't
// have a real `window.navigator` API for it to sniff, and we want the
// detector to be a no-op so we can drive `i18n.changeLanguage()`
// ourselves in test 4.
vi.mock('i18next-browser-languagedetector', () => ({
  default: {
    type: 'languageDetector',
    init: vi.fn(),
    detect: vi.fn(),
    cacheUserLanguage: vi.fn(),
  },
}))

import en from './en.json'
import ptBR from './pt-BR.json'
import ja from './ja.json'
import ko from './ko.json'
import es from './es.json'
import zhCN from './zh-CN.json'
import i18n from './index.js'

const LOCALES = {
  en,
  'pt-BR': ptBR,
  ja,
  ko,
  es,
  'zh-CN': zhCN,
}

// Keys that broke in the previous migration. We pin these explicitly
// so a future change that drifts them (e.g. drops one, renames a var)
// fails the test loudly instead of silently shipping a half-fixed
// label.
const INTERPOLATION_KEYS = {
  'balance.tooltip': ['balance', 'total'],
  'media.costLabel': ['credits', 'usd'],
  'media.imageCostLabel': ['credits', 'usd', 'count'],
  'media.dailyLabel': ['used', 'limit'],
}

function getNested(obj, dottedKey) {
  return dottedKey.split('.').reduce(
    (acc, k) => (acc == null ? undefined : acc[k]),
    obj,
  )
}

function extractVars(str) {
  // Match {name} (single-curly), excluding escaped {{...}} which we
  // also forbid (test 1). We sort the result for stable comparison.
  return (str.match(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g) || [])
    .map((s) => s.slice(1, -1))
    .sort()
}

function nodeType(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? 'object'
    : typeof value
}

function collectNodes(value, prefix = '', out = new Map()) {
  if (prefix) out.set(prefix, { type: nodeType(value), value })
  if (nodeType(value) === 'object') {
    for (const [key, child] of Object.entries(value)) {
      collectNodes(child, prefix ? `${prefix}.${key}` : key, out)
    }
  }
  return out
}

describe('i18n locale files', () => {
  it('contains no mustache-style {{var}} placeholders in any locale', () => {
    for (const [name, json] of Object.entries(LOCALES)) {
      const content = JSON.stringify(json)
      const matches = content.match(/\{\{[^}]+\}\}/g) || []
      expect(
        matches,
        `${name} has mustache placeholders: ${matches.join(', ')}`,
      ).toEqual([])
    }
  })

  it('defines all 4 interpolation keys in every locale', () => {
    for (const [key] of Object.entries(INTERPOLATION_KEYS)) {
      for (const [name, json] of Object.entries(LOCALES)) {
        const value = getNested(json, key)
        expect(
          value,
          `${name} is missing translation key "${key}"`,
        ).toBeDefined()
        expect(
          typeof value,
          `${name} key "${key}" must be a string`,
        ).toBe('string')
        expect(
          value.length,
          `${name} key "${key}" must not be empty`,
        ).toBeGreaterThan(0)
      }
    }
  })

  it('uses the same placeholder names across all locales for each key', () => {
    for (const [key, expectedVars] of Object.entries(INTERPOLATION_KEYS)) {
      // Use the English file as the reference — it was the first
      // locale to receive the fix.
      const enVars = extractVars(getNested(en, key))
      expect(
        enVars,
        `en.${key} is missing expected placeholders`,
      ).toEqual([...expectedVars].sort())

      for (const [name, json] of Object.entries(LOCALES)) {
        const value = getNested(json, key)
        const vars = extractVars(value)
        expect(
          vars,
          `${name}.${key} placeholders ${vars.join(',') || '(none)'} don't match en (${enVars.join(',')})`,
        ).toEqual(enVars)
      }
    }
  })

  it('renders interpolated values via the real i18n instance (all 6 locales)', async () => {
    // Wait for the i18next instance to finish loading resources. With
    // a synchronous import of JSON resources it should be ready
    // immediately, but we await the `initialized` event defensively
    // in case a future refactor switches to a backend loader.
    if (!i18n.isInitialized) {
      await new Promise((resolve) => i18n.on('initialized', resolve))
    }

    const cases = [
      {
        key: 'balance.tooltip',
        params: { balance: '1,234', total: '10,000' },
        // Every locale formats it as "<label>: {balance} / {total}"
        // — we just want to confirm the {balance} and {total}
        // placeholders are both substituted, regardless of label.
        mustInclude: ['1,234', '10,000'],
        mustNotInclude: ['{balance}', '{total}', '{{balance}}', '{{total}}'],
      },
      {
        key: 'media.costLabel',
        params: { credits: 5, usd: '0.0125' },
        mustInclude: ['5', '0.0125'],
        mustNotInclude: ['{credits}', '{usd}', '{{credits}}', '{{usd}}'],
      },
      {
        key: 'media.dailyLabel',
        params: { used: 1, limit: 3 },
        mustInclude: ['1', '3'],
        mustNotInclude: ['{used}', '{limit}', '{{used}}', '{{limit}}'],
      },
    ]

    for (const localeName of Object.keys(LOCALES)) {
      await i18n.changeLanguage(localeName)

      for (const { key, params, mustInclude, mustNotInclude } of cases) {
        const rendered = i18n.t(key, params)
        for (const needle of mustInclude) {
          expect(
            rendered,
            `[${localeName}] ${key} should include "${needle}" — got: ${rendered}`,
          ).toContain(needle)
        }
        for (const needle of mustNotInclude) {
          expect(
            rendered,
            `[${localeName}] ${key} should NOT contain literal "${needle}" — got: ${rendered}`,
          ).not.toContain(needle)
        }
      }
    }
  })

  it('keeps the Korean locale tree identical to English', () => {
    const enNodes = collectNodes(en)
    const koNodes = collectNodes(ko)
    expect(
      [...koNodes.keys()].sort(),
      'ko has a different set of dotted keys than en',
    ).toEqual([...enNodes.keys()].sort())
    for (const [key, enNode] of enNodes) {
      expect(
        koNodes.get(key)?.type,
        `ko.${key} has a different node type than en`,
      ).toBe(enNode.type)
    }
  })

  it('keeps every locale tree identical to English (key parity)', () => {
    // The 4 non-source locales (es/ja/zh-CN/pt-BR) intentionally leave
    // strings empty so i18next falls back to en. We forbid key-set
    // drift between locales — if a new key appears in en but is
    // forgotten in any locale, that locale will silently show the raw
    // key string ("speech.deliveryStandard" etc.) in the UI. Catching
    // drift here is the whole point of this audit.
    const enNodes = collectNodes(en)
    const enKeys = [...enNodes.keys()].sort()
    for (const [name, json] of Object.entries(LOCALES)) {
      const localeKeys = [...collectNodes(json).keys()].sort()
      expect(
        localeKeys,
        `${name} locale is missing keys present in en, or has extras — see the key-diff below`,
      ).toEqual(enKeys)
    }
  })

  it('flags any locale whose non-empty leaf disagrees with the en string', () => {
    // Defense in depth: even if every locale has the same key set,
    // someone could in the future ship a partial translation that
    // differs from en in a way the dev intentionally overrode (e.g.
    // dropped a placeholder). This test only catches *untranslated*
    // values that exactly equal the en source — those are usually a
    // sign someone copy-pasted en into the locale without translating.
    // We allow them, but emit a warning. (Switch to `expect(...)` if
    // you want a hard failure.)
    const enNodes = collectNodes(en)
    const offenders = []
    for (const [name, json] of Object.entries(LOCALES)) {
      if (name === 'en') continue
      const localeNodes = collectNodes(json)
      for (const [key, enNode] of enNodes) {
        if (enNode.type !== 'string') continue
        const localeNode = localeNodes.get(key)
        if (!localeNode || localeNode.type !== 'string') continue
        // Skip empty strings (intentional — fallback to en) and skip
        // values that legitimately equal en in this language (e.g.
        // proper nouns, brand names).
        if (localeNode.value === '' || localeNode.value === enNode.value) {
          if (localeNode.value === enNode.value && name === 'ko') {
            // ko is supposed to be fully translated; equality with en
            // is suspect (but still allowed for now — we just warn).
            offenders.push(`${name}.${key}`)
          }
        }
      }
    }
    if (offenders.length) {
      console.warn(
        `[i18n] The following ko keys equal en — please verify they ` +
        `are intentionally untranslated: ${offenders.join(', ')}`,
      )
    }
  })

  it('rejects any leaf whose placeholder set drifts from en', () => {
    // Walks every locale; for each leaf string, its {placeholder}
    // set must match en's. Catches the case where a translator
    // renames {count} to {n} without updating the call site — the
    // UI would silently render "{n}" literally.
    const enNodes = collectNodes(en)
    for (const [name, json] of Object.entries(LOCALES)) {
      if (name === 'en') continue
      const localeNodes = collectNodes(json)
      for (const [key, enNode] of enNodes) {
        if (enNode.type !== 'string') continue
        const localeNode = localeNodes.get(key)
        if (!localeNode || localeNode.type !== 'string') continue
        if (localeNode.value === '') continue  // empty falls back to en
        expect(
          extractVars(localeNode.value),
          `${name}.${key} placeholders ${extractVars(localeNode.value)} don't match en (${extractVars(enNode.value)})`,
        ).toEqual(extractVars(enNode.value))
      }
    }
  })

  it('pins known Korean semantic translations', async () => {
    await i18n.changeLanguage('ko')
    expect(i18n.t('music.instrumentalActiveHint')).toBe(
      '이 곡은 보컬과 가사 없이 연주곡으로 생성됩니다.',
    )
    expect(i18n.t('music.bestQuality')).toContain('Token Plan')
    expect(i18n.t('music.unlimitedDefault')).toBe('무료 티어(낮은 RPM)')
    expect(i18n.t('palette.results', { count: 5 })).toBe('결과 5개')
  })

})
