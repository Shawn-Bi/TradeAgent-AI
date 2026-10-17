import { Check } from 'lucide-react'
import { STEPS } from '../flow/useFlow'

/** The six-step rail. Steps up to `reached` are buttons; later ones stay disabled until earned. */
export function WizardSteps({ current, reached, onGo }: { current: number; reached: number; onGo: (i: number) => void }) {
  return (
    <ol className="ta-steps" aria-label="Progress">
      {STEPS.map((name, i) => {
        const done = i < current || (i < reached && i !== current)
        return (
          <li key={name} className={i === current ? 'current' : done ? 'done' : undefined}>
            <button
              type="button"
              disabled={i > reached}
              aria-current={i === current ? 'step' : undefined}
              onClick={() => onGo(i)}
            >
              {done ? <Check className="size-3.5 self-center" aria-label="done" /> : <span className="n">{i + 1}</span>}
              {name}
            </button>
          </li>
        )
      })}
    </ol>
  )
}
