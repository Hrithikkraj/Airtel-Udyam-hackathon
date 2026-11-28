import { useEffect, useState } from 'react'
import { ArrowRight, Bot, Building, CircleCheck, Pencil, Repeat, ShieldCheck, TriangleExclamationPoint } from 'lucide-react'
import { fetchCities, fetchShopAgain, reorderForBusiness, type City, type ConfirmedDetails, type Profile, type Recommendation, type ShopAgain } from './api'
import { useLanguage } from './i18n'
import Badge from './ui/Badge'
import Button from './ui/Button'
import EmptyState from './ui/EmptyState'
import { TextField } from './ui/Field'
import SegmentedControl from './ui/SegmentedControl'
import { Loading, Skeleton } from './ui/Skeleton'

type Props = {
  businessId: number
  // "Ask the advisor": the chat starts from the saved details, as confirmed or changed here.
  onAskAdvisor: (shop: ShopAgain, details: ConfirmedDetails) => void
  // "Reorder": the last order again, as a quote the owner can still change.
  onReorder: (shop: ShopAgain, details: ConfirmedDetails, profile: Profile, recommendation: Recommendation, city: string | null) => void
  onBack: () => void
}

type Step = 'confirm' | 'edit' | 'choose'

function detailsOf(shop: ShopAgain): ConfirmedDetails {
  return { employee_count: shop.employee_count, num_sites: shop.num_sites, city: shop.city, has_gstin: shop.has_gstin }
}

// Shopping again for a business the owner already has: check the saved details, then reorder or ask.
export default function ShopAgainPage({ businessId, onAskAdvisor, onReorder, onBack }: Props) {
  const { t, languageName } = useLanguage()
  const [shop, setShop] = useState<ShopAgain | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [cities, setCities] = useState<City[]>([])
  const [step, setStep] = useState<Step>('confirm')
  const [details, setDetails] = useState<ConfirmedDetails | null>(null)
  // What the owner types, kept as text so a field can be empty while they type.
  const [people, setPeople] = useState('')
  const [sites, setSites] = useState('')
  const [fieldProblem, setFieldProblem] = useState('')
  const [isReordering, setIsReordering] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    let isCurrent = true
    fetchShopAgain(businessId)
      .then((loaded) => {
        if (!isCurrent) return
        setShop(loaded)
        setDetails(detailsOf(loaded))
        setLoadFailed(false)
      })
      .catch(() => {
        if (isCurrent) setLoadFailed(true)
      })
    return () => {
      isCurrent = false
    }
  }, [businessId, attempt])

  useEffect(() => {
    fetchCities()
      .then(setCities)
      .catch(() => {}) // The city is still typed freely without the list.
  }, [])

  if (loadFailed) {
    return (
      <EmptyState
        role="alert"
        picture="offline"
        title={t('Your business details did not load. Check your connection, then try again.')}
        action={
          <>
            <Button onClick={() => setAttempt((count) => count + 1)}>{t('Try again')}</Button>
            <Button variant="secondary" onClick={onBack}>
              {t('Back to my profile')}
            </Button>
          </>
        }
      />
    )
  }

  if (!shop || !details) {
    return (
      <Loading label={t('Loading…')} className="space-y-4 py-6">
        <Skeleton className="h-40 w-full rounded-card" />
        <Skeleton className="h-28 w-full rounded-card" />
      </Loading>
    )
  }

  const name = shop.business_name || t('Your business')
  // Adding a GSTIN means the GST certificate is needed too, so verification is not skipped.
  const addsGstin = details.has_gstin && !shop.has_gstin
  const skipsVerification = shop.kyc_verified && !addsGstin

  function startEditing() {
    setPeople(String(details!.employee_count))
    setSites(String(details!.num_sites))
    setFieldProblem('')
    setStep('edit')
  }

  function saveEdits() {
    const employeeCount = Number(people)
    const numSites = Number(sites)
    if (!Number.isInteger(employeeCount) || employeeCount < 1 || !Number.isInteger(numSites) || numSites < 1) {
      setFieldProblem(t('Enter at least 1 person and 1 site.'))
      return
    }
    setDetails({ ...details!, employee_count: employeeCount, num_sites: numSites, city: details!.city?.trim() || null })
    setStep('choose')
  }

  async function reorder() {
    setIsReordering(true)
    setMessage('')
    try {
      const quote = await reorderForBusiness(shop!.business_id, details!, languageName)
      onReorder(shop!, details!, quote.profile, quote.recommendation, quote.city)
    } catch (error) {
      setMessage(error instanceof Error ? t(error.message) : t('That did not work. Try again.'))
      setIsReordering(false)
    }
  }

  const facts = [
    details.city,
    `${details.employee_count} ${t(details.employee_count === 1 ? 'person' : 'people')}`,
    `${details.num_sites} ${t(details.num_sites === 1 ? 'site' : 'sites')}`,
    `GSTIN: ${t(details.has_gstin ? 'Yes' : 'No')}`,
  ].filter((fact): fact is string => Boolean(fact))

  return (
    <div className="space-y-5 py-6">
      {/* ---------- Is this still right? ---------- */}
      <section className="card" aria-labelledby="shop-details-title">
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-control bg-brand-50 text-brand-600">
            <Building size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="shop-details-title" className="text-title-2 font-extrabold break-words">
              {name}
            </h2>
            {shop.business_type && <p className="text-small text-ink-500">{shop.business_type}</p>}
          </div>
          {shop.kyc_verified && (
            <Badge tone="success" icon={<ShieldCheck size={14} />}>
              {t('Verified')}
            </Badge>
          )}
        </div>

        {step === 'edit' ? (
          <div className="mt-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label={t('How many people work there?')}
                inputMode="numeric"
                className="bg-white"
                value={people}
                onChange={(event) => setPeople(event.target.value.replace(/\D/g, '').slice(0, 6))}
              />
              <TextField
                label={t('How many sites or branches?')}
                inputMode="numeric"
                className="bg-white"
                value={sites}
                onChange={(event) => setSites(event.target.value.replace(/\D/g, '').slice(0, 4))}
              />
              <TextField
                label={t('City')}
                maxLength={60}
                list="shop-again-cities"
                className="bg-white"
                value={details.city ?? ''}
                onChange={(event) => setDetails({ ...details, city: event.target.value })}
              />
              <datalist id="shop-again-cities">
                {cities.map((city) => (
                  <option key={city.city} value={city.city} />
                ))}
              </datalist>
              <div>
                <p className="field-label">{t('Does it have a GSTIN?')}</p>
                <SegmentedControl
                  label={t('Does it have a GSTIN?')}
                  value={details.has_gstin ? 'yes' : 'no'}
                  onChange={(value) => setDetails({ ...details, has_gstin: value === 'yes' })}
                  options={[
                    { value: 'yes', label: t('Yes') },
                    { value: 'no', label: t('No') },
                  ]}
                />
              </div>
            </div>
            {addsGstin && shop.kyc_verified && (
              <p className="notice flex items-start gap-2 text-small">
                <TriangleExclamationPoint aria-hidden="true" size={16} className="mt-0.5 shrink-0" />
                {t('With a GSTIN, we also need your GST certificate, so you will upload it before this order.')}
              </p>
            )}
            {fieldProblem && (
              <p role="alert" className="notice-error text-small">
                {fieldProblem}
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              <Button onClick={saveEdits}>{t('Save and continue')}</Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setDetails(detailsOf(shop))
                  setStep('confirm')
                }}
              >
                {t('Cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className="mt-4 font-semibold">{t(step === 'confirm' ? 'Is this still right?' : 'Your business details')}</p>
            <p className="mt-2 flex flex-wrap gap-1.5">
              {facts.map((fact) => (
                <span key={fact} className="rounded-full bg-ink-50 px-2.5 py-1 text-caption font-semibold text-ink-700 ring-1 ring-ink-200">
                  {fact}
                </span>
              ))}
            </p>
            {step === 'confirm' ? (
              <div className="mt-4 flex flex-wrap gap-3">
                <Button icon={<CircleCheck aria-hidden="true" size={18} />} onClick={() => setStep('choose')}>
                  {t('Yes, all correct')}
                </Button>
                <Button variant="secondary" icon={<Pencil aria-hidden="true" size={18} />} onClick={startEditing}>
                  {t('Something changed')}
                </Button>
              </div>
            ) : (
              <button type="button" className="link mt-3 text-small" onClick={startEditing}>
                {t('Change these details')}
              </button>
            )}
          </>
        )}
      </section>

      {/* ---------- Reorder, or ask the advisor ---------- */}
      {step === 'choose' && (
        <>
          <p className={skipsVerification ? 'notice-success flex items-start gap-2' : 'notice flex items-start gap-2'}>
            <ShieldCheck aria-hidden="true" size={18} className="mt-0.5 shrink-0" />
            <span>
              {t(
                skipsVerification
                  ? 'Your business is already verified, so you can go straight to your order after the quote.'
                  : addsGstin && shop.kyc_verified
                    ? 'You will upload your GST certificate after the quote. Your other documents are already verified.'
                    : 'After the quote, verify your business to place the order.',
              )}
            </span>
          </p>

          <section className="card" aria-labelledby="reorder-title">
            <h2 id="reorder-title" className="flex items-center gap-2.5 text-title-2 font-extrabold">
              <Repeat aria-hidden="true" size={20} className="text-brand-600" />
              {t('Reorder the same products')}
            </h2>
            {shop.last_order.length > 0 ? (
              <>
                <p className="mt-1 text-small text-ink-500">
                  {t('From your last order')}
                  {shop.last_order_id !== null && ` #${shop.last_order_id}`}. {t('You can change quantities on the quote.')}
                </p>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {shop.last_order.map((item) => (
                    <li key={item.product_id} className="badge badge-neutral whitespace-normal!">
                      {item.name}
                      {item.quantity > 1 ? ` × ${item.quantity}` : ''}
                    </li>
                  ))}
                </ul>
                <Button
                  className="mt-4"
                  isLoading={isReordering}
                  loadingText={t('Getting today’s prices…')}
                  iconAfter={<ArrowRight aria-hidden="true" size={18} />}
                  onClick={reorder}
                >
                  {t('Reorder at today’s prices')}
                </Button>
                {message && (
                  <p role="alert" className="notice-error mt-3 text-small">
                    {message}
                  </p>
                )}
              </>
            ) : (
              <p className="mt-1 text-small text-ink-500">{t('There is no earlier order to repeat yet. Ask the advisor instead.')}</p>
            )}
          </section>

          <section className="card" aria-labelledby="ask-title">
            <h2 id="ask-title" className="flex items-center gap-2.5 text-title-2 font-extrabold">
              <Bot aria-hidden="true" size={20} className="text-brand-600" />
              {t('Ask the advisor for something new')}
            </h2>
            <p className="mt-1 text-small text-ink-500">
              {t('The advisor already knows your business and what you have, so it only asks what you need now.')}
            </p>
            <Button variant="secondary" className="mt-4" iconAfter={<ArrowRight aria-hidden="true" size={18} />} onClick={() => onAskAdvisor(shop, details)}>
              {t('Ask the advisor')}
            </Button>
          </section>
        </>
      )}
    </div>
  )
}
