import { useState, type ReactNode } from 'react'
import { HINDI, LanguageContext, type LanguageCode } from './i18n'

const STORAGE_KEY = 'accel-language'

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<LanguageCode>(() => (localStorage.getItem(STORAGE_KEY) === 'hi' ? 'hi' : 'en'))

  function setLanguage(newLanguage: LanguageCode) {
    localStorage.setItem(STORAGE_KEY, newLanguage)
    setLanguageState(newLanguage)
    document.documentElement.lang = newLanguage
  }

  const t = (text: string) => (language === 'hi' ? (HINDI[text] ?? text) : text)
  const languageName = language === 'hi' ? 'Hindi' : 'English'
  return <LanguageContext.Provider value={{ language, languageName, setLanguage, t }}>{children}</LanguageContext.Provider>
}
