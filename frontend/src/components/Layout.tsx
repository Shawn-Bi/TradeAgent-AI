import type { ReactNode } from 'react'
import { CircleAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card as UiCard } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export function StepHead({ title, sub, right }: { title: string; sub: ReactNode; right?: ReactNode }) {
  return (
    <div className="ta-step-head">
      <div>
        <h2>{title}</h2>
        <p>{sub}</p>
      </div>
      {right}
    </div>
  )
}

const headTone = {
  draft: 'bg-marker-soft',
  approved: 'bg-ledger-soft',
  locked: 'bg-blocked-soft text-blocked',
}

/** A design-system panel on the shadcn Card: hairline border, tinted header by state. */
export function Card({
  title,
  right,
  tone,
  children,
  className,
}: {
  title?: ReactNode
  right?: ReactNode
  tone?: 'draft' | 'approved' | 'locked'
  children: ReactNode
  className?: string
}) {
  return (
    <UiCard className={cn('gap-0 py-0', tone === 'locked' && 'border-blocked', className)}>
      {title !== undefined && (
        <div className={cn('flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3', tone && headTone[tone])}>
          <h3 className="m-0 text-heading">{title}</h3>
          {right}
        </div>
      )}
      {children}
    </UiCard>
  )
}

export function Nav({ back, children }: { back?: () => void; children?: ReactNode }) {
  return (
    <div className="ta-nav">
      {back ? (
        <Button variant="outline" onClick={back}>
          Back
        </Button>
      ) : (
        <span />
      )}
      <div className="ta-row">{children}</div>
    </div>
  )
}

/** Loading: the step name and a static "Working…" label over skeleton lines, never a spinner alone. */
export function Working({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-3 p-4" role="status">
      <span className="text-code text-ink-muted">{label} · Working…</span>
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  )
}

/** Errors say what happened and what to do next. */
export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const offline = message.includes('NETWORK_ERROR')
  return (
    <Alert variant="destructive" className="border-blocked bg-blocked-soft">
      <CircleAlert />
      <AlertTitle>{offline ? 'Can’t reach the backend' : 'That didn’t work'}</AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        <span>{message}</span>
        <span>
          {offline
            ? 'Start the backend on port 8000, or set VITE_API_MODE=mock to use the built-in demo data. Nothing was changed.'
            : 'Nothing was changed. Try again, or go back and adjust your rules.'}
        </span>
        {onRetry && (
          <span>
            <Button variant="outline" onClick={onRetry}>
              Try again
            </Button>
          </span>
        )}
      </AlertDescription>
    </Alert>
  )
}
