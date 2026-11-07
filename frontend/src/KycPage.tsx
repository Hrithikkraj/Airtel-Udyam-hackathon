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
  verified: { text: 'Verified', symbol: '✓', style: 'badge badge-success' },
  needs_review: { text: 'Needs review', symbol: '!', style: 'badge badge-warn' },
  failed: { text: 'Not accepted', symbol: '✕', style: 'badge badge-danger' },
  not_applicable: { text: 'Not needed', symbol: '–', style: 'badge badge-neutral' },
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
          <h2 className="font-display text-2xl font-semibold">{t('We have not read any documents')}</h2>
          <p className="mt-2 max-w-[62ch]">
            {t('Your quote is saved, but we cannot activate your order without verifying your business. You can agree when you are ready, or ask our team about other ways to verify.')}
          </p>
          <div className="mt-6 flex flex-wrap gap-4">
            <button type="button" className="bg-accent px-6 py-3 font-semibold text-white" onClick={() => setHasDeclined(false)}>
              {t('Read the notice again')}
            </button>
            <button type="button" className="font-medium text-accent underline underline-offset-4" onClick={onBack}>
              {t(BACK_BUTTON_TEXT)}
            </button>
          </div>
        </div>
      )
    }
    return (
      <div className="panel my-6">
        <h2 className="font-display text-xl font-semibold">{t('Before you upload')}</h2>
        <ul className="mt-3 max-w-[62ch] space-y-3">
          {notice.points.map((point) => (
            <li key={point} className="flex gap-2"><span aria-hidden="true" className="text-accent">✓</span><span>{t(point)}</span></li>
          ))}
        </ul>
        {error && <p role="alert" className="mt-4 font-semibold">{error}</p>}
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <button
            type="button"
            className="bg-accent px-6 py-3 font-semibold text-white"
            onClick={() => runAction(() => giveKycConsent(businessId, notice.version))}
          >
            {t('I agree, continue')}
          </button>
          <button type="button" className="font-medium text-accent underline underline-offset-4" onClick={() => setHasDeclined(true)}>
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
      <ul className="space-y-3">
        {slots.map((slot) => {
          const document = documentFor(slot.type)
          const badge = document && DOCUMENT_STATUS[document.status]
          const isBusy = busySlot === slot.type
          return (
            <li key={slot.type} className="panel">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="font-display text-lg font-semibold">{t(slot.label)}</h2>
                  {!document && <p className="text-sm text-muted">{t(slot.hint)}</p>}
                  {!document && <p className="text-sm text-muted">{t('Photo or PDF, up to 15 MB.')}</p>}
                </div>
                {badge && (
                  <span className={badge.style}>
                    <span aria-hidden="true">{badge.symbol}</span>
                    {t(badge.text)}
                  </span>
                )}
              </div>

              {document && document.reasons.length > 0 && (
                <ul className={`mt-2 space-y-1 ${document.status === 'failed' ? 'notice-error' : 'notice-warn'}`}>
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
                <p role="alert" className="notice-error mt-2 font-medium">{slotErrors[slot.type]}</p>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-4">
                <label
                  className={`cursor-pointer border border-field px-4 py-2 font-semibold has-focus-visible:outline-3 ${isBusy ? 'opacity-60' : ''}`}
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
                    className="text-sm font-medium text-accent underline underline-offset-4"
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
        <section className="notice mt-6">
          <h2 className="font-display text-xl font-semibold">{t('A note from our team')}</h2>
          <p className="mt-1">{status.review_note}</p>
        </section>
      )}

      {status.problems_across_documents.length > 0 && (
        <section className="notice-warn mt-6">
          <h2 className="font-display text-xl font-semibold">{t('These documents do not agree')}</h2>
          <ul className="mt-1 space-y-1">
            {status.problems_across_documents.map((problem) => (
              <li key={problem}>{problem}.</li>
            ))}
          </ul>
        </section>
      )}

      <div aria-live="polite" className="mt-6">
        {overall ? (
          <section className={status.status === 'verified' ? 'notice-success p-4' : status.status === 'failed' ? 'notice-error p-4' : 'notice-warn p-4'}>
            <h2 className="font-display text-2xl font-semibold">{t(overall.title)}</h2>
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
            ? 'mt-6 w-full bg-accent px-6 py-3 text-lg font-semibold text-white sm:w-auto'
            : 'mt-6 font-medium text-accent underline underline-offset-4'
        }
        onClick={onBack}
      >
        {t(status.status === 'verified' ? 'Continue to my order' : BACK_BUTTON_TEXT)}
      </button>

      <p className="mt-6 text-sm text-muted">
        {t('We do not keep your images, and ID numbers are masked.')}{' '}
        <button type="button" className="font-medium text-accent underline underline-offset-4" onClick={withdraw}>
          {t('Withdraw consent and delete my details')}
        </button>
      </p>
    </div>
  )
}
