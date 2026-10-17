import type { FixtureId } from '../api'

/** The engine's sessions (backend/API.md), named for what a trader will see in them. */
export const FIXTURES: { id: FixtureId; label: string; detail: string }[] = [
  {
    id: 'two-loss-lock',
    label: 'Two-loss lock test',
    detail: 'Two entries stop out in a row, then a third valid signal arrives while entries are locked.',
  },
  {
    id: 'winning-reset',
    label: 'A win resets the streak',
    detail: 'Loss, win, loss: the win resets the loss streak, and the trade limit stops a fourth entry.',
  },
  {
    id: 'cutoff',
    label: 'Late entry, flattened at the cutoff',
    detail: 'An entry late in the session is still open at the cutoff and is closed by the session rule.',
  },
  {
    id: 'ambiguous-bar',
    label: 'Stop and target in the same bar',
    detail: 'Both levels are touched inside one bar; the engine conservatively assumes the stop came first.',
  },
  {
    id: 'trend-fail',
    label: 'Downtrend: no trades',
    detail: 'The trend filter never passes, so the engine records NO_TRADE all session and places no orders.',
  },
  {
    id: 'standard',
    label: 'Random session (seeded)',
    detail: 'A seeded random walk. Unlike the crafted sessions above, a different seed gives different candles.',
  },
]

/** Scenario cards replay the seeded session of the same name (trend, range, adverse). */
export const scenarioFixture = (name: string): FixtureId => name

const LABELS: Record<string, string> = { trend: 'Trend scenario', range: 'Range scenario', adverse: 'Adverse scenario' }

export const fixtureLabel = (id: FixtureId) => FIXTURES.find((f) => f.id === id)?.label ?? LABELS[id] ?? id
