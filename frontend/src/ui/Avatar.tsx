import { cx } from './cx'

type Props = { name: string; size?: 'sm' | 'md' | 'lg'; className?: string }

const SIZES = { sm: 'size-8 text-sm', md: 'size-11 text-base', lg: 'size-16 text-2xl' }

// The first letters of a name in a brand circle. Decorative: the name is always written nearby.
export default function Avatar({ name, size = 'md', className }: Props) {
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('') || '?'
  return (
    <span
      aria-hidden="true"
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-linear-to-br from-brand-500 to-brand-800 font-bold text-white shadow-e1',
        SIZES[size],
        className,
      )}
    >
      {initials}
    </span>
  )
}
