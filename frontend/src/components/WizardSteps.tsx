const WIZARD_STEPS = ['Preset', 'Generate', 'Approve', 'Scenario', 'Simulate', 'Audit'] as const

/** The fixed six-step path. Steps before `current` render done. */
export function WizardSteps({ current }: { current: number }) {
  return (
    <ol className="ta-steps" aria-label="Progress">
      {WIZARD_STEPS.map((name, i) => (
        <li
          key={name}
          className={i < current ? 'done' : i === current ? 'current' : undefined}
          aria-current={i === current ? 'step' : undefined}
        >
          <span className="n">{i + 1}</span>
          {name}
        </li>
      ))}
    </ol>
  )
}
