import { useEffect, useState, type ChangeEvent } from 'react'
import {
  declareNoUdyam,
  fetchKycNotice,
  fetchKycStatus,
  giveKycConsent,
  uploadKycDocument,
  withdrawKycConsent,
  type KycDocument,
  type KycNotice,
  type KycStatus,
} from './api'
import { useLanguage } from './i18n'

const ALL_SLOTS = [
  { type: 'gst_certificate', label: 'GST certificate', hint: 'We check it against the GST registry.' },
  { type: 'udyam_certificate', label: 'Udyam certificate', hint: 'We check it against the Udyam registry.' },
  { type: 'signatory_id', label: 'Signatory ID', hint: 'The person who signs for this business.' },
  { type: 'address_proof', label: 'Address proof', hint: 'An electricity bill from the last 90 days.' },
]

const FIELD_LABELS: Record<string, string> = {
  gstin: 'GSTIN',
  udyam_number: 'Udyam number',
  id_number: 'ID number',
  legal_name: 'Legal name',
  trade_name: 'Trade name',
  enterprise_name: 'Enterprise',
  name: 'Name',
  business_name: 'For business',
  billed_to: 'Billed to',
  address: 'Address',
  city: 'City',
  state: 'State',
  valid_till: 'Valid till',
  bill_date: 'Bill date',
}

const DOCUMENT_STATUS: Record<string, { text: string; symbol: string; style: string }> = {
  verified: { text: 'Verified', symbol: '✓', style: 'bg-ink text-paper' },
  needs_review: { text: 'Needs review', symbol: '!', style: 'bg-marigold text-ink' },
  failed: { text: 'Not accepted', symbol: '✕', style: 'border-2 border-ink text-ink' },
  not_applicable: { text: 'Not needed', symbol: '–', style: 'border-2 border-rule text-muted' },
}

const OVERALL_MESSAGE: Record<string, { title: string; text: string }> = {
  verified: { title: 'Your business is verified', text: 'All your documents agree with each other and with the registries.' },
  needs_review: { title: 'A person will check this', text: 'Our team will review the points above. Uploading a clearer or corrected document can settle them sooner.' },
  failed: { title: 'We cannot continue with these documents', text: 'Upload a corrected document to fix the points above, or ask our team for help.' },
}

type Props = { businessId: number; hasGstin: boolean; onBack: () => void }

const BACK_BUTTON_TEXT = 'Back to my order'

export default function KycPage({ businessId, hasGstin, onBack }: Props) {
  const { t } = useLanguage()
  const [notice, setNotice] = useState<KycNotice>()
  const [status, setStatus] = useState<KycStatus>()
  const [hasDeclined, setHasDeclined] = useState(false)
  const [busySlot, setBusySlot] = useState('')
  const [slotErrors, setSlotErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([fetchKycNotice(), fetchKycStatus(businessId)])
      .then(([loadedNotice, loadedStatus]) => {
        setNotice(loadedNotice)
        setStatus(loadedStatus)
      })
      .catch(() => setError('This page did not load. Check that the backend is running, then reload.'))
  }, [businessId])

  async function runAction(action: () => Promise<KycStatus>) {
    setError('')
    try {
      setStatus(await action())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That did not work. Try again.')
    }
  }

  async function handleUpload(slotType: string, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = '' // Lets the owner choose the same file again after fixing it.
    if (!file) return
    setBusySlot(slotType)
    setSlotErrors((errors) => ({ ...errors, [slotType]: '' }))
    try {
      setStatus(await uploadKycDocument(businessId, slotType, file))
    } catch (caught) {
      const text = caught instanceof Error ? caught.message : 'That upload did not work. Try again.'
      setSlotErrors((errors) => ({ ...errors, [slotType]: text }))
    } finally {
      setBusySlot('')
    }
  }

  function withdraw() {
    if (window.confirm('Withdraw consent and delete the details we read from your documents?')) {
      runAction(() => withdrawKycConsent(businessId))
    }
  }

  if (error && !status) {
    return <p role="alert" className="py-8">{error}</p>
  }
  if (!status || !notice) {
    return <p className="py-8">{t('Loading…')}</p>
  }

  // ---------- Consent comes first. Nothing can be uploaded before it. ----------
  if (!status.has_consent) {
    if (hasDeclined) {
      return (
        <div className="py-8">
          <h2 className="font-display text-2xl font-bold">{t('We have not read any documents')}</h2>
          <p className="mt-2 max-w-[62ch]">
            {t('Your quote is saved, but we cannot activate your order without verifying your business. You can agree when you are ready, or ask our team about other ways to verify.')}
          </p>
          <div className="mt-6 flex flex-wrap gap-4">
            <button type="button" className="bg-ink px-6 py-3 font-semibold text-paper" onClick={() => setHasDeclined(false)}>
              {t('Read the notice again')}
            </button>
            <button type="button" className="font-semibold underline underline-offset-4" onClick={onBack}>
              {t(BACK_BUTTON_TEXT)}
            </button>
          </div>
        </div>
      )
    }
    return (
      <div className="py-8">
        <h2 className="font-display text-2xl font-bold">{t('Before you upload')}</h2>
        <ul className="mt-3 max-w-[62ch] space-y-3">
          {notice.points.map((point) => (
            <li key={point} className="border-l-4 border-marigold pl-3">{t(point)}</li>
          ))}
        </ul>
        {error && <p role="alert" className="mt-4 font-semibold">{error}</p>}
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <button
            type="button"
            className="bg-ink px-6 py-3 font-semibold text-paper"
            onClick={() => runAction(() => giveKycConsent(businessId, notice.version))}
          >
            {t('I agree, continue')}
          </button>
          <button type="button" className="font-semibold underline underline-offset-4" onClick={() => setHasDeclined(true)}>
            {t('Not now')}
          </button>
        </div>
        <p className="mt-4 text-sm text-muted">{t('Notice version')} {notice.version}</p>
      </div>
    )
  }

  // ---------- Upload and results ----------
  const slots = ALL_SLOTS.filter((slot) => hasGstin || slot.type !== 'gst_certificate')
  const documentFor = (type: string): KycDocument | undefined => status.documents.find((d) => d.document_type === type)
  const overall = OVERALL_MESSAGE[status.status]

  return (
    <div className="py-8">
      <ul className="divide-y divide-rule border-y-4 border-ink">
        {slots.map((slot) => {
          const document = documentFor(slot.type)
          const badge = document && DOCUMENT_STATUS[document.status]
          const isBusy = busySlot === slot.type
          return (
            <li key={slot.type} className="py-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="font-display text-xl font-bold">{t(slot.label)}</h2>
                  {!document && <p className="text-sm text-muted">{t(slot.hint)}</p>}
                  {!document && <p className="text-sm text-muted">{t('Photo or PDF, up to 15 MB.')}</p>}
                </div>
                {badge && (
                  <span className={`flex items-center gap-1.5 px-2 py-0.5 text-sm font-semibold whitespace-nowrap ${badge.style}`}>
                    <span aria-hidden="true">{badge.symbol}</span>
                    {t(badge.text)}
                  </span>
                )}
              </div>

              {document && document.reasons.length > 0 && (
                <ul className="mt-2 space-y-1 border-l-4 border-marigold pl-3">
                  {document.reasons.map((reason) => (
                    <li key={reason}>{reason}.</li>
                  ))}
                </ul>
              )}

              {document && Object.keys(document.fields).length > 0 && (
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 text-sm">
                  {Object.entries(document.fields).map(([field, value]) => (
                    <div key={field} className="contents">
                      <dt className="text-muted">{FIELD_LABELS[field] ?? field}</dt>
                      <dd className="min-w-0 break-words">{value}</dd>
                    </div>
                  ))}
                </dl>
              )}

              {slotErrors[slot.type] && (
                <p role="alert" className="mt-2 border-l-4 border-ink pl-3 font-semibold">{slotErrors[slot.type]}</p>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-4">
                <label
                  className={`cursor-pointer border-2 border-ink px-4 py-2 font-semibold has-focus-visible:outline-3 ${isBusy ? 'opacity-60' : ''}`}
                >
                  {t(isBusy ? 'Reading your document…' : document ? 'Upload again' : 'Upload')}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,application/pdf"
                    aria-label={`Upload ${slot.label}`}
                    className="sr-only"
                    disabled={Boolean(busySlot)}
                    onChange={(event) => handleUpload(slot.type, event)}
                  />
                </label>
                {slot.type === 'udyam_certificate' && (!document || document.status === 'needs_review') && (
                  <button
                    type="button"
                    className="text-sm font-semibold underline underline-offset-4"
                    onClick={() => runAction(() => declareNoUdyam(businessId))}
                  >
                    {t('My business has no Udyam registration')}
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {status.review_note && (
        <section className="mt-6 border-l-4 border-ink pl-3">
          <h2 className="font-display text-xl font-bold">{t('A note from our team')}</h2>
          <p className="mt-1">{status.review_note}</p>
        </section>
      )}

      {status.problems_across_documents.length > 0 && (
        <section className="mt-6 border-l-4 border-marigold pl-3">
          <h2 className="font-display text-xl font-bold">{t('These documents do not agree')}</h2>
          <ul className="mt-1 space-y-1">
            {status.problems_across_documents.map((problem) => (
              <li key={problem}>{problem}.</li>
            ))}
          </ul>
        </section>
      )}

      <div aria-live="polite" className="mt-6">
        {overall ? (
          <section className={status.status === 'verified' ? 'bg-ink p-4 text-paper' : 'border-4 border-ink p-4'}>
            <h2 className="font-display text-2xl font-bold">{t(overall.title)}</h2>
            <p className="mt-1">{t(overall.text)}</p>
          </section>
        ) : (
          status.waiting_for.length > 0 && <p className="font-semibold">{t('Still needed:')} {status.waiting_for.map(t).join(', ')}.</p>
        )}
      </div>

      {error && <p role="alert" className="mt-4 font-semibold">{error}</p>}

      <button
        type="button"
        className={
          status.status === 'verified'
            ? 'mt-6 w-full bg-ink px-6 py-3 text-lg font-semibold text-paper sm:w-auto'
            : 'mt-6 font-semibold underline underline-offset-4'
        }
        onClick={onBack}
      >
        {t(status.status === 'verified' ? 'Continue to my order' : BACK_BUTTON_TEXT)}
      </button>

      <p className="mt-6 text-sm text-muted">
        {t('We do not keep your images, and ID numbers are masked.')}{' '}
        <button type="button" className="font-semibold underline underline-offset-4" onClick={withdraw}>
          {t('Withdraw consent and delete my details')}
        </button>
      </p>
    </div>
  )
}
