import type { ComponentPropsWithRef, ReactNode } from 'react'
import { cx } from './cx'

type Props = ComponentPropsWithRef<'button'> & {
  selected?: boolean // When set, the chip is a toggle and says so to screen readers.
  icon?: ReactNode
}

// A rounded, tappable pill: quick replies in the chat, category filters on the rate list.
export default function Chip({ selected, icon, className, children, type = 'button', ...rest }: Props) {
  return (
    <button type={type} aria-pressed={selected} className={cx('chip', className)} {...rest}>
      {icon && <span aria-hidden="true" className="flex">{icon}</span>}
      {children}
    </button>
  )
}
