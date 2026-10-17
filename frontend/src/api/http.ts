import { ApiError, isApiErrorBody } from './errors'
import type { TradeAgentApi } from './types'

/** Adapter for owner B's FastAPI backend. Routes are frozen in docs/PRD.md section 8. */
export function createHttpApi(baseUrl: string): TradeAgentApi {
  const root = baseUrl.replace(/\/+$/, '')

  async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    let res: Response
    try {
      res = await fetch(`${root}${path}`, {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch {
      throw new ApiError(0, {
        error: { code: 'NETWORK_ERROR', message: `Cannot reach the backend at ${root}.`, field: null },
      })
    }

    const data: unknown = await res.json().catch(() => null)
    if (!res.ok) {
      throw new ApiError(
        res.status,
        isApiErrorBody(data)
          ? data
          : { error: { code: `HTTP_${res.status}`, message: res.statusText || 'Request failed', field: null } },
      )
    }
    return data as T
  }

  const sim = (id: string) => `/api/simulations/${encodeURIComponent(id)}`

  return {
    health: () => request('GET', '/api/health'),
    generateStrategy: (req) => request('POST', '/api/strategies/generate', req),
    approveStrategy: (req) => request('POST', '/api/strategies/approve', req),
    generateScenarios: (req) => request('POST', '/api/scenarios/generate', req),
    startSimulation: (req) => request('POST', '/api/simulations/start', req),
    getSimulation: (id) => request('GET', sim(id)),
    getSimulationEvents: (id) => request('GET', `${sim(id)}/events`),
    getSimulationReport: (id) => request('GET', `${sim(id)}/report`),
  }
}
