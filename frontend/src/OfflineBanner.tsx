import { useSyncExternalStore } from 'react'
import { WifiOff } from 'lucide-react'
import { useLanguage } from './i18n'

function subscribe(onChange: () => void) {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

/**
 * A calm bar under the top bar while the phone has no connection. It says what still works, so the
 * owner does not think their answers are lost. It goes away by itself when the connection is back.
 */
export default function OfflineBanner() {
  const { t } = useLanguage()
  const isOnline = useSyncExternalStore(subscribe, () => navigator.onLine, () => true)
  if (isOnline) return null
  return (
    <div role="status" className="sticky top-16 z-30 bg-ink-900 text-white">
      <p className="mx-auto flex max-w-3xl animate-rise-in items-center gap-2.5 px-4 py-2.5 text-small font-semibold md:px-6">
        <WifiOff aria-hidden="true" size={18} className="shrink-0 text-warn-300" />
        {t('You are offline. What you have entered stays on this page until you are back online.')}
      </p>
    </div>
  )
}
