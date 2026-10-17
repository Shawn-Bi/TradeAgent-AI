// Plain-language meaning of every unit and constant the UI shows. Used by the inline <Term> tooltips
// and the glossary, so a word is explained the same way everywhere.
export const GLOSSARY: Record<string, string> = {
  Tick: 'The smallest price step. For NG_SIM, 1 tick = 0.001 USD/MMBtu = $10 per contract (demo assumption).',
  R: 'Your initial risk: the distance from entry to stop. A 1.2R target sits 1.2 times that distance above entry.',
  DRAFT: 'Rules written out but not approved. Nothing can run yet.',
  APPROVED: 'You accepted this exact version. Any edit creates a new draft version.',
  SYNTHETIC: 'Made-up market data. Not a historical backtest and not evidence of future profit.',
  OPEN_LONG: 'The engine bought, because every entry rule passed.',
  NO_TRADE: 'A rule was not met, so the engine correctly stayed out.',
  EXIT_ALL: 'The stop was hit and every contract was sold.',
  EXIT_PARTIAL: 'The profit target was hit and part of the position was sold.',
  EXIT_REMAINDER: 'The session cutoff closed whatever was still open.',
  NO_ACTION: 'Nothing needed doing: the account was already flat.',
  LOCK_ENTRIES: 'The loss limit was reached. New entries are locked for the rest of the session.',
  BLOCK_ENTRY: 'A valid signal arrived while locked, and the engine refused it. No order was opened.',
  TWO_CONSECUTIVE_LOSSES: 'Two completed trades in a row lost money, which triggers the entry lock.',
  COMPLIANT: 'The engine did exactly what your rules said it should. This measures rule-following, not profit.',
  VIOLATION: 'The engine did something your rules did not allow. This would be a bug in the engine.',
  LOCAL_ONLY: 'The audit log is kept in this session only. External tracing (PRISM) is not connected.',
  CONNECTED: 'Every decision is also traced to PRISM.',
}

export const explain = (term: string) => GLOSSARY[term]
