import { useState, type ReactNode } from 'react'
import { useLanguage } from './i18n'
import { type ProductDetail, type QuoteLine } from './api'
import { rupees } from './format'

type Props = {
  productId: string
  name: string
  detail: ProductDetail
  // The product's line in the current quote, when it is switched on. Its numbers win over the detail's.
  liveLine?: QuoteLine
  billTotal: number
  // False once the owner has changed anything, because "saves ₹X" and the upgrade price were worked
  // out for the bundle as we suggested it.
  bundleUnchanged: boolean
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="font-semibold">{title}</h3>
      {children}
    </div>
  )
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="mt-1 list-disc space-y-1 pl-5">
      {items.map((text) => (
        <li key={text}>{text}</li>
      ))}
    </ul>
  )
}

/** "Why this? See details": a panel that explains one product. Closed until the owner opens it. */
export default function ProductDetailPanel({ productId, name, detail, liveLine, billTotal, bundleUnchanged }: Props) {
  const { t, language } = useLanguage()
  const [isOpen, setIsOpen] = useState(false)
  const panelId = `product-detail-${productId}`
  const hindi = language === 'hi'

  const isOn = Boolean(liveLine)
  const saved = detail.price
  // A switched-on product uses the live quote, so a changed quantity shows the right money.
  const price = liveLine
    ? {
        unit: liveLine.unit_price_inr,
        quantity: liveLine.quantity,
        monthly: liveLine.monthly_inr,
        setup: liveLine.setup_inr,
        share: billTotal > 0 ? Math.round((liveLine.monthly_inr * 100) / billTotal) : 0,
      }
    : saved
      ? { unit: saved.unit_price_inr, quantity: saved.quantity, monthly: saved.monthly_inr, setup: saved.setup_inr, share: saved.share_of_bill_pct }
      : null
  const changedTo = liveLine && saved && liveLine.quantity !== saved.quantity ? liveLine.quantity : null

  const why = detail.why ?? []
  const goodToKnow = detail.good_to_know ?? []
  const others = detail.why_not_others ?? []
  const label = t(isOpen ? 'Hide details' : 'Why this? See details')

  function shareText(share: number) {
    if (isOn) return hindi ? `आपके बिल का लगभग ${share}%` : `About ${share}% of your bill`
    return hindi ? `जोड़ने पर आपके बिल का लगभग ${share}%` : `Would be about ${share}% of your bill`
  }

  return (
    <div className="mt-1">
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={panelId}
        aria-label={`${label}: ${name}`}
        className="min-h-11 py-2 text-left font-medium text-accent underline underline-offset-4"
        onClick={() => setIsOpen((open) => !open)}
      >
        {label}
      </button>
      <div id={panelId} hidden={!isOpen} className="mb-2 space-y-3 border-l-2 border-rule pl-3 text-sm text-ink break-words">
        {(changedTo !== null || why.length > 0) && (
          <Section title={t('Why we chose it')}>
            <Bullets items={[...(changedTo !== null ? [`${t('You changed this to')} ${changedTo}.`] : []), ...why]} />
          </Section>
        )}

        {detail.what_you_get && (
          <Section title={t('What you get')}>
            <p className="mt-1">{detail.what_you_get}</p>
          </Section>
        )}

        {goodToKnow.length > 0 && (
          <Section title={t('Good to know')}>
            <Bullets items={goodToKnow} />
          </Section>
        )}

        {price && (
          <Section title={t('Price breakdown')}>
            <ul className="mt-1 space-y-1 tabular-nums">
              <li>
                {price.quantity > 1
                  ? `${rupees(price.unit)} × ${price.quantity} = ${rupees(price.monthly)} ${t('a month')}`
                  : `${rupees(price.monthly)} ${t('a month')}`}
              </li>
              <li>{price.setup > 0 ? `${rupees(price.setup)} ${t('one time')}` : t('No setup fee')}</li>
              {saved && (
                <li>
                  {saved.range_min_inr === saved.range_max_inr
                    ? `${t('Price')}: ${rupees(saved.range_min_inr)} ${t('a month')}`
                    : `${t('Catalogue price range')}: ${rupees(saved.range_min_inr)}–${rupees(saved.range_max_inr)} ${t('a month')}`}
                </li>
              )}
              {(isOn ? billTotal > 0 : price.share > 0) && <li>{shareText(price.share)}</li>}
            </ul>
          </Section>
        )}

        {others.length > 0 && (
          <Section title={t('Why not other options')}>
            <ul className="mt-1 space-y-1">
              {others.map((other) => (
                <li key={other.product_id}>
                  <span className="font-semibold">{other.name}:</span> {other.difference}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {bundleUnchanged && detail.upgrade && (
          <Section title={t('Upgrade later')}>
            <p className="mt-1">{detail.upgrade.note}</p>
          </Section>
        )}

        {bundleUnchanged && isOn && detail.if_removed && (
          <Section title={t('If you remove it')}>
            <p className="mt-1">{detail.if_removed}</p>
          </Section>
        )}
      </div>
    </div>
  )
}
