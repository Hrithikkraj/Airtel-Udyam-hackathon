import { useLanguage } from './i18n'
import Stepper from './ui/Stepper'

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

// Where the owner is in the journey. The line fills as they move on, and steps already reached
// can be opened again.
export default function JourneySteps({ current, canOpen, onOpen }: Props) {
  const { t } = useLanguage()
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-5 md:px-6">
      <Stepper
        label={t('Your progress')}
        steps={STEPS.map((step) => ({ key: step.key, label: t(step.label) }))}
        current={STEPS.findIndex((step) => step.key === current)}
        canOpen={(index) => canOpen(STEPS[index].key)}
        onOpen={(index) => onOpen(STEPS[index].key)}
        className="rounded-card bg-white/70 px-1 pt-3 pb-1 shadow-e1"
      />
    </div>
  )
}
