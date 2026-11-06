import { useLanguage } from './i18n'

type Props = {
  title: string
  intro: string
  isCompact?: boolean // Inner pages use a smaller band, so the content starts higher on a phone.
  onBack?: () => void
  account?: { label: string; onClick: () => void }
}

// The marigold band at the top of every page, with the back button and the language switch.
export default function PageHeader({ title, intro, isCompact = false, onBack, account }: Props) {
  const { language, setLanguage, t } = useLanguage()
  return (
    <header className="bg-marigold">
      <div className={`mx-auto max-w-3xl px-4 ${isCompact ? 'pt-3 pb-4' : 'pt-5 pb-7'}`}>
        <div className="flex min-h-10 items-center justify-between gap-4">
          {onBack ? (
            <button
              type="button"
              className="-ml-2 flex items-center gap-1 px-2 py-1.5 font-semibold hover:bg-ink/10"
              onClick={onBack}
            >
              <span aria-hidden="true" className="text-xl leading-none">←</span>
              {t('Back')}
            </button>
          ) : (
            <p className="font-semibold">Accel Business</p>
          )}
          <div className="flex items-center gap-1">
          {account && (
            <button type="button" className="max-w-[10rem] truncate px-2 py-1.5 font-semibold underline underline-offset-4 hover:bg-ink/10" onClick={account.onClick}>
              {account.label}
            </button>
          )}
          <button
            type="button"
            lang={language === 'hi' ? 'en' : 'hi'}
            className="px-2 py-1.5 font-semibold underline underline-offset-4 hover:bg-ink/10"
            onClick={() => setLanguage(language === 'hi' ? 'en' : 'hi')}
          >
            {language === 'hi' ? 'English' : 'हिन्दी'}
          </button>
          </div>
        </div>
        <h1
          className={`font-display leading-none font-bold ${isCompact ? 'mt-2 text-3xl sm:text-4xl' : 'mt-5 text-4xl sm:text-6xl'}`}
        >
          {t(title)}
        </h1>
        <p className={`max-w-[52ch] leading-snug ${isCompact ? 'mt-1' : 'mt-3 text-lg'}`}>{t(intro)}</p>
      </div>
    </header>
  )
}
