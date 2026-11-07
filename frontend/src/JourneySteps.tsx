import { useLanguage } from './i18n'

export type StepKey = 'choose' | 'quote' | 'verify' | 'order'

const STEPS: { key: StepKey; label: string }[] = [
  { key: 'choose', label: 'Choose' },
  { key: 'quote', label: 'Quote' },
  { key: 'verify', label: 'Verify' },
  { key: 'order', label: 'Order' },
]

type Props = {
  current: StepKey
  canOpen: (step: StepKey) => boolean
  onOpen: (step: StepKey) => void
}

// Where the owner is in the journey. Steps already reached can be opened again.
export default function JourneySteps({ current, canOpen, onOpen }: Props) {
  const { t } = useLanguage()
  const currentIndex = STEPS.findIndex((step) => step.key === current)
  return (
    <nav aria-label={t('Your progress')} className="mx-auto w-full max-w-3xl px-4 pt-4">
      <ol className="flex items-center gap-1 text-sm sm:gap-2">
        {STEPS.map((step, index) => {
          const isCurrent = step.key === current
          const isPast = index < currentIndex
          const isOpenable = !isCurrent && canOpen(step.key)
          const number = (
            <span
              className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                isCurrent ? 'bg-accent text-white' : isOpenable || isPast ? 'bg-accent-soft text-accent' : 'border border-field text-muted'
              }`}
            >
              {index + 1}
            </span>
          )
          return (
            <li key={step.key} className="flex min-w-0 flex-1 items-center gap-1 sm:gap-2">
              {isOpenable ? (
                <button type="button" className="flex items-center gap-1.5 rounded-md py-1 font-medium text-accent hover:underline" onClick={() => onOpen(step.key)}>
                  {number}
                  {t(step.label)}
                </button>
              ) : (
                <span aria-current={isCurrent ? 'step' : undefined} className={`flex items-center gap-1.5 py-1 ${isCurrent ? 'font-semibold' : 'text-muted'}`}>
                  {number}
                  {t(step.label)}
                </span>
              )}
              {index < STEPS.length - 1 && <span aria-hidden="true" className="h-px min-w-2 flex-1 bg-rule" />}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
