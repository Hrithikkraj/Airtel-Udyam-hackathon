import type { ComponentPropsWithRef, ReactNode } from 'react'
import { cx } from './cx'

type Props = Omit<ComponentPropsWithRef<'button'>, 'aria-label' | 'children'> & {
  label: string // Read out by screen readers, as the button has no visible text.
  children: ReactNode
}

// An icon-only button. Always 44px, so it is easy to tap even when the icon is small.
export default function IconButton({ label, children, className, type = 'button', ...rest }: Props) {
  return (
    <button type={type} aria-label={label} title={label} className={cx('icon-btn', className)} {...rest}>
      {children}
    </button>
  )
}
