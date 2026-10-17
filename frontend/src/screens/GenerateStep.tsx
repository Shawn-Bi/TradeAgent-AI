import { useState } from 'react'
import type { ClarificationChoice, ClarificationQuestion } from '../api'
import { Card, ErrorNote, Nav, StepHead, Working } from '../components/Layout'
import { StatusPill } from '../components/StatusPill'
import type { Flow } from '../flow/useFlow'
import { price } from '../lib/format'
import { parseWarning } from '../lib/warnings'

const CUSTOM = '__custom__'

function ClarificationPrompt({
  q,
  onAnswer,
  onEditText,
}: {
  q: ClarificationQuestion
  onAnswer: (choice: ClarificationChoice) => void
  onEditText: () => void
}) {
  // Nothing is preselected: the user has to pick deliberately.
  const [picked, setPicked] = useState<string | null>(null)
  const [custom, setCustom] = useState('')
  const customN = Number(custom)
  const customOk =
    q.custom !== undefined &&
    custom.trim() !== '' &&
    Number.isInteger(customN) &&
    customN >= q.custom.min &&
    customN <= q.custom.max

  const choice: ClarificationChoice | null =
    picked === CUSTOM && q.custom && customOk
      ? {
          label: `${customN} ticks (${price(customN * 0.001)} USD/MMBtu)`,
          overrides: q.custom.field === 'stop.buffer_ticks' ? { stop: { buffer_ticks: customN } } : {},
          replacement_text: q.source_text.replace(/\d+(?:\.\d+)?\s*(points?|pts?)/i, `${customN} ticks`),
        }
      : picked !== null && picked !== CUSTOM
        ? (q.choices[Number(picked)] ?? null)
        : null

  return (
    <div className="ta-clarify">
      <div className="ta-row justify-between">
        <span className="ta-label">Clarification needed</span>
        <StatusPill value="OPEN" />
      </div>
      <div>
        You wrote <q>{q.source_text.replace(/[.!?]+$/, '')}</q>. {q.question}
      </div>
      <fieldset className="ta-stack m-0 border-0 p-0" style={{ gap: 'var(--space-2)' }}>
        <legend className="sr-only">{q.question}</legend>
        {q.choices.map((c, i) => (
          <label key={c.label} className="ta-choice">
            <input
              type="radio"
              name={`q-${q.id}`}
              value={String(i)}
              checked={picked === String(i)}
              onChange={() => setPicked(String(i))}
            />
            {c.label}
          </label>
        ))}
        {q.custom && (
          <label className="ta-choice flex-wrap">
            <input type="radio" name={`q-${q.id}`} value={CUSTOM} checked={picked === CUSTOM} onChange={() => setPicked(CUSTOM)} />
            Something else:
            <input
              className="ta-input w-24"
              type="number"
              inputMode="numeric"
              min={q.custom.min}
              max={q.custom.max}
              value={custom}
              aria-label={`Number of ${q.custom.unit}`}
              onFocus={() => setPicked(CUSTOM)}
              onChange={(e) => setCustom(e.target.value)}
            />
            {q.custom.unit}
          </label>
        )}
      </fieldset>
      <div className="ta-row">
        <button
          type="button"
          className="ta-btn ta-btn--primary"
          disabled={choice === null}
          onClick={() => choice && onAnswer(choice)}
        >
          Use this answer
        </button>
        <button type="button" className="ta-btn ta-btn--quiet" onClick={onEditText}>
          Edit my text instead
        </button>
        {picked === CUSTOM && !customOk && q.custom && (
          <span className="ta-small text-blocked">
            Enter a whole number of {q.custom.unit} from {q.custom.min} to {q.custom.max}.
          </span>
        )}
      </div>
    </div>
  )
}

export function GenerateStep({ flow }: { flow: Flow }) {
  const { gen, answered } = flow

  if (gen.status === 'idle' || gen.status === 'loading') {
    return (
      <div className="ta-section ta-narrow">
        <StepHead title="Writing out your strategy" sub="Turning your settings and notes into exact rules." />
        <Card>
          <Working label="Generate" />
        </Card>
      </div>
    )
  }
  if (gen.status === 'error') {
    return (
      <div className="ta-section ta-narrow">
        <StepHead title="Writing out your strategy" sub="Turning your settings and notes into exact rules." />
        <ErrorNote message={gen.error} onRetry={flow.generate} />
        <Nav back={() => flow.go(0)} />
      </div>
    )
  }

  const { strategy, strategy_summary, clarification_questions: questions, warnings } = gen.data
  const parsed = warnings.map(parseWarning)
  const fallback = parsed.find((w) => w.kind === 'PRESET_FALLBACK')
  const interpretation = parsed.filter((w) => w.kind === 'APPLIED' || w.kind === 'NOT_APPLIED')
  const notes = parsed.filter((w) => w.kind === 'NOTE')
  const open = questions.length

  return (
    <div className="ta-section ta-narrow">
      <StepHead
        title="Check the proposed strategy"
        sub="Read the summary and answer any questions. Next you'll see the exact rules before anything runs."
      />

      <Card title="Proposed strategy" right={<StatusPill value={`DRAFT · v${strategy.version}`} tone="draft" />}>
        <div className="ta-card__body ta-stack" style={{ gap: 'var(--space-2)' }}>
          <p className="m-0">{strategy_summary}</p>
          {open > 0 && (
            <span className="ta-small text-marker-ink">
              Not final: answer the question below and this summary updates to match.
            </span>
          )}
          <span className="ta-small ta-muted">
            {fallback
              ? `Written by: built-in preset. ${fallback.detail}`
              : 'Written by: AI model, then checked against the StrategySpec schema.'}
          </span>
        </div>
        <details className="ta-more">
          <summary>Technical details: the StrategySpec JSON that will run</summary>
          <div>
            <pre className="ta-json">{JSON.stringify(strategy, null, 2)}</pre>
          </div>
        </details>
      </Card>

      {interpretation.length > 0 && (
        <Card title="What your text became">
          <div className="ta-card__body">
            <ul className="ta-interp">
              {interpretation.map((w) => (
                <li key={`${w.kind}-${w.quote}`}>
                  <StatusPill
                    value={w.kind === 'APPLIED' ? 'BECAME A RULE' : 'NOT APPLIED'}
                    tone={w.kind === 'APPLIED' ? 'compliant' : 'blocked'}
                  />
                  <span>
                    <q className="ta-mono text-code">{w.quote}</q> <span className="ta-muted">· {w.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      )}

      {questions.map((q) => (
        <ClarificationPrompt
          key={`${strategy.version}-${q.id}`}
          q={q}
          onAnswer={(c) => flow.answer(q, c)}
          onEditText={() => flow.go(0)}
        />
      ))}

      {answered.length > 0 && (
        <Card title="Your answers" right={<StatusPill value="ANSWERED" />}>
          <div className="ta-card__body ta-stack">
            {answered.map((a) => (
              <div key={a.source_text} className="ta-small">
                <q className="ta-mono">{a.source_text.replace(/[.!?]+$/, '')}</q> → <strong>{a.answer}</strong>
              </div>
            ))}
            <div>
              <button type="button" className="ta-btn" onClick={flow.changeAnswers}>
                Change answers
              </button>
            </div>
          </div>
        </Card>
      )}

      {notes.length > 0 && (
        <ul className="ta-small ta-muted m-0 pl-5">
          {notes.map((n) => (
            <li key={n.detail}>{n.detail}</li>
          ))}
        </ul>
      )}

      <Nav back={() => flow.go(0)}>
        {open > 0 && (
          <span className="ta-small ta-muted">
            Answer {open === 1 ? 'the question' : `all ${open} questions`} to continue.
          </span>
        )}
        <button type="button" className="ta-btn ta-btn--primary" disabled={open > 0} onClick={() => flow.go(2)}>
          Review exact rules
        </button>
      </Nav>
    </div>
  )
}
