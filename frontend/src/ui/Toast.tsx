import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, m } from 'motion/react'
import { CircleCheck, CircleExclamationPoint, Info, X } from 'lucide-react'
import { useLanguage } from '../i18n'
import { cx } from './cx'
import { DURATION, EASE_IN, SPRING } from './motionTokens'
import { ToastContext, type ToastInput, type ToastItem } from './toastContext'

const SHOW_FOR_MS = 4500
const MAX_SHOWN = 3

const LOOK = {
  success: { icon: CircleCheck, iconClass: 'text-success-500' },
  error: { icon: CircleExclamationPoint, iconClass: 'text-danger-400' },
  info: { icon: Info, iconClass: 'text-info-300' },
}

/**
 * Short messages that appear above the bottom navigation and go away by themselves.
 * Success and info are announced politely; errors interrupt, as they need attention.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => setToasts((current) => current.filter((toast) => toast.id !== id)), [])
  const show = useCallback((input: ToastInput) => {
    const toast = { id: nextId.current++, tone: input.tone ?? 'info', message: input.message }
    setToasts((current) => [...current, toast].slice(-MAX_SHOWN))
  }, [])

  return (
    <ToastContext.Provider value={show}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4 lg:right-6 lg:bottom-6 lg:left-auto lg:items-end">
          <AnimatePresence initial={false}>
            {toasts.map((toast) => (
              <ToastCard key={toast.id} toast={toast} onDismiss={dismiss} />
            ))}
          </AnimatePresence>
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  )
}

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: number) => void }) {
  const { t } = useLanguage()
  const { icon: Icon, iconClass } = LOOK[toast.tone]

  // Each message keeps its own timer, which other messages arriving do not reset.
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(toast.id), SHOW_FOR_MS)
    return () => window.clearTimeout(timer)
  }, [onDismiss, toast.id])

  return (
    <m.div
      role={toast.tone === 'error' ? 'alert' : 'status'}
      initial={{ opacity: 0, y: 16, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, transition: { duration: DURATION.base, ease: EASE_IN } }}
      transition={SPRING}
      className={cx('pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-card bg-ink-900 py-2 pr-2 pl-4 text-white shadow-e3')}
    >
      <Icon aria-hidden="true" size={20} className={cx('mt-3 shrink-0', iconClass)} />
      <p className="min-w-0 flex-1 py-2.5 text-small font-medium break-words">{toast.message}</p>
      <button
        type="button"
        aria-label={t('Dismiss')}
        className="flex size-11 shrink-0 items-center justify-center rounded-full text-ink-300 hover:bg-white/10 hover:text-white"
        onClick={() => onDismiss(toast.id)}
      >
        <X size={18} aria-hidden="true" />
      </button>
    </m.div>
  )
}
