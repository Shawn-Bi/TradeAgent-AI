import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { GenerateStrategyResponse } from '../api'
import { Disclosure } from '../components/Disclosure'
import { Card, ErrorNote, Nav, StepHead, Working } from '../components/Layout'
import { StatusPill } from '../components/StatusPill'
import type { Flow } from '../flow/useFlow'

/** Who wrote this draft, in plain words. Never call a preset result AI-generated. */
function authorship(d: GenerateStrategyResponse): string {
  const n = d.nicrron
  if (d.generator === 'NICRRON' && n) {
    const secs = n.latency_ms !== null ? ` · ${(n.latency_ms / 1000).toFixed(1)}s` : ''
    return `Written by Nicrron (${n.model_used ?? n.model_requested ?? 'model'})${secs}${n.cached ? ' · cached' : ''}, then checked against the StrategySpec schema.`
  }
  if (n && (n.status === 'FAILED' || n.status === 'NOT_CONFIGURED'))
    return `Built-in demo preset. Nicrron did not read your text: ${n.error_message ?? n.error_code}.`
  return 'Built-in demo preset: no free text was given, so no AI model was called.'
}

function PrismPill({ d }: { d: GenerateStrategyResponse }) {
  if (d.prism?.status === 'SENT') return <StatusPill value="TRACED IN PRISM" tone="compliant" />
  if (d.prism?.status === 'FAILED') return <StatusPill value="LOCAL_ONLY" />
  return null
}

function RewriteRules({ questions, flow }: { questions: string[]; flow: Flow }) {
  const [text, setText] = useState(flow.form.free_text)
  return (
    <div className="ta-clarify">
      <div className="ta-row justify-between">
        <span className="ta-label">
          {questions.length === 1 ? '1 question' : `${questions.length} questions`} before you can approve
        </span>
        <StatusPill value="OPEN" />
      </div>
      <ol className="m-0 flex flex-col gap-2 pl-5">
        {questions.map((q) => (
          <li key={q}>{q}</li>
        ))}
      </ol>
      <div className="ta-field">
        <Label htmlFor="rewrite">Your rules, rewritten to answer the questions</Label>
        <Textarea id="rewrite" value={text} onChange={(e) => setText(e.target.value)} className="bg-card" />
        <span className="ta-hint" style={{ minHeight: 0 }}>
          Say it exactly: “stop 6 ticks below the swing low”, “take 1 contract off at 1.5R”. Remove anything this
          version can’t do.
        </span>
      </div>
      <div className="ta-row">
        <Button disabled={!text.trim() || text === flow.form.free_text} onClick={() => flow.regenerate(text)}>
          Generate again
        </Button>
        <Button variant="link" onClick={() => flow.regenerate('')}>
          Clear my text and use the demo preset
        </Button>
      </div>
    </div>
  )
}

export function GenerateStep({ flow }: { flow: Flow }) {
  const { gen } = flow
  const head = (
    <StepHead
      title="Check the proposed strategy"
      sub="Read the summary and answer any questions. Next you'll see the exact rules before anything runs."
    />
  )

  if (gen.status === 'idle' || gen.status === 'loading') {
    return (
      <div className="ta-section ta-narrow">
        {head}
        <Card>
          <Working label={flow.form.free_text.trim() ? 'Nicrron is reading your rules' : 'Generate'} />
          {flow.form.free_text.trim() && (
            <p className="m-0 px-4 pb-4 ta-small ta-muted">This usually takes a few seconds and can take up to a minute.</p>
          )}
        </Card>
      </div>
    )
  }
  if (gen.status === 'error') {
    return (
      <div className="ta-section ta-narrow">
        {head}
        <ErrorNote message={gen.error} onRetry={() => flow.regenerate(flow.form.free_text)} />
        <Nav back={() => flow.go(0)} />
      </div>
    )
  }

  const d = gen.data
  const { strategy, strategy_summary, clarification_questions: questions, warnings } = d
  const approvable = d.approvable ?? questions.length === 0
  const notes = warnings.filter((w) => w.startsWith('Nicrron: ')).map((w) => w.slice('Nicrron: '.length))
  const loosened = warnings.filter((w) => w.startsWith('RISK_LOOSENED'))
  const other = warnings.filter((w) => !w.startsWith('Nicrron: ') && !w.startsWith('RISK_LOOSENED'))
  const interpreted = d.interpreted_fields ?? []
  const unsupported = d.unsupported_requirements ?? []

  return (
    <div className="ta-section ta-narrow">
      {head}

      <Card
        title="Proposed strategy"
        right={
          <div className="ta-row">
            <PrismPill d={d} />
            <StatusPill value={`DRAFT · v${strategy.version}`} tone="draft" />
          </div>
        }
      >
        <div className="ta-card__body ta-stack" style={{ gap: 'var(--space-2)' }}>
          <p className="m-0">{strategy_summary}</p>
          {!approvable && (
            <span className="ta-small text-marker-ink">Not final: answer the questions below and generate again.</span>
          )}
          <span className="ta-small ta-muted">{authorship(d)}</span>
        </div>
        <Disclosure label="Technical details: the StrategySpec JSON that will run">
          <pre className="ta-json">{JSON.stringify(strategy, null, 2)}</pre>
        </Disclosure>
      </Card>

      {(interpreted.length > 0 || notes.length > 0 || unsupported.length > 0) && (
        <Card title="What your text became">
          <div className="ta-card__body ta-stack">
            {(interpreted.length > 0 || notes.length > 0) && (
              <ul className="ta-interp">
                {notes.length > 0
                  ? notes.map((n) => {
                      // Only "field = value from '…'" notes set a value; the rest are explanations.
                      const set = /^[a-z_]+(\.[a-z_0-9]+)*\s*=/.test(n)
                      return (
                        <li key={n}>
                          <StatusPill value={set ? 'BECAME A RULE' : 'NOTE'} tone={set ? 'compliant' : 'neutral'} />
                          <span>{n}</span>
                        </li>
                      )
                    })
                  : interpreted.map((f) => (
                      <li key={f}>
                        <StatusPill value="BECAME A RULE" tone="compliant" />
                        <code>{f}</code>
                      </li>
                    ))}
              </ul>
            )}
            {unsupported.length > 0 && (
              <ul className="ta-interp">
                {unsupported.map((u) => (
                  <li key={u}>
                    <StatusPill value="NOT APPLIED" tone="blocked" />
                    <span>
                      <q className="ta-mono text-code">{u}</q>{' '}
                      <span className="ta-muted">· this version can’t do that, so it was left out</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <span className="ta-small ta-muted">Everything else is a demo default you can see on the next step.</span>
          </div>
        </Card>
      )}

      {loosened.length > 0 && (
        <Card tone="locked" title="Looser than the confirmed risk rules">
          <ul className="ta-card__body m-0 flex flex-col gap-1 pl-9">
            {loosened.map((w) => (
              <li key={w}>{w.replace(/^RISK_LOOSENED:\s*/, '')}</li>
            ))}
          </ul>
        </Card>
      )}

      {questions.length > 0 && <RewriteRules key={strategy.version} questions={questions} flow={flow} />}

      {other.length > 0 && (
        <ul className="ta-small ta-muted m-0 pl-5">
          {other.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      <Nav back={() => flow.go(0)}>
        {!approvable && <span className="ta-small ta-muted">Answer the questions to continue.</span>}
        <Button disabled={!approvable} onClick={() => flow.go(2)}>
          Review exact rules
        </Button>
      </Nav>
    </div>
  )
}
