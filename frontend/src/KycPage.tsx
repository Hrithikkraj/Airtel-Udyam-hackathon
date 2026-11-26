import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import {
  ApiError,
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

type Slot = (typeof ALL_SLOTS)[number]

// The server sends the step order. An older server does not, so the same order is worked out here.
function stepsFor(status: KycStatus | undefined, hasGstin: boolean): Slot[] {
  const types = status?.steps?.length
    ? status.steps
    : ALL_SLOTS.map((slot) => slot.type).filter((type) => hasGstin || type !== 'gst_certificate')
  return types.map((type) => ALL_SLOTS.find((slot) => slot.type === type)).filter((slot): slot is Slot => Boolean(slot))
}

// Needs review, not needed and verified all let the owner move on. Only a failed document stops them.
const hasPassed = (document: KycDocument | undefined) => Boolean(document) && document!.status !== 'failed'

export default function KycPage({ businessId, hasGstin, onBack }: Props) {
  const { t, language } = useLanguage()
  const hindi = language === 'hi'
  const [notice, setNotice] = useState<KycNotice>()
  const [status, setStatus] = useState<KycStatus>()
  const [hasDeclined, setHasDeclined] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const [stepError, setStepError] = useState('')
  const [error, setError] = useState('')
  // The step the owner is looking at. Null means "the first unfinished step", which always comes
  // from the server's status, so a reload or a return resumes in the right place. Never stored.
  const [viewIndex, setViewIndex] = useState<number | null>(null)
  // A 409 means the order is placed: results can be read, but nothing can be changed here.
  const [isLocked, setIsLocked] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const shownView = useRef<number | null>(null)

  useEffect(() => {
    Promise.all([fetchKycNotice(), fetchKycStatus(businessId)])
      .then(([loadedNotice, loadedStatus]) => {
        setNotice(loadedNotice)
        setStatus(loadedStatus)
      })
      .catch(() => setError('This page did not load. Check that the backend is running, then reload.'))
  }, [businessId])

  // ---------- Where the owner is in the steps ----------
  const steps = stepsFor(status, hasGstin)
  const documentFor = (type: string): KycDocument | undefined => status?.documents.find((d) => d.document_type === type)
  const firstUnfinished = (() => {
    const index = steps.findIndex((slot) => !hasPassed(documentFor(slot.type)))
    return index === -1 ? steps.length : index
  })()
  // The owner may look back, but never past the first unfinished step.
  const view = Math.min(viewIndex ?? firstUnfinished, firstUnfinished)
  const isSummary = view === steps.length
  const announcement = isSummary
    ? t('Your result')
    : steps[view]
      ? hindi
        ? `चरण ${view + 1} (कुल ${steps.length}): ${t(steps[view].label)}`
        : `Step ${view + 1} of ${steps.length}: ${steps[view].label}`
      : ''

  // When the step changes, move focus to its heading. Not on the first load of the page.
  useEffect(() => {
    if (!status?.has_consent) {
      shownView.current = null
      return
    }
    if (shownView.current !== null && shownView.current !== view) headingRef.current?.focus()
    shownView.current = view
  }, [view, status?.has_consent])

  async function runAction(action: () => Promise<KycStatus>) {
    setError('')
    try {
      setStatus(await action())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That did not work. Try again.')
    }
  }

  // An upload or "no Udyam" on one step. The step stays where it is, so its result shows right there.
  async function runStep(index: number, action: () => Promise<KycStatus>, fallback: string) {
    if (isBusy) return
    setIsBusy(true)
    setStepError('')
    try {
      setStatus(await action())
      setViewIndex(index)
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) setIsLocked(true)
      setStepError(caught instanceof Error ? caught.message : fallback)
    } finally {
      setIsBusy(false)
    }
  }

  function handleUpload(index: number, slotType: string, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = '' // Lets the owner choose the same file again after fixing it.
    if (!file) return
    runStep(index, () => uploadKycDocument(businessId, slotType, file), 'That upload did not work. Try again.')
  }

  function goToStep(index: number | null) {
    setStepError('')
    setViewIndex(index)
  }

  function withdraw() {
    if (window.confirm('Withdraw consent and delete the details we read from your documents?')) {
      // The steps start again from the first one after consent is given again.
      setViewIndex(null)
      setStepError('')
      setIsLocked(false)
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

  // ---------- One document at a time ----------
  const overall = OVERALL_MESSAGE[status.status]

  function stepState(index: number) {
    const document = documentFor(steps[index].type)
    if (document?.status === 'needs_review') return { symbol: '!', text: 'Needs review' }
    if (hasPassed(document)) return { symbol: '✓', text: 'Done' }
    if (index === firstUnfinished) return document ? { symbol: '✕', text: 'Not accepted, upload again' } : { symbol: '→', text: 'Current step' }
    return { symbol: '○', text: 'Waiting' }
  }

  function renderResult(document: KycDocument) {
    const badge = DOCUMENT_STATUS[document.status]
    const mismatches = document.mismatches ?? []
    return (
      <>
        {badge && (
          <p className="mt-3">
            <span className={badge.style}>
              <span aria-hidden="true">{badge.symbol}</span>
              {t(badge.text)}
            </span>
          </p>
        )}
        {document.reasons.length > 0 && (
          <ul className={`mt-3 space-y-1 ${document.status === 'failed' ? 'notice-error' : 'notice-warn'}`}>
            {document.reasons.map((reason) => (
              <li key={reason}>{reason}.</li>
            ))}
          </ul>
        )}
        {Object.keys(document.fields).length > 0 && (
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 text-sm">
            {Object.entries(document.fields).map(([field, value]) => (
              <div key={field} className="contents">
                <dt className="text-muted">{FIELD_LABELS[field] ?? field}</dt>
                <dd className="min-w-0 break-words">{value}</dd>
              </div>
            ))}
          </dl>
        )}
        {mismatches.length > 0 && (
          <section className="notice-warn mt-3">
            <h3 className="font-semibold">{t('This does not match your earlier documents')}</h3>
            <ul className="mt-1 space-y-1">
              {mismatches.map((problem) => (
                <li key={problem}>{problem}.</li>
              ))}
            </ul>
          </section>
        )}
        {document.status === 'needs_review' && (
          <p className="mt-3">{t('A person will check this. You can continue now, or upload a clearer or corrected copy.')}</p>
        )}
      </>
    )
  }

  function renderStep(index: number) {
    const slot = steps[index]
    const document = documentFor(slot.type)
    const passed = hasPassed(document)
    const nextSlot = steps[firstUnfinished]
    return (
      <section aria-labelledby="kyc-step-heading" className="panel mt-6">
        <p className="text-sm font-semibold text-muted">
          {hindi ? `चरण ${index + 1} (कुल ${steps.length})` : `Step ${index + 1} of ${steps.length}`}
        </p>
        <h2 id="kyc-step-heading" ref={headingRef} tabIndex={-1} className="font-display text-xl font-semibold break-words">
          {t(slot.label)}
        </h2>

        {!document && (
          <>
            <p className="mt-1 text-sm text-muted">{t(slot.hint)}</p>
            <p className="text-sm text-muted">{t('Photo or PDF, up to 15 MB.')}</p>
          </>
        )}
        {document && renderResult(document)}

        {stepError && (
          <p role="alert" className="notice-error mt-3 font-medium break-words">{stepError}</p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {passed && (
            <button
              type="button"
              disabled={isBusy}
              className="min-h-11 bg-accent px-5 py-2 font-semibold text-white disabled:opacity-60"
              onClick={() => goToStep(null)}
            >
              {nextSlot ? `${t('Next:')} ${t(nextSlot.label)}` : t('See my result')}
            </button>
          )}
          {!isLocked && (
            <label
              className={`inline-flex min-h-11 cursor-pointer items-center border border-field px-4 py-2 font-semibold has-focus-visible:outline-3 ${isBusy ? 'opacity-60' : ''}`}
            >
              {t(isBusy ? 'Reading your document…' : document ? 'Upload again' : 'Upload')}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,application/pdf"
                aria-label={`Upload ${slot.label}`}
                className="sr-only"
                disabled={isBusy}
                onChange={(event) => handleUpload(index, slot.type, event)}
              />
            </label>
          )}
          {!isLocked && slot.type === 'udyam_certificate' && (!document || document.status === 'needs_review') && (
            <button
              type="button"
              disabled={isBusy}
              className="min-h-11 text-sm font-medium text-accent underline underline-offset-4 disabled:opacity-60"
              onClick={() => runStep(index, () => declareNoUdyam(businessId), 'That did not work. Try again.')}
            >
              {t('My business has no Udyam registration')}
            </button>
          )}
        </div>

        {index > 0 && (
          <button
            type="button"
            disabled={isBusy}
            className="mt-4 min-h-11 font-medium text-accent underline underline-offset-4 disabled:opacity-60"
            onClick={() => goToStep(index - 1)}
          >
            {t('Back')}
          </button>
        )}
      </section>
    )
  }

  return (
    <div className="py-8">
      <p aria-live="polite" className="sr-only">{announcement}</p>

      <nav aria-label={t('Steps')}>
        <ol className="space-y-1">
          {steps.map((slot, index) => {
            const state = stepState(index)
            return (
              <li
                key={slot.type}
                aria-current={!isSummary && index === view ? 'step' : undefined}
                className={`flex flex-wrap items-baseline gap-x-2 ${!isSummary && index === view ? 'font-semibold' : 'text-muted'}`}
              >
                <span aria-hidden="true" className="w-4 text-center">{state.symbol}</span>
                <span className="break-words">{index + 1}. {t(slot.label)}</span>
                <span className="text-sm">({t(state.text)})</span>
              </li>
            )
          })}
        </ol>
      </nav>

      {!isSummary && steps[view] && renderStep(view)}

      {isSummary && (
        <section aria-labelledby="kyc-step-heading" className="mt-6">
          <h2 id="kyc-step-heading" ref={headingRef} tabIndex={-1} className="font-display text-xl font-semibold">
            {t('Your documents')}
          </h2>
          <ul className="mt-2 divide-y divide-rule">
            {steps.map((slot, index) => {
              const document = documentFor(slot.type)
              const badge = document && DOCUMENT_STATUS[document.status]
              return (
                <li key={slot.type} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="font-semibold break-words">{t(slot.label)}</span>
                  <span className="flex flex-wrap items-center gap-3">
                    {badge && (
                      <span className={badge.style}>
                        <span aria-hidden="true">{badge.symbol}</span>
                        {t(badge.text)}
                      </span>
                    )}
                    <button
                      type="button"
                      aria-label={`${t('Change')}: ${t(slot.label)}`}
                      className="min-h-11 font-medium text-accent underline underline-offset-4"
                      onClick={() => goToStep(index)}
                    >
                      {t('Change')}
                    </button>
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {isSummary && status.review_note && (
        <section className="notice mt-6">
          <h2 className="font-display text-xl font-semibold">{t('A note from our team')}</h2>
          <p className="mt-1">{status.review_note}</p>
        </section>
      )}

      {isSummary && status.problems_across_documents.length > 0 && (
        <section className="notice-warn mt-6">
          <h2 className="font-display text-xl font-semibold">{t('These documents do not agree')}</h2>
          <ul className="mt-1 space-y-1">
            {status.problems_across_documents.map((problem) => (
              <li key={problem}>{problem}.</li>
            ))}
          </ul>
        </section>
      )}

      {isSummary && (
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
      )}

      {error && <p role="alert" className="mt-4 font-semibold">{error}</p>}

      <button
        type="button"
        className={
          isSummary && status.status === 'verified'
            ? 'mt-6 w-full bg-accent px-6 py-3 text-lg font-semibold text-white sm:w-auto'
            : 'mt-6 min-h-11 font-medium text-accent underline underline-offset-4'
        }
        onClick={onBack}
      >
        {t(isSummary && status.status === 'verified' ? 'Continue to my order' : BACK_BUTTON_TEXT)}
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
