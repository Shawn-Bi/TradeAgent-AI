import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DecisionFunnel } from '../components/DecisionFunnel'
import { Disclosure } from '../components/Disclosure'
import { Term } from '../components/Term'
import { Card, Nav, StepHead } from '../components/Layout'
import { StatusPill } from '../components/StatusPill'
import type { Flow } from '../flow/useFlow'
import { price, signedUsd, usd } from '../lib/format'
import { fixtureLabel, FIXTURES } from './fixtures'
import { pnlTone, summarize, tradeView } from '../lib/summary'
import { DecisionLog, Kpi } from './results'


const sameRules = (a: object, b: object) => {
  const strip = (o: object) => JSON.stringify({ ...o, approval_status: undefined })
  return strip(a) === strip(b)
}

export function AuditStep({ flow }: { flow: Flow }) {
  const ranIds = FIXTURES.map((f) => f.id).filter((id) => flow.runs[id])
  const [picked, setPicked] = useState(flow.fixture)
  const id = flow.runs[picked] ? picked : ranIds[0]
  const run = id ? flow.runs[id] : undefined
  if (!run || !flow.approved || flow.gen.status !== 'ready') return null

  const s = summarize(run)
  const r = run.report
  const proposed = flow.gen.data.strategy
  const identical = sameRules(proposed, flow.approved.spec)
  const pct = r.execution_conformance === null ? 0 : r.execution_conformance * 100

  return (
    <div className="ta-section">
      <StepHead
        title="Audit report"
        sub="What happened to the mock account, and whether the engine followed your approved rules at every decision."
        right={<StatusPill value="SYNTHETIC" />}
      />

      {ranIds.length > 1 && (
        <Tabs value={id} onValueChange={setPicked}>
          <TabsList aria-label="Simulated sessions" className="h-auto flex-wrap border border-line bg-card p-1">
            {ranIds.map((rid) => (
              <TabsTrigger key={rid} value={rid} className="px-3 py-1.5 text-control">
                {fixtureLabel(rid)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      <Card title={`Results · ${fixtureLabel(run.fixture)}`} right={<span className="ta-mono text-meta ta-muted">{run.state.simulation_id}</span>}>
        <div className="ta-kpis">
          <Kpi label="Session P&L" value={signedUsd(s.pnl)} tone={pnlTone(s.pnl)} />
          <Kpi label="Trades" value={<>{s.trades} <span className="ta-small ta-muted">({s.wins} won · {s.losses} lost)</span></>} />
          <Kpi label="Largest loss" value={s.worst < 0 ? signedUsd(s.worst) : '—'} tone={pnlTone(s.worst)} />
          <Kpi label="Entries blocked" value={s.blocked} alert={s.blocked > 0} />
          <Kpi label="Equity (mock)" value={usd(run.state.equity_usd)} />
        </div>
        <div className="ta-card__body ta-small ta-muted">
          One synthetic session. This shows how your rules behaved, not whether they will make money. {r.disclaimer}.
        </div>
      </Card>

      <DecisionFunnel events={run.events} />

      <div className="ta-cols">
        <div className="ta-section">
          {run.state.entry_locked ? (
            <Card tone="locked" title="New entries locked" right={<StatusPill value={run.state.lock_reason ?? 'LOCKED'} tone="blocked" />}>
              <div className="ta-card__body ta-stack" style={{ gap: 'var(--space-2)' }}>
                <span>
                  {run.state.lock_reason === 'MAX_TRADES'
                    ? `The session's trade limit (${s.trades} completed trades) was reached, so the engine refused every new entry after that.`
                    : `${run.state.consecutive_losses} completed trades in a row closed at a loss, so the engine refused every new entry after that.`}{' '}
                  {s.blocked > 0 && `${s.blocked} valid signal${s.blocked === 1 ? ' was' : 's were'} blocked and no order was opened.`}
                </span>
                <span className="ta-small ta-muted">Exits that reduce risk stay allowed. The lock clears at the next session.</span>
              </div>
            </Card>
          ) : (
            <Card tone="approved" title="No risk lock">
              <div className="ta-card__body ta-small">
                The loss streak ended at {run.state.consecutive_losses}. A winning trade resets it, so new entries stayed allowed.
              </div>
            </Card>
          )}

          <Card title="Rule-following">
            <div className="ta-card__body ta-meter">
              <span className="ta-meter__fig">
                {r.execution_conformance === null ? 'N/A' : `${r.compliant_decisions} / ${r.eligible_decisions}`}
              </span>
              <Progress value={pct} indicatorClassName="bg-compliant" aria-label="Decisions that followed the rules" />
              <span className="ta-small ta-muted">
                {r.execution_conformance === null
                  ? 'N/A · no decisions to check in this session.'
                  : `decisions where the engine did exactly what your rules required, including trades it correctly refused · ${r.violations} violation${r.violations === 1 ? '' : 's'}. This is not a win rate.`}
              </span>
              <span className="ta-small ta-muted">
                A <Term term="VIOLATION">violation</Term> would appear in orange, for example the engine opening a trade
                while entries were locked.
              </span>
            </div>
          </Card>
        </div>

        <div className="ta-section">
          <Card title="Proposed vs approved" right={<StatusPill value={identical ? 'IDENTICAL' : 'CHANGED'} tone={identical ? 'compliant' : 'blocked'} />}>
            <div className="ta-card__body ta-small">
              {identical
                ? `The simulation ran version ${flow.approved.spec.version} exactly as proposed and approved.`
                : 'The approved rules differ from the proposal.'}
            </div>
          </Card>
          <Card title="Where this audit is kept" right={<StatusPill value={run.state.prism_status} />}>
            <div className="ta-card__body ta-small">
              {run.state.prism_status === 'CONNECTED' ? (
                <>
                  The Nicrron call that wrote version {flow.approved.spec.version} is traced in PRISM
                  {run.state.prism_trace_id && (
                    <>
                      {' '}
                      (trace <code>{run.state.prism_trace_id.slice(0, 8)}</code>)
                    </>
                  )}
                  . The engine’s decisions below are kept in the local audit.
                </>
              ) : (
                'Kept in the local audit. This version was not written by a traced AI call (for example the demo preset), so there is nothing in PRISM for it.'
              )}
            </div>
            <Disclosure label="Technical details: report JSON">
              <pre className="ta-json">{JSON.stringify(r, null, 2)}</pre>
            </Disclosure>
          </Card>
        </div>
      </div>

      <Card title="Trades">
        <ul className="ta-only-narrow ta-rowcards">
          {run.state.completed_trades.map((t) => (
            <li key={t.position_id}>
              <div className="ta-row justify-between">
                <span className="ta-mono">
                  {t.position_id} · {tradeView(t).outcome}
                </span>
                <span className={`ta-mono ${t.realized_pnl_usd < 0 ? 'ta-neg' : ''}`}>{signedUsd(t.realized_pnl_usd)}</span>
              </div>
              <span className="ta-mono text-meta ta-muted">
                {tradeView(t).contracts} contracts · entry {t.entry_price !== undefined ? price(t.entry_price) : '—'} · avg exit{' '}
                {tradeView(t).avgExit !== null ? price(tradeView(t).avgExit!) : '—'}
              </span>
            </li>
          ))}
          {s.blocked > 0 && <li className="is-blocked">Valid signal blocked by the loss lock. Never opened.</li>}
        </ul>
        <div className="ta-only-wide">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Trade</TableHead>
                <TableHead className="text-right">Entry</TableHead>
                <TableHead className="text-right">Avg exit</TableHead>
                <TableHead className="text-right">Contracts</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead className="text-right">P&amp;L</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {run.state.completed_trades.map((t) => (
                <TableRow key={t.position_id}>
                  <TableCell className="font-mono">{t.position_id}</TableCell>
                  <TableCell className="text-right font-mono">{t.entry_price !== undefined ? price(t.entry_price) : '—'}</TableCell>
                  <TableCell className="text-right font-mono">
                    {tradeView(t).avgExit !== null ? price(tradeView(t).avgExit!) : '—'}
                  </TableCell>
                  <TableCell className="text-right font-mono">{tradeView(t).contracts}</TableCell>
                  <TableCell className="whitespace-normal">{tradeView(t).outcome}</TableCell>
                  <TableCell className={`text-right font-mono ${t.realized_pnl_usd < 0 ? 'text-blocked' : ''}`}>
                    {signedUsd(t.realized_pnl_usd)}
                  </TableCell>
                </TableRow>
              ))}
              {s.blocked > 0 && (
                <TableRow className="bg-blocked-soft hover:bg-blocked-soft">
                  <TableCell className="font-mono">—</TableCell>
                  <TableCell className="text-right font-mono">—</TableCell>
                  <TableCell className="text-right font-mono">—</TableCell>
                  <TableCell className="text-right font-mono">0</TableCell>
                  <TableCell className="whitespace-normal">
                    Valid signal blocked by the loss lock (<Term term="BLOCK_ENTRY" />). Never opened.
                  </TableCell>
                  <TableCell className="text-right font-mono">—</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Card title="Expected vs actual" right={<span className="ta-small ta-muted">{r.eligible_decisions} decisions</span>}>
        <DecisionLog events={run.events} />
      </Card>

      <Nav back={() => flow.go(4)}>
        <Button variant="outline" onClick={() => flow.go(0)}>
          Change values
        </Button>
      </Nav>
    </div>
  )
}
