import type { FixtureId } from '../api'

/** The replayable sessions, named for what a trader will see in them. */
export const FIXTURES: { id: FixtureId; label: string; detail: string; scenario?: string }[] = [
  {
    id: 'two-loss-lock',
    label: 'Adverse day: two-loss lock test',
    detail: 'Two entries stop out in a row, then a third valid signal arrives while entries are locked.',
    scenario: 'adverse',
  },
  {
    id: 'standard',
    label: 'Mixed day: a loss, then a rally',
    detail: 'One stop-out, then a rally. Your stop and target decide whether it hits the target or closes at the cutoff.',
  },
]

export const fixtureLabel = (id: FixtureId) => FIXTURES.find((f) => f.id === id)?.label ?? id
