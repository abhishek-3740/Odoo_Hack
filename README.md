# DealFlow360

**A quote-to-cash platform for governed B2B sales.** DealFlow360 combines a public product catalogue, a staff workspace for quotations and approvals, and a customer deal room where buyers negotiate and accept terms. Pricing, discount policy, approvals, stock reservations, invoicing, and proration are resolved by the backend; the frontend only asks and displays.

The current application is a React 19 + TypeScript single-page app backed by a FastAPI service and PostgreSQL.

---

## Contents

- [What it does](#what-it-does)
- [Tech stack](#tech-stack)
- [Repository layout](#repository-layout)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Demo data and personas](#demo-data-and-personas)
- [Routes](#routes)
- [Quote-to-cash workflow](#quote-to-cash-workflow)
- [Discount policy v1](#discount-policy-v1)
- [Testing](#testing)
- [Documentation](#documentation)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## What it does

- **CPQ and pricing** — 34-digit decimal arithmetic, volume and tier pricing, one-time and recurring charges, and a SHA-256 commercial hash that seals the exact terms of each quotation version.
- **Versioned quotations** — every save creates a new revision with server-side repricing and a fresh policy evaluation. History, audit events, and a line-by-line diff are available in the workspace.
- **Policy-driven approvals** — tier and category discount ceilings decide whether a quotation needs no approval, a manager step, or manager followed by finance. Approval order is enforced server-side.
- **Three independent gates** — seller agreement, internal approval, and customer acceptance can complete in any order; the quotation cannot become an order until all three are satisfied.
- **Customer deal room** — customers review customer-safe terms, request a discount, ask questions, accept a version, and download invoice PDFs. Cost, margin, contribution, and policy data have no field in the portal response at all.
- **Atomic order finalization** — accepting a quotation creates the sales order, reserves stock or creates a backorder, and raises the initial one-time invoice in one transaction.
- **Fulfillment and billing** — warehouse allocation, stock movements, shipment dispatch and tracking, receipts and allocations, refunds, credit notes, and subscription changes with proration.
- **Operations and insight** — deal-health alerts and sweeps, sales reports with Excel export, notifications, job-run history, audit events behind commercial actions, and a native WebSocket feed for live updates.
- **Optional AI assistant** — provider-agnostic workspace assistant grounded in the caller's authorized deals. Configure Groq, Google AI Studio Gemini, or Sarvam; the assistant is disabled when no key is present.
- **Role-based access** — `REP`, `MANAGER`, `FINANCE`, `ADMIN`, and `CUSTOMER` capabilities are enforced on the server, not only hidden in the navigation.

---

## Tech stack

| Layer | Technology |
| :--- | :--- |
| **Frontend** | React 19, TypeScript 5.9, Vite 7, Tailwind CSS 4, React Router 7, TanStack Query 5, Radix UI, Recharts |
| **Backend** | Python 3.12, FastAPI, Uvicorn, Pydantic v2 |
| **Data access** | SQLAlchemy 2.1 async ORM, asyncpg (`postgresql+asyncpg://`), Alembic |
| **Database** | PostgreSQL 15+ (verified on PostgreSQL 18), schema `dealflow` |
| **Identity** | PyJWT (local HS256 or Supabase JWKS), Passlib bcrypt, demo personas |
| **Documents** | ReportLab (invoice PDFs), openpyxl (Excel exports) |
| **AI** | Groq (`openai/gpt-oss-120b`), Google AI Studio (`gemini-3.5-flash-lite`), Sarvam fallback |

The core data stack — PostgreSQL, SQLAlchemy async, asyncpg, and Pydantic v2 — is fixed. Prefer adapting the surrounding code rather than replacing those pieces.

---

## Repository layout

```text
.
├── backend_fastapi/            # Active FastAPI backend
│   ├── app/
│   │   ├── api/v1/routers/     # REST routers: auth, quotes, portal, orders, billing, catalog, ops
│   │   ├── core/               # Settings, security, async database engine, responses
│   │   ├── engines/            # Pure domain math: pricing, risk, allocation, proration, hashing
│   │   ├── models/             # SQLAlchemy ORM models for the dealflow schema
│   │   ├── repositories/       # Sequence generators and persistence helpers
│   │   ├── schemas/            # Pydantic request/response models
│   │   ├── services/           # Quotation, approval, order, billing, portal, and report workflows
│   │   ├── websocket/          # Authenticated native WebSocket endpoint at /ws
│   │   └── workers/            # Outbox poller and scheduled sweeps
│   ├── migrations/             # Alembic environment, baseline revision, schema SQL
│   ├── tests/                  # Unit and integration tests (dealflow_test database)
│   ├── alembic.ini
│   └── requirements.txt
│
├── frontend/                   # Current React 19 + TypeScript SPA
│   ├── src/
│   │   ├── api/                # Typed resources and wire contracts
│   │   ├── app/                # Router, providers, guards, route boundaries
│   │   ├── auth/               # Token adapters and role capabilities
│   │   ├── design-system/      # Shared UI primitives and states
│   │   ├── features/           # One folder per product area
│   │   ├── layouts/            # Public, staff, and customer shells
│   │   ├── lib/                # Money, dates, and formatting helpers
│   │   ├── realtime/           # Native WebSocket client and cache invalidation
│   │   └── styles/             # Tailwind theme
│   ├── e2e/                    # Playwright browser journeys
│   ├── package.json
│   └── vite.config.ts
│
├── backend/                    # Original Spring Boot implementation (reference)
├── docs/                       # Architecture, implementation plan, solution report
├── landing/                    # Earlier landing-page components (reference)
├── ppts/                       # Presentation assets
├── supabase_backend/           # Local Supabase CLI scratch directory
│
├── DealFlow360-Demo-Walkthrough.pdf   # Step-by-step browser verification guide
├── MIGRATION_MEMORY.md                # Porting and architecture notes
└── README.md
```

`backend/` is kept for reference. The current setup, frontend, and instructions in this README target `backend_fastapi/`.

---

## Quick start

### Prerequisites

- **Python** 3.12+
- **Node.js** 20.19+ and npm
- **PostgreSQL** 15+ running locally on `127.0.0.1:5432`
- Windows PowerShell examples are shown first; macOS/Linux equivalents are noted where they differ.

### 1. Create the database

```powershell
psql -U postgres -c "CREATE DATABASE demo;"
```

If `demo` already exists, skip this step. The Alembic migration creates the `dealflow` schema inside the database.

### 2. Start the backend

```powershell
cd backend_fastapi
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
```

For macOS or Linux:

```bash
cd backend_fastapi
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Edit `backend_fastapi/.env` and set at least:

```ini
SPRING_DATASOURCE_URL=postgresql+asyncpg://postgres:YOUR_PASSWORD@127.0.0.1:5432/demo
SPRING_DATASOURCE_USERNAME=postgres
SPRING_DATASOURCE_PASSWORD=YOUR_PASSWORD

AUTH_JWT_SECRET=replace-with-a-32-byte-or-longer-secret
APP_ALLOWED_ORIGINS=http://127.0.0.1:3001,http://localhost:3001

DEMO_SEED=true
DEMO_AUTH_ENABLED=true
PORT=8080
```

Apply the schema and start the API:

```powershell
alembic upgrade head
python -m uvicorn app.main:app --host 127.0.0.1 --port 8080 --reload
```

Verify:

- API: <http://127.0.0.1:8080>
- Swagger UI: <http://127.0.0.1:8080/docs>
- Health: <http://127.0.0.1:8080/actuator/health> → `{"status":"UP"}`

`DEMO_SEED=true` seeds reference data on startup and is safe to run repeatedly. Set `DEMO_SEED=false` and `DEMO_AUTH_ENABLED=false` outside demo environments.

### 3. Start the frontend

In a second terminal:

```powershell
cd frontend
npm install
Copy-Item .env.example .env.local
npm run dev
```

Open <http://127.0.0.1:3001>.

- The landing page is the first screen at `/`.
- Sign in at `/sign-in`.
- `/api/*` and `/ws` are proxied to `http://127.0.0.1:8080`.
- To point at another backend, set `API_PROXY_TARGET` in `frontend/.env.local`.

### 4. Sign in

On `/sign-in`, click **Use a demo persona**, then choose a card. No password is required when `DEMO_AUTH_ENABLED=true`.

---

## Configuration

### Backend (`backend_fastapi/.env`)

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `SPRING_DATASOURCE_URL` | local example URL | SQLAlchemy async database URL. `DATABASE_URL` is also accepted and takes precedence when set. |
| `SPRING_DATASOURCE_USERNAME` | `postgres` | Database user. |
| `SPRING_DATASOURCE_PASSWORD` | `postgres` | Database password. |
| `AUTH_JWT_SECRET` | empty | Local HS256 signing secret. Use 32+ random characters. |
| `AUTH_JWK_SET_URI` | empty | Supabase JWKS endpoint; use instead of a local secret for hosted Supabase. |
| `APP_ALLOWED_ORIGINS` | local origins | Comma-separated origins allowed by CORS. The Vite dev proxy keeps `/api` and `/ws` same-origin; list the frontend origin when calling the API directly. WebSocket connections authenticate with a bearer token or `?token=`. |
| `DEMO_SEED` | `false` | Seed personas, customers, catalogue, stock, and policy on startup. Idempotent. |
| `DEMO_AUTH_ENABLED` | `false` | Enable demo account discovery and demo-token sign-in. |
| `JOBS_ENABLED` | `true` | Start the outbox poller and scheduled sweep workers. |
| `ALLOCATION_MODE` | `BALANCED` | Warehouse allocation strategy: `BALANCED`, `MIN_SHIPMENTS`, or `MIN_COST`. |
| `BILLING_TIMEZONE` | `Asia/Kolkata` | Timezone used for billing and business-date boundaries. |
| `GROQ_API_KEY` | empty | Optional assistant provider. |
| `GEMINI_API_KEY` | empty | Optional assistant provider; used when Groq is not configured. |
| `SARVAM_API_KEY` | empty | Optional assistant fallback. |
| `PORT` | `8080` | API port. |

### Frontend (`frontend/.env.local`)

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `API_PROXY_TARGET` | `http://127.0.0.1:8080` | Backend target for the Vite `/api` and `/ws` proxy. |
| `SITE_ORIGIN` | `https://dealflow360.example` | Canonical origin injected into the built landing page's SEO metadata. |
| `E2E_BASE_URL` | unset | Point Playwright at an already-running frontend instead of starting one. |

Nothing secret belongs in a `VITE_*` variable or in `frontend/.env.local`. Provider keys and the database password stay in the backend environment.

---

## Demo data and personas

With `DEMO_SEED=true`, the backend seeds:

- the demo personas below;
- customers **Alpha Traders** (BRONZE), **Beta Systems** (GOLD), **Gamma Retail** (SILVER), **Delta Logistics** (SILVER), and **Epsilon Labs** (GOLD);
- catalogue categories, products, variants, price rules, warehouses, and stock;
- discount policy v1 and a manager delegation.

| Persona | Role | Email | Use it for |
| :--- | :--- | :--- | :--- |
| **Rep A (Sales)** | `REP` | `rep.a@dealflow.demo` | Creating and owning Alpha Traders quotations |
| **Rep B (Sales)** | `REP` | `rep.b@dealflow.demo` | Second sales territory and team views |
| **Manager A** | `MANAGER` | `manager.a@dealflow.demo` | Approval step 1, team reports, health nudges |
| **Backup Manager** | `MANAGER` | `manager.backup@dealflow.demo` | Delegated manager approvals |
| **Finance Ops** | `FINANCE` | `finance@dealflow.demo` | Approval step 2, billing, receipts, dispatch, jobs |
| **Demo Admin** | `ADMIN` | `admin@dealflow.demo` | Catalogue, policy, people, and full-access checks |
| **Alpha Buyer** | `CUSTOMER` | `alpha@customer.demo` | Alpha Traders deal room, negotiation, acceptance |
| **Beta Buyer** | `CUSTOMER` | `beta@customer.demo` | Beta Systems deal room and invoices |

The seeded database starts without transactional quotations, approvals, orders, or invoices. References are sequence-driven: the first new quotation is typically `Q-1000`, the first order `SO-1000`, and the first invoice `INV-1000`.

For a guided browser script that creates a within-policy deal, a two-step approval deal, and a negotiated deal, see [DealFlow360-Demo-Walkthrough.pdf](./DealFlow360-Demo-Walkthrough.pdf).

---

## Routes

### Public

| Route | Screen |
| :--- | :--- |
| `/` | Landing page |
| `/catalogue` | Public catalogue |
| `/sign-in` | Sign in, including demo personas |
| `/sign-up` | Customer registration |
| `/sign-up/team` | Internal staff registration |

### Staff workspace

| Route | Screen |
| :--- | :--- |
| `/admin` | Today — what needs attention now |
| `/admin/quotes` | Quotation pipeline |
| `/admin/quotes/:quoteId` | Deal workspace: quote, approvals, conversation, history |
| `/admin/approvals` | Approval inbox |
| `/admin/approvals/:approvalRequestId` | Approval detail |
| `/admin/reviews` | Questions — escalations, not approvals |
| `/admin/customers` | Customer list |
| `/admin/customers/:customerId` | Customer detail |
| `/admin/orders` | Orders |
| `/admin/orders/:orderId` | Order detail and fulfillment |
| `/admin/inventory` | Stock, receipts, and movements |
| `/admin/billing` | Invoices, receipts, subscriptions |
| `/admin/invoices/:invoiceId` | Invoice detail |
| `/admin/subscriptions/:subscriptionId` | Subscription detail |
| `/admin/health` | Deal-health alerts |
| `/admin/notifications` | Notification inbox |
| `/admin/reports` | Sales reports and export |
| `/admin/catalog` | Catalogue administration |
| `/admin/policy` | Discount policy and version history |
| `/admin/people` | Profiles, teams, and delegations |
| `/admin/operations` | Job runs and operational controls |

### Customer portal

| Route | Screen |
| :--- | :--- |
| `/customer` | Customer overview |
| `/customer/catalogue` | Customer catalogue and quote requests |
| `/customer/quotes` | Shared quotations |
| `/customer/quotes/:quoteId` | Customer deal room |
| `/customer/invoices` | Invoices |
| `/customer/invoices/:invoiceId` | Invoice detail |
| `/customer/account` | Profile, preferences, and password |

Older staff paths such as `/admin/sales/quotes`, `/admin/manager/approvals`, and `/admin/finance/approvals` redirect to their current equivalents. Navigation is filtered by role, and every screen still checks its own server-enforced capabilities.

---

## Quote-to-cash workflow

1. **Create** a quotation as a sales rep. It starts in `Draft` at version 1.
2. **Add lines and save terms.** The server reprices the quotation and evaluates it against the policy in force. Each save creates a new revision.
3. **Submit for approval.** Within policy, no approval step is created. Otherwise the server creates the required manager and/or finance steps.
4. **Approve in order.** A manager clears step 1; finance step 2 stays locked until step 1 is approved.
5. **Adopt terms.** The seller confirms the exact revision. This is the seller-agreement gate.
6. **Share the customer portal.** The customer sees only customer-safe fields.
7. **Negotiate if needed.** A customer counteroffer creates a new version; the seller adopts it and the customer accepts. Policy is re-evaluated on every saved version.
8. **Accept and finalize.** Customer acceptance runs the atomic finalizer: it creates `SO-*`, reserves stock or creates a backorder, and raises the one-time invoice (`INV-*`) plus any recurring invoices.
9. **Collect and dispatch.** Finance records receipts, refunds, and credit notes, then records shipment dispatch and tracking.

The **Next workflow step** banner on every quotation names the person who must act next. Disabled controls carry the server's reason.

---

## Discount policy v1

The seeded policy is visible at `/admin/policy` and is versioned. A line's effective ceiling is the lower of its customer-tier ceiling and its category ceiling.

| Customer tier | Maximum unconditional discount |
| :--- | ---: |
| BRONZE | 5% |
| SILVER | 10% |
| GOLD | 15% |

| Category | Maximum unconditional discount |
| :--- | ---: |
| HARDWARE | 15% |
| SERVICE | 10% |
| SUBSCRIPTION | 10% |

**Manager step 1** is required when any of these is true:

- any line has a positive excess over its effective ceiling;
- aggregate discount is above 12%;
- aggregate margin is below 20%.

**Finance step 2** is required when any of these is true:

- the worst line is at least 8 percentage points over its ceiling;
- weighted excess is at least 3 percentage points;
- excess value is at least ₹5,000;
- aggregate margin is below 15%;
- any line has non-positive contribution.

When finance is required, the manager step is still step 1. When no trigger fires, the quotation is within policy and no approval step is created. The policy definitions come from the database, so the UI and README should be read alongside the version shown at `/admin/policy`.

---

## Testing

### Backend

The backend suite covers engines, security, API workflows, approvals, billing, portal behavior, realtime events, operations, and concurrent finalization.

```powershell
cd backend_fastapi
.\venv\Scripts\python -m pytest -q
```

Tests use a separate `dealflow_test` database. Create it and apply the migrations once:

```powershell
psql -U postgres -c "CREATE DATABASE dealflow_test;"
$env:SPRING_DATASOURCE_URL="postgresql+asyncpg://postgres:YOUR_PASSWORD@127.0.0.1:5432/dealflow_test"
alembic upgrade head
Remove-Item Env:SPRING_DATASOURCE_URL
```

The default test connection reuses the credentials from `backend_fastapi/.env` and switches the database name to `dealflow_test`. Override the whole URL with `DEALFLOW_TEST_DB_URL` when needed. The test suite expects a clean enough database; accumulated rows can push seeded records outside the first page of results.

### Frontend

```powershell
cd frontend
npm test          # Vitest unit tests
npm run lint      # ESLint, zero warnings
npm run typecheck # TypeScript only
npm run build     # Typecheck plus production build
```

### End-to-end

```powershell
cd frontend
npm run test:e2e
```

Playwright starts the frontend if it is not already running, but it does **not** start the backend. Start the API with `DEMO_SEED=true` and `DEMO_AUTH_ENABLED=true` first.

> **The browser journeys write real data.** They create quotations, record approvals, and accept terms. Run them only against a disposable demo database, never against production or customer data.

---

## Documentation

- [DealFlow360-Demo-Walkthrough.pdf](./DealFlow360-Demo-Walkthrough.pdf) — step-by-step verification script for the complete workflow.
- [`docs/`](./docs) — architecture, implementation plan, and solution report.
- [`MIGRATION_MEMORY.md`](./MIGRATION_MEMORY.md) — notes from the Spring Boot to FastAPI migration.
- [`frontend/README.md`](./frontend/README.md) — frontend-specific structure and design decisions.

---

## Troubleshooting

| Symptom | Fix |
| :--- | :--- |
| `No backend at http://127.0.0.1:8080` in the Vite terminal | Start the FastAPI server. `npm run dev` starts only the frontend. |
| The header says **Not live** and updates fall back to polling | Confirm the backend is running and the session is valid. If the browser calls the API directly instead of through the Vite proxy, add the exact frontend origin to `APP_ALLOWED_ORIGINS` and restart the backend. |
| Demo persona cards are missing on `/sign-in` | Set `DEMO_AUTH_ENABLED=true` and restart the backend. |
| `password authentication failed` or database connection errors | Check `SPRING_DATASOURCE_*` in `backend_fastapi/.env`, confirm PostgreSQL is running, and confirm the `demo` database exists. |
| The assistant says the provider is not configured | Set `GROQ_API_KEY`, `GEMINI_API_KEY`, or `SARVAM_API_KEY` and restart the backend. |
| Port 3001 is already in use | Vite is configured with `strictPort`; stop the other process or change the frontend port and `APP_ALLOWED_ORIGINS` together. |
| Port 8080 is already in use | Stop the other backend or set `PORT` and `API_PROXY_TARGET` to a matching pair. |
| Playwright created unwanted quotations and orders | The e2e suite writes transaction data. Reset the demo database after a test run. |

---

## License

Licensed under the Apache License 2.0. See [LICENSE](./LICENSE).
