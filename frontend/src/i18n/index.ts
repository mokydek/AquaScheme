import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { ru } from './locales/ru'
import { kk } from './locales/kk'
import { en } from './locales/en'

const STORAGE_KEY = 'aquascheme.lang'

export const LANGUAGES = [
  { code: 'ru', label: 'RU' },
  { code: 'kk', label: 'KZ' },
  { code: 'en', label: 'EN' },
] as const

const saved = localStorage.getItem(STORAGE_KEY)
const initialLang = LANGUAGES.some((l) => l.code === saved) ? (saved as string) : 'ru'

void i18n.use(initReactI18next).init({
  resources: { ru, kk, en },
  lng: initialLang,
  fallbackLng: 'ru',
  interpolation: {
    escapeValue: false,
  },
})

i18n.on('languageChanged', (lng) => {
  localStorage.setItem(STORAGE_KEY, lng)
  document.documentElement.lang = lng
})

document.documentElement.lang = initialLang

export default i18n
