// Types for the frozen v1 contract: contracts/strategy.example.json and docs/PRD.md section 8.
// Field names must match the backend exactly. Do not rename or add fields without agreeing with B.
//
// Where the PRD leaves a shape open (positions, completed_trades, clarification_questions) the
// type below is provisional and marked PROVISIONAL. Confirm it with B before relying on it.

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
  overrides: Record<string, unknown>
  free_text: string
}

/**
 * PROVISIONAL: the PRD shows `clarification_questions: []` without an item shape.
 * Proposed to B: each choice carries the exact overrides to send back and the text that replaces the
 * ambiguous phrase, so resolving a question is just another POST /api/strategies/generate.
 */
export interface ClarificationChoice {
  label: string
  overrides: Record<string, unknown>
  /** Replaces `source_text` in free_text. Empty string removes the phrase. */
  replacement_text: string
}

export interface ClarificationQuestion {
  id: string
  field: string | null
  /** The user's own words, quoted back exactly. */
  source_text: string
  question: string
  choices: ClarificationChoice[]
  /** When set, the user may type their own value in this unit instead of picking a choice. */
  custom?: { unit: 'ticks'; field: string; min: number; max: number }
}

export interface GenerateStrategyResponse {
  strategy: StrategySpec
  clarification_questions: ClarificationQuestion[]
  warnings: string[]
  strategy_summary: string
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
  /** Only present when computed by the engine replay. Never fabricated; omitted if not wired. */
  computed_pnl_usd?: number
}

export interface GenerateScenariosResponse {
  synthetic: true
  method: Known<'RULE_BASED_SYNTHETIC_REPLAY'>
  seed: number
  scenarios: Scenario[]
}

// ---------- POST /api/simulations/start ----------

export type FixtureId = Known<'standard' | 'two-loss-lock'>

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
}

// ---------- GET /api/simulations/{simulation_id} ----------

export type PrismStatus = 'CONNECTED' | 'LOCAL_ONLY'

/** PROVISIONAL: the PRD shows `positions: []` without an item shape. */
export interface Position {
  position_id: string
  contracts: number
  entry_price?: number
  stop_price?: number
  target_price?: number
}

/** PROVISIONAL: the PRD shows `completed_trades: []` without an item shape. */
export interface CompletedTrade {
  position_id: string
  contracts: number
  entry_price: number
  /** Volume-weighted exit across partial exits. */
  exit_price: number
  exit_reason: Known<'STOP' | 'TARGET_THEN_STOP' | 'TARGET_THEN_CUTOFF' | 'CUTOFF'>
  realized_pnl_usd: number
}

export interface SimulationState {
  simulation_id: string
  status: SimulationStatus
  account_id: string
  equity_usd: number
  positions: Position[]
  completed_trades: CompletedTrade[]
  consecutive_losses: number
  entry_locked: boolean
  lock_reason: Known<'TWO_CONSECUTIVE_LOSSES'> | null
  prism_status: PrismStatus
}

// ---------- GET /api/simulations/{simulation_id}/events ----------

/** OPEN_LONG, BLOCK_ENTRY and NO_TRADE come from the docs; the rest are PROVISIONAL, proposed to B. */
export type EngineAction = Known<
  'OPEN_LONG' | 'BLOCK_ENTRY' | 'NO_TRADE' | 'EXIT_ALL' | 'EXIT_PARTIAL' | 'EXIT_REMAINDER' | 'LOCK_ENTRIES' | 'NO_ACTION'
>

export interface AuditEvent {
  event_id: string
  seq: number
  timestamp: string
  rule_id: string
  expected_action: EngineAction
  actual_action: EngineAction
  compliant: boolean
  reason: string
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
