import { useEffect, useState, type FormEvent } from 'react'
import { fetchCities, fetchOwnerPlan, type City, type Product, type Profile, type Recommendation } from './api'
import { useLanguage } from './i18n'

// Cities outside our list count as tier 2, the same rule the backend uses.
const OTHER_CITY = 'other'
const OTHER_CITY_TIER = 2
const inputStyle = 'mt-1 w-full border-2 border-ink bg-white px-3 py-2'

type Props = {
  plan: Record<string, number>
  products: Product[]
  onCancel: () => void
  onReviewed: (profile: Profile, recommendation: Recommendation, city: string | null) => void
}

// What a plan needs before it can be checked: whether each product can be sold to this business
// depends on its city, size and GSTIN. The server checks the plan with the same rules as any quote.
export default function PlanReview({ plan, products, onCancel, onReviewed }: Props) {
  const { t, languageName } = useLanguage()
  const [cities, setCities] = useState<City[]>([])
  const [city, setCity] = useState('')
  const [employees, setEmployees] = useState('')
  const [sites, setSites] = useState('1')
  const [hasGstin, setHasGstin] = useState('')
  const [problems, setProblems] = useState<string[]>([])
  const [isBusy, setIsBusy] = useState(false)

  useEffect(() => {
    fetchCities()
      .then(setCities)
      .catch(() => setProblems([t('The city list did not load. Reload this page to try again.')]))
  }, [t])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const missing = []
    if (!city) missing.push(t('Choose a city.'))
    if (!(Number(employees) >= 1)) missing.push(t('Enter how many people work there.'))
    if (!(Number(sites) >= 1)) missing.push(t('Enter how many sites or branches.'))
    if (!hasGstin) missing.push(t('Say whether you have a GSTIN.'))
    setProblems(missing)
    if (missing.length > 0) return

    const chosenCity = cities.find((known) => known.city === city)
    const profile: Profile = {
      employee_count: Number(employees),
      num_sites: Number(sites),
      city_tier: chosenCity ? chosenCity.city_tier : OTHER_CITY_TIER,
      has_gstin: hasGstin === 'yes',
      fibre_available: true,
      segment: null,
      needs: [],
      budget_monthly_inr: null,
      current_internet: null,
      preferred_language: languageName,
    }
    const items = products.map((product) => ({ product_id: product.product_id, quantity: plan[product.product_id] }))
    setIsBusy(true)
    try {
      onReviewed(profile, await fetchOwnerPlan(profile, items), chosenCity ? chosenCity.city : null)
    } catch (caught) {
      // A rule the plan breaks, such as CCTV with no connection, comes back as readable reasons.
      setProblems(caught instanceof Error ? caught.message.split('. ').map((reason) => reason.replace(/\.$/, '')) : [t('That did not work. Try again.')])
      setIsBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="max-h-[70vh] overflow-y-auto">
      <h2 className="font-display text-xl font-bold">{t('A few details to check your plan')}</h2>
      <p className="text-sm text-muted">{t('Some services depend on your city, size and GSTIN.')}</p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="col-span-2 block font-semibold sm:col-span-1">
          {t('City')}
          <select className={inputStyle} value={city} onChange={(event) => setCity(event.target.value)}>
            <option value="">{t('Choose a city')}</option>
            {cities.map((known) => (
              <option key={known.city} value={known.city}>
                {known.city}
              </option>
            ))}
            <option value={OTHER_CITY}>{t('Another city')}</option>
          </select>
        </label>
        <label className="block font-semibold">
          {t('People working')}
          <input type="number" min="1" inputMode="numeric" className={inputStyle} value={employees} onChange={(event) => setEmployees(event.target.value)} />
        </label>
        <label className="block font-semibold">
          {t('Sites or branches')}
          <input type="number" min="1" inputMode="numeric" className={inputStyle} value={sites} onChange={(event) => setSites(event.target.value)} />
        </label>
        <fieldset className="col-span-2">
          <legend className="font-semibold">{t('Do you have a GSTIN?')}</legend>
          <div className="mt-1 grid max-w-xs grid-cols-2 gap-2">
            {['yes', 'no'].map((answer) => (
              <label key={answer} className="choice items-center font-semibold">
                <input type="radio" name="plan-gstin" className="size-5 accent-ink" checked={hasGstin === answer} onChange={() => setHasGstin(answer)} />
                {t(answer)}
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      {problems.length > 0 && (
        <ul role="alert" className="mt-3 space-y-1 border-l-4 border-ink bg-white px-3 py-2 font-semibold">
          {problems.map((problem) => (
            <li key={problem}>{t(problem)}</li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-4">
        <button type="submit" disabled={isBusy} className="bg-ink px-5 py-3 font-semibold text-paper disabled:opacity-60">
          {t(isBusy ? 'Checking your plan…' : 'See my quote')}
        </button>
        <button type="button" className="font-semibold underline underline-offset-4" onClick={onCancel}>
          {t('Keep choosing')}
        </button>
      </div>
    </form>
  )
}
