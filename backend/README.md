# DealFlow360 — Backend

The quotation-to-cash backend for the DealFlow360 hackathon submission: a single modular Spring Boot service that prices quotations, routes discount approvals, negotiates with customers through a restricted portal, reserves stock across warehouses, and bills one-time and recurring charges — all with real, persisted calculations.

This directory corresponds to `apps/api` in the implementation plan (`docs/DealFlow360-Implementation-Plan.md`). The plan is the specification; this README is how to run and reason about what was built.

## Stack

| Concern | Choice |
|---|---|
| Runtime | Java 21, Spring Boot 4.1.1, Spring MVC |
| Persistence | PostgreSQL (Supabase), Spring Data JPA / Hibernate 7, HikariCP, Flyway |
| Identity | Supabase Auth JWTs verified by Spring Security's OAuth2 resource server; roles read from the database on every request |
| Live updates | STOMP over native WebSocket at `/ws`, token in the CONNECT frame, transactional outbox behind it |
| Exports | Apache PDFBox (PDF), Apache POI (real XLSX and legacy XLS) |
| Tests | JUnit 5, AssertJ, Testcontainers PostgreSQL |

Two facts about this stack that are not obvious from the code: Spring Boot 4 renamed the starters (`spring-boot-starter-webmvc`, `-flyway`, `-security-oauth2-resource-server`, each with a `-test` twin), and it ships **Jackson 3**, whose packages are `tools.jackson.*` while annotations stay on `com.fasterxml.jackson.annotation.*`.

## Running it

### Prerequisites

- JDK 21 (the Maven wrapper needs `JAVA_HOME` pointing at it)
- Docker Desktop, for the local Supabase stack and the integration tests
- Node 18+, only for `scripts/create-demo-users.mjs`

### 1. Database and identity

The `../supabase_backend` folder runs a full local Supabase in Docker:

```powershell
cd ..\supabase_backend
npx supabase start
npx supabase status      # note the service_role key
```

Business tables live in a dedicated `dealflow` schema owned by this service's Flyway migrations. That schema is deliberately **not** in Supabase's PostgREST allow-list, so the `anon`/`authenticated` keys can never read it; all authorisation happens here. Supabase's own `supabase/migrations` only touch `public`.

### 2. Configure

Copy `.env.example` and fill it in. The defaults already point at the local stack. The one decision to make is JWT verification: local Supabase signs with a shared HS256 secret (`AUTH_JWT_SECRET`, default provided); a hosted project with signing keys enabled should clear that and set `AUTH_JWK_SET_URI` instead. Configure exactly one.

### 3. Run

```powershell
$env:JAVA_HOME = "C:\path\to\jdk-21"
.\mvnw.cmd spring-boot:run
```

Flyway applies `src/main/resources/db/migration/V1..V5` on first start; Hibernate then validates its mapping against the result (`ddl-auto=validate`) and refuses to boot on any mismatch. Health: `GET /actuator/health`.

### 4. Demo data

```powershell
$env:DEMO_SEED = "true"; .\mvnw.cmd spring-boot:run        # seeds once, idempotently
$env:SUPABASE_SERVICE_ROLE_KEY = "<from supabase status>"
$env:DEMO_PASSWORD = "<pick one>"
node scripts\create-demo-users.mjs                          # creates the matching auth users
```

The seeder provisions profiles **by email** with no auth user id; each account binds to its profile on first sign-in. Roles are assigned by the seed and never by the token. Everything seeded is synthetic and labelled as such.

| Account | Role | Notes |
|---|---|---|
| `admin@dealflow.demo` | ADMIN | configuration, reassignment |
| `rep.a@dealflow.demo` | REP | owns the demo quotations; has 6 finalised quotes as an anomaly baseline |
| `rep.b@dealflow.demo` | REP | second rep, for report filters |
| `manager.a@dealflow.demo` | MANAGER | approval step 1 |
| `manager.backup@dealflow.demo` | MANAGER | holds one valid and one expired delegation |
| `finance@dealflow.demo` | FINANCE | approval step 2, stock, payments |
| `alpha@customer.demo` | CUSTOMER | Alpha Traders (Bronze) — Flow A |
| `beta@customer.demo` | CUSTOMER | Beta Systems (Gold) — Flow B |

Stock is seeded as the demo script expects: Main 4 laptops / 10 docks, East 1 laptop.

## Verifying

```powershell
.\mvnw.cmd test        # engine and unit tests, no Docker needed
.\mvnw.cmd verify      # adds *IT integration tests against a Testcontainers PostgreSQL
```

The integration tests apply the real migrations to a real PostgreSQL and exercise concurrency with real transactions. A skipped Docker-dependent suite is not a pass.

## How it is put together

```
com.dealflow
├── auth            Supabase JWT → database profile → Actor; roles; delegations; admin
├── catalog         products, variants, tiered price rules, plans, customers, teams
├── policy          immutable versioned discount policy (ceilings + triggers)
├── quotes          quotation aggregate, revisions, lines; pricing + risk engines
├── approvals       sequential Manager → Finance steps; routing; reassignment
├── portal          customer-only DTOs; comments, counteroffers, exact-version acceptance
├── orders          the finalisation coordinator (one transaction: order + stock + billing)
├── fulfillment     warehouses, stock, allocation engine, reservations, dispatch, receipts
├── billing         subscriptions, invoices, proration, credits, payments, refunds
├── recommendations co-purchase statistics from real orders; no trained model
├── health          stalled / anomaly / slippage sweeps, alerts, nudges, inbox
├── reporting       role-scoped sales report; PDF, XLSX, XLS exports
├── outbox          committed events → WebSocket dispatcher with retry and dead-letter
├── notifications   STOMP auth interceptor, per-user publisher
├── jobs            leased scheduled sweeps; manual job runs
└── shared          money (minor units, HALF_UP), calendar, audit, idempotency, errors
```

Controllers validate and authorise; services own transactions; the four engines (`PricingEngine`, `RiskEngine`, `AllocationEngine`, `ProrationCalculator`) are pure functions with no I/O, which is why they are the most heavily unit-tested code in the tree.

### The transaction that matters

`OrderFinalizationService.tryFinalize` is called from every path that can complete a gate — an approval, a seller adoption, a customer acceptance. It locks the quotation, re-checks all gates, and only then creates the order, reserves stock under row locks, and raises the first invoice, in **one** database transaction. A shortage under in-stock-only terms throws and rolls back all of it. Duplicate creation is prevented three ways: the aggregate lock, an explicit existence check, and a UNIQUE constraint on `orders.quote_id`.

### Money

All amounts are persisted as `BIGINT` minor units and computed in `BigDecimal`, rounded to minor units exactly once, HALF_UP. Discounts are integer basis points. JSON carries money as decimal strings so a browser's double arithmetic never touches it. Line rounding residual is redistributed inside each subtotal group so lines always reconcile to their total.

### Identity and isolation

The token proves who signed in; the database says what they may do. `dealflow.profiles` is read on every request, so a deactivation takes effect immediately rather than when the token expires. Portal responses are separate types with no field for cost, margin, policy thresholds or other customers. Out-of-scope reads return 404, not 403, so a probing client cannot map records it may not see.

### Live updates

Every important mutation writes an `outbox_events` row in the business transaction. A one-second dispatcher claims rows with `FOR UPDATE SKIP LOCKED`, resolves recipients against **current** ownership, and pushes a minimal frame (id, type, entity, version) to each user's private STOMP queue. Clients refetch through REST. The WebSocket is never the source of truth; a durable `notifications` inbox survives a missed frame. The simple broker is single-instance by design — a second replica needs a broker relay first.

### Scheduled work

A leased minute sweep raises due recurring charges (each subscription in its own transaction, keyed by a globally unique `charge_key` so overlapping or catch-up runs bill each interval once), runs the deal-health rules, and expires stale quotations. Jobs run as the SYSTEM actor. `POST /api/v1/internal/job-runs` runs the same implementation by hand.

## Business decisions this build makes

These are the plan's explicit design choices where the brief was open, restated so a reviewer does not have to hunt for them:

- **Blended risk** evaluates the worst line (M), value-weighted excess (W), total excess money (E), overall discount (D) and margin, and routes to the highest level any of them demands. `max(0, …)` per line means a compliant line never offsets a breach; value weighting means splitting a line cannot lower the route. Promotion affects ranking only.
- **Zero-net lines are refused** (422). At positive revenue, zero or negative contribution requires Finance.
- **Approval and acceptance are independent gates** in either order; seller adoption is a third. Editing submitted terms supersedes the revision and retires its pending steps; nothing inherits an approval.
- **Stock**: preview reserves nothing; finalisation re-reads under `(variant, warehouse)`-ordered row locks. `ALLOW_BACKORDER` reserves what exists and records the rest; `IN_STOCK_ONLY` fails the whole finalisation. The default `BALANCED` split scores shipping cost plus INR 50 per extra parcel.
- **Billing**: one-time lines invoice on confirmation (disclosed in accepted terms); each recurring line becomes a subscription with calendar-month periods and a preserved anchor day. Proration is `(new − old) × unit interval price × remaining days / period days`, rounded once. Cancellation credits unused coverage segment by segment; refunds are capped at money actually received. No clawback on bundled hardware.
- **Health**: stalled = elapsed `Duration` since the external wait began, never a local-date subtraction; a rep's own edits do not reset it. Anomaly detection stays silent below five observations.

## Known gaps

- No email transport: sharing a quotation returns a portal path, it does not send mail.
- No payment gateway: payments and refunds are recorded receipts.
- Deal Lab (I2) and the unified explanation panel (I1) are not implemented; the structured `reasons[]` they would render are.
- Plan changes that switch cadence (monthly → yearly) are not exposed; quantity changes and cancellation are.
- Single backend instance: the WebSocket broker is in-process.

## API surface

All endpoints are under `/api/v1`, require a bearer token, and return `{ "data", "meta" }` or `{ "error": { "code", "message", "details" }, "requestId" }`. Mutations that must be safe to retry — approval decisions, portal counters and acceptances, payments, refunds, subscription changes, stock receipts — require an `Idempotency-Key` header; a replay returns the original result, and the same key with a different body is refused.

| Area | Endpoints |
|---|---|
| Identity | `GET /me` |
| Quotations | `GET,POST /quotes` · `GET /quotes/{id}` · `POST /quotes/{id}/{evaluations,revisions,submissions,shares,adoptions,cancellations}` · `GET /quotes/{id}/{revisions,history}` |
| Recommendations | `GET /quotes/{id}/recommendations` · `POST /quotes/{id}/recommendation-dismissals` |
| Approvals | `GET /approval-requests` · `POST /approval-requests/{id}/{decisions,reassignments}` |
| Portal | `GET /portal/{quotes,invoices}` · `GET /portal/quotes/{id}` · `POST /portal/quotes/{id}/{requests,acceptances}` |
| Orders & stock | `GET /orders` · `GET /orders/{id}/{allocation,fulfillment}` · `POST /orders/{id}/{allocations,replans}` · `POST /shipments/{id}/dispatches` · `GET,PATCH /stock-levels` · `POST /stock-movements` |
| Billing | `GET /invoices` · `GET /subscriptions` · `POST /subscriptions/{id}/{change-previews,changes,cancellations}` · `POST /payments` · `POST /refunds` · `GET /credit-notes` |
| Health | `GET /alerts` · `POST /alerts/{id}/nudges` · `POST /alerts/sweeps` · `GET /notifications` |
| Reports | `GET /reports/sales` · `GET /reports/sales/export?format=pdf\|xlsx\|xls` |
| Configuration | `/customers` `/categories` `/products` `/variants` `/price-rules` `/subscription-plans` `/warehouses` `/discount-policies` `/admin/{profiles,delegations,teams}` |
| Operations | `GET,POST /internal/job-runs` |
