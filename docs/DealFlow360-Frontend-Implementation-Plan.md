# DealFlow360 — Frontend Implementation Plan

**Status:** frontend-only plan for the implemented Spring Boot API  
**Date:** 5 September 2026

## 1. Scope and governing decisions

This plan turns the supplied DealFlow360 functional specification into a browser client for the existing backend in `backend/`. The source documents define product workflows, roles, API semantics, security boundaries, and acceptance cases. Their recommendation to use **Next.js and TypeScript is superseded by the user's frontend constraint**.

The frontend will use:

| Area | Choice | Why |
|---|---|---|
| Application | React with Vite, JavaScript (`.js` / `.jsx`) | Client-rendered SPA; no Next.js or TypeScript. |
| Styling | Tailwind CSS | Fast, responsive design system with reusable tokens. |
| Motion | GSAP | Small, intentional transitions for shell, panels, cards, and feedback. |
| Navigation | React Router | Protected internal, customer-portal, and admin route trees. |
| Server state | TanStack Query | Cached REST reads, mutation states, invalidation and refetch. |
| Forms | React Hook Form + Zod | Ergonomic JavaScript form validation; the API remains authoritative. |
| Local UI state | Zustand | Draft-only builder state, navigation preferences, and transient UI state. |
| Icons/feedback | Lucide React + Sonner | Consistent icons and accessible toast feedback. |
| Charts | Recharts | Reports backed by real filtered report data. |
| Live updates | `@stomp/stompjs` | Authenticated STOMP connection to the existing `/ws` endpoint. |
| Tests | Vitest + React Testing Library + Playwright | Component, integration, and end-to-end coverage. |

Do not introduce Next.js, TypeScript, server-side pricing logic, a direct database/Supabase data path, or browser-only authorization. The Spring API owns identity, record scope, money, approvals, stock, billing and all business decisions.

## 2. Product shape

Build two deliberately separate experiences:

1. **Internal workspace** — desktop-first application for Reps, Managers, Finance/Ops and Admins. The primary object is a quote detail workspace with the tabs **Build, Approvals, Customer Activity, Fulfillment, Billing, and History**.
2. **Customer portal** — its own minimal layout for a customer to read only their quotes, discuss a line, submit a counteroffer, and accept the exact displayed version. It must never render internal cost, margin, risk thresholds, policy information, other customers, or unrelated inventory.

The visual language should be calm and sales-oriented: slate/white surfaces, a clear primary action colour, and labelled semantic states—green “ready”, amber “waiting/risk”, red “blocked”. Do not communicate meaning by colour alone.

## 3. Application structure

Create `frontend/` at repository root.

```text
frontend/
  src/
    app/                 # router, providers, route guards
    api/                 # fetch client, resource modules, response/error handling
    auth/                # Supabase session adapter and access-token lifecycle
    components/
      ui/                # Button, Modal, Table, Tabs, Skeleton, EmptyState
      layout/            # app shell, portal shell, side nav, header
    features/
      quotes/ approvals/ fulfillment/ billing/ portal/
      reports/ health/ admin/ catalog/
    hooks/               # query, debounce, websocket and permission hooks
    lib/                 # money/date formatters, idempotency keys, query keys
    stores/              # Zustand stores; never server source-of-truth data
    styles/              # Tailwind entrypoint and design tokens
    test/
  e2e/
  .env.example
```

Use feature-local components and query hooks. Only primitives, layout, API utilities and formatting helpers belong in shared folders. JavaScript JSDoc typedefs may document complex API payloads, but no `.ts`/`.tsx` files or TypeScript toolchain are permitted.

## 4. Routes and delivery order

| Route | Audience | First-release capability |
|---|---|---|
| `/login`, `/signup` | unauthenticated | Supabase sign-in/sign-up, redirect by `/me` role, useful errors. |
| `/workspace` | internal | Quote list, filters, stage/count cards, create action, reload time and empty/error states. |
| `/pipeline` | internal | Status-derived pipeline; transitions only through valid server actions. |
| `/quotes/new`, `/quotes/:quoteId` | internal | Three-column builder, evaluation, revision save/submit, recommendations and quote tabs. |
| `/approvals` | Manager/Finance/Admin | Assigned queue; revision comparison; reasoned approve/reject/return. |
| `/orders/:orderId/fulfillment` | Finance/Ops/Admin | Allocation preview/override, shortage/backorder, receipt/replan and dispatch. |
| `/billing`, `/billing/subscriptions/:id` | Finance/Ops/Admin | Invoices, payments, credit/refund history, change/cancel previews. |
| `/health`, `/reports` | role-scoped internal | Alerts/nudges, filtered report charts/table, genuine export download. |
| `/admin/*` | Admin | Reusable table/form views for catalog, prices, policies, warehouses, plans, teams and profiles. |
| `/portal/quotes`, `/portal/quotes/:quoteId`, `/portal/invoices` | Customer | Restricted quote view, discussion/counteroffer and exact-version acceptance. |

Implement in this dependency order: foundation/auth → shell and quotes → builder/evaluation/approvals → portal → fulfillment/billing → health/reports/admin. A route that is not yet integrated should show a clearly labelled “Coming next” state only during development; it is not a delivery substitute.

## 5. API, authentication and real-time contract

The API base URL comes only from `VITE_API_BASE_URL`; Supabase configuration comes from public Vite variables. The authenticated fetch wrapper must:

- obtain the current Supabase access token and send `Authorization: Bearer <token>`;
- unwrap the backend `{ data, meta }` envelope;
- normalize `{ error, requestId }` into a reusable `ApiError`;
- attach a UUID `Idempotency-Key` for retry-safe actions and reuse the same key for a retry;
- send `expectedVersion`, revision ID and commercial hash whenever the relevant endpoint requires them;
- treat `401` as a sign-out/refresh-session path, `403/404` as an access-denied view, `409` as a stale-version recovery flow, and `422` as field/form feedback.

Use TanStack Query keys scoped by authenticated profile ID. Clear the query cache, Zustand draft state and STOMP connection on sign-out. Mutation success must invalidate/refetch the relevant quote/order/invoice queries; it must display the confirmed server result rather than calculating financial state in the browser.

Connect STOMP to `${VITE_WS_URL}/ws` only after a token is available. Send the token in the STOMP `CONNECT` headers—not in a URL. Subscribe only to the API-approved private destination. On `QUOTE_REVISED`, `APPROVAL_UPDATED`, `BACKORDER_UPDATED`, `INVOICE_UPDATED` and `ALERT_UPDATED`, invalidate the affected resource and refetch it. On reconnect, refetch the notification inbox and visible routes. REST must remain fully usable if the socket is unavailable.

## 6. Key screen behaviour

**Quote builder:** debounced catalog search, variant selection, editable quantity/discount inputs, server evaluation spinner, and a three-part total: one-time, recurring by cadence, and initial amount due. The context panel renders structured risk reasons, required approval chain, recommended items (add/dismiss), margin returned by the API, and non-reserving stock preview. Saving creates a revision; submitting uses the latest saved revision only.

**Approval and negotiation:** always show quote revision number and changed terms. Disable an action while it is pending, require a reason for reject/return, and turn a `409` response into a refresh/diff prompt. A customer acceptance must include the exact version/hash; never silently apply it to a newer quote.

**Fulfillment and billing:** show warehouse splits, costs, available/short quantities and backorder status returned by the API. Confirm destructive business actions in a dialog. For billing, visually separate paid/outstanding one-time invoices from recurring schedules, period dates, adjustments, credits and refunds.

**Admin and reports:** use one configurable list/form pattern, server pagination and debounced filters. Download the response body from the API export endpoint rather than recreating a PDF/XLSX in the browser.

Every data screen requires loading, empty, error, forbidden, and stale-data states. Optimistic updates are limited to reversible presentation actions, such as dismissing a notification. Approval, inventory, payment and quote mutations await confirmed API responses.

## 7. Motion, accessibility and responsive behavior

GSAP is an enhancement, not a dependency for comprehension. Use it for initial shell reveal, route-panel transitions, staggered quote/recommendation cards, tab content transitions, and a concise success/error emphasis. Keep motion under 300 ms for routine feedback; respect `prefers-reduced-motion` by disabling timelines and using immediate state changes. Never animate financial totals in a way that obscures the authoritative value.

Use semantic buttons/labels, visible focus rings, keyboard-operable dialogs and tabs, labelled charts, live regions for mutation feedback, and at least WCAG AA contrast. The workspace is desktop-first at 1280 px+, collapses the three-column builder to stacked panels on tablet, and keeps the customer portal usable on mobile.

## 8. Milestones and definition of done

| Milestone | Deliverable | Verification |
|---|---|---|
| 1. Foundation | Vite app, Tailwind tokens, routing, auth, API wrapper, query client, protected shells | Login, `/me` redirect, logout/cache clear and API error states work. |
| 2. Quote flow | Quote list, builder, evaluation, revision, submission, recommendations, approvals | Normal Flow A reaches an approved/accepted quote without fake totals. |
| 3. Customer and operations | Portal counter/acceptance, fulfillment allocation/dispatch, billing views/actions | Flow B shows stale-version handling, approval sequence, split/backorder and recurring groups. |
| 4. Management | Alerts, reports/exports, admin configuration, notifications/websocket recovery | Role-scoped pages render live data and exported data matches filters. |
| 5. Hardening | Responsive/accessibility pass, test suite, production build/deploy configuration | Browser tests pass for normal sale, negotiation/stale acceptance, portal isolation and reconnect refetch. |

Acceptance is complete only when the UI demonstrates both documented demo flows against the real backend, uses no hardcoded commercial totals, contains no Next.js/TypeScript, and passes the browser journeys that cover Flow A, Flow B, portal isolation, role guards, stale versions, double-click/retry safety, and WebSocket reconnect.

## 9. Backend handoff checkpoints

Before feature implementation, create a lightweight endpoint-to-screen tracker from the existing controllers. The backend already exposes the core surface needed for the plan—including quotes, approvals, portal, fulfillment, billing, alerts, reports, admin/catalog and STOMP `/ws`. Confirm request/response examples for each mutation before wiring forms, particularly revisions, portal counteroffers, allocations, payment allocation and subscription changes. Any UI-required response field absent from the API is a backend contract change, not a reason to calculate or infer it in React.

