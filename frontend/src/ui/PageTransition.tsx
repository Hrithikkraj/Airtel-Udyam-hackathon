import { useEffect, useRef, type ReactNode } from 'react'
import { useReducedMotion } from 'motion/react'
import { DURATION, EASE_OUT } from './motionTokens'

type Props = {
  id: string // Changes when the page changes, which plays the entrance.
  direction?: 1 | -1 // 1 moving forward (slides in from the right), -1 going back (from the left).
  children: ReactNode
  className?: string
}

/**
 * A new page fades in with a small slide in the direction of travel.
 *
 * It replays the animation on the same element instead of mounting a new one, because some pages
 * (the chat and the short form) stay on the page while hidden so their answers are kept. Only the
 * entrance animates, so two pages never sit on screen together. With reduced motion it only fades.
 * Uses the browser's own animation engine, so it adds nothing to the download.
 */
export default function PageTransition({ id, direction = 1, children, className }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const reduceMotion = useReducedMotion()
  const isFirst = useRef(true)

  useEffect(() => {
    // The first page is already on screen when the app opens, so it does not slide in.
    if (isFirst.current) {
      isFirst.current = false
      return
    }
    const element = ref.current
    if (!element?.animate) return
    const keyframes = reduceMotion
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [
          { opacity: 0, transform: `translateX(${16 * direction}px)` },
          { opacity: 1, transform: 'translateX(0)' },
        ]
    const animation = element.animate(keyframes, {
      duration: (reduceMotion ? DURATION.fast : DURATION.slow) * 1000,
      easing: `cubic-bezier(${EASE_OUT.join(',')})`,
    })
    return () => animation.cancel()
    // The direction belongs to the change of page, so only a new page replays it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  )
}
