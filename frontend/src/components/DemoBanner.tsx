import { apiMode } from '../api'

/** Fixed marker strip above every screen. Never dismissible. */
export function DemoBanner() {
  return (
    <div role="note">
      <div className="ta-banner">
        <div className="ta-wrap flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
          <strong>PAPER TRADING</strong>
          <span>No real money, no broker connection. Synthetic market data, not a historical backtest.</span>
        </div>
      </div>
      {apiMode === 'mock' && (
        // The offline fallback (docs/DEPLOY.md) must never pass for the real app.
        <div className="border-b-2 border-blocked bg-blocked-soft text-blocked">
          <div className="ta-wrap flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-code">
            <strong className="font-mono">OFFLINE MOCK</strong>
            <span>
              Backup mode: no backend, no AI model, no PRISM. Results come from a built-in stand-in, so use the demo
              preset.
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
