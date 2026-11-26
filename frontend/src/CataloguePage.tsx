import { useEffect, useState } from 'react'
import { ArrowRight, CalendarDays, Clock, Minus, Plus, Search, Users, Wrench, X } from 'lucide-react'
import PlanReview from './PlanReview'
import { fetchProducts, type Product, type Profile, type Recommendation } from './api'
import { rupees } from './format'
import { useLanguage } from './i18n'
import ProductIcon from './ProductIcon'
import AnimatedNumber from './ui/AnimatedNumber'
import Badge from './ui/Badge'
import Button from './ui/Button'
import Chip from './ui/Chip'
import { cx } from './ui/cx'
import EmptyState from './ui/EmptyState'
import IconButton from './ui/IconButton'
import Sheet from './ui/Sheet'
import { Skeleton, SkeletonText } from './ui/Skeleton'

// The owner's plan: product id -> quantity.
export type Plan = Record<string, number>

type T = (text: string) => string

// The same price rule the server uses: the middle of the range, half-rupees rounded up.
// The server sets the final price. This is only to show a running estimate.
function estimatedPrice(product: Product) {
  return Math.floor((product.price_min_inr + product.price_max_inr + 1) / 2)
}

// The basic facts every product has, each as a short line.
function buyingFacts(product: Product, t: T, hindi: boolean) {
  const days = product.install_days
  return [
    product.setup_fee_inr > 0 ? `${rupees(product.setup_fee_inr)} ${t('one-time setup')}` : t('No setup fee'),
    hindi ? `कम से कम ${product.min_contract_months} महीने` : `${product.min_contract_months}-month minimum`,
    `${t('Ready in about')} ${days} ${t(days === 1 ? 'day' : 'days')}`,
  ]
}

// Only the conditions that apply to this product, in plain words.
function conditions(product: Product, allProducts: Product[], t: T, hindi: boolean) {
  const list: string[] = []
  if (product.requires_gstin) list.push(t('Needs an active GSTIN'))
  if (!product.city_tiers.includes(2)) list.push(t('Only in tier 1 cities'))
  if (product.min_employees > 1) list.push(hindi ? `${product.min_employees}+ कर्मचारियों के लिए` : `For ${product.min_employees}+ employees`)
  if (product.min_sites > 1) list.push(hindi ? `${product.min_sites}+ जगहों के लिए` : `For ${product.min_sites}+ sites`)
  if (product.requires_one_of.length > 0) {
    const names = product.requires_one_of.map((id) => allProducts.find((other) => other.product_id === id)?.name ?? id)
    list.push(hindi ? `इनके साथ चलता है: ${names.join(', ')}` : `Works with ${names.join(', ')}`)
  }
  return list
}

// Who each product is made for, from the catalogue's target_segments, in plain words.
const SEGMENT_WORDS: Record<string, string> = {
  micro: 'shops and small service businesses',
  prof: 'offices such as clinics, CA firms and coaching centres',
  multi: 'businesses with 3 or more branches',
  mfg: 'factories and workshops',
}

function whoItSuits(product: Product, t: T) {
  return product.target_segments
    .map((segment) => SEGMENT_WORDS[segment])
    .filter((words): words is string => Boolean(words))
    .map((words) => t(words))
}

// Minus, the number, plus. Each button is 44px, so it is easy to tap.
function QuantityStepper({ product, quantity, onChange }: { product: Product; quantity: number; onChange: (quantity: number) => void }) {
  const { t } = useLanguage()
  return (
    <div className="inline-flex items-center rounded-full bg-ink-100 p-0.5">
      <IconButton label={`${t('Fewer')} ${product.name}`} className="hover:bg-white" onClick={() => onChange(quantity - 1)}>
        <Minus aria-hidden="true" size={18} />
      </IconButton>
      <span aria-label={t('Quantity')} className="w-8 text-center font-bold tabular-nums">
        {quantity}
      </span>
      <IconButton label={`${t('More')} ${product.name}`} className="hover:bg-white" onClick={() => onChange(quantity + 1)}>
        <Plus aria-hidden="true" size={18} />
      </IconButton>
    </div>
  )
}

type CardProps = {
  product: Product
  quantity: number
  onChange: (quantity: number) => void
  onOpen: () => void
}

function ProductCard({ product, quantity, onChange, onOpen }: CardProps) {
  const { t, language } = useLanguage()
  const isInPlan = quantity > 0
  const facts = buyingFacts(product, t, language === 'hi')
  return (
    <li
      className={cx(
        'card card-interactive flex flex-col transition-shadow duration-200',
        isInPlan && 'shadow-e3 ring-2 ring-brand-600',
      )}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={cx('flex size-11 shrink-0 items-center justify-center rounded-control', isInPlan ? 'bg-brand-600 text-white' : 'bg-brand-50 text-brand-600')}
        >
          <ProductIcon productId={product.product_id} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-bold leading-snug break-words">{product.name}</h3>
          <p className="mt-0.5 text-title-2 font-extrabold tabular-nums">
            {rupees(product.price_min_inr)}
            {product.price_max_inr !== product.price_min_inr && `–${rupees(product.price_max_inr)}`}
          </p>
          <p className="text-caption text-ink-500">
            {t('a month')}, {product.unit}
          </p>
        </div>
      </div>
      <p className="mt-3 line-clamp-2 text-small text-ink-700">{product.description}</p>
      <ul className="mt-3 flex flex-wrap gap-1.5 text-caption font-semibold text-ink-600">
        {facts.map((fact, index) => (
          <li key={fact} className="inline-flex items-center gap-1 rounded-full bg-ink-50 px-2.5 py-1">
            {[<Wrench key="w" aria-hidden="true" size={13} />, <CalendarDays key="c" aria-hidden="true" size={13} />, <Clock key="t" aria-hidden="true" size={13} />][index]}
            {fact}
          </li>
        ))}
      </ul>

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-4">
        <button type="button" className="link text-small" aria-haspopup="dialog" aria-label={`${t('Details')}: ${product.name}`} onClick={onOpen}>
          {t('Details')}
        </button>
        {isInPlan ? (
          <QuantityStepper product={product} quantity={quantity} onChange={onChange} />
        ) : (
          <Button size="sm" variant="secondary" icon={<Plus aria-hidden="true" size={18} />} aria-label={`${t('Add to my plan')}: ${product.name}`} onClick={() => onChange(1)}>
            {t('Add to my plan')}
          </Button>
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
  const { t, language } = useLanguage()
  const hindi = language === 'hi'
  const [products, setProducts] = useState<Product[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [hasFailed, setHasFailed] = useState(false)
  const [isReviewing, setIsReviewing] = useState(false)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

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
  const words = query.trim().toLowerCase()
  const shown = products.filter(
    (product) =>
      (!category || product.category === category) &&
      (!words || `${product.name} ${product.description} ${product.category}`.toLowerCase().includes(words)),
  )
  const opened = products.find((product) => product.product_id === openId)

  function setQuantity(productId: string, quantity: number) {
    const next = { ...plan }
    if (quantity > 0) next[productId] = quantity
    else delete next[productId]
    onPlanChange(next)
    if (Object.keys(next).length === 0) setIsReviewing(false)
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-16 md:px-6">
      {/* Search and filters stay under the top bar while the list scrolls. */}
      {products.length > 0 && (
        <div className="sticky top-16 z-20 -mx-4 mt-4 bg-ink-50/90 px-4 pt-2 pb-3 backdrop-blur md:-mx-6 md:px-6">
          <div className="relative">
            <Search aria-hidden="true" size={20} className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-ink-500" />
            <label htmlFor="rate-search" className="sr-only">
              {t('Search services')}
            </label>
            <input
              id="rate-search"
              type="search"
              className="input rounded-full! border-ink-200! bg-white pl-12 shadow-e1"
              placeholder={t('Search services')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div role="group" aria-label={t('Product types')} className="scrollbar-none -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
            <Chip selected={category === null} onClick={() => setCategory(null)}>
              {t('All')}
            </Chip>
            {categories.map((name) => (
              <Chip key={name} selected={category === name} onClick={() => setCategory(category === name ? null : name)}>
                {name}
              </Chip>
            ))}
          </div>
        </div>
      )}

      {isLoading && (
        <div role="status" className="mt-6">
          <span className="sr-only">{t('Loading the rate list…')}</span>
          <ul aria-hidden="true" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, index) => (
              <li key={index} className="card space-y-3">
                <div className="flex gap-3">
                  <Skeleton className="size-11 rounded-control" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-6 w-1/2" />
                  </div>
                </div>
                <SkeletonText lines={2} />
                <Skeleton className="h-11 w-full rounded-control" />
              </li>
            ))}
          </ul>
        </div>
      )}

      {hasFailed && (
        <EmptyState
          role="alert"
          picture="offline"
          title={t('The rate list did not load.')}
          text={t('The rate list did not load. Check that the backend is running, then reload this page.')}
          action={
            <Button variant="secondary" onClick={() => window.location.reload()}>
              {t('Try again')}
            </Button>
          }
        />
      )}

      {!isLoading && !hasFailed && products.length === 0 && (
        <EmptyState picture="box" title={t('Nothing here yet')} text={t('The rate list is empty. In the backend folder, run python -m app.import_data, then reload this page.')} />
      )}

      {products.length > 0 && <p className="mt-4 max-w-[62ch] text-ink-500">{t('Pick the services you want, then review your plan to see your exact price.')}</p>}

      {products.length > 0 && shown.length === 0 && (
        <EmptyState
          picture="search"
          title={t('No services match your search')}
          text={t('Try another word, or see every service.')}
          action={
            <Button
              variant="secondary"
              icon={<X aria-hidden="true" size={18} />}
              onClick={() => {
                setQuery('')
                setCategory(null)
              }}
            >
              {t('Show all services')}
            </Button>
          }
        />
      )}

      {shown.length > 0 && (
        <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((product) => (
            <ProductCard
              key={product.product_id}
              product={product}
              quantity={plan[product.product_id] ?? 0}
              onChange={(quantity) => setQuantity(product.product_id, quantity)}
              onOpen={() => setOpenId(product.product_id)}
            />
          ))}
        </ul>
      )}

      {/* Everything about one product, in a sheet, with the same add and quantity controls. */}
      <Sheet
        open={Boolean(opened)}
        onClose={() => setOpenId(null)}
        title={opened?.name ?? ''}
        description={opened?.description}
        footer={
          opened && (
            <div className="flex items-center justify-between gap-3">
              <p className="text-title-2 font-extrabold tabular-nums">
                {rupees(opened.price_min_inr)}
                {opened.price_max_inr !== opened.price_min_inr && `–${rupees(opened.price_max_inr)}`}
                <span className="block text-caption font-semibold text-ink-500">
                  {t('a month')}, {opened.unit}
                </span>
              </p>
              {(plan[opened.product_id] ?? 0) > 0 ? (
                <QuantityStepper product={opened} quantity={plan[opened.product_id]} onChange={(quantity) => setQuantity(opened.product_id, quantity)} />
              ) : (
                <Button icon={<Plus aria-hidden="true" size={18} />} onClick={() => setQuantity(opened.product_id, 1)}>
                  {t('Add to my plan')}
                </Button>
              )}
            </div>
          )
        }
      >
        {opened && (
          <div className="space-y-5">
            {whoItSuits(opened, t).length > 0 && (
              <section>
                <h3 className="flex items-center gap-2 font-bold">
                  <Users aria-hidden="true" size={18} className="text-brand-600" />
                  {t('Who it suits:')}
                </h3>
                <p className="mt-1 text-ink-700">{whoItSuits(opened, t).join('; ')}.</p>
              </section>
            )}
            <section>
              <h3 className="font-bold">{t('Good to know')}</h3>
              <ul className="mt-2 space-y-1.5">
                {buyingFacts(opened, t, hindi).map((fact) => (
                  <li key={fact} className="flex gap-2">
                    <span aria-hidden="true" className="mt-2.5 size-1.5 shrink-0 rounded-full bg-ink-400" />
                    {fact}
                  </li>
                ))}
              </ul>
            </section>
            {conditions(opened, products, t, hindi).length > 0 && (
              <section>
                <h3 className="font-bold">{t('Before you choose it')}</h3>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {conditions(opened, products, t, hindi).map((condition) => (
                    <li key={condition}>
                      <Badge tone="warn" className="whitespace-normal!">
                        {condition}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </Sheet>

      {chosen.length > 0 && (
        <div className="sticky-bar sticky bottom-(--nav-offset) z-30 -mx-4 mt-8 px-4 py-3 md:mx-0 md:rounded-card md:px-5">
          {isReviewing ? (
            <PlanReview plan={plan} products={chosen} onCancel={() => setIsReviewing(false)} onReviewed={onReviewed} />
          ) : (
            <div className="flex items-center justify-between gap-3">
              <div aria-live="polite" className="min-w-0">
                <p className="text-title-1 leading-tight font-extrabold">
                  <span className="text-small font-semibold text-ink-500">{t('About')} </span>
                  <AnimatedNumber value={estimate} format={rupees} duration={0.4} />{' '}
                  <span className="text-small font-semibold text-ink-500">{t('a month')}</span>
                </p>
                <p className="text-caption text-ink-500">
                  {chosen.length} {t(chosen.length === 1 ? 'service in your plan' : 'services in your plan')}
                </p>
              </div>
              <Button className="max-w-[58%] shrink-0" iconAfter={<ArrowRight aria-hidden="true" size={18} />} onClick={() => setIsReviewing(true)}>
                {t('Review my plan')}
              </Button>
            </div>
          )}
        </div>
      )}
    </main>
  )
}
