import type { ReactNode } from 'react'
import { Check, Minus, TriangleExclamationPoint, X } from 'lucide-react'
import { cx } from './cx'

export type BadgeTone = 'success' | 'warn' | 'danger' | 'neutral' | 'brand' | 'info'

const DEFAULT_ICONS: Partial<Record<BadgeTone, ReactNode>> = {
  success: <Check size={14} strokeWidth={3} />,
  warn: <TriangleExclamationPoint size={14} strokeWidth={2.5} />,
  danger: <X size={14} strokeWidth={3} />,
  neutral: <Minus size={14} strokeWidth={3} />,
}

type Props = {
  tone?: BadgeTone
  icon?: ReactNode | false // false hides the icon. Status badges keep it, so colour is never the only signal.
  children: ReactNode
  className?: string
}

// A small rounded label for a status, such as "Verified" or "Needs review".
export default function Badge({ tone = 'neutral', icon, children, className }: Props) {
  const shown = icon === false ? null : (icon ?? DEFAULT_ICONS[tone])
  return (
    <span className={cx('badge', `badge-${tone}`, className)}>
      {shown && <span aria-hidden="true" className="flex">{shown}</span>}
      {children}
    </span>
  )
}
