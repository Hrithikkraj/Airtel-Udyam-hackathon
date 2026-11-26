import type { ComponentPropsWithRef, ReactNode } from 'react'
import { cx } from './cx'
import Spinner from './Spinner'

type Props = ComponentPropsWithRef<'button'> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'quiet'
  size?: 'sm' | 'md' | 'lg'
  block?: boolean
  isLoading?: boolean
  loadingText?: string
  icon?: ReactNode
  iconAfter?: ReactNode
}

/**
 * One button for the whole app. At least 44px tall, presses in a little when tapped (CSS, so it
 * costs nothing), and shows a spinner with its own text while it works.
 */
export default function Button({
  variant = 'primary',
  size = 'md',
  block = false,
  isLoading = false,
  loadingText,
  icon,
  iconAfter,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: Props) {
  return (
    <button
      type={type}
      className={cx('btn', `btn-${variant}`, size !== 'md' && `btn-${size}`, block && 'btn-block', className)}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      {...rest}
    >
      {isLoading ? <Spinner /> : icon}
      <span className="min-w-0">{isLoading && loadingText ? loadingText : children}</span>
      {!isLoading && iconAfter}
    </button>
  )
}
