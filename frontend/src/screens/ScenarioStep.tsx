import { Button } from '@/components/ui/button'
import { Card, ErrorNote, Nav, StepHead, Working } from '../components/Layout'
import { ScenarioGlyph } from '../components/ScenarioGlyph'
import { StatusPill } from '../components/StatusPill'
import type { Flow } from '../flow/useFlow'
import { signedUsd } from '../lib/format'
import { scenarioFixture } from './fixtures'

export function ScenarioStep({ flow }: { flow: Flow }) {
  const { scenarios } = flow
  const head = (
    <StepHead
      title="Hypothetical scenarios"
      sub="How your approved rules behave in three made-up market shapes. Dollar figures are hypothetical results on synthetic candles, never a backtest or a forecast."
      right={<StatusPill value="SYNTHETIC" />}
    />
  )
  if (scenarios.status === 'idle' || scenarios.status === 'loading')
    return (
      <div className="ta-section">
        {head}
        <Card>
          <Working label="Scenario" />
        </Card>
      </div>
    )
  if (scenarios.status === 'error')
    return (
      <div className="ta-section">
        {head}
        <ErrorNote message={scenarios.error} onRetry={flow.loadScenarios} />
        <Nav back={() => flow.go(2)} />
      </div>
    )

  return (
    <div className="ta-section">
      {head}
      <div className="ta-scen">
        {scenarios.data.scenarios.map((s) => (
          <Card key={s.name} title={s.name.charAt(0).toUpperCase() + s.name.slice(1)}>
            <div className="ta-card__body ta-stack">
              <ScenarioGlyph s={s} />
              <p className="m-0">{s.narrative}</p>
              <details className="ta-small ta-muted">
                <summary className="cursor-pointer">Assumptions ({s.assumptions.length})</summary>
                <ul className="m-0 mt-2 pl-5">
                  {s.assumptions.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              </details>
              <div className="ta-scope ta-stack" style={{ gap: 'var(--space-1)' }}>
                {s.computed_pnl_usd !== undefined ? (
                  <span>
                    Hypothetical engine result on these synthetic candles:{' '}
                    <strong className={`ta-mono ${s.computed_pnl_usd < 0 ? 'text-blocked' : ''}`}>
                      {signedUsd(s.computed_pnl_usd)}
                    </strong>
                  </span>
                ) : (
                  <span>Narrative only. No dollar result.</span>
                )}
                <span>
                  <Button
                    variant="link"
                    className="h-auto px-0 text-left whitespace-normal"
                    onClick={() => {
                      flow.setFixture(scenarioFixture(s.name))
                      flow.go(4)
                    }}
                  >
                    Replay it step by step →
                  </Button>
                </span>
              </div>
            </div>
          </Card>
        ))}
      </div>
      {scenarios.data.disclaimer && <p className="m-0 ta-small ta-muted">{scenarios.data.disclaimer}</p>}
      <Nav back={() => flow.go(2)}>
        <Button onClick={() => flow.go(4)}>Set up the simulation</Button>
      </Nav>
    </div>
  )
}
