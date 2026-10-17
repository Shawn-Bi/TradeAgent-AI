export type PillTone = 'draft' | 'approved' | 'compliant' | 'blocked' | 'neutral' | 'synthetic'

const toneFor: Record<string, PillTone> = {
  DRAFT: 'draft',
  APPROVED: 'approved',
  COMPLETED: 'neutral',
  CONNECTED: 'compliant',
  LOCAL_ONLY: 'neutral',
  BLOCK_ENTRY: 'blocked',
  SYNTHETIC: 'synthetic',
}

/** One uppercase API constant, coloured by meaning. Pass `tone` only for labels like "Compliant". */
export function StatusPill({ value, tone }: { value: string; tone?: PillTone }) {
  return <span className={`ta-pill ta-pill--${tone ?? toneFor[value] ?? 'neutral'}`}>{value}</span>
}
