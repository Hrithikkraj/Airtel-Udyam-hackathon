import { Check } from 'lucide-react'
import { m } from 'motion/react'
import { useLanguage } from '../i18n'
import { cx } from './cx'
import { DURATION, EASE_OUT } from './motionTokens'

type Step = { key: string; label: string }

type Props = {
  label: string // What the steps are, such as "Your progress". Read out by screen readers.
  steps: Step[]
  current: number // Index of the step the owner is on.
  canOpen?: (index: number) => boolean
  onOpen?: (index: number) => void
  className?: string
}

/**
 * Numbered steps joined by a line that fills up to the current step. Steps already reached can be
 * tapped to go back. The fill grows with transform only, so it stays smooth on slower phones.
 */
export default function Stepper({ label, steps, current, canOpen, onOpen, className }: Props) {
  const { t } = useLanguage()
  const count = steps.length
  const progress = count > 1 ? Math.min(1, Math.max(0, current / (count - 1))) : 1
  // The line runs from the centre of the first circle to the centre of the last one.
  const inset = `${50 / count}%`

  return (
    <nav aria-label={label} className={className}>
      <ol className="relative grid" style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}>
        <span aria-hidden="true" className="absolute top-4 h-0.5 -translate-y-1/2 rounded-full bg-ink-200" style={{ left: inset, right: inset }} />
        <m.span
          aria-hidden="true"
          className="absolute top-4 h-0.5 origin-left -translate-y-1/2 rounded-full bg-brand-600"
          style={{ left: inset, right: inset }}
          initial={false}
          animate={{ scaleX: progress }}
          transition={{ duration: DURATION.slow * 1.5, ease: EASE_OUT }}
        />
        {steps.map((step, index) => {
          const isDone = index < current
          const isCurrent = index === current
          const isOpenable = !isCurrent && Boolean(onOpen) && (canOpen?.(index) ?? true)
          const circle = (
            <span className="relative flex size-8 items-center justify-center">
              {isCurrent && <span aria-hidden="true" className="absolute inset-0 animate-pulse-ring rounded-full bg-brand-600" />}
              <span
                className={cx(
                  'relative flex size-8 items-center justify-center rounded-full text-caption font-bold transition-colors duration-200',
                  isDone && 'bg-brand-600 text-white',
                  isCurrent && 'bg-brand-600 text-white ring-4 ring-brand-100',
                  !isDone && !isCurrent && 'bg-white text-ink-500 ring-[1.5px] ring-ink-300',
                )}
              >
                {isDone ? <Check aria-hidden="true" size={16} strokeWidth={3} /> : index + 1}
              </span>
            </span>
          )
          const text = (
            <span
              className={cx(
                'mt-1.5 block px-1 text-center text-caption leading-tight break-words',
                isCurrent ? 'font-bold text-ink-900' : isDone ? 'font-semibold text-ink-700' : 'text-ink-500',
              )}
            >
              {step.label}
              {isDone && <span className="sr-only"> ({t('Done')})</span>}
            </span>
          )
          return (
            <li key={step.key} className="relative flex justify-center" aria-current={isCurrent ? 'step' : undefined}>
              {isOpenable ? (
                <button
                  type="button"
                  className="flex min-h-11 w-full flex-col items-center rounded-control pb-1 hover:bg-white/60"
                  onClick={() => onOpen?.(index)}
                >
                  {circle}
                  {text}
                </button>
              ) : (
                <span className="flex w-full flex-col items-center pb-1">
                  {circle}
                  {text}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
