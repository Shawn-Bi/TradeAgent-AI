// The contract's `warnings: string[]` carries the free-text interpretation, using a prefix per line.
// PROVISIONAL convention proposed to B (no schema change):
//   "APPLIED · <user's sentence> · <what it changed>"
//   "NOT_APPLIED · <user's sentence> · <why>"
//   "PRESET_FALLBACK · <explanation>"   strategy written by the built-in preset, no AI model call
//   anything else                       a general note

export type WarningKind = 'APPLIED' | 'NOT_APPLIED' | 'PRESET_FALLBACK' | 'NOTE'

export interface ParsedWarning {
  kind: WarningKind
  quote: string | null
  detail: string
}

const KINDS: WarningKind[] = ['APPLIED', 'NOT_APPLIED', 'PRESET_FALLBACK']

export function parseWarning(raw: string): ParsedWarning {
  const parts = raw.split(' · ')
  const kind = KINDS.find((k) => parts[0] === k)
  if (!kind) return { kind: 'NOTE', quote: null, detail: raw }
  if (kind === 'PRESET_FALLBACK') return { kind, quote: null, detail: parts.slice(1).join(' · ') }
  return { kind, quote: parts[1] ?? null, detail: parts.slice(2).join(' · ') }
}
