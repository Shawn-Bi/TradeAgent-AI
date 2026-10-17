const TERMS: [string, string][] = [
  ['Tick', 'The smallest price step. For NG_SIM, 1 tick = 0.001 USD/MMBtu = $10 per contract (demo assumption).'],
  ['R', 'Your initial risk: the distance from entry to stop. A 1.2R target sits 1.2 times that distance above entry.'],
  ['DRAFT', 'Rules written out but not approved. Nothing can run yet.'],
  ['APPROVED', 'You accepted this exact version. Any edit creates a new draft version.'],
  ['SYNTHETIC', 'Made-up market data. Not a historical backtest and not evidence of future profit.'],
  ['OPEN_LONG', 'The engine bought, because every entry rule passed.'],
  ['NO_TRADE', 'A rule was not met, so the engine correctly stayed out.'],
  ['LOCK_ENTRIES', 'The loss limit was reached. New entries are locked for the rest of the session.'],
  ['BLOCK_ENTRY', 'A valid signal arrived while locked, and the engine refused it. No order was opened.'],
  ['Compliant', 'The engine did exactly what your rules said it should. This measures rule-following, not profit.'],
  ['LOCAL_ONLY', 'The audit log is kept in this session only. External tracing (PRISM) is not connected.'],
]

export function Glossary() {
  return (
    <details className="ta-card ta-glossary">
      <summary className="cursor-pointer px-4 py-3 text-code text-ink-muted">
        What do these labels and units mean?
      </summary>
      <div className="px-4 pb-4">
        <dl>
          {TERMS.map(([term, text]) => (
            <div key={term} className="contents">
              <dt>{term}</dt>
              <dd>{text}</dd>
            </div>
          ))}
        </dl>
      </div>
    </details>
  )
}
