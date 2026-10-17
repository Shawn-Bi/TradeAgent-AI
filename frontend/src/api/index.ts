import { createHttpApi } from './http'
import { createMockApi } from './mock'
import type { TradeAgentApi } from './types'

export type ApiMode = 'mock' | 'http'

/** The real backend by default; VITE_API_MODE=mock runs the in-browser mock (offline demo backup). */
export const apiMode: ApiMode = import.meta.env.VITE_API_MODE === 'mock' ? 'mock' : 'http'

/**
 * Empty = same origin: calls go to /api/... In development Vite proxies /api to the backend (vite.config.ts),
 * and in production the backend serves the built frontend from one address, so no access token is ever
 * needed in the browser bundle.
 */
export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? ''

export const api: TradeAgentApi = apiMode === 'http' ? createHttpApi(apiBaseUrl) : createMockApi()

export { ApiError } from './errors'
export type * from './types'
