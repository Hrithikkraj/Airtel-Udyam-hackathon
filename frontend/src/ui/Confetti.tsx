import type { CSSProperties } from 'react'
import { useReducedMotion } from 'motion/react'

const COLOURS = ['#da0a0a', '#ff5c5c', '#f79009', '#12b76a', '#3b82f6', '#14161c']
const PIECES = 22

/**
 * A small, short burst of paper pieces for a big moment (verified, activated). Pure CSS, plays
 * once, about a second long. Nothing at all with reduced motion. Purely decorative.
 */
export default function Confetti() {
  const reduceMotion = useReducedMotion()
  if (reduceMotion) return null
  return (
    <span aria-hidden="true" className="pointer-events-none absolute top-1/2 left-1/2 z-10">
      {Array.from({ length: PIECES }, (_, index) => {
        // Spread evenly around a circle, with a little variety, so it always looks balanced.
        const angle = (index / PIECES) * Math.PI * 2 + (index % 3) * 0.2
        const distance = 70 + (index % 4) * 22
        const style = {
          '--dx': `${Math.cos(angle) * distance}px`,
          '--dy': `${Math.sin(angle) * distance - 30}px`,
          '--spin': `${(index % 2 ? 1 : -1) * (180 + index * 25)}deg`,
          background: COLOURS[index % COLOURS.length],
          animationDelay: `${(index % 5) * 30}ms`,
        } as CSSProperties
        return (
          <span
            key={index}
            className={`absolute block animate-confetti ${index % 3 === 0 ? 'size-2 rounded-full' : 'h-1.5 w-3 rounded-[2px]'}`}
            style={style}
          />
        )
      })}
    </span>
  )
}
