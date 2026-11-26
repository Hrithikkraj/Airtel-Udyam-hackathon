import { cx } from './cx'

// A green circle whose tick draws itself: used when something important succeeds.
// Decorative: the words next to it say what succeeded. With reduced motion the tick simply appears.
export default function AnimatedCheck({ size = 56, className }: { size?: number; className?: string }) {
  return (
    <span aria-hidden="true" className={cx('inline-flex animate-pop items-center justify-center rounded-full bg-success-500 shadow-e2', className)} style={{ width: size, height: size }}>
      <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24" fill="none">
        <path
          d="M5 12.5 10 17.5 19 7"
          stroke="white"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="24"
          className="animate-draw [--draw-length:24] [animation-delay:160ms]"
        />
      </svg>
    </span>
  )
}
