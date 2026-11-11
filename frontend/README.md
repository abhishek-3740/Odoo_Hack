# DealFlow360 — frontend

The React 19 + TypeScript client for DealFlow360. It contains three connected experiences on one design system: the public landing and catalogue, the staff workspace at `/admin`, and the customer deal room at `/customer`.

Every price, policy decision, approval sequence, stock reservation, and proration is resolved by the backend. This application asks and displays; it never decides.

## Running it

```bash
npm install
npm run dev          # http://127.0.0.1:3001
```

`npm run dev` starts the **frontend only** and proxies `/api` and `/ws` to `API_PROXY_TARGET` (default `http://127.0.0.1:8080`). It prints that address on startup and warns if nothing is answering.

The backend lives in [`../backend_fastapi`](../backend_fastapi). Start it with the demo flags enabled:

```bash
cd ../backend_fastapi
# activate the virtual environment first
python -m uvicorn app.main:app --host 127.0.0.1 --port 8080 --reload
```

The backend's `APP_ALLOWED_ORIGINS` controls CORS for direct API calls. The Vite proxy keeps `/api` and `/ws` same-origin, so the default dev setup works without it; add this origin if you call the API directly:

```ini
APP_ALLOWED_ORIGINS=http://localhost:3001,http://127.0.0.1:3001
```

WebSocket connections authenticate with the session bearer token (or a `?token=` query parameter), not with a browser origin.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on 3001 with `strictPort` |
| `npm run build` | Typecheck, then production build with the landing page's SEO head injected |
| `npm run preview` | Serve the build with the same API proxy |
| `npm run typecheck` | TypeScript only |
| `npm run lint` | ESLint, zero warnings tolerated |
| `npm test` | Vitest unit tests |
| `npm run test:e2e` | Playwright browser journeys |

> **The browser journeys write real data.** They create quotations, record approvals, and accept terms. Point `API_PROXY_TARGET` at a disposable demo database and never run them against production or customer data.

For a read-only visual pass, `node shots.mjs` captures every screen at desktop and mobile widths into `shots/` (git-ignored). Start the frontend and backend first; set `BASE` to point at another URL.

## How it is organised

```text
src/
  api/             Typed contracts and one resource module per domain
  app/             Router, providers, query policy, route boundaries
  auth/            Token adapters (local / demo / Supabase-ready), capabilities
  design-system/   Shared primitives with loading, empty, denied, and error states
  features/        One folder per product area: screens, components, queries
  layouts/         Public, staff, and customer shells
  lib/             Money, dates, class names — no domain logic
  realtime/        Native WebSocket client and coalesced cache invalidation
  styles/          Tailwind theme
e2e/               Playwright journeys
```

## Decisions worth knowing

**Money and dates.** Amounts cross the wire as decimal strings in major units and discounts as integer basis points; neither is converted to a float. Business dates (`YYYY-MM-DD`) are formatted by reading the string, never by constructing a `Date`, so a validity date cannot shift across time zones.

**A missing figure is never zero.** `formatMoney(null)` renders an em dash. "We do not have this number" and "this number is zero" are different statements about a deal.

**One-time and recurring are never summed.** ₹39,300 once and ₹3,000 a month are not ₹42,300 of anything. `comparisonNet` and MRR are always shown with the sentence that explains what they measure.

**Action eligibility is centralised.** `features/quotes/actions.ts` decides what may be done, and why not, from the server's facts — gates, revision status, capabilities — never from a display label. Every disabled control carries its reason.

**The three gates are independent.** Seller agreement, internal approval, and customer acceptance can land in any order, so they render as a checklist. Approval itself is sequential: both steps are created at submission and the finance step remains locked until the manager step clears.

**Nothing is refreshed over a dirty form.** The quote editor debounces evaluation, cancels superseded requests, and when the server copy moves under unsaved edits it offers compare, reload, or keep-mine.

**Customer and internal data are separate types, not filtered ones.** A portal response has no field for cost, margin, or a policy threshold, and a test asserts those words never appear in the deal room's rendered text.

**Idempotency keys belong to intents.** `useIntentKey` holds one key while a user works on one action and mints a new one when they start another, so a retry after a dropped connection replays rather than repeats.

## Accessibility and responsiveness

Checked at 320, 768, 1024, and 1440 px, with horizontal page overflow treated as a defect. Wide financial tables scroll inside their own container; the document does not. Every control is labelled through `htmlFor`/`id`, colour never carries meaning alone, and the landing animation honours `prefers-reduced-motion` with a complete static graph and ordered text walkthrough.

## Configuration

See [`.env.example`](./.env.example). Nothing secret goes in a `VITE_*` variable or in this repository — the database password and assistant provider keys live in the backend's environment and are never read here.

For a hosted build, set `VITE_API_BASE_URL` and `VITE_WS_URL` as build-time variables (Cloudflare Pages, for example). Left unset, the app calls `/api/v1` and `/ws` on its own origin, which is what the dev proxy and a single-origin deployment expect. `public/_redirects` provides the SPA fallback.

For the full setup, routes, demo personas, policy, and testing instructions, see the [root README](../README.md).
