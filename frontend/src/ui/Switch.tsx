import { cx } from './cx'

type Props = {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string // Read out by screen readers, such as "Cloud CCTV".
  disabled?: boolean
  className?: string
}

/**
 * An on/off switch, like the ones in a phone's settings. The tap area is 44px tall even though the
 * track is smaller, and the thumb slides with a small spring (only transform moves).
 */
export default function Switch({ checked, onChange, label, disabled = false, className }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'group relative inline-flex h-11 w-14 shrink-0 cursor-pointer items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cx(
          'block h-7 w-12 rounded-full transition-colors duration-200 ease-out-soft',
          checked ? 'bg-brand-600' : 'bg-ink-300',
        )}
      />
      <span
        aria-hidden="true"
        className={cx(
          'absolute left-[0.4375rem] top-1/2 size-[1.375rem] -translate-y-1/2 rounded-full bg-white shadow-e2 transition-transform duration-200 ease-spring',
          checked ? 'translate-x-5' : 'translate-x-0',
        )}
      />
    </button>
  )
}
