import { useCallback, useEffect, useState } from 'react'
import PhoneRequest from './PhoneRequest'
import { cancelOrder, fetchOrder, requestHelp, advanceDemoOrder, placeOrder, type Order } from './api'
import { rupees } from './format'
import { useLanguage } from './i18n'

// Times are saved in UTC, and the browser shows them in the owner's own time.
function shortTime(moment: string) {
  return new Date(moment).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}

function shortDate(day: string) {
  return new Date(`${day}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
}

const REFRESH_EVERY_MS = 20000

type Props = { orderId: number; onVerify: () => void; onStartAgain: () => void }

export default function OrderPage({ orderId, onVerify, onStartAgain }: Props) {
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
    if (window.confirm('Cancel this order?')) run(cancelOrder)
  }

  if (!order) {
    if (!error) return <p className="py-8">{t('Loading your order…')}</p>
    return (
      <div className="py-8">
        <p role="alert">{error}</p>
        <button type="button" className="mt-4 font-semibold underline underline-offset-4" onClick={onStartAgain}>
          {t('Start a new bundle')}
        </button>
      </div>
    )
  }

  return (
    <div className="py-8">
      <p className="text-sm text-muted">{t('Order')} {order.order_id}</p>
      <h2 aria-live="polite" className="font-display text-3xl leading-tight font-bold">{t(order.status_label)}</h2>

      {/* What happens next comes first, because that is why the owner opened this page. */}
      <section className={`mt-4 p-4 ${order.status === 'activated' ? 'bg-ink text-paper' : 'border-4 border-ink'}`}>
        <p className="text-lg">{t(order.next_step)}</p>
        {order.expected_activation && order.status !== 'activated' && order.status !== 'cancelled' && (
          <p className="mt-1 font-semibold">{t('Expected by')} {shortDate(order.expected_activation)}</p>
        )}
        {order.next_action === 'verify' && (
          <button type="button" className="mt-3 w-full bg-ink px-6 py-3 font-semibold text-paper sm:w-auto" onClick={onVerify}>
            {t(order.status === 'quote_confirmed' ? 'Verify my business' : 'Go to my documents')}
          </button>
        )}
        {order.next_action === 'place_order' && (
          <div className="mt-3">
            <p>
              {rupees(order.monthly_total_inr)} {t('a month')}, {order.contract_months} {t('month contract')}
              {order.setup_total_inr > 0 ? `, ${rupees(order.setup_total_inr)} ${t('one-time setup')}` : ''}.{' '}
              {t('Taxes as applicable.')} {t('No payment is taken in this prototype.')}
            </p>
            <button
              type="button"
              disabled={isBusy}
              className="mt-3 w-full bg-ink px-6 py-3 font-semibold text-paper disabled:opacity-60 sm:w-auto"
              onClick={() => run(placeOrder)}
            >
              {t('Place my order')}
            </button>
          </div>
        )}
      </section>

      {error && (
        <p role="alert" className="mt-4 border-l-4 border-marigold pl-3 font-semibold">{error}</p>
      )}

      <section className="mt-8">
        <h2 className="border-b-4 border-ink font-display text-2xl font-bold">{t('Progress')}</h2>
        <ol className="mt-3">
          {order.steps.map((step, index) => (
            <li key={step.label} className="flex gap-3" aria-current={step.state === 'current' ? 'step' : undefined}>
              <div className="flex flex-col items-center">
                <span
                  className={`flex size-8 shrink-0 items-center justify-center font-display font-bold ${
                    step.state === 'done'
                      ? 'bg-ink text-paper'
                      : step.state === 'current'
                        ? 'bg-marigold text-ink'
                        : 'border-2 border-rule text-muted'
                  }`}
                >
                  {step.state === 'done' ? '✓' : index + 1}
                </span>
                {index < order.steps.length - 1 && <span aria-hidden="true" className="w-0.5 flex-1 bg-rule" />}
              </div>
              <div className="pb-5">
                <p className={step.state === 'upcoming' ? 'text-muted' : 'font-semibold'}>{t(step.label)}</p>
                {step.at && <p className="text-sm text-muted">{shortTime(step.at)}</p>}
              </div>
            </li>
          ))}
        </ol>
      </section>

      {order.demo_mode && (order.status === 'installation_scheduled' || order.status === 'installation_in_progress') && (
        <section className="mt-2 border-2 border-dashed border-rule p-3">
          <p className="text-sm text-muted">Demo only: stands in for the installation partner.</p>
          <button
            type="button"
            disabled={isBusy}
            className="mt-2 border-2 border-ink px-4 py-2 font-semibold disabled:opacity-60"
            onClick={() => run(advanceDemoOrder)}
          >
            {order.status === 'installation_scheduled' ? 'Start installation' : 'Finish installation and activate'}
          </button>
        </section>
      )}

      <section className="mt-8">
        <h2 className="border-b-4 border-ink font-display text-2xl font-bold">{t('What you ordered')}</h2>
        <ul className="divide-y divide-rule">
          {order.lines.map((line) => (
            <li key={line.product_id} className="flex items-baseline justify-between gap-4 py-2">
              <span>{line.quantity} × {line.name}</span>
              <span className="font-display font-semibold whitespace-nowrap tabular-nums">{rupees(line.monthly_inr)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 border-t-2 border-ink pt-2 font-display text-xl font-bold tabular-nums">
          {rupees(order.monthly_total_inr)} {t('a month')}
        </p>
        <p className="text-sm text-muted">
          {order.setup_total_inr > 0 ? `${rupees(order.setup_total_inr)} ${t('one-time setup')}` : t('No setup fee')}.{' '}
          {order.contract_months} {t('month contract')}. {t('Taxes as applicable.')}
        </p>
      </section>

      {order.timeline.length > 0 && (
        <details className="mt-8">
          <summary className="cursor-pointer font-semibold">{t('Full history')}</summary>
          <ul className="mt-2 space-y-1 text-sm">
            {order.timeline.map((entry) => (
              <li key={`${entry.label}-${entry.at}`} className="flex justify-between gap-4">
                <span>{t(entry.label)}</span>
                <span className="whitespace-nowrap text-muted">{shortTime(entry.at)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <section className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
        {order.status !== 'activated' && order.status !== 'cancelled' && (
          order.help_requested ? (
            <p className="font-semibold">{t('Help requested. Our team will call you.')}</p>
          ) : (
            <PhoneRequest
              buttonText="Ask our team for help"
              doneText="Help requested. Our team will call you."
              onSend={async (phone) => setOrder(await requestHelp(orderId, phone))}
            />
          )
        )}
        {order.can_cancel && (
          <button type="button" disabled={isBusy} className="font-semibold underline underline-offset-4" onClick={cancel}>
            {t('Cancel this order')}
          </button>
        )}
        {(order.status === 'activated' || order.status === 'cancelled') && (
          <button type="button" className="font-semibold underline underline-offset-4" onClick={onStartAgain}>
            {t('Start a new bundle')}
          </button>
        )}
      </section>
    </div>
  )
}
