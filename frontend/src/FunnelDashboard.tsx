import type { ReactNode } from 'react'
import { ShieldCheck, Target, TrendingDown, TrendingUp } from 'lucide-react'
import { rupees } from './format'
import Badge from './ui/Badge'
import { cx } from './ui/cx'

type Stage = { stage: string; count: number; pct_of_previous: number | null; lost: number }
type Group = {
  name: string
  leads: number
  activated: number
  activation_pct: number
  cost_per_activation_inr: number | null
  median_bundle_inr: number | null
  churn_pct: number | null
}
type StageReasons = { stage: string; total: number; reasons: { reason: string; count: number }[] }

export type Funnel = {
  stages: Stage[]
  kpis: {
    lead_to_activation_pct: number
    average_days_to_activate: number
    follow_up_calls: number
    cost_per_activation_inr: number
    churn_pct: number
    quote_acceptance_pct: number
    kyc_completion_pct: number
  }
  targets: {
    lead_to_activation_pct: number
    average_days_to_activate: number
    follow_up_calls: number
    quote_acceptance_pct: number
    kyc_completion_pct: number
  }
  by_segment: Group[]
  by_source: Group[]
  drop_reasons: StageReasons[]
  bundles_breaking_rules: number
  activated_bundles: number
  score_quality: { auc: number; top_fifth_share_of_activations_pct: number; test_leads: number }
  live_orders: Record<string, number>
}

const HOW_MANY_REASONS = 4

// One thin bar. Every bar has its number printed beside it, so colour never carries the meaning alone.
function Bar({ share, isHighlighted = false }: { share: number; isHighlighted?: boolean }) {
  return (
    <div aria-hidden="true" className="mt-1 h-2 overflow-hidden rounded-full bg-ink-100">
      <div
        className={cx('h-full rounded-full', isHighlighted ? 'bg-brand-600' : 'bg-ink-400')}
        style={{ width: `${Math.max(share, 0.5)}%` }}
      />
    </div>
  )
}

// A key number with its target. "Higher is better" or not decides which way counts as on track.
function Tile({ value, label, target, isOnTrack }: { value: string; label: string; target?: string; isOnTrack?: boolean }) {
  return (
    <div className="card flex flex-col">
      <p className="text-small font-semibold text-ink-600">{label}</p>
      <p className="mt-1 text-[1.75rem] leading-tight font-extrabold tabular-nums">{value}</p>
      {target && (
        <p className="mt-auto flex flex-wrap items-center gap-2 pt-2 text-caption text-ink-500">
          <span className="inline-flex items-center gap-1">
            <Target aria-hidden="true" size={13} />
            {target}
          </span>
          {isOnTrack !== undefined && (
            <Badge tone={isOnTrack ? 'success' : 'warn'} icon={isOnTrack ? <TrendingUp size={13} /> : <TrendingDown size={13} />} className="text-[0.75rem]">
              {isOnTrack ? 'On track' : 'Below target'}
            </Badge>
          )}
        </p>
      )}
    </div>
  )
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-title-2 font-extrabold">{children}</h2>
}

function GroupTable({ title, groups }: { title: string; groups: Group[] }) {
  const highest = Math.max(...groups.map((group) => group.activation_pct))
  return (
    <section className="card mt-5 p-0!">
      <div className="px-5 pt-5">
        <SectionTitle>{title}</SectionTitle>
      </div>
      {/* The header row stays visible while a long table scrolls. */}
      <div className="mt-3 max-h-[26rem] overflow-auto">
        <table className="w-full min-w-[34rem] text-left text-small">
          <thead className="sticky top-0 z-10 bg-ink-50 text-caption text-ink-600">
            <tr>
              <th scope="col" className="py-2.5 pr-3 pl-5 font-bold">{title.replace('By ', '').replace(/^./, (c) => c.toUpperCase())}</th>
              <th scope="col" className="w-44 py-2.5 pr-3 font-bold">Activated</th>
              <th scope="col" className="py-2.5 pr-3 text-right font-bold">Cost per activation</th>
              <th scope="col" className="py-2.5 pr-3 text-right font-bold">Median monthly</th>
              <th scope="col" className="py-2.5 pr-5 text-right font-bold">6-month churn</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100 tabular-nums">
            {groups.map((group) => (
              <tr key={group.name} title={`${group.activated} of ${group.leads} leads activated`} className="hover:bg-ink-50/70">
                <th scope="row" className="py-3 pr-3 pl-5 font-semibold">{group.name}</th>
                <td className="py-3 pr-3">
                  <span className="font-bold">{group.activation_pct}%</span>
                  <Bar share={(group.activation_pct / highest) * 100} isHighlighted={group.activation_pct === highest} />
                </td>
                <td className="py-3 pr-3 text-right">{group.cost_per_activation_inr ? rupees(group.cost_per_activation_inr) : 'None'}</td>
                <td className="py-3 pr-3 text-right">{group.median_bundle_inr ? rupees(group.median_bundle_inr) : 'None'}</td>
                <td className="py-3 pr-5 text-right">{group.churn_pct === null ? 'None' : `${group.churn_pct}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default function FunnelDashboard({ funnel }: { funnel: Funnel }) {
  const { kpis, targets, stages } = funnel
  const largest = stages[0].count
  const stepsAfterFirst = stages.slice(1)
  const steepest = stepsAfterFirst.reduce((worst, stage) => (stage.pct_of_previous! < worst.pct_of_previous! ? stage : worst))
  const liveTotal = Object.values(funnel.live_orders).reduce((sum, count) => sum + count, 0)

  return (
    <div className="py-6">
      <div className="brand-mesh relative overflow-hidden rounded-card px-5 py-6 shadow-e3 sm:px-7">
        <span aria-hidden="true" className="absolute -top-12 -right-10 size-44 rounded-full bg-white/10" />
        <p className="relative text-small font-semibold text-white">Lead to activation</p>
        <p className="relative text-[3rem] leading-none font-extrabold tabular-nums">{kpis.lead_to_activation_pct}%</p>
        <p className="relative mt-3 max-w-[62ch] text-white">
          Only {kpis.lead_to_activation_pct}% of leads get activated. The steepest step is {steepest.stage.toLowerCase()}, where{' '}
          {steepest.pct_of_previous}% continue.
        </p>
      </div>
      <p className="mt-2 text-caption text-ink-500">5,000 leads, April to June 2026. Targets are hypotheses to test in a pilot, not forecasts.</p>

      <section aria-label="Key numbers" className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Tile value={`${kpis.lead_to_activation_pct}%`} label="Lead to activation" target={`Target ${targets.lead_to_activation_pct}%`} isOnTrack={kpis.lead_to_activation_pct >= targets.lead_to_activation_pct} />
        <Tile value={`${kpis.average_days_to_activate} days`} label="Lead to activation time" target={`Target ${targets.average_days_to_activate} days`} isOnTrack={kpis.average_days_to_activate <= targets.average_days_to_activate} />
        <Tile value={String(kpis.follow_up_calls)} label="Status chases per customer" target={`Target ${targets.follow_up_calls}`} isOnTrack={kpis.follow_up_calls <= targets.follow_up_calls} />
        <Tile value={`${kpis.quote_acceptance_pct}%`} label="Quote acceptance" target={`Target ${targets.quote_acceptance_pct}%`} isOnTrack={kpis.quote_acceptance_pct >= targets.quote_acceptance_pct} />
        <Tile value={`${kpis.kyc_completion_pct}%`} label="KYC completion" target={`Target ${targets.kyc_completion_pct}%`} isOnTrack={kpis.kyc_completion_pct >= targets.kyc_completion_pct} />
        <Tile value={rupees(kpis.cost_per_activation_inr)} label="Cost per activation" />
      </section>

      {/* A funnel: each stage is a centred bar as wide as its share of all leads, narrowing down. */}
      <section className="card mt-5">
        <SectionTitle>Where leads are lost</SectionTitle>
        <ol className="mt-4 space-y-2">
          {stages.map((stage) => {
            const share = (stage.count / largest) * 100
            const isSteepest = stage === steepest
            return (
              <li key={stage.stage} title={stage.lost ? `${stage.lost.toLocaleString('en-IN')} lost at this step` : undefined}>
                <div className="flex items-baseline justify-between gap-3 text-small">
                  <span className={cx(isSteepest ? 'font-bold text-brand-700' : 'font-semibold')}>
                    {stage.stage}
                    {isSteepest && <span className="sr-only"> (steepest drop)</span>}
                  </span>
                  <span className="tabular-nums">
                    <span className="font-bold">{stage.count.toLocaleString('en-IN')}</span>
                    {stage.pct_of_previous !== null && <span className="ml-2 text-caption text-ink-500">{stage.pct_of_previous}% continue</span>}
                  </span>
                </div>
                <div aria-hidden="true" className="mt-1 flex h-7 justify-center rounded-control bg-ink-50">
                  <div
                    className={cx('h-full rounded-control', isSteepest ? 'bg-brand-600' : 'bg-linear-to-r from-ink-300 to-ink-400')}
                    style={{ width: `${Math.max(share, 1)}%` }}
                  />
                </div>
              </li>
            )
          })}
        </ol>
      </section>

      <GroupTable title="By segment" groups={funnel.by_segment} />
      <GroupTable title="By lead source" groups={funnel.by_source} />

      <section className="card mt-5">
        <SectionTitle>Why leads drop</SectionTitle>
        <div className="mt-4 grid gap-x-8 gap-y-6 md:grid-cols-2">
          {funnel.drop_reasons.map((row) => {
            const biggest = row.reasons[0].count
            return (
              <div key={row.stage}>
                <h3 className="flex items-baseline justify-between gap-2 border-b border-ink-200 pb-1.5 font-bold">
                  Stopped at {row.stage.replace("KYC", "@").toLowerCase().replace("@", "KYC")}
                  <span className="text-small font-semibold text-ink-500 tabular-nums">{row.total.toLocaleString('en-IN')}</span>
                </h3>
                <ul className="mt-2 space-y-2.5">
                  {row.reasons.slice(0, HOW_MANY_REASONS).map((item) => (
                    <li key={item.reason}>
                      <div className="flex items-baseline justify-between gap-3 text-small">
                        <span>{item.reason}</span>
                        <span className="font-bold tabular-nums">{item.count}</span>
                      </div>
                      <Bar share={(item.count / biggest) * 100} />
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      </section>

      <section className="mt-5 grid gap-3 md:grid-cols-2">
        <p className="notice flex gap-3">
          <ShieldCheck aria-hidden="true" size={20} className="mt-0.5 shrink-0 text-info-700" />
          <span>
            <span className="font-bold">
              {funnel.bundles_breaking_rules} of {funnel.activated_bundles} sold bundles
            </span>{' '}
            broke a catalogue rule. The new rules engine refuses these.
          </span>
        </p>
        <p className="notice flex gap-3">
          <Target aria-hidden="true" size={20} className="mt-0.5 shrink-0 text-info-700" />
          <span>
            <span className="font-bold">Lead score, tested on {funnel.score_quality.test_leads.toLocaleString('en-IN')} unseen leads:</span> its top
            fifth holds {funnel.score_quality.top_fifth_share_of_activations_pct}% of activations (AUC {funnel.score_quality.auc}).
          </span>
        </p>
      </section>

      <p className="mt-6 text-caption text-ink-500">Orders in this app so far: {liveTotal}. These are test orders and are not part of the figures above.</p>
    </div>
  )
}
