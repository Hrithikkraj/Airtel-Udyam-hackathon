import { ArrowLeft } from 'lucide-react'
import { useLanguage } from './i18n'
import type { NavItem } from './navigation'
import TopBar from './TopBar'
import { cx } from './ui/cx'

type Props = {
  title: string
  intro: string
  isCompact?: boolean // Inner pages get a smaller title, so their content starts higher on a phone.
  onBack?: () => void
  account?: { label: string; onClick: () => void }
  navItems?: NavItem[]
  onHome?: () => void
  wide?: boolean // Lines the title up with pages that use a wider grid, such as the rate list.
}

// The top bar, then the page's own title: a large, friendly heading with one line of help under it.
export default function PageHeader({ title, intro, isCompact = false, onBack, account, navItems, onHome, wide = false }: Props) {
  const { t } = useLanguage()
  return (
    <>
      <TopBar account={account} navItems={navItems} onHome={onHome} />
      <div className={cx('mx-auto w-full px-4 pt-5 md:px-6 md:pt-8', wide ? 'max-w-5xl' : 'max-w-3xl')}>
        {onBack && (
          <button
            type="button"
            className="-ml-3 mb-1 inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-small font-semibold text-ink-700 transition-colors hover:bg-white hover:text-ink-900"
            onClick={onBack}
          >
            <ArrowLeft aria-hidden="true" size={18} strokeWidth={2.25} />
            {t('Back')}
          </button>
        )}
        <h1 className={cx('font-extrabold text-ink-900', isCompact ? 'text-title-1 md:text-[1.75rem] md:leading-9' : 'text-[1.75rem] leading-9 md:text-display')}>
          {t(title)}
        </h1>
        <p className="mt-1.5 max-w-[60ch] text-ink-500">{t(intro)}</p>
      </div>
    </>
  )
}
