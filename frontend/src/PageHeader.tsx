import { useLanguage } from './i18n'

type Props = {
  title: string
  intro: string
  isCompact?: boolean // Kept for callers. Every page now uses the same calm layout.
  onBack?: () => void
  account?: { label: string; onClick: () => void }
}

// A slim white bar with the brand, account and language, then the page's own title.
export default function PageHeader({ title, intro, onBack, account }: Props) {
  const { language, setLanguage, t } = useLanguage()
  return (
    <>
      <header className="border-b border-rule bg-white">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-4 px-4">
          <p className="flex items-center gap-2 font-semibold">
            <span aria-hidden="true" className="flex size-7 items-center justify-center rounded-md bg-accent text-sm font-bold text-white">
              A
            </span>
            Accel Business
          </p>
          <div className="flex items-center gap-1">
            {account && (
              <button
                type="button"
                className="flex max-w-[10rem] items-center gap-2 rounded-lg px-2 py-1.5 font-medium hover:bg-paper"
                onClick={account.onClick}
              >
                <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent">
                  {account.label.charAt(0).toUpperCase()}
                </span>
                <span className="truncate">{account.label}</span>
              </button>
            )}
            <button
              type="button"
              lang={language === 'hi' ? 'en' : 'hi'}
              className="rounded-lg px-2 py-1.5 font-medium text-accent hover:bg-paper"
              onClick={() => setLanguage(language === 'hi' ? 'en' : 'hi')}
            >
              {language === 'hi' ? 'English' : 'हिन्दी'}
            </button>
          </div>
        </div>
      </header>
      <div className="mx-auto w-full max-w-3xl px-4 pt-5">
        {onBack && (
          <button type="button" className="-ml-2 mb-2 flex items-center gap-1 rounded-lg px-2 py-1 font-medium text-accent hover:bg-white" onClick={onBack}>
            <span aria-hidden="true">←</span>
            {t('Back')}
          </button>
        )}
        <h1 className="font-display text-3xl leading-tight font-semibold sm:text-4xl">{t(title)}</h1>
        <p className="mt-1 max-w-[60ch] text-muted">{t(intro)}</p>
      </div>
    </>
  )
}
