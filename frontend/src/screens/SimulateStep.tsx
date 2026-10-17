import { Card, ErrorNote, Nav, StepHead, Working } from '../components/Layout'
import { StatusPill } from '../components/StatusPill'
import { SEED, type Flow } from '../flow/useFlow'
import { plural, signedUsd, usd } from '../lib/format'
import { FIXTURES } from './fixtures'
import { pnlTone, summarize } from '../lib/summary'
import { DecisionLog, Kpi, SessionTimeline } from './results'

export function SimulateStep({ flow }: { flow: Flow }) {
  const { fixture, runs, running, approved } = flow
  if (!approved) return null
  const run = runs[fixture]
  const current = FIXTURES.find((f) => f.id === fixture)
  const s = run ? summarize(run) : null
  const busy = running.status === 'loading'

  return (
    <div className="ta-section">
      <StepHead
        title="Run the paper simulation"
        sub={`Replays one fixed synthetic session against approved version ${approved.spec.version}. The market is the same every run (seed ${SEED}); only your rules decide what happens.`}
        right={<StatusPill value="SYNTHETIC" />}
      />

      <Card>
        <div className="ta-card__body ta-stack">
          <div className="ta-row items-end" style={{ gap: 'var(--space-4)' }}>
            <div className="ta-field min-w-64 flex-1">
              <label className="ta-label" htmlFor="fixture">
                Session
              </label>
              <select id="fixture" value={fixture} disabled={busy} onChange={(e) => flow.setFixture(e.target.value)}>
                {FIXTURES.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                    {runs[f.id] ? ' · ran' : ''}
                  </option>
                ))}
              </select>
            </div>
            <button type="button" className="ta-btn ta-btn--primary" disabled={busy} onClick={flow.runSimulation}>
              {run ? 'Run again' : 'Run simulation'}
            </button>
          </div>
          {current && <span className="ta-small ta-muted">{current.detail}</span>}
        </div>
      </Card>

      {busy && (
        <Card>
          <Working label="Simulate" />
        </Card>
      )}
      {running.status === 'error' && <ErrorNote message={running.error} onRetry={flow.runSimulation} />}

      {run && s && !busy && (
        <>
          <Card>
            <div className="ta-kpis">
              <Kpi label="Session P&L" value={signedUsd(s.pnl)} tone={pnlTone(s.pnl)} />
              <Kpi
                label="Trades"
                value={
                  <>
                    {s.trades}{' '}
                    <span className="ta-small ta-muted">
                      ({s.wins} won · {s.losses} lost)
                    </span>
                  </>
                }
              />
              <Kpi label="Equity (mock)" value={usd(run.state.equity_usd)} tone={pnlTone(s.pnl)} />
              <Kpi
                label="New entries"
                value={<StatusPill value={run.state.entry_locked ? 'LOCKED' : 'ALLOWED'} />}
                alert={run.state.entry_locked}
              />
            </div>
          </Card>

          <Card title="What the engine did" right={<span className="ta-mono text-meta ta-muted">{run.state.simulation_id}</span>}>
            <div className="ta-card__body">
              <SessionTimeline run={run} cutoff={approved.spec.session.cutoff_local} />
            </div>
          </Card>

          <Card title="Decision log" right={<span className="ta-small ta-muted">{plural(run.events.length, 'decision')}</span>}>
            <DecisionLog events={run.events} />
          </Card>
        </>
      )}

      {!run && !busy && running.status !== 'error' && (
        <Card>
          <div className="ta-card__body ta-small ta-muted">
            Pick a session and run it. You'll see every decision the engine made, in order, with the reason.
          </div>
        </Card>
      )}

      <Nav back={() => flow.go(3)}>
        <button
          type="button"
          className="ta-btn ta-btn--primary"
          disabled={Object.keys(runs).length === 0}
          onClick={() => flow.go(5)}
        >
          Open audit report
        </button>
      </Nav>
    </div>
  )
}
