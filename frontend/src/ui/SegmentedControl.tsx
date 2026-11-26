import { useId, type KeyboardEvent } from 'react'
import { m } from 'motion/react'
import { cx } from './cx'
import { SPRING } from './motionTokens'

type Option<T extends string> = { value: T; label: string; lang?: string }

type Props<T extends string> = {
  label: string // What the choice is about, such as "Language". Read out by screen readers.
  options: Option<T>[]
  value: T
  onChange: (value: T) => void
  size?: 'sm' | 'md'
  className?: string
}

/**
 * Two or three side-by-side options where exactly one is chosen, such as EN / हिन्दी.
 * Works like radio buttons: arrow keys move between options. The white thumb slides with a spring;
 * only its transform moves, so it stays smooth on slower phones.
 */
export default function SegmentedControl<T extends string>({ label, options, value, onChange, size = 'md', className }: Props<T>) {
  const groupId = useId()
  const chosenIndex = Math.max(0, options.findIndex((option) => option.value === value))

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    event.preventDefault()
    const next = options[(index + step + options.length) % options.length]
    onChange(next.value)
    document.getElementById(`${groupId}-${next.value}`)?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx('relative inline-grid rounded-full bg-ink-100 p-1', className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      <m.span
        aria-hidden="true"
        className="absolute top-1 bottom-1 left-1 rounded-full bg-white shadow-e1"
        style={{ width: `calc((100% - 0.5rem) / ${options.length})` }}
        initial={false}
        animate={{ x: `${chosenIndex * 100}%` }}
        transition={SPRING}
      />
      {options.map((option, index) => {
        const isChosen = index === chosenIndex
        return (
          <button
            key={option.value}
            id={`${groupId}-${option.value}`}
            type="button"
            role="radio"
            aria-checked={isChosen}
            tabIndex={isChosen ? 0 : -1}
            lang={option.lang}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cx(
              'relative rounded-full font-semibold whitespace-nowrap transition-colors duration-200',
              size === 'sm' ? 'min-h-9 px-3 text-sm' : 'min-h-11 px-4',
              isChosen ? 'text-ink-900' : 'text-ink-600 hover:text-ink-900',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
