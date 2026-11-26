import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  FileText,
  FileUp,
  Lock,
  Minus,
  RotateCw,
  ShieldCheck,
  TriangleExclamationPoint,
  Users,
  X,
} from 'lucide-react'
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
import AnimatedCheck from './ui/AnimatedCheck'
import Badge, { type BadgeTone } from './ui/Badge'
import Button from './ui/Button'
import Confetti from './ui/Confetti'
import { cx } from './ui/cx'
import EmptyState from './ui/EmptyState'
import ProgressRing from './ui/ProgressRing'
import { Loading, Skeleton, SkeletonText } from './ui/Skeleton'

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

const DOCUMENT_STATUS: Record<string, { text: string; tone: BadgeTone }> = {
  verified: { text: 'Verified', tone: 'success' },
  needs_review: { text: 'Needs review', tone: 'warn' },
  failed: { text: 'Not accepted', tone: 'danger' },
  not_applicable: { text: 'Not needed', tone: 'neutral' },
}

const OVERALL_MESSAGE: Record<string, { title: string; text: string }> = {
  verified: { title: 'Your business is verified', text: 'All your documents agree with each other and with the registries.' },
  needs_review: { title: 'A person will check this', text: 'Our team will review the points above. Uploading a clearer or corrected document can settle them sooner.' },
  failed: { title: 'We cannot continue with these documents', text: 'Upload a corrected document to fix the points above, or ask our team for help.' },
}

const ACCEPTED_FILES = 'image/png,image/jpeg,image/webp,application/pdf'

type Props = {
  businessId: number
  hasGstin: boolean
  onBack: () => void
  onOpenQuote?: () => void // Back to the quote, to look at it or change it. Documents are kept.
}

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

export default function KycPage({ businessId, hasGstin, onBack, onOpenQuote }: Props) {
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
  // A picture of the chosen file while it is being read. Made in this browser only and dropped as
  // soon as reading ends: the image is never stored, here or on the server.
  const [preview, setPreview] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
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

  // The preview is released from memory as soon as it is no longer shown.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview)
    }
  }, [preview])

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
  const doneCount = steps.filter((slot) => hasPassed(documentFor(slot.type))).length
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
      setPreview(null)
    }
  }

  // One path for every way of giving a file: choosing it, taking a photo, or dropping it here.
  function uploadFile(index: number, slotType: string, file: File) {
    if (isBusy) return
    setPreview(file.type.startsWith('image/') ? URL.createObjectURL(file) : null)
    runStep(index, () => uploadKycDocument(businessId, slotType, file), 'That upload did not work. Try again.')
  }

  function handleUpload(index: number, slotType: string, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = '' // Lets the owner choose the same file again after fixing it.
    if (!file) return
    uploadFile(index, slotType, file)
  }

  function handleDrop(index: number, slotType: string, event: DragEvent<HTMLElement>) {
    event.preventDefault()
    setIsDragging(false)
    const file = event.dataTransfer.files?.[0]
    if (file && !isLocked) uploadFile(index, slotType, file)
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
    return (
      <EmptyState
        role="alert"
        picture="offline"
        title={t('This page did not load.')}
        text={error}
        action={
          <Button variant="secondary" icon={<RotateCw aria-hidden="true" size={18} />} onClick={() => window.location.reload()}>
            {t('Try again')}
          </Button>
        }
      />
    )
  }
  if (!status || !notice) {
    return (
      <Loading label={t('Loading…')} className="py-6">
        <div className="card space-y-4">
          <div className="flex items-center gap-4">
            <Skeleton className="size-16 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-4 w-1/3" />
            </div>
          </div>
          <SkeletonText lines={2} />
          <Skeleton className="h-40 w-full rounded-card" />
        </div>
      </Loading>
    )
  }

  // ---------- Consent comes first. Nothing can be uploaded before it. ----------
  if (!status.has_consent) {
    if (hasDeclined) {
      return (
        <EmptyState
          picture="document"
          title={t('We have not read any documents')}
          text={t('Your quote is saved, but we cannot activate your order without verifying your business. You can agree when you are ready, or ask our team about other ways to verify.')}
          action={
            <>
              <Button onClick={() => setHasDeclined(false)}>{t('Read the notice again')}</Button>
              <Button variant="secondary" onClick={onBack}>
                {t(BACK_BUTTON_TEXT)}
              </Button>
            </>
          }
        />
      )
    }
    return (
      <div className="card my-6">
        <span aria-hidden="true" className="flex size-14 items-center justify-center rounded-card bg-brand-50 text-brand-600">
          <ShieldCheck size={28} />
        </span>
        <h2 className="mt-4 text-title-1 font-extrabold">{t('Before you upload')}</h2>
        <ul className="mt-4 max-w-[62ch] space-y-3">
          {notice.points.map((point) => (
            <li key={point} className="flex gap-3">
              <span aria-hidden="true" className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-success-50 text-success-700">
                <Check size={14} strokeWidth={3} />
              </span>
              <span>{t(point)}</span>
            </li>
          ))}
        </ul>
        {error && (
          <p role="alert" className="notice-error mt-4 font-semibold">
            {error}
          </p>
        )}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button size="lg" iconAfter={<ArrowRight aria-hidden="true" size={18} />} onClick={() => runAction(() => giveKycConsent(businessId, notice.version))}>
            {t('I agree, continue')}
          </Button>
          <Button variant="ghost" onClick={() => setHasDeclined(true)}>
            {t('Not now')}
          </Button>
        </div>
        <p className="mt-4 text-caption text-ink-500">
          {t('Notice version')} {notice.version}
        </p>
      </div>
    )
  }

  // ---------- One document at a time ----------
  const overall = OVERALL_MESSAGE[status.status]

  function stepState(index: number): { tone: 'done' | 'review' | 'failed' | 'current' | 'waiting'; text: string } {
    const document = documentFor(steps[index].type)
    if (document?.status === 'needs_review') return { tone: 'review', text: 'Needs review' }
    if (hasPassed(document)) return { tone: 'done', text: 'Done' }
    if (index === firstUnfinished) return document ? { tone: 'failed', text: 'Not accepted, upload again' } : { tone: 'current', text: 'Current step' }
    return { tone: 'waiting', text: 'Waiting' }
  }

  function renderResult(document: KycDocument) {
    const badge = DOCUMENT_STATUS[document.status]
    const mismatches = document.mismatches ?? []
    return (
      <>
        {badge && (
          <div className="mt-4 flex items-center gap-3">
            {document.status === 'verified' && <AnimatedCheck size={40} />}
            <Badge tone={badge.tone} className="text-small">
              {t(badge.text)}
            </Badge>
          </div>
        )}
        {document.reasons.length > 0 && (
          <ul className={cx('mt-3 list-disc space-y-1 pl-8', document.status === 'failed' ? 'notice-error' : 'notice-warn')}>
            {document.reasons.map((reason) => (
              <li key={reason}>{reason}.</li>
            ))}
          </ul>
        )}
        {Object.keys(document.fields).length > 0 && (
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-control bg-ink-50 px-4 py-3 text-small">
            {Object.entries(document.fields).map(([field, value]) => (
              <div key={field} className="contents">
                <dt className="text-ink-500">{t(FIELD_LABELS[field] ?? field)}</dt>
                <dd className="min-w-0 font-semibold break-words">{value}</dd>
              </div>
            ))}
          </dl>
        )}
        {mismatches.length > 0 && (
          <section className="notice-warn mt-3">
            <h3 className="flex items-center gap-2 font-bold">
              <TriangleExclamationPoint aria-hidden="true" size={18} className="text-warn-600" />
              {t('This does not match your earlier documents')}
            </h3>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {mismatches.map((problem) => (
                <li key={problem}>{problem}.</li>
              ))}
            </ul>
          </section>
        )}
        {document.status === 'needs_review' && (
          <p className="mt-3 flex items-start gap-2 text-ink-700">
            <Users aria-hidden="true" size={18} className="mt-0.5 shrink-0 text-ink-500" />
            {t('A person will check this. You can continue now, or upload a clearer or corrected copy.')}
          </p>
        )}
      </>
    )
  }

  function renderUploadZone(index: number, slot: Slot, hasDocument: boolean, compact: boolean) {
    // While a document is read: its picture (if it is a photo) under a moving shine, and the words.
    if (isBusy && !stepError) {
      return (
        <div role="status" className="scanning mt-4 flex min-h-44 flex-col items-center justify-center gap-3 overflow-hidden rounded-card bg-ink-50 p-4 ring-1 ring-ink-200">
          {preview ? (
            <img src={preview} alt="" className="max-h-40 rounded-control object-contain opacity-80 shadow-e2" />
          ) : (
            <FileText aria-hidden="true" size={40} className="text-ink-400" />
          )}
          <p className="font-semibold">{t('Reading your document…')}</p>
        </div>
      )
    }
    // A document that passed only needs a small way to replace it, not a whole upload area.
    if (compact) {
      return (
        <label className="btn btn-quiet btn-sm mt-4 cursor-pointer has-focus-visible:outline-3">
          <RotateCw aria-hidden="true" size={16} />
          {t('Upload again')}
          <input
            type="file"
            accept={ACCEPTED_FILES}
            aria-label={`Upload ${slot.label}`}
            className="sr-only"
            disabled={isBusy}
            onChange={(event) => handleUpload(index, slot.type, event)}
          />
        </label>
      )
    }
    return (
      <div
        onDragOver={(event) => {
          event.preventDefault()
          if (!isDragging) setIsDragging(true)
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => handleDrop(index, slot.type, event)}
        className={cx(
          'mt-4 rounded-card border-2 border-dashed p-5 text-center transition-colors duration-200',
          isDragging ? 'border-brand-600 bg-brand-50' : 'border-ink-300 bg-ink-50/60',
        )}
      >
        <span aria-hidden="true" className="mx-auto flex size-12 items-center justify-center rounded-full bg-white text-brand-600 shadow-e1">
          <FileUp size={24} />
        </span>
        <p className="mt-2 font-semibold">{t(hasDocument ? 'Upload a new copy' : 'Add a photo or PDF')}</p>
        <p className="text-small text-ink-500">
          <span className="hidden md:inline">{t('Drag it here, or')} </span>
          {t('Photo or PDF, up to 15 MB.')}
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {/* On a phone this opens the camera straight away. Same upload as choosing a file. */}
          <label className="btn btn-primary btn-sm cursor-pointer has-focus-visible:outline-3 md:hidden">
            <Camera aria-hidden="true" size={18} />
            {t('Take a photo')}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              aria-label={`${t('Take a photo')}: ${t(slot.label)}`}
              className="sr-only"
              disabled={isBusy}
              onChange={(event) => handleUpload(index, slot.type, event)}
            />
          </label>
          <label className="btn btn-secondary btn-sm cursor-pointer has-focus-visible:outline-3">
            <FileUp aria-hidden="true" size={18} />
            {t(hasDocument ? 'Upload again' : 'Upload')}
            <input
              type="file"
              accept={ACCEPTED_FILES}
              aria-label={`Upload ${slot.label}`}
              className="sr-only"
              disabled={isBusy}
              onChange={(event) => handleUpload(index, slot.type, event)}
            />
          </label>
        </div>
      </div>
    )
  }

  function renderStep(index: number) {
    const slot = steps[index]
    const document = documentFor(slot.type)
    const passed = hasPassed(document)
    const nextSlot = steps[firstUnfinished]
    return (
      <section aria-labelledby="kyc-step-heading" className="card mt-5">
        <p className="eyebrow">{hindi ? `चरण ${index + 1} (कुल ${steps.length})` : `Step ${index + 1} of ${steps.length}`}</p>
        <h2 id="kyc-step-heading" ref={headingRef} tabIndex={-1} className="mt-1 text-title-1 font-extrabold break-words">
          {t(slot.label)}
        </h2>
        {!document && <p className="mt-1 text-ink-500">{t(slot.hint)}</p>}

        {document && renderResult(document)}

        {stepError && (
          <p role="alert" className="notice-error mt-4 flex items-start gap-2 font-medium break-words">
            <X aria-hidden="true" size={18} className="mt-0.5 shrink-0" />
            {stepError}
          </p>
        )}

        {isLocked ? (
          <p className="mt-4 flex items-center gap-2 text-small text-ink-500">
            <Lock aria-hidden="true" size={16} />
            {t('Your order has been placed, so documents can no longer be changed here.')}
          </p>
        ) : (
          renderUploadZone(index, slot, Boolean(document), passed)
        )}

        {!isLocked && slot.type === 'udyam_certificate' && (!document || document.status === 'needs_review') && (
          <div className="mt-3 text-center">
            <button
              type="button"
              disabled={isBusy}
              className="link text-small disabled:opacity-60"
              onClick={() => runStep(index, () => declareNoUdyam(businessId), 'That did not work. Try again.')}
            >
              <Minus aria-hidden="true" size={16} />
              {t('My business has no Udyam registration')}
            </button>
          </div>
        )}

        <div className="mt-5 flex flex-wrap-reverse items-center justify-between gap-3 border-t border-ink-100 pt-4">
          {index > 0 ? (
            <Button variant="ghost" disabled={isBusy} icon={<ArrowLeft aria-hidden="true" size={18} />} onClick={() => goToStep(index - 1)}>
              {t('Back')}
            </Button>
          ) : (
            <span />
          )}
          {passed && (
            <Button disabled={isBusy} iconAfter={<ArrowRight aria-hidden="true" size={18} />} onClick={() => goToStep(null)}>
              {nextSlot ? `${t('Next:')} ${t(nextSlot.label)}` : t('See my result')}
            </Button>
          )}
        </div>
      </section>
    )
  }

  const STEP_LOOK = {
    done: { icon: <Check size={14} strokeWidth={3} />, circle: 'bg-success-500 text-white' },
    review: { icon: <TriangleExclamationPoint size={13} strokeWidth={2.5} />, circle: 'bg-warn-400 text-ink-900' },
    failed: { icon: <X size={14} strokeWidth={3} />, circle: 'bg-danger-600 text-white' },
    current: { icon: null, circle: 'bg-brand-600 text-white ring-4 ring-brand-100' },
    waiting: { icon: null, circle: 'bg-white text-ink-500 ring-[1.5px] ring-ink-300' },
  }

  return (
    <div className="py-6">
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {/* Progress: a ring for how much is done, and every document with its state in words. */}
      <div className="card flex flex-col gap-4 sm:flex-row sm:items-center">
        <ProgressRing
          value={steps.length ? doneCount / steps.length : 0}
          label={hindi ? `${steps.length} में से ${doneCount} दस्तावेज़ पूरे` : `${doneCount} of ${steps.length} documents done`}
          tone={isSummary && status.status === 'verified' ? 'success' : 'brand'}
        >
          {doneCount}/{steps.length}
        </ProgressRing>
        <nav aria-label={t('Steps')} className="min-w-0 flex-1">
          <ol className="grid gap-1.5 sm:grid-cols-2">
            {steps.map((slot, index) => {
              const state = stepState(index)
              const look = STEP_LOOK[state.tone]
              const isHere = !isSummary && index === view
              return (
                <li
                  key={slot.type}
                  aria-current={isHere ? 'step' : undefined}
                  className={cx('flex items-center gap-2.5 rounded-control px-2 py-1.5', isHere && 'bg-brand-50')}
                >
                  <span aria-hidden="true" className={cx('flex size-6 shrink-0 items-center justify-center rounded-full text-caption font-bold', look.circle)}>
                    {look.icon ?? index + 1}
                  </span>
                  <span className="min-w-0">
                    <span className={cx('block text-small leading-tight break-words', isHere ? 'font-bold' : 'font-semibold')}>{t(slot.label)}</span>
                    <span className="block text-caption text-ink-500">{t(state.text)}</span>
                  </span>
                </li>
              )
            })}
          </ol>
        </nav>
      </div>

      {!isSummary && steps[view] && renderStep(view)}

      {isSummary && (
        <div aria-live="polite" className="relative mt-5">
          {overall ? (
            <section
              className={cx(
                'card relative overflow-hidden text-center',
                status.status === 'verified' ? 'bg-success-50!' : status.status === 'failed' ? 'bg-danger-50!' : 'bg-warn-50!',
              )}
            >
              {status.status === 'verified' && <Confetti />}
              <span className="mx-auto flex justify-center">
                {status.status === 'verified' ? (
                  <AnimatedCheck size={72} />
                ) : (
                  <span
                    aria-hidden="true"
                    className={cx('flex size-16 items-center justify-center rounded-full', status.status === 'failed' ? 'bg-danger-100 text-danger-700' : 'bg-warn-100 text-warn-700')}
                  >
                    {status.status === 'failed' ? <X size={30} /> : <Users size={30} />}
                  </span>
                )}
              </span>
              <h2 className="mt-4 text-title-1 font-extrabold">{t(overall.title)}</h2>
              <p className="mx-auto mt-1 max-w-[48ch] text-ink-700">{t(overall.text)}</p>
            </section>
          ) : (
            status.waiting_for.length > 0 && (
              <p className="font-semibold">
                {t('Still needed:')} {status.waiting_for.map(t).join(', ')}.
              </p>
            )
          )}
        </div>
      )}

      {isSummary && (
        <section aria-labelledby="kyc-step-heading" className="card mt-4">
          <h2 id="kyc-step-heading" ref={headingRef} tabIndex={-1} className="text-title-2 font-extrabold">
            {t('Your documents')}
          </h2>
          <ul className="mt-2 divide-y divide-ink-100">
            {steps.map((slot, index) => {
              const document = documentFor(slot.type)
              const badge = document && DOCUMENT_STATUS[document.status]
              return (
                <li key={slot.type} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="flex min-w-0 items-center gap-2 font-semibold break-words">
                    <FileText aria-hidden="true" size={18} className="shrink-0 text-ink-400" />
                    {t(slot.label)}
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    {badge && <Badge tone={badge.tone}>{t(badge.text)}</Badge>}
                    <button type="button" aria-label={`${t('Change')}: ${t(slot.label)}`} className="link text-small" onClick={() => goToStep(index)}>
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
        <section className="notice mt-4">
          <h2 className="font-bold">{t('A note from our team')}</h2>
          <p className="mt-1">{status.review_note}</p>
        </section>
      )}

      {isSummary && status.problems_across_documents.length > 0 && (
        <section className="notice-warn mt-4">
          <h2 className="flex items-center gap-2 font-bold">
            <TriangleExclamationPoint aria-hidden="true" size={18} className="text-warn-600" />
            {t('These documents do not agree')}
          </h2>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {status.problems_across_documents.map((problem) => (
              <li key={problem}>{problem}.</li>
            ))}
          </ul>
        </section>
      )}

      {error && (
        <p role="alert" className="notice-error mt-4 font-semibold">
          {error}
        </p>
      )}

      {/* Leaving this page never loses anything: documents stay saved on the server. */}
      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2">
        {isSummary && status.status === 'verified' ? (
          <Button size="lg" className="w-full sm:w-auto" iconAfter={<ArrowRight aria-hidden="true" size={18} />} onClick={onBack}>
            {t('Continue to my order')}
          </Button>
        ) : (
          <button type="button" className="link" onClick={onBack}>
            {t(BACK_BUTTON_TEXT)}
          </button>
        )}
        {onOpenQuote && (
          <button type="button" className="link" onClick={onOpenQuote}>
            {t('See or change my quote')}
          </button>
        )}
      </div>

      <p className="mt-6 flex flex-wrap items-center gap-x-2 rounded-control bg-white/60 px-4 py-3 text-small text-ink-600 ring-1 ring-ink-200">
        <ShieldCheck aria-hidden="true" size={16} className="shrink-0 text-success-600" />
        {t('We do not keep your images, and ID numbers are masked.')}
        <button type="button" className="link text-small" onClick={withdraw}>
          {t('Withdraw consent and delete my details')}
        </button>
      </p>
    </div>
  )
}
