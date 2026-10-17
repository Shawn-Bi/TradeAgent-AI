import type { ReactNode } from 'react'
import type { StrategySpec } from '../api'
import { Card, ErrorNote, Nav, StepHead } from '../components/Layout'
import { StatusPill } from '../components/StatusPill'
import type { Flow } from '../flow/useFlow'
import { price, usd } from '../lib/format'

/** Highlight for an editable demo assumption until the version is approved. */
const A = ({ on, children }: { on: boolean; children: ReactNode }) =>
  on ? <span className="ta-assume">{children}</span> : <>{children}</>

function rules(s: StrategySpec, draft: boolean): [string, ReactNode][] {
  const tf = s.timeframes
  return [
    [
      'TREND',
      <>
        IF {tf.trend_minutes}m close &gt; SMA({s.trend.period}) AND SMA rising over {s.trend.slope_bars} bars
      </>,
    ],
    [
      'ENTRY',
      <>
        AND a {tf.entry_minutes}m bar pulls back within{' '}
        <A on={draft}>
          {s.entry.tolerance_ticks} ticks ({price(s.entry.tolerance_ticks * s.instrument.tick_size)})
        </A>{' '}
        of SMA({s.entry.ma_period}) and closes bullish (close &gt; open AND close &gt; SMA)
        <br />
        THEN buy {s.quantity_contracts} contracts at the trigger price. One entry per signal.
      </>,
    ],
    [
      'STOP',
      <>
        Lowest low of the last {s.stop.lookback_5m_bars} completed 5m bars minus{' '}
        <A on={draft}>{s.stop.buffer_ticks} ticks</A>. Skip the trade if entry minus stop is zero or less.
      </>,
    ],
    [
      'TARGET',
      <>
        Sell {s.exit.first_target_close_contracts} contract at entry + <A on={draft}>{s.exit.target_r}R</A>. The
        other contract keeps the original stop and exits at that stop or at {s.session.cutoff_local} ET.
      </>,
    ],
    [
      'RISK',
      <>
        Max {s.risk.max_completed_trades_per_session} completed trades a session. After {s.risk.consecutive_loss_lock}{' '}
        losing trades in a row, refuse new entries until the next session. Exits are always allowed. Nothing held
        overnight.
      </>,
    ],
    [
      'FILLS',
      <>
        Fills at the trigger price. If stop and target are both hit in one bar, the stop counts first. Fees $0,
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
            {rules(spec, !isApproved).map(([k, v]) => (
              <li key={k}>
                <span className="k">{k}</span>
                <span>{v}</span>
              </li>
            ))}
          </ul>
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
                <button
                  type="button"
                  className="ta-btn ta-btn--primary"
                  disabled={flow.approving.status === 'loading'}
                  onClick={flow.approve}
                >
                  {flow.approving.status === 'loading' ? 'Approving… Working…' : `Approve version ${spec.version}`}
                </button>
                <button type="button" className="ta-btn" onClick={() => flow.go(0)}>
                  Change values
                </button>
              </>
            )}
          </div>
        </div>
      </Card>
      <Nav back={() => flow.go(1)}>
        {!isApproved && <span className="ta-small ta-muted">Approve to continue.</span>}
        <button type="button" className="ta-btn ta-btn--primary" disabled={!isApproved} onClick={flow.loadScenarios}>
          See hypothetical scenarios
        </button>
      </Nav>
    </div>
  )
}
