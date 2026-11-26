import { useLanguage } from './i18n'
import type { NavItem } from './navigation'
import Avatar from './ui/Avatar'
import { cx } from './ui/cx'
import Logo, { LogoMark } from './ui/Logo'
import SegmentedControl from './ui/SegmentedControl'
import { useToast } from './ui/useToast'

type Props = {
  account?: { label: string; onClick: () => void }
  navItems?: NavItem[]
  onHome?: () => void
}

/**
 * The bar across the top: our logo, the main navigation on a computer, the language switch and the
 * account. Frosted glass, so the page is still felt underneath it while scrolling.
 */
export default function TopBar({ account, navItems, onHome }: Props) {
  const { language, setLanguage, t } = useLanguage()
  const toast = useToast()

  function select(item: NavItem) {
    if (item.isAvailable) item.onSelect()
    else if (item.unavailableMessage) toast({ tone: 'info', message: item.unavailableMessage })
  }

  return (
    <header className="glass sticky top-0 z-40 border-b border-ink-200/70 pt-safe">
      <div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-4 md:px-6">
        {onHome ? (
          <button type="button" aria-label={t('Accel Business home')} className="-ml-1 flex min-h-11 items-center rounded-control px-1" onClick={onHome}>
            <Logo className="hidden sm:inline-flex" />
            <LogoMark className="sm:hidden" />
          </button>
        ) : (
          <Logo />
        )}

        {navItems && (
          <nav aria-label={t('Main navigation')} className="ml-4 hidden md:block">
            <ul className="flex items-center gap-1">
              {navItems.map((item) => (
                <li key={item.key}>
                  <button
                    type="button"
                    aria-current={item.isActive ? 'page' : undefined}
                    aria-disabled={!item.isAvailable || undefined}
                    onClick={() => select(item)}
                    className={cx(
                      'flex min-h-11 items-center gap-2 rounded-full px-3.5 text-small font-semibold transition-colors duration-200',
                      item.isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900',
                      !item.isAvailable && 'opacity-45',
                    )}
                  >
                    <item.icon aria-hidden="true" size={18} strokeWidth={item.isActive ? 2.4 : 1.9} />
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        )}

        <div className="ml-auto flex items-center gap-2">
          <SegmentedControl
            label={t('Language')}
            size="sm"
            value={language}
            onChange={setLanguage}
            options={[
              { value: 'en', label: 'EN', lang: 'en' },
              { value: 'hi', label: 'हिन्दी', lang: 'hi' },
            ]}
          />
          {account && (
            <button
              type="button"
              onClick={account.onClick}
              aria-label={`${t('Your profile')}: ${account.label}`}
              className="hidden min-h-11 items-center gap-2 rounded-full py-1 pr-3 pl-1 font-semibold hover:bg-ink-100 md:flex"
            >
              <Avatar name={account.label} size="sm" />
              <span className="max-w-[8rem] truncate text-small">{account.label}</span>
            </button>
          )}
        </div>
      </div>
    </header>
  )
}
