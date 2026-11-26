import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'motion/react'
import { cx } from './cx'

type Props = {
  value: number
  format?: (value: number) => string
  countFrom?: number // Count up from this on first show, such as 0 for the price reveal.
  duration?: number // Seconds
  className?: string
}

// Fast at first, then settling gently on the final number.
const easeOutCubic = (progress: number) => 1 - (1 - progress) ** 3

/**
 * A number that rolls to its new value, such as a price after a service is switched on.
 * Screen readers get only the final value, never the numbers in between. With reduced motion,
 * the new value just appears. Runs on the browser's animation frames, with no library.
 */
export default function AnimatedNumber({ value, format = String, countFrom, duration = 0.6, className }: Props) {
  const reduceMotion = useReducedMotion()
  const [shown, setShown] = useState(countFrom ?? value)
  const shownRef = useRef(shown)

  useEffect(() => {
    if (reduceMotion) {
      shownRef.current = value // Nothing to animate: the render below shows the value directly.
      return
    }
    const from = shownRef.current
    if (from === value) return
    const start = performance.now()
    const frame = { id: 0 } // The frame waiting to run, so stopping early can cancel it.
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / (duration * 1000))
      const current = from + (value - from) * easeOutCubic(progress)
      shownRef.current = current
      setShown(Math.round(current))
      if (progress < 1) frame.id = requestAnimationFrame(step)
    }
    frame.id = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame.id)
  }, [value, duration, reduceMotion])

  return (
    <span className={cx('tabular-nums', className)}>
      <span aria-hidden="true">{format(reduceMotion ? value : shown)}</span>
      <span className="sr-only">{format(value)}</span>
    </span>
  )
}
