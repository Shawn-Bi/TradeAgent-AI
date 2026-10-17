export const TICK_SIZE = 0.001
export const TICK_VALUE_USD = 10
export const CONTRACTS = 2

/** The editable part of the NG_SIM preset. Everything else in StrategySpec v1 is fixed for the MVP. */
export interface PresetForm {
  trend_minutes: number
  entry_minutes: number
  ma_period: number
  tolerance_ticks: number
  buffer_ticks: number
  target_r: number
  cutoff_local: string
  free_text: string
}

export type NumericField = 'ma_period' | 'tolerance_ticks' | 'buffer_ticks' | 'target_r'

export const LIMITS: Record<NumericField, { min: number; max: number; step: number; hint: string }> = {
  ma_period: { min: 5, max: 100, step: 1, hint: 'a whole number from 5 to 100' },
  tolerance_ticks: { min: 1, max: 20, step: 1, hint: 'a whole number of ticks from 1 to 20' },
  buffer_ticks: { min: 1, max: 50, step: 1, hint: 'a whole number of ticks from 1 to 50' },
  target_r: { min: 0.5, max: 3, step: 0.1, hint: 'a value from 0.5 to 3.0' },
}

const PATHS: Record<Exclude<keyof PresetForm, 'free_text'>, [string, string][]> = {
  trend_minutes: [['timeframes', 'trend_minutes']],
  entry_minutes: [['timeframes', 'entry_minutes']],
  ma_period: [['trend', 'period'], ['entry', 'ma_period']],
  tolerance_ticks: [['entry', 'tolerance_ticks']],
  buffer_ticks: [['stop', 'buffer_ticks']],
  target_r: [['exit', 'target_r']],
  cutoff_local: [['session', 'cutoff_local']],
}

/**
 * Overrides for POST /api/strategies/generate: only the fields the user changed from `defaults`.
 * Explicit overrides win over Nicrron's reading of the free text, so sending an untouched default would
 * silently overrule what the trader wrote ("stop 6 ticks" would come back as the default 4).
 */
export function formToOverrides(f: PresetForm, defaults: PresetForm): Record<string, unknown> {
  const out: Record<string, Record<string, unknown>> = {}
  for (const [field, paths] of Object.entries(PATHS) as [keyof typeof PATHS, [string, string][]][]) {
    if (f[field] === defaults[field]) continue
    for (const [group, key] of paths) out[group] = { ...out[group], [key]: f[field] }
  }
  return out
}

export function fieldError(field: NumericField, raw: string): string | null {
  const L = LIMITS[field]
  const n = Number(raw)
  const stepOk = L.step === 1 ? Number.isInteger(n) : Math.abs(Math.round(n * 10) - n * 10) < 1e-9
  if (raw.trim() === '' || Number.isNaN(n) || n < L.min || n > L.max || !stepOk) return `Enter ${L.hint}.`
  return null
}

