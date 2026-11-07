import { useEffect, useState } from 'react'
import PlanReview from './PlanReview'
import { fetchProducts, type Product, type Profile, type Recommendation } from './api'
import { rupees } from './format'
import { useLanguage } from './i18n'

// The owner's plan: product id -> quantity.
export type Plan = Record<string, number>

function sectionId(category: string) {
  return `category-${category.toLowerCase().replace(/[^a-z]+/g, '-')}`
}

// The same price rule the server uses: the middle of the range, half-rupees rounded up.
// The server sets the final price. This is only to show a running estimate.
function estimatedPrice(product: Product) {
  return Math.floor((product.price_min_inr + product.price_max_inr + 1) / 2)
}

// The basic facts every product has.
function buyingFacts(product: Product) {
  const setup = product.setup_fee_inr > 0 ? `${rupees(product.setup_fee_inr)} one-time setup` : 'No setup fee'
  const days = product.install_days === 1 ? '1 day' : `${product.install_days} days`
  return `${setup}. ${product.min_contract_months}-month minimum. Ready in about ${days}.`
}

// Only the conditions that apply to this product, in plain words.
function conditions(product: Product, allProducts: Product[]) {
  const list: string[] = []
  if (product.requires_gstin) list.push('Needs an active GSTIN')
  if (!product.city_tiers.includes(2)) list.push('Only in tier 1 cities')
  if (product.min_employees > 1) list.push(`For ${product.min_employees}+ employees`)
  if (product.min_sites > 1) list.push(`For ${product.min_sites}+ sites`)
  if (product.requires_one_of.length > 0) {
    const names = product.requires_one_of.map((id) => allProducts.find((other) => other.product_id === id)?.name ?? id)
    list.push(`Works with ${names.join(', ')}`)
  }
  return list
}

type RowProps = {
  product: Product
  allProducts: Product[]
  quantity: number
  onChange: (quantity: number) => void
}

function ProductRow({ product, allProducts, quantity, onChange }: RowProps) {
  const { t } = useLanguage()
  const needs = conditions(product, allProducts)
  const isInPlan = quantity > 0
  return (
    <li className={`py-4 ${isInPlan ? '-mx-3 border-l-4 border-marigold bg-white px-3' : ''}`}>
      {/* The dotted line between name and price is the look of a shop's rate list. */}
      <div className="flex items-baseline gap-2">
        <h3 className="text-lg leading-snug font-semibold">{product.name}</h3>
        <span aria-hidden="true" className="min-w-4 flex-1 border-b-2 border-dotted border-rule" />
        <p className="font-display text-lg font-semibold whitespace-nowrap tabular-nums">
          {rupees(product.price_min_inr)}–{rupees(product.price_max_inr)}
        </p>
      </div>
      <p className="text-right text-sm text-muted">
        {t('a month')}, {product.unit}
      </p>
      <p className="mt-1 max-w-[62ch]">{product.description}</p>
      <p className="mt-1 max-w-[62ch] text-sm text-muted">{buyingFacts(product)}</p>
      {needs.length > 0 && <p className="mt-2 max-w-[62ch] border-l-4 border-marigold pl-2 text-sm">{needs.join('. ')}.</p>}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {isInPlan ? (
          <>
            <span className="font-semibold">
              <span aria-hidden="true">✓ </span>
              {t('In your plan')}
            </span>
            <span className="flex items-center gap-2">
              <button
                type="button"
                aria-label={`${t('Fewer')} ${product.name}`}
                className="size-9 border-2 border-ink font-bold"
                onClick={() => onChange(quantity - 1)}
              >
                −
              </button>
              <span aria-label={t('Quantity')} className="w-6 text-center font-semibold tabular-nums">
                {quantity}
              </span>
              <button
                type="button"
                aria-label={`${t('More')} ${product.name}`}
                className="size-9 border-2 border-ink font-bold"
                onClick={() => onChange(quantity + 1)}
              >
                +
              </button>
            </span>
            <button type="button" className="text-sm font-semibold underline underline-offset-4" onClick={() => onChange(0)}>
              {t('Remove')}
            </button>
          </>
        ) : (
          <button
            type="button"
            aria-label={`${t('Add to my plan')}: ${product.name}`}
            className="border-2 border-ink px-4 py-1.5 font-semibold hover:bg-ink hover:text-paper"
            onClick={() => onChange(1)}
          >
            + {t('Add to my plan')}
          </button>
        )}
      </div>
    </li>
  )
}

type Props = {
  plan: Plan
  onPlanChange: (plan: Plan) => void
  onReviewed: (profile: Profile, recommendation: Recommendation, city: string | null) => void
}

export default function CataloguePage({ plan, onPlanChange, onReviewed }: Props) {
  const { t } = useLanguage()
  const [products, setProducts] = useState<Product[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [hasFailed, setHasFailed] = useState(false)
  const [isReviewing, setIsReviewing] = useState(false)

  useEffect(() => {
    fetchProducts()
      .then(setProducts)
      .catch(() => setHasFailed(true))
      .finally(() => setIsLoading(false))
  }, [])

  // Set keeps the first time each category appears and removes repeats.
  const categories = [...new Set(products.map((product) => product.category))]
  const chosen = products.filter((product) => (plan[product.product_id] ?? 0) > 0)
  const estimate = chosen.reduce((sum, product) => sum + estimatedPrice(product) * plan[product.product_id], 0)

  function setQuantity(productId: string, quantity: number) {
    const next = { ...plan }
    if (quantity > 0) next[productId] = quantity
    else delete next[productId]
    onPlanChange(next)
    if (Object.keys(next).length === 0) setIsReviewing(false)
  }

  // Scrolls to a section without changing the page address. A "#section" address would be
  // read as a page of the app, which is what sent these links to the advisor before.
  function jumpTo(category: string) {
    // People who ask their device for less motion get an instant jump instead of a smooth scroll.
    const lessMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    document.getElementById(sectionId(category))?.scrollIntoView({ behavior: lessMotion ? 'auto' : 'smooth', block: 'start' })
  }

  return (
    <>
      {categories.length > 0 && (
        <nav aria-label={t('Product types')} className="sticky top-0 z-10 border-b border-rule bg-paper">
          <ul className="mx-auto flex max-w-3xl gap-5 overflow-x-auto px-4 py-3 whitespace-nowrap">
            {categories.map((category) => (
              <li key={category}>
                <button type="button" className="font-semibold underline underline-offset-4" onClick={() => jumpTo(category)}>
                  {category}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <main className="mx-auto w-full max-w-3xl px-4 pb-16">
        {isLoading && <p className="py-8">{t('Loading the rate list…')}</p>}

        {hasFailed && (
          <p role="alert" className="py-8">
            {t('The rate list did not load. Check that the backend is running, then reload this page.')}
          </p>
        )}

        {!isLoading && !hasFailed && products.length === 0 && (
          <p className="py-8">{t('The rate list is empty. In the backend folder, run python -m app.import_data, then reload this page.')}</p>
        )}

        {products.length > 0 && <p className="mt-6 max-w-[62ch]">{t('Pick the services you want, then review your plan to see your exact price.')}</p>}

        {categories.map((category) => (
          <section key={category} id={sectionId(category)} className="mt-10 scroll-mt-16">
            <h2 className="border-b-4 border-ink font-display text-2xl font-bold sm:text-3xl">{category}</h2>
            <ul className="divide-y divide-rule">
              {products
                .filter((product) => product.category === category)
                .map((product) => (
                  <ProductRow
                    key={product.product_id}
                    product={product}
                    allProducts={products}
                    quantity={plan[product.product_id] ?? 0}
                    onChange={(quantity) => setQuantity(product.product_id, quantity)}
                  />
                ))}
            </ul>
          </section>
        ))}

        {chosen.length > 0 && (
          <div className="sticky bottom-0 -mx-4 mt-8 border-t-4 border-ink bg-paper px-4 py-3">
            {isReviewing ? (
              <PlanReview
                plan={plan}
                products={chosen}
                onCancel={() => setIsReviewing(false)}
                onReviewed={onReviewed}
              />
            ) : (
              <div className="flex items-center justify-between gap-3">
                <div aria-live="polite">
                  <p className="font-display text-xl leading-tight font-bold tabular-nums">
                    {t('About')} {rupees(estimate)} {t('a month')}
                  </p>
                  <p className="text-sm text-muted">
                    {chosen.length} {t(chosen.length === 1 ? 'service in your plan' : 'services in your plan')}
                  </p>
                </div>
                <button type="button" className="shrink-0 bg-ink px-4 py-3 font-semibold text-paper" onClick={() => setIsReviewing(true)}>
                  {t('Review my plan')}
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </>
  )
}
