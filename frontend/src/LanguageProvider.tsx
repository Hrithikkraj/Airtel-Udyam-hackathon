import { useState, type ReactNode } from 'react'
import { HINDI, LanguageContext, type LanguageCode } from './i18n'
import { readLanguage, saveLanguage } from './storage'

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<LanguageCode>(() => {
    const saved = readLanguage()
    // Screen readers and the Hindi line spacing both read this, so it must match from the first paint.
    document.documentElement.lang = saved
    return saved
  })

  function setLanguage(newLanguage: LanguageCode) {
    saveLanguage(newLanguage)
    setLanguageState(newLanguage)
    document.documentElement.lang = newLanguage
  }

  const t = (text: string) => (language === 'hi' ? (HINDI[text] ?? text) : text)
  const languageName = language === 'hi' ? 'Hindi' : 'English'
  return <LanguageContext.Provider value={{ language, languageName, setLanguage, t }}>{children}</LanguageContext.Provider>
}
