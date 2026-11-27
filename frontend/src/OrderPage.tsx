import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, CalendarDays, Check, ChevronDown, FlaskConical, PackageCheck, Plus, ReceiptText, RotateCw, Sparkles } from 'lucide-react'
import { m } from 'motion/react'
import PhoneRequest from './PhoneRequest'
import ProductIcon from './ProductIcon'
import { cancelOrder, fetchOrder, requestHelp, advanceDemoOrder, placeOrder, type Order } from './api'
import { rupees } from './format'
import { useLanguage } from './i18n'
import AnimatedCheck from './ui/AnimatedCheck'
import Badge, { type BadgeTone } from './ui/Badge'
import Button from './ui/Button'
import Confetti from './ui/Confetti'
import { cx } from './ui/cx'
import EmptyState from './ui/EmptyState'
import { DURATION, EASE_OUT } from './ui/motionTokens'
import { Loading, Skeleton, SkeletonText } from './ui/Skeleton'

// Times are saved in UTC, and the browser shows them in the owner's own time.
function shortTime(moment: string) {
  return new Date(moment).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}

function shortDate(day: string) {
  return new Date(`${day}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
}

const REFRESH_EVERY_MS = 20000

type Props = {
  orderId: number
  onVerify: () => void
  onStartAgain: () => void
  onOpenQuote?: () => void // Back to the accepted quote, to look at it or change it.
  onFindMore?: () => void // Back to the advisor or short form, for other suggestions.
  onStartFresh?: () => void // A clean start for a different business. This order stays on the profile.
}

// Until the order is placed, the owner can still change the quote or look for other suggestions.
const CHANGEABLE = ['quote_confirmed', 'kyc_pending', 'kyc_review', 'kyc_complete', 'needs_assistance']

// How the order's status looks at the top. Words always come with it, never colour alone.
const STATUS_TONE: Record<string, BadgeTone> = {
  quote_confirmed: 'brand',
  kyc_pending: 'brand',
  kyc_review: 'warn',
  kyc_complete: 'success',
  needs_assistance: 'danger',
  installation_scheduled: 'info',
  installation_in_progress: 'info',
  activated: 'success',
  cancelled: 'neutral',
}
// A small dot in the status colour next to the order number. The heading says the status in words.
const STATUS_DOT: Record<BadgeTone, string> = {
  brand: 'bg-brand-600',
  warn: 'bg-warn-500',
  success: 'bg-success-500',
  danger: 'bg-danger-600',
  info: 'bg-info-500',
  neutral: 'bg-ink-400',
}

export default function OrderPage({ orderId, onVerify, onStartAgain, onOpenQuote, onFindMore, onStartFresh }: Props) {
  const { t } = useLanguage()
  const [order, setOrder] = useState<Order>()
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    fetchOrder(orderId)
      .then((loaded) => {
        setOrder(loaded)
        setError('')
      })
      .catch(() => setError('Your order did not load. Check your connection, then reload this page.'))
  }, [orderId])

  // Keeps the tracker up to date while it is open, without the owner having to reload.
  useEffect(() => {
    load()
    const timer = setInterval(load, REFRESH_EVERY_MS)
    return () => clearInterval(timer)
  }, [load])

  async function run(action: (id: number) => Promise<Order>) {
    setIsBusy(true)
    setError('')
    try {
      setOrder(await action(orderId))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That did not work. Try again.')
    } finally {
      setIsBusy(false)
    }
  }

  function cancel() {
    if (window.confirm(t('Cancel this order?'))) run(cancelOrder)
  }

  if (!order) {
    if (!error) {
      return (
        <Loading label={t('Loading your order…')} className="py-6">
          <div className="space-y-4">
            <div className="card space-y-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-2/3" />
              <SkeletonText lines={2} />
              <Skeleton className="h-12 w-48 rounded-control" />
            </div>
            <div className="card space-y-4">
              {Array.from({ length: 4 }, (_, index) => (
                <div key={index} className="flex items-center gap-3">
                  <Skeleton className="size-9 rounded-full" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              ))}
            </div>
          </div>
        </Loading>
      )
    }
    return (
      <EmptyState
        role="alert"
        picture="offline"
        title={t('Your order did not load.')}
        text={t(error)}
        action={
          <>
            <Button variant="secondary" icon={<RotateCw aria-hidden="true" size={18} />} onClick={load}>
              {t('Try again')}
            </Button>
            <Button variant="ghost" onClick={onStartAgain}>
              {t('Start a new bundle')}
            </Button>
          </>
        }
      />
    )
  }

  const isActivated = order.status === 'activated'
  const isCancelled = order.status === 'cancelled'
  const doneSteps = order.steps.filter((step) => step.state === 'done').length
  // The line down the tracker fills to the middle of the current step.
  const fill = order.steps.length > 1 ? Math.min(1, Math.max(0, (doneSteps - (isActivated ? 1 : 0.5)) / (order.steps.length - 1))) : 1

  return (
    <div className="space-y-5 py-6">
      {/* ---------- Where the order is, and the one thing to do next ---------- */}
      <section
        className={cx(
          'card relative overflow-hidden',
          isActivated && 'bg-success-50!',
        )}
      >
        {isActivated && <Confetti />}
        <p className="flex items-center gap-2">
          <span aria-hidden="true" className={cx('size-2.5 rounded-full', STATUS_DOT[STATUS_TONE[order.status] ?? 'neutral'])} />
          <span className="eyebrow">
            {t('Order')} #{order.order_id}
          </span>
        </p>
        <div className="mt-3 flex items-start gap-4">
          {isActivated && <AnimatedCheck size={52} className="shrink-0" />}
          <div className="min-w-0">
            <h2 aria-live="polite" className="text-title-1 font-extrabold">
              {t(order.status_label)}
            </h2>
            <p className="mt-1 text-ink-700">{t(order.next_step)}</p>
          </div>
        </div>

        {order.expected_activation && !isActivated && !isCancelled && (
          <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-info-50 px-3.5 py-2 text-small font-bold text-info-800">
            <CalendarDays aria-hidden="true" size={16} />
            {t('Expected by')} {shortDate(order.expected_activation)}
          </p>
        )}

        {order.next_action === 'verify' && (
          <Button size="lg" className="mt-5 w-full sm:w-auto" iconAfter={<ArrowRight aria-hidden="true" size={18} />} onClick={onVerify}>
            {t(order.status === 'quote_confirmed' ? 'Verify my business' : 'Go to my documents')}
          </Button>
        )}
        {order.next_action === 'place_order' && (
          <div className="mt-5 rounded-control bg-ink-50 p-4">
            <p className="text-title-2 font-extrabold tabular-nums">
              {rupees(order.monthly_total_inr)} <span className="text-small font-semibold text-ink-500">{t('a month')}</span>
            </p>
            <p className="text-small text-ink-600">
              {order.contract_months} {t('month contract')}
              {order.setup_total_inr > 0 ? `, ${rupees(order.setup_total_inr)} ${t('one-time setup')}` : ''}. {t('Taxes as applicable.')}{' '}
              {t('No payment is taken in this prototype.')}
            </p>
            <Button
              size="lg"
              isLoading={isBusy}
              className="mt-3 w-full sm:w-auto"
              icon={<PackageCheck aria-hidden="true" size={20} />}
              onClick={() => run(placeOrder)}
            >
              {t('Place my order')}
            </Button>
          </div>
        )}
      </section>

      {error && (
        <p role="alert" className="notice-error font-medium">
          {error}
        </p>
      )}

      {/* ---------- The tracker ---------- */}
      <section aria-labelledby="progress-title" className="card">
        <h2 id="progress-title" className="text-title-2 font-extrabold">
          {t('Progress')}
        </h2>
        <ol className="relative mt-5">
          {/* The line behind the circles, and its red fill up to where the order is now. */}
          <span aria-hidden="true" className="absolute top-4 bottom-4 left-4 w-0.5 -translate-x-1/2 rounded-full bg-ink-200" />
          <m.span
            aria-hidden="true"
            className="absolute top-4 bottom-4 left-4 w-0.5 origin-top -translate-x-1/2 rounded-full bg-brand-600"
            initial={{ scaleY: 0 }}
            animate={{ scaleY: isCancelled ? 0 : fill }}
            transition={{ duration: DURATION.slow * 2.5, ease: EASE_OUT }}
          />
          {order.steps.map((step, index) => {
            const isDone = step.state === 'done'
            const isCurrent = step.state === 'current'
            return (
              <li key={step.label} className="relative flex gap-4 pb-6 last:pb-0" aria-current={isCurrent ? 'step' : undefined}>
                <span className="relative flex size-8 shrink-0 items-center justify-center">
                  {isCurrent && <span aria-hidden="true" className="absolute inset-0 animate-pulse-ring rounded-full bg-brand-600" />}
                  <span
                    className={cx(
                      'relative flex size-8 items-center justify-center rounded-full text-small font-bold',
                      isDone && 'bg-brand-600 text-white',
                      isCurrent && 'bg-white text-brand-700 ring-2 ring-brand-600',
                      !isDone && !isCurrent && 'bg-white text-ink-400 ring-[1.5px] ring-ink-300',
                    )}
                  >
                    {isDone ? <Check aria-hidden="true" size={16} strokeWidth={3} /> : index + 1}
                  </span>
                </span>
                <div className="min-w-0 pt-1">
                  <p className={cx('leading-tight', isDone || isCurrent ? 'font-bold' : 'text-ink-500')}>
                    {t(step.label)}
                    {isCurrent && (
                      <span className="ml-2 align-middle">
                        <Badge tone="brand" icon={false} className="text-caption">
                          {t('Now')}
                        </Badge>
                      </span>
                    )}
                  </p>
                  {step.at && <p className="mt-0.5 text-caption text-ink-500">{shortTime(step.at)}</p>}
                </div>
              </li>
            )
          })}
        </ol>
      </section>

      {/* ---------- A stand-in for the installation partner, clearly marked as a demo tool ---------- */}
      {order.demo_mode && (order.status === 'installation_scheduled' || order.status === 'installation_in_progress') && (
        <section className="rounded-card border-2 border-dashed border-info-300 bg-info-50/60 p-4">
          <p className="flex items-center gap-2 text-small font-bold text-info-800">
            <FlaskConical aria-hidden="true" size={16} />
            {t('Demo only: stands in for the installation partner.')}
          </p>
          <Button variant="secondary" size="sm" isLoading={isBusy} className="mt-3" onClick={() => run(advanceDemoOrder)}>
            {t(order.status === 'installation_scheduled' ? 'Start installation' : 'Finish installation and activate')}
          </Button>
        </section>
      )}

      {/* ---------- What was ordered ---------- */}
      <section aria-labelledby="ordered-title" className="card">
        <h2 id="ordered-title" className="flex items-center gap-2 text-title-2 font-extrabold">
          <ReceiptText aria-hidden="true" size={20} className="text-brand-600" />
          {t('What you ordered')}
        </h2>
        <ul className="mt-3 divide-y divide-ink-100">
          {order.lines.map((line) => (
            <li key={line.product_id} className="flex items-center gap-3 py-3">
              <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-control bg-brand-50 text-brand-600">
                <ProductIcon productId={line.product_id} size={20} />
              </span>
              <span className="min-w-0 flex-1 font-semibold break-words">
                {line.name}
                {line.quantity > 1 && <span className="ml-1 text-ink-500 tabular-nums">× {line.quantity}</span>}
              </span>
              <span className="font-bold whitespace-nowrap tabular-nums">{rupees(line.monthly_inr)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex items-baseline justify-between gap-3 border-t-2 border-ink-200 pt-3">
          <p className="text-small text-ink-500">
            {order.setup_total_inr > 0 ? `${rupees(order.setup_total_inr)} ${t('one-time setup')}` : t('No setup fee')}. {order.contract_months}{' '}
            {t('month contract')}. {t('Taxes as applicable.')}
          </p>
          <p className="text-title-2 font-extrabold whitespace-nowrap tabular-nums">
            {rupees(order.monthly_total_inr)} <span className="text-small font-semibold text-ink-500">{t('a month')}</span>
          </p>
        </div>
        {(onOpenQuote || onFindMore) && !isCancelled && (
          <div className="mt-3 flex flex-wrap gap-x-6">
            {onOpenQuote && (
              <button type="button" className="link" onClick={onOpenQuote}>
                {t(CHANGEABLE.includes(order.status) ? 'See or change my quote' : 'See my quote')}
              </button>
            )}
            {onFindMore && CHANGEABLE.includes(order.status) && (
              <button type="button" className="link" onClick={onFindMore}>
                <Sparkles aria-hidden="true" size={16} />
                {t('Look for other suggestions')}
              </button>
            )}
          </div>
        )}
      </section>

      {order.timeline.length > 0 && (
        <details className="group card-flat p-0!">
          <summary className="flex min-h-12 cursor-pointer items-center justify-between gap-2 px-5 py-3 font-bold">
            {t('Full history')}
            <ChevronDown aria-hidden="true" size={18} className="transition-transform duration-200 group-open:rotate-180" />
          </summary>
          <ul className="space-y-2 px-5 pb-4 text-small">
            {order.timeline.map((entry) => (
              <li key={`${entry.label}-${entry.at}`} className="flex justify-between gap-4">
                <span>{t(entry.label)}</span>
                <span className="whitespace-nowrap text-ink-500">{shortTime(entry.at)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <section className="flex flex-wrap items-center gap-x-6 gap-y-3 pt-1">
        {!isActivated && !isCancelled &&
          (order.help_requested ? (
            <p className="flex items-center gap-2 font-semibold text-success-700">
              <Check aria-hidden="true" size={18} />
              {t('Help requested. Our team will call you.')}
            </p>
          ) : (
            <PhoneRequest
              buttonText="Ask our team for help"
              doneText="Help requested. Our team will call you."
              onSend={async (phone) => setOrder(await requestHelp(orderId, phone))}
            />
          ))}
        {order.can_cancel && (
          <button type="button" disabled={isBusy} className="link text-ink-600 disabled:opacity-60" onClick={cancel}>
            {t('Cancel this order')}
          </button>
        )}
        {(isActivated || isCancelled) && (
          <Button variant="secondary" onClick={onStartAgain}>
            {t('Start a new bundle')}
          </Button>
        )}
        {onStartFresh && !isActivated && !isCancelled && (
          <Button variant="secondary" icon={<Plus aria-hidden="true" size={18} />} onClick={onStartFresh}>
            {t('Start fresh for a new business')}
          </Button>
        )}
      </section>
    </div>
  )
}
