import { LoaderCircle } from 'lucide-react'
import { cx } from './cx'

// A small spinning circle for buttons that are working. Hidden from screen readers: the button's
// own text says what is happening. With reduced motion it simply stays still.
export default function Spinner({ size = 20, className }: { size?: number; className?: string }) {
  return <LoaderCircle aria-hidden="true" size={size} strokeWidth={2.25} className={cx('shrink-0 animate-spin', className)} />
}
