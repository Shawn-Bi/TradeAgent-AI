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
