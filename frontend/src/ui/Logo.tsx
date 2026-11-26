import { cx } from './cx'

// Our own mark: a soft "A" with an arc for a signal, on a red tile. No third-party artwork.
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 32 32" className={cx('shrink-0', className)}>
      <defs>
        <linearGradient id="accel-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff3b3b" />
          <stop offset="1" stopColor="#b80808" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#accel-mark)" />
      <path d="M9.5 23 16 8.5 22.5 23" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12.4 17.6c2.4-1.4 4.8-1.4 7.2 0" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  )
}

// The wordmark: the mark plus "Accel Business". Text stays real text, so it is sharp and readable.
export default function Logo({ inverted = false, size = 32, className }: { inverted?: boolean; size?: number; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-2', className)}>
      <LogoMark size={size} />
      <span className={cx('text-lg leading-none font-extrabold tracking-tight', inverted ? 'text-white' : 'text-ink-900')}>
        Accel<span className={inverted ? 'text-white' : 'text-brand-600'}> Business</span>
      </span>
    </span>
  )
}
