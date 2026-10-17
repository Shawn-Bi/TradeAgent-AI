# Deploying TradeAgent AI (Railway, demo day)

Decided by A and Shawn (B) on October 17, 2026 at 2:00 PM EDT. The service runs for **one day only** (today) for the Money Talks 2 demo and judging.

## Decisions

| # | Topic | Decision |
|---|---|---|
| 1 | Public access | **One address.** The backend serves the built frontend, so the site and the API share one origin. No access token goes into the browser bundle. Spending is limited by the Nicrron hourly cap. `DEMO_ACCESS_TOKEN` stays **empty** on Railway. |
| 2 | Services | **One Railway service**: FastAPI serves `/api/*` and the built `frontend/dist`. |
| 3 | Railway account | **Shawn** creates and owns the Railway project and connects GitHub. |
| 4 | Credits and keys | **A's** Nicrron and PRISM credentials, given to Shawn when needed. They go straight into Railway's Variables page; never paste them in Discord, chat, an issue or a commit. |
| 5 | Merging | **A** merges PR #1 (PRISM tracing), then PR #2 (frontend). Deploy from `main` after both are in. |
| 6 | Restarts | Not a concern. State is in memory and is lost on redeploy, which is fine for one day. Just don't redeploy during the pitch. |
| 7 | URL | Railway's default `*.up.railway.app` address. No custom domain. |
| 8 | Fallback | If Railway fails, run locally in mock mode (steps below). The demo must make it **visible** that it's running on the mock. |

## Railway variables (backend)

| Variable | Value |
|---|---|
| `NICRRON_API_KEY` | A's `sk-af-…` key |
| `NICRRON_MAX_CALLS_PER_HOUR` | `20` (default). Each draft from free text is one call. Raise it if judges hit the cap. |
| `NICRRON_MAX_CONCURRENT` | `1` (default) |
| `PRISMTRACE_HOST` | `https://prism.blockconvey.com` |
| `PRISMTRACE_PROJECT_ID` | A's PRISM project ID |
| `PRISMTRACE_API_KEY` | A's `pt-sk-…` key |
| `DEMO_ACCESS_TOKEN` | leave **unset** (decision 1) |
| `CORS_ORIGINS` | not needed on one origin; leave the default |

The `PRISMTRACE_*` variables take effect only once PR #1 is merged. Frontend: no variables. `VITE_*` values are public, so no key ever goes there.

## Still to build before the first deploy

None of this exists yet. Owner: whoever picks it up first; tell the other on Discord.

1. **Serve the frontend from FastAPI.**
   - Mount `frontend/dist` (built assets) after the API routes.
   - Return `index.html` for any non-`/api` path, so the single-page app loads on a refresh.
   - `/api/*` must keep its JSON 404s.
2. **Build and start.** One service with both Python and Node: a `Dockerfile` or Nixpacks config. Roughly:
   - build: `pip install -r backend/requirements.txt` and `cd frontend && npm ci && npm run build`
   - start: `uvicorn backend.main:app --host 0.0.0.0 --port $PORT`
3. **Make mock mode visible** (decision 8). Today the app shows "Built-in demo preset" per draft, but nothing on the page says the whole app is on the mock. Add a permanent label when `VITE_API_MODE=mock`, for example in the paper-trading banner.
4. **Smoke test the Railway URL:**
   - `GET /api/health` returns `{"ok": true}`;
   - the full flow works: free text → clarifications → approve → two-loss lock → audit `CONNECTED`;
   - the PRISM setup doctor shows new live traces.

## Fallback: run locally in mock mode

```bash
cd frontend
npm ci
VITE_API_MODE=mock npm run dev
```

Open http://localhost:5173. Mock mode calls no model and never pretends to read free text, so demo with the preset (leave the free text empty). The real local stack also works offline from Railway, as long as Nicrron is reachable:

```bash
python -m venv .venv && .venv/bin/python -m pip install -r backend/requirements.txt
.venv/bin/python -m uvicorn backend.main:app --port 8000
cd frontend && npm run dev
```

## After the event

- Rotate or revoke the Nicrron and PRISM keys used on Railway.
- Delete the Railway service.
