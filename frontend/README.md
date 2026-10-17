# TradeAgent AI frontend

React + TypeScript + Tailwind (Vite). Owner A. Port 5173.

```bash
npm install
npm run dev
```

## Running against the backend

Start B's backend on port 8000 (see the repo README), then `npm run dev`. The app calls relative `/api/...` paths and Vite proxies them to `VITE_PROXY_TARGET` (default `http://localhost:8000`), so development works like a same-origin deployment and needs no CORS or token in the browser.

```bash
VITE_API_MODE=mock          # optional: in-browser mock instead of the backend (offline demo backup)
VITE_PROXY_TARGET=http://localhost:8000
```

Never put a key or token in a `VITE_` variable: it ends up in the public bundle.

## API adapter

`src/api/types.ts` follows `../backend/API.md`: the frozen PRD fields plus the documented additive ones (`generator`, `nicrron`, `interpreted_fields`, `unsupported_requirements`, `prism`, trade `legs`, event `category`, …). `http.ts` is the fetch adapter; `mock.ts` returns the same shapes offline and, with no model, never pretends to have read free text.

## Flow

`src/flow/useFlow.ts` holds the wizard state: Preset → Generate → Approve → Scenario → Simulate → Audit (`src/screens/`).

- Generate sends only the values the user changed (explicit overrides win over Nicrron's reading of the text) and one `session_id` per drafting conversation, so PRISM groups the drafts.
- Clarification questions are answered by rewriting the text and generating again; the version is approvable only when the backend says so.
- Any rule change returns to DRAFT and clears approval and runs. Runs are kept per session (fixture).
- The decision log hides routine `SIGNAL`/`DATA` checks by default.

## Styles

- `src/styles/tokens.css`: design tokens, generated from the team design system's `tokens.json` (light and dark).
- `src/styles/components.css`: `ta-*` component classes from the design system bundle.
- `src/styles/app.css`: layout classes (step rail, form, KPI strip, phone row cards) from the clickable prototype.
- `src/index.css`: maps tokens into Tailwind (`bg-panel`, `text-ink-muted`, `border-line`, `text-title`, `rounded-lg`). The default Tailwind colour palette is disabled, so only design-system colours exist.
