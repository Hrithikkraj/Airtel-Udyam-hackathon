import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { ChartColumn, CircleCheck, ClipboardList, KeyRound, LogOut, Phone, PhoneCall } from 'lucide-react'
import { staffRequest } from './api'
import FunnelDashboard, { type Funnel } from './FunnelDashboard'
import { rupees } from './format'
import Badge from './ui/Badge'
import Button from './ui/Button'
import { cx } from './ui/cx'
import { TextField } from './ui/Field'
import { Loading, Skeleton, SkeletonText } from './ui/Skeleton'

const KEY_STORAGE = 'accel-staff-key' // Cleared when the browser tab closes.

type DocumentResult = { document_type: string; name: string; status: string; reasons: string[]; fields: Record<string, string> }
type OrderSummary = {
  order_id: number
  status_label: string
  city: string | null
  employee_count: number
  num_sites: number
  monthly_total_inr: number
  help_phone: string | null
}
type Review = OrderSummary & { documents: DocumentResult[]; problems?: string[] }
type Callback = {
  callback_id: number
  phone: string
  city: string | null
  segment: string
  employee_count: number
  num_sites: number
  reasons: string[]
  monthly_estimate_inr: number | null
}
type Queue = {
  kyc_reviews: Review[]
  documents_not_accepted: Review[]
  help_requests: OrderSummary[]
  callbacks: Callback[]
  installations: OrderSummary[]
}
type LeadToCall = {
  lead_id: string
  business_name: string
  segment: string
  city: string
  source: string
  drop_reason: string
  score_pct: number
  score_reasons: string
  advice: string
}

const TABS = [
  { id: 'queue', label: 'Work queue', icon: ClipboardList },
  { id: 'funnel', label: 'Funnel', icon: ChartColumn },
  { id: 'leads', label: 'Leads to call', icon: PhoneCall },
]

const smallButton = 'btn btn-secondary btn-sm'
const mainButton = 'btn btn-primary btn-sm'

// Shimmering cards while staff data loads. One line for screen readers says what is loading.
function StaffLoading({ label }: { label: string }) {
  return (
    <Loading label={label} className="mt-6 space-y-4">
      {[0, 1].map((index) => (
        <div key={index} className="card space-y-3">
          <Skeleton className="h-5 w-1/3" />
          <SkeletonText lines={2} />
        </div>
      ))}
    </Loading>
  )
}

function describe(order: OrderSummary) {
  const place = order.city ?? 'City not listed'
  return `${place}, ${order.employee_count} people, ${order.num_sites} site${order.num_sites === 1 ? '' : 's'}, ${rupees(order.monthly_total_inr)} a month`
}

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section className="card mt-5">
      <h2 className="flex items-center justify-between gap-3 text-title-2 font-extrabold">
        {title}
        <Badge tone={count > 0 ? 'brand' : 'neutral'} icon={false} className="tabular-nums">
          {count}
        </Badge>
      </h2>
      {count === 0 ? (
        <p className="mt-3 flex items-center gap-2 text-ink-500">
          <CircleCheck aria-hidden="true" size={18} className="text-success-600" />
          Nothing waiting.
        </p>
      ) : (
        <ul className="mt-1 divide-y divide-ink-100">{children}</ul>
      )}
    </section>
  )
}

function DocumentReasons({ review }: { review: Review }) {
  const withReasons = review.documents.filter((document) => document.reasons.length > 0)
  return (
    <ul className="notice-warn mt-2 space-y-1">
      {withReasons.flatMap((document) => document.reasons.map((reason) => <li key={reason}>{reason}.</li>))}
      {(review.problems ?? []).map((problem) => <li key={problem}>{problem}.</li>)}
    </ul>
  )
}

function ReviewItem({ review, onDecide, isBusy }: { review: Review; onDecide: (id: number, decision: string, note: string) => void; isBusy: boolean }) {
  const [note, setNote] = useState('')
  return (
    <li className="py-4">
      <p className="font-bold">Order {review.order_id}</p>
      <p className="text-small text-ink-500">{describe(review)}</p>
      <DocumentReasons review={review} />
      <TextField
        label="Note for the owner (needed if you send documents back)"
        wrapperClassName="mt-3"
        maxLength={300}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      <div className="mt-2 flex flex-wrap gap-3">
        <button type="button" disabled={isBusy} className={mainButton} onClick={() => onDecide(review.order_id, 'approve', note)}>
          Approve documents
        </button>
        <button type="button" disabled={isBusy} className={smallButton} onClick={() => onDecide(review.order_id, 'reject', note)}>
          Send back to owner
        </button>
      </div>
    </li>
  )
}

function WorkQueue({ staffKey }: { staffKey: string }) {
  const [queue, setQueue] = useState<Queue>()
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    staffRequest<Queue>(staffKey, 'queue').then(setQueue).catch((caught) => setError(caught.message))
  }, [staffKey])

  useEffect(load, [load])

  async function act(path: string, body?: unknown) {
    setIsBusy(true)
    setError('')
    try {
      await staffRequest(staffKey, path, body ?? {})
      load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That did not work. Try again.')
    } finally {
      setIsBusy(false)
    }
  }

  if (!queue) return error ? <p role="alert" className="notice-error mt-6 font-medium">{error}</p> : <StaffLoading label="Loading the work queue…" />

  return (
    <div>
      {error && <p role="alert" className="notice-error mt-6 font-medium">{error}</p>}

      <Section title="Documents to review" count={queue.kyc_reviews.length}>
        {queue.kyc_reviews.map((review) => (
          <ReviewItem
            key={review.order_id}
            review={review}
            isBusy={isBusy}
            onDecide={(id, decision, note) => act(`orders/${id}/kyc-decision`, { decision, note })}
          />
        ))}
      </Section>

      <Section title="Leads the advisor could not close" count={queue.callbacks.length}>
        {queue.callbacks.map((callback) => (
          <li key={callback.callback_id} className="py-4">
            <p className="flex items-center gap-2 font-bold tabular-nums">
              <Phone aria-hidden="true" size={16} className="text-brand-600" />
              Call {callback.phone}
            </p>
            <p className="text-small text-ink-500">
              {callback.city ?? 'City not listed'}, {callback.employee_count} people, {callback.num_sites} site
              {callback.num_sites === 1 ? '' : 's'}
              {callback.monthly_estimate_inr ? `, about ${rupees(callback.monthly_estimate_inr)} a month` : ''}
            </p>
            <ul className="notice-warn mt-2 space-y-1">
              {callback.reasons.map((reason) => <li key={reason}>{reason}.</li>)}
            </ul>
            <button type="button" disabled={isBusy} className={`${smallButton} mt-2`} onClick={() => act(`callbacks/${callback.callback_id}/close`)}>
              Mark as called and delete number
            </button>
          </li>
        ))}
      </Section>

      <Section title="Help requests" count={queue.help_requests.length}>
        {queue.help_requests.map((order) => (
          <li key={order.order_id} className="py-4">
            <p className="font-semibold">
              Order {order.order_id}: {order.status_label}
            </p>
            <p className="text-small text-ink-500">{describe(order)}</p>
            {order.help_phone && <p className="mt-1 font-semibold tabular-nums">Call {order.help_phone}</p>}
            <button type="button" disabled={isBusy} className={`${smallButton} mt-2`} onClick={() => act(`orders/${order.order_id}/resolve-help`)}>
              Mark as resolved and delete number
            </button>
          </li>
        ))}
      </Section>

      <Section title="Installations" count={queue.installations.length}>
        {queue.installations.map((order) => (
          <li key={order.order_id} className="py-4">
            <p className="font-semibold">
              Order {order.order_id}: {order.status_label}
            </p>
            <p className="text-small text-ink-500">{describe(order)}</p>
            <button type="button" disabled={isBusy} className={`${mainButton} mt-2`} onClick={() => act(`orders/${order.order_id}/advance`)}>
              {order.status_label === 'Installation in progress' ? 'Finish and activate' : 'Start installation'}
            </button>
          </li>
        ))}
      </Section>

      <Section title="Documents not accepted" count={queue.documents_not_accepted.length}>
        {queue.documents_not_accepted.map((order) => (
          <li key={order.order_id} className="py-4">
            <p className="font-semibold">Order {order.order_id}</p>
            <p className="text-small text-ink-500">{describe(order)}</p>
            <DocumentReasons review={order} />
            <p className="mt-2 text-small text-ink-500">Waiting for the owner to upload a corrected document. These cannot be approved here.</p>
          </li>
        ))}
      </Section>
    </div>
  )
}

function LeadsToCall({ staffKey }: { staffKey: string }) {
  const [leads, setLeads] = useState<LeadToCall[]>()
  const [error, setError] = useState('')

  useEffect(() => {
    staffRequest<LeadToCall[]>(staffKey, 'leads-to-call?limit=20').then(setLeads).catch((caught) => setError(caught.message))
  }, [staffKey])

  if (!leads) return error ? <p role="alert" className="notice-error mt-6 font-medium">{error}</p> : <StaffLoading label="Loading the call list…" />

  return (
    <div className="py-6">
      <p className="max-w-[62ch]">
        Past leads who dropped out for a reason a call could fix, most promising first. The score only orders this list.
        It never decides who can buy.
      </p>
      <ol className="card mt-4 divide-y divide-ink-100">
        {leads.map((lead) => (
          <li key={lead.lead_id} className="py-4 first:pt-0 last:pb-0">
            <div className="flex items-center justify-between gap-3">
              <p className="font-bold">{lead.business_name}</p>
              <Badge tone="info" icon={false} className="tabular-nums">
                {lead.score_pct}%
              </Badge>
            </div>
            <span aria-hidden="true" className="mt-2 block h-1.5 overflow-hidden rounded-full bg-ink-100">
              <span className="block h-full rounded-full bg-info-500" style={{ width: `${Math.min(100, lead.score_pct)}%` }} />
            </span>
            <p className="text-small text-ink-500">{lead.city}, {lead.segment}, from {lead.source.toLowerCase()}</p>
            <p className="mt-1">Dropped because: {lead.drop_reason.toLowerCase()}</p>
            <p className="font-semibold">{lead.advice}</p>
            <p className="text-small text-ink-500">Score is higher because: {lead.score_reasons.replaceAll(';', ',').toLowerCase()}</p>
          </li>
        ))}
      </ol>
    </div>
  )
}

export default function StaffPage({ onExit }: { onExit: () => void }) {
  const [staffKey, setStaffKey] = useState(() => sessionStorage.getItem(KEY_STORAGE) ?? '')
  const [typedKey, setTypedKey] = useState('')
  const [tab, setTab] = useState('queue')
  const [funnel, setFunnel] = useState<Funnel>()
  const [error, setError] = useState('')

  useEffect(() => {
    if (tab === 'funnel' && staffKey && !funnel) {
      staffRequest<Funnel>(staffKey, 'funnel').then(setFunnel).catch((caught) => setError(caught.message))
    }
  }, [tab, staffKey, funnel])

  async function signIn(event: FormEvent) {
    event.preventDefault()
    setError('')
    try {
      await staffRequest(typedKey, 'queue')
      sessionStorage.setItem(KEY_STORAGE, typedKey)
      setStaffKey(typedKey)
    } catch {
      setError('That staff key is not valid.')
    }
  }

  function signOut() {
    sessionStorage.removeItem(KEY_STORAGE)
    setStaffKey('')
    onExit()
  }

  if (!staffKey) {
    return (
      <form onSubmit={signIn} className="card my-6 max-w-sm">
        <span aria-hidden="true" className="flex size-12 items-center justify-center rounded-card bg-ink-900 text-white">
          <KeyRound size={22} />
        </span>
        <TextField
          label="Staff key"
          type="password"
          required
          autoComplete="off"
          wrapperClassName="mt-4"
          value={typedKey}
          error={error || undefined}
          onChange={(event) => setTypedKey(event.target.value)}
        />
        <Button type="submit" block className="mt-4">
          Sign in
        </Button>
      </form>
    )
  }

  return (
    <div className="pb-12">
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" className="scrollbar-none flex gap-1 overflow-x-auto rounded-full bg-white p-1 shadow-e1">
          {TABS.map((item) => (
            <button
              key={item.id}
              role="tab"
              type="button"
              aria-selected={tab === item.id}
              className={cx(
                'flex min-h-11 items-center gap-2 rounded-full px-4 text-small font-bold whitespace-nowrap transition-colors duration-200',
                tab === item.id ? 'bg-ink-900 text-white' : 'text-ink-600 hover:bg-ink-100',
              )}
              onClick={() => setTab(item.id)}
            >
              <item.icon aria-hidden="true" size={16} />
              {item.label}
            </button>
          ))}
        </div>
        <Button variant="ghost" size="sm" icon={<LogOut aria-hidden="true" size={16} />} onClick={signOut}>
          Sign out
        </Button>
      </div>
      {tab === 'queue' && <WorkQueue staffKey={staffKey} />}
      {tab === 'funnel' &&
        (funnel ? (
          <FunnelDashboard funnel={funnel} />
        ) : error ? (
          <p role="alert" className="notice-error mt-6 font-medium">{error}</p>
        ) : (
          <StaffLoading label="Loading the funnel…" />
        ))}
      {tab === 'leads' && <LeadsToCall staffKey={staffKey} />}
    </div>
  )
}
