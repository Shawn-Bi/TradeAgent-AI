import type { AuditEvent, CompletedTrade } from '../api'
import type { RunResult } from '../flow/useFlow'

export function summarize(run: RunResult) {
  const trades = run.state.completed_trades
  const pnl = trades.reduce((s, t) => s + t.realized_pnl_usd, 0)
  const wins = trades.filter((t) => t.realized_pnl_usd > 0).length
  const losses = trades.filter((t) => t.realized_pnl_usd < 0).length
  const worst = trades.length ? Math.min(...trades.map((t) => t.realized_pnl_usd)) : 0
  const blocked = run.events.filter((e) => e.actual_action === 'BLOCK_ENTRY').length
  return { trades: trades.length, pnl, wins, losses, worst, blocked }
}

export const pnlTone = (n: number) => (n < 0 ? ('neg' as const) : undefined)

const LEG = { TARGET_PARTIAL_EXIT: 'target', STOP_HIT: 'stop', AMBIGUOUS_BAR_STOP_FIRST: 'stop', CUTOFF_EXIT: 'cutoff' } as const

/** One completed trade, read off its exit legs. */
export function tradeView(t: CompletedTrade) {
  const legs = t.legs ?? []
  const contracts = t.quantity_contracts ?? legs.reduce((n, l) => n + l.contracts, 0)
  const sold = legs.reduce((n, l) => n + l.contracts, 0)
  const avgExit = sold ? legs.reduce((sum, l) => sum + l.exit_price * l.contracts, 0) / sold : null
  const steps = legs.map((l) => LEG[l.exit_reason as keyof typeof LEG] ?? l.exit_reason)
  const ambiguous = legs.some((l) => l.exit_reason === 'AMBIGUOUS_BAR_STOP_FIRST')
  const outcome =
    steps.join(',') === 'stop'
      ? ambiguous
        ? 'Stopped out (stop and target in one bar: stop counted first)'
        : 'Stopped out'
      : steps.join(',') === 'cutoff'
        ? 'Closed at the cutoff'
        : steps[0] === 'target'
          ? `Target, then ${steps[1] ?? 'open'}`
          : steps.join(', ')
  return { contracts, avgExit, outcome }
}

/** Routine evaluations (~75 per session); hidden by default so the decisions a trader cares about stand out. */
export const isRoutine = (e: AuditEvent) => e.category === 'SIGNAL' || e.category === 'DATA'

// ---------- Decision funnel: what the engine refused at each gate, and why ----------

/** Plain words for why a candidate entry stopped at the risk gate (risk_gate_result "BLOCKED:<code>"). */
const GATE_WORDS: Record<string, string> = {
  TWO_CONSECUTIVE_LOSSES: 'blocked: two losses in a row',
  MAX_TRADES: 'blocked: trade limit reached',
  SESSION_CUTOFF: 'blocked: session cutoff',
  POSITION_NOT_FLAT: 'blocked: already in a trade',
  MISSING_STOP: 'blocked: no stop could be set',
  INVALID_RISK: 'blocked: entry not above stop',
  INSUFFICIENT_MARGIN: 'blocked: mock margin too low',
  BLOCKED_UNAPPROVED: 'blocked: version not approved',
}

export interface FunnelDrop {
  label: string
  count: number
  /** Stopped by a risk rule (shown in orange with the word "blocked"), rather than a rule simply not met. */
  blocked: boolean
}

export interface FunnelStage {
  label: string
  count: number
  /** Decisions that left the funnel between this stage and the next. */
  drops: FunnelDrop[]
}

/**
 * One row per gate the engine checks on every completed 5m bar: trend, pullback, risk gate, fill.
 * Built only from bar evaluations (events carrying trend_ok), so exits and bookkeeping never count.
 */
export function decisionFunnel(events: AuditEvent[]): FunnelStage[] {
  const bars = events.filter((e) => typeof e.trend_ok === 'boolean')
  const trend = bars.filter((e) => e.trend_ok)
  const pullback = trend.filter((e) => e.entry_ok)
  const passed = pullback.filter((e) => e.risk_gate_result === 'PASS')
  const filled = passed.filter((e) => e.actual_action === 'OPEN_LONG')

  const gateDrops = new Map<string, FunnelDrop>()
  for (const e of pullback) {
    if (e.risk_gate_result === 'PASS') continue
    const code = e.risk_gate_result?.startsWith('BLOCKED:') ? e.risk_gate_result.slice(8) : null
    const label = code
      ? (GATE_WORDS[code] ?? `blocked: ${code.toLowerCase().replaceAll('_', ' ')}`)
      : e.reason_code === 'WAIT_NEXT_BAR'
        ? 'no next bar to fill on'
        : 'not sent to the risk gate'
    const d = gateDrops.get(label) ?? { label, count: 0, blocked: code !== null }
    d.count += 1
    gateDrops.set(label, d)
  }

  const keep = (d: FunnelDrop[]) => d.filter((x) => x.count > 0)
  return [
    { label: 'Bars evaluated', count: bars.length, drops: keep([{ label: 'trend not rising', count: bars.length - trend.length, blocked: false }]) },
    { label: 'Trend OK', count: trend.length, drops: keep([{ label: 'pullback missed', count: trend.length - pullback.length, blocked: false }]) },
    { label: 'Pullback OK', count: pullback.length, drops: [...gateDrops.values()] },
    { label: 'Risk gate passed', count: passed.length, drops: keep([{ label: 'not filled', count: passed.length - filled.length, blocked: false }]) },
    { label: 'Filled (paper)', count: filled.length, drops: [] },
  ]
}

// ---------- Per-trade R: realised result in units of the trade's own initial risk ----------

export interface TradeR {
  /** Dollar value of 1R for the whole position: risk ticks × tick value × contracts. */
  oneR: number
  realized: number
  legs: { reason: string; word: string; contracts: number; r: number; pnl: number }[]
}

/** null when the trade lacks the risk fields needed to express it in R. */
export function tradeR(t: CompletedTrade, tickValueUsd: number): TradeR | null {
  const qty = t.quantity_contracts ?? (t.legs ?? []).reduce((n, l) => n + l.contracts, 0)
  if (!t.initial_risk_ticks || !qty || !tickValueUsd) return null
  const perContract = t.initial_risk_ticks * tickValueUsd
  return {
    oneR: perContract * qty,
    realized: t.realized_pnl_usd / (perContract * qty),
    legs: (t.legs ?? []).map((l) => ({
      reason: l.exit_reason,
      word: LEG[l.exit_reason as keyof typeof LEG] ?? l.exit_reason.toLowerCase(),
      contracts: l.contracts,
      r: l.contracts ? l.pnl_usd / (perContract * l.contracts) : 0,
      pnl: l.pnl_usd,
    })),
  }
}

/** "+1.23R" / "−1.00R" / "0.00R", with a true minus sign. */
export const signedR = (r: number) => {
  const v = Math.abs(r) < 0.005 ? 0 : r
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}R`
}

/**
 * How each completed trade ended, in mutually exclusive outcome words (never won/lost):
 * at target = the first target filled; at stop = closed at the stop without reaching target;
 * at cutoff = closed by the session cutoff without reaching target.
 */
export function tradeOutcomes(trades: CompletedTrade[]) {
  let target = 0
  let stop = 0
  let cutoff = 0
  for (const t of trades) {
    const words = (t.legs ?? []).map((l) => LEG[l.exit_reason as keyof typeof LEG])
    if (words.includes('target')) target += 1
    else if (words.at(-1) === 'stop') stop += 1
    else if (words.at(-1) === 'cutoff') cutoff += 1
  }
  return { closed: trades.length, target, stop, cutoff }
}

/** Plain words for a BLOCK_ENTRY's reason code, for rows that list a refused entry. */
export const blockWords = (code: string | null | undefined) =>
  (code && GATE_WORDS[code]) ?? 'blocked by a risk rule'
