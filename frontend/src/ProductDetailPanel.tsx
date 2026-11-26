import { useState, type ReactNode } from 'react'
import { ArrowUpRight, ChevronRight, CircleCheck, Info, Scale, Scissors } from 'lucide-react'
import { useLanguage } from './i18n'
import { type ProductDetail, type QuoteLine } from './api'
import { rupees } from './format'
import ProductIcon from './ProductIcon'
import Sheet from './ui/Sheet'

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

function Section({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-t border-ink-100 pt-4 first:border-t-0 first:pt-0">
      <h3 className="flex items-center gap-2 font-bold">
        {icon && <span aria-hidden="true" className="flex text-brand-600">{icon}</span>}
        {title}
      </h3>
      {children}
    </section>
  )
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="mt-2 space-y-1.5">
      {items.map((text) => (
        <li key={text} className="flex gap-2">
          <span aria-hidden="true" className="mt-2.5 size-1.5 shrink-0 rounded-full bg-ink-400" />
          <span>{text}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * "Why this? See details": opens a sheet that explains one product. It slides up from the bottom on a
 * phone and in from the right on a computer, and closes with Escape, the X, or a tap outside.
 */
export default function ProductDetailPanel({ productId, name, detail, liveLine, billTotal, bundleUnchanged }: Props) {
  const { t, language } = useLanguage()
  const [isOpen, setIsOpen] = useState(false)
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
  const label = t('Why this? See details')

  function shareText(share: number) {
    if (isOn) return hindi ? `आपके बिल का लगभग ${share}%` : `About ${share}% of your bill`
    return hindi ? `जोड़ने पर आपके बिल का लगभग ${share}%` : `Would be about ${share}% of your bill`
  }

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={`${label}: ${name}`}
        className="link -ml-0.5 text-small"
        onClick={() => setIsOpen(true)}
      >
        <Info aria-hidden="true" size={16} />
        {label}
        <ChevronRight aria-hidden="true" size={16} />
      </button>

      <Sheet
        open={isOpen}
        onClose={() => setIsOpen(false)}
        title={
          <span className="flex items-center gap-3">
            <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-control bg-brand-50 text-brand-600">
              <ProductIcon productId={productId} size={20} />
            </span>
            <span className="min-w-0 break-words">{name}</span>
          </span>
        }
        description={detail.what_you_get}
      >
        <div className="space-y-4">
          {price && (
            <div className="rounded-card bg-ink-50 p-4">
              <p className="text-title-1 font-extrabold tabular-nums">
                {rupees(price.monthly)} <span className="text-small font-semibold text-ink-500">{t('a month')}</span>
              </p>
              <ul className="mt-1 space-y-0.5 text-small text-ink-600 tabular-nums">
                {price.quantity > 1 && <li>{`${rupees(price.unit)} × ${price.quantity}`}</li>}
                <li>{price.setup > 0 ? `${rupees(price.setup)} ${t('one time')}` : t('No setup fee')}</li>
                {saved && (
                  <li>
                    {saved.range_min_inr === saved.range_max_inr
                      ? `${t('Price')}: ${rupees(saved.range_min_inr)} ${t('a month')}`
                      : `${t('Catalogue price range')}: ${rupees(saved.range_min_inr)}–${rupees(saved.range_max_inr)} ${t('a month')}`}
                  </li>
                )}
              </ul>
              {(isOn ? billTotal > 0 : price.share > 0) && (
                <div className="mt-3">
                  <p className="text-caption font-semibold text-ink-600">{shareText(price.share)}</p>
                  <span aria-hidden="true" className="mt-1 block h-1.5 overflow-hidden rounded-full bg-ink-200">
                    <span className="block h-full rounded-full bg-brand-600" style={{ width: `${Math.min(100, price.share)}%` }} />
                  </span>
                </div>
              )}
            </div>
          )}

          {(changedTo !== null || why.length > 0) && (
            <Section title={t('Why we chose it')} icon={<CircleCheck size={18} />}>
              <Bullets items={[...(changedTo !== null ? [`${t('You changed this to')} ${changedTo}.`] : []), ...why]} />
            </Section>
          )}

          {goodToKnow.length > 0 && (
            <Section title={t('Good to know')} icon={<Info size={18} />}>
              <Bullets items={goodToKnow} />
            </Section>
          )}

          {others.length > 0 && (
            <Section title={t('Why not other options')} icon={<Scale size={18} />}>
              <ul className="mt-2 space-y-2">
                {others.map((other) => (
                  <li key={other.product_id} className="rounded-control bg-ink-50 px-3 py-2.5">
                    <span className="block font-semibold">{other.name}</span>
                    <span className="text-small text-ink-600">{other.difference}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {bundleUnchanged && detail.upgrade && (
            <Section title={t('Upgrade later')} icon={<ArrowUpRight size={18} />}>
              <p className="mt-2">{detail.upgrade.note}</p>
            </Section>
          )}

          {bundleUnchanged && isOn && detail.if_removed && (
            <Section title={t('If you remove it')} icon={<Scissors size={18} />}>
              <p className="mt-2">{detail.if_removed}</p>
            </Section>
          )}
        </div>
      </Sheet>
    </>
  )
}
