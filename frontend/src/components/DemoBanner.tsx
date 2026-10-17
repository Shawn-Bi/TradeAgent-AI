/** Fixed marker strip above every screen. Never dismissible. */
export function DemoBanner({ symbol, accountId }: { symbol: string; accountId: string }) {
  return (
    <div className="ta-banner" role="note">
      <strong>DEMO-ONLY</strong>
      <span>Demo only. No real trades, no broker connection.</span>
      <span className="ta-mono">
        {symbol} · {accountId}
      </span>
    </div>
  )
}
