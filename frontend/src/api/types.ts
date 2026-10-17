// Types for the v1 contract (contracts/strategy.example.json, docs/PRD.md section 8) as implemented by
// B's backend: backend/API.md. Frozen PRD fields come first in each type; fields marked "additive" are the
// extras the backend documents, so the UI can rely on them.

/** Widens a string-literal union while keeping editor autocomplete for the known values. */
type Known<T extends string> = T | (string & {})

// ---------- StrategySpec v1 ----------

export type ApprovalStatus = 'DRAFT' | 'APPROVED'

export interface StrategySpec {
  schema_version: string
  strategy_id: string
  version: number
  instrument: {
    symbol: string
    venue: string
    tick_size: number
    tick_value_usd: number
    currency: string
    specification: Known<'DEMO_ASSUMPTION_NOT_LIVE'>
  }
  account_id: string
  direction: Known<'LONG_ONLY'>
  timeframes: {
    trend_minutes: number
    entry_minutes: number
    refine_minutes: number | null
  }
  trend: {
    ma_type: Known<'SMA'>
    period: number
    slope_bars: number
    require_close_above_ma: boolean
    require_rising_ma: boolean
  }
  entry: {
    type: Known<'PULLBACK_HOLD_BULLISH'>
    ma_type: Known<'SMA'>
    ma_period: number
    tolerance_ticks: number
    confirmation: Known<'CLOSE_GT_OPEN_AND_CLOSE_GT_MA'>
    one_entry_per_signal: boolean
  }
  stop: {
    type: Known<'SWING_LOW_BUFFER'>
    lookback_5m_bars: number
    buffer_ticks: number
  }
  exit: {
    target_r: number
    first_target_close_contracts: number
    remaining_contracts_exit: Known<'STOP_OR_SESSION_CUTOFF'>
  }
  quantity_contracts: number
  risk: {
    max_completed_trades_per_session: number
    consecutive_loss_lock: number
    stop_required: boolean
    no_overnight: boolean
  }
  session: {
    timezone: string
    demo_date: string
    cutoff_local: string
    demo_only: boolean
  }
  approval_status: ApprovalStatus
  simulation_only: boolean
}

// ---------- Errors ----------

export interface ApiErrorBody {
  error: {
    code: string
    message: string
    field: string | null
  }
}

// ---------- GET /api/health ----------

export interface HealthResponse {
  ok: boolean
  contract_version: string
}

// ---------- POST /api/strategies/generate ----------

export interface GenerateStrategyRequest {
  template_id: Known<'ng-long-pullback-v1'>
  /** Only values the user changed: explicit overrides win over Nicrron's reading of the free text. */
  overrides: Record<string, unknown>
  free_text: string
  /** additive: one value per drafting conversation, so PRISM groups the drafts into one session. */
  session_id?: string
}

export type Generator = Known<'NICRRON' | 'PRESET_FALLBACK'>
export type NicrronStatus = Known<'SUCCESS' | 'FAILED' | 'NOT_CONFIGURED' | 'NOT_REQUESTED'>

export interface NicrronMeta {
  status: NicrronStatus
  model_requested: string | null
  model_used: string | null
  cached: boolean
  latency_ms: number | null
  error_code: string | null
  error_message: string | null
  http_status: number | null
  retry_after: string | null
  /** `v1` (baseline) or `v2` (with Knowledge Base context); null without free text. */
  prompt_version?: Known<'v1' | 'v2'> | null
}

/** PRISM Knowledge Base search run before the Nicrron call (prompt v2). */
export interface KnowledgeBaseMeta {
  status: Known<'USED' | 'NO_MATCH' | 'FAILED' | 'NOT_CONFIGURED' | 'NOT_REQUESTED'>
  sources_used: string[]
  error: string | null
  snippets: { source: string; score: number; excerpt: string }[]
}

export interface PrismTraceMeta {
  status: Known<'SENT' | 'FAILED' | 'NOT_CONFIGURED' | 'NOT_REQUESTED'>
  trace_id: string | null
  error: string | null
  session_id: string
  agent_id: string
  /** The knowledge_base_search span sent with the trace (prompt v2). */
  context_span?: Known<'SENT' | 'FAILED'> | null
}

export interface GenerateStrategyResponse {
  strategy: StrategySpec
  /** Plain-language questions. Resolving one means rewriting the free text and generating again. */
  clarification_questions: string[]
  /** "Nicrron: <field> from '<words>'" notes, "RISK_LOOSENED: …" and feature notes. */
  warnings: string[]
  strategy_summary: string
  // additive
  generator?: Generator
  approvable?: boolean
  nicrron?: NicrronMeta
  /** Dotted StrategySpec paths whose values came from the trader's text. */
  interpreted_fields?: string[]
  /** Instructions StrategySpec v1 cannot express; each also appears as a clarification question. */
  unsupported_requirements?: string[]
  prism?: PrismTraceMeta
  knowledge_base?: KnowledgeBaseMeta
}

// ---------- POST /api/strategies/approve ----------

export interface ApproveStrategyRequest {
  strategy_id: string
  version: number
}

export interface ApproveStrategyResponse {
  strategy_id: string
  version: number
  approval_status: ApprovalStatus
  approved_at?: string
}

// ---------- POST /api/scenarios/generate ----------

export interface GenerateScenariosRequest {
  strategy_id: string
  version: number
  seed: number
}

export interface Scenario {
  name: Known<'trend' | 'range' | 'adverse'>
  assumptions: string[]
  narrative: string
  /** Computed by the engine on seeded synthetic candles. Hypothetical, never "expected return". */
  computed_pnl_usd?: number
  // additive
  completed_trades?: number
  entries?: number
  blocked_entries?: number
  entry_locked?: boolean
  lock_reason?: LockReason | null
}

export interface GenerateScenariosResponse {
  synthetic: true
  method: Known<'RULE_BASED_SYNTHETIC_REPLAY'>
  seed: number
  scenarios: Scenario[]
  disclaimer?: string
}

// ---------- POST /api/simulations/start ----------

export type FixtureId = Known<
  'two-loss-lock' | 'winning-reset' | 'cutoff' | 'ambiguous-bar' | 'trend-fail' | 'standard' | 'trend' | 'range' | 'adverse'
>

export interface StartSimulationRequest {
  strategy_id: string
  version: number
  seed: number
  /** Optional; backend default is `standard`. */
  fixture?: FixtureId
}

export type SimulationStatus = Known<'COMPLETED'>

export interface StartSimulationResponse {
  simulation_id: string
  status: SimulationStatus
  seed: number
  fixture?: FixtureId
  strategy_id?: string
  version?: number
}

// ---------- GET /api/simulations/{simulation_id} ----------

export type PrismStatus = 'CONNECTED' | 'LOCAL_ONLY'
export type LockReason = Known<'TWO_CONSECUTIVE_LOSSES' | 'MAX_TRADES'>
export type ExitReason = Known<'TARGET_PARTIAL_EXIT' | 'STOP_HIT' | 'AMBIGUOUS_BAR_STOP_FIRST' | 'CUTOFF_EXIT'>

export interface TradeLeg {
  exit_time: string
  contracts: number
  exit_price: number
  exit_reason: ExitReason
  pnl_usd: number
}

export interface CompletedTrade {
  position_id: string
  realized_pnl_usd: number
  // additive
  status?: Known<'CLOSED'>
  signal_bar_id?: string
  entry_time?: string
  entry_price?: number
  stop_price?: number
  target_price?: number
  initial_risk_ticks?: number
  quantity_contracts?: number
  open_contracts?: number
  legs?: TradeLeg[]
  result?: Known<'WIN' | 'LOSS' | 'BREAKEVEN'>
}

export interface Fill {
  fill_id: string
  timestamp: string
  position_id: string
  side: Known<'BUY' | 'SELL'>
  contracts: number
  price: number
  action: EngineAction
  decision_ref: string
}

export interface SimulationState {
  simulation_id: string
  status: SimulationStatus
  account_id: string
  equity_usd: number
  positions: unknown[]
  completed_trades: CompletedTrade[]
  consecutive_losses: number
  entry_locked: boolean
  lock_reason: LockReason | null
  prism_status: PrismStatus
  // additive
  fixture?: FixtureId
  fixture_description?: string
  seed_affects_candles?: boolean
  starting_equity_usd?: number
  realized_pnl_usd?: number
  completed_trade_count?: number
  blocked_entry_count?: number
  fills?: Fill[]
  assumptions?: string[]
  prism_trace_id?: string | null
  prism_session_id?: string | null
}

// ---------- GET /api/simulations/{simulation_id}/events ----------

export type EngineAction = Known<
  | 'WAIT'
  | 'NO_TRADE'
  | 'OPEN_LONG'
  | 'BLOCK_ENTRY'
  | 'EXIT_PARTIAL'
  | 'EXIT_STOP'
  | 'EXIT_CUTOFF'
  | 'COUNT_LOSS'
  | 'RESET_STREAK'
  | 'LOCK_ENTRIES'
  | 'CLOSE_SESSION'
>

/** DATA and SIGNAL are routine checks (~75 per session); the rest is what a trader reads. */
export type EventCategory = Known<'DATA' | 'SIGNAL' | 'RISK_GATE' | 'EXECUTION' | 'RISK' | 'RISK_LOCK' | 'SESSION'>

export interface AuditEvent {
  event_id: string
  seq: number
  timestamp: string
  rule_id: string
  expected_action: EngineAction
  actual_action: EngineAction
  compliant: boolean
  reason: string
  // additive
  reason_code?: string
  category?: EventCategory
  eligible?: boolean
  position_id?: string | null
  price?: number | null
  pnl_usd?: number | null
  signal_bar_id?: string | null
  /** Gate results on an evaluated bar: trend filter, pullback entry, then the risk gate. */
  trend_ok?: boolean | null
  entry_ok?: boolean | null
  candidate_action?: string | null
  /** "PASS" or "BLOCKED:<reason>". */
  risk_gate_result?: string | null
  session_locked?: boolean | null
  /** Bar data on SIGNAL events (one per completed 5m bar): enough for a close-price + SMA chart. */
  details?: EventDetails | null
}

export interface EventDetails {
  c15?: number
  sma15?: number | null
  sma15_prev?: number | null
  bar5_open?: number
  bar5_low?: number
  bar5_close?: number
  sma5?: number | null
  tolerance_ticks?: number
}

export interface SimulationEventsResponse {
  events: AuditEvent[]
}

// ---------- GET /api/simulations/{simulation_id}/report ----------

export interface SimulationReport {
  simulation_id: string
  synthetic: true
  eligible_decisions: number
  compliant_decisions: number
  /** null when eligible_decisions is 0: show N/A, never 100%. */
  execution_conformance: number | null
  violations: number
  disclaimer: string
  // additive
  metric?: string
  blocked_entries?: number
  completed_trades?: number
  realized_pnl_usd?: number
  prism_status?: PrismStatus
}

// ---------- Client interface shared by the mock and HTTP adapters ----------

export interface TradeAgentApi {
  health(): Promise<HealthResponse>
  generateStrategy(req: GenerateStrategyRequest): Promise<GenerateStrategyResponse>
  approveStrategy(req: ApproveStrategyRequest): Promise<ApproveStrategyResponse>
  generateScenarios(req: GenerateScenariosRequest): Promise<GenerateScenariosResponse>
  startSimulation(req: StartSimulationRequest): Promise<StartSimulationResponse>
  getSimulation(simulationId: string): Promise<SimulationState>
  getSimulationEvents(simulationId: string): Promise<SimulationEventsResponse>
  getSimulationReport(simulationId: string): Promise<SimulationReport>
}
