import { useCallback, useState } from 'react'
import { api, ApiError } from '../api'
import type {
  AuditEvent,
  ClarificationChoice,
  ClarificationQuestion,
  FixtureId,
  GenerateScenariosResponse,
  GenerateStrategyResponse,
  SimulationReport,
  SimulationState,
  StrategySpec,
} from '../api'
import { deepMerge, formToOverrides, specToForm, type PresetForm } from './form'

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

export interface Answered {
  question: string
  source_text: string
  answer: string
}

export interface RunResult {
  fixture: FixtureId
  state: SimulationState
  events: AuditEvent[]
  report: SimulationReport
}

const errorText = (e: unknown) =>
  e instanceof ApiError ? `${e.message} (${e.code})` : e instanceof Error ? e.message : String(e)

export function useFlow() {
  const [step, setStep] = useState(0)
  const [reached, setReached] = useState(0)
  const [form, setForm] = useState<PresetForm>(DEFAULT_FORM)
  const [gen, setGen] = useState<Async<GenerateStrategyResponse>>({ status: 'idle' })
  // The form as the user submitted it, before any clarification rewrote it. "Change answers" restores it.
  const [submitted, setSubmitted] = useState<PresetForm>(DEFAULT_FORM)
  const [answered, setAnswered] = useState<Answered[]>([])
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
    setAnswered([])
    setApproved(null)
    setApproving({ status: 'idle' })
    setScenarios({ status: 'idle' })
    setRuns({})
    setRunning({ status: 'idle' })
    setReached(0)
  }, [])

  /** A new draft from a clarification answer: the old approval and runs no longer apply. */
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

  const requestStrategy = useCallback(async (f: PresetForm, extraOverrides: Record<string, unknown> = {}) => {
    setGen({ status: 'loading' })
    try {
      const data = await api.generateStrategy({
        template_id: TEMPLATE_ID,
        overrides: deepMerge(formToOverrides(f), extraOverrides),
        free_text: f.free_text,
      })
      setGen({ status: 'ready', data })
      // Keep the form in step with what the backend actually produced.
      setForm(specToForm(data.strategy, f.free_text))
    } catch (e) {
      setGen({ status: 'error', error: errorText(e) })
    }
  }, [])

  const generate = useCallback(() => {
    invalidate()
    setSubmitted(form)
    go(1)
    void requestStrategy(form)
  }, [form, go, invalidate, requestStrategy])

  /** Resolving a question is another generate: the choice says which overrides to send and how to rewrite the text. */
  const answer = useCallback(
    (q: ClarificationQuestion, choice: ClarificationChoice) => {
      const free_text = form.free_text.replace(q.source_text, choice.replacement_text).replace(/\s{2,}/g, ' ').trim()
      setAnswered((a) => [...a, { question: q.question, source_text: q.source_text, answer: choice.label }])
      resetDownstream()
      void requestStrategy({ ...form, free_text }, choice.overrides)
    },
    [form, requestStrategy, resetDownstream],
  )

  const changeAnswers = useCallback(() => {
    setAnswered([])
    resetDownstream()
    void requestStrategy(submitted)
  }, [submitted, requestStrategy, resetDownstream])

  const approve = useCallback(async () => {
    if (gen.status !== 'ready') return
    const { strategy } = gen.data
    setApproving({ status: 'loading' })
    try {
      await api.approveStrategy({ strategy_id: strategy.strategy_id, version: strategy.version })
      setApproved({ spec: { ...strategy, approval_status: 'APPROVED' }, at: new Date() })
      setApproving({ status: 'idle' })
      setReached((r) => Math.max(r, 3))
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

  const runSimulation = useCallback(async () => {
    if (!approved) return
    setRunning({ status: 'loading' })
    try {
      const ref = { strategy_id: approved.spec.strategy_id, version: approved.spec.version }
      const { simulation_id } = await api.startSimulation({ ...ref, seed: SEED, fixture })
      const [state, { events }, report] = await Promise.all([
        api.getSimulation(simulation_id),
        api.getSimulationEvents(simulation_id),
        api.getSimulationReport(simulation_id),
      ])
      // Runs are kept per fixture, so switching sessions never throws away an earlier result.
      setRuns((r) => ({ ...r, [fixture]: { fixture, state, events, report } }))
      setRunning({ status: 'idle' })
      setReached((r) => Math.max(r, 5))
    } catch (e) {
      setRunning({ status: 'error', error: errorText(e) })
    }
  }, [approved, fixture])

  return {
    step,
    reached,
    go,
    form,
    updateForm,
    gen,
    generate,
    answered,
    answer,
    changeAnswers,
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
  }
}

export type Flow = ReturnType<typeof useFlow>
