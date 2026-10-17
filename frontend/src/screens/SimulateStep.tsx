import { Button } from '@/components/ui/button'
import { Card, ErrorNote, Nav, StepHead, Working } from '../components/Layout'
import { PriceChart } from '../components/PriceChart'
import { SelectField } from '../components/SelectField'
import { StatusPill } from '../components/StatusPill'
import { SEED, type Flow } from '../flow/useFlow'
import { plural, signedUsd, usd } from '../lib/format'
import { pnlTone, summarize } from '../lib/summary'
import { fixtureLabel, FIXTURES } from './fixtures'
import { DecisionLog, Kpi, SessionTimeline } from './results'

export function SimulateStep({ flow }: { flow: Flow }) {
  const { fixture, runs, running, approved } = flow
  if (!approved) return null
  const spec = approved.spec
  const run = runs[fixture]
  const current = FIXTURES.find((f) => f.id === fixture)
  // A scenario card can open its own seeded session (trend, range, adverse), which isn't in the main list.
  const sessions = current ? FIXTURES : [...FIXTURES, { id: fixture, label: fixtureLabel(fixture), detail: '' }]
  const detail = current?.detail || run?.state.fixture_description || 'Seeded synthetic session from the scenario step.'
  const s = run ? summarize(run) : null
  const busy = running.status === 'loading'

  return (
    <div className="ta-section">
      <StepHead
        title="Run the paper simulation"
        sub={`Replays a fixed synthetic session. The market is the same every run (seed ${SEED}); only your rules decide what happens.`}
        right={<StatusPill value="SYNTHETIC" />}
      />

      {/* The rules being tested, so nobody has to remember them from the Approve step. */}
      <div className="ta-riskline">
        <span className="ta-label">Running version {spec.version}</span>
        <span className="ta-mono text-code">
          {spec.timeframes.trend_minutes}m trend · {spec.timeframes.entry_minutes}m entry · SMA({spec.trend.period}) · stop{' '}
          {spec.stop.buffer_ticks} ticks · target {spec.exit.target_r}R · lock after {spec.risk.consecutive_loss_lock} losses
        </span>
        <Button variant="link" className="h-auto px-0" onClick={() => flow.go(2)}>
          See full rules
        </Button>
      </div>

      <Card>
        <div className="ta-card__body ta-stack">
          <div className="ta-row items-end" style={{ gap: 'var(--space-4)' }}>
            <div className="min-w-64 flex-1">
              <SelectField
                id="fixture"
                label="Session"
                value={fixture}
                disabled={busy}
                options={sessions.map((f) => ({ value: f.id, label: `${f.label}${runs[f.id] ? ' · ran' : ''}` }))}
                hint={detail}
                onChange={flow.setFixture}
              />
            </div>
            <div className="ta-row pb-9">
              <Button disabled={busy} onClick={() => flow.runSimulation('current')}>
                {run ? 'Run again' : 'Run simulation'}
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => flow.runSimulation('all')}>
                Run every session
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {busy && (
        <Card>
          <Working label="Simulate" />
        </Card>
      )}
      {running.status === 'error' && <ErrorNote message={running.error} onRetry={() => flow.runSimulation('current')} />}

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
            <div className="ta-card__body ta-stack">
              <PriceChart run={run} spec={spec} />
              <SessionTimeline run={run} cutoff={spec.session.cutoff_local} />
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
            Pick a session and run it, or run every session. You’ll see every decision the engine made, in order, with the
            reason.
          </div>
        </Card>
      )}

      <Nav back={() => flow.go(3)}>
        {Object.keys(runs).length === 0 && <span className="ta-small ta-muted">Run a session to continue.</span>}
        <Button disabled={Object.keys(runs).length === 0} onClick={() => flow.go(5)}>
          Open audit report
        </Button>
      </Nav>
    </div>
  )
}
