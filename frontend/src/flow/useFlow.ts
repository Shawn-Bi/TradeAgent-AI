import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { api, ApiError } from '../api'
import type {
  AuditEvent,
  FixtureId,
  GenerateScenariosResponse,
  GenerateStrategyResponse,
  SimulationReport,
  SimulationState,
  StrategySpec,
} from '../api'
import { signedUsd } from '../lib/format'
import { summarize } from '../lib/summary'
import { fixtureLabel, FIXTURES } from '../screens/fixtures'
import { formToOverrides, type PresetForm } from './form'

export const STEPS = ['Preset', 'Generate', 'Approve', 'Scenario', 'Simulate', 'Audit'] as const
export const SEED = 42
const TEMPLATE_ID = 'ng-long-pullback-v1'

export const DEFAULT_FORM: PresetForm = {
  trend_minutes: 15,
  entry_minutes: 5,
  ma_period: 20,
  tolerance_ticks: 3,
  buffer_ticks: 4,
  target_r: 1.2,
  cutoff_local: '16:00',
  free_text: '',
}

type Async<T> = { status: 'idle' } | { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error'; error: string }

export interface RunResult {
  fixture: FixtureId
  state: SimulationState
  events: AuditEvent[]
  report: SimulationReport
}

const newSessionId = () => `draft-${crypto.randomUUID().slice(0, 12)}`

const errorText = (e: unknown) =>
  e instanceof ApiError ? `${e.message} (${e.code})` : e instanceof Error ? e.message : String(e)

export function useFlow() {
  const [step, setStep] = useState(0)
  const [reached, setReached] = useState(0)
  const [form, setForm] = useState<PresetForm>(DEFAULT_FORM)
  const [gen, setGen] = useState<Async<GenerateStrategyResponse>>({ status: 'idle' })
  // One PRISM session per drafting conversation: every regenerate after a clarification shares it.
  const [sessionId, setSessionId] = useState(newSessionId)
  const [approved, setApproved] = useState<{ spec: StrategySpec; at: Date } | null>(null)
  const [approving, setApproving] = useState<Async<null>>({ status: 'idle' })
  const [scenarios, setScenarios] = useState<Async<GenerateScenariosResponse>>({ status: 'idle' })
  const [fixture, setFixture] = useState<FixtureId>('two-loss-lock')
  const [runs, setRuns] = useState<Record<string, RunResult>>({})
  const [running, setRunning] = useState<Async<null>>({ status: 'idle' })

  const go = useCallback((i: number) => {
    setStep(i)
    setReached((r) => Math.max(r, i))
    window.scrollTo({ top: 0 })
  }, [])

  /** Any rule change returns to DRAFT: approval, scenarios and runs belong to the old version. */
  const invalidate = useCallback(() => {
    setGen({ status: 'idle' })
    setApproved(null)
    setApproving({ status: 'idle' })
    setScenarios({ status: 'idle' })
    setRuns({})
    setRunning({ status: 'idle' })
    setReached(0)
  }, [])

  /** A new draft from rewritten text: the old approval and runs no longer apply. */
  const resetDownstream = useCallback(() => {
    setApproved(null)
    setApproving({ status: 'idle' })
    setScenarios({ status: 'idle' })
    setRuns({})
    setRunning({ status: 'idle' })
    setReached(1)
  }, [])

  const updateForm = useCallback(
    (patch: Partial<PresetForm>) => {
      setForm((f) => ({ ...f, ...patch }))
      invalidate()
    },
    [invalidate],
  )

  const requestStrategy = useCallback(async (f: PresetForm) => {
    setGen({ status: 'loading' })
    try {
      const data = await api.generateStrategy({
        template_id: TEMPLATE_ID,
        overrides: formToOverrides(f, DEFAULT_FORM),
        free_text: f.free_text,
        session_id: sessionId,
      })
      // The form keeps only what the user set; screens read the proposed strategy from the response.
      setGen({ status: 'ready', data })
    } catch (e) {
      setGen({ status: 'error', error: errorText(e) })
    }
  }, [sessionId])

  const generate = useCallback(() => {
    invalidate()
    go(1)
    void requestStrategy(form)
  }, [form, go, invalidate, requestStrategy])

  /** Clarification questions are answered by rewriting the text and generating again (backend/API.md). */
  const regenerate = useCallback(
    (free_text: string) => {
      const next = { ...form, free_text }
      setForm(next)
      resetDownstream()
      void requestStrategy(next)
    },
    [form, requestStrategy, resetDownstream],
  )

  const approve = useCallback(async () => {
    if (gen.status !== 'ready') return
    const { strategy } = gen.data
    setApproving({ status: 'loading' })
    try {
      await api.approveStrategy({ strategy_id: strategy.strategy_id, version: strategy.version })
      setApproved({ spec: { ...strategy, approval_status: 'APPROVED' }, at: new Date() })
      setApproving({ status: 'idle' })
      setReached((r) => Math.max(r, 3))
      toast.success(`Version ${strategy.version} approved and locked`, {
        description: 'Only this exact version can run. Changing a value creates a new draft.',
      })
    } catch (e) {
      setApproving({ status: 'error', error: errorText(e) })
    }
  }, [gen])

  const loadScenarios = useCallback(async () => {
    if (!approved) return
    go(3)
    if (scenarios.status === 'ready') return
    setScenarios({ status: 'loading' })
    try {
      const data = await api.generateScenarios({
        strategy_id: approved.spec.strategy_id,
        version: approved.spec.version,
        seed: SEED,
      })
      setScenarios({ status: 'ready', data })
    } catch (e) {
      setScenarios({ status: 'error', error: errorText(e) })
    }
  }, [approved, go, scenarios.status])

  const runOne = useCallback(
    async (id: FixtureId): Promise<RunResult> => {
      if (!approved) throw new Error('Approve a version first.')
      const ref = { strategy_id: approved.spec.strategy_id, version: approved.spec.version }
      const { simulation_id } = await api.startSimulation({ ...ref, seed: SEED, fixture: id })
      const [state, { events }, report] = await Promise.all([
        api.getSimulation(simulation_id),
        api.getSimulationEvents(simulation_id),
        api.getSimulationReport(simulation_id),
      ])
      const run = { fixture: id, state, events, report }
      // Runs are kept per fixture, so switching sessions never throws away an earlier result.
      setRuns((r) => ({ ...r, [id]: run }))
      return run
    },
    [approved],
  )

  const runSimulation = useCallback(
    async (which: 'current' | 'all' = 'current') => {
      setRunning({ status: 'loading' })
      try {
        const ids = which === 'all' ? FIXTURES.map((f) => f.id) : [fixture]
        for (const id of ids) {
          const s = summarize(await runOne(id))
          toast(`${fixtureLabel(id)} finished`, {
            description: `${signedUsd(s.pnl)} · ${s.trades} trades · ${s.blocked} entries blocked`,
          })
        }
        setRunning({ status: 'idle' })
        setReached((r) => Math.max(r, 5))
      } catch (e) {
        setRunning({ status: 'error', error: errorText(e) })
      }
    },
    [fixture, runOne],
  )

  /** Back to the demo defaults, as if starting fresh. */
  const startOver = useCallback(() => {
    setForm(DEFAULT_FORM)
    setSessionId(newSessionId())
    invalidate()
    go(0)
  }, [go, invalidate])

  return {
    step,
    reached,
    go,
    form,
    updateForm,
    gen,
    generate,
    regenerate,
    sessionId,
    approved,
    approving,
    approve,
    scenarios,
    loadScenarios,
    fixture,
    setFixture,
    runs,
    running,
    runSimulation,
    startOver,
  }
}

export type Flow = ReturnType<typeof useFlow>
