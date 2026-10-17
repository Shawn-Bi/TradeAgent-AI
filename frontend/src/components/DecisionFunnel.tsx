import type { AuditEvent } from '../api'
import { cn } from '@/lib/utils'
import { decisionFunnel } from '../lib/summary'
import { Card } from './Layout'

/**
 * Every completed 5m bar runs the same gates in order: trend, pullback, risk gate, fill.
 * Each stage is a bar sized by how many bar decisions reached it; what fell out is named under it.
 */
export function DecisionFunnel({ events }: { events: AuditEvent[] }) {
  const stages = decisionFunnel(events)
  const max = Math.max(1, stages[0].count)
  const last = stages.length - 1

  return (
    <Card
      title="What the engine refused, and why"
      right={<span className="text-code text-ink-muted">{stages[0].count} bar decisions</span>}
    >
      <div className="flex flex-col gap-3 p-4">
        <ol className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Decision funnel, one stage per rule the engine checks">
          {stages.map((s, i) => (
            <li key={s.label} className="flex flex-col gap-1">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[9.5rem_minmax(0,1fr)_3rem]">
                <span className="text-code">{s.label}</span>
                <span className="order-last col-span-2 h-3 rounded-sm border border-line bg-ground sm:order-none sm:col-span-1" aria-hidden="true">
                  <span
                    className={cn('block h-full rounded-sm', i === last ? 'bg-ledger' : 'bg-ink-muted')}
                    style={{ width: s.count ? `max(2px, ${(s.count / max) * 100}%)` : 0 }}
                  />
                </span>
                <span className="text-right font-mono text-code tabular-nums">{s.count}</span>
              </div>
              {s.drops.length > 0 && (
                <ul className="m-0 flex list-none flex-col gap-0.5 p-0 sm:pl-[10.25rem]" aria-label={`Stopped after ${s.label}`}>
                  {s.drops.map((d) => (
                    <li key={d.label} className={cn('text-meta', d.blocked ? 'font-medium text-blocked' : 'text-ink-muted')}>
                      <span aria-hidden="true">↳ </span>
                      <span className="font-mono tabular-nums">{d.count}</span> {d.label}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
        <p className="m-0 text-meta text-ink-muted">
          Counts are the engine’s decisions on synthetic bars, in the order it checks your rules. A refused entry is the rules
          working; it says nothing about whether that trade would have made or lost money.
        </p>
      </div>
    </Card>
  )
}
