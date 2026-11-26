import { useState } from 'react'
import { ArrowRight, CalendarDays, ChevronDown, Clock, Minus, Plus, Sparkles, TriangleExclamationPoint, Users } from 'lucide-react'
import PhoneRequest from './PhoneRequest'
import ProductIcon from './ProductIcon'
import AnimatedNumber from './ui/AnimatedNumber'
import Badge from './ui/Badge'
import Button from './ui/Button'
import { cx } from './ui/cx'
import Switch from './ui/Switch'
import ProductDetailPanel from './ProductDetailPanel'
import { useLanguage } from './i18n'
import { priceBundle, replaceAcceptedQuote, requestCallback, saveQuote, type BundleItem, type ProductDetail, type Profile, type Quote, type Recommendation, type RecommendedBundle, type SavedQuote } from './api'
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
  // The order this quote would replace. Set while the owner has an order that is not placed yet,
  // so accepting changes that order (and keeps its documents) instead of starting a second one.
  replaceOrderId?: number
}

export default function QuotePage({ profile, recommendation, city, isAccepted, onBack, onViewOrder, onSaved, replaceOrderId }: Props) {
  // An accepted quote is read-only until the owner chooses to change it.
  const [isEditing, setIsEditing] = useState(false)
  const readOnly = isAccepted && !isEditing
  const canChangeAccepted = isAccepted && replaceOrderId !== undefined
  const { t, language } = useLanguage()
  const hindi = language === 'hi'
  const bundle = recommendation.bundle
  const [items, setItems] = useState<BundleItem[]>(bundle ? itemsFrom(bundle) : [])
  const [quote, setQuote] = useState<Quote | null>(bundle ? bundle.quote : null)
  const [isBusy, setIsBusy] = useState(false)
  // Saving shows a spinner on the button. Re-pricing after a switch does not, so it never looks like
  // the quote is being accepted when it is not.
  const [isSaving, setIsSaving] = useState(false)
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
    setIsSaving(true)
    setMessage('')
    try {
      const chosenBy = recommendation.chosen_by ?? 'advisor'
      onSaved(
        replaceOrderId !== undefined
          ? await replaceAcceptedQuote(replaceOrderId, profile, items, city, chosenBy)
          : await saveQuote(profile, items, city, chosenBy),
      )
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The quote could not be saved. Try again.')
      setIsBusy(false)
      setIsSaving(false)
    }
  }

  const budget = profile.budget_monthly_inr
  const overBudgetBy = budget && quote ? quote.monthly_total_inr - budget : 0
  const bundleUnchanged = bundle ? sameItems(items, itemsFrom(bundle)) : false
  const score = bundle ? scoreSentences(bundle, profile.needs.length, hindi) : null

  return (
    <div className="pt-6">
      {/* ---------- The price: the one number this whole journey is about ---------- */}
      {quote && (
        <section aria-labelledby="price-title" className={cx('brand-mesh relative overflow-hidden rounded-card px-5 py-6 shadow-e3 sm:px-7 sm:py-7', isBusy && 'scanning')}>
          <span aria-hidden="true" className="absolute -top-12 -right-12 size-44 rounded-full bg-white/10" />
          <span aria-hidden="true" className="absolute -bottom-20 left-1/3 size-56 rounded-full bg-white/5" />
          <p id="price-title" className="relative text-small font-semibold text-white">
            {t('Your monthly price')}
          </p>
          <p className="relative mt-1 flex flex-wrap items-baseline gap-x-2">
            <AnimatedNumber
              value={quote.monthly_total_inr}
              countFrom={0}
              duration={0.9}
              format={rupees}
              className="text-[2.75rem] leading-none font-extrabold tracking-tight sm:text-[3.5rem]"
            />
            <span className="text-title-2 font-semibold text-white">{t('a month')}</span>
          </p>
          <ul className="relative mt-4 flex flex-wrap gap-2 text-small font-semibold">
            <li className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5">
              {quote.setup_total_inr > 0 ? `${rupees(quote.setup_total_inr)} ${t('one-time setup')}` : t('No setup fee')}
            </li>
            <li className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5">
              <CalendarDays aria-hidden="true" size={15} />
              {quote.contract_months} {t('month contract')}
            </li>
            <li className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5">
              <Clock aria-hidden="true" size={15} />
              {t('Ready in about')} {quote.install_days} {t(quote.install_days === 1 ? 'day' : 'days')}
            </li>
          </ul>
          {overBudgetBy > 0 && (
            <p className="relative mt-3 inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-small font-bold text-brand-700">
              <TriangleExclamationPoint aria-hidden="true" size={15} />
              {rupees(overBudgetBy)} {t('over your')} {rupees(budget!)} {t('budget')}
            </p>
          )}
        </section>
      )}

      <div className="mt-4 space-y-3">
      {readOnly && (
        <div className="notice-success">
          <p className="font-medium">{t('You accepted this quote.')}</p>
          {canChangeAccepted && (
            <button
              type="button"
              className="link"
              onClick={() => setIsEditing(true)}
            >
              {t('Change this quote')}
            </button>
          )}
        </div>
      )}
      {isEditing && (
        <div className="notice">
          <p className="font-medium">{t('You are changing your accepted quote. Your order and the documents you uploaded stay as they are.')}</p>
          <button
            type="button"
            disabled={isBusy}
            className="link disabled:opacity-60"
            onClick={() => {
              // Nothing was saved yet, so going back to the accepted quote is just showing it again.
              if (bundle) {
                setItems(itemsFrom(bundle))
                setQuote(bundle.quote)
              }
              setMessage('')
              setIsEditing(false)
            }}
          >
            {t('Keep it as it was')}
          </button>
        </div>
      )}
      {!isAccepted && replaceOrderId !== undefined && (
        <p className="notice font-medium">{t('Accepting this replaces the quote in your current order. Your documents stay as they are.')}</p>
      )}
      </div>

      {recommendation.explanation && (
        <div className="mt-4 flex gap-3 rounded-card bg-white px-4 py-4 shadow-e1 sm:px-5">
          <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600">
            <Sparkles size={18} />
          </span>
          <p className="max-w-[62ch] pt-1">{recommendation.explanation}</p>
        </div>
      )}

      {/* ---------- What is in the bundle: switches, quantities and the reason for each ---------- */}
      {bundle && (
        <section aria-labelledby="bundle-title" className="card mt-6">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="bundle-title" className="text-title-2 font-extrabold">
              {t('Your bundle')}
            </h2>
            <p className="text-small font-semibold text-ink-500">
              {items.length} {t(items.length === 1 ? 'service in your plan' : 'services in your plan')}
            </p>
          </div>
          <ul className="mt-3 divide-y divide-ink-100">
            {shownOptions.map((option) => {
              const item = items.find((i) => i.product_id === option.product_id)
              const line = quote?.lines.find((l) => l.product_id === option.product_id)
              const isOn = Boolean(item)
              return (
                <li key={option.product_id} className="py-4">
                  <div className="flex items-start gap-3">
                    <span
                      aria-hidden="true"
                      className={cx(
                        'mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-control transition-colors duration-200',
                        isOn ? 'bg-brand-50 text-brand-600' : 'bg-ink-100 text-ink-500',
                      )}
                    >
                      <ProductIcon productId={option.product_id} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={cx('font-bold leading-snug break-words', !isOn && 'text-ink-600')}>{option.name}</p>
                      <p className="mt-0.5 text-small text-ink-500">{t(option.reason)}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end">
                      <span className={cx('font-extrabold whitespace-nowrap tabular-nums', !isOn && 'text-ink-500')}>
                        {item && line ? <AnimatedNumber value={line.monthly_inr} format={rupees} duration={0.4} /> : `+${rupees(option.monthly_inr)}`}
                      </span>
                      <Switch checked={isOn} label={option.name} disabled={isBusy || readOnly} onChange={() => toggle(option)} className="-mr-1.5" />
                    </div>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center justify-between gap-2 pl-14">
                    {item ? (
                      <div className="inline-flex items-center rounded-full bg-ink-100 p-0.5">
                        <button
                          type="button"
                          aria-label={`${t('Fewer')} ${option.name}`}
                          disabled={isBusy || readOnly || item.quantity === 1}
                          className="flex size-11 items-center justify-center rounded-full text-ink-800 transition-transform active:scale-90 enabled:hover:bg-white disabled:opacity-35"
                          onClick={() => changeQuantity(option.product_id, -1)}
                        >
                          <Minus aria-hidden="true" size={18} />
                        </button>
                        <span aria-label={t('Quantity')} className="w-8 text-center font-bold tabular-nums">
                          {item.quantity}
                        </span>
                        <button
                          type="button"
                          aria-label={`${t('More')} ${option.name}`}
                          disabled={isBusy || readOnly}
                          className="flex size-11 items-center justify-center rounded-full text-ink-800 transition-transform active:scale-90 enabled:hover:bg-white disabled:opacity-35"
                          onClick={() => changeQuantity(option.product_id, 1)}
                        >
                          <Plus aria-hidden="true" size={18} />
                        </button>
                      </div>
                    ) : (
                      <Badge tone="brand" icon={<Plus size={13} strokeWidth={3} />}>
                        {t('Add-on')}
                      </Badge>
                    )}
                  </div>
                  {option.detail && (
                    <div className="pl-14">
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

          {/* The full sum, line by line, for owners who want to check it. */}
          {quote && quote.lines.length > 0 && (
            <details className="group mt-2 rounded-control bg-ink-50">
              <summary className="flex min-h-12 cursor-pointer items-center justify-between gap-2 px-4 font-semibold">
                {t('See the full breakdown')}
                <ChevronDown aria-hidden="true" size={18} className="transition-transform duration-200 group-open:rotate-180" />
              </summary>
              <table className="w-full px-4 text-small">
                <caption className="sr-only">{t('See the full breakdown')}</caption>
                <tbody>
                  {quote.lines.map((line) => (
                    <tr key={line.product_id} className="border-t border-ink-200/70">
                      <th scope="row" className="py-2 pr-2 pl-4 text-left font-medium break-words">
                        {line.name}
                        <span className="block text-caption text-ink-500 tabular-nums">
                          {rupees(line.unit_price_inr)} × {line.quantity}
                          {line.setup_inr > 0 ? ` · ${rupees(line.setup_inr)} ${t('one time')}` : ''}
                        </span>
                      </th>
                      <td className="py-2 pr-4 text-right align-top font-bold whitespace-nowrap tabular-nums">{rupees(line.monthly_inr)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-ink-300">
                    <th scope="row" className="py-2.5 pl-4 text-left font-extrabold">
                      {t('a month')}
                    </th>
                    <td className="py-2.5 pr-4 text-right font-extrabold tabular-nums">{rupees(quote.monthly_total_inr)}</td>
                  </tr>
                  {quote.setup_total_inr > 0 && (
                    <tr>
                      <th scope="row" className="pb-3 pl-4 text-left font-semibold text-ink-600">
                        {t('one-time setup')}
                      </th>
                      <td className="pr-4 pb-3 text-right font-bold tabular-nums">{rupees(quote.setup_total_inr)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </details>
          )}
        </section>
      )}

      {recommendation.alternatives.length > 0 && (
        <section aria-labelledby="alternatives-title" className="mt-6">
          <h2 id="alternatives-title" className="text-title-2 font-extrabold">
            {t('Other ways to build it')}
          </h2>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {recommendation.alternatives.map((alternative) => (
              <li key={alternative.quote.lines.map((line) => line.product_id).join()}>
                <button
                  type="button"
                  disabled={isBusy || readOnly}
                  className="card card-interactive flex h-full w-full flex-col items-start gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => changeBundle(itemsFrom(alternative))}
                >
                  <span className="text-title-2 font-extrabold tabular-nums">
                    {rupees(alternative.quote.monthly_total_inr)} <span className="text-small font-semibold text-ink-500">{t('a month')}</span>
                  </span>
                  <span className="font-semibold break-words">{alternative.quote.lines.map((line) => line.name).join(' + ')}</span>
                  {bundle && <span className="text-small text-ink-500">{alternativeDifference(alternative, bundle, t, hindi)}</span>}
                  <span className="mt-auto inline-flex items-center gap-1 pt-1 text-small font-bold text-brand-700">
                    {t('Use this instead')}
                    <ArrowRight aria-hidden="true" size={16} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {recommendation.not_included.length > 0 && (
        <section className="notice-warn mt-6">
          <h2 className="font-bold">{t('What we could not include')}</h2>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {recommendation.not_included.flatMap((entry) =>
              entry.reasons.map((reason) => <li key={reason}>{reason}.</li>),
            )}
          </ul>
        </section>
      )}

      {recommendation.assisted_reasons.length > 0 && (
        <section className="notice mt-6">
          <h2 className="flex items-center gap-2 font-bold">
            <Users aria-hidden="true" size={18} />
            {t('Our team will need to help with this')}
          </h2>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {recommendation.assisted_reasons.map((reason) => (
              <li key={reason}>{reason}.</li>
            ))}
          </ul>
        </section>
      )}

      {(recommendation.assisted_reasons.length > 0 || recommendation.not_included.length > 0) && (
        <section className="mt-3">
          <PhoneRequest
            buttonText="Ask our team to call me"
            doneText="Request sent. Our team will call you."
            onSend={(phone) => requestCallback(profile, city, phone)}
          />
        </section>
      )}

      {/* An owner-built plan has no recommender score, so there is nothing to explain here. */}
      {bundle && recommendation.chosen_by !== 'owner' && (
        <details className="group card-flat mt-6 p-0!">
          <summary className="flex min-h-12 cursor-pointer items-center justify-between gap-2 px-5 py-3 font-bold">
            {t('How we chose this bundle')}
            <ChevronDown aria-hidden="true" size={18} className="transition-transform duration-200 group-open:rotate-180" />
          </summary>
          <ul className="space-y-4 px-5 pb-5 text-small">
            {[
              { label: 'Covers what you asked for', points: bundle.score.needs_covered, max: 60, sentence: score?.needs },
              { label: 'Suits your business size', points: bundle.score.size_fit, max: 30, sentence: score?.size },
              { label: 'Simple to run', points: bundle.score.simplicity, max: 10, sentence: score?.simple },
            ].map((part) => (
              <li key={part.label}>
                <p className="flex justify-between gap-2 font-semibold">
                  <span>{t(part.label)}</span>
                  <span className="text-ink-500 tabular-nums">
                    {part.points} / {part.max}
                  </span>
                </p>
                <span aria-hidden="true" className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-ink-100">
                  <span className="block h-full rounded-full bg-brand-600" style={{ width: `${(part.points / part.max) * 100}%` }} />
                </span>
                {part.sentence && <p className="mt-1.5 text-ink-600">{part.sentence}</p>}
              </li>
            ))}
          </ul>
        </details>
      )}

      <button type="button" className="link mt-6" onClick={onBack}>
        {t(recommendation.chosen_by === 'owner' ? 'Change my plan' : 'Change my answers')}
      </button>

      {/* ---------- The one main action, always in reach ---------- */}
      {quote && (
        <div className="sticky-bar sticky bottom-(--nav-offset) z-30 -mx-4 mt-6 md:mx-0 md:rounded-card">
          <div className="px-4 py-3 md:px-5">
            {message && (
              <p role="alert" className="notice-error mb-2 text-small font-medium">
                {message}
              </p>
            )}
            <div className="flex items-center justify-between gap-3">
              <div aria-live="polite" className="min-w-0">
                <p className="text-title-1 leading-tight font-extrabold">
                  <AnimatedNumber value={quote.monthly_total_inr} format={rupees} duration={0.5} />{' '}
                  <span className="text-small font-semibold text-ink-500">{t('a month')}</span>
                </p>
                <p className="text-caption text-ink-500">
                  {quote.setup_total_inr > 0 ? `${rupees(quote.setup_total_inr)} ${t('one-time setup')}` : t('No setup fee')}. {t('Taxes as applicable.')}
                </p>
              </div>
              {readOnly ? (
                <Button className="max-w-[58%] shrink-0" onClick={onViewOrder} iconAfter={<ArrowRight aria-hidden="true" size={18} />}>
                  {t('View my order')}
                </Button>
              ) : (
                <Button className="max-w-[58%] shrink-0" isLoading={isSaving} disabled={isBusy} onClick={accept} iconAfter={<ArrowRight aria-hidden="true" size={18} />}>
                  {t(replaceOrderId !== undefined ? 'Update my order' : 'Accept quote')}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
