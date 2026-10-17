# TradeAgent AI frontend

React + TypeScript + Tailwind (Vite). Owner A. Port 5173.

```bash
npm install
npm run dev
```

## API adapter

`src/api/` holds the typed client for the frozen v1 contract (`../contracts/strategy.example.json`, `../docs/PRD.md` section 8).

- `types.ts`: request and response types. Fields marked PROVISIONAL (`positions`, `completed_trades`, `clarification_questions` items) are not specified in the PRD yet; confirm with B.
- `mock.ts`: in-browser mock with the same shapes. It reads the contract and `../two_loss_lock.fixture.json` directly, never computes P&L, and always reports `LOCAL_ONLY`.
- `http.ts`: fetch adapter for B's FastAPI backend.

Pick the adapter with env vars (copy `.env.example` to `.env`):

```bash
VITE_API_MODE=mock                       # default
VITE_API_MODE=http                       # call the backend
VITE_API_BASE_URL=http://localhost:8000
```

## Flow

`src/flow/useFlow.ts` holds the wizard state: Preset → Generate → Approve → Scenario → Simulate → Audit (`src/screens/`). Any rule change returns to DRAFT and clears approval and runs. A clarification answer is another `generate` call with the choice's overrides. Runs are kept per fixture.

The mock replays a fixed synthetic market per fixture, so changing a rule changes the outcome, never the prices. Free-text interpretation travels in `warnings` with `APPLIED` / `NOT_APPLIED` / `PRESET_FALLBACK` prefixes (`src/lib/warnings.ts`); this convention is proposed to B, not yet agreed.

## Styles

- `src/styles/tokens.css`: design tokens, generated from the team design system's `tokens.json` (light and dark).
- `src/styles/components.css`: `ta-*` component classes from the design system bundle.
- `src/styles/app.css`: layout classes (step rail, form, KPI strip, phone row cards) from the clickable prototype.
- `src/index.css`: maps tokens into Tailwind (`bg-panel`, `text-ink-muted`, `border-line`, `text-title`, `rounded-lg`). The default Tailwind colour palette is disabled, so only design-system colours exist.
