import type { ReactNode } from 'react'
import { cx } from './cx'

type Props = {
  value: number // 0 to 1
  label: string // Read out by screen readers, such as "2 of 4 documents done".
  size?: number
  stroke?: number
  tone?: 'brand' | 'success'
  children?: ReactNode // Shown in the middle, such as "2/4".
  className?: string
}

// A circle that fills as something gets done, such as the documents for verification.
export default function ProgressRing({ value, label, size = 72, stroke = 7, tone = 'brand', children, className }: Props) {
  const clamped = Math.min(1, Math.max(0, value))
  const radius = (size - stroke) / 2
  const length = 2 * Math.PI * radius
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
      className={cx('relative inline-flex shrink-0 items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <svg aria-hidden="true" width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} className="stroke-ink-100" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={length}
          strokeDashoffset={length * (1 - clamped)}
          className={cx(
            'transition-[stroke-dashoffset] duration-700 ease-out-soft',
            tone === 'success' ? 'stroke-success-500' : 'stroke-brand-600',
          )}
        />
      </svg>
      {children && <span className="absolute inset-0 flex items-center justify-center text-small font-bold tabular-nums">{children}</span>}
    </div>
  )
}
