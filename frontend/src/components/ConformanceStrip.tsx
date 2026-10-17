import { useId, useState, type KeyboardEvent } from 'react'
import type { AuditEvent } from '../api'
import { cn } from '@/lib/utils'
import { hhmm } from '../lib/format'

const describe = (e: AuditEvent) =>
  `#${e.seq} · ${hhmm(e.timestamp)} · ${e.rule_id} · expected ${e.expected_action} → actual ${e.actual_action} · ${
    e.compliant ? 'compliant' : 'violation'
  }`

/**
 * One square per checked decision, in the order the engine made them: blue = compliant, orange = violation.
 * Hover a square, or focus the strip and use the arrow keys, to read that decision.
 */
export function ConformanceStrip({ events }: { events: AuditEvent[] }) {
  const checked = events.filter((e) => e.eligible !== false).sort((a, b) => a.seq - b.seq)
  const [active, setActive] = useState<number | null>(null)
  const summaryId = useId()
  if (!checked.length) return null

  const bad = checked.filter((e) => !e.compliant)
  const current = active === null ? null : checked[active]
  const move = (ev: KeyboardEvent) => {
    const last = checked.length - 1
    const at = active ?? -1
    const next =
      ev.key === 'ArrowRight' || ev.key === 'ArrowDown'
        ? Math.min(last, at + 1)
        : ev.key === 'ArrowLeft' || ev.key === 'ArrowUp'
          ? Math.max(0, at === -1 ? 0 : at - 1)
          : ev.key === 'Home'
            ? 0
            : ev.key === 'End'
              ? last
              : null
    if (next === null) return
    ev.preventDefault()
    setActive(next)
  }

  return (
    <div className="flex flex-col gap-2">
      <p id={summaryId} className="m-0 text-meta text-ink-muted">
        {checked.length} decisions in order: {checked.length - bad.length} compliant, {bad.length}{' '}
        {bad.length === 1 ? 'violation' : 'violations'}
        {bad.length > 0 && ` (decision ${bad.map((e) => `#${e.seq}`).join(', ')})`}.
      </p>
      <div
        role="group"
        tabIndex={0}
        aria-label="Every checked decision in order. Use the arrow keys to read one."
        aria-describedby={summaryId}
        onKeyDown={move}
        onBlur={() => setActive(null)}
        onMouseLeave={() => setActive(null)}
        className="flex flex-wrap gap-0.5 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-panel"
      >
        {checked.map((e, i) => (
          <span
            key={e.event_id}
            title={describe(e)}
            aria-hidden="true"
            onMouseEnter={() => setActive(i)}
            className={cn(
              'size-2 rounded-[1px]',
              e.compliant ? 'bg-compliant' : 'bg-blocked',
              i === active && 'outline-2 outline-offset-1 outline-ink',
            )}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-meta text-ink-muted">
        <span className="flex flex-wrap gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1">
            <i className="inline-block size-2 rounded-[1px] bg-compliant" aria-hidden="true" />
            compliant
          </span>
          <span className="inline-flex items-center gap-1">
            <i className="inline-block size-2 rounded-[1px] bg-blocked" aria-hidden="true" />
            violation
          </span>
        </span>
        <span>first decision → last</span>
      </div>
      <p className="m-0 min-h-5 font-mono text-meta break-words" aria-live="polite">
        {current ? describe(current) : <span className="text-ink-muted">Hover or focus a square to read that decision.</span>}
      </p>
    </div>
  )
}
