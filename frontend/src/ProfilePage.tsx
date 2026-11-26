import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Building, ChevronRight, CircleCheck, CircleExclamationPoint, LogOut, Package, Smartphone, Trash, UserRound } from 'lucide-react'
import { updateAccount, updateBusiness, type Account, type AccountBusiness } from './api'
import { rupees } from './format'
import { useLanguage } from './i18n'
import { clearDeviceData, clearProfileDraft, readProfileDraft, saveProfileDraft, type BusinessDraft, type ProfileDraft } from './storage'
import Avatar from './ui/Avatar'
import Badge from './ui/Badge'
import Button from './ui/Button'
import { cx } from './ui/cx'
import EmptyState from './ui/EmptyState'
import { TextField } from './ui/Field'
import SegmentedControl from './ui/SegmentedControl'

const PHONE_PATTERN = /^[6-9]\d{9}$/

type Status = { kind: 'saving' | 'saved' | 'error'; text: string } | null

type Props = {
  account: Account
  onAccountChange: (account: Account) => void
  onOpenOrder: (business: AccountBusiness, orderId: number) => void
  onSignOut: () => Promise<void>
}

function savedDraft(account: Account): ProfileDraft {
  const businesses: Record<string, BusinessDraft> = {}
  for (const business of account.businesses) {
    businesses[business.business_id] = { business_name: business.business_name ?? '', business_type: business.business_type ?? '' }
  }
  return { full_name: account.full_name, phone: account.phone ?? '', businesses }
}

function isSame(first: ProfileDraft, second: ProfileDraft) {
  return JSON.stringify(first) === JSON.stringify(second)
}

// A titled group of settings, like a section in a phone's settings app.
function SettingsCard({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="card">
      <h2 className="flex items-center gap-2.5 text-title-2 font-extrabold">
        <span aria-hidden="true" className="flex size-9 items-center justify-center rounded-control bg-brand-50 text-brand-600">
          {icon}
        </span>
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  )
}

export default function ProfilePage({ account, onAccountChange, onOpenOrder, onSignOut }: Props) {
  const { t, setLanguage } = useLanguage()
  const saved = savedDraft(account)
  // Unsaved changes from earlier on this device are offered back, but only to the same account.
  const [restored] = useState(() => {
    const draft = readProfileDraft(account.user_id)
    return draft && !isSame(draft, saved) ? draft : null
  })
  const [draft, setDraft] = useState<ProfileDraft>(() => ({ ...saved, ...restored, businesses: { ...saved.businesses, ...restored?.businesses } }))
  const [showRestored, setShowRestored] = useState(Boolean(restored))
  const [language, setLanguageChoice] = useState(account.preferred_language)
  const [phoneProblem, setPhoneProblem] = useState('')
  const [status, setStatus] = useState<Status>(null)
  const [businessStatus, setBusinessStatus] = useState<Record<number, Status>>({})
  const [deviceMessage, setDeviceMessage] = useState('')
  const [isSigningOut, setIsSigningOut] = useState(false)

  // Keep a draft while there are unsaved changes, so a closed tab does not lose them. Clear it once saved.
  useEffect(() => {
    if (isSame(draft, savedDraft(account))) clearProfileDraft()
    else saveProfileDraft(account.user_id, draft)
  }, [draft, account])

  function discardDraft() {
    clearProfileDraft()
    setDraft(savedDraft(account))
    setShowRestored(false)
  }

  async function saveDetails(event: FormEvent) {
    event.preventDefault()
    if (!draft.full_name.trim()) {
      setStatus({ kind: 'error', text: t('Enter your name.') })
      return
    }
    if (draft.phone && !PHONE_PATTERN.test(draft.phone)) {
      setPhoneProblem(t('Enter a 10-digit mobile number'))
      return
    }
    setPhoneProblem('')
    setStatus({ kind: 'saving', text: t('Saving…') })
    try {
      const updated = await updateAccount({
        full_name: draft.full_name.trim(),
        ...(draft.phone ? { phone: draft.phone } : { clear_phone: true }),
        preferred_language: language,
      })
      onAccountChange(updated)
      setDraft((current) => ({ ...current, full_name: updated.full_name, phone: updated.phone ?? '' }))
      setLanguage(language === 'Hindi' ? 'hi' : 'en')
      setShowRestored(false)
      setStatus({ kind: 'saved', text: t('Your details are saved.') })
    } catch (caught) {
      setStatus({ kind: 'error', text: caught instanceof Error ? t(caught.message) : t('That did not work. Try again.') })
    }
  }

  async function saveBusiness(businessId: number) {
    const changes = draft.businesses[businessId]
    setBusinessStatus((current) => ({ ...current, [businessId]: { kind: 'saving', text: t('Saving…') } }))
    try {
      const updated = await updateBusiness(businessId, changes)
      onAccountChange(updated)
      setBusinessStatus((current) => ({ ...current, [businessId]: { kind: 'saved', text: t('Business details saved.') } }))
    } catch (caught) {
      const text = caught instanceof Error ? t(caught.message) : t('That did not work. Try again.')
      setBusinessStatus((current) => ({ ...current, [businessId]: { kind: 'error', text } }))
    }
  }

  function setBusinessField(businessId: number, field: keyof BusinessDraft, value: string) {
    setDraft((current) => ({
      ...current,
      businesses: { ...current.businesses, [businessId]: { ...current.businesses[businessId], [field]: value } },
    }))
  }

  function clearThisDevice() {
    if (!window.confirm(t('Remove everything this site saved in this browser? Your account and orders are not affected.'))) return
    clearDeviceData()
    setDraft(savedDraft(account))
    setShowRestored(false)
    setDeviceMessage(t('Saved data on this device was cleared.'))
  }

  async function signOutHere() {
    setIsSigningOut(true)
    try {
      await onSignOut()
    } catch {
      setIsSigningOut(false)
      setStatus({ kind: 'error', text: t('Sign out did not work. Check your connection and try again.') })
    }
  }

  const statusLine = (current: Status) =>
    current && (
      <p
        role={current.kind === 'error' ? 'alert' : 'status'}
        className={cx(
          'mt-3 flex items-center gap-2 font-semibold',
          current.kind === 'error' ? 'notice-error' : current.kind === 'saved' ? 'notice-success' : 'text-ink-500',
        )}
      >
        {current.kind === 'saved' && <CircleCheck aria-hidden="true" size={18} className="shrink-0" />}
        {current.kind === 'error' && <CircleExclamationPoint aria-hidden="true" size={18} className="shrink-0" />}
        {current.text}
      </p>
    )

  const orderCount = account.businesses.reduce((sum, business) => sum + business.orders.length, 0)

  return (
    <div className="space-y-5 py-6">
      {/* ---------- Who is signed in ---------- */}
      <section className="soft-mesh flex items-center gap-4 rounded-card p-5 shadow-e2">
        <Avatar name={account.full_name} size="lg" />
        <div className="min-w-0">
          <p className="text-title-1 font-extrabold break-words">{account.full_name}</p>
          <p className="text-small break-all text-ink-500">{account.email}</p>
          <p className="mt-1.5 flex flex-wrap gap-1.5">
            <Badge tone="neutral" icon={<Building size={13} />}>
              {account.businesses.length} {t(account.businesses.length === 1 ? 'business' : 'businesses')}
            </Badge>
            <Badge tone="neutral" icon={<Package size={13} />}>
              {orderCount} {t(orderCount === 1 ? 'order' : 'orders')}
            </Badge>
          </p>
        </div>
      </section>

      {showRestored && (
        <div className="notice">
          <p className="font-semibold">{t('We restored changes you had not saved on this device.')}</p>
          <button type="button" className="link text-small" onClick={discardDraft}>
            {t('Discard these changes')}
          </button>
        </div>
      )}

      {/* ---------- The owner's own details ---------- */}
      <form onSubmit={saveDetails} noValidate>
        <SettingsCard icon={<UserRound size={18} />} title={t('Your details')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label={t('Your name')}
              autoComplete="name"
              maxLength={80}
              value={draft.full_name}
              onChange={(event) => setDraft({ ...draft, full_name: event.target.value })}
            />
            <TextField
              label={t('Mobile number (optional)')}
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              maxLength={10}
              value={draft.phone}
              error={phoneProblem || undefined}
              onChange={(event) => setDraft({ ...draft, phone: event.target.value.replace(/\D/g, '') })}
            />
            <div>
              <p className="field-label">{t('Email')}</p>
              <p className="flex min-h-12 items-center rounded-control bg-ink-50 px-3.5 break-all text-ink-700">{account.email}</p>
            </div>
            <div>
              <p className="field-label" id="profile-language">
                {t('Language')}
              </p>
              <SegmentedControl
                label={t('Language')}
                value={language}
                onChange={setLanguageChoice}
                options={[
                  { value: 'English', label: 'English', lang: 'en' },
                  { value: 'Hindi', label: 'हिन्दी', lang: 'hi' },
                ]}
              />
            </div>
          </div>
          <Button type="submit" className="mt-5" isLoading={status?.kind === 'saving'} loadingText={t('Saving…')}>
            {t('Save my details')}
          </Button>
          {statusLine(status)}
        </SettingsCard>
      </form>

      {/* ---------- Businesses, each with its orders ---------- */}
      <SettingsCard icon={<Building size={18} />} title={t('Your businesses and orders')}>
        {account.businesses.length === 0 ? (
          <EmptyState
            picture="box"
            title={t('No orders yet')}
            text={t('No orders yet. Orders you accept while signed in will appear here.')}
            className="py-4!"
          />
        ) : (
          <ul className="space-y-4">
            {account.businesses.map((business) => (
              <li key={business.business_id} className="rounded-card bg-ink-50 p-4 ring-1 ring-ink-100">
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField
                    label={t('Business name')}
                    maxLength={120}
                    className="bg-white"
                    value={draft.businesses[business.business_id]?.business_name ?? ''}
                    onChange={(event) => setBusinessField(business.business_id, 'business_name', event.target.value)}
                  />
                  <TextField
                    label={t('Type of business')}
                    maxLength={80}
                    className="bg-white"
                    placeholder={t('For example, dental clinic')}
                    value={draft.businesses[business.business_id]?.business_type ?? ''}
                    onChange={(event) => setBusinessField(business.business_id, 'business_type', event.target.value)}
                  />
                </div>
                <p className="mt-3 flex flex-wrap gap-1.5">
                  {[business.city, `${business.employee_count} ${t('people')}`, `${business.num_sites} ${t(business.num_sites === 1 ? 'site' : 'sites')}`, `GSTIN: ${t(business.has_gstin ? 'Yes' : 'No')}`]
                    .filter(Boolean)
                    .map((fact) => (
                      <span key={fact} className="rounded-full bg-white px-2.5 py-1 text-caption font-semibold text-ink-700 ring-1 ring-ink-200">
                        {fact}
                      </span>
                    ))}
                </p>
                <p className="mt-2 text-caption text-ink-500">{t('Size, city and GSTIN come from your quote, so they cannot be changed here.')}</p>
                <Button variant="secondary" size="sm" className="mt-3" onClick={() => saveBusiness(business.business_id)}>
                  {t('Save business details')}
                </Button>
                {statusLine(businessStatus[business.business_id] ?? null)}
                {business.orders.length > 0 && (
                  <ul className="mt-4 space-y-2">
                    {business.orders.map((order) => (
                      <li key={order.order_id}>
                        <button
                          type="button"
                          className="flex min-h-14 w-full items-center gap-3 rounded-control bg-white px-3.5 py-2.5 text-left shadow-e1 transition-shadow hover:shadow-e2"
                          onClick={() => onOpenOrder(business, order.order_id)}
                        >
                          <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600">
                            <Package size={18} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block font-bold">
                              {t('Order')} {order.order_id}
                            </span>
                            <span className="block text-small text-ink-500">
                              {t(order.status_label)} · {rupees(order.monthly_total_inr)} {t('a month')}
                            </span>
                          </span>
                          <span className="sr-only">{t('Open order')}</span>
                          <ChevronRight aria-hidden="true" size={20} className="shrink-0 text-ink-400" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </SettingsCard>

      {/* ---------- This device ---------- */}
      <SettingsCard icon={<Smartphone size={18} />} title={t('This device')}>
        <p className="max-w-[62ch] text-ink-700">
          {t('This browser keeps only your language, the order you are following, and changes you have not saved yet. Your password and documents are never stored here.')}
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button variant="secondary" isLoading={isSigningOut} loadingText={t('Signing out…')} icon={<LogOut aria-hidden="true" size={18} />} onClick={signOutHere}>
            {t('Sign out')}
          </Button>
          <Button variant="ghost" icon={<Trash aria-hidden="true" size={18} />} onClick={clearThisDevice}>
            {t('Clear saved data on this device')}
          </Button>
        </div>
        {deviceMessage && (
          <p role="status" className="notice-success mt-3 font-medium">
            {deviceMessage}
          </p>
        )}
      </SettingsCard>
    </div>
  )
}
