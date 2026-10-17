import { useState } from 'react'
import { Lock, RotateCcw } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, Nav, StepHead } from '../components/Layout'
import { SelectField } from '../components/SelectField'
import { Term } from '../components/Term'
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
import { plural, price, usd } from '../lib/format'

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
  disabled,
  onCommit,
  onValidity,
}: {
  id: NumericField
  label: string
  unit?: string
  value: number
  hint: string
  disabled: boolean
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
      <Label htmlFor={id}>
        {label}
      </Label>
      <div className="ta-input-unit">
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          className="font-mono"
          min={L.min}
          max={L.max}
          step={L.step}
          value={raw}
          disabled={disabled}
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

const differs = (form: PresetForm, key: keyof PresetForm) => form[key] !== DEFAULT_FORM[key]

export function PresetStep({ flow }: { flow: Flow }) {
  const { form, updateForm, approved, runs } = flow
  const [invalid, setInvalid] = useState<Record<string, boolean>>({})
  // An approved version is read-only here until the user chooses to start a new draft.
  const [unlocked, setUnlocked] = useState(false)
  const locked = approved !== null && !unlocked
  const anyInvalid = Object.values(invalid).some(Boolean)
  const runCount = Object.keys(runs).length

  const assumption = (key: keyof PresetForm, text: string) =>
    differs(form, key) ? `Changed from the demo default (${DEFAULT_FORM[key]}).` : `Demo assumption · editable. ${text}`

  const numeric = (key: NumericField) => ({
    id: key,
    value: form[key],
    disabled: locked,
    onCommit: (n: number) => updateForm({ [key]: n }),
    onValidity: (valid: boolean) => setInvalid((v) => ({ ...v, [key]: !valid })),
  })

  const minRiskUsd = form.buffer_ticks * TICK_VALUE_USD * CONTRACTS

  return (
    <div className="ta-section">
      <StepHead
        title="Set up your rules"
        sub="Natural gas futures (NG_SIM, a mock contract). Adjust any value, then generate. Nothing runs until you approve the written-out rules."
        right={
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost">
                <RotateCcw data-icon="inline-start" />
                Start over
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Start over with the demo defaults?</AlertDialogTitle>
                <AlertDialogDescription>
                  Your values, notes, approval and simulation results are cleared. This can’t be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep my rules</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    setUnlocked(false)
                    setInvalid({})
                    flow.startOver()
                  }}
                >
                  Start over
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        }
      />

      {locked && approved && (
        <Alert className="ta-narrow border-ledger bg-ledger-soft">
          <Lock />
          <AlertTitle>Version {approved.spec.version} is approved, so these values are locked</AlertTitle>
          <AlertDescription className="flex flex-col gap-3">
            <span>
              Changing a value creates version {approved.spec.version + 1} as a new draft. The approval
              {runCount > 0 && ` and ${plural(runCount, 'simulation result')}`} for version {approved.spec.version} will be
              cleared.
            </span>
            <span>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline">Edit and create version {approved.spec.version + 1}</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Start a new draft?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Version {approved.spec.version} stays as it was, but it will no longer be the version that runs.
                      You’ll need to generate and approve version {approved.spec.version + 1}
                      {runCount > 0 && `, and run the simulation again`}.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep version {approved.spec.version}</AlertDialogCancel>
                    <AlertDialogAction onClick={() => setUnlocked(true)}>Start the new draft</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </span>
          </AlertDescription>
        </Alert>
      )}

      <Card className="ta-narrow">
        <div className="ta-card__body ta-stack" style={{ gap: 'var(--space-6)' }}>
          <div className="ta-form">
            <SelectField
              id="trend_minutes"
              label="Trend timeframe"
              value={form.trend_minutes}
              disabled={locked}
              options={[
                { value: 15, label: '15 minutes' },
                { value: 30, label: '30 minutes' },
              ]}
              hint="Trade only when price is above a rising SMA on this chart."
              onChange={(v) => updateForm({ trend_minutes: v })}
            />
            <SelectField
              id="entry_minutes"
              label="Entry timeframe"
              value={form.entry_minutes}
              disabled={locked}
              options={[
                { value: 5, label: '5 minutes' },
                { value: 3, label: '3 minutes' },
              ]}
              hint="Look for the pullback entry on this chart."
              onChange={(v) => updateForm({ entry_minutes: v })}
            />
            <NumberField {...numeric('ma_period')} label="Moving average (SMA)" unit="bars" hint="Used on both timeframes." />
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
            <SelectField
              id="cutoff_local"
              label="Flat by"
              value={form.cutoff_local}
              disabled={locked}
              options={[
                { value: '16:00', label: '16:00 ET' },
                { value: '15:30', label: '15:30 ET' },
              ]}
              hint="Demo session cutoff. Nothing is held overnight."
              onChange={(v) => updateForm({ cutoff_local: v })}
            />
          </div>

          <div className="ta-riskline">
            <span className="ta-label">Risk per trade</span>
            <strong>at least {usd(minRiskUsd)}</strong>
            <span className="ta-small ta-muted">
              {form.buffer_ticks}-<Term term="Tick">tick</Term> buffer × ${TICK_VALUE_USD} per tick × {CONTRACTS} contracts,
              plus the distance from entry to the swing low.
            </span>
          </div>

          <div className="ta-field">
            <Label htmlFor="free_text">
              Anything else, in your own words (optional)
            </Label>
            <Textarea
              id="free_text"
              value={form.free_text}
              disabled={locked}
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
                  disabled={locked}
                  onClick={() => updateForm({ free_text: `${form.free_text} ${ex}`.trim() })}
                >
                  “{ex.replace(/\.$/, '')}”
                </button>
              ))}
            </div>
            <span className="ta-hint" style={{ minHeight: 0 }}>
              You’ll see what each sentence turned into, and anything that can’t become a rule.
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
        {locked && approved ? (
          <Button onClick={() => flow.go(4)}>Continue with version {approved.spec.version}</Button>
        ) : (
          <>
            {anyInvalid && <span className="ta-small text-blocked">Fix the highlighted field to continue.</span>}
            <Button disabled={anyInvalid} onClick={flow.generate}>
              Generate strategy
            </Button>
          </>
        )}
      </Nav>
    </div>
  )
}
