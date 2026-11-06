import { useEffect, useState, type FormEvent } from 'react'
import { updateAccount, updateBusiness, type Account, type AccountBusiness } from './api'
import { rupees } from './format'
import { useLanguage } from './i18n'
import { clearDeviceData, clearProfileDraft, readProfileDraft, saveProfileDraft, type BusinessDraft, type ProfileDraft } from './storage'

const PHONE_PATTERN = /^[6-9]\d{9}$/
const inputStyle = 'mt-1 w-full border-2 border-ink bg-white px-3 py-2 text-lg'

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
        className={`mt-3 font-semibold ${current.kind === 'error' ? 'border-l-4 border-ink pl-3' : current.kind === 'saved' ? 'border-l-4 border-marigold pl-3' : 'text-muted'}`}
      >
        {current.kind === 'saved' && <span aria-hidden="true">✓ </span>}
        {current.text}
      </p>
    )

  return (
    <div className="space-y-10 py-8">
      {showRestored && (
        <div className="border-l-4 border-marigold bg-white px-3 py-2">
          <p className="font-semibold">{t('We restored changes you had not saved on this device.')}</p>
          <button type="button" className="mt-1 text-sm font-semibold underline underline-offset-4" onClick={discardDraft}>
            {t('Discard these changes')}
          </button>
        </div>
      )}

      <form onSubmit={saveDetails} noValidate>
        <h2 className="border-b-4 border-ink font-display text-2xl font-bold">{t('Your details')}</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block font-semibold">
            {t('Your name')}
            <input
              className={inputStyle}
              autoComplete="name"
              maxLength={80}
              value={draft.full_name}
              onChange={(event) => setDraft({ ...draft, full_name: event.target.value })}
            />
          </label>
          <label className="block font-semibold">
            {t('Mobile number (optional)')}
            <input
              type="tel"
              inputMode="numeric"
              className={inputStyle}
              autoComplete="tel-national"
              maxLength={10}
              value={draft.phone}
              aria-invalid={Boolean(phoneProblem)}
              onChange={(event) => setDraft({ ...draft, phone: event.target.value.replace(/\D/g, '') })}
            />
            {phoneProblem && <span className="mt-1 block text-sm font-semibold">{phoneProblem}</span>}
          </label>
          <div>
            <p className="font-semibold">{t('Email')}</p>
            <p className="mt-1 py-2 break-all">{account.email}</p>
          </div>
          <label className="block font-semibold">
            {t('Language')}
            <select className={inputStyle} value={language} onChange={(event) => setLanguageChoice(event.target.value as 'English' | 'Hindi')}>
              <option value="English">English</option>
              <option value="Hindi">हिन्दी</option>
            </select>
          </label>
        </div>
        <button type="submit" disabled={status?.kind === 'saving'} className="mt-4 bg-ink px-6 py-3 font-semibold text-paper disabled:opacity-60">
          {t('Save my details')}
        </button>
        {statusLine(status)}
      </form>

      <section>
        <h2 className="border-b-4 border-ink font-display text-2xl font-bold">{t('Your businesses and orders')}</h2>
        {account.businesses.length === 0 ? (
          <p className="mt-3 text-muted">{t('No orders yet. Orders you accept while signed in will appear here.')}</p>
        ) : (
          <ul className="divide-y divide-rule">
            {account.businesses.map((business) => (
              <li key={business.business_id} className="py-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block font-semibold">
                    {t('Business name')}
                    <input
                      className={inputStyle}
                      maxLength={120}
                      value={draft.businesses[business.business_id]?.business_name ?? ''}
                      onChange={(event) => setBusinessField(business.business_id, 'business_name', event.target.value)}
                    />
                  </label>
                  <label className="block font-semibold">
                    {t('Type of business')}
                    <input
                      className={inputStyle}
                      maxLength={80}
                      placeholder={t('For example, dental clinic')}
                      value={draft.businesses[business.business_id]?.business_type ?? ''}
                      onChange={(event) => setBusinessField(business.business_id, 'business_type', event.target.value)}
                    />
                  </label>
                </div>
                <p className="mt-2 text-sm text-muted">
                  {[business.city, `${business.employee_count} ${t('people')}`, `${business.num_sites} ${t(business.num_sites === 1 ? 'site' : 'sites')}`, `GSTIN: ${t(business.has_gstin ? 'Yes' : 'No')}`]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                <p className="text-sm text-muted">{t('Size, city and GSTIN come from your quote, so they cannot be changed here.')}</p>
                <button type="button" className="mt-3 border-2 border-ink px-4 py-2 font-semibold" onClick={() => saveBusiness(business.business_id)}>
                  {t('Save business details')}
                </button>
                {statusLine(businessStatus[business.business_id] ?? null)}
                <ul className="mt-4 space-y-2">
                  {business.orders.map((order) => (
                    <li key={order.order_id} className="flex flex-wrap items-center justify-between gap-2 bg-white px-3 py-2">
                      <span>
                        <span className="font-semibold">
                          {t('Order')} {order.order_id}
                        </span>
                        : {t(order.status_label)} · {rupees(order.monthly_total_inr)} {t('a month')}
                      </span>
                      <button type="button" className="font-semibold underline underline-offset-4" onClick={() => onOpenOrder(business, order.order_id)}>
                        {t('Open order')}
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="border-b-4 border-ink font-display text-2xl font-bold">{t('This device')}</h2>
        <p className="mt-3 max-w-[62ch]">
          {t('This browser keeps only your language, the order you are following, and changes you have not saved yet. Your password and documents are never stored here.')}
        </p>
        <div className="mt-3 flex flex-wrap gap-4">
          <button type="button" className="border-2 border-ink px-4 py-2 font-semibold" onClick={clearThisDevice}>
            {t('Clear saved data on this device')}
          </button>
          <button type="button" disabled={isSigningOut} className="bg-ink px-4 py-2 font-semibold text-paper disabled:opacity-60" onClick={signOutHere}>
            {t(isSigningOut ? 'Signing out…' : 'Sign out')}
          </button>
        </div>
        {deviceMessage && (
          <p role="status" className="mt-3 border-l-4 border-marigold pl-3 font-semibold">
            {deviceMessage}
          </p>
        )}
      </section>
    </div>
  )
}
