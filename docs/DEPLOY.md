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

## Deploy pieces (built)

1. **FastAPI serves the frontend.** `backend/main.py` mounts `frontend/dist` (or `FRONTEND_DIST`) at `/` after every API and docs route. The app has no client-side routes, so `index.html` at `/` is enough. Unknown `/api/*` paths keep the JSON `NOT_FOUND`. The demo token guard covers `/api/*` only.
2. **Build and start.** `Dockerfile` (two stages: Node builds `frontend/dist`, then Python runs `uvicorn backend.main:app --host 0.0.0.0 --port $PORT`). `railway.json` selects the Dockerfile and health-checks `/api/health`. `.dockerignore` keeps every `.env` out of the image.
3. **Mock mode is visible.** A build with `VITE_API_MODE=mock` shows a permanent OFFLINE MOCK strip under the banner. The normal build compiles it out.

## Going live (Shawn)

1. Merge #1, #2 and the deploy PR into `main`.
2. In Railway: New Project → Deploy from GitHub repo → `Shawn-Bi/TradeAgent-AI`, branch `main`. Railway picks up `railway.json` and builds the Dockerfile.
3. Variables: set the ones in the table above (A provides the keys). Leave `DEMO_ACCESS_TOKEN` unset.
4. Settings → Networking → Generate Domain for the default `*.up.railway.app` address.
5. Smoke test the URL:
   - `GET /api/health` returns `{"ok": true}`;
   - the full flow works: free text → clarifications → approve → two-loss lock → audit `CONNECTED`;
   - the PRISM setup doctor shows new live traces.
6. Post the URL on Discord for the submission.

## Fallback: run locally in mock mode

```bash
cd frontend
npm ci
VITE_API_MODE=mock npm run dev
```

Open http://localhost:5173. The OFFLINE MOCK strip under the banner confirms the mode. Mock mode calls no model and never pretends to read free text, so demo with the preset (leave the free text empty). The real local stack also works offline from Railway, as long as Nicrron is reachable:

```bash
python -m venv .venv && .venv/bin/python -m pip install -r backend/requirements.txt
.venv/bin/python -m uvicorn backend.main:app --port 8000
cd frontend && npm run dev
```

## After the event

- Rotate or revoke the Nicrron and PRISM keys used on Railway.
- Delete the Railway service.
