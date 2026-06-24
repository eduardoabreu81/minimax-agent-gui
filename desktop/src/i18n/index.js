import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import en from './en.json'
import ptBR from './pt-BR.json'
import ja from './ja.json'
import ko from './ko.json'
import es from './es.json'
import zhCN from './zh-CN.json'

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      'pt-BR': { translation: ptBR },
      ja: { translation: ja },
      ko: { translation: ko },
      es: { translation: es },
      'zh-CN': { translation: zhCN },
    },
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
      // i18next 23+ changed the default placeholder syntax from `{name}`
      // to `{{name}}` (mustache-style). Our translation files still use
      // single-curly, so without these overrides every interpolated
      // value renders literally as `{count}` etc. — see TaskBoard's
      // stats bar and the music/image char counters. Pin back to v3-style
      // delimiters so the existing locale JSON keeps working.
      prefix: '{',
      suffix: '}',
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
  })

export default i18n
