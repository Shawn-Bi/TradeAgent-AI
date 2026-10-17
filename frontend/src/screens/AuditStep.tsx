import { useState } from 'react'
import { Card, Nav, StepHead } from '../components/Layout'
import { StatusPill } from '../components/StatusPill'
import type { Flow } from '../flow/useFlow'
import { price, signedUsd, usd } from '../lib/format'
import { fixtureLabel, FIXTURES } from './fixtures'
import { pnlTone, summarize } from '../lib/summary'
import { DecisionLog, Kpi } from './results'

const OUTCOME: Record<string, string> = {
  STOP: 'Stopped out',
  TARGET_THEN_STOP: 'Target, then stop',
  TARGET_THEN_CUTOFF: 'Target, then cutoff',
  CUTOFF: 'Closed at cutoff',
}

const sameRules = (a: object, b: object) => {
  const strip = (o: object) => JSON.stringify({ ...o, approval_status: undefined })
  return strip(a) === strip(b)
}

export function AuditStep({ flow }: { flow: Flow }) {
  const ranIds = FIXTURES.map((f) => f.id).filter((id) => flow.runs[id])
  const [picked, setPicked] = useState(flow.fixture)
  const id = flow.runs[picked] ? picked : ranIds[0]
  const run = id ? flow.runs[id] : undefined
  if (!run || !flow.approved || flow.gen.status !== 'ready') return null

  const s = summarize(run)
  const r = run.report
  const proposed = flow.gen.data.strategy
  const identical = sameRules(proposed, flow.approved.spec)
  const pct = r.execution_conformance === null ? 0 : r.execution_conformance * 100

  return (
    <div className="ta-section">
      <StepHead
        title="Audit report"
        sub="What happened to the mock account, and whether the engine followed your approved rules at every decision."
        right={<StatusPill value="SIMULATION ONLY" tone="synthetic" />}
      />

      {ranIds.length > 1 && (
        <div className="ta-row" role="tablist" aria-label="Simulated sessions">
          {ranIds.map((rid) => (
            <button
              key={rid}
              type="button"
              role="tab"
              aria-selected={rid === id}
              className={`ta-btn ${rid === id ? 'ta-btn--primary' : ''}`}
              onClick={() => setPicked(rid)}
            >
              {fixtureLabel(rid)}
            </button>
          ))}
        </div>
      )}

      <Card title={`Results · ${fixtureLabel(run.fixture)}`} right={<span className="ta-mono text-meta ta-muted">{run.state.simulation_id}</span>}>
        <div className="ta-kpis">
          <Kpi label="Session P&L" value={signedUsd(s.pnl)} tone={pnlTone(s.pnl)} />
          <Kpi label="Trades" value={<>{s.trades} <span className="ta-small ta-muted">({s.wins} won · {s.losses} lost)</span></>} />
          <Kpi label="Largest loss" value={s.worst < 0 ? signedUsd(s.worst) : '—'} tone={pnlTone(s.worst)} />
          <Kpi label="Entries blocked" value={s.blocked} alert={s.blocked > 0} />
          <Kpi label="Equity (mock)" value={usd(run.state.equity_usd)} />
        </div>
        <div className="ta-card__body ta-small ta-muted">
          One synthetic session. This shows how your rules behaved, not whether they will make money. {r.disclaimer}.
        </div>
      </Card>

      <div className="ta-cols">
        <div className="ta-section">
          {run.state.entry_locked ? (
            <Card tone="locked" title="New entries locked" right={<StatusPill value={run.state.lock_reason ?? 'LOCKED'} tone="blocked" />}>
              <div className="ta-card__body ta-stack" style={{ gap: 'var(--space-2)' }}>
                <span>
                  {run.state.consecutive_losses} completed trades in a row closed at a loss, so the engine refused every new
                  entry after that. {s.blocked > 0 && `${s.blocked} valid signal${s.blocked === 1 ? ' was' : 's were'} blocked and no order was opened.`}
                </span>
                <span className="ta-small ta-muted">Exits that reduce risk stay allowed. The lock clears at the next session.</span>
              </div>
            </Card>
          ) : (
            <Card tone="approved" title="No risk lock">
              <div className="ta-card__body ta-small">
                The loss streak ended at {run.state.consecutive_losses}. A winning trade resets it, so new entries stayed allowed.
              </div>
            </Card>
          )}

          <Card title="Rule-following" right={<StatusPill value="SYNTHETIC" />}>
            <div className="ta-card__body ta-meter">
              <span className="ta-meter__fig">
                {r.execution_conformance === null ? 'N/A' : `${r.compliant_decisions} / ${r.eligible_decisions}`}
              </span>
              <div className="ta-meter__bar">
                <span style={{ width: `${pct}%` }} />
              </div>
              <span className="ta-small ta-muted">
                {r.execution_conformance === null
                  ? 'N/A · no decisions to check in this session.'
                  : `decisions where the engine did exactly what your rules required, including trades it correctly refused · ${r.violations} violation${r.violations === 1 ? '' : 's'}. This is not a win rate.`}
              </span>
              <span className="ta-small ta-muted">
                A violation would appear in orange as <code>VIOLATION</code>, for example the engine opening a trade while entries were locked.
              </span>
            </div>
          </Card>
        </div>

        <div className="ta-section">
          <Card title="Proposed vs approved" right={<StatusPill value={identical ? 'IDENTICAL' : 'CHANGED'} tone={identical ? 'compliant' : 'blocked'} />}>
            <div className="ta-card__body ta-small">
              {identical
                ? `The simulation ran version ${flow.approved.spec.version} exactly as proposed and approved.`
                : 'The approved rules differ from the proposal.'}
            </div>
          </Card>
          <Card title="Where this audit is kept" right={<StatusPill value={run.state.prism_status} />}>
            <div className="ta-card__body ta-small">
              {run.state.prism_status === 'CONNECTED'
                ? 'Every decision is also traced to PRISM.'
                : 'Kept in this session only. External tracing (PRISM) is not connected for this run.'}
            </div>
            <details className="ta-more">
              <summary>Technical details: report JSON</summary>
              <div>
                <pre className="ta-json">{JSON.stringify(r, null, 2)}</pre>
              </div>
            </details>
          </Card>
        </div>
      </div>

      <Card title="Trades">
        <ul className="ta-only-narrow ta-rowcards">
          {run.state.completed_trades.map((t) => (
            <li key={t.position_id}>
              <div className="ta-row justify-between">
                <span className="ta-mono">
                  {t.position_id} · {OUTCOME[t.exit_reason] ?? t.exit_reason}
                </span>
                <span className={`ta-mono ${t.realized_pnl_usd < 0 ? 'ta-neg' : ''}`}>{signedUsd(t.realized_pnl_usd)}</span>
              </div>
              <span className="ta-mono text-meta ta-muted">
                {t.contracts} contracts · entry {price(t.entry_price)} · avg exit {price(t.exit_price)}
              </span>
            </li>
          ))}
          {s.blocked > 0 && <li className="is-blocked">Valid signal blocked by the loss lock. Never opened.</li>}
        </ul>
        <div className="ta-only-wide ta-table-wrap">
          <table className="ta-table">
            <thead>
              <tr>
                <th>Trade</th>
                <th className="num">Entry</th>
                <th className="num">Avg exit</th>
                <th className="num">Contracts</th>
                <th>Outcome</th>
                <th className="num">P&amp;L</th>
              </tr>
            </thead>
            <tbody>
              {run.state.completed_trades.map((t) => (
                <tr key={t.position_id}>
                  <td>{t.position_id}</td>
                  <td className="num">{price(t.entry_price)}</td>
                  <td className="num">{price(t.exit_price)}</td>
                  <td className="num">{t.contracts}</td>
                  <td className="reason">{OUTCOME[t.exit_reason] ?? t.exit_reason}</td>
                  <td className={`num ${t.realized_pnl_usd < 0 ? 'ta-neg' : ''}`}>{signedUsd(t.realized_pnl_usd)}</td>
                </tr>
              ))}
              {s.blocked > 0 && (
                <tr className="is-blocked">
                  <td>—</td>
                  <td className="num">—</td>
                  <td className="num">—</td>
                  <td className="num">0</td>
                  <td className="reason">Valid signal blocked by the loss lock. Never opened.</td>
                  <td className="num">—</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Expected vs actual" right={<span className="ta-small ta-muted">{r.eligible_decisions} decisions</span>}>
        <DecisionLog events={run.events} />
      </Card>

      <Nav back={() => flow.go(4)}>
        <button type="button" className="ta-btn" onClick={() => flow.go(0)}>
          Change rules
        </button>
      </Nav>
    </div>
  )
}
