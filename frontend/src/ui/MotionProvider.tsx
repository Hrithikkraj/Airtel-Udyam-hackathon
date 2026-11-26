import type { ReactNode } from 'react'
import { LazyMotion, MotionConfig } from 'motion/react'
import { DURATION, EASE_OUT } from './motionTokens'

// Fetched after the first screen, so the app opens faster on 4G.
const loadFeatures = () => import('./motionFeatures').then((module) => module.default)

/**
 * Loads only the small animation bundle (no drag or layout engine), and only after first paint, so
 * the app stays light on 4G. reducedMotion="user": when the phone asks for less motion, movement is
 * switched off and only fades remain, everywhere, without each component having to remember.
 */
export default function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={loadFeatures} strict>
      <MotionConfig reducedMotion="user" transition={{ duration: DURATION.base, ease: EASE_OUT }}>
        {children}
      </MotionConfig>
    </LazyMotion>
  )
}
