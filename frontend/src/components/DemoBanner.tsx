/** Fixed marker strip above every screen. Never dismissible. */
export function DemoBanner() {
  return (
    <div className="ta-banner" role="note">
      <div className="ta-wrap flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
        <strong>PAPER TRADING</strong>
        <span>No real money, no broker connection. Synthetic market data, not a historical backtest.</span>
      </div>
    </div>
  )
}
