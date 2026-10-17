import { useState, type ReactNode } from 'react'
import { Check, ChevronRight, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import type { GenerateStrategyResponse, KnowledgeBaseMeta } from '../api'
import { plural } from '../lib/format'
import { Card } from './Layout'
import { StatusPill, type PillTone } from './StatusPill'

// "How the AI drafted this": the steps one Generate request ran through, in order, using only what the API
// returned. Nothing here is estimated or filled in; a missing field is shown as "not reported".

/** One readable line from a Markdown excerpt: drops heading marks, bold marks and table rules, then trims. */
const trim = (s: string, max = 220) => {
  const flat = s
    .replace(/(^|\s)#{1,6}\s/g, '$1')
    .replace(/\*\*/g, '')
    .replace(/\|?(\s*-{3,}\s*\|)+-*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat
}

function Step({
  n,
  title,
  status,
  tone,
  last,
  children,
}: {
  n: number
  title: string
  status: string
  tone: PillTone
  last?: boolean
  children: ReactNode
}) {
  return (
    <li className="grid grid-cols-[24px_minmax(0,1fr)] gap-x-3">
      {/* The rail: a numbered node and the line down to the next step. */}
      <div className="flex flex-col items-center" aria-hidden="true">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-sm border border-control-border bg-panel font-mono text-meta text-ink-muted">
          {n}
        </span>
        {!last && <span className="w-px flex-1 bg-line" />}
      </div>
      <div className={last ? 'min-w-0' : 'min-w-0 pb-5'}>
        <div className="flex min-h-6 flex-wrap items-center gap-x-3 gap-y-1">
          <h4 className="m-0 text-control">
            <span className="sr-only">Step {n}: </span>
            {title}
          </h4>
          <StatusPill value={status} tone={tone} />
        </div>
        <div className="mt-1 flex flex-col gap-2 text-code text-ink-muted">{children}</div>
      </div>
    </li>
  )
}

function kbStep(kb: KnowledgeBaseMeta | undefined, promptVersion: string | null | undefined) {
  if (!kb) return { status: 'NOT REPORTED', tone: 'neutral' as const, text: 'This backend did not report a Knowledge Base search.' }
  const none = 'No Knowledge Base context was retrieved'
  switch (kb.status) {
    case 'USED': {
      const n = kb.snippets.length
      const m = kb.sources_used.length
      return {
        status: 'USED',
        tone: 'compliant' as const,
        text: `Searched the PRISM Knowledge Base with your text and found ${plural(n, 'passage')} in ${plural(m, 'source')}. They went into Nicrron's prompt as cited context.`,
      }
    }
    case 'NO_MATCH':
      return { status: 'NO MATCH', tone: 'neutral' as const, text: `${none}: the search found no matching passages, so Nicrron was called without it.` }
    case 'FAILED':
      return {
        status: 'FAILED',
        tone: 'blocked' as const,
        text: `${none}: the search failed${kb.error ? ` (${kb.error})` : ''}, so Nicrron was called without it.`,
      }
    case 'NOT_CONFIGURED':
      return { status: 'NOT CONFIGURED', tone: 'neutral' as const, text: `${none}: the Knowledge Base is not configured on this server.` }
    default:
      return {
        status: 'NOT RUN',
        tone: 'neutral' as const,
        text:
          promptVersion === 'v1'
            ? `${none}: prompt v1 is the baseline and drafts without retrieval.`
            : `${none}: the search was not run for this request.`,
      }
  }
}

function Snippets({ kb }: { kb: KnowledgeBaseMeta }) {
  if (kb.snippets.length === 0) return null
  return (
    <Collapsible>
      <CollapsibleTrigger className="group flex cursor-pointer items-center gap-1 rounded-sm text-left text-code text-ink-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronRight className="size-4 transition-transform group-data-[state=open]:rotate-90" aria-hidden="true" />
        Show the {plural(kb.snippets.length, 'retrieved passage')}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
          {kb.snippets.map((s, i) => (
            <li key={`${s.source}-${i}`} className="flex flex-col gap-1 rounded-md border border-line bg-ground p-3">
              <span className="flex flex-wrap items-baseline justify-between gap-x-3 font-mono text-meta">
                <span className="text-ink">
                  [S{i + 1}] {s.source}
                </span>
                <span>score {s.score.toFixed(2)}</span>
              </span>
              <q className="text-code break-words text-ink">{trim(s.excerpt)}</q>
            </li>
          ))}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  )
}

/** First 8 characters of the trace id, with a button that copies the full id. If the browser refuses
 *  clipboard access, the full id is shown instead so it can be selected by hand. */
function CopyId({ id }: { id: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-1">
      <code className="text-code break-all text-ink select-all" title={id}>
        {state === 'failed' ? id : id.slice(0, 8)}
      </code>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={state === 'copied' ? 'Trace id copied' : 'Copy the full PRISM trace id'}
        onClick={() => {
          const copy = navigator.clipboard?.writeText(id) ?? Promise.reject(new Error('no clipboard'))
          copy.then(
            () => {
              setState('copied')
              window.setTimeout(() => setState('idle'), 2000)
            },
            () => setState('failed'),
          )
        }}
      >
        {state === 'copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      </Button>
      <span className="sr-only" aria-live="polite">
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy is blocked here; the full id is shown instead' : ''}
      </span>
    </span>
  )
}

/** The trace card. Render it only when the trader's text went to Nicrron (nicrron.status is not NOT_REQUESTED). */
export function AgentTrace({ d }: { d: GenerateStrategyResponse }) {
  const n = d.nicrron!
  const kb = d.knowledge_base
  const k = kbStep(kb, n.prompt_version)
  const questions = d.clarification_questions.length
  const unsupported = d.unsupported_requirements?.length ?? 0
  const approvable = d.approvable ?? questions === 0
  const prism = d.prism
  const model = n.model_used ?? n.model_requested

  return (
    <Card title="How the AI drafted this" right={<span className="text-meta text-ink-muted">One request, in order</span>}>
      <ol className="ta-card__body m-0 list-none" aria-label="Steps of this AI draft">
        <Step n={1} title="Knowledge Base search" status={k.status} tone={k.tone}>
          <p className="m-0">{k.text}</p>
          {kb && kb.sources_used.length > 0 && (
            <ul className="m-0 flex list-none flex-wrap gap-2 p-0" aria-label="Sources used">
              {kb.sources_used.map((s) => (
                <li key={s} className="rounded-sm border border-line bg-ground px-2 py-0.5 font-mono text-meta text-ink">
                  {s}
                </li>
              ))}
            </ul>
          )}
          {kb && <Snippets kb={kb} />}
        </Step>

        <Step
          n={2}
          title="Nicrron call"
          status={n.status === 'SUCCESS' ? 'ANSWERED' : n.status === 'FAILED' ? 'FAILED' : n.status.replace(/_/g, ' ')}
          tone={n.status === 'SUCCESS' ? 'compliant' : n.status === 'FAILED' ? 'blocked' : 'neutral'}
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {model && <code className="text-code text-ink">{model}</code>}
            {n.latency_ms !== null && <span className="font-mono">{(n.latency_ms / 1000).toFixed(1)} s</span>}
            {n.prompt_version && <StatusPill value={`PROMPT ${n.prompt_version.toUpperCase()}`} tone="neutral" />}
            {n.cached && <StatusPill value="CACHED" tone="neutral" />}
          </div>
          {n.status === 'SUCCESS' ? (
            <p className="m-0">
              Nicrron turned your text into StrategySpec fields
              {kb?.status === 'USED' ? ', with the passages above as context' : ''}
              {n.cached ? '. This answer came from the cache, not a fresh model call' : ''}.
            </p>
          ) : (
            <p className="m-0">
              Nicrron did not read your text{n.error_message || n.error_code ? `: ${n.error_message ?? n.error_code}` : ''}.
              The strategy shown is the built-in demo preset.
            </p>
          )}
        </Step>

        <Step
          n={3}
          title="Safety check"
          status={approvable ? 'APPROVABLE' : 'NOT APPROVABLE YET'}
          tone={approvable ? 'compliant' : 'draft'}
        >
          <p className="m-0">
            The draft passed the StrategySpec schema check with{' '}
            <span className="text-ink">{plural(unsupported, 'unsupported requirement')}</span> and{' '}
            <span className="text-ink">{plural(questions, 'clarification question')}</span>.{' '}
            {approvable ? 'Nothing is left to answer.' : 'Answer the questions below and generate again.'}
          </p>
        </Step>

        <Step
          n={4}
          title="PRISM"
          last
          status={prism?.status === 'SENT' ? 'TRACED IN PRISM' : prism?.status === 'FAILED' ? 'NOT TRACED' : 'LOCAL ONLY'}
          tone={prism?.status === 'SENT' ? 'compliant' : prism?.status === 'FAILED' ? 'blocked' : 'neutral'}
        >
          {prism?.status === 'SENT' ? (
            <>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>Traced in PRISM · trace</span>
                {prism.trace_id ? <CopyId id={prism.trace_id} /> : <span>(no id returned)</span>}
              </div>
              {prism.context_span === 'SENT' && <p className="m-0">The Knowledge Base search is attached to the trace as its own span.</p>}
              {prism.context_span === 'FAILED' && (
                <p className="m-0">The Knowledge Base span could not be attached; the model call itself is traced.</p>
              )}
            </>
          ) : (
            <p className="m-0">
              {prism?.status === 'FAILED'
                ? `PRISM did not accept the trace${prism.error ? ` (${prism.error})` : ''}, so this call is kept in the local audit only.`
                : prism?.status === 'NOT_CONFIGURED'
                  ? 'PRISM is not configured, so this call is kept in the local audit only.'
                  : 'No PRISM trace was reported, so this call is kept in the local audit only.'}
            </p>
          )}
        </Step>
      </ol>
    </Card>
  )
}
