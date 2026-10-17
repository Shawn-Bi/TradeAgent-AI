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
  LOCKED: 'blocked',
  ALLOWED: 'compliant',
  COMPLIANT: 'compliant',
  VIOLATION: 'blocked',
  SYNTHETIC: 'synthetic',
}

/** One uppercase constant, coloured by meaning. Pass `tone` only for labels outside the table above. */
export function StatusPill({ value, tone }: { value: string; tone?: PillTone }) {
  return <span className={`ta-pill ta-pill--${tone ?? toneFor[value] ?? 'neutral'}`}>{value}</span>
}
