import { useState } from 'react'
import PhoneRequest from './PhoneRequest'
import ProductDetailPanel from './ProductDetailPanel'
import { useLanguage } from './i18n'
import { priceBundle, requestCallback, saveQuote, type BundleItem, type ProductDetail, type Profile, type Quote, type Recommendation, type RecommendedBundle, type SavedQuote } from './api'
import { rupees } from './format'

// One product the owner can switch on or off on this page.
type Option = { product_id: string; name: string; unit: string; quantity: number; monthly_inr: number; reason: string; detail?: ProductDetail }

const CONNECTION_IDS = ['P01', 'P02', 'P03', 'P04', 'P05', 'P06']

function itemsFrom(bundle: RecommendedBundle): BundleItem[] {
  return bundle.quote.lines.map((line) => ({ product_id: line.product_id, quantity: line.quantity }))
}

function sameItems(a: BundleItem[], b: BundleItem[]) {
  return a.length === b.length && a.every((item) => b.some((other) => other.product_id === item.product_id && other.quantity === item.quantity))
}

function connectionOf(bundle: RecommendedBundle) {
  return bundle.quote.lines.find((line) => CONNECTION_IDS.includes(line.product_id))
}

// One plain line under each other way to build it: what it costs compared with ours, and what changes.
function alternativeDifference(alternative: RecommendedBundle, current: RecommendedBundle, t: (text: string) => string, hindi: boolean) {
  const parts: string[] = []
  const change = alternative.quote.monthly_total_inr - current.quote.monthly_total_inr
  if (change > 0) parts.push(`${rupees(change)} ${t('more a month')}`)
  else if (change < 0) parts.push(`${rupees(-change)} ${t('less a month')}`)
  else parts.push(t('Same monthly price'))
  const from = connectionOf(current)
  const to = connectionOf(alternative)
  if (from && to && from.product_id !== to.product_id) {
    parts.push(hindi ? `${from.name} की जगह ${to.name}` : `Uses ${to.name} instead of ${from.name}`)
  }
  const leftOut = current.quote.lines
    .filter((line) => !CONNECTION_IDS.includes(line.product_id))
    .filter((line) => !alternative.quote.lines.some((other) => other.product_id === line.product_id))
    .map((line) => line.name)
  if (leftOut.length > 0) parts.push(`${t('Leaves out')} ${leftOut.join(', ')}`)
  return `${parts.join('. ')}.`
}

// One plain sentence for each part of the score.
function scoreSentences(bundle: RecommendedBundle, needsCount: number, hindi: boolean) {
  const { needs_covered, size_fit } = bundle.score
  const wanted = Math.max(1, needsCount)
  const covered = Math.round((needs_covered / 60) * wanted)
  const services = bundle.quote.lines.length
  const hasConnection = Boolean(connectionOf(bundle))

  let needs: string
  if (covered >= wanted) {
    if (hindi) needs = wanted === 1 ? 'आपकी बताई ज़रूरत पूरी होती है।' : `आपकी बताई सभी ${wanted} ज़रूरतें पूरी होती हैं।`
    else needs = wanted === 1 ? 'Covers the one thing you asked for.' : `Covers all ${wanted} things you asked for.`
  } else {
    needs = hindi ? `आपकी बताई ${wanted} में से ${covered} ज़रूरतें पूरी होती हैं।` : `Covers ${covered} of the ${wanted} things you asked for.`
  }

  let size: string
  if (!hasConnection) size = hindi ? 'आपकी ज़रूरतों के लिए इंटरनेट कनेक्शन ज़रूरी नहीं है।' : 'No internet connection is needed for what you asked for.'
  else if (size_fit >= 30) size = hindi ? 'कनेक्शन आप जैसे व्यवसाय के लिए हमारी पहली पसंद है।' : 'The connection is our first choice for a business like yours.'
  else if (size_fit > 0) size = hindi ? 'कनेक्शन आप जैसे व्यवसाय के लिए हमारी दूसरी पसंद है।' : 'The connection is our second choice for a business like yours.'
  else size = hindi ? 'कनेक्शन आपके आकार के लिए हमारी आम पसंद नहीं है।' : 'The connection is not our usual match for your size.'

  const simple = hindi
    ? `कुल ${services} ${services === 1 ? 'सेवा' : 'सेवाएँ'}। कम सेवाओं से संभालना आसान रहता है।`
    : `${services} ${services === 1 ? 'service' : 'services'} in total. Fewer services are simpler to manage.`
  return { needs, size, simple }
}

// Everything that could be in the bundle: what we recommend, then add-ons, then other options.
function buildOptions(recommendation: Recommendation): Option[] {
  const options: Option[] = []
  const add = (option: Option) => {
    if (!options.some((existing) => existing.product_id === option.product_id)) options.push(option)
  }
  const bundles = recommendation.bundle ? [recommendation.bundle, ...recommendation.alternatives] : []
  // An old saved quote may have no details. The page then looks exactly as it did before.
  for (const line of recommendation.bundle?.quote.lines ?? []) {
    add({ ...line, reason: recommendation.bundle!.reasons[line.product_id], detail: recommendation.bundle!.details?.[line.product_id] })
  }
  for (const addon of recommendation.addons) {
    add({ ...addon, unit: '', detail: addon.detail ?? undefined })
  }
  for (const bundle of bundles) {
    for (const line of bundle.quote.lines) add({ ...line, reason: bundle.reasons[line.product_id], detail: bundle.details?.[line.product_id] })
  }
  return options
}

type Props = {
  profile: Profile
  recommendation: Recommendation
  city: string | null
  isAccepted: boolean // True when the owner comes back to a quote they already accepted.
  onBack: () => void
  onViewOrder: () => void
  onSaved: (saved: SavedQuote) => void
}

export default function QuotePage({ profile, recommendation, city, isAccepted, onBack, onViewOrder, onSaved }: Props) {
  const { t, language } = useLanguage()
  const hindi = language === 'hi'
  const bundle = recommendation.bundle
  const [items, setItems] = useState<BundleItem[]>(bundle ? itemsFrom(bundle) : [])
  const [quote, setQuote] = useState<Quote | null>(bundle ? bundle.quote : null)
  const [isBusy, setIsBusy] = useState(false)
  const [message, setMessage] = useState('')
  const options = buildOptions(recommendation)
  // Only show options the owner can act on: chosen ones, then add-ons not yet chosen.
  const addonIds = recommendation.addons.map((addon) => addon.product_id)
  const shownOptions = options.filter(
    (option) =>
      items.some((item) => item.product_id === option.product_id) ||
      addonIds.includes(option.product_id) ||
      bundle?.quote.lines.some((line) => line.product_id === option.product_id),
  )

  // The server checks the rules and sets the price. If it refuses, nothing on screen changes.
  async function changeBundle(newItems: BundleItem[]) {
    setIsBusy(true)
    setMessage('')
    try {
      setQuote(await priceBundle(profile, newItems))
      setItems(newItems)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The price could not be updated. Try again.')
    } finally {
      setIsBusy(false)
    }
  }

  function toggle(option: Option) {
    const isOn = items.some((item) => item.product_id === option.product_id)
    changeBundle(
      isOn
        ? items.filter((item) => item.product_id !== option.product_id)
        : [...items, { product_id: option.product_id, quantity: option.quantity }],
    )
  }

  function changeQuantity(productId: string, change: number) {
    changeBundle(
      items.map((item) => (item.product_id === productId ? { ...item, quantity: item.quantity + change } : item)),
    )
  }

  async function accept() {
    setIsBusy(true)
    setMessage('')
    try {
      onSaved(await saveQuote(profile, items, city))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The quote could not be saved. Try again.')
      setIsBusy(false)
    }
  }

  const budget = profile.budget_monthly_inr
  const overBudgetBy = budget && quote ? quote.monthly_total_inr - budget : 0
  const bundleUnchanged = bundle ? sameItems(items, itemsFrom(bundle)) : false
  const score = bundle ? scoreSentences(bundle, profile.needs.length, hindi) : null

  return (
    <div className="pt-8">
      {isAccepted && (
        <p className="notice-success mb-4 font-medium">{t('You accepted this quote.')}</p>
      )}
      <p className="max-w-[62ch] text-lg">{recommendation.explanation}</p>

      {bundle && (
        <section className="panel mt-6">
          <h2 className="section-title">{t('Your bundle')}</h2>
          <ul className="divide-y divide-rule">
            {shownOptions.map((option) => {
              const item = items.find((i) => i.product_id === option.product_id)
              const line = quote?.lines.find((l) => l.product_id === option.product_id)
              return (
                <li key={option.product_id} className="py-3">
                  <div className="flex items-baseline gap-2">
                    <label className="flex items-baseline gap-3 font-semibold">
                      <input
                        type="checkbox"
                        className="size-5 shrink-0 translate-y-1 accent-accent"
                        checked={Boolean(item)}
                        disabled={isBusy || isAccepted}
                        onChange={() => toggle(option)}
                      />
                      {option.name}
                    </label>
                    <span aria-hidden="true" className="min-w-4 flex-1 border-b border-dotted border-field" />
                    <span className="font-display font-semibold whitespace-nowrap tabular-nums">
                      {item && line ? rupees(line.monthly_inr) : `+${rupees(option.monthly_inr)}`}
                    </span>
                  </div>
                  <div className="mt-1 ml-8 flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
                    <span>{t(option.reason)}</span>
                    {item && (
                      <span className="flex items-center gap-2">
                        <button
                          type="button"
                          aria-label={`Fewer ${option.name}`}
                          disabled={isBusy || isAccepted || item.quantity === 1}
                          className="size-9 border border-field font-semibold text-ink disabled:opacity-40"
                          onClick={() => changeQuantity(option.product_id, -1)}
                        >
                          −
                        </button>
                        <span aria-label="Quantity" className="w-6 text-center font-semibold text-ink tabular-nums">
                          {item.quantity}
                        </span>
                        <button
                          type="button"
                          aria-label={`More ${option.name}`}
                          disabled={isBusy || isAccepted}
                          className="size-9 border border-field font-semibold text-ink disabled:opacity-40"
                          onClick={() => changeQuantity(option.product_id, 1)}
                        >
                          +
                        </button>
                      </span>
                    )}
                  </div>
                  {option.detail && (
                    <div className="ml-8">
                      <ProductDetailPanel
                        productId={option.product_id}
                        name={option.name}
                        detail={option.detail}
                        liveLine={item ? line : undefined}
                        billTotal={quote?.monthly_total_inr ?? 0}
                        bundleUnchanged={bundleUnchanged}
                      />
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {recommendation.alternatives.length > 0 && (
        <section className="panel mt-6">
          <h2 className="font-display text-lg font-semibold">{t('Other ways to build it')}</h2>
          <ul className="mt-2 space-y-2">
            {recommendation.alternatives.map((alternative) => (
              <li key={alternative.quote.lines.map((line) => line.product_id).join()}>
                <button
                  type="button"
                  disabled={isBusy || isAccepted}
                  className="text-left underline underline-offset-4 disabled:opacity-60"
                  onClick={() => changeBundle(itemsFrom(alternative))}
                >
                  {alternative.quote.lines.map((line) => line.name).join(' + ')}: {rupees(alternative.quote.monthly_total_inr)} {t('a month')}
                </button>
                {bundle && <p className="text-sm text-muted">{alternativeDifference(alternative, bundle, t, hindi)}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {recommendation.not_included.length > 0 && (
        <section className="notice-warn mt-6">
          <h2 className="font-display text-xl font-semibold">{t('What we could not include')}</h2>
          <ul className="mt-1 space-y-1">
            {recommendation.not_included.flatMap((entry) =>
              entry.reasons.map((reason) => <li key={reason}>{reason}.</li>),
            )}
          </ul>
        </section>
      )}

      {recommendation.assisted_reasons.length > 0 && (
        <section className="notice mt-6">
          <h2 className="font-display text-xl font-semibold">{t('Our team will need to help with this')}</h2>
          <ul className="mt-1 space-y-1">
            {recommendation.assisted_reasons.map((reason) => (
              <li key={reason}>{reason}.</li>
            ))}
          </ul>
        </section>
      )}

      {(recommendation.assisted_reasons.length > 0 || recommendation.not_included.length > 0) && (
        <section className="mt-4">
          <PhoneRequest
            buttonText="Ask our team to call me"
            doneText="Request sent. Our team will call you."
            onSend={(phone) => requestCallback(profile, city, phone)}
          />
        </section>
      )}

      {/* An owner-built plan has no recommender score, so there is nothing to explain here. */}
      {bundle && recommendation.chosen_by !== 'owner' && (
        <details className="mt-8 text-sm">
          <summary className="cursor-pointer font-semibold">{t('How we chose this bundle')}</summary>
          <ul className="mt-2 space-y-2 text-muted">
            <li>
              Covers what you asked for: {bundle.score.needs_covered} of 60 points
              {score && <span className="block text-ink">{score.needs}</span>}
            </li>
            <li>
              Suits your business size: {bundle.score.size_fit} of 30 points
              {score && <span className="block text-ink">{score.size}</span>}
            </li>
            <li>
              Simple to run: {bundle.score.simplicity} of 10 points
              {score && <span className="block text-ink">{score.simple}</span>}
            </li>
          </ul>
        </details>
      )}

      <button type="button" className="mt-8 font-medium text-accent underline underline-offset-4" onClick={onBack}>
        {t(recommendation.chosen_by === 'owner' ? 'Change my plan' : 'Change my answers')}
      </button>

      {quote && (
        <div className="sticky-bar sticky bottom-0 -mx-4 mt-8">
          <div className="px-4 py-3">
            {message && (
              <p role="alert" className="notice-error mb-2 text-sm font-medium">
                {message}
              </p>
            )}
            <div className="flex items-center justify-between gap-3">
              <div aria-live="polite">
                <p className="font-display text-2xl leading-tight font-semibold tabular-nums">
                  {rupees(quote.monthly_total_inr)} {t('a month')}
                </p>
                <p className="text-sm text-muted">
                  {quote.setup_total_inr > 0 ? `${rupees(quote.setup_total_inr)} ${t('one-time setup')}` : t('No setup fee')}.{' '}
                  {quote.contract_months} {t('month contract')}. {t('Ready in about')} {quote.install_days}{' '}
                  {t(quote.install_days === 1 ? 'day' : 'days')}. {t('Taxes as applicable.')}
                </p>
                {overBudgetBy > 0 && (
                  <p className="text-sm font-semibold">{rupees(overBudgetBy)} {t('over your')} {rupees(budget!)} {t('budget')}</p>
                )}
              </div>
              {isAccepted ? (
                <button type="button" className="shrink-0 bg-accent px-4 py-3 font-semibold text-white" onClick={onViewOrder}>
                  {t('View my order')}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={isBusy}
                  className="shrink-0 bg-accent px-4 py-3 font-semibold text-white disabled:opacity-60"
                  onClick={accept}
                >
                  {t('Accept quote')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
