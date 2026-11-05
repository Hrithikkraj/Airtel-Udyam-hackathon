import { rupees } from './format'

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
    <div className="h-3 rounded-r bg-transparent">
      <div
        className={`h-full rounded-r ${isHighlighted ? 'bg-ink' : 'bg-rule'}`}
        style={{ width: `${Math.max(share, 0.5)}%` }}
      />
    </div>
  )
}

function Tile({ value, label, target }: { value: string; label: string; target?: string }) {
  return (
    <div className="border-t-4 border-ink pt-2">
      <p className="font-display text-3xl leading-tight font-bold tabular-nums">{value}</p>
      <p className="leading-snug">{label}</p>
      {target && <p className="text-sm text-muted">{target}</p>}
    </div>
  )
}

function GroupTable({ title, groups }: { title: string; groups: Group[] }) {
  const highest = Math.max(...groups.map((group) => group.activation_pct))
  return (
    <section className="mt-10">
      <h2 className="font-display text-2xl font-bold">{title}</h2>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[34rem] text-left">
          <thead>
            <tr className="border-b-4 border-ink text-sm">
              <th scope="col" className="py-1 pr-3 font-semibold">{title.replace('By ', '').replace(/^./, (c) => c.toUpperCase())}</th>
              <th scope="col" className="w-40 py-1 pr-3 font-semibold">Activated</th>
              <th scope="col" className="py-1 pr-3 text-right font-semibold">Cost per activation</th>
              <th scope="col" className="py-1 pr-3 text-right font-semibold">Median monthly</th>
              <th scope="col" className="py-1 text-right font-semibold">6-month churn</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rule tabular-nums">
            {groups.map((group) => (
              <tr key={group.name} title={`${group.activated} of ${group.leads} leads activated`}>
                <th scope="row" className="py-2 pr-3 font-normal">{group.name}</th>
                <td className="py-2 pr-3">
                  <span className="font-semibold">{group.activation_pct}%</span>
                  <Bar share={(group.activation_pct / highest) * 100} />
                </td>
                <td className="py-2 pr-3 text-right">{group.cost_per_activation_inr ? rupees(group.cost_per_activation_inr) : 'None'}</td>
                <td className="py-2 pr-3 text-right">{group.median_bundle_inr ? rupees(group.median_bundle_inr) : 'None'}</td>
                <td className="py-2 text-right">{group.churn_pct === null ? 'None' : `${group.churn_pct}%`}</td>
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
      <p className="max-w-[62ch] text-lg">
        Only {kpis.lead_to_activation_pct}% of leads get activated. The steepest step is {steepest.stage.toLowerCase()}, where{' '}
        {steepest.pct_of_previous}% continue.
      </p>
      <p className="mt-1 text-sm text-muted">
        5,000 leads, April to June 2026. Targets are hypotheses to test in a pilot, not forecasts.
      </p>

      <section aria-label="Key numbers" className="mt-6 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3">
        <Tile value={`${kpis.lead_to_activation_pct}%`} label="Lead to activation" target={`Target ${targets.lead_to_activation_pct}%`} />
        <Tile value={`${kpis.average_days_to_activate} days`} label="Lead to activation time" target={`Target ${targets.average_days_to_activate} days`} />
        <Tile value={String(kpis.follow_up_calls)} label="Status chases per customer" target={`Target ${targets.follow_up_calls}`} />
        <Tile value={`${kpis.quote_acceptance_pct}%`} label="Quote acceptance" target={`Target ${targets.quote_acceptance_pct}%`} />
        <Tile value={`${kpis.kyc_completion_pct}%`} label="KYC completion" target={`Target ${targets.kyc_completion_pct}%`} />
        <Tile value={rupees(kpis.cost_per_activation_inr)} label="Cost per activation" />
      </section>

      <section className="mt-10">
        <h2 className="font-display text-2xl font-bold">Where leads are lost</h2>
        <ol className="mt-3 space-y-3">
          {stages.map((stage) => (
            <li key={stage.stage} title={stage.lost ? `${stage.lost.toLocaleString('en-IN')} lost at this step` : undefined}>
              <div className="flex items-baseline justify-between gap-3">
                <span className={stage === steepest ? 'font-semibold' : ''}>{stage.stage}</span>
                <span className="tabular-nums">
                  <span className="font-semibold">{stage.count.toLocaleString('en-IN')}</span>
                  {stage.pct_of_previous !== null && (
                    <span className="ml-2 text-sm text-muted">{stage.pct_of_previous}% continue</span>
                  )}
                </span>
              </div>
              <Bar share={(stage.count / largest) * 100} isHighlighted={stage === steepest} />
            </li>
          ))}
        </ol>
      </section>

      <GroupTable title="By segment" groups={funnel.by_segment} />
      <GroupTable title="By lead source" groups={funnel.by_source} />

      <section className="mt-10">
        <h2 className="font-display text-2xl font-bold">Why leads drop</h2>
        <div className="mt-3 grid gap-x-8 gap-y-6 sm:grid-cols-2">
          {funnel.drop_reasons.map((row) => {
            const biggest = row.reasons[0].count
            return (
              <div key={row.stage}>
                <h3 className="border-b-2 border-ink font-semibold">
                  Stopped at {row.stage.replace("KYC", "@").toLowerCase().replace("@", "KYC")} <span className="font-normal text-muted tabular-nums">{row.total.toLocaleString('en-IN')}</span>
                </h3>
                <ul className="mt-2 space-y-2">
                  {row.reasons.slice(0, HOW_MANY_REASONS).map((item) => (
                    <li key={item.reason}>
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span>{item.reason}</span>
                        <span className="font-semibold tabular-nums">{item.count}</span>
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

      <section className="mt-10 grid gap-x-8 gap-y-4 sm:grid-cols-2">
        <p className="border-l-4 border-marigold pl-3">
          <span className="font-semibold">{funnel.bundles_breaking_rules} of {funnel.activated_bundles} sold bundles</span> broke a catalogue
          rule. The new rules engine refuses these.
        </p>
        <p className="border-l-4 border-marigold pl-3">
          <span className="font-semibold">Lead score, tested on {funnel.score_quality.test_leads.toLocaleString('en-IN')} unseen leads:</span> its
          top fifth holds {funnel.score_quality.top_fifth_share_of_activations_pct}% of activations (AUC {funnel.score_quality.auc}).
        </p>
      </section>

      <p className="mt-8 text-sm text-muted">
        Orders in this app so far: {liveTotal}. These are test orders and are not part of the figures above.
      </p>
    </div>
  )
}
