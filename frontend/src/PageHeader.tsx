import { useLanguage } from './i18n'

// The marigold band at the top of every page, with the language switch.
export default function PageHeader({ title, intro }: { title: string; intro: string }) {
  const { language, setLanguage, t } = useLanguage()
  return (
    <header className="bg-marigold">
      <div className="mx-auto max-w-3xl px-4 pt-5 pb-7">
        <div className="flex items-center justify-between gap-4">
          <p className="font-semibold">Accel Business</p>
          <button
            type="button"
            lang={language === 'hi' ? 'en' : 'hi'}
            className="font-semibold underline underline-offset-4"
            onClick={() => setLanguage(language === 'hi' ? 'en' : 'hi')}
          >
            {language === 'hi' ? 'English' : 'हिन्दी'}
          </button>
        </div>
        <h1 className="mt-5 font-display text-4xl leading-none font-bold sm:text-6xl">{t(title)}</h1>
        <p className="mt-3 max-w-[52ch] text-lg leading-snug">{t(intro)}</p>
      </div>
    </header>
  )
}
