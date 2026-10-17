import type { Scenario } from '../api'
import { cn } from '@/lib/utils'
import { StatusPill } from './StatusPill'

// What the engine did in one synthetic scenario, counted from the API: entries opened, entries the risk
// gate blocked, trades completed, and whether entries ended up locked. One pip per event, so the counts
// read at a glance; the number next to each row is the text alternative. Nothing here is price data.

const MAX_PIPS = 8

const rows = [
  { key: 'entries', label: 'Entries opened', pip: 'bg-compliant border-compliant' },
  { key: 'blocked_entries', label: 'Entries blocked', pip: 'bg-blocked border-blocked' },
  { key: 'completed_trades', label: 'Trades completed', pip: 'bg-ink-muted border-ink-muted' },
] as const

function Pips({ n, className }: { n: number; className: string }) {
  if (n === 0) return <span className="size-3 rounded-sm border border-dashed border-control-border" />
  return (
    <>
      {Array.from({ length: Math.min(n, MAX_PIPS) }, (_, i) => (
        <span key={i} className={cn('size-3 rounded-sm border', className)} />
      ))}
      {n > MAX_PIPS && <span className="font-mono text-meta text-ink-muted">+{n - MAX_PIPS}</span>}
    </>
  )
}

export function ScenarioGlyph({ s }: { s: Scenario }) {
  const reported = rows.some((r) => s[r.key] !== undefined)
  if (!reported && s.entry_locked === undefined)
    return <span className="text-code text-ink-muted">The engine did not report entry counts for this scenario.</span>

  return (
    <div className="flex flex-col gap-2 rounded-md border border-line bg-ground p-3">
      <span className="ta-label">What the engine did · synthetic</span>
      <dl className="m-0 grid grid-cols-[auto_2ch_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5">
        {rows.map((r) => {
          const v = s[r.key]
          return (
            <div key={r.key} className="contents">
              <dt className="text-code text-ink-muted">{r.label}</dt>
              <dd className="m-0 text-right font-mono text-code text-ink">
                {v ?? '–'}
                {v === undefined && <span className="sr-only">not reported</span>}
              </dd>
              <dd className="m-0 flex flex-wrap items-center gap-1" aria-hidden="true">
                {v !== undefined && <Pips n={v} className={r.pip} />}
              </dd>
            </div>
          )
        })}
      </dl>
      {s.entry_locked !== undefined && (
        <div className="flex flex-wrap items-center gap-2 border-t border-grid pt-2 text-code text-ink-muted">
          <span>Risk lock</span>
          {s.entry_locked ? (
            <>
              <StatusPill value="LOCKED" />
              {s.lock_reason && <StatusPill value={s.lock_reason} tone="blocked" />}
            </>
          ) : (
            <StatusPill value="NOT TRIGGERED" tone="neutral" />
          )}
        </div>
      )}
    </div>
  )
}
