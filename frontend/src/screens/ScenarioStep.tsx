import { Button } from '@/components/ui/button'
import { Card, ErrorNote, Nav, StepHead, Working } from '../components/Layout'
import { StatusPill } from '../components/StatusPill'
import type { Flow } from '../flow/useFlow'
import { signedUsd } from '../lib/format'
import { scenarioFixture } from './fixtures'

// Illustrative shapes only, so each card reads at a glance. They are drawn, not data.
const SHAPES: Record<string, { pts: number[]; color: string }> = {
  trend: { pts: [1, 2, 1.6, 3, 2.6, 4, 3.7, 5], color: 'var(--ledger)' },
  range: { pts: [3, 2.4, 3.1, 2.5, 3, 2.3, 2.9, 2.6], color: 'var(--ink-muted)' },
  adverse: { pts: [4, 4.4, 3.2, 3.9, 2.8, 3.4, 2.2, 2.6], color: 'var(--blocked)' },
}

function Spark({ pts, color }: { pts: number[]; color: string }) {
  const w = 240
  const h = 56
  const min = Math.min(...pts)
  const span = Math.max(...pts) - min || 1
  const d = pts
    .map((p, i) => `${i ? 'L' : 'M'}${((i * w) / (pts.length - 1)).toFixed(1)} ${(h - 6 - ((p - min) / span) * (h - 12)).toFixed(1)}`)
    .join(' ')
  return (
    <svg className="ta-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

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
        {scenarios.data.scenarios.map((s) => {
          const shape = SHAPES[s.name] ?? SHAPES.range
          return (
            <Card key={s.name} title={s.name.charAt(0).toUpperCase() + s.name.slice(1)}>
              <div className="ta-card__body ta-stack">
                <Spark {...shape} />
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
                      {s.completed_trades !== undefined &&
                        ` · ${s.completed_trades} trades · ${s.blocked_entries ?? 0} entries blocked`}
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
          )
        })}
      </div>
      {scenarios.data.disclaimer && <p className="m-0 ta-small ta-muted">{scenarios.data.disclaimer}</p>}
      <Nav back={() => flow.go(2)}>
        <Button onClick={() => flow.go(4)}>Set up the simulation</Button>
      </Nav>
    </div>
  )
}
