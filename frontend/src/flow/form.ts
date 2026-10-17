import type { StrategySpec } from '../api'

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

export function specToForm(spec: StrategySpec, freeText: string): PresetForm {
  return {
    trend_minutes: spec.timeframes.trend_minutes,
    entry_minutes: spec.timeframes.entry_minutes,
    ma_period: spec.trend.period,
    tolerance_ticks: spec.entry.tolerance_ticks,
    buffer_ticks: spec.stop.buffer_ticks,
    target_r: spec.exit.target_r,
    cutoff_local: spec.session.cutoff_local,
    free_text: freeText,
  }
}

/** Overrides relative to the preset, in StrategySpec shape, for POST /api/strategies/generate. */
export function formToOverrides(f: PresetForm): Record<string, unknown> {
  return {
    timeframes: { trend_minutes: f.trend_minutes, entry_minutes: f.entry_minutes },
    trend: { period: f.ma_period },
    entry: { ma_period: f.ma_period, tolerance_ticks: f.tolerance_ticks },
    stop: { buffer_ticks: f.buffer_ticks },
    exit: { target_r: f.target_r },
    session: { cutoff_local: f.cutoff_local },
  }
}

export function fieldError(field: NumericField, raw: string): string | null {
  const L = LIMITS[field]
  const n = Number(raw)
  const stepOk = L.step === 1 ? Number.isInteger(n) : Math.abs(Math.round(n * 10) - n * 10) < 1e-9
  if (raw.trim() === '' || Number.isNaN(n) || n < L.min || n > L.max || !stepOk) return `Enter ${L.hint}.`
  return null
}

export function deepMerge(target: Record<string, unknown>, extra: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...target }
  for (const [k, v] of Object.entries(extra)) {
    const cur = out[k]
    out[k] =
      v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object'
        ? deepMerge(cur as Record<string, unknown>, v as Record<string, unknown>)
        : v
  }
  return out
}
