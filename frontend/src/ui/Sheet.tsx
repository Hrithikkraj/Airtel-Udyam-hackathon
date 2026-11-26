import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, m } from 'motion/react'
import { X } from 'lucide-react'
import { useLanguage } from '../i18n'
import { cx } from './cx'
import IconButton from './IconButton'
import { DURATION, EASE_IN, EASE_OUT } from './motionTokens'
import { DESKTOP_QUERY, useMediaQuery } from './useMediaQuery'

type Props = {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode // Stays visible at the bottom while the content scrolls, such as the main action.
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * A panel that slides over the page: up from the bottom on a phone (easy to reach with a thumb),
 * in from the right on a computer. While it is open, keyboard focus stays inside it, Escape or
 * tapping the dark backdrop closes it, and focus returns to whatever opened it.
 */
export default function Sheet(props: Props) {
  return createPortal(<AnimatePresence>{props.open && <SheetPanel {...props} />}</AnimatePresence>, document.body)
}

function SheetPanel({ onClose, title, description, children, footer }: Props) {
  const { t } = useLanguage()
  const isDesktop = useMediaQuery(DESKTOP_QUERY)
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const page = document.body.style.overflow
    document.body.style.overflow = 'hidden' // The page behind does not scroll while the sheet is open.
    panelRef.current?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !panelRef.current) return
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = page
      opener?.focus?.()
    }
  }, [])

  const hidden = isDesktop ? { x: '100%' } : { y: '100%' }
  const shown = isDesktop ? { x: 0 } : { y: 0 }

  return (
    <div className="fixed inset-0 z-50">
      <m.div
        aria-hidden="true"
        className="absolute inset-0 bg-ink-900/45"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, transition: { duration: DURATION.base, ease: EASE_IN } }}
        onClick={onClose}
      />
      <m.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        initial={hidden}
        animate={shown}
        exit={{ ...hidden, transition: { duration: DURATION.base, ease: EASE_IN } }}
        transition={{ duration: DURATION.slow, ease: EASE_OUT }}
        className={cx(
          'sheet absolute flex flex-col outline-none',
          isDesktop
            ? 'inset-y-0 right-0 w-full max-w-md'
            : 'inset-x-0 bottom-0 max-h-[88dvh] rounded-t-sheet',
        )}
      >
        {!isDesktop && <span aria-hidden="true" className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-ink-200" />}
        <div className="flex shrink-0 items-start gap-3 px-5 pt-4 pb-3">
          <div className="min-w-0 flex-1 pt-1.5">
            <h2 id={titleId} className="text-title-2 font-bold break-words">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="mt-1 text-small text-ink-500">
                {description}
              </p>
            )}
          </div>
          <IconButton label={t('Close')} onClick={onClose} className="-mr-2 bg-ink-100">
            <X size={20} />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">{children}</div>
        {footer && <div className="shrink-0 border-t border-ink-200 px-5 pt-3 pb-safe">{footer}</div>}
      </m.div>
    </div>
  )
}
