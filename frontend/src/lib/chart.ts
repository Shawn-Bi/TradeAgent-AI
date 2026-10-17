import { useEffect, useRef, useState } from 'react'
import type { AuditEvent } from '../api'
import type { RunResult } from '../flow/useFlow'
import { hhmm } from './format'

// Shared geometry for the Simulate price chart and the trade strip under it, so both use one time axis.

/** Minutes since midnight, session-local ("…T10:25:00-04:00" → 625). */
export const minutesOf = (ts: string) => {
  const [h, m] = hhmm(ts).split(':').map(Number)
  return h * 60 + m
}

/** 625 → "10:25" */
export const clock = (t: number) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`

/** Left margin holds the 3-decimal price labels; the strip under the chart uses the same margins to line up. */
export const PLOT = { left: 46, right: 16 } as const

/** Container width, tracked with a ResizeObserver. */
export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(760)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.round(entry.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

export interface Bar {
  /** Bar close time, minutes since midnight (the event timestamp is the moment the 5m bar completed). */
  t: number
  close: number
  sma5: number | null
  sma15: number | null
  tolerance: number | null
}

/** One point per completed 5m bar, from the bar data on SIGNAL (and entry/block) events. Events without bar data are skipped. */
export function barsOf(events: AuditEvent[]): Bar[] {
  const byTime = new Map<number, Bar>()
  for (const e of events) {
    const d = e.details
    if (!d || typeof d.bar5_close !== 'number') continue
    const t = minutesOf(e.timestamp)
    if (byTime.has(t)) continue
    byTime.set(t, {
      t,
      close: d.bar5_close,
      sma5: typeof d.sma5 === 'number' ? d.sma5 : null,
      sma15: typeof d.sma15 === 'number' ? d.sma15 : null,
      tolerance: typeof d.tolerance_ticks === 'number' ? d.tolerance_ticks : null,
    })
  }
  return [...byTime.values()].sort((a, b) => a.t - b.t)
}

/** The session clock both visuals share: first completed bar (or 09:30) to the cutoff. */
export function sessionWindow(run: RunResult, cutoff: string) {
  const [ch, cm] = cutoff.split(':').map(Number)
  const end = ch * 60 + cm
  const bars = barsOf(run.events)
  const start = Math.min(bars.length ? bars[0].t : 9 * 60 + 30, end - 60)
  return { start, end }
}

/** Whole hours strictly inside the window, thinned on narrow screens. */
export function hourTicks(start: number, end: number, every: number) {
  const out: number[] = []
  for (let t = Math.ceil((start + 1) / 60) * 60; t < end; t += 60) if ((t / 60) % every === 0) out.push(t)
  return out
}
