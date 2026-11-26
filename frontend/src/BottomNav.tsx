import { m } from 'motion/react'
import { useLanguage } from './i18n'
import type { NavItem } from './navigation'
import { cx } from './ui/cx'
import { SPRING } from './ui/motionTokens'
import { useToast } from './ui/useToast'

/**
 * The floating bar at the bottom of a phone screen, where a thumb can reach it. A soft pill slides
 * to the active tab. Hidden on computers, which use the links in the top bar instead.
 */
export default function BottomNav({ items }: { items: NavItem[] }) {
  const { t } = useLanguage()
  const toast = useToast()
  const activeIndex = items.findIndex((item) => item.isActive)

  function select(item: NavItem) {
    if (item.isAvailable) item.onSelect()
    else if (item.unavailableMessage) toast({ tone: 'info', message: item.unavailableMessage })
  }

  return (
    <nav
      aria-label={t('Main navigation')}
      className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 md:hidden"
    >
      <ul
        className="glass relative grid rounded-[1.75rem] p-1.5 shadow-e3 ring-1 ring-ink-200/70"
        style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      >
        <m.span
          aria-hidden="true"
          className="absolute top-1.5 bottom-1.5 left-1.5 rounded-[1.375rem] bg-brand-50"
          style={{ width: `calc((100% - 0.75rem) / ${items.length})` }}
          initial={false}
          animate={{ x: `${Math.max(activeIndex, 0) * 100}%`, opacity: activeIndex === -1 ? 0 : 1 }}
          transition={SPRING}
        />
        {items.map((item) => (
          <li key={item.key} className="relative">
            <button
              type="button"
              aria-current={item.isActive ? 'page' : undefined}
              aria-disabled={!item.isAvailable || undefined}
              onClick={() => select(item)}
              className={cx(
                'flex min-h-14 w-full flex-col items-center justify-center gap-0.5 rounded-[1.375rem] px-1 transition-colors duration-200',
                item.isActive ? 'text-brand-700' : 'text-ink-600',
                !item.isAvailable && 'opacity-45',
              )}
            >
              <item.icon aria-hidden="true" size={22} strokeWidth={item.isActive ? 2.4 : 1.9} />
              {/* Labels may wrap rather than be cut off, which matters for longer Hindi words. */}
              <span className={cx('max-w-full text-center text-xs leading-tight break-words', item.isActive ? 'font-bold' : 'font-semibold')}>
                {item.label}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
