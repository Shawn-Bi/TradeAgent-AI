import { Button } from '@/components/ui/button'
import type { ReactNode } from 'react'
import type { StrategySpec } from '../api'
import { Card, ErrorNote, Nav, StepHead } from '../components/Layout'
import { StatusPill } from '../components/StatusPill'
import { Term } from '../components/Term'
import type { Flow } from '../flow/useFlow'
import { price, usd } from '../lib/format'

/** Highlight for an editable demo assumption until the version is approved. */
const A = ({ on, children }: { on: boolean; children: ReactNode }) =>
  on ? <span className="ta-assume">{children}</span> : <>{children}</>

function rules(s: StrategySpec, fromText: (path: string) => boolean): [string, ReactNode][] {
  const tf = s.timeframes
  const H = ({ path, children }: { path: string; children: ReactNode }) => <A on={fromText(path)}>{children}</A>
  return [
    [
      'TREND',
      <>
        IF <H path="timeframes.trend_minutes">{tf.trend_minutes}m</H> close &gt; SMA(
        <H path="trend.period">{s.trend.period}</H>) AND SMA rising over <H path="trend.slope_bars">{s.trend.slope_bars} bars</H>
      </>,
    ],
    [
      'ENTRY',
      <>
        AND a <H path="timeframes.entry_minutes">{tf.entry_minutes}m</H> bar pulls back within{' '}
        <H path="entry.tolerance_ticks">
          {s.entry.tolerance_ticks} ticks ({price(s.entry.tolerance_ticks * s.instrument.tick_size)})
        </H>{' '}
        of SMA(<H path="entry.ma_period">{s.entry.ma_period}</H>) and closes bullish (close &gt; open AND close &gt; SMA)
        <br />
        THEN buy <H path="quantity_contracts">{s.quantity_contracts} contracts</H> at the open of the next 1m bar.
        One entry per signal.
      </>,
    ],
    [
      'STOP',
      <>
        Lowest low of the last <H path="stop.lookback_5m_bars">{s.stop.lookback_5m_bars}</H> completed 5m bars minus{' '}
        <H path="stop.buffer_ticks">
          {s.stop.buffer_ticks} <Term term="Tick">ticks</Term>
        </H>
        . Skip the trade if entry minus stop is zero or less.
      </>,
    ],
    [
      'TARGET',
      <>
        Sell <H path="exit.first_target_close_contracts">{s.exit.first_target_close_contracts} contract</H> at entry +{' '}
        <H path="exit.target_r">
          {s.exit.target_r}
          <Term term="R">R</Term>
        </H>
        . The rest keeps the original stop and exits at that stop or at{' '}
        <H path="session.cutoff_local">{s.session.cutoff_local} ET</H>.
      </>,
    ],
    [
      'RISK',
      <>
        Max <H path="risk.max_completed_trades_per_session">{s.risk.max_completed_trades_per_session} completed trades</H>{' '}
        a session. After <H path="risk.consecutive_loss_lock">{s.risk.consecutive_loss_lock} losing trades in a row</H>,
        refuse new entries until the next session. Exits are always allowed. Nothing held overnight.
      </>,
    ],
    [
      'FILLS',
      <>
        Stops and targets fill at their price. If both are touched in one bar, the stop counts first. Fees $0,
        slippage $0.
      </>,
    ],
  ]
}

export function ApproveStep({ flow }: { flow: Flow }) {
  if (flow.gen.status !== 'ready') return null
  const spec = flow.approved?.spec ?? flow.gen.data.strategy
  const isApproved = flow.approved !== null
  const minRisk = spec.stop.buffer_ticks * spec.instrument.tick_value_usd * spec.quantity_contracts
  const interpreted = new Set(flow.gen.data.interpreted_fields ?? [])
  const fromText = (path: string) => interpreted.has(path)

  return (
    <div className="ta-section ta-narrow">
      <StepHead
        title="Review and approve"
        sub="This is exactly what the engine will run. Any later edit creates a new draft version that needs approval again."
      />
      <Card
        tone={isApproved ? 'approved' : 'draft'}
        title={
          <>
            Strategy <span className="ta-mono ta-muted font-normal">· version {spec.version}</span>
          </>
        }
        right={<StatusPill value={isApproved ? 'APPROVED' : 'DRAFT'} />}
      >
        <div className="ta-card__body ta-stack" style={{ gap: 'var(--space-4)' }}>
          <ul className="ta-rules">
            {rules(spec, fromText).map(([k, v]) => (
              <li key={k}>
                <span className="k">{k}</span>
                <span>{v}</span>
              </li>
            ))}
          </ul>
          {interpreted.size > 0 && (
            <span className="ta-small ta-muted">
              <span className="ta-assume">Highlighted</span> values came from your own words; the rest are demo
              defaults.
            </span>
          )}
          <div className="ta-riskline">
            <span className="ta-label">Risk per trade</span>
            <strong>at least {usd(minRisk)}</strong>
            <span className="ta-small ta-muted">
              The engine enforces every rule. The AI only proposes them.
            </span>
          </div>
          {flow.approving.status === 'error' && <ErrorNote message={flow.approving.error} />}
          <div className="ta-row">
            {isApproved ? (
              <span className="ta-small ta-muted">
                Approved and locked at{' '}
                {flow.approved?.at.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}. Change a value
                on the Preset step to create version {spec.version + 1}.
              </span>
            ) : (
              <>
                <Button disabled={flow.approving.status === 'loading'} onClick={flow.approve}>
                  {flow.approving.status === 'loading' ? 'Approving… Working…' : `Approve version ${spec.version}`}
                </Button>
                <Button variant="outline" onClick={() => flow.go(0)}>
                  Change values
                </Button>
              </>
            )}
          </div>
        </div>
      </Card>
      <Nav back={() => flow.go(1)}>
        {!isApproved && <span className="ta-small ta-muted">Approve to continue.</span>}
        <Button disabled={!isApproved} onClick={flow.loadScenarios}>
          See hypothetical scenarios
        </Button>
      </Nav>
    </div>
  )
}
