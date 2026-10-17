// In-browser mock of B's backend (VITE_API_MODE=mock), returning the same shapes as backend/API.md so the
// UI works offline as a demo backup. It is a stand-in, not the engine: B's deterministic Python engine is
// the source of truth. Rules the mock keeps honest:
//   1. No model is called, so free text is never "interpreted": like the backend's fallback, a draft with
//      free text gets a clarification question and cannot be approved.
//   2. The market is fixed per session. Changing a rule changes what the engine does, never the prices.
//   3. Every dollar figure is computed from those fixed prices and the approved rules.

import contractStrategy from '../../../contracts/strategy.example.json'
import { ApiError } from './errors'
import type {
  AuditEvent,
  CompletedTrade,
  EngineAction,
  EventCategory,
  SimulationReport,
  SimulationState,
  StrategySpec,
  TradeAgentApi,
} from './types'

const LATENCY_MS = 450
const STARTING_EQUITY_USD = 100_000
const DISCLAIMER = 'Synthetic demo, not historical backtest'

const baseStrategy = contractStrategy as StrategySpec

interface StoredStrategy {
  spec: StrategySpec
  questions: string[]
}

interface StoredSimulation {
  state: SimulationState
  events: AuditEvent[]
  report: SimulationReport
}

const delay = () => new Promise((resolve) => setTimeout(resolve, LATENCY_MS))
const clone = <T>(value: T): T => structuredClone(value)
const key = (id: string, version: number) => `${id}@${version}`
const fmtUsd = (n: number) =>
  `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2 })} USD`

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

function summarize(s: StrategySpec) {
  return (
    `LONG_ONLY ${s.instrument.symbol} (demo, simulation only). IF ${s.timeframes.trend_minutes}m close > ` +
    `SMA${s.trend.period} AND SMA${s.trend.period} rising over ${s.trend.slope_bars} bars AND the latest ` +
    `${s.timeframes.entry_minutes}m bar low is within ${s.entry.tolerance_ticks} ticks of SMA${s.entry.ma_period} ` +
    `AND close > open AND close > SMA THEN buy ${s.quantity_contracts}. Stop: ${s.stop.buffer_ticks} ticks below the ` +
    `${s.stop.lookback_5m_bars}-bar swing low. Target: ${s.exit.target_r}R on ${s.exit.first_target_close_contracts} ` +
    `contract. Lock after ${s.risk.consecutive_loss_lock} consecutive losses; max ${s.risk.max_completed_trades_per_session} trades.`
  )
}

// ---------- Fixed synthetic sessions ----------

interface Signal {
  time: string
  entry: number
  swing_low: number
  /** 'drop' falls through any allowed stop; 'rally' peaks at `peak`, then the stop holds until the cutoff. */
  path: 'drop' | 'rally'
  exit_time: string
  peak?: number
  close?: number
}

const SESSIONS: Record<string, { description: string; no_trades: string[]; signals: Signal[] }> = {
  'two-loss-lock': {
    description: 'Mock: two losing positions, then a third otherwise-eligible entry',
    no_trades: ['09:45', '10:05'],
    signals: [
      { time: '10:35', entry: 2.914, swing_low: 2.911, path: 'drop', exit_time: '11:05' },
      { time: '12:20', entry: 2.926, swing_low: 2.922, path: 'drop', exit_time: '12:55' },
      { time: '14:00', entry: 2.93, swing_low: 2.926, path: 'rally', exit_time: '14:50', peak: 2.95, close: 2.938 },
    ],
  },
  standard: {
    description: 'Mock: a loss, then a rally',
    no_trades: ['09:45', '10:05', '14:30'],
    signals: [
      { time: '10:35', entry: 2.914, swing_low: 2.911, path: 'drop', exit_time: '11:05' },
      { time: '12:20', entry: 2.926, swing_low: 2.922, path: 'rally', exit_time: '13:15', peak: 2.96, close: 2.941 },
    ],
  },
}

function replay(simulationId: string, spec: StrategySpec, fixture: string): StoredSimulation {
  const session = SESSIONS[fixture] ?? SESSIONS.standard
  const tick = spec.instrument.tick_size
  const tickUsd = spec.instrument.tick_value_usd
  const qty = spec.quantity_contracts
  const cutoff = spec.session.cutoff_local
  const ts = (t: string) => `${spec.session.demo_date}T${t}:00-04:00`
  const toTicks = (d: number) => Math.round(d / tick)
  const px = (n: number) => n.toFixed(3)

  const raw: (Omit<AuditEvent, 'event_id' | 'seq'> & { i: number })[] = []
  const log = (
    time: string,
    category: EventCategory,
    rule_id: string,
    action: EngineAction,
    reason_code: string,
    reason: string,
    extra: Partial<AuditEvent> = {},
  ) =>
    raw.push({
      timestamp: ts(time),
      rule_id,
      expected_action: action,
      actual_action: action,
      compliant: true,
      reason,
      reason_code,
      category,
      eligible: true,
      ...extra,
      i: raw.length,
    })

  session.no_trades.forEach((t) =>
    log(t, 'SIGNAL', 'TREND_15M', 'NO_TRADE', 'NO_TRADE_TREND', '15m SMA not rising yet, so no entry is allowed.'),
  )

  const trades: CompletedTrade[] = []
  let losses = 0
  let lockReason: string | null = null

  for (const s of session.signals) {
    if (s.time >= cutoff) continue
    if (lockReason) {
      log(s.time, 'RISK_GATE', 'RISK_TWO_LOSSES', 'BLOCK_ENTRY', lockReason, `Valid pullback signal at ${px(s.entry)} refused: entries locked. No order opened.`, { price: s.entry })
      continue
    }
    const id = `P${trades.length + 1}`
    const riskTicks = toTicks(s.entry - s.swing_low) + spec.stop.buffer_ticks
    const stop = s.entry - riskTicks * tick
    const targetTicks = Math.round(spec.exit.target_r * riskTicks)
    const target = s.entry + targetTicks * tick
    log(s.time, 'EXECUTION', 'ENTRY_5M_PULLBACK', 'OPEN_LONG', 'ENTRY_FILLED', `Paper buy ${qty} @ ${px(s.entry)}; stop ${px(stop)} = swing low - ${spec.stop.buffer_ticks} ticks, target ${px(target)}.`, { price: s.entry, position_id: id })

    const legs: NonNullable<CompletedTrade['legs']> = []
    if (s.path === 'drop') {
      const pnl = -riskTicks * tickUsd * qty
      legs.push({ exit_time: ts(s.exit_time), contracts: qty, exit_price: stop, exit_reason: 'STOP_HIT', pnl_usd: pnl })
      log(s.exit_time, 'EXECUTION', 'EXIT_STOP', 'EXIT_STOP', 'STOP_HIT', `Protective stop touched: sell ${qty} @ ${px(stop)}`, { price: stop, pnl_usd: pnl, position_id: id })
    } else {
      const close = s.close ?? s.entry
      let open = qty
      if (target <= (s.peak ?? s.entry)) {
        const n = spec.exit.first_target_close_contracts
        const pnl = targetTicks * tickUsd * n
        legs.push({ exit_time: ts(s.exit_time), contracts: n, exit_price: target, exit_reason: 'TARGET_PARTIAL_EXIT', pnl_usd: pnl })
        log(s.exit_time, 'EXECUTION', 'EXIT_TARGET', 'EXIT_PARTIAL', 'TARGET_PARTIAL_EXIT', `${spec.exit.target_r}R target touched; close ${n} contract(s)`, { price: target, pnl_usd: pnl, position_id: id })
        open -= n
      }
      const pnl = toTicks(close - s.entry) * tickUsd * open
      legs.push({ exit_time: ts(cutoff), contracts: open, exit_price: close, exit_reason: 'CUTOFF_EXIT', pnl_usd: pnl })
      log(cutoff, 'EXECUTION', 'EXIT_CUTOFF', 'EXIT_CUTOFF', 'CUTOFF_EXIT', `${cutoff} demo cutoff: sell ${open} @ ${px(close)}`, { price: close, pnl_usd: pnl, position_id: id })
    }
    const total = legs.reduce((sum, l) => sum + l.pnl_usd, 0)
    const closedAt = legs[legs.length - 1].exit_time.slice(11, 16)
    trades.push({
      position_id: id,
      status: 'CLOSED',
      entry_time: ts(s.time),
      entry_price: s.entry,
      stop_price: Number(stop.toFixed(3)),
      target_price: Number(target.toFixed(3)),
      initial_risk_ticks: riskTicks,
      quantity_contracts: qty,
      open_contracts: 0,
      legs,
      realized_pnl_usd: total,
      result: total > 0 ? 'WIN' : total < 0 ? 'LOSS' : 'BREAKEVEN',
    })
    losses = total < 0 ? losses + 1 : 0
    log(closedAt, 'RISK', 'RISK_LOSS_STREAK', total < 0 ? 'COUNT_LOSS' : 'RESET_STREAK', 'POSITION_CLOSED', `${id} fully closed, net ${fmtUsd(total)}; consecutive_losses=${losses}`, { pnl_usd: total, position_id: id })
    if (losses >= spec.risk.consecutive_loss_lock) lockReason = 'TWO_CONSECUTIVE_LOSSES'
    else if (trades.length >= spec.risk.max_completed_trades_per_session) lockReason = 'MAX_TRADES'
    if (lockReason)
      log(closedAt, 'RISK_LOCK', lockReason === 'MAX_TRADES' ? 'RISK_MAX_TRADES' : 'RISK_TWO_LOSSES', 'LOCK_ENTRIES', lockReason, lockReason === 'MAX_TRADES' ? 'Maximum completed trades reached; no further entries this session' : `${losses} completed losing trades: entries locked until next session`)
  }
  log(cutoff, 'SESSION', 'RISK_SESSION_CUTOFF', 'CLOSE_SESSION', 'SESSION_CLOSED', `Session closed (${cutoff} demo cutoff): flat, no new entries`)

  const events: AuditEvent[] = raw
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.i - b.i)
    .map(({ i: _i, ...e }, n) => ({ event_id: `evt-${n + 1}`, seq: n + 1, ...e }))
  const eligible = events.filter((e) => e.eligible)
  const compliant = eligible.filter((e) => e.compliant).length
  const pnl = trades.reduce((sum, t) => sum + t.realized_pnl_usd, 0)
  const blocked = events.filter((e) => e.actual_action === 'BLOCK_ENTRY').length

  return {
    state: {
      simulation_id: simulationId,
      status: 'COMPLETED',
      account_id: spec.account_id,
      equity_usd: STARTING_EQUITY_USD + pnl,
      positions: [],
      completed_trades: trades,
      consecutive_losses: losses,
      entry_locked: lockReason !== null,
      lock_reason: lockReason,
      prism_status: 'LOCAL_ONLY',
      fixture,
      fixture_description: session.description,
      starting_equity_usd: STARTING_EQUITY_USD,
      realized_pnl_usd: pnl,
      completed_trade_count: trades.length,
      blocked_entry_count: blocked,
      prism_trace_id: null,
    },
    events,
    report: {
      simulation_id: simulationId,
      synthetic: true,
      eligible_decisions: eligible.length,
      compliant_decisions: compliant,
      execution_conformance: eligible.length ? compliant / eligible.length : null,
      violations: eligible.length - compliant,
      disclaimer: DISCLAIMER,
      blocked_entries: blocked,
      completed_trades: trades.length,
      realized_pnl_usd: pnl,
      prism_status: 'LOCAL_ONLY',
    },
  }
}

// ---------- API ----------

export function createMockApi(): TradeAgentApi {
  const strategies = new Map<string, StoredStrategy>()
  const simulations = new Map<string, StoredSimulation>()
  let latest = 0

  function requireStrategy(id: string, version: number): StoredStrategy {
    const stored = strategies.get(key(id, version))
    if (!stored) fail(404, 'STRATEGY_NOT_FOUND', `Strategy ${id} v${version} not found`, 'version')
    return stored
  }

  function requireApproved(id: string, version: number): StrategySpec {
    const { spec } = requireStrategy(id, version)
    if (spec.approval_status !== 'APPROVED')
      fail(409, 'STRATEGY_NOT_APPROVED', `Strategy ${id} v${version} is DRAFT; approve it before running`, 'version')
    return spec
  }

  function requireSimulation(id: string): StoredSimulation {
    const sim = simulations.get(id)
    if (!sim) fail(404, 'SIMULATION_NOT_FOUND', `Simulation '${id}' not found`, 'simulation_id')
    return sim
  }

  return {
    async health() {
      await delay()
      return { ok: true, contract_version: baseStrategy.schema_version }
    },

    async generateStrategy({ overrides, free_text, session_id }) {
      await delay()
      const spec = deepMerge(baseStrategy, overrides)
      spec.version = ++latest
      spec.approval_status = 'DRAFT'
      const text = free_text.trim()
      const questions: string[] = []
      if (text) {
        questions.push(
          'Mock mode did not interpret your text (no AI model is called offline). The strategy shown is the demo preset plus your explicit settings, NOT your written requirements. Clear the free text to use the demo preset.',
        )
        if (/\bpoints?\b/i.test(text))
          questions.push("Your text mentions 'points'. NG_SIM stops are measured in ticks (1 tick = 0.001 price units). Restate the stop buffer in ticks.")
      }
      strategies.set(key(spec.strategy_id, spec.version), { spec, questions })
      return {
        strategy: clone(spec),
        clarification_questions: questions,
        warnings: text ? ['DEMO PRESET FALLBACK: this proposal was not generated by Nicrron.'] : [],
        strategy_summary: summarize(spec),
        generator: 'PRESET_FALLBACK',
        approvable: questions.length === 0,
        nicrron: {
          status: text ? 'NOT_CONFIGURED' : 'NOT_REQUESTED',
          model_requested: null,
          model_used: null,
          cached: false,
          latency_ms: null,
          error_code: text ? 'NICRRON_NOT_CONFIGURED' : null,
          error_message: text ? 'Mock mode: no model is called.' : null,
          http_status: null,
          retry_after: null,
        },
        interpreted_fields: [],
        unsupported_requirements: [],
        prism: {
          status: 'NOT_REQUESTED',
          trace_id: null,
          error: null,
          session_id: session_id ?? 'mock',
          agent_id: 'tradeagent-strategy-translator',
        },
      }
    },

    async approveStrategy({ strategy_id, version }) {
      await delay()
      const stored = requireStrategy(strategy_id, version)
      if (stored.questions.length > 0)
        fail(409, 'CLARIFICATION_REQUIRED', 'Resolve clarification questions by generating a new version first', 'clarification_questions')
      stored.spec.approval_status = 'APPROVED'
      return { strategy_id, version, approval_status: 'APPROVED', approved_at: new Date().toISOString() }
    },

    async generateScenarios({ strategy_id, version, seed }) {
      await delay()
      const spec = requireApproved(strategy_id, version)
      const tf = spec.timeframes
      // The mock has no candle engine for these shapes, so no computed_pnl_usd: narratives only.
      return {
        synthetic: true,
        method: 'RULE_BASED_SYNTHETIC_REPLAY',
        seed,
        disclaimer: 'Hypothetical synthetic scenarios, not historical backtests; no win rate is implied.',
        scenarios: [
          { name: 'trend', assumptions: ['synthetic candles (mock)'], narrative: `Price holds above a rising ${tf.trend_minutes}m SMA and pulls back to the ${tf.entry_minutes}m SMA; one contract exits at ${spec.exit.target_r}R.` },
          { name: 'range', assumptions: ['synthetic candles (mock)'], narrative: `The ${tf.trend_minutes}m SMA is flat, so the trend filter never passes and the engine records NO_TRADE.` },
          { name: 'adverse', assumptions: ['synthetic candles (mock)'], narrative: `Entries stop out in a row; the ${spec.risk.consecutive_loss_lock}-loss lock refuses the next valid signal.` },
        ],
      }
    },

    async startSimulation({ strategy_id, version, seed, fixture = 'standard' }) {
      await delay()
      const spec = requireApproved(strategy_id, version)
      const simulationId = `sim-${seed}-${fixture}-v${version}`
      simulations.set(simulationId, replay(simulationId, spec, fixture))
      return { simulation_id: simulationId, status: 'COMPLETED', seed, fixture, strategy_id, version }
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
