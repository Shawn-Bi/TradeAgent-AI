import { useEffect, useState } from 'react'
import { api, ApiError, apiBaseUrl, apiMode } from './api'
import type { AuditEvent, SimulationReport, SimulationState } from './api'
import { DemoBanner } from './components/DemoBanner'
import { StatusPill } from './components/StatusPill'
import { WizardSteps } from './components/WizardSteps'

type Health = { state: 'checking' } | { state: 'ok'; version: string } | { state: 'down'; message: string }

interface CheckResult {
  sim: SimulationState
  events: AuditEvent[]
  report: SimulationReport
}

// Scaffold shell. The contract check walks the full flow through whichever adapter is active,
// so the same button verifies the mock now and B's backend later (VITE_API_MODE=http).
export default function App() {
  const [health, setHealth] = useState<Health>({ state: 'checking' })
  const [step, setStep] = useState(0)
  const [working, setWorking] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<CheckResult | null>(null)

  useEffect(() => {
    api
      .health()
      .then((h) => setHealth({ state: 'ok', version: h.contract_version }))
      .catch((e: unknown) => setHealth({ state: 'down', message: e instanceof Error ? e.message : String(e) }))
  }, [])

  async function runContractCheck() {
    setError(null)
    setResult(null)
    try {
      setStep(1)
      setWorking('Generate')
      const { strategy } = await api.generateStrategy({ template_id: 'ng-long-pullback-v1', overrides: {}, free_text: '' })
      const ref = { strategy_id: strategy.strategy_id, version: strategy.version }

      setStep(2)
      setWorking('Approve')
      await api.approveStrategy(ref)

      setStep(3)
      setWorking('Scenario')
      await api.generateScenarios({ ...ref, seed: 42 })

      setStep(4)
      setWorking('Simulate')
      const { simulation_id } = await api.startSimulation({ ...ref, seed: 42, fixture: 'two-loss-lock' })

      setStep(5)
      setWorking('Audit')
      const [sim, { events }, report] = await Promise.all([
        api.getSimulation(simulation_id),
        api.getSimulationEvents(simulation_id),
        api.getSimulationReport(simulation_id),
      ])
      setResult({ sim, events, report })
      setStep(6)
    } catch (e) {
      setError(e instanceof ApiError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e))
    } finally {
      setWorking(null)
    }
  }

  return (
    <div className="ta-gridground min-h-screen">
      <DemoBanner symbol="NG_SIM" accountId="DEMO-NG-001" />
      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="m-0 text-title">TradeAgent AI</h1>
          <div className="ta-row">
            <span className="ta-label">API</span>
            <span className="ta-mono text-meta text-ink-muted">{apiMode === 'mock' ? 'mock adapter' : apiBaseUrl}</span>
            {health.state === 'checking' && <span className="text-meta text-ink-muted">Checking…</span>}
            {health.state === 'ok' && <StatusPill value={`CONTRACT ${health.version}`} tone="compliant" />}
            {health.state === 'down' && <StatusPill value="UNREACHABLE" tone="blocked" />}
          </div>
        </header>

        <WizardSteps current={Math.min(step, 5)} />

        <section className="ta-card">
          <div className="ta-card__head">
            <h3>Contract check</h3>
            <StatusPill value="SYNTHETIC" />
          </div>
          <div className="ta-card__body ta-stack">
            <p className="m-0">
              Runs generate, approve, scenario and the <code>two-loss-lock</code> fixture through the active adapter,
              then reads the simulation, events and report.
            </p>
            <div className="ta-row">
              <button className="ta-btn ta-btn--primary" onClick={runContractCheck} disabled={working !== null}>
                Run contract check
              </button>
              {working && <span className="text-meta text-ink-muted">{working} · Working…</span>}
            </div>
            {health.state === 'down' && <p className="m-0 text-blocked">{health.message}</p>}
            {error && <p className="m-0 text-blocked">{error}</p>}
          </div>
        </section>

        {result && (
          <section className="ta-card">
            <div className="ta-card__head">
              <h3>Audit · {result.sim.simulation_id}</h3>
              <div className="ta-row">
                <StatusPill value={result.sim.status} />
                <StatusPill value={result.sim.prism_status} />
              </div>
            </div>
            <div className="ta-card__body ta-stack">
              <p className="m-0 ta-mono text-code">
                entry_locked={String(result.sim.entry_locked)} · lock_reason={result.sim.lock_reason ?? 'null'} ·
                consecutive_losses={result.sim.consecutive_losses} · positions={result.sim.positions.length}
              </p>
              <p className="m-0">
                Conformance {result.report.compliant_decisions} / {result.report.eligible_decisions} eligible decisions ·{' '}
                {result.report.violations} violations
              </p>
              <div className="overflow-x-auto">
                <table className="ta-table">
                  <thead>
                    <tr>
                      <th>Seq</th>
                      <th>Time</th>
                      <th>Rule</th>
                      <th>Expected</th>
                      <th>Actual</th>
                      <th>Result</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.events.map((e) => (
                      <tr key={e.event_id} className={e.actual_action === 'BLOCK_ENTRY' ? 'is-blocked' : undefined}>
                        <td>{e.seq}</td>
                        <td>{e.timestamp.slice(11, 19)}</td>
                        <td>{e.rule_id}</td>
                        <td>{e.expected_action}</td>
                        <td>{e.actual_action}</td>
                        <td>
                          <StatusPill
                            value={e.compliant ? 'Compliant' : 'Violation'}
                            tone={e.compliant ? 'compliant' : 'blocked'}
                          />
                        </td>
                        <td className="reason">{e.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="m-0 text-meta text-ink-muted">{result.report.disclaimer}</p>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
