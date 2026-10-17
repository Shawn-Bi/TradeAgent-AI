import type { ReactNode } from 'react'

export function StepHead({ title, sub, right }: { title: string; sub: ReactNode; right?: ReactNode }) {
  return (
    <div className="ta-step-head">
      <div>
        <h2>{title}</h2>
        <p>{sub}</p>
      </div>
      {right}
    </div>
  )
}

export function Card({
  title,
  right,
  tone,
  children,
  className = '',
}: {
  title?: ReactNode
  right?: ReactNode
  tone?: 'draft' | 'approved' | 'locked'
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`ta-card ${tone ? `ta-card--${tone}` : ''} ${className}`}>
      {title !== undefined && (
        <div className="ta-card__head">
          <h3>{title}</h3>
          {right}
        </div>
      )}
      {children}
    </section>
  )
}

export function Nav({ back, children }: { back?: () => void; children?: ReactNode }) {
  return (
    <div className="ta-nav">
      {back ? (
        <button type="button" className="ta-btn" onClick={back}>
          Back
        </button>
      ) : (
        <span />
      )}
      <div className="ta-row">{children}</div>
    </div>
  )
}

export function Working({ label }: { label: string }) {
  return (
    <div className="ta-working" role="status">
      <i aria-hidden="true" />
      {label} · Working…
    </div>
  )
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="ta-card ta-card--locked" role="alert">
      <div className="ta-card__head">
        <h3>Something went wrong</h3>
      </div>
      <div className="ta-card__body ta-row">
        <span>{message}</span>
        {onRetry && (
          <button type="button" className="ta-btn" onClick={onRetry}>
            Try again
          </button>
        )}
      </div>
    </div>
  )
}
