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
  WAIT: 'Not enough candles yet to compute the moving averages, so the engine waited.',
  EXIT_STOP: 'The protective stop was touched and the contracts were sold.',
  EXIT_PARTIAL: 'The profit target was hit and part of the position was sold.',
  EXIT_CUTOFF: 'The session cutoff closed whatever was still open.',
  COUNT_LOSS: 'A trade closed at a loss, so the losing streak went up by one.',
  RESET_STREAK: 'A trade closed without a loss, so the losing streak reset to zero.',
  CLOSE_SESSION: 'The session ended. The account is flat and no new entries are allowed.',
  MAX_TRADES: 'The session reached its maximum number of completed trades, which locks new entries.',
  LOCK_ENTRIES: 'The loss limit was reached. New entries are locked for the rest of the session.',
  BLOCK_ENTRY: 'A valid signal arrived while locked, and the engine refused it. No order was opened.',
  TWO_CONSECUTIVE_LOSSES: 'Two completed trades in a row lost money, which triggers the entry lock.',
  COMPLIANT: 'The engine did exactly what your rules said it should. This measures rule-following, not profit.',
  VIOLATION: 'The engine did something your rules did not allow. This would be a bug in the engine.',
  LOCAL_ONLY: 'The audit log is kept locally. The AI step that wrote this strategy was not traced to PRISM.',
  CONNECTED: 'The AI step that wrote this strategy is traced in PRISM. Engine decisions stay in the local audit.',
  'TRACED IN PRISM': 'This Nicrron call was recorded in PRISM, where it is scored and checked for failures.',
}

export const explain = (term: string) => GLOSSARY[term]
