import { useEffect, useRef, useState } from 'react'
import type { AuditEvent } from '../api'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { StatusPill } from '../components/StatusPill'
import { Term } from '../components/Term'
import type { RunResult } from '../flow/useFlow'
import { hhmm } from '../lib/format'
import { isRoutine } from '../lib/summary'

// ---------- Session timeline ----------
// The API returns no candles, so this draws what the engine did over the session clock, not a price
// chart. Trade spans run from entry to the last exit leg and are coloured by their realized result.

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
  // Start an hour before the first decision that matters (the engine warms up on early candles).
  const firstKey = run.events.filter((e) => !isRoutine(e) && e.category !== 'SESSION').map((e) => minutes(e.timestamp))
  const start = Math.min(9 * 60 + 30, firstKey.length ? Math.floor(Math.min(...firstKey) / 60) * 60 - 60 : 9 * 60 + 30)
  const x = (t: number) => L + ((Math.max(start, t) - start) / (end - start)) * (W - L - R)

  const spans = run.state.completed_trades
    .filter((t) => t.entry_time && t.legs?.length)
    .map((t) => ({
      from: minutes(t.entry_time!),
      to: minutes(t.legs![t.legs!.length - 1].exit_time),
      pnl: t.realized_pnl_usd,
    }))
  const lock = run.events.find((e) => e.actual_action === 'LOCK_ENTRIES')
  const hours = Array.from({ length: Math.floor((end - start) / 60) + 1 }, (_, i) => Math.ceil(start / 60) * 60 + i * 60).filter(
    (t) => t > start && t < end,
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
            case 'EXIT_STOP':
              return <rect key={k} x={cx - 5} y={axisY - 5} width={10} height={10} fill="var(--blocked)" stroke="var(--panel)" strokeWidth={1.5} />
            case 'EXIT_PARTIAL':
            case 'EXIT_CUTOFF':
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
              // ~75 routine checks per session: faint ticks, so they read as texture, not events.
              return <line key={k} x1={cx} x2={cx} y1={axisY - 5} y2={axisY + 5} stroke="var(--ink-muted)" strokeWidth={1} opacity={0.35} />
            default:
              return null
          }
        })}
        {hours.map((t, i) =>
          i % step === 0 && x(t) - x(start) > 44 && x(end) - x(t) > 44 ? (
            <text key={t} x={x(t)} y={H - 8} textAnchor="middle" className="ta-svg-axis" fill="var(--ink-muted)">
              {`${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`}
            </text>
          ) : null,
        )}
        <text x={L} y={H - 8} className="ta-svg-axis" fill="var(--ink-muted)">
          {`${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}`}
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

