import { createHttpApi } from './http'
import { createMockApi } from './mock'
import type { TradeAgentApi } from './types'

export type ApiMode = 'mock' | 'http'

/** VITE_API_MODE=http calls the backend; anything else uses the in-browser mock. */
export const apiMode: ApiMode = import.meta.env.VITE_API_MODE === 'http' ? 'http' : 'mock'
export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

export const api: TradeAgentApi = apiMode === 'http' ? createHttpApi(apiBaseUrl) : createMockApi()

export { ApiError } from './errors'
export type * from './types'
