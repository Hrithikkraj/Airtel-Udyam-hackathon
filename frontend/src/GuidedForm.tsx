import { useEffect, useState, type FormEvent } from 'react'
import { fetchCities, fetchRecommendation, type City, type Profile, type Recommendation } from './api'
import { useLanguage } from './i18n'

const BUSINESS_KINDS = [
  { value: 'micro', label: 'Shop or small service', example: 'Kirana, salon, pharmacy' },
  { value: 'prof', label: 'Office', example: 'Clinic, CA firm, coaching centre' },
  { value: 'multi', label: 'Several branches', example: 'Restaurant chain, 3 or more stores' },
  { value: 'mfg', label: 'Factory or workshop', example: 'Auto-parts unit, textile unit' },
]

const CURRENT_INTERNET = [
  { value: 'mobile_hotspot', label: 'Mobile hotspot' },
  { value: 'home_broadband', label: 'Home broadband' },
  { value: 'business_broadband', label: 'Business broadband' },
  { value: 'leased_line', label: 'Leased line' },
  { value: 'mixed', label: 'Different providers at each site' },
  { value: 'none', label: 'No internet yet' },
]

const NEED_GROUPS = [
  {
    title: 'Internet and phones',
    needs: [
      { value: 'internet', label: 'Reliable internet' },
      { value: 'high_speed_internet', label: 'Very fast internet' },
      { value: 'dedicated_internet', label: 'Guaranteed bandwidth (leased line)' },
      { value: 'failover', label: 'Backup when the internet goes down' },
      { value: 'mobile_lines', label: 'Business SIMs' },
      { value: 'phone_system', label: 'Office phone lines' },
      { value: 'toll_free', label: '1800 toll-free number' },
    ],
  },
  {
    title: 'Reach customers and sell',
    needs: [
      { value: 'whatsapp', label: 'WhatsApp business channel' },
      { value: 'bulk_sms', label: 'SMS alerts and offers' },
      { value: 'website', label: 'Simple website' },
      { value: 'pos_billing', label: 'Billing and UPI or card payments' },
      { value: 'guest_wifi', label: 'Wi-Fi for customers' },
    ],
  },
  {
    title: 'Office work and safety',
    needs: [
      { value: 'email_office', label: 'Business email and documents' },
      { value: 'cloud_backup', label: 'Automatic backup' },
      { value: 'endpoint_security', label: 'Antivirus for PCs and phones' },
      { value: 'firewall', label: 'Managed firewall' },
      { value: 'cctv', label: 'CCTV cameras' },
    ],
  },
  {
    title: 'Several sites and machines',
    needs: [
      { value: 'multi_site_management', label: 'Manage all branches in one place' },
      { value: 'static_ip', label: 'Fixed IP for cameras or servers' },
      { value: 'machine_monitoring', label: 'Sensors on machines' },
      { value: 'fleet_tracking', label: 'GPS for vehicles' },
    ],
  },
]

const OTHER_CITY = 'other'
// Cities outside our list count as tier 2, the same rule the backend uses.
const OTHER_CITY_TIER = 2

const inputStyle = 'mt-1 w-full border-2 border-ink bg-white px-3 py-2 text-lg'
const legendStyle = 'font-display text-xl font-bold'

type Props = {
  notice?: string
  onDone: (profile: Profile, recommendation: Recommendation, city: string | null) => void
}

export default function GuidedForm({ notice, onDone }: Props) {
  const { t, languageName } = useLanguage()
  const [cities, setCities] = useState<City[]>([])
  const [kind, setKind] = useState('micro')
  const [city, setCity] = useState('')
  const [employees, setEmployees] = useState('')
  const [sites, setSites] = useState('1')
  const [hasGstin, setHasGstin] = useState('')
  const [fibre, setFibre] = useState('unsure')
  const [current, setCurrent] = useState('')
  const [needs, setNeeds] = useState<string[]>(['internet'])
  const [budget, setBudget] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchCities().then(setCities).catch(() => setError('The city list did not load. Reload this page to try again.'))
  }, [])

  function toggleNeed(need: string) {
    setNeeds((chosen) => (chosen.includes(need) ? chosen.filter((n) => n !== need) : [...chosen, need]))
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (needs.length === 0) {
      setError(t('Choose at least one thing your business needs.'))
      return
    }
    const chosenCity = cities.find((c) => c.city === city)
    const profile: Profile = {
      employee_count: Number(employees),
      num_sites: Number(sites),
      city_tier: chosenCity ? chosenCity.city_tier : OTHER_CITY_TIER,
      has_gstin: hasGstin === 'yes',
      fibre_available: fibre !== 'no',
      segment: kind,
      needs,
      budget_monthly_inr: budget ? Number(budget) : null,
      current_internet: current || null,
      preferred_language: languageName,
    }
    setIsBusy(true)
    setError('')
    try {
      onDone(profile, await fetchRecommendation(profile), chosenCity ? chosenCity.city : null)
    } catch {
      setError('Your bundle could not be prepared. Check that the backend is running, then try again.')
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8 py-8">
      {notice && <p className="border-l-4 border-marigold pl-3">{t(notice)}</p>}

      <fieldset>
        <legend className={legendStyle}>{t('What kind of business do you run?')}</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {BUSINESS_KINDS.map((option) => (
            <label key={option.value} className="choice">
              <input
                type="radio"
                name="kind"
                className="mt-1.5 size-5 accent-ink"
                checked={kind === option.value}
                onChange={() => setKind(option.value)}
              />
              <span>
                <span className="font-semibold">{t(option.label)}</span>
                <span className="block text-sm text-muted">{t(option.example)}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className={`${legendStyle} mb-2`}>{t('Where and how big?')}</legend>
        <label className="block font-semibold">
          {t('City')}
          <select required className={inputStyle} value={city} onChange={(e) => setCity(e.target.value)}>
            <option value="">{t('Choose a city')}</option>
            {cities.map((c) => (
              <option key={c.city} value={c.city}>
                {c.city}
              </option>
            ))}
            <option value={OTHER_CITY}>{t('Another city')}</option>
          </select>
        </label>
        <label className="block font-semibold">
          {t('People working')}
          <input
            required
            type="number"
            min="1"
            inputMode="numeric"
            className={inputStyle}
            value={employees}
            onChange={(e) => setEmployees(e.target.value)}
          />
        </label>
        <label className="block font-semibold">
          {t('Sites or branches')}
          <input
            required
            type="number"
            min="1"
            inputMode="numeric"
            className={inputStyle}
            value={sites}
            onChange={(e) => setSites(e.target.value)}
          />
        </label>
      </fieldset>

      <fieldset>
        <legend className={legendStyle}>{t('Do you have a GSTIN?')}</legend>
        <p className="text-sm text-muted">{t('Some services need one. We only ask yes or no here.')}</p>
        <div className="mt-2 grid max-w-sm grid-cols-2 gap-2">
          {['yes', 'no'].map((answer) => (
            <label key={answer} className="choice items-center font-semibold capitalize">
              <input
                required
                type="radio"
                name="gstin"
                className="size-5 accent-ink"
                checked={hasGstin === answer}
                onChange={() => setHasGstin(answer)}
              />
              {t(answer)}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block font-semibold">
          {t('What internet do you use today?')}
          <select className={inputStyle} value={current} onChange={(e) => setCurrent(e.target.value)}>
            <option value="">{t('Prefer not to say')}</option>
            {CURRENT_INTERNET.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.label)}
              </option>
            ))}
          </select>
        </label>
        <label className="block font-semibold">
          {t('Is fibre available at your site?')}
          <select className={inputStyle} value={fibre} onChange={(e) => setFibre(e.target.value)}>
            <option value="unsure">{t('Not sure')}</option>
            <option value="yes">{t('Yes')}</option>
            <option value="no">{t('No')}</option>
          </select>
        </label>
      </div>

      <div>
        <h2 className={legendStyle}>{t('What does your business need?')}</h2>
        {NEED_GROUPS.map((group) => (
          <fieldset key={group.title} className="mt-4">
            <legend className="font-semibold text-muted">{t(group.title)}</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {group.needs.map((need) => (
                <label key={need.value} className="choice">
                  <input
                    type="checkbox"
                    className="mt-1 size-5 shrink-0 accent-ink"
                    checked={needs.includes(need.value)}
                    onChange={() => toggleNeed(need.value)}
                  />
                  {t(need.label)}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>

      <label className="block font-semibold sm:max-w-xs">
        {t('Monthly budget in ₹ (optional)')}
        <input
          type="number"
          min="1"
          inputMode="numeric"
          className={inputStyle}
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
        />
      </label>

      {error && (
        <p role="alert" className="border-l-4 border-ink pl-3 font-semibold">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={isBusy}
        className="w-full bg-ink px-6 py-3 text-lg font-semibold text-paper disabled:opacity-60 sm:w-auto"
      >
        {t(isBusy ? 'Preparing your bundle…' : 'See my bundle')}
      </button>
    </form>
  )
}
