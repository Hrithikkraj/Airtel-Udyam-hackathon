// The motion language in one place, so every animation in the app feels related.
// Durations are in seconds, as the motion library expects.

export const DURATION = {
  fast: 0.12, // Presses and colour changes
  base: 0.2, // Toggles, chips, fades
  slow: 0.32, // Pages and sheets
} as const

// Entrances slow down at the end, so things settle instead of stopping.
export const EASE_OUT = [0.2, 0.8, 0.2, 1] as const
// Exits speed up, so they get out of the way.
export const EASE_IN = [0.4, 0, 1, 1] as const

// Taps, sheets and the navigation indicator: quick, with almost no bounce.
export const SPRING = { type: 'spring', stiffness: 500, damping: 32, mass: 0.8 } as const
