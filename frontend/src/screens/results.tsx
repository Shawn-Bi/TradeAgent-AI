import { useState } from 'react'
import type { AuditEvent } from '../api'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { StatusPill } from '../components/StatusPill'
import { Term } from '../components/Term'
import type { RunResult } from '../flow/useFlow'
import { clock, minutesOf, PLOT, sessionWindow, useWidth } from '../lib/chart'
import { hhmm } from '../lib/format'
import { isRoutine } from '../lib/summary'

// ---------- Trade strip ----------
// A thin strip under the price chart, on the same time axis (lib/chart): when a position was open and how
// each trade closed, in words. The chart above carries the prices, every bar check and the exit markers.

const outcome = (pnl: number) =>
  pnl > 0
    ? { word: 'PROFIT', fill: 'var(--ledger)' }
    : pnl < 0
      ? { word: 'LOSS', fill: 'var(--blocked)' }
      : { word: 'FLAT', fill: 'var(--ink-muted)' }

/** Labels go above the bar; one that would touch the previous label above drops below instead. */
function placeLabels(centres: number[]) {
  let lastAbove = -Infinity
  return centres.map((cx) => {
    const above = cx - lastAbove > 52
    if (above) lastAbove = cx
    return { cx, above }
  })
}

export function SessionTimeline({ run, cutoff }: { run: RunResult; cutoff: string }) {
  const [ref, W] = useWidth<HTMLDivElement>()
  const { start, end } = sessionWindow(run, cutoff)
  const L = PLOT.left
  const R = PLOT.right
  const H = 46
  const axisY = 24
  const x = (t: number) => L + ((Math.min(end, Math.max(start, t)) - start) / (end - start)) * (W - L - R)

  const spans = run.state.completed_trades
    .filter((t) => t.entry_time && t.legs?.length)
    .map((t) => ({ from: minutesOf(t.entry_time!), to: minutesOf(t.legs![t.legs!.length - 1].exit_time), pnl: t.realized_pnl_usd }))
  const lock = run.events.find((e) => e.actual_action === 'LOCK_ENTRIES')
  const blocks = run.events.filter((e) => e.actual_action === 'BLOCK_ENTRY')
  const labels = placeLabels(spans.map((s) => (x(s.from) + Math.max(x(s.to), x(s.from) + 3)) / 2))
  const anchor = (cx: number) => (cx > W - R - 26 ? 'end' : cx < L + 26 ? 'start' : 'middle')
  const description =
    (spans.length
      ? `In a trade ${spans.length} ${spans.length === 1 ? 'time' : 'times'}: ${spans
          .map((s) => `${clock(s.from)} to ${clock(s.to)} ${s.pnl > 0 ? 'closed at a profit' : s.pnl < 0 ? 'closed at a loss' : 'closed flat'}`)
          .join('; ')}.`
      : 'No position was opened this session.') +
    (lock ? ` Entries locked from ${clock(minutesOf(lock.timestamp))}.` : '') +
    (blocks.length ? ` ${blocks.length} blocked entry ${blocks.length === 1 ? 'signal' : 'signals'}.` : '')

  return (
    <div ref={ref} className="flex flex-col gap-1">
      <span className="ta-label">Time in a trade</span>
      <svg className="ta-timeline" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={description}>
        {lock && (
          <rect x={x(minutesOf(lock.timestamp))} y={0} width={Math.max(0, x(end) - x(minutesOf(lock.timestamp)))} height={H} fill="var(--blocked-soft)" />
        )}
        <line x1={L} x2={W - R} y1={axisY} y2={axisY} stroke="var(--line)" strokeWidth={2} />
        {spans.map((s, i) => {
          const o = outcome(s.pnl)
          const { cx, above } = labels[i]
          return (
            <g key={i}>
              <rect x={x(s.from)} y={axisY - 5} width={Math.max(3, x(s.to) - x(s.from))} height={10} rx={2} fill={o.fill} />
              <text x={cx} y={above ? axisY - 10 : axisY + 19} textAnchor={anchor(cx)} className="ta-svg-label" fill={o.fill}>
                {o.word}
              </text>
            </g>
          )
        })}
        {blocks.map((e) => {
          const cx = x(minutesOf(e.timestamp))
          return (
            <g key={e.event_id} stroke="var(--blocked)" strokeWidth={2} strokeLinecap="round">
              <line x1={cx - 4} y1={axisY - 4} x2={cx + 4} y2={axisY + 4} />
              <line x1={cx + 4} y1={axisY - 4} x2={cx - 4} y2={axisY + 4} />
            </g>
          )
        })}
      </svg>
      <div className="ta-legend" style={{ padding: 0 }}>
        {spans.length === 0 && <span>No position was opened this session.</span>}
        {spans.some((s) => s.pnl > 0) && <span><i style={{ background: 'var(--ledger)' }} />PROFIT: closed at a profit</span>}
        {spans.some((s) => s.pnl < 0) && <span><i style={{ background: 'var(--blocked)' }} />LOSS: closed at a loss</span>}
        {spans.some((s) => s.pnl === 0) && <span><i style={{ background: 'var(--ink-muted)' }} />FLAT: closed at break-even</span>}
        {blocks.length > 0 && <span><b className="text-blocked">✕</b> Entry blocked</span>}
        {lock && <span><i style={{ background: 'var(--blocked-soft)', outline: '1px solid var(--blocked)' }} />Entries locked</span>}
      </div>
    </div>
  )
}

// ---------- Decision log: a table when wide, cards on phones ----------

function Result({ e }: { e: AuditEvent }) {
  return <StatusPill value={e.compliant ? 'COMPLIANT' : 'VIOLATION'} />
}

export function DecisionLog({ events: all }: { events: AuditEvent[] }) {
  const [showRoutine, setShowRoutine] = useState(false)
  const routine = all.filter(isRoutine).length
  const events = showRoutine ? all : all.filter((e) => !isRoutine(e))
  if (all.length === 0)
    return <div className="ta-card__body ta-small ta-muted">No decisions were logged in this session.</div>
  return (
    <>
      {routine > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-b border-grid px-4 py-2 ta-small ta-muted">
          <span>
            {showRoutine
              ? `Showing all ${all.length} decisions.`
              : `Showing ${events.length} key decisions. ${routine} routine checks (rule not met, so no trade) are hidden.`}
          </span>
          <Button variant="link" className="h-auto px-0" onClick={() => setShowRoutine((v) => !v)}>
            {showRoutine ? 'Hide routine checks' : 'Show routine checks'}
          </Button>
        </div>
      )}
      <div className="ta-only-wide">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Seq</TableHead>
              <TableHead>Time</TableHead>
              <TableHead>Rule</TableHead>
              <TableHead>Expected</TableHead>
              <TableHead>Actual</TableHead>
              <TableHead>Result</TableHead>
              <TableHead>Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((e) => (
              <TableRow key={e.event_id} className={e.actual_action === 'BLOCK_ENTRY' ? 'bg-blocked-soft hover:bg-blocked-soft' : undefined}>
                <TableCell className="font-mono">{e.seq}</TableCell>
                <TableCell className="font-mono">{hhmm(e.timestamp)}</TableCell>
                <TableCell className="font-mono">{e.rule_id}</TableCell>
                <TableCell className="font-mono">
                  <Term term={e.expected_action} />
                </TableCell>
                <TableCell className="font-mono">
                  <Term term={e.actual_action} />
                </TableCell>
                <TableCell>
                  <Result e={e} />
                </TableCell>
                <TableCell className="min-w-56 whitespace-normal">{e.reason}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className="ta-only-narrow ta-rowcards">
        {events.map((e) => (
          <li key={e.event_id} className={e.actual_action === 'BLOCK_ENTRY' ? 'is-blocked' : undefined}>
            <div className="ta-row justify-between">
              <span className="ta-mono text-meta ta-muted">
                {e.seq} · {hhmm(e.timestamp)} · {e.rule_id}
              </span>
              <Result e={e} />
            </div>
            <span>{e.reason}</span>
            <span className="ta-mono text-meta ta-muted">
              expected <Term term={e.expected_action} /> · actual <Term term={e.actual_action} />
            </span>
          </li>
        ))}
      </ul>
    </>
  )
}

export function Kpi({ label, value, tone, alert }: { label: string; value: React.ReactNode; tone?: 'neg'; alert?: boolean }) {
  return (
    <div className={`ta-kpi ${alert ? 'ta-kpi--alert' : ''}`}>
      <span className="ta-label">{label}</span>
      <span className={`v ${tone === 'neg' ? 'ta-neg' : ''}`}>{value}</span>
    </div>
  )
}

