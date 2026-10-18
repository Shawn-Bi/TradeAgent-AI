# TradeAgent AI frontend

React + TypeScript + Vite + Tailwind v4 + shadcn/ui (Radix). Built by [@antunishdPursuit](https://github.com/antunishdPursuit). Port 5173.

```bash
npm ci
npm run dev      # http://localhost:5173
npm run build    # tsc -b + vite build
npm run lint     # oxlint, 0 findings expected
npm run tokens   # after editing design/tokens.json; commit the generated CSS
```

## Running against the backend

Start the backend on port 8000 (see the repo README), then `npm run dev`. The app calls relative `/api/...` paths and Vite proxies them to `VITE_PROXY_TARGET` (default `http://localhost:8000`), so development works like the single-origin deployment and needs no CORS or token in the browser.

```bash
VITE_API_MODE=mock          # optional: in-browser mock instead of the backend (offline demo backup, shows an OFFLINE MOCK strip)
VITE_PROXY_TARGET=http://localhost:8000
```

Never put a key or token in a `VITE_` variable: it ends up in the public bundle.

## API adapter

`src/api/types.ts` follows `../backend/API.md`: the frozen PRD fields plus the documented additive ones (`generator`, `nicrron`, `interpreted_fields`, `unsupported_requirements`, `prism`, trade `legs`, event `category`, …). `http.ts` is the fetch adapter; `mock.ts` returns the same shapes offline and, with no model, never pretends to have read free text.

## Flow

`src/flow/useFlow.ts` holds the wizard state: Preset → Generate → Approve → Scenario → Simulate → Audit (`src/screens/`).

- Generate sends only the values the user changed (explicit overrides win over Nicrron's reading of the text) and one `session_id` per drafting conversation, so PRISM groups the drafts.
- Clarification questions are answered by rewriting the rules in the rewrite box and generating again; the version is approvable only when the backend says so.
- Any rule change returns to DRAFT and clears approval and runs, after a confirmation if it would drop an approved version. Runs are kept per session (fixture).
- The decision log hides routine `SIGNAL`/`DATA` checks by default.
- Visualizations (`src/components/`): `AgentTrace` (Nicrron and PRISM trace card), `PriceChart`, `DecisionFunnel`, `ConformanceStrip` and `RiskLadder`.

## Styles

- `design/tokens.json` is the single source of the design system. `npm run tokens` (`scripts/build-tokens.mjs`) generates:
  - `src/styles/tokens.css`: design tokens for light and dark, the type scale and the shadcn semantic aliases;
  - `src/styles/theme.css`: the Tailwind theme. Tailwind's default colours are cleared, so only design-system colours, radii and type sizes exist (`bg-panel`, `text-ink-muted`, `border-line`, `text-title`).
- `src/styles/components.css`: `ta-*` component classes from the design system bundle.
- `src/styles/app.css`: layout classes (step rail, form, KPI strip, phone row cards) from the clickable prototype.
- `src/components/ui/`: shadcn/ui components restyled to the tokens. Use `cn` from `@/lib/utils`, which knows the custom type scale.
- Geist and Geist Mono are bundled, so the demo works without a network connection.
