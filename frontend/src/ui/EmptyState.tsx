import type { ReactNode } from 'react'
import { cx } from './cx'

type Picture = 'box' | 'search' | 'document' | 'offline' | 'error'

// Simple two-tone line pictures: ink lines on a soft brand circle. Decorative only.
function Illustration({ picture }: { picture: Picture }) {
  const lines = { fill: 'none', stroke: '#3a3d46', strokeWidth: 2.5, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
  return (
    <svg aria-hidden="true" width="112" height="112" viewBox="0 0 112 112">
      <circle cx="56" cy="56" r="48" fill="#fff1f1" />
      <circle cx="84" cy="30" r="6" fill="#ffc4c4" />
      <circle cx="26" cy="82" r="4" fill="#ffdfdf" />
      {picture === 'box' && (
        <g {...lines}>
          <path d="M34 46 56 36l22 10v26L56 82 34 72Z" fill="#fff" />
          <path d="M34 46l22 10 22-10M56 56v26" />
        </g>
      )}
      {picture === 'search' && (
        <g {...lines}>
          <circle cx="51" cy="51" r="16" fill="#fff" />
          <path d="m63 63 13 13M45 51h12" />
        </g>
      )}
      {picture === 'document' && (
        <g {...lines}>
          <path d="M40 30h22l12 12v40H40Z" fill="#fff" />
          <path d="M62 30v12h12M47 56h20M47 65h20M47 74h12" />
        </g>
      )}
      {picture === 'offline' && (
        <g {...lines}>
          <path d="M34 52a32 32 0 0 1 44 0M41 60a22 22 0 0 1 30 0M49 68a10 10 0 0 1 14 0" />
          <circle cx="56" cy="76" r="2" fill="#3a3d46" />
          <path d="M34 34 78 78" stroke="#da0a0a" />
        </g>
      )}
      {picture === 'error' && (
        <g {...lines}>
          <path d="M56 34 80 76H32Z" fill="#fff" />
          <path d="M56 50v12" />
          <circle cx="56" cy="69" r="1.5" fill="#3a3d46" />
        </g>
      )}
    </svg>
  )
}

type Props = {
  picture?: Picture
  title: ReactNode
  text?: ReactNode
  action?: ReactNode
  role?: 'status' | 'alert' // alert for errors, so a screen reader says it at once.
  className?: string
}

/** What a screen shows when there is nothing yet, nothing found, or something went wrong. */
export default function EmptyState({ picture = 'box', title, text, action, role, className }: Props) {
  return (
    <div role={role} className={cx('flex flex-col items-center px-4 py-10 text-center', className)}>
      <Illustration picture={picture} />
      <h2 className="mt-4 text-title-2 font-bold text-ink-900">{title}</h2>
      {text && <p className="mt-1 max-w-[42ch] text-ink-500">{text}</p>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-3">{action}</div>}
    </div>
  )
}
