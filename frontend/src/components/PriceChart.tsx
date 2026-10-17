import type { CompletedTrade, StrategySpec, TradeLeg } from '../api'
import type { RunResult } from '../flow/useFlow'
import { barsOf, clock, hourTicks, minutesOf, PLOT, sessionWindow, useWidth, type Bar } from '../lib/chart'
import { price, signedUsd } from '../lib/format'
import { StatusPill } from './StatusPill'

// The engine's own view of the session: synthetic 5m closes with the two SMAs its rules read, and every trade,
// exit, blocked entry and the loss lock drawn at the price and time the decision log records. The API sends no
// bar high, so this is a close line, never candles.

const EXIT: Record<string, { word: string; short: string; kind: 'stop' | 'target' | 'cutoff' }> = {
  STOP_HIT: { word: 'STOP', short: 'STOP', kind: 'stop' },
  AMBIGUOUS_BAR_STOP_FIRST: { word: 'STOP (SAME BAR)', short: 'STOP', kind: 'stop' },
  TARGET_PARTIAL_EXIT: { word: 'TARGET', short: 'TARGET', kind: 'target' },
  CUTOFF_EXIT: { word: 'CUTOFF', short: 'CUTOFF', kind: 'cutoff' },
}
const exitOf = (l: TradeLeg) => EXIT[l.exit_reason] ?? { word: l.exit_reason, short: l.exit_reason, kind: 'cutoff' as const }

const LOCK_WORDS: Record<string, string> = {
  TWO_CONSECUTIVE_LOSSES: 'after two losses in a row',
  MAX_TRADES: 'trade limit reached',
}

/** Round tick step (1, 2, 2.5 or 5 × 10ⁿ) giving about `count` labels. */
function niceStep(range: number, count: number) {
  const raw = range / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  return ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag
}

/** SVG path through the points, broken wherever a value is missing or a bar is skipped. */
function linePath(bars: Bar[], value: (b: Bar) => number | null, x: (t: number) => number, y: (p: number) => number) {
  let d = ''
  let prev: Bar | null = null
  for (const b of bars) {
    const v = value(b)
    if (v === null) {
      prev = null
      continue
    }
    const joined = prev !== null && b.t - prev.t <= 5
    d += `${joined ? 'L' : 'M'}${x(b.t).toFixed(1)},${y(v).toFixed(1)}`
    prev = b
  }
  return d
}

/** Filled band ± tolerance around the entry SMA, one polygon per unbroken run of bars. */
function bandPath(bars: Bar[], half: (b: Bar) => number, x: (t: number) => number, y: (p: number) => number) {
  const runs: Bar[][] = []
  for (const b of bars) {
    if (b.sma5 === null) continue
    const last = runs.at(-1)
    if (last && b.t - last[last.length - 1].t <= 5) last.push(b)
    else runs.push([b])
  }
  return runs
    .filter((r) => r.length > 1)
    .map((r) => {
      const up = r.map((b) => `${x(b.t).toFixed(1)},${y(b.sma5! + half(b)).toFixed(1)}`)
      const down = [...r].reverse().map((b) => `${x(b.t).toFixed(1)},${y(b.sma5! - half(b)).toFixed(1)}`)
      return `M${up.join('L')}L${down.join('L')}Z`
    })
    .join('')
}

const outcomeWords = (pnl: number) => (pnl > 0 ? 'closed at a profit' : pnl < 0 ? 'closed at a loss' : 'closed flat')

function tradeSentence(t: CompletedTrade, i: number) {
  const legs = (t.legs ?? [])
    .map((l) => `${exitOf(l).word.toLowerCase()} ${clock(minutesOf(l.exit_time))} at ${price(l.exit_price)} (${l.contracts} ${l.contracts === 1 ? 'contract' : 'contracts'})`)
    .join(', then ')
  return (
    `Trade ${i + 1}: entry ${clock(minutesOf(t.entry_time!))} at ${price(t.entry_price!)}, ` +
    `stop ${t.stop_price !== undefined ? price(t.stop_price) : '—'}, target ${t.target_price !== undefined ? price(t.target_price) : '—'}; ` +
    `${legs}; ${outcomeWords(t.realized_pnl_usd)} (${signedUsd(t.realized_pnl_usd)})`
  )
}

/** Halo so labels stay legible where they cross a line. */
const halo = { stroke: 'var(--panel)', strokeWidth: 3, strokeLinejoin: 'round', paintOrder: 'stroke' } as const

export function PriceChart({ run, spec }: { run: RunResult; spec: StrategySpec }) {
  const [ref, W] = useWidth<HTMLDivElement>()
  const cutoff = spec.session.cutoff_local
  const tick = spec.instrument.tick_size
  const symbol = spec.instrument.symbol
  const bars = barsOf(run.events)
  const { start, end } = sessionWindow(run, cutoff)
  const narrow = W < 520

  const trades = run.state.completed_trades.filter((t) => t.entry_time && t.entry_price !== undefined)
  const blocks = run.events.filter((e) => e.actual_action === 'BLOCK_ENTRY' && typeof e.price === 'number')
  const lock = run.events.find((e) => e.actual_action === 'LOCK_ENTRIES')
  const exitKinds = new Set(trades.flatMap((t) => (t.legs ?? []).map((l) => exitOf(l).kind)))
  const lockWords = run.state.lock_reason ? (LOCK_WORDS[run.state.lock_reason] ?? run.state.lock_reason) : ''

  const summary = [
    `Synthetic 5-minute closes of ${symbol} from ${clock(start)} to ${cutoff}, with the entry and trend moving averages.`,
    trades.length ? `${trades.length} ${trades.length === 1 ? 'trade' : 'trades'}.` : 'No trades.',
    ...trades.map((t, i) => `${tradeSentence(t, i)}.`),
    lock ? `Entries locked at ${clock(minutesOf(lock.timestamp))}${lockWords ? `, ${lockWords}` : ''}.` : '',
    blocks.length
      ? `${blocks.length} entry ${blocks.length === 1 ? 'signal' : 'signals'} blocked: ${blocks.map((b) => `${clock(minutesOf(b.timestamp))} at ${price(b.price!)}`).join(', ')}.`
      : '',
  ]
    .filter(Boolean)
    .join(' ')

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-code font-semibold">Synthetic 5-minute closes (not real market data)</span>
      <StatusPill value="SYNTHETIC" />
    </div>
  )

  if (bars.length < 2) {
    return (
      <div ref={ref} className="flex flex-col gap-3">
        {header}
        <p className="m-0 ta-small ta-muted">This run returned no bar data, so there is no price chart. The decision log below lists every decision.</p>
      </div>
    )
  }

  // ---- scales ----
  const H = narrow ? 260 : 340
  const top = 26
  const bottom = 26
  const L = PLOT.left
  const R = PLOT.right
  const x = (t: number) => L + ((Math.min(end, Math.max(start, t)) - start) / (end - start)) * (W - L - R)
  const half = (b: Bar) => (b.tolerance ?? spec.entry.tolerance_ticks) * tick
  const prices = [
    ...bars.flatMap((b) => [b.close, b.sma15, b.sma5 === null ? null : b.sma5 + half(b), b.sma5 === null ? null : b.sma5 - half(b)]),
    ...trades.flatMap((t) => [t.entry_price, t.stop_price, t.target_price, ...(t.legs ?? []).map((l) => l.exit_price)]),
    ...blocks.map((b) => b.price),
  ].filter((p): p is number => typeof p === 'number')
  const lo0 = Math.min(...prices)
  const hi0 = Math.max(...prices)
  const pad = (hi0 - lo0) * 0.06 || 0.01
  const lo = lo0 - pad
  const hi = hi0 + pad
  const y = (p: number) => top + ((hi - p) / (hi - lo)) * (H - top - bottom)
  const step = niceStep(hi - lo, narrow ? 4 : 6)
  const yTicks: number[] = []
  for (let k = Math.ceil(lo / step); k * step <= hi; k++) yTicks.push(k * step)

  // Hour labels stay clear of the start label and the (wider) cutoff label at the right edge.
  const endLabel = narrow ? cutoff : `${cutoff} cutoff`
  const hours = hourTicks(start, end, narrow ? 2 : 1).filter((t) => x(t) - x(start) > 56 && x(end) - x(t) > endLabel.length * 7 + 24)
  const anchorAt = (cx: number) => (cx > W - R - 44 ? 'end' : cx < L + 44 ? 'start' : 'middle')

  // ---- lock band ----
  const lockX = lock ? x(minutesOf(lock.timestamp)) : null
  const lockLabel = narrow ? 'ENTRIES LOCKED' : `ENTRIES LOCKED${lockWords ? ` · ${lockWords.toUpperCase()}` : ''}`
  const lockFits = lockX !== null && x(end) - lockX > lockLabel.length * 7.6 + 12

  return (
    <div ref={ref} className="flex flex-col gap-3">
      {header}
      <svg className="ta-timeline" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary}>
        {/* Locked period, behind everything else */}
        {lockX !== null && (
          <g>
            <rect x={lockX} y={top - 8} width={Math.max(0, x(end) - lockX)} height={H - top - bottom + 8} fill="var(--blocked-soft)" />
            <text
              x={lockFits ? lockX + 6 : x(end) - 4}
              y={top + 4}
              textAnchor={lockFits ? 'start' : 'end'}
              className="ta-svg-label"
              fill="var(--blocked)"
            >
              {lockFits ? lockLabel : 'ENTRIES LOCKED'}
            </text>
          </g>
        )}

        {/* Price grid and labels */}
        {yTicks.map((p) => (
          <g key={p}>
            <line x1={L} x2={W - R} y1={y(p)} y2={y(p)} stroke="var(--grid)" strokeWidth={1} />
            <text x={L - 6} y={y(p) + 4} textAnchor="end" className="ta-svg-axis" fill="var(--ink-muted)">
              {price(p)}
            </text>
          </g>
        ))}
        <line x1={L} x2={W - R} y1={H - bottom} y2={H - bottom} stroke="var(--line)" strokeWidth={1} />

        {/* Pullback zone, trend SMA, entry SMA, closes */}
        <path d={bandPath(bars, half, x, y)} fill="var(--ledger-soft)" />
        <path d={linePath(bars, (b) => b.sma15, x, y)} fill="none" stroke="var(--ink-muted)" strokeWidth={1.25} strokeDasharray="5 4" />
        <path d={linePath(bars, (b) => b.sma5, x, y)} fill="none" stroke="var(--ledger)" strokeWidth={1.5} />
        <path d={linePath(bars, (b) => b.close, x, y)} fill="none" stroke="var(--ink)" strokeWidth={1.75} strokeLinejoin="round" />

        {/* Trades: stop and target levels for as long as the trade was open, entry dot, one marker per exit leg */}
        {trades.map((t, i) => {
          const x0 = x(minutesOf(t.entry_time!))
          const legs = t.legs ?? []
          const last = legs.length ? x(minutesOf(legs[legs.length - 1].exit_time)) : x0
          const x1 = Math.max(last, x0 + 16)
          const ey = y(t.entry_price!)
          return (
            <g key={t.position_id}>
              <title>{tradeSentence(t, i)}</title>
              {t.stop_price !== undefined && (
                <line x1={x0} x2={x1} y1={y(t.stop_price)} y2={y(t.stop_price)} stroke="var(--blocked)" strokeWidth={2} />
              )}
              {t.target_price !== undefined && (
                <line x1={x0} x2={x1} y1={y(t.target_price)} y2={y(t.target_price)} stroke="var(--compliant)" strokeWidth={2} />
              )}
              <circle cx={x0} cy={ey} r={5.5} fill="var(--ledger)" stroke="var(--panel)" strokeWidth={2} />
              {!narrow && (
                <text x={x0 - 9} y={ey + 4} textAnchor="end" className="ta-svg-label" fill="var(--ledger)" {...halo}>
                  ENTRY
                </text>
              )}
              {legs.map((l, j) => {
                const e = exitOf(l)
                const cx = x(minutesOf(l.exit_time))
                const cy = y(l.exit_price)
                const label = narrow ? e.short : e.word
                const below = e.kind === 'stop'
                return (
                  <g key={j}>
                    {e.kind === 'stop' && (
                      <rect x={cx - 5} y={cy - 5} width={10} height={10} fill="var(--blocked)" stroke="var(--panel)" strokeWidth={1.5} />
                    )}
                    {e.kind === 'target' && <circle cx={cx} cy={cy} r={5.5} fill="var(--panel)" stroke="var(--compliant)" strokeWidth={2.5} />}
                    {e.kind === 'cutoff' && (
                      <path d={`M${cx},${cy - 7}L${cx + 7},${cy}L${cx},${cy + 7}L${cx - 7},${cy}Z`} fill="var(--panel)" stroke="var(--ink)" strokeWidth={2} />
                    )}
                    <text
                      x={cx}
                      y={below ? cy + 19 : cy - 11}
                      textAnchor={anchorAt(cx)}
                      className="ta-svg-label"
                      fill={e.kind === 'stop' ? 'var(--blocked)' : e.kind === 'target' ? 'var(--compliant)' : 'var(--ink)'}
                      {...halo}
                    >
                      {label}
                    </text>
                  </g>
                )
              })}
            </g>
          )
        })}

        {/* Valid signals the risk gate refused */}
        {blocks.map((b) => {
          const cx = x(minutesOf(b.timestamp))
          const cy = y(b.price!)
          return (
            <g key={b.event_id}>
              <title>{`Entry blocked at ${clock(minutesOf(b.timestamp))}, price ${price(b.price!)}: ${b.reason}`}</title>
              <g stroke="var(--blocked)" strokeWidth={2.5} strokeLinecap="round">
                <line x1={cx - 6} y1={cy - 6} x2={cx + 6} y2={cy + 6} />
                <line x1={cx + 6} y1={cy - 6} x2={cx - 6} y2={cy + 6} />
              </g>
              <text x={cx} y={cy - 12} textAnchor={anchorAt(cx)} className="ta-svg-label" fill="var(--blocked)" {...halo}>
                BLOCKED
              </text>
            </g>
          )
        })}

        {/* Time axis */}
        {hours.map((t) => (
          <text key={t} x={x(t)} y={H - 8} textAnchor="middle" className="ta-svg-axis" fill="var(--ink-muted)">
            {clock(t)}
          </text>
        ))}
        <text x={L} y={H - 8} className="ta-svg-axis" fill="var(--ink-muted)">
          {clock(start)}
        </text>
        <text x={W - R} y={H - 8} textAnchor="end" className="ta-svg-axis" fill="var(--ink-muted)">
          {endLabel}
        </text>
      </svg>

      <div className="ta-legend" style={{ padding: 0 }}>
        <span><i style={{ height: 2, background: 'var(--ink)' }} />5-minute close</span>
        <span><i style={{ height: 2, background: 'var(--ledger)' }} />Entry SMA({spec.entry.ma_period}), {spec.timeframes.entry_minutes}m</span>
        <span><i style={{ background: 'var(--ledger-soft)' }} />Pullback zone ±{spec.entry.tolerance_ticks} ticks</span>
        <span><i style={{ height: 0, borderTop: '1.5px dashed var(--ink-muted)' }} />Trend SMA({spec.trend.period}), {spec.timeframes.trend_minutes}m</span>
        {trades.length > 0 && (
          <>
            <span><i style={{ background: 'var(--ledger)', borderRadius: '50%' }} />Entry</span>
            <span><i style={{ height: 2, background: 'var(--blocked)' }} />Stop level</span>
            <span><i style={{ height: 2, background: 'var(--compliant)' }} />Target level ({spec.exit.target_r}R)</span>
          </>
        )}
        {exitKinds.has('stop') && <span><i style={{ background: 'var(--blocked)' }} />Exit at stop</span>}
        {exitKinds.has('target') && <span><i style={{ border: '2.5px solid var(--compliant)', borderRadius: '50%' }} />Exit at target</span>}
        {exitKinds.has('cutoff') && <span><i style={{ border: '2px solid var(--ink)', transform: 'rotate(45deg) scale(0.8)' }} />Exit at the session cutoff</span>}
        {blocks.length > 0 && <span><b className="text-blocked">✕</b> Entry signal blocked by the risk rules</span>}
        {lock && <span><i style={{ background: 'var(--blocked-soft)', outline: '1px solid var(--blocked)' }} />Entries locked</span>}
      </div>

      {trades.length > 0 && (
        <ol className="m-0 flex list-none flex-col gap-1 p-0 text-meta font-mono text-ink-muted">
          {trades.map((t, i) => (
            <li key={t.position_id}>{tradeSentence(t, i)}</li>
          ))}
        </ol>
      )}
    </div>
  )
}
