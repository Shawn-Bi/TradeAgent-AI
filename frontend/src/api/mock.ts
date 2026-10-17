// In-browser mock of owner B's backend, returning the exact PRD section 8 response shapes so the
// UI can be built before the API is up. It is a stand-in, not the engine: it never computes P&L,
// and the risk lock here only replays the two-loss-lock fixture. The backend enforces the real rules.

import contractStrategy from '../../../contracts/strategy.example.json'
import twoLossFixture from '../../../two_loss_lock.fixture.json'
import { ApiError } from './errors'
import type {
  AuditEvent,
  ClarificationQuestion,
  CompletedTrade,
  SimulationReport,
  SimulationState,
  StrategySpec,
  TradeAgentApi,
} from './types'

const LATENCY_MS = 350
const STARTING_EQUITY_USD = 100_000
const DISCLAIMER = 'Synthetic demo, not historical backtest'

const baseStrategy = contractStrategy as StrategySpec

interface StoredStrategy {
  spec: StrategySpec
  clarifications: ClarificationQuestion[]
}

interface StoredSimulation {
  state: SimulationState
  events: AuditEvent[]
  report: SimulationReport
}

const delay = () => new Promise((resolve) => setTimeout(resolve, LATENCY_MS))
const clone = <T>(value: T): T => structuredClone(value)
const key = (id: string, version: number) => `${id}@${version}`

function fail(status: number, code: string, message: string, field: string | null = null): never {
  throw new ApiError(status, { error: { code, message, field } })
}

function deepMerge<T>(target: T, overrides: Record<string, unknown>): T {
  const out = clone(target) as Record<string, unknown>
  for (const [k, v] of Object.entries(overrides)) {
    const current = out[k]
    out[k] =
      v && typeof v === 'object' && !Array.isArray(v) && current && typeof current === 'object'
        ? deepMerge(current, v as Record<string, unknown>)
        : v
  }
  return out as T
}

/** "4 points" is the ambiguity the PRD calls out; anything like it needs a ticks answer. */
function findClarifications(freeText: string): ClarificationQuestion[] {
  const match = freeText.match(/\b(\d+(?:\.\d+)?)\s*(points?|pts?)\b/i)
  if (!match) return []
  return [
    {
      field: 'stop.buffer_ticks',
      source_text: match[0],
      question: `Does "${match[0]}" mean ticks or price points? The stop buffer is measured in ticks (0.001 USD/MMBtu each).`,
      choices: [`${match[1]} ticks`, `${match[1]} price points`],
    },
  ]
}

function twoLossLockRun(simulationId: string, spec: StrategySpec): StoredSimulation {
  const date = spec.session.demo_date
  const times = ['10:05:00', '11:20:00', '12:35:00', '13:10:00', '14:00:00']
  const at = (step: number) => `${date}T${times[step - 1]}-04:00`

  const completed: CompletedTrade[] = twoLossFixture.steps
    .filter((s) => s.event === 'POSITION_CLOSED')
    .map((s) => ({ position_id: s.position_id, realized_pnl_usd: s.realized_pnl_usd ?? 0 }))

  // Entry decisions only. rule_ids other than RISK_TWO_LOSSES are placeholders until B's engine names them.
  const events: AuditEvent[] = twoLossFixture.steps
    .filter((s) => s.event === 'ENTRY_ELIGIBLE')
    .map((s, i) => {
      const action = s.expected ?? 'NO_TRADE'
      const blocked = action === 'BLOCK_ENTRY'
      return {
        event_id: `evt-${i + 1}`,
        seq: i + 1,
        timestamp: at(s.step),
        rule_id: blocked ? 'RISK_TWO_LOSSES' : 'ENTRY_PULLBACK_5M',
        expected_action: action,
        actual_action: action,
        compliant: true,
        reason: blocked
          ? 'Two completed losing trades'
          : `Pullback to 5m SMA(20) held with bullish confirmation; opened ${s.position_id}`,
      }
    })

  const compliant = events.filter((e) => e.compliant).length
  return {
    state: {
      simulation_id: simulationId,
      status: 'COMPLETED',
      account_id: spec.account_id,
      equity_usd: STARTING_EQUITY_USD + completed.reduce((sum, t) => sum + t.realized_pnl_usd, 0),
      positions: [],
      completed_trades: completed,
      consecutive_losses: 2,
      entry_locked: true,
      lock_reason: 'TWO_CONSECUTIVE_LOSSES',
      prism_status: 'LOCAL_ONLY',
    },
    events,
    report: {
      simulation_id: simulationId,
      synthetic: true,
      eligible_decisions: events.length,
      compliant_decisions: compliant,
      execution_conformance: events.length ? compliant / events.length : null,
      violations: events.length - compliant,
      disclaimer: DISCLAIMER,
    },
  }
}

/** The mock has no candle engine, so a standard run logs no decisions: conformance is N/A. */
function emptyRun(simulationId: string, spec: StrategySpec): StoredSimulation {
  return {
    state: {
      simulation_id: simulationId,
      status: 'COMPLETED',
      account_id: spec.account_id,
      equity_usd: STARTING_EQUITY_USD,
      positions: [],
      completed_trades: [],
      consecutive_losses: 0,
      entry_locked: false,
      lock_reason: null,
      prism_status: 'LOCAL_ONLY',
    },
    events: [],
    report: {
      simulation_id: simulationId,
      synthetic: true,
      eligible_decisions: 0,
      compliant_decisions: 0,
      execution_conformance: null,
      violations: 0,
      disclaimer: DISCLAIMER,
    },
  }
}

export function createMockApi(): TradeAgentApi {
  const strategies = new Map<string, StoredStrategy>()
  const simulations = new Map<string, StoredSimulation>()
  const latestVersion = new Map<string, number>()

  function requireStrategy(id: string, version: number): StoredStrategy {
    const stored = strategies.get(key(id, version))
    if (!stored) fail(404, 'STRATEGY_NOT_FOUND', `No strategy ${id} version ${version}.`, 'version')
    return stored
  }

  function requireApproved(id: string, version: number): StrategySpec {
    const { spec } = requireStrategy(id, version)
    if (spec.approval_status !== 'APPROVED') {
      fail(409, 'STRATEGY_NOT_APPROVED', `Approve ${id} version ${version} before running it.`)
    }
    return spec
  }

  function requireSimulation(id: string): StoredSimulation {
    const sim = simulations.get(id)
    if (!sim) fail(404, 'SIMULATION_NOT_FOUND', `No simulation ${id}.`, 'simulation_id')
    return sim
  }

  return {
    async health() {
      await delay()
      return { ok: true, contract_version: baseStrategy.schema_version }
    },

    async generateStrategy({ overrides, free_text }) {
      await delay()
      const id = baseStrategy.strategy_id
      // Every generate makes a new DRAFT version; earlier versions stay immutable.
      const version = (latestVersion.get(id) ?? 0) + 1
      latestVersion.set(id, version)

      const spec = deepMerge(baseStrategy, overrides)
      spec.strategy_id = id
      spec.version = version
      spec.approval_status = 'DRAFT'
      const clarifications = findClarifications(free_text)
      strategies.set(key(id, version), { spec, clarifications })

      return {
        strategy: clone(spec),
        clarification_questions: clone(clarifications),
        warnings: ['Preset fallback (mock adapter). No AI model was called.'],
        strategy_summary:
          `Long ${spec.instrument.symbol}: ${spec.timeframes.trend_minutes}m SMA(${spec.trend.period}) trend, ` +
          `${spec.timeframes.entry_minutes}m pullback within ${spec.entry.tolerance_ticks} ticks, ` +
          `stop ${spec.stop.buffer_ticks} ticks below the ${spec.stop.lookback_5m_bars}-bar low, ` +
          `${spec.exit.target_r}R target on ${spec.exit.first_target_close_contracts} of ${spec.quantity_contracts} contracts, ` +
          `lock after ${spec.risk.consecutive_loss_lock} losses.`,
      }
    },

    async approveStrategy({ strategy_id, version }) {
      await delay()
      const stored = requireStrategy(strategy_id, version)
      if (stored.clarifications.length > 0) {
        fail(409, 'CLARIFICATION_REQUIRED', 'Answer the open clarification questions before approving.')
      }
      stored.spec.approval_status = 'APPROVED'
      return { strategy_id, version, approval_status: 'APPROVED' }
    },

    async generateScenarios({ strategy_id, version, seed }) {
      await delay()
      requireApproved(strategy_id, version)
      // No computed_pnl_usd: the mock has no engine replay, and P&L must never be fabricated.
      return {
        synthetic: true,
        method: 'RULE_BASED_SYNTHETIC_REPLAY',
        seed,
        scenarios: [
          {
            name: 'trend',
            assumptions: ['synthetic candles', '15m SMA(20) rising', 'fills at trigger price, zero fees'],
            narrative:
              'Price holds above a rising 15m SMA(20) and pulls back to the 5m SMA(20). A bullish close confirms the entry; the first contract exits at 1.2R and the second rides to the stop or the 16:00 cutoff.',
          },
          {
            name: 'range',
            assumptions: ['synthetic candles', '15m SMA(20) flat'],
            narrative:
              'The 15m SMA(20) is not rising over 2 bars, so the trend filter fails and the engine records NO_TRADE for each pullback.',
          },
          {
            name: 'adverse',
            assumptions: ['synthetic candles', 'two consecutive stop-outs'],
            narrative:
              'Two entries stop out in a row. The two-loss lock blocks any further entries until the next session; exits stay allowed.',
          },
        ],
      }
    },

    async startSimulation({ strategy_id, version, seed, fixture = 'standard' }) {
      await delay()
      const spec = requireApproved(strategy_id, version)
      const simulationId = `sim-${seed}-${simulations.size + 1}`
      const run = fixture === 'two-loss-lock' ? twoLossLockRun(simulationId, spec) : emptyRun(simulationId, spec)
      simulations.set(simulationId, run)
      return { simulation_id: simulationId, status: 'COMPLETED', seed }
    },

    async getSimulation(id) {
      await delay()
      return clone(requireSimulation(id).state)
    },

    async getSimulationEvents(id) {
      await delay()
      return { events: clone(requireSimulation(id).events) }
    },

    async getSimulationReport(id) {
      await delay()
      return clone(requireSimulation(id).report)
    },
  }
}
