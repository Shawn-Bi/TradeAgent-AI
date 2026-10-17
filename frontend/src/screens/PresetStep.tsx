import { useState } from 'react'
import { Card, Nav, StepHead } from '../components/Layout'
import {
  CONTRACTS,
  fieldError,
  LIMITS,
  TICK_SIZE,
  TICK_VALUE_USD,
  type NumericField,
  type PresetForm,
} from '../flow/form'
import { DEFAULT_FORM, type Flow } from '../flow/useFlow'
import { price, usd } from '../lib/format'

const EXAMPLES = [
  'Put the stop 4 points below the swing low.',
  'Also go short when the trend turns down.',
  'Skip the first 15 minutes after the open.',
]

function NumberField({
  id,
  label,
  unit,
  value,
  hint,
  onCommit,
  onValidity,
}: {
  id: NumericField
  label: string
  unit?: string
  value: number
  hint: string
  onCommit: (n: number) => void
  onValidity: (valid: boolean) => void
}) {
  // Keep the raw text so a half-typed value ("1.") is never overwritten while the user types.
  const [raw, setRaw] = useState(String(value))
  const [lastValue, setLastValue] = useState(value)
  if (value !== lastValue) {
    setLastValue(value)
    setRaw(String(value))
  }
  const error = fieldError(id, raw)
  const L = LIMITS[id]
  return (
    <div className="ta-field">
      <label className="ta-label" htmlFor={id}>
        {label}
      </label>
      <div className="ta-input-unit">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={L.min}
          max={L.max}
          step={L.step}
          value={raw}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-hint`}
          onChange={(e) => {
            setRaw(e.target.value)
            const ok = fieldError(id, e.target.value) === null
            onValidity(ok)
            if (ok) onCommit(Number(e.target.value))
          }}
        />
        {unit && <span>{unit}</span>}
      </div>
      <span id={`${id}-hint`} className={`ta-hint ${error ? 'ta-hint--err' : ''}`}>
        {error ?? hint}
      </span>
    </div>
  )
}

function differs(form: PresetForm, key: keyof PresetForm) {
  return form[key] !== DEFAULT_FORM[key]
}

export function PresetStep({ flow }: { flow: Flow }) {
  const { form, updateForm } = flow
  const [invalid, setInvalid] = useState<Record<string, boolean>>({})
  const anyInvalid = Object.values(invalid).some(Boolean)
  const assumption = (key: keyof PresetForm, text: string) =>
    differs(form, key) ? `Changed from the demo default (${DEFAULT_FORM[key]}).` : `Demo assumption · editable. ${text}`

  const numeric = (key: NumericField) => ({
    id: key,
    value: form[key],
    onCommit: (n: number) => updateForm({ [key]: n }),
    onValidity: (valid: boolean) => setInvalid((v) => ({ ...v, [key]: !valid })),
  })

  const minRiskUsd = form.buffer_ticks * TICK_VALUE_USD * CONTRACTS

  return (
    <div className="ta-section">
      <StepHead
        title="Set up your rules"
        sub="Natural gas futures (NG_SIM, a mock contract). Adjust any value, then generate. Nothing runs until you approve the written-out rules."
      />
      <Card className="ta-narrow">
        <div className="ta-card__body ta-stack" style={{ gap: 'var(--space-6)' }}>
          <div className="ta-form">
            <div className="ta-field">
              <label className="ta-label" htmlFor="trend_minutes">
                Trend timeframe
              </label>
              <select
                id="trend_minutes"
                value={form.trend_minutes}
                onChange={(e) => updateForm({ trend_minutes: Number(e.target.value) })}
              >
                <option value={15}>15 minutes</option>
                <option value={30}>30 minutes</option>
              </select>
              <span className="ta-hint">Trade only when price is above a rising SMA on this chart.</span>
            </div>
            <div className="ta-field">
              <label className="ta-label" htmlFor="entry_minutes">
                Entry timeframe
              </label>
              <select
                id="entry_minutes"
                value={form.entry_minutes}
                onChange={(e) => updateForm({ entry_minutes: Number(e.target.value) })}
              >
                <option value={5}>5 minutes</option>
                <option value={3}>3 minutes</option>
              </select>
              <span className="ta-hint">Look for the pullback entry on this chart.</span>
            </div>
            <NumberField
              {...numeric('ma_period')}
              label="Moving average (SMA)"
              unit="bars"
              hint="Used on both timeframes."
            />
            <NumberField
              {...numeric('tolerance_ticks')}
              label="Pullback tolerance"
              unit="ticks"
              hint={assumption(
                'tolerance_ticks',
                `Price within ${form.tolerance_ticks} ticks (${price(form.tolerance_ticks * TICK_SIZE)}) of the SMA.`,
              )}
            />
            <NumberField
              {...numeric('buffer_ticks')}
              label="Stop below swing low"
              unit="ticks"
              hint={assumption(
                'buffer_ticks',
                `${form.buffer_ticks} ticks = ${price(form.buffer_ticks * TICK_SIZE)} USD/MMBtu, not points.`,
              )}
            />
            <NumberField
              {...numeric('target_r')}
              label="Profit target"
              unit="R"
              hint={`1R = entry minus stop. Exit 1 contract at ${form.target_r}× that distance above entry.`}
            />
            <div className="ta-field">
              <label className="ta-label" htmlFor="cutoff_local">
                Flat by
              </label>
              <select
                id="cutoff_local"
                value={form.cutoff_local}
                onChange={(e) => updateForm({ cutoff_local: e.target.value })}
              >
                <option value="16:00">16:00 ET</option>
                <option value="15:30">15:30 ET</option>
              </select>
              <span className="ta-hint">Demo session cutoff. Nothing is held overnight.</span>
            </div>
          </div>

          <div className="ta-riskline">
            <span className="ta-label">Risk per trade</span>
            <strong>at least {usd(minRiskUsd)}</strong>
            <span className="ta-small ta-muted">
              {form.buffer_ticks}-tick buffer × ${TICK_VALUE_USD} per tick × {CONTRACTS} contracts, plus the distance
              from entry to the swing low.
            </span>
          </div>

          <div className="ta-field">
            <label className="ta-label" htmlFor="free_text">
              Anything else, in your own words (optional)
            </label>
            <textarea
              id="free_text"
              placeholder="e.g. Skip the first 15 minutes after the open."
              onChange={(e) => updateForm({ free_text: e.target.value })}
            />
            <div className="ta-chips">
              <span className="ta-hint" style={{ minHeight: 0 }}>
                Try adding:
              </span>
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  className="ta-chip"
                  onClick={() => updateForm({ free_text: `${form.free_text} ${ex}`.trim() })}
                >
                  “{ex.replace(/\.$/, '')}”
                </button>
              ))}
            </div>
            <span className="ta-hint" style={{ minHeight: 0 }}>
              You'll see what each sentence turned into, and anything that can't become a rule.
            </span>
          </div>

          <div className="ta-scope">
            This version supports one market and a fixed shape: NG_SIM only · long only · {CONTRACTS} contracts · max 3
            completed trades a session · new entries lock after 2 losses in a row · fills at the trigger price, no fees
            or slippage.
          </div>
        </div>
      </Card>
      <Nav>
        {anyInvalid && <span className="ta-small text-blocked">Fix the highlighted field to continue.</span>}
        <button type="button" className="ta-btn ta-btn--primary" disabled={anyInvalid} onClick={flow.generate}>
          Generate strategy
        </button>
      </Nav>
    </div>
  )
}
