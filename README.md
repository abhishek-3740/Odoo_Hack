# DealFlow360

> **Enterprise CPQ (Configure, Price, Quote) & Deal Execution Platform**
> High-precision commercial math, multi-tier approval governance, an interactive customer deal room, atomic order fulfillment, billing and subscriptions, real-time events, and a context-grounded AI workspace assistant.

---

## Tech Stack

| Layer | Technology |
| :--- | :--- |
| **Frontend** | React 19, Vite 8, Tailwind CSS 4, React Router 7, STOMP + native WebSocket client |
| **Backend** | Python 3.12, FastAPI, Uvicorn |
| **Data access** | SQLAlchemy 2.1 async ORM, asyncpg driver (`postgresql+asyncpg://`) |
| **Validation** | Pydantic v2 / pydantic-settings |
| **Database** | PostgreSQL 15+, schema `dealflow`, Alembic async migrations |
| **Security** | PyJWT (local HS256, Supabase JWKS, demo tokens), Passlib bcrypt |
| **Documents** | ReportLab (invoice PDFs), openpyxl (Excel exports) |
| **AI** | Groq (`openai/gpt-oss-120b`) with Google AI Studio (`gemini-3.5-flash-lite`) and Sarvam fallbacks |

### Stack Constraints

The core platform stack — **PostgreSQL**, **SQLAlchemy 2.1 async**, **asyncpg**, and **Pydantic v2** — is fixed. If a component is not working as expected, make the smallest possible adjustment to the surrounding code or configuration, but do not replace these core technologies.

---

## Architecture Overview

```mermaid
flowchart TD
    subgraph Client ["Frontend (Port 3000)"]
        UI["React 19 + Tailwind CSS + Vite SPA"]
        WS["Native WebSocket Client (/ws)"]
        Dock["DealFlow AI Assistant Dock"]
    end

    subgraph Gateway ["Vite Dev Proxy"]
        Proxy["/api -> :8080, /ws -> :8080"]
    end

    subgraph Backend ["FastAPI Backend (Port 8080)"]
        Router["REST & WebSocket Routers"]
        Auth["JWT Auth & RBAC Guard"]
        Pricing["CPQ Pricing Engine (34-digit Decimal)"]
        Policy["Discount Policy & Sequential Approvals"]
        Finalize["Atomic Order Finalizer (SELECT FOR UPDATE)"]
        Outbox["Outbox Poller (SKIP LOCKED)"]
        Scheduler["Scheduled Sweeps"]
        Assistant["AI Assistant Service"]
    end

    subgraph External ["LLM Inference Providers"]
        Groq["Groq API"]
        Gemini["Google AI Studio"]
        Sarvam["Sarvam AI (fallback)"]
    end

    subgraph Storage ["Persistent Storage"]
        PG[("PostgreSQL 15+<br/>Database: demo<br/>Schema: dealflow (Alembic-managed)")]
    end

    UI --> Proxy
    WS --> Proxy
    Dock --> Proxy
    Proxy --> Router
    Router --> Auth
    Router --> Pricing
    Router --> Policy
    Router --> Finalize
    Assistant --> Groq
    Assistant -.-> Gemini
    Assistant -.-> Sarvam
    Finalize --> PG
    Pricing --> PG
    Policy --> PG
    Outbox --> PG
    Scheduler --> PG
    Outbox -.-> WS
```

---

## Core Capabilities

### 1. Identity, Access & Governance
- JWT authentication with local HS256 signing, Supabase JWKS verification, and demo-token issuance.
- Role-based access control for `REP`, `MANAGER`, `FINANCE`, `ADMIN`, and `CUSTOMER`.
- Staff and customer registration, automatic rep provisioning, profiles, teams, and delegated approval windows.
- One-click demo login with deterministic personas for every role.
- Every mutation is scoped to the authenticated user's accessible customers, quotes, and teams.

### 2. Catalog & Price Governance
- Customer, category, product, variant, and warehouse management.
- Volume/tier price rules and subscription plans with one-time vs recurring pricing.
- Public catalog endpoint for customer-facing browsing.
- Discount policy definitions with versioned, role-aware approval thresholds.

### 3. CPQ & Pricing Engine
- **34-digit decimal precision** with `HALF_UP` rounding — no floating-point drift on high-value contracts.
- Volume tiers, customer tiers (Bronze, Silver, Gold, Platinum), and recurring subscription allocation.
- **Cryptographic commercial hash** (SHA-256) sealing quantities, rates, discounts, and terms.
- Quote lifecycle: create, evaluate, revise, submit, share, adopt, cancel, and full history.
- Quote-level recommendations: generate, apply, dismiss, and customer-requested follow-ups.
- Customer negotiation requests with seller responses.

### 4. Approval Governance
- Deterministic discount thresholds:
  - `0% – 10%`: sales rep self-clears.
  - `10% – 25%`: **Step 1 — Sales Manager**.
  - `> 25%`: sequential **Step 1 — Sales Manager**, then **Step 2 — Finance Controller**.
- Approval queue with decisions, reasons, reassignment, and audit events.
- Escalations with resolution workflow, SLA nudges, health alerts, and scheduled sweeps.
- Notifications for approval and deal events, with read tracking.

### 5. Customer Portal & Deal Room
- Shared quote review with itemized terms and downloadable PDF specifications.
- Counter-negotiation: propose prices, request line-item changes, and ask commercial questions.
- Seller adoption required before customer acceptance unlocks.
- Customer invoice list/detail with PDF export.
- Account management: profile, preferences, and password changes.

### 6. Orders & Fulfillment
- **10-step atomic order finalization** inside one transaction using `SELECT ... FOR UPDATE` row locks.
- Immediate stock reservation (`RESERVED`) or automatic backorder creation (`BACKORDERED`).
- Order allocation and replanning across warehouses.
- Stock levels, stock movements, shipment dispatch, and fulfillment tracking.
- Automatic sales order (`SO-XXXX`) and invoice (`INV-XXXX`) generation on acceptance.

### 7. Billing & Subscriptions
- Invoice listing, detail, and PDF export.
- Payments, refunds, and credit notes.
- Subscription plan-change previews and execution.
- Mid-cycle subscription changes and cancellations with proration calculations.
- Billing timezone configuration (default `Asia/Kolkata`).

### 8. Reporting, Operations & Real-Time
- Sales reporting with Excel export.
- Job-run tracking, leased outbox polling (`SKIP LOCKED`), and scheduled sweep workers.
- Real-time deal events over native WebSocket at `/ws`, authenticated by bearer token or `?token=`.
- Health endpoint at `/actuator/health`.

### 9. AI Workspace Assistant
- Groq-first inference with Gemini and Sarvam fallbacks; provider status endpoint.
- Responses grounded strictly in the caller's authorized deals, quotes, and role permissions.
- Explains pricing formulas, approval gates, and recommended next actions in plain language.

### 10. API Conventions
- Consistent response envelopes with typed error codes and `X-Request-Id` propagation.
- Decimal values serialized as JSON strings to preserve exact precision end to end.
- Idempotency keys on mutating commercial operations.
- Pydantic v2 validation at every trust boundary; no internal exception details leak to clients.

---

## Project Structure

```
├── backend_fastapi/            # Python 3.12 FastAPI backend
│   ├── app/
│   │   ├── api/v1/             # REST routers (auth, quotes, portal, orders, billing, catalog, ops)
│   │   ├── core/               # Config, security, async database engine, responses, exceptions
│   │   ├── engines/            # Pure math: pricing, risk, allocation, proration, commercial hash
│   │   ├── models/             # SQLAlchemy 2.1 async ORM models for the dealflow schema
│   │   ├── repositories/       # Atomic sequence generators & escalation persistence
│   │   ├── schemas/            # Pydantic v2 validation models & DTOs
│   │   ├── services/           # Domain workflows (quotes, approvals, billing, portal, fulfillment)
│   │   ├── websocket/          # Connection manager & authenticated /ws endpoint
│   │   └── workers/            # SKIP LOCKED outbox poller & scheduled sweep jobs
│   ├── migrations/             # Alembic async environment, baseline revision, schema SQL
│   ├── tests/                  # Unit, integration, and end-to-end workflow tests
│   ├── alembic.ini             # Alembic configuration (URL injected at runtime)
│   ├── requirements.txt        # Pinned Python dependencies
│   └── .env.example            # Environment template
│
├── frontend/                   # React 19 + Tailwind CSS 4 + Vite SPA
│   ├── src/
│   │   ├── components/         # Reusable UI components & AI Assistant Dock
│   │   ├── context/            # AuthContext & real-time connection state
│   │   ├── hooks/              # useDealEvents, useConnectionStatus, and related hooks
│   │   ├── layouts/            # Role-based admin & customer portal layouts
│   │   ├── pages/              # Quotes, approvals, fulfillment, billing, catalog, reports, portal
│   │   └── services/           # API client & WebSocket client
│   ├── package.json
│   └── vite.config.js          # Dev server & backend proxy routing
│
└── docs/                       # Architecture diagrams and specifications
```

---

## Quick Start

### Prerequisites
- **Python** `3.12+`
- **Node.js** `18+` with `npm`
- **PostgreSQL** `15+` running locally

### 1. Backend Setup

```bash
cd backend_fastapi

# Windows (PowerShell)
python -m venv venv
.\venv\Scripts\Activate.ps1

# Linux / macOS
python3 -m venv venv
source venv/bin/activate

pip install -r requirements.txt
```

Configure the environment:

```bash
cp .env.example .env
```

```ini
# Preferred database variable
DATABASE_URL=postgresql+asyncpg://postgres:your_password@127.0.0.1:5432/demo

# SPRING_DATASOURCE_URL is also accepted
# SPRING_DATASOURCE_URL=postgresql+asyncpg://postgres:your_password@127.0.0.1:5432/demo

AUTH_JWT_SECRET=replace-with-a-32-byte-or-longer-secret
GROQ_API_KEY=your_groq_api_key_here
GROQ_MODEL=openai/gpt-oss-120b
PORT=8080
```

Apply migrations and start the API:

```bash
alembic upgrade head
python -m uvicorn app.main:app --host 127.0.0.1 --port 8080 --reload
```

- **API base**: `http://127.0.0.1:8080`
- **Swagger UI**: `http://127.0.0.1:8080/docs`
- **Health check**: `http://127.0.0.1:8080/actuator/health`

Useful environment flags:

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `DEMO_SEED` | `false` | Seed demo data on startup |
| `DEMO_AUTH_ENABLED` | `false` | Enable demo token issuance |
| `JOBS_ENABLED` | `true` | Start outbox poller and sweep scheduler |
| `ALLOCATION_MODE` | `BALANCED` | Warehouse allocation strategy |
| `BILLING_TIMEZONE` | `Asia/Kolkata` | Billing/date boundary timezone |

### 2. Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

- Application: **`http://localhost:3000`**
- `/api/*` and `/ws` proxy to `http://127.0.0.1:8080` (override with `API_PROXY_TARGET` in `.env.local`).

---

## Demo Accounts

Deterministic personas are available from the sign-in screen (`/login`) when demo auth is enabled:

| Persona | Role | Email | Capabilities |
| :--- | :--- | :--- | :--- |
| **Sales Rep A** | `REP` | `rep.a@dealflow.demo` | Create quotes, apply discounts, submit proposals, adopt revisions |
| **Sales Rep B** | `REP` | `rep.b@dealflow.demo` | Manage assigned territory deals and customer quotes |
| **Sales Manager** | `MANAGER` | `manager.a@dealflow.demo` | Step 1 approvals, team margin compliance, health alerts |
| **Finance Controller** | `FINANCE` | `finance@dealflow.demo` | Step 2 approvals, invoice settlement, dispatches |
| **Alpha Buyer** | `CUSTOMER` | `alpha@customer.demo` | Portal access, counter-negotiation, quote acceptance |
| **Beta Buyer** | `CUSTOMER` | `beta@customer.demo` | Gold-tier client with volume pricing and deal room access |
| **System Admin** | `ADMIN` | `admin@dealflow.demo` | Catalog governance, discount policies, audit logging |

---

## End-to-End Walkthrough

1. **Create a quote** — Sign in as **Rep A**, open `/admin/sales/quotes`, create a quote for **Alpha Traders**, add catalog items, and apply a **20% discount**. Submit it; the quote enters `REVIEW` with a `PENDING_MANAGER` approval step.
2. **Manager approval** — Sign in as **Manager A**, open `/admin/manager/approvals`, review margin impact, and approve.
3. **Finance approval** — Sign in as **Finance Ops**, open `/admin/finance/approvals`, and approve the high-concession step. The quote becomes `APPROVED`.
4. **Publish to portal** — As **Rep A**, click **Adopt & Share with Customer**; the quote stage becomes `SENT`.
5. **Customer acceptance** — Sign in as **Alpha Buyer**, open `/customer/quotes`, review the shared quote, and accept. The atomic finalizer then:
   - sets the quote to `CONFIRMED`,
   - creates sales order `SO-XXXX`,
   - reserves stock (`RESERVED`) or creates a backorder,
   - issues invoice `INV-XXXX`.
6. **Ask the assistant** — Open **Ask DealFlow AI** and ask, for example, *"Explain my quote in plain language"* or *"What happens after I accept?"*

Additional workflows available in the UI: fulfillment and dispatch, billing and payments, subscription changes, catalog and policy administration, people/team management, reports, alerts, and customer account settings.

---

## Database & Migrations

Alembic manages the `dealflow` schema asynchronously through the same asyncpg engine the app uses:

```bash
cd backend_fastapi

alembic current        # show applied revision
alembic upgrade head   # apply pending migrations
alembic downgrade base # remove the dealflow schema
alembic revision -m "describe_change"  # create a new revision
```

- The current head is `0001_baseline`, which creates the complete schema, sequences, constraints, triggers, and indexes.
- `alembic_version` lives in the `public` schema so it survives a schema-level downgrade.
- The application connects with `search_path=dealflow,public`.
- Schema naming for some historical constraints differs from SQLAlchemy's auto-generated names, so `alembic revision --autogenerate` output is reviewed and edited before use.

---

## Test Suite

The backend ships with 168 unit, integration, and end-to-end tests covering pricing math, security, API workflows, approvals, billing, portal, realtime events, and concurrent finalization:

```bash
cd backend_fastapi
.\venv\Scripts\python -m pytest -v
```

The suite runs against `dealflow_test`. It expects a clean test database: accumulated quotes and alerts can push seeded rows outside the first page of results and cause `test_sweep_flags_stalled_quote` to fail. Reset the test schema before a full run if that occurs.

Production frontend build verification:

```bash
cd frontend
npm run build
```

---

## License

This project is licensed under the Apache 2.0 License.
