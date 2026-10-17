// In-browser mock of owner B's backend, returning the PRD section 8 response shapes so the UI can be
// built before the API is up. It is a stand-in, not the engine: B's deterministic Python engine is the
// source of truth. Two rules the mock still keeps honest:
//   1. The market is fixed per session. Changing a rule changes what the engine does, never the prices.
//   2. Every dollar figure is computed from those fixed prices and the approved rules. Nothing is typed in.

import contractStrategy from '../../../contracts/strategy.example.json'
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

const LATENCY_MS = 450
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
const fmtUsd = (n: number) =>
  `${n > 0 ? '+' : n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2 })}`

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

// ---------- Free-text interpretation ----------
// Each sentence either becomes a rule (APPLIED), needs a question, or is reported as NOT_APPLIED.
// Warning prefixes follow the convention in src/lib/warnings.ts.

const MAX_BUFFER_TICKS = 50

function interpret(freeText: string, spec: StrategySpec) {
  const clarifications: ClarificationQuestion[] = []
  const warnings: string[] = []
  const sentences = freeText
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)

  for (const sentence of sentences) {
    const points = sentence.match(/(\d+(?:\.\d+)?)\s*(points?|pts?)\b/i)
    const ticks = sentence.match(/(\d+)\s*ticks?\b/i)
    if (points) {
      const n = Number(points[1])
      const asTicks = (t: number) => sentence.replace(points[0], `${t} ticks`)
      const choices = [
        {
          label: `${n} ticks (${(n * spec.instrument.tick_size).toFixed(3)} USD/MMBtu)`,
          overrides: { stop: { buffer_ticks: n } },
          replacement_text: asTicks(n),
        },
      ]
      if (Number.isInteger(n * 10) && n * 10 <= MAX_BUFFER_TICKS)
        choices.push({
          label: `${n} cents (${(n * 0.01).toFixed(3)} USD/MMBtu, which is ${n * 10} ticks)`,
          overrides: { stop: { buffer_ticks: n * 10 } },
          replacement_text: asTicks(n * 10),
        })
      clarifications.push({
        id: `points-${clarifications.length + 1}`,
        field: 'stop.buffer_ticks',
        source_text: sentence,
        question: `Is that ${n} ticks or ${n} cents? Stops are set in ticks: 1 tick = 0.001 USD/MMBtu = $10 per contract.`,
        choices,
        custom: { unit: 'ticks', field: 'stop.buffer_ticks', min: 1, max: MAX_BUFFER_TICKS },
      })
    } else if (/\bshort\b/i.test(sentence)) {
      clarifications.push({
        id: `short-${clarifications.length + 1}`,
        field: 'direction',
        source_text: sentence,
        question: 'This version is long only. How should the short idea be handled?',
        choices: [{ label: 'Keep long only and drop this sentence', overrides: {}, replacement_text: '' }],
      })
    } else if (ticks && /\bstop\b/i.test(sentence)) {
      const n = Number(ticks[1])
      if (n >= 1 && n <= MAX_BUFFER_TICKS) {
        spec.stop.buffer_ticks = n
        warnings.push(`APPLIED · ${sentence} · stop buffer set to ${n} ticks`)
      } else {
        warnings.push(`NOT_APPLIED · ${sentence} · the stop buffer must be 1 to ${MAX_BUFFER_TICKS} ticks`)
      }
    } else if (/overnight|tomorrow/i.test(sentence)) {
      warnings.push(
        `NOT_APPLIED · ${sentence} · nothing is held overnight; positions go flat by ${spec.session.cutoff_local} ET`,
      )
    } else if (/\b(skip|avoid|wait|first|after the open|minutes?)\b/i.test(sentence)) {
      warnings.push(`NOT_APPLIED · ${sentence} · time-of-day filters are not supported in this version`)
    } else if (/\bnews|chop|volatil/i.test(sentence)) {
      warnings.push(`NOT_APPLIED · ${sentence} · news and chop filters are not implemented; pause manually`)
    } else {
      warnings.push(
        `NOT_APPLIED · ${sentence} · not recognised as a rule this version supports; it will not affect the simulation`,
      )
    }
  }
  return { clarifications, warnings }
}

// ---------- Fixed synthetic sessions ----------

interface Signal {
  time: string
  entry: number
  swing_low: number
  /** 'drop' falls straight through any allowed stop; 'rally' peaks at `peak`, then closes at `close`. */
  path: 'drop' | 'rally'
  exit_time: string
  peak?: number
  close?: number
}

interface Session {
  no_trades: { time: string; rule_id: string; reason: string }[]
  signals: Signal[]
}

const SESSIONS: Record<string, Session> = {
  'two-loss-lock': {
    no_trades: [{ time: '09:45', rule_id: 'TREND_15M', reason: '15m SMA not rising yet, so no entry is allowed.' }],
    signals: [
      { time: '10:35', entry: 2.914, swing_low: 2.911, path: 'drop', exit_time: '11:05' },
      { time: '12:20', entry: 2.926, swing_low: 2.922, path: 'drop', exit_time: '12:55' },
      { time: '14:00', entry: 2.93, swing_low: 2.926, path: 'rally', exit_time: '14:50', peak: 2.95, close: 2.938 },
    ],
  },
  standard: {
    no_trades: [
      { time: '09:45', rule_id: 'TREND_15M', reason: '15m SMA not rising yet, so no entry is allowed.' },
      { time: '10:05', rule_id: 'ENTRY_PULLBACK', reason: 'Pullback went past the tolerance below the SMA. No entry.' },
    ],
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

  const raw: Omit<AuditEvent, 'event_id' | 'seq'>[] = []
  const log = (time: string, rule_id: string, action: string, reason: string) =>
    raw.push({ timestamp: ts(time), rule_id, expected_action: action, actual_action: action, compliant: true, reason })

  session.no_trades.forEach((n) => log(n.time, n.rule_id, 'NO_TRADE', n.reason))

  const trades: CompletedTrade[] = []
  let losses = 0
  let locked = false

  for (const s of session.signals) {
    if (s.time >= cutoff) continue
    if (locked) {
      log(
        s.time,
        'RISK_TWO_LOSSES',
        'BLOCK_ENTRY',
        `Valid pullback signal at ${px(s.entry)} refused: TWO_CONSECUTIVE_LOSSES. No order opened.`,
      )
      continue
    }
    if (trades.length >= spec.risk.max_completed_trades_per_session) {
      log(s.time, 'RISK_MAX_TRADES', 'NO_TRADE', `Already ${trades.length} completed trades this session.`)
      continue
    }
    const riskTicks = toTicks(s.entry - s.swing_low) + spec.stop.buffer_ticks
    const stop = s.entry - riskTicks * tick
    const targetTicks = Math.round(spec.exit.target_r * riskTicks)
    const target = s.entry + targetTicks * tick
    log(
      s.time,
      'ENTRY_PULLBACK',
      'OPEN_LONG',
      `Pullback held at SMA(${spec.entry.ma_period}) with a bullish close. Entry ${px(s.entry)}, stop ${px(stop)} (${riskTicks} ticks), target ${px(target)}.`,
    )

    let pnl: number
    let exitPrice: number
    let reason: CompletedTrade['exit_reason']
    if (s.path === 'drop') {
      pnl = -riskTicks * tickUsd * qty
      exitPrice = stop
      reason = 'STOP'
      log(s.exit_time, 'STOP_HIT', 'EXIT_ALL', `Stop ${px(stop)} hit. ${qty} contracts closed, ${fmtUsd(pnl)}.`)
    } else {
      const close = s.close ?? s.entry
      if (target <= (s.peak ?? s.entry)) {
        const firstQty = spec.exit.first_target_close_contracts
        const restQty = qty - firstQty
        const first = targetTicks * tickUsd * firstQty
        const rest = toTicks(close - s.entry) * tickUsd * restQty
        pnl = first + rest
        exitPrice = (target * firstQty + close * restQty) / qty
        reason = 'TARGET_THEN_CUTOFF'
        log(s.exit_time, 'TARGET_HIT', 'EXIT_PARTIAL', `Target ${px(target)} hit. ${firstQty} contract closed, ${fmtUsd(first)}.`)
        log(cutoff, 'SESSION_CUTOFF', 'EXIT_REMAINDER', `${cutoff} cutoff. Last contract closed at ${px(close)}, ${fmtUsd(rest)}.`)
      } else {
        pnl = toTicks(close - s.entry) * tickUsd * qty
        exitPrice = close
        reason = 'CUTOFF'
        log(
          cutoff,
          'SESSION_CUTOFF',
          'EXIT_REMAINDER',
          `Target ${px(target)} never reached. ${cutoff} cutoff closed ${qty} contracts at ${px(close)}, ${fmtUsd(pnl)}.`,
        )
      }
    }
    trades.push({
      position_id: `P${trades.length + 1}`,
      contracts: qty,
      entry_price: s.entry,
      exit_price: Number(exitPrice.toFixed(4)),
      exit_reason: reason,
      realized_pnl_usd: pnl,
    })
    losses = pnl < 0 ? losses + 1 : 0
    if (losses >= spec.risk.consecutive_loss_lock) {
      locked = true
      log(
        s.exit_time,
        'RISK_TWO_LOSSES',
        'LOCK_ENTRIES',
        `${losses} losing trades in a row. New entries locked until the next session.`,
      )
    }
  }
  if (!raw.some((e) => e.rule_id === 'SESSION_CUTOFF')) log(cutoff, 'SESSION_CUTOFF', 'NO_ACTION', `Already flat at the ${cutoff} cutoff.`)

  const events: AuditEvent[] = raw
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.timestamp.localeCompare(b.e.timestamp) || a.i - b.i)
    .map(({ e }, n) => ({ event_id: `evt-${n + 1}`, seq: n + 1, ...e }))
  const compliant = events.filter((e) => e.compliant).length
  const pnl = trades.reduce((sum, t) => sum + t.realized_pnl_usd, 0)

  return {
    state: {
      simulation_id: simulationId,
      status: 'COMPLETED',
      account_id: spec.account_id,
      equity_usd: STARTING_EQUITY_USD + pnl,
      positions: [],
      completed_trades: trades,
      consecutive_losses: losses,
      entry_locked: locked,
      lock_reason: locked ? 'TWO_CONSECUTIVE_LOSSES' : null,
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

// ---------- API ----------

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
    if (spec.approval_status !== 'APPROVED')
      fail(409, 'STRATEGY_NOT_APPROVED', `Approve ${id} version ${version} before running it.`)
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
      const { clarifications, warnings } = interpret(free_text, spec)
      strategies.set(key(id, version), { spec, clarifications })

      return {
        strategy: clone(spec),
        clarification_questions: clone(clarifications),
        warnings: [
          'PRESET_FALLBACK · No AI model is connected, so the built-in preset wrote these rules.',
          ...warnings,
          'Fees and slippage are zero in this demo.',
        ],
        strategy_summary:
          `Long ${spec.instrument.symbol} only. Trade with the ${spec.timeframes.trend_minutes}m trend and enter on a ` +
          `${spec.timeframes.entry_minutes}m pullback to SMA(${spec.entry.ma_period}). Stop ${spec.stop.buffer_ticks} ticks ` +
          `below the swing low, take ${spec.exit.first_target_close_contracts} of ${spec.quantity_contracts} contracts off at ` +
          `${spec.exit.target_r}R, and stop taking new trades after ${spec.risk.consecutive_loss_lock} losses in a row.`,
      }
    },

    async approveStrategy({ strategy_id, version }) {
      await delay()
      const stored = requireStrategy(strategy_id, version)
      if (stored.clarifications.length > 0)
        fail(409, 'CLARIFICATION_REQUIRED', 'Answer the open clarification questions before approving.')
      stored.spec.approval_status = 'APPROVED'
      return { strategy_id, version, approval_status: 'APPROVED' }
    },

    async generateScenarios({ strategy_id, version, seed }) {
      await delay()
      const spec = requireApproved(strategy_id, version)
      const tf = spec.timeframes
      // No computed_pnl_usd: these are narratives, and P&L must never be fabricated.
      return {
        synthetic: true,
        method: 'RULE_BASED_SYNTHETIC_REPLAY',
        seed,
        scenarios: [
          {
            name: 'trend',
            assumptions: ['synthetic candles', `${tf.trend_minutes}m SMA(${spec.trend.period}) rising`, 'fills at trigger price, zero fees'],
            narrative: `Price holds above a rising ${tf.trend_minutes}m SMA and pulls back to the ${tf.entry_minutes}m SMA. A bullish close confirms the entry; one contract exits at ${spec.exit.target_r}R and the other rides to the stop or the ${spec.session.cutoff_local} cutoff.`,
          },
          {
            name: 'range',
            assumptions: ['synthetic candles', `${tf.trend_minutes}m SMA flat`],
            narrative: `The ${tf.trend_minutes}m SMA is not rising, so the trend filter never passes. The engine records NO_TRADE for each pullback and stays flat all session.`,
          },
          {
            name: 'adverse',
            assumptions: ['synthetic candles', 'two stop-outs in a row'],
            narrative: `Two entries stop out in a row. The ${spec.risk.consecutive_loss_lock}-loss lock engages and the next otherwise valid signal is refused. Exits stay allowed.`,
          },
        ],
      }
    },

    async startSimulation({ strategy_id, version, seed, fixture = 'standard' }) {
      await delay()
      const spec = requireApproved(strategy_id, version)
      const simulationId = `sim-${seed}-${simulations.size + 1}`
      simulations.set(simulationId, replay(simulationId, spec, fixture))
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
