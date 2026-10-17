# AGENTS.md

Guidance for AI coding agents (Claude Code, Codex, Cursor and others) and for people working in this repo. Read this before changing anything.

## What this is

TradeAgent AI is a **simulation-only** paper-trading demo (Money Talks 2 hackathon, Money Intelligence track):

1. A trader writes intraday rules in plain English.
2. Nicrron (an LLM, `backend/nicrron_client.py`) proposes a StrategySpec **draft** and clarification questions.
3. The trader approves one exact, immutable version.
4. A deterministic Python engine (`simulation/`) replays synthetic sessions and audits every decision.
5. Each model call is traced to PRISM (`backend/prism_client.py`), after a PRISM Knowledge Base search (`backend/kb_client.py`).

**The model only proposes; the engine enforces.** Keep it that way.

## Layout

| Path | What |
|---|---|
| `contracts/strategy.example.json` | Frozen StrategySpec v1, the single source of the schema |
| `docs/PRD.md` §8, `backend/API.md` | Frozen routes and fields, plus the documented *additive* fields |
| `backend/` | FastAPI app (`main.py`), strategy versions/approval, Nicrron, PRISM, KB clients, settings (`config.py`) |
| `simulation/` | Deterministic engine, risk gate, synthetic candles and fixtures |
| `frontend/` | React + TS + Vite + Tailwind v4 + shadcn/ui (Radix); `frontend/README.md` |
| `frontend/design/tokens.json` | Design system source; `npm run tokens` generates `src/styles/tokens.css` and `theme.css` |
| `docs/kb/` | Knowledge Base sources uploaded to PRISM; `EVALUATOR.md` is the evaluator rubric |
| `scripts/eval_run.py`, `tests/eval/` | v1 vs v2 prompt evaluation harness (63 inputs) |
| `docs/DEPLOY.md` | Deploy decisions and steps (owned by Shawn). The live demo is on Render: https://tradeagent-ai.onrender.com |

## Commands

```bash
# backend (repo root)
python -m venv .venv && .venv/bin/python -m pip install -r backend/requirements.txt
.venv/bin/python -m pytest -q                      # must stay green; tests never touch the network
.venv/bin/python -m uvicorn backend.main:app --reload --port 8000

# frontend
cd frontend && npm ci
npm run dev        # http://localhost:5173, /api proxied to :8000
npm run build      # tsc -b + vite build
npm run lint       # oxlint, 0 findings expected
npm run tokens     # after editing design/tokens.json; commit the generated CSS
VITE_API_MODE=mock npm run dev                    # offline backup; shows an OFFLINE MOCK strip
```

## Rules that matter here

**Contract**
- Never rename or remove frozen routes or fields. New response fields are additive and documented in `backend/API.md`. Request models are strict (`extra="forbid"`), so a new request field must ship in the backend before any client sends it.
- Any change to a strategy creates a new DRAFT version; approved versions are immutable.

**Safety and honesty**
- Never weaken the approval gate, the risk gate or `_drop_protected`, and never let model output set protected keys.
- Everything is synthetic: label it. Never show a win rate, drawdown, expected return or "backtest". Rule-following is not profitability.
- Show `CONNECTED`, scores or clusters only when they are real (an accepted PRISM trace, real eval output). Never ship placeholder numbers.

**Secrets and cost**
- Keys live only in git-ignored `backend/.env` or the host's variables. Never open, print, log, commit or paste them, and never put a key or token in a `VITE_` variable (it ends up in the public bundle).
- Each free-text generate is a paid Nicrron call, capped by `NICRRON_MAX_CALLS_PER_HOUR`. Use the preset path (empty free text) for UI checks, and run the eval batch locally (`scripts/eval_run.py` starts its own backend), never against the deployed site.
- PRISM must never block or crash a request: catch everything, report `FAILED`, carry on.

**Frontend**
- Only design tokens: Tailwind token classes (`bg-panel`, `text-ink-muted`, `text-code` …) or `var(--token)`. No new colours, no shadows, radius ≤ 6px.
- `compliant` (blue) and `blocked` (orange) always come with a word, never red/green alone.
- Use `cn` from `@/lib/utils` (it knows the custom type scale) and the shared components (`components/Layout`, `StatusPill`, `Term`, `ui/*`).
- No horizontal scroll at 375px. Check both light and dark. Make it keyboard accessible, and give SVGs text alternatives.

**Backend**
- Read settings through `backend/config.py:setting`.
- Tests mock Nicrron and PRISM with `httpx.MockTransport`; the autouse fixture in `tests/conftest.py` fails any live request. Add a test with every fix.

## How to work

- Pull `main` before starting; branch per change (`feat/…`, `fix/…`, `docs/…`); open a PR, don't push to `main`.
- **Commit in verified blocks.** Each commit builds, lints and passes the tests on its own; say what you verified in the message. No giant mixed commits.
- When several agents work at once, give each its own git worktree and branch, and keep their file sets disjoint.
- Verify UI changes in a real browser (desktop and phone width) before calling them done. Report anything you couldn't verify as unverified.
- Don't edit the deploy files (`Dockerfile`, `railway.json`, `docs/DEPLOY.md`) without checking with Shawn.

## Local gotcha

If the repo lives in an iCloud-synced folder (macOS "Desktop & Documents"), iCloud creates untracked `name 2.py` / `name 3.json` conflict copies when git rewrites files. They're not part of the project. Keep clones outside synced folders (for example `~/Code`).
