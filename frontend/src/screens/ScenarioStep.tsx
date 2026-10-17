import { Card, ErrorNote, Nav, StepHead, Working } from '../components/Layout'
import { StatusPill } from '../components/StatusPill'
import type { Flow } from '../flow/useFlow'
import { signedUsd } from '../lib/format'
import { FIXTURES } from './fixtures'

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
      sub="How your approved rules are meant to behave in three made-up market shapes. These are explanations, not results: dollar figures come only from the simulation step."
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
          const replay = FIXTURES.find((f) => f.scenario === s.name)
          return (
            <Card key={s.name} title={s.name.charAt(0).toUpperCase() + s.name.slice(1)}>
              <div className="ta-card__body ta-stack">
                <Spark {...shape} />
                <p className="m-0">{s.narrative}</p>
                <ul className="ta-small ta-muted m-0 pl-5">
                  {s.assumptions.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
                <div className="ta-scope">
                  {s.computed_pnl_usd !== undefined
                    ? `Engine replay result: ${signedUsd(s.computed_pnl_usd)}`
                    : 'Narrative only. No dollar result.'}{' '}
                  {replay ? (
                    <button
                      type="button"
                      className="ta-btn ta-btn--quiet px-0"
                      onClick={() => {
                        flow.setFixture(replay.id)
                        flow.go(4)
                      }}
                    >
                      Replay this as “{replay.label}” →
                    </button>
                  ) : (
                    'No replay for this shape yet.'
                  )}
                </div>
              </div>
            </Card>
          )
        })}
      </div>
      <Nav back={() => flow.go(2)}>
        <button type="button" className="ta-btn ta-btn--primary" onClick={() => flow.go(4)}>
          Set up the simulation
        </button>
      </Nav>
    </div>
  )
}
