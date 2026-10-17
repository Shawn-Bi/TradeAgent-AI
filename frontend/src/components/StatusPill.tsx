import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { explain } from '@/lib/glossary'

export type PillTone = 'draft' | 'approved' | 'compliant' | 'blocked' | 'neutral' | 'synthetic'

const toneFor: Record<string, PillTone> = {
  DRAFT: 'draft',
  OPEN: 'draft',
  APPROVED: 'approved',
  ANSWERED: 'compliant',
  COMPLETED: 'neutral',
  CONNECTED: 'compliant',
  LOCAL_ONLY: 'neutral',
  BLOCK_ENTRY: 'blocked',
  TWO_CONSECUTIVE_LOSSES: 'blocked',
  LOCKED: 'blocked',
  ALLOWED: 'compliant',
  COMPLIANT: 'compliant',
  VIOLATION: 'blocked',
  SYNTHETIC: 'synthetic',
}

/** One uppercase constant, coloured by meaning. Constants with a glossary entry explain themselves on hover. */
export function StatusPill({ value, tone }: { value: string; tone?: PillTone }) {
  const badge = <Badge variant={tone ?? toneFor[value] ?? 'neutral'}>{value}</Badge>
  const text = explain(value)
  if (!text) return badge
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex cursor-help rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {badge}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-72">{text}</TooltipContent>
    </Tooltip>
  )
}
