import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Briefcase,
  Building,
  Cable,
  Cctv,
  Check,
  Cloud,
  CreditCard,
  Factory,
  Gauge,
  Globe,
  Mail,
  MessageCircle,
  MessageSquareText,
  Network,
  Phone,
  PhoneCall,
  RotateCw,
  Server,
  Shield,
  ShieldCheck,
  Smartphone,
  Store,
  Truck,
  Wifi,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { m } from 'motion/react'
import { fetchCities, fetchRecommendation, type City, type Profile, type Recommendation } from './api'
import { useLanguage } from './i18n'
import Button from './ui/Button'
import { cx } from './ui/cx'
import { SelectField, TextField } from './ui/Field'
import { DURATION, EASE_OUT } from './ui/motionTokens'

const BUSINESS_KINDS: { value: string; label: string; example: string; icon: LucideIcon }[] = [
  { value: 'micro', label: 'Shop or small service', example: 'Kirana, salon, pharmacy', icon: Store },
  { value: 'prof', label: 'Office', example: 'Clinic, CA firm, coaching centre', icon: Briefcase },
  { value: 'multi', label: 'Several branches', example: 'Restaurant chain, 3 or more stores', icon: Building },
  { value: 'mfg', label: 'Factory or workshop', example: 'Auto-parts unit, textile unit', icon: Factory },
]

const CURRENT_INTERNET = [
  { value: 'mobile_hotspot', label: 'Mobile hotspot' },
  { value: 'home_broadband', label: 'Home broadband' },
  { value: 'business_broadband', label: 'Business broadband' },
  { value: 'leased_line', label: 'Leased line' },
  { value: 'mixed', label: 'Different providers at each site' },
  { value: 'none', label: 'No internet yet' },
]

const NEED_GROUPS: { title: string; needs: { value: string; label: string; icon: LucideIcon }[] }[] = [
  {
    title: 'Internet and phones',
    needs: [
      { value: 'internet', label: 'Reliable internet', icon: Wifi },
      { value: 'high_speed_internet', label: 'Very fast internet', icon: Zap },
      { value: 'dedicated_internet', label: 'Guaranteed bandwidth (leased line)', icon: Cable },
      { value: 'failover', label: 'Backup when the internet goes down', icon: RotateCw },
      { value: 'mobile_lines', label: 'Business SIMs', icon: Smartphone },
      { value: 'phone_system', label: 'Office phone lines', icon: Phone },
      { value: 'toll_free', label: '1800 toll-free number', icon: PhoneCall },
    ],
  },
  {
    title: 'Reach customers and sell',
    needs: [
      { value: 'whatsapp', label: 'WhatsApp business channel', icon: MessageCircle },
      { value: 'bulk_sms', label: 'SMS alerts and offers', icon: MessageSquareText },
      { value: 'website', label: 'Simple website', icon: Globe },
      { value: 'pos_billing', label: 'Billing and UPI or card payments', icon: CreditCard },
      { value: 'guest_wifi', label: 'Wi-Fi for customers', icon: Wifi },
    ],
  },
  {
    title: 'Office work and safety',
    needs: [
      { value: 'email_office', label: 'Business email and documents', icon: Mail },
      { value: 'cloud_backup', label: 'Automatic backup', icon: Cloud },
      { value: 'endpoint_security', label: 'Antivirus for PCs and phones', icon: Shield },
      { value: 'firewall', label: 'Managed firewall', icon: ShieldCheck },
      { value: 'cctv', label: 'CCTV cameras', icon: Cctv },
    ],
  },
  {
    title: 'Several sites and machines',
    needs: [
      { value: 'multi_site_management', label: 'Manage all branches in one place', icon: Network },
      { value: 'static_ip', label: 'Fixed IP for cameras or servers', icon: Server },
      { value: 'machine_monitoring', label: 'Sensors on machines', icon: Gauge },
      { value: 'fleet_tracking', label: 'GPS for vehicles', icon: Truck },
    ],
  },
]

const OTHER_CITY = 'other'
// Cities outside our list count as tier 2, the same rule the backend uses.
const OTHER_CITY_TIER = 2

// One question per screen, so a first-time owner is never faced with a long form.
const STEP_TITLES = ['What kind of business do you run?', 'Where and how big?', 'Do you have a GSTIN?', 'What does your business need?', 'Any monthly budget?']

type Props = {
  notice?: string
  onDone: (profile: Profile, recommendation: Recommendation, city: string | null) => void
}

// A big tappable tile around a real radio button or checkbox, so it works with a keyboard and a
// screen reader, and the whole tile is the target. A tick pops in when it is chosen.
function ChoiceTile({
  type,
  name,
  checked,
  onChange,
  icon: Icon,
  label,
  hint,
}: {
  type: 'radio' | 'checkbox'
  name: string
  checked: boolean
  onChange: () => void
  icon?: LucideIcon
  label: ReactNode
  hint?: ReactNode
}) {
  return (
    <label className="choice items-center">
      <input type={type} name={name} className="sr-only" checked={checked} onChange={onChange} />
      {Icon && (
        <span
          aria-hidden="true"
          className={cx(
            'flex size-10 shrink-0 items-center justify-center rounded-control transition-colors duration-200',
            checked ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-700',
          )}
        >
          <Icon size={20} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block font-semibold leading-snug">{label}</span>
        {hint && <span className="block text-small text-ink-500">{hint}</span>}
      </span>
      <span
        aria-hidden="true"
        className={cx(
          'flex size-6 shrink-0 items-center justify-center transition-colors duration-200',
          type === 'radio' ? 'rounded-full' : 'rounded-md',
          checked ? 'bg-brand-600 text-white' : 'bg-white ring-[1.5px] ring-ink-300',
        )}
      >
        {checked && <Check size={15} strokeWidth={3} className="animate-pop" />}
      </span>
    </label>
  )
}

export default function GuidedForm({ notice, onDone }: Props) {
  const { t, language, languageName } = useLanguage()
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
  const [step, setStep] = useState(0)
  const [direction, setDirection] = useState<1 | -1>(1)
  const [problems, setProblems] = useState<Record<string, string>>({})
  const headingRef = useRef<HTMLHeadingElement>(null)
  const hasMoved = useRef(false)
  const lastStep = STEP_TITLES.length - 1

  useEffect(() => {
    fetchCities().then(setCities).catch(() => setError('The city list did not load. Reload this page to try again.'))
  }, [])

  // After moving between questions, keyboard and screen-reader users land on the new question.
  useEffect(() => {
    if (hasMoved.current) headingRef.current?.focus()
  }, [step])

  function toggleNeed(need: string) {
    setNeeds((chosen) => (chosen.includes(need) ? chosen.filter((n) => n !== need) : [...chosen, need]))
  }

  // What must be answered before moving on from this question. The same things the full form required.
  function problemsFor(index: number) {
    const found: Record<string, string> = {}
    if (index === 1) {
      if (!city) found.city = t('Choose a city.')
      if (!(Number(employees) >= 1)) found.employees = t('Enter how many people work there.')
      if (!(Number(sites) >= 1)) found.sites = t('Enter how many sites or branches.')
    }
    if (index === 2 && !hasGstin) found.gstin = t('Say whether you have a GSTIN.')
    if (index === 3 && needs.length === 0) found.needs = t('Choose at least one thing your business needs.')
    return found
  }

  function move(towards: 1 | -1) {
    if (towards === 1) {
      const found = problemsFor(step)
      setProblems(found)
      if (Object.keys(found).length > 0) return
    } else {
      setProblems({})
    }
    hasMoved.current = true
    setDirection(towards)
    setStep((current) => Math.min(lastStep, Math.max(0, current + towards)))
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    // Pressing Enter on an earlier question moves on instead of sending half the answers.
    if (step < lastStep) {
      move(1)
      return
    }
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

  const stepText = language === 'hi' ? `चरण ${step + 1} (कुल ${STEP_TITLES.length})` : `Step ${step + 1} of ${STEP_TITLES.length}`

  return (
    <form onSubmit={handleSubmit} noValidate className="card my-6">
      {notice && <p className="notice mb-5">{t(notice)}</p>}

      {/* Progress: a bar that fills, and the step in words for screen readers. */}
      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow" aria-live="polite">
          {stepText}
        </p>
        <p className="text-caption font-semibold text-ink-500 tabular-nums">{Math.round(((step + 1) / STEP_TITLES.length) * 100)}%</p>
      </div>
      <div aria-hidden="true" className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-100">
        <m.div
          className="h-full origin-left rounded-full bg-brand-600"
          initial={false}
          animate={{ scaleX: (step + 1) / STEP_TITLES.length }}
          transition={{ duration: DURATION.slow, ease: EASE_OUT }}
        />
      </div>

      <m.fieldset
        key={step}
        initial={{ opacity: 0, x: 24 * direction }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: DURATION.slow, ease: EASE_OUT }}
        className="mt-6 min-w-0"
        aria-labelledby="guided-step-title"
      >
        <h2 id="guided-step-title" ref={headingRef} tabIndex={-1} className="text-title-1 font-extrabold">
          {t(STEP_TITLES[step])}
        </h2>

        {step === 0 && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {BUSINESS_KINDS.map((option) => (
              <ChoiceTile
                key={option.value}
                type="radio"
                name="kind"
                icon={option.icon}
                checked={kind === option.value}
                onChange={() => setKind(option.value)}
                label={t(option.label)}
                hint={t(option.example)}
              />
            ))}
          </div>
        )}

        {step === 1 && (
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <SelectField
              label={t('City')}
              wrapperClassName="sm:col-span-3"
              value={city}
              error={problems.city}
              onChange={(e) => setCity(e.target.value)}
            >
              <option value="">{t('Choose a city')}</option>
              {cities.map((c) => (
                <option key={c.city} value={c.city}>
                  {c.city}
                </option>
              ))}
              <option value={OTHER_CITY}>{t('Another city')}</option>
            </SelectField>
            <TextField
              label={t('People working')}
              type="number"
              min="1"
              inputMode="numeric"
              wrapperClassName="sm:col-span-2"
              value={employees}
              error={problems.employees}
              onChange={(e) => setEmployees(e.target.value)}
            />
            <TextField
              label={t('Sites or branches')}
              type="number"
              min="1"
              inputMode="numeric"
              value={sites}
              error={problems.sites}
              onChange={(e) => setSites(e.target.value)}
            />
          </div>
        )}

        {step === 2 && (
          <div className="mt-2">
            <p className="text-ink-500">{t('Some services need one. We only ask yes or no here.')}</p>
            <div className="mt-4 grid max-w-md grid-cols-2 gap-3">
              {['yes', 'no'].map((answer) => (
                <ChoiceTile key={answer} type="radio" name="gstin" checked={hasGstin === answer} onChange={() => setHasGstin(answer)} label={t(answer)} />
              ))}
            </div>
            {problems.gstin && (
              <p role="alert" className="field-error">
                {problems.gstin}
              </p>
            )}
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <SelectField label={t('What internet do you use today?')} value={current} onChange={(e) => setCurrent(e.target.value)}>
                <option value="">{t('Prefer not to say')}</option>
                {CURRENT_INTERNET.map((option) => (
                  <option key={option.value} value={option.value}>
                    {t(option.label)}
                  </option>
                ))}
              </SelectField>
              <SelectField label={t('Is fibre available at your site?')} value={fibre} onChange={(e) => setFibre(e.target.value)}>
                <option value="unsure">{t('Not sure')}</option>
                <option value="yes">{t('Yes')}</option>
                <option value="no">{t('No')}</option>
              </SelectField>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            {NEED_GROUPS.map((group) => (
              <fieldset key={group.title} className="mt-5">
                <legend className="eyebrow">{t(group.title)}</legend>
                <div className="mt-2 grid gap-2.5 sm:grid-cols-2">
                  {group.needs.map((need) => (
                    <ChoiceTile
                      key={need.value}
                      type="checkbox"
                      name="needs"
                      icon={need.icon}
                      checked={needs.includes(need.value)}
                      onChange={() => toggleNeed(need.value)}
                      label={t(need.label)}
                    />
                  ))}
                </div>
              </fieldset>
            ))}
            {problems.needs && (
              <p role="alert" className="field-error">
                {problems.needs}
              </p>
            )}
          </div>
        )}

        {step === 4 && (
          <div className="mt-4 max-w-xs">
            <TextField
              label={t('Monthly budget in ₹ (optional)')}
              type="number"
              min="1"
              inputMode="numeric"
              size="lg"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
            />
          </div>
        )}
      </m.fieldset>

      {error && (
        <p role="alert" className="notice-error mt-5 font-medium">
          {error}
        </p>
      )}

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        {step > 0 ? (
          <Button variant="secondary" icon={<ArrowLeft aria-hidden="true" size={18} />} onClick={() => move(-1)}>
            {t('Back')}
          </Button>
        ) : (
          <span />
        )}
        {step < lastStep ? (
          <Button iconAfter={<ArrowRight aria-hidden="true" size={18} />} onClick={() => move(1)} className="min-w-32">
            {t('Next')}
          </Button>
        ) : (
          <Button type="submit" size="lg" isLoading={isBusy} loadingText={t('Preparing your bundle…')} iconAfter={<ArrowRight aria-hidden="true" size={18} />}>
            {t('See my bundle')}
          </Button>
        )}
      </div>
    </form>
  )
}
