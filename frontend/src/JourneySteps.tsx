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

// Shows where the owner is in the journey. Steps already reached can be opened again.
export default function JourneySteps({ current, canOpen, onOpen }: Props) {
  const { t } = useLanguage()
  return (
    <nav aria-label={t('Your progress')} className="border-b border-rule bg-paper">
      <ol className="mx-auto flex max-w-3xl gap-0.5 px-3 py-2 text-sm sm:gap-3 sm:px-4 sm:text-base">
        {STEPS.map((step, index) => {
          const isCurrent = step.key === current
          const isOpenable = !isCurrent && canOpen(step.key)
          const number = (
            <span
              className={`flex size-5 shrink-0 items-center justify-center text-xs font-bold sm:size-6 sm:text-sm ${
                isCurrent ? 'bg-ink text-paper' : isOpenable ? 'border-2 border-ink' : 'border-2 border-rule text-muted'
              }`}
            >
              {index + 1}
            </span>
          )
          return (
            <li key={step.key} className="flex min-w-0 flex-1 items-center sm:flex-none">
              {isOpenable ? (
                <button type="button" className="flex items-center gap-1 py-1 font-semibold underline underline-offset-4 sm:gap-1.5" onClick={() => onOpen(step.key)}>
                  {number}
                  {t(step.label)}
                </button>
              ) : (
                <span
                  aria-current={isCurrent ? 'step' : undefined}
                  className={`flex items-center gap-1 py-1 sm:gap-1.5 ${isCurrent ? 'font-semibold' : 'text-muted'}`}
                >
                  {number}
                  {t(step.label)}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
