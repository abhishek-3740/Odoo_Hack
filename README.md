# DealFlow360

> **Autonomous Enterprise CPQ (Configure, Price, Quote) & Deal Execution Platform**  
> High-precision commercial math, multi-tier approval governance, interactive customer deal room, 10-step atomic order fulfillment, and context-grounded AI workspace assistant.

---

## Architecture Overview

```mermaid
flowchart TD
    subgraph Client ["Frontend Layer (Port 3000)"]
        UI["React 19 + Tailwind CSS + Vite SPA"]
        Stomp["STOMP / Native WebSocket Client"]
        Dock["DealFlow AI Assistant Dock"]
    end

    subgraph Gateway ["Vite Dev Proxy / API Gateway"]
        Proxy["Proxy (/api -> :8080, /ws -> :8080)"]
    end

    subgraph Backend ["FastAPI Backend Engine (Port 8080)"]
        Router["FastAPI REST & WebSocket Routers"]
        Auth["3-Issuer Auth & RBAC Guard"]
        Pricing["CPQ Pricing Engine (34-digit Precision)"]
        Policy["Discount Policy & Sequential Approvals"]
        Finalize["10-Step Atomic Order Finalizer (SELECT FOR UPDATE)"]
        Outbox["Outbox Poller (SKIP LOCKED)"]
        Assistant["AI Assistant Service"]
    end

    subgraph External ["LLM Inference Providers"]
        Groq["Groq API (openai/gpt-oss-120b)"]
        Gemini["Google AI Studio (gemini-3.5-flash-lite)"]
        Sarvam["Sarvam AI (Fallback)"]
    end

    subgraph Storage ["Persistent Storage (PostgreSQL 15+)"]
        PG[("PostgreSQL Database: demo<br/>Schema: dealflow (V1-V7)")]
    end

    UI --> Proxy
    Stomp --> Proxy
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
    Outbox -.-> Stomp
```

---

## Core Capabilities

### 1. High-Precision CPQ & Pricing Engine
- **34-Digit Precision Math**: All calculations use high-precision decimal context (`Decimal128` / `HALF_UP`), eliminating floating-point rounding errors on high-value contracts.
- **Cryptographic Commercial Hash**: Byte-exact SHA-256 state signature (`CommercialHash`) ensures line quantities, unit rates, discounts, and terms cannot be tampered with between quote generation and customer execution.
- **Dynamic Tier & Volume Matrix**: Automatic volume tier pricing, customer tier discounting (Bronze, Silver, Gold, Platinum), and one-time vs recurring subscription allocation.

### 2. Commercial Governance & Multi-Tier Approvals
- **Deterministic Discount Policies**:
  - `0% - 10%`: Sales representative self-clearing.
  - `10% - 25%`: Requires **Step 1 (Sales Manager)** review.
  - `> 25%`: High-concession deal requiring sequential **Step 1 (Manager)** then **Step 2 (Finance Controller)** review.
- **Sequential Approval Queue**: Dedicated approval queues with audit-logged decision events, reasons, delegation windows, and SLA nudge tracking.

### 3. Customer Portal & Interactive Deal Room
- **Self-Service Customer Portal**: Customers review shared proposals, download PDF specifications, and inspect itemized terms.
- **Counter-Negotiation**: Customers can propose counter-prices, request line item modifications, and ask commercial questions.
- **Seller Adoption**: Commercial changes require seller confirmation (`REVISION_ADOPTED`) before customer acceptance is unlocked.

### 4. 10-Step Atomic Order Finalization
- **Transactional Row Locks**: Finalization runs inside an isolated atomic transaction utilizing `SELECT ... FOR UPDATE` row locks across inventory levels.
- **Stock Allocation & Backorders**: Immediate stock reservation (`RESERVED`) or automatic backorder generation (`BACKORDERED`) based on live warehouse inventory.
- **Automated Billing Initialization**: Instant Sales Order generation (`SO-XXXX`) and matching invoice creation (`INV-XXXX`) with status `ISSUED`.

### 5. Context-Grounded AI Workspace Assistant
- **High-Speed Inference**: Powered by **Groq (`openai/gpt-oss-120b`)** with fallback to **Google AI Studio (`gemini-3.5-flash-lite`)** or **Sarvam**.
- **Role-Restricted Context Snapshots**: Chat responses are grounded strictly in the active user's authorized deals and quotes—never hallucinates pricing or exposes sensitive competitor/margin data.
- **Deal Guidance**: Explains complex pricing formulas, approval gate requirements, and next recommended actions in plain language.

---

## Project Structure

```
├── backend_fastapi/            # High-performance Python 3.12+ FastAPI backend
│   ├── app/
│   │   ├── api/v1/             # REST API routers (quotes, portal, orders, billing, ops)
│   │   ├── core/               # Configuration, security, database engine, response envelopes
│   │   ├── engines/            # Pure mathematical CPQ engines (pricing, risk, allocation, hash)
│   │   ├── models/             # SQLAlchemy 2.0 ORM models (44 tables matching dealflow schema)
│   │   ├── repositories/       # Atomic sequence generators & escalation persistence
│   │   ├── schemas/            # Pydantic v2 validation models & DTOs
│   │   ├── services/           # Domain business logic & transactional workflows
│   │   ├── websocket/          # Real-time WebSocket connection manager & STOMP endpoint
│   │   └── workers/            # SKIP LOCKED outbox poller & scheduled sweep jobs
│   ├── tests/                  # 168 unit, integration, and E2E workflow tests
│   ├── requirements.txt        # Pinned Python dependencies
│   └── .env.example            # Environment template
│
├── frontend/                   # Modern React 19 + Tailwind CSS + Vite SPA
│   ├── src/
│   │   ├── components/         # Reusable UI components & AI Assistant Dock
│   │   ├── context/            # AuthContext & real-time connection state
│   │   ├── hooks/              # Custom React hooks (useDealEvents, useConnectionStatus)
│   │   ├── layouts/            # Role-based workspace layouts (Admin & Customer Portal)
│   │   ├── pages/              # Views for Quotes, Approvals, Fulfillment, Billing, Reports
│   │   └── services/           # Axios-like API wrapper & STOMP WebSocket client
│   ├── package.json            # Node.js dependencies & scripts
│   └── vite.config.js          # Vite configuration & backend proxy routing
│
├── docs/                       # Architecture diagrams, specifications, and solution reports
└── MIGRATION_MEMORY.md         # Detailed engineering audit, parity matrices, and migration log
```

---

## Quick Start Guide

### Prerequisites
- **Python**: `3.12+`
- **Node.js**: `18.x` or `20.x+` (with `npm`)
- **PostgreSQL**: `15+` (with `dealflow` schema initialized)

---

### 1. Backend Setup (`backend_fastapi`)

1. **Navigate to the backend directory**:
   ```bash
   cd backend_fastapi
   ```

2. **Create and activate a virtual environment**:
   ```bash
   # Windows (PowerShell)
   python -m venv venv
   .\venv\Scripts\Activate.ps1

   # Linux / macOS
   python3 -m venv venv
   source venv/bin/activate
   ```

3. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

4. **Configure environment**:
   ```bash
   cp .env.example .env
   ```
   *Edit `.env` to configure your PostgreSQL credentials and LLM keys:*
   ```ini
   SPRING_DATASOURCE_URL=postgresql+asyncpg://postgres:your_password@127.0.0.1:5432/demo
   GROQ_API_KEY=your_groq_api_key_here
   GROQ_MODEL=openai/gpt-oss-120b
   PORT=8080
   ```

5. **Start the API server**:
   ```bash
   python -m uvicorn app.main:app --host 127.0.0.1 --port 8080 --reload
   ```
   - **API Base**: `http://127.0.0.1:8080`
   - **Interactive Swagger Docs**: `http://127.0.0.1:8080/docs`
   - **Health Check**: `http://127.0.0.1:8080/actuator/health`

---

### 2. Frontend Setup (`frontend`)

1. **Navigate to the frontend directory**:
   ```bash
   cd frontend
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Start the development server**:
   ```bash
   npm run dev
   ```
   - Access the application at **`http://localhost:3000`**.
   - API requests (`/api/*`) and WebSockets (`/ws`) are proxied automatically to `:8080`.

---

## Demo Accounts & Persona Matrix

DealFlow360 includes deterministic demo accounts for instant 1-click login on the sign-in screen (`/login`):

| Persona | Role | Email | Capabilities |
| :--- | :--- | :--- | :--- |
| **Sales Rep A** | `REP` | `rep.a@dealflow.demo` | Create quotes, apply discounts, submit proposals, adopt revisions |
| **Sales Rep B** | `REP` | `rep.b@dealflow.demo` | Manage assigned territory deals and customer quotes |
| **Sales Manager** | `MANAGER` | `manager.a@dealflow.demo` | Step 1 discount approvals, team margin compliance, health alerts |
| **Finance Controller**| `FINANCE` | `finance@dealflow.demo` | Step 2 high-concession approvals, invoice settlement, dispatches |
| **Alpha Buyer** | `CUSTOMER` | `alpha@customer.demo` | Customer portal access, counter-negotiation, quote acceptance |
| **Beta Buyer** | `CUSTOMER` | `beta@customer.demo` | Gold-tier client with tailored volume pricing and deal room access |
| **System Admin** | `ADMIN` | `admin@dealflow.demo` | Catalog governance, discount policy definition, audit logging |

---

## Quotation Verification Workflow

To test the end-to-end lifecycle:

1. **Create Quote**:
   - Sign in as **Rep A** (`rep.a@dealflow.demo`).
   - Go to `/admin/sales/quotes` $\rightarrow$ Click **"+ New Quote"** $\rightarrow$ Select customer **Alpha Traders**.
   - Add catalog items and apply a **20% discount** (breaching the 10% self-clear threshold).
   - Click **"Submit for Review"** $\rightarrow$ Status changes to `REVIEW`, queued for `PENDING_MANAGER`.

2. **Manager Approval (Step 1)**:
   - Switch persona to **Manager A** (`manager.a@dealflow.demo`).
   - Go to `/admin/manager/approvals` $\rightarrow$ Review margin impact and click **"Approve"**.

3. **Finance Approval (Step 2)**:
   - Switch persona to **Finance Ops** (`finance@dealflow.demo`).
   - Go to `/admin/finance/approvals` $\rightarrow$ Click **"Approve"** $\rightarrow$ Status becomes `APPROVED`.

4. **Publish to Customer Portal**:
   - Switch back to **Rep A** $\rightarrow$ Click **"Adopt & Share with Customer"** $\rightarrow$ Stage moves to `SENT`.

5. **Customer Deal Room & Acceptance**:
   - Switch persona to **Alpha Buyer** (`alpha@customer.demo`).
   - Go to `/customer/quotes` $\rightarrow$ Open the shared quote.
   - Click **"Accept & confirm"** $\rightarrow$ The atomic transaction executes:
     - Quote stage becomes `CONFIRMED`.
     - Order `SO-XXXX` is created.
     - Stock is locked (`RESERVED`).
     - Invoice `INV-XXXX` is issued (`18,000.00 INR`).

6. **DealFlow AI Assistant**:
   - Click **"Ask DealFlow AI"** in the bottom corner of any page.
   - Powered by **Groq**, ask questions such as *"Explain my quote in plain language"* or *"What happens after I accept?"*.

---

## Test Suite & Verification

The backend includes a comprehensive 168-test suite validating all pure math engines, security layers, API workflows, and concurrent finalizations:

```bash
cd backend_fastapi
.\venv\Scripts\python -m pytest -v
```

```
============================== test session starts ==============================
collected 168 items

tests/test_api_flows.py ........                                           [  4%]
tests/test_auth.py ..............                                          [ 12%]
tests/test_billing.py ......                                               [ 16%]
tests/test_catalog.py .................                                    [ 26%]
tests/test_core_foundations.py ............                                [ 33%]
tests/test_engines.py .................................................... [ 70%]
tests/test_fulfillment.py ........                                         [ 75%]
tests/test_models.py ....                                                  [ 78%]
tests/test_ops.py ........                                                 [ 83%]
tests/test_portal.py ........                                              [ 88%]
tests/test_quotes.py ......                                                [ 91%]
tests/test_realtime.py ....                                                [ 94%]
tests/test_security.py ...........                                         [100%]

============================== 168 passed in 12.4s ==============================
```

To verify the production frontend build:
```bash
cd frontend
npm run build
```

---

## License

This project is licensed under the Apache 2.0 License.
