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
