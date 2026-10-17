import { STEPS } from '../flow/useFlow'

/** The six-step rail. Steps up to `reached` are buttons; later ones stay disabled until earned. */
export function WizardSteps({ current, reached, onGo }: { current: number; reached: number; onGo: (i: number) => void }) {
  return (
    <ol className="ta-steps" aria-label="Progress">
      {STEPS.map((name, i) => (
        <li key={name} className={i === current ? 'current' : i < reached || i < current ? 'done' : undefined}>
          <button
            type="button"
            disabled={i > reached}
            aria-current={i === current ? 'step' : undefined}
            onClick={() => onGo(i)}
          >
            <span className="n">{i + 1}</span>
            {name}
          </button>
        </li>
      ))}
    </ol>
  )
}
