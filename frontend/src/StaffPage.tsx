import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { staffRequest } from './api'
import FunnelDashboard, { type Funnel } from './FunnelDashboard'
import { rupees } from './format'

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
  { id: 'queue', label: 'Work queue' },
  { id: 'funnel', label: 'Funnel' },
  { id: 'leads', label: 'Leads to call' },
]

const smallButton = 'border border-field px-3 py-1.5 font-semibold disabled:opacity-60'
const mainButton = 'bg-accent px-3 py-1.5 font-semibold text-white disabled:opacity-60'

function describe(order: OrderSummary) {
  const place = order.city ?? 'City not listed'
  return `${place}, ${order.employee_count} people, ${order.num_sites} site${order.num_sites === 1 ? '' : 's'}, ${rupees(order.monthly_total_inr)} a month`
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="panel mt-6">
      <h2 className="section-title">
        {title} <span className="font-body text-lg font-normal text-muted tabular-nums">{count}</span>
      </h2>
      {count === 0 ? <p className="py-3 text-muted">Nothing waiting.</p> : <ul className="divide-y divide-rule">{children}</ul>}
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
      <p className="font-semibold">Order {review.order_id}</p>
      <p className="text-sm text-muted">{describe(review)}</p>
      <DocumentReasons review={review} />
      <label className="mt-3 block text-sm font-semibold">
        Note for the owner (needed if you send documents back)
        <input
          className="mt-1 w-full border bg-white px-2 py-1.5 font-normal"
          maxLength={300}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
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

  if (!queue) return <p className="py-8">{error || 'Loading the work queue…'}</p>

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
            <p className="font-semibold tabular-nums">Call {callback.phone}</p>
            <p className="text-sm text-muted">
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
            <p className="text-sm text-muted">{describe(order)}</p>
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
            <p className="text-sm text-muted">{describe(order)}</p>
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
            <p className="text-sm text-muted">{describe(order)}</p>
            <DocumentReasons review={order} />
            <p className="mt-2 text-sm text-muted">Waiting for the owner to upload a corrected document. These cannot be approved here.</p>
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

  if (!leads) return <p className="py-8">{error || 'Loading the call list…'}</p>

  return (
    <div className="py-6">
      <p className="max-w-[62ch]">
        Past leads who dropped out for a reason a call could fix, most promising first. The score only orders this list.
        It never decides who can buy.
      </p>
      <ol className="panel mt-4 divide-y divide-rule">
        {leads.map((lead) => (
          <li key={lead.lead_id} className="py-3">
            <div className="flex items-baseline justify-between gap-3">
              <p className="font-semibold">{lead.business_name}</p>
              <p className="font-display font-semibold whitespace-nowrap tabular-nums">{lead.score_pct}%</p>
            </div>
            <p className="text-sm text-muted">{lead.city}, {lead.segment}, from {lead.source.toLowerCase()}</p>
            <p className="mt-1">Dropped because: {lead.drop_reason.toLowerCase()}</p>
            <p className="font-semibold">{lead.advice}</p>
            <p className="text-sm text-muted">Score is higher because: {lead.score_reasons.replaceAll(';', ',').toLowerCase()}</p>
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
      <form onSubmit={signIn} className="panel my-6 max-w-sm">
        <label className="block font-semibold">
          Staff key
          <input
            type="password"
            required
            autoComplete="off"
            className="mt-1 w-full border bg-white px-3 py-2.5 text-base"
            value={typedKey}
            onChange={(event) => setTypedKey(event.target.value)}
          />
        </label>
        {error && <p role="alert" className="mt-2 font-semibold">{error}</p>}
        <div className="mt-4 flex items-center gap-4">
          <button type="submit" className="bg-accent px-6 py-3 font-semibold text-white">Sign in</button>
        </div>
      </form>
    )
  }

  return (
    <div className="pb-12">
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" className="flex gap-4">
          {TABS.map((item) => (
            <button
              key={item.id}
              role="tab"
              type="button"
              aria-selected={tab === item.id}
              className={`border-b-2 py-1 font-semibold ${tab === item.id ? 'border-accent text-accent' : 'border-transparent text-muted'}`}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <button type="button" className="text-sm font-medium text-accent underline underline-offset-4" onClick={signOut}>
          Sign out
        </button>
      </div>
      {tab === 'queue' && <WorkQueue staffKey={staffKey} />}
      {tab === 'funnel' && (funnel ? <FunnelDashboard funnel={funnel} /> : <p className="py-8">{error || 'Loading the funnel…'}</p>)}
      {tab === 'leads' && <LeadsToCall staffKey={staffKey} />}
    </div>
  )
}
