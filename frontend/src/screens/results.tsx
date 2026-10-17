import { useEffect, useRef, useState } from 'react'
import type { AuditEvent } from '../api'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { StatusPill } from '../components/StatusPill'
import { Term } from '../components/Term'
import type { RunResult } from '../flow/useFlow'
import { hhmm } from '../lib/format'

// ---------- Session timeline ----------
// The contract has no candle data, so this draws what the engine did over the session clock,
// not a price chart. Trade spans are coloured by their realized result.

const SESSION_START = 9 * 60 + 30
const minutes = (ts: string) => {
  const [h, m] = hhmm(ts).split(':').map(Number)
  return h * 60 + m
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(760)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(300, Math.round(entry.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

export function SessionTimeline({ run, cutoff }: { run: RunResult; cutoff: string }) {
  const [ref, W] = useWidth<HTMLDivElement>()
  const [ch, cm] = cutoff.split(':').map(Number)
  const end = ch * 60 + cm
  const L = 16
  const R = 16
  const H = 132
  const axisY = 70
  const x = (t: number) => L + ((t - SESSION_START) / (end - SESSION_START)) * (W - L - R)

  // Pair entries with the exit that flattens them; partial exits are drawn on the span.
  const spans: { from: number; to: number; pnl: number }[] = []
  let open: number | null = null
  for (const e of run.events) {
    if (e.actual_action === 'OPEN_LONG') open = minutes(e.timestamp)
    if ((e.actual_action === 'EXIT_ALL' || e.actual_action === 'EXIT_REMAINDER') && open !== null) {
      const trade = run.state.completed_trades[spans.length]
      spans.push({ from: open, to: minutes(e.timestamp), pnl: trade?.realized_pnl_usd ?? 0 })
      open = null
    }
  }
  const lock = run.events.find((e) => e.actual_action === 'LOCK_ENTRIES')
  const hours = Array.from({ length: Math.floor((end - SESSION_START) / 60) + 1 }, (_, i) => SESSION_START + 30 + i * 60).filter(
    (t) => t < end,
  )
  const step = W < 520 ? 2 : 1

  return (
    <div ref={ref}>
      <svg
        className="ta-timeline"
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Session timeline of entries, exits, the loss lock and blocked entries"
      >
        {lock && (
          <g>
            <rect x={x(minutes(lock.timestamp))} y={22} width={x(end) - x(minutes(lock.timestamp))} height={78} fill="var(--blocked-soft)" />
            <text x={x(minutes(lock.timestamp)) + 6} y={36} className="ta-svg-label" fill="var(--blocked)">
              ENTRIES LOCKED
            </text>
          </g>
        )}
        <line x1={L} x2={W - R} y1={axisY} y2={axisY} stroke="var(--line)" strokeWidth="2" />
        {spans.map((s, i) => (
          <rect
            key={i}
            x={x(s.from)}
            y={axisY - 4}
            width={Math.max(2, x(s.to) - x(s.from))}
            height={8}
            rx={2}
            fill={s.pnl < 0 ? 'var(--blocked)' : 'var(--ledger)'}
            opacity={0.85}
          />
        ))}
        {run.events.map((e) => {
          const cx = x(minutes(e.timestamp))
          const k = e.event_id
          switch (e.actual_action) {
            case 'OPEN_LONG':
              return <circle key={k} cx={cx} cy={axisY} r={6} fill="var(--ledger)" stroke="var(--panel)" strokeWidth={2} />
            case 'EXIT_ALL':
              return <rect key={k} x={cx - 5} y={axisY - 5} width={10} height={10} fill="var(--blocked)" stroke="var(--panel)" strokeWidth={1.5} />
            case 'EXIT_PARTIAL':
            case 'EXIT_REMAINDER':
              return <circle key={k} cx={cx} cy={axisY} r={6} fill="var(--panel)" stroke="var(--compliant)" strokeWidth={2.5} />
            case 'BLOCK_ENTRY':
              return (
                <g key={k} stroke="var(--blocked)" strokeWidth={2.5}>
                  <line x1={cx - 6} y1={axisY - 6} x2={cx + 6} y2={axisY + 6} />
                  <line x1={cx + 6} y1={axisY - 6} x2={cx - 6} y2={axisY + 6} />
                  <text x={cx} y={axisY + 24} textAnchor="middle" className="ta-svg-label" fill="var(--blocked)" stroke="none">
                    BLOCKED
                  </text>
                </g>
              )
            case 'NO_TRADE':
              return <line key={k} x1={cx} x2={cx} y1={axisY - 8} y2={axisY + 8} stroke="var(--ink-muted)" strokeWidth={1.5} />
            default:
              return null
          }
        })}
        {hours.map((t, i) =>
          i % step === 0 && x(t) - x(SESSION_START) > 44 && x(end) - x(t) > 44 ? (
            <text key={t} x={x(t)} y={H - 8} textAnchor="middle" className="ta-svg-axis" fill="var(--ink-muted)">
              {`${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`}
            </text>
          ) : null,
        )}
        <text x={L} y={H - 8} className="ta-svg-axis" fill="var(--ink-muted)">
          09:30
        </text>
        <text x={W - R} y={H - 8} textAnchor="end" className="ta-svg-axis" fill="var(--ink-muted)">
          {cutoff}
        </text>
      </svg>
      <div className="ta-legend">
        <span><i style={{ background: 'var(--ledger)', borderRadius: '50%' }} />Entry</span>
        <span><i style={{ background: 'var(--blocked)' }} />Stopped out</span>
        <span><i style={{ border: '2.5px solid var(--compliant)', borderRadius: '50%' }} />Profit or cutoff exit</span>
        <span><i style={{ background: 'var(--ink-muted)', width: 2 }} />No trade (rule not met)</span>
        <span><b className="text-blocked">✕</b> Entry blocked</span>
        <span>Bars: time in a trade, green = win, orange = loss</span>
      </div>
    </div>
  )
}

// ---------- Decision log: a table when wide, cards on phones ----------

function Result({ e }: { e: AuditEvent }) {
  return <StatusPill value={e.compliant ? 'COMPLIANT' : 'VIOLATION'} />
}

export function DecisionLog({ events }: { events: AuditEvent[] }) {
  if (events.length === 0)
    return <div className="ta-card__body ta-small ta-muted">No decisions were logged in this session.</div>
  return (
    <>
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

