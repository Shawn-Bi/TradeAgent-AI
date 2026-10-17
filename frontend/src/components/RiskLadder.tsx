import { useEffect, useRef, useState } from 'react'
import type { CompletedTrade } from '../api'
import { signedUsd, usd } from '../lib/format'
import { signedR, tradeR, type TradeR } from '../lib/summary'

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(600)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.round(entry.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

const H = 76
const AXIS = 30
const PAD = 14

function Ladder({ id, r, lo, hi, targetR }: { id: string; r: TradeR; lo: number; hi: number; targetR: number }) {
  const [ref, W] = useWidth<HTMLDivElement>()
  const x = (v: number) => PAD + ((v - lo) / (hi - lo)) * (W - 2 * PAD)
  const anchor = (px: number) => (px < 48 ? 'start' : px > W - 48 ? 'end' : 'middle')

  // Leg labels sit under their marker; a leg too close to the previous one drops to a second line.
  const legs = [...r.legs]
    .sort((a, b) => a.r - b.r)
    .reduce<(TradeR['legs'][number] & { label: string; px: number; row: number; y: number })[]>((acc, l) => {
      const px = x(l.r)
      const label = `${l.contracts}× ${l.word.toUpperCase()}`
      const before = acc.at(-1)
      // Labels are ~7px per character in the label type; stagger when two would touch.
      const clash = before && px - before.px < ((before.label.length + label.length) / 2) * 7 + 12
      const row = before && clash ? 1 - before.row : 0
      return [...acc, { ...l, label, px, row, y: AXIS + 18 + row * 12 }]
    }, [])

  const ticks = [
    { v: -1, label: '−1R stop' },
    { v: 0, label: '0R' },
    { v: targetR, label: `+${targetR}R target` },
  ]
  const legText = r.legs
    .map((l) => `${l.contracts} contract${l.contracts === 1 ? '' : 's'} at ${l.word}, ${signedR(l.r)} (${signedUsd(l.pnl)})`)
    .join('; ')

  return (
    <div ref={ref}>
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        className="block"
        role="img"
        aria-label={`${id}: realised ${signedR(r.realized)}. Exit legs: ${legText}. Scale from −1R at the stop to +${targetR}R at the first target.`}
      >
        <line x1={PAD} x2={W - PAD} y1={AXIS} y2={AXIS} stroke="var(--line)" strokeWidth={2} />
        {ticks.map((t) => (
          <g key={t.v}>
            <line x1={x(t.v)} x2={x(t.v)} y1={AXIS - 6} y2={AXIS + 6} stroke="var(--control-border)" strokeWidth={1} />
            <text x={x(t.v)} y={H - 4} textAnchor={anchor(x(t.v))} className="ta-svg-axis" fill="var(--ink-muted)">
              {t.label}
            </text>
          </g>
        ))}
        <line x1={x(r.realized)} x2={x(r.realized)} y1={AXIS - 14} y2={AXIS + 7} stroke="var(--ink)" strokeWidth={2.5} />
        {legs.map((l, i) =>
          l.word === 'stop' ? (
            <g key={i}>
              <rect x={l.px - 5} y={AXIS - 5} width={10} height={10} fill="var(--blocked)" stroke="var(--panel)" strokeWidth={1.5} />
              <text x={l.px} y={l.y} textAnchor={anchor(l.px)} className="ta-svg-label" fill="var(--blocked)">
                {l.label}
              </text>
            </g>
          ) : (
            <g key={i}>
              <circle cx={l.px} cy={AXIS} r={5.5} fill="var(--panel)" stroke="var(--compliant)" strokeWidth={2.5} />
              <text x={l.px} y={l.y} textAnchor={anchor(l.px)} className="ta-svg-label" fill="var(--compliant)">
                {l.label}
              </text>
            </g>
          ),
        )}
        <text x={x(r.realized)} y={11} textAnchor={anchor(x(r.realized))} className="ta-svg-label" fill="var(--ink)">
          {`${signedR(r.realized)} REALISED`}
        </text>
      </svg>
    </div>
  )
}

/**
 * Each completed trade on its own scale of initial risk (R): −1R is the stop, +target R the first target.
 * Per trade only, never an average, expectancy or win rate.
 */
export function RiskLadder({ trades, tickValueUsd, targetR }: { trades: CompletedTrade[]; tickValueUsd: number; targetR: number }) {
  const rows = trades.map((t) => ({ t, r: tradeR(t, tickValueUsd) })).filter((x): x is { t: CompletedTrade; r: TradeR } => x.r !== null)
  if (!rows.length) return null
  // One shared scale per session so trades can be compared by eye; widened if a leg ran past the target.
  const values = rows.flatMap(({ r }) => [r.realized, ...r.legs.map((l) => l.r)])
  const lo = Math.min(-1, ...values) - 0.15
  const hi = Math.max(targetR, ...values) + 0.15

  return (
    <section className="flex flex-col gap-3 border-t border-line p-4" aria-labelledby="r-ladder-title">
      <div className="flex flex-col gap-1">
        <h4 id="r-ladder-title" className="m-0 text-code font-semibold">
          Each trade in R (its own initial risk)
        </h4>
        <p className="m-0 text-meta text-ink-muted">
          1R is what a trade loses if its stop is hit. The scale runs from −1R at the stop to +{targetR}R at the first
          target; markers show where each exit leg landed. Synthetic session, one trade at a time: not an average and not a
          win rate.
        </p>
      </div>
      <ul className="m-0 flex list-none flex-col gap-4 p-0">
        {rows.map(({ t, r }) => (
          <li key={t.position_id} className="flex flex-col gap-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <span className="font-mono text-code">
                {t.position_id} · 1R = {usd(r.oneR)}
                <span className="block text-meta text-ink-muted sm:inline sm:text-code">
                  {' '}
                  ({t.initial_risk_ticks} ticks × {usd(tickValueUsd)} × {t.quantity_contracts ?? r.legs.reduce((n, l) => n + l.contracts, 0)})
                </span>
              </span>
              <span className={`font-mono text-code ${t.realized_pnl_usd < 0 ? 'text-blocked' : ''}`}>
                {signedR(r.realized)} · {signedUsd(t.realized_pnl_usd)}
              </span>
            </div>
            <Ladder id={t.position_id} r={r} lo={lo} hi={hi} targetR={targetR} />
          </li>
        ))}
      </ul>
    </section>
  )
}
