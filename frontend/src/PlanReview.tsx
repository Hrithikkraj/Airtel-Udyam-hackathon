import { useEffect, useState, type FormEvent } from 'react'
import { ArrowRight } from 'lucide-react'
import { fetchCities, fetchOwnerPlan, type City, type Product, type Profile, type Recommendation } from './api'
import { useLanguage } from './i18n'
import Button from './ui/Button'
import { SelectField, TextField } from './ui/Field'

// Cities outside our list count as tier 2, the same rule the backend uses.
const OTHER_CITY = 'other'
const OTHER_CITY_TIER = 2

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
    <form onSubmit={handleSubmit} noValidate className="max-h-[70dvh] overflow-y-auto py-1">
      <h2 className="text-title-2 font-extrabold">{t('A few details to check your plan')}</h2>
      <p className="text-small text-ink-500">{t('Some services depend on your city, size and GSTIN.')}</p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <SelectField label={t('City')} wrapperClassName="col-span-2 sm:col-span-1" value={city} onChange={(event) => setCity(event.target.value)}>
          <option value="">{t('Choose a city')}</option>
          {cities.map((known) => (
            <option key={known.city} value={known.city}>
              {known.city}
            </option>
          ))}
          <option value={OTHER_CITY}>{t('Another city')}</option>
        </SelectField>
        <TextField label={t('People working')} type="number" min="1" inputMode="numeric" value={employees} onChange={(event) => setEmployees(event.target.value)} />
        <TextField label={t('Sites or branches')} type="number" min="1" inputMode="numeric" value={sites} onChange={(event) => setSites(event.target.value)} />
        <fieldset className="col-span-2">
          <legend className="field-label">{t('Do you have a GSTIN?')}</legend>
          <div className="grid max-w-xs grid-cols-2 gap-2">
            {['yes', 'no'].map((answer) => (
              <label key={answer} className="choice items-center font-semibold">
                <input type="radio" name="plan-gstin" className="size-5" checked={hasGstin === answer} onChange={() => setHasGstin(answer)} />
                {t(answer)}
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      {problems.length > 0 && (
        <ul role="alert" className="notice-error mt-3 list-disc space-y-1 pl-8 font-medium">
          {problems.map((problem) => (
            <li key={problem}>{t(problem)}</li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="submit" isLoading={isBusy} loadingText={t('Checking your plan…')} iconAfter={<ArrowRight aria-hidden="true" size={18} />}>
          {t('See my quote')}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {t('Keep choosing')}
        </Button>
      </div>
    </form>
  )
}
