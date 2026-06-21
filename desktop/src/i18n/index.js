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
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
  })

export default i18n
