import type { ReactNode } from 'react'
import { cx } from './cx'

// A grey shape that shimmers where content will appear. Hidden from screen readers: the
// surrounding Loading region says what is loading. With reduced motion it stays still.
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cx('skeleton', className)} />
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <span aria-hidden="true" className={cx('block space-y-2', className)}>
      {Array.from({ length: lines }, (_, index) => (
        // The last line is shorter, as real paragraphs are.
        <Skeleton key={index} className={cx('h-4', index === lines - 1 ? 'w-3/5' : 'w-full')} />
      ))}
    </span>
  )
}

/**
 * The loading state for a whole area: shimmering shapes for the eye, and one short sentence for
 * screen readers, such as "Loading your order…".
 */
export function Loading({ label, children, className }: { label: string; children?: ReactNode; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={className}>
      <span className="sr-only">{label}</span>
      {children ?? (
        <div className="card space-y-4">
          <Skeleton className="h-6 w-2/5" />
          <SkeletonText lines={3} />
          <Skeleton className="h-12 w-full rounded-control" />
        </div>
      )}
    </div>
  )
}
