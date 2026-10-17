const money = (n: number) =>
  Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** $1,234.56 or −$1,234.56 (true minus sign). */
export const usd = (n: number) => `${n < 0 ? '−' : ''}$${money(n)}`

/** +$1.00 / −$1.00 / $0.00 */
export const signedUsd = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}$${money(n)}`

/** NG prices are quoted to the tick: 0.001 USD/MMBtu. */
export const price = (n: number) => n.toFixed(3)

/** "2026-10-17T14:00:00-04:00" → "14:00" (already session-local). */
export const hhmm = (timestamp: string) => timestamp.slice(11, 16)

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
