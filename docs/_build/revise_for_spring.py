from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def section(text, start, end, replacement):
    a = text.index(start)
    b = text.index(end, a)
    return text[:a] + replacement.strip() + '\n\n' + text[b:]

def replace(text, old, new):
    if old not in text:
        raise ValueError('Missing replacement anchor: ' + old[:130])
    return text.replace(old, new)

report_path = ROOT / 'DealFlow360-Solution-Report.md'
r = report_path.read_text(encoding='utf-8')
r = replace(r, '**Decision document • 5 September 2026 • Team: 4 • Build window: 24 hours**', '**Revision 2 • 5 September 2026 • Team: 4 • Build window: 24 hours**\n\n**Update:** The team confirmed practical Spring Boot experience. This edition replaces the TypeScript backend proposal with Spring Boot and incorporates all 23 submitted edge cases. The previous edition is preserved in `_archive/revision-1`.')
r = section(r, '## 1. Executive decision', '## 2. What the problem', '''
## 1. Executive decision

Use **Spring Boot with Java 21 for the backend**, Spring Data JPA/Hibernate with PostgreSQL for persistence, Spring Security for API authorization, and authenticated STOMP over WebSocket for live updates. Retain Next.js/React/TypeScript for the frontend. Keep Supabase as the managed PostgreSQL and identity provider; Spring verifies its access tokens and enforces application roles and record ownership.

The team confirmed practical Spring Boot experience. That changes the earlier tradeoff: Spring's transaction, persistence, security, and messaging ecosystem is now a useful productivity advantage rather than a framework to learn during the event. This is a team-specific recommendation, not a claim that JavaScript backends lack customization, WebSockets, queues, or transaction support.

Build **one modular Spring backend**, one frontend, and one database. Keep quote finalization, reservations, and initial billing in a database transaction. Microservices would turn that operation into a distributed consistency problem. RabbitMQ is an optional asynchronous-processing stage after the core passes, not a required route through which all HTTP requests must travel.

Use a database outbox for committed notification events. The initial dispatcher pushes authorized UI invalidations through Spring's simple WebSocket broker. A later RabbitMQ dispatcher/worker can reuse those events. Neither a WebSocket frame nor a broker acknowledgment is the source of truth for an approved quote or paid invoice.

No trained machine-learning model is required. Purchase-history statistics support recommendations; explicit policies support approvals, allocation, proration, and alerts. The optional creative extension remains **Deal Lab**, which compares valid quotation alternatives using these same engines.

Four people have at most 96 gross person-hours, before coordination and rehearsal. The full brief is ambitious. Preserve required business behavior, deploy both applications early, and cut optional services/innovation before sacrificing correctness.
''')
r = section(r, '## 5. Architecture and framework decisions', '## 6. Required intelligence', '''
## 5. Architecture and framework decisions

### 5.1 Spring Boot versus the alternatives

| Choice | Fit for this team | Important tradeoff |
|---|---|---|
| Spring Boot modular backend | Recommended: existing practical experience, strong fit for transactional workflows | Two runtimes/deployments and explicit frontend/backend contracts |
| Next.js full-stack backend | Still viable for a TypeScript-first team and a short event | Persistent WebSockets normally need a separate suitable runtime when deployed serverlessly |
| NestJS backend | Viable structured TypeScript alternative with WebSocket/queue integrations | Switching to an unfamiliar framework has no demonstrated benefit here |
| Spring microservices from day one | Defer | Quotes, stock, and invoices would need distributed recovery, messaging, and additional deployments |

JPA reduces mapping and repository boilerplate. It does not eliminate connection limits, deadlocks, stale data, or overselling. Use HikariCP, explicit service transactions, optimistic versions, pessimistic inventory locks, database constraints, and Flyway migrations. Spring Data exposes locking and transaction mechanisms; the team must apply them correctly. [Spring Data JPA locking](https://docs.spring.io/spring-data/jpa/reference/jpa/locking.html), [transactionality](https://docs.spring.io/spring-data/jpa/reference/jpa/transactions.html)

RabbitMQ buffers asynchronous jobs and controls consumer workload. It is not an HTTP load balancer or an automatic database scaling solution. The baseline manages traffic through bounded requests, pagination, debouncing, connection-pool limits, and measured indexes. A queue is justified later for notifications, exports, and external integrations that can complete asynchronously.

### 5.2 Selected stack

| Layer | Selection | Purpose |
|---|---|---|
| Frontend | Next.js 16, React, TypeScript, Tailwind, shadcn/ui | Internal workspace and genuinely separate portal |
| Client data/forms | TanStack Query, React Hook Form, Zod | Validated input and server-authoritative state |
| Backend | Java 21, patched Spring Boot 4.1.x, Spring MVC | REST controllers and modular domain services |
| Identity/security | Supabase Auth + Spring Security OAuth2 Resource Server | JWT verification plus database-backed role/ownership checks |
| Persistence | PostgreSQL, Spring Data JPA/Hibernate, HikariCP, Flyway | Mapping, transactions, connection pooling, schema migration |
| Money/calendar | Java BigDecimal, integer persisted minor units, java.time | Exact rounding and explicit calendar periods |
| Live updates | Spring WebSocket/STOMP + `@stomp/stompjs` | Authenticated per-user updates after commit |
| Jobs/events | Spring scheduler, DB leases, transactional outbox | Browser-independent billing and recoverable notifications |
| Exports | Apache PDFBox and Apache POI | Server-authorized PDF, XLSX, and legacy XLS if needed |
| Verification | Spring Boot Test/JUnit, Testcontainers PostgreSQL, Playwright | Rules, real DB concurrency, auth and browser journeys |
| Hosting | Vercel frontend, one persistent Spring container on Railway, Supabase DB/Auth | Long-running scheduler/WebSocket support |
| Optional later | Spring AMQP + RabbitMQ | Durable asynchronous processing beyond the baseline |

Choose compatible patched releases through Spring Initializr and Boot's dependency management; do not independently combine arbitrary Hibernate/Security versions. Java 21 is compatible with the checked Boot requirements. Keep an already-tested supported Spring baseline if a major-version migration would otherwise consume the event. [Spring Boot requirements](https://docs.spring.io/spring-boot/system-requirements.html)

WebSocket subscriptions are private and authenticated. Reconnect triggers an authorized REST refresh, because push messages can be missed. Spring's simple broker is sufficient for the chosen single-instance deployment and is not a clustered broker. [Spring broker documentation](https://docs.spring.io/spring-framework/reference/web/websocket/stomp/handle-broker-relay.html)

Deploy the Spring server on a host that supports persistent processes and WebSocket upgrades. Railway documents this support; verify account resources and keep the instance running rather than assuming a sleeping/free service can run billing jobs. [Railway networking](https://docs.railway.com/networking/public-networking/specs-and-limits)
''')
r = replace(r, '| Stock before customer acceptance | Preview only; reserve transactionally when the order becomes executable |', '| Stock before customer acceptance | Preview only; reserve after all gates pass; accepted backorder policy determines shortage behavior |')
r = replace(r, '| Real-time behavior | Refresh immediately after actions and poll every five seconds; display last refresh time |', '| Real-time behavior | Authenticated WebSocket invalidation after commit, REST refetch, and polling fallback |')
r = replace(r, '| “XLS” export | Provide real XLSX; verify whether the organizer literally requires legacy XLS |', '| “XLS” export | Apache POI supports real XLS and XLSX; expose the chosen workbook format clearly |')
r = replace(r, 'Members own vertical modules: A owns platform/quote/governance; B owns fulfillment; C owns recurring billing/payments; D owns portal/recommendations/reporting. Each builds their corresponding server code and screens using shared components. Merge small working changes every two hours. All four agree on database keys, money units, statuses, and service signatures at the start.', 'Members own delivery modules: A owns platform/quote/governance; B owns fulfillment and its UI; C owns recurring billing/payments; D owns portal/recommendations/reporting. Assign Java changes to members with that experience and pair frontend-focused members through explicit OpenAPI contracts. Merge small working changes every two hours. Agree on keys, money units, statuses, REST schemas, and Java service boundaries at the start.')
r = replace(r, '| Four developers create incompatible modules | Shared TypeScript contracts and centrally reviewed migrations in the first hour |', '| Four developers create incompatible modules | OpenAPI contract, generated frontend types, and centrally reviewed Flyway migrations in the first hour |')
r = replace(r, '| Deployment fails near the deadline | Deploy login and one database query by hour 2; keep a tested local app fallback |', '| Deployment fails near the deadline | Deploy frontend, Spring API and one database query by hour 2; test the actual WebSocket endpoint early |')
r = section(r, '## 11. Architecture decision record', '## 12. Sources and interpretation', '''
## 11. Architecture decision record

**Context:** Four developers, one day, confirmed Spring Boot experience, many related transactions, and 23 submitted edge cases.

**Decision:** Next.js frontend, a modular Spring Boot backend, PostgreSQL/JPA with explicit locking and migrations, managed identity, authenticated WebSockets, and a transactional outbox. RabbitMQ and microservice extraction are optional later steps.

**Consequences:** The stack uses familiar backend tools but requires two deployment pipelines and cross-language API contracts. Persistent scheduling and WebSockets are straightforward on the chosen backend runtime. Locks, versions, and idempotency remain essential regardless of JPA.

**Evolution triggers:** Add RabbitMQ when measurable async backlog/external integration warrants it. Add a distributed WebSocket broker/routing arrangement before horizontal replicas. Extract workers before splitting tightly coupled quote/order/stock/billing transactions. Consider separate services only with independent scaling/ownership requirements and explicit compensation/idempotency design.

### 11.1 Edge-case decisions incorporated in revision 2

All 23 submitted cases are resolved and paired with tests in section 19 of the Implementation Plan. The important changes are:

- Apply order discounts consistently and test each line's combined discount; below-limit lines never cancel another line's positive violation. Promotion is not a policy exemption.
- Block zero-revenue/100%-discount lines in this build. Non-positive contribution at a positive price requires Finance. The margin percentage at zero revenue is undefined, not zero.
- Serialize version-specific approval actions, invalidate pending work after edits/cancellation, and provide audited role-qualified reassignment when an approver is unavailable.
- Re-evaluate all changed terms even when a requested discount decreases; bypass approval only when the new version meets the current policy.
- Permit a pure backorder only under explicit accepted backorder terms. An invalid manual warehouse allocation is rejected rather than silently changed.
- Use a cost-aware shipping score with a per-extra-shipment penalty, so two inexpensive local shipments can beat one expensive remote shipment.
- Prorate the **additional ten units** in a 10-to-20 upgrade using actual dates. “Day 15” and “15 elapsed days” are different inputs.
- Keep accepted hardware discounts intact on support cancellation; no undisclosed clawback is added. Backdated activation is rejected in this hackathon scope.
- Require idempotent counter submissions, reject invalid discounts, require exact-version acceptance, and make post-order negotiation read-only.
- Separate activity from external/business progress. Repeated rep edits do not reset the no-progress timer. New reps do not get an invented zero-percent statistical baseline.

These are explicit proposed policies. The edge-case attachment raises questions; it does not itself define the correct policy or authorize external transactions.
''')
r = replace(r, 'Technical references checked on 5 September 2026:', 'Revision 2 sources: the team\'s supplied `pasted-text.txt` containing 23 edge cases, and official Spring/JPA/WebSocket/RabbitMQ/Apache references linked in this edition and the plan.\n\nTechnical references checked on 5 September 2026:')
r = replace(r, '[node-postgres transactions](https://node-postgres.com/features/transactions)', '[Spring transactions](https://docs.spring.io/spring-data/jpa/reference/jpa/transactions.html)')
r = replace(r, '[Supabase Cron](https://supabase.com/docs/guides/cron)', '[Spring scheduling](https://docs.spring.io/spring-framework/reference/integration/scheduling.html)')
r = replace(r, '[pdf-lib](https://github.com/Hopding/pdf-lib)', '[Apache PDFBox](https://pdfbox.apache.org/)')
report_path.write_text(r, encoding='utf-8')

plan_path = ROOT / 'DealFlow360-Implementation-Plan.md'
p = plan_path.read_text(encoding='utf-8')
p = replace(p, '**Build specification • 5 September 2026 • Four developers • 24 hours**', '**Revision 2 • 5 September 2026 • Four developers • 24 hours**\n\n**Confirmed team context:** practical Spring Boot experience. This edition replaces the proposed Next.js business backend with Spring Boot, adds authenticated WebSockets and an outbox, and incorporates all 23 submitted edge cases. RabbitMQ remains an explicitly optional later stage.')
p = section(p, '## 2. Stack, setup, and repository', '## 3. Requirement coverage matrix', '''
## 2. Stack, setup, and repository

### 2.1 Selected stack and deployment shape

| Concern | Selection | Constraint |
|---|---|---|
| Frontend | Next.js 16, React, TypeScript; Node 24 LTS target | UI only; no duplicate authoritative business backend |
| Backend | Java 21, patched Spring Boot 4.1.x, Spring MVC | One modular backend process and database |
| Design/forms | Tailwind, shadcn/ui, React Hook Form, Zod | Client validation complements Java validation |
| API contract | Versioned OpenAPI YAML; generated TypeScript DTOs | Java controller DTOs and contract tests must agree |
| Identity | Supabase Auth + Spring Security OAuth2 Resource Server | Verify signature, issuer, expiry and audience; read stored role |
| Database | Supabase PostgreSQL, JPA/Hibernate, HikariCP, Flyway | DTO projections, explicit transactions and locks |
| Money/dates | Java BigDecimal, java.time; BIGINT minor units in DB | Server calculates; JSON amounts are decimal strings |
| Live UI | Spring WebSocket/STOMP and `@stomp/stompjs` | Private per-user events after commit; REST refetch |
| Client fetching | TanStack Query | Invalidation on events, full refresh on reconnect, 5-second fallback |
| Reports | Recharts UI, Apache PDFBox, Apache POI backend | Server-authorized PDF and genuine XLS/XLSX |
| Tests | Spring Boot Test/JUnit, Testcontainers PostgreSQL, Playwright | Java rules, actual DB races, browser and WebSocket security |
| Jobs | Spring scheduler, persisted leases, database outbox | Independent of browser; catch up after restart |
| Hosting | Vercel frontend; persistent Spring container on Railway; Supabase | Separate frontend/backend deploy; HTTPS/WSS |
| Optional later | Spring AMQP + RabbitMQ | Async notifications/exports/integrations, not synchronous core gates |

The team has confirmed Spring experience, so this is the selected path. If an existing tested supported Spring baseline differs, pin it consistently rather than undertaking a major migration during the event. Boot's dependency management chooses compatible Spring/Hibernate components. The checked Boot requirements support Java 21. [Boot requirements](https://docs.spring.io/spring-boot/system-requirements.html)

Keep REST commands for approvals, counteroffers, payments, and stock mutations. WebSockets deliver committed update notifications; a disconnected client can still use REST. No broker is required for the initial single-backend deployment.

### 2.2 Bootstrap — execute when implementation starts

Generate a Java 21 Maven project with Spring Initializr using a current patched stable Boot 4.1 release. Select Spring Web/MVC, Validation, Spring Security, OAuth2 Resource Server, Spring Data JPA, PostgreSQL Driver, Flyway, WebSocket, and Actuator. Add PostgreSQL support for Flyway if required by the generated version. Use the Maven wrapper and Boot-managed dependency versions. Add PDFBox, POI, PostgreSQL Testcontainers, and contract-testing dependencies; add Spring AMQP only in the optional messaging stage.

Place the generated application under `apps/api`. Create the frontend under `apps/web` with the following illustrative commands, run from the repository's `apps` directory. These have not been executed for this planning task.

```powershell
npx create-next-app@16 web --ts --tailwind --eslint --app --src-dir --use-npm
cd web
npm install @supabase/supabase-js @tanstack/react-query react-hook-form @hookform/resolvers zod @stomp/stompjs lucide-react recharts
npm install -D @playwright/test openapi-typescript
npx shadcn@latest init
npx shadcn@latest add button input label card table dialog tabs badge select textarea dropdown-menu sheet sonner
npx playwright install chromium
```

Commit the npm lockfile and Maven wrapper. Add frontend scripts for typecheck, lint, build, e2e, and generating DTOs from `contracts/openapi.yaml`. Backend verification uses `./mvnw verify` (`.\\mvnw.cmd verify` in PowerShell), with integration-test configuration that actually starts PostgreSQL Testcontainers. Do not treat a skipped Docker-dependent test suite as passed.

Use Flyway numbered SQL migrations under the backend resources. Run migrations with a controlled migration credential; runtime credentials have narrower grants. Configure `spring.jpa.hibernate.ddl-auto=validate` and `spring.jpa.open-in-view=false`. Do not use schema auto-update as migration history.

### 2.3 Repository and module ownership

```text
apps/
  web/src/
    app/(auth)/login/ signup/
    app/(internal)/workspace/ admin/
    app/portal/                    # separate customer layout
    components/ui/
    features/quotes/ approvals/ fulfillment/ billing/ reports/
    lib/api/ auth/ websocket/
    generated/api-types.ts
  api/src/main/java/com/dealflow/
    auth/ catalog/ quotes/ approvals/ recommendations/
    fulfillment/ billing/ portal/ reporting/
    notifications/ outbox/ jobs/
    shared/money/ time/ errors/
  api/src/main/resources/
    application.yml
    db/migration/
  api/src/test/java/com/dealflow/
contracts/openapi.yaml
tests/e2e/
docs/
infra/Dockerfile.api
```

Organize Java packages by business module, with controller, application service, domain rule, repository, entity, and DTO classes inside each. Controllers validate and authorize; services orchestrate transactions; pure Java rules calculate outcomes without I/O. Do not return JPA entities directly from controllers. OpenAPI is the cross-language contract; there are no shared TypeScript domain functions on the backend.

### 2.4 What JPA does and does not solve

Use JPA repositories for mapping/CRUD and projections for reporting. Use `@Version` on mutable quote/approval aggregates and pessimistic write locks for scarce-stock/payment allocation rows. For aggregate locks, indexed native SQL can be clearer than a complicated entity graph. Keep lock acquisition order consistent. Add DB unique/check constraints; annotations alone cannot enforce every cross-row invariant. [JPA locking](https://docs.spring.io/spring-data/jpa/reference/jpa/locking.html)

Use HikariCP with an initial maximum pool of 5 per instance and bounded acquisition/statement timeouts. The total across replicas and maintenance tools must fit the actual database limit. Use a direct PostgreSQL connection where networking permits, or Supabase's **session** pooler for this persistent backend. Do not reuse the old serverless transaction-pooler configuration blindly. Keep TLS verification enabled. [Supabase connections](https://supabase.com/docs/guides/database/connecting-to-postgres)

JPA is not a guarantee against connection failure, N+1 queries, lazy-loading exceptions, lost updates, or overselling. Fetch required DTO data inside the intended transaction; page list queries; inspect SQL/query counts. Put `@Transactional` on externally invoked application-service methods, use REQUIRED propagation across core modules, and configure rollback for relevant checked exceptions. Avoid self-invocation assumptions, nested REQUIRES_NEW financial writes, and network calls while locks are held. [Spring transactionality](https://docs.spring.io/spring-data/jpa/reference/jpa/transactions.html)
''')
p = replace(p, '| A1 login/signup/portal identity | Supabase Auth, role profile, protected routes |', '| A1 login/signup/portal identity | Supabase Auth, Spring JWT security, role profile |')
p = replace(p, '| B6 split/override/backorder | Allocation engine, reservations, receipt/replan, dispatch |', '| B6 split/override/backorder | Cost-aware allocation, accepted shortage policy, reservations, receipt/replan |')
p = section(p, '## 4. Architecture and quality priorities', '## 5. Data model and invariants', '''
## 4. Architecture and quality priorities

```mermaid
flowchart LR
  UI[Next.js internal workspace + restricted portal] -->|HTTPS REST + Bearer token| API[Spring MVC + Security]
  AUTH[Supabase Auth] -->|JWT verified through issuer/JWKS| API
  API --> SERVICES[Modular Java application services]
  SERVICES -->|JPA / transactional locks| DB[(PostgreSQL)]
  SERVICES --> RULES[Pricing / risk / allocation / proration]
  DB --> OUTBOX[Committed outbox events]
  OUTBOX --> WS[Spring STOMP private user updates]
  WS -->|WSS invalidation then REST refresh| UI
  JOBS[Spring scheduled jobs + DB leases] --> SERVICES
  OUTBOX -. optional later .-> MQ[RabbitMQ async workers]
```

Priorities: correct commercial/financial state; role/ownership isolation; complete observable journeys; predictable UI; performance on the demo dataset. Browser calculations are previews only. Java evaluates every authoritative money/risk decision.

Transactional boundaries remain: submit/version quote; act on approval; adopt/accept candidate; finalize order; reserve/reallocate/dispatch stock; generate a charge; allocate payment/credit. Each change writes audit and outbox records in the same database transaction. An application-level coordinator calls modules in the same Spring transaction. This is why the baseline uses a modular monolith rather than microservices.

Events are dispatched only after commit. `@TransactionalEventListener(AFTER_COMMIT)` can trigger an immediate best-effort notification, but by itself cannot recover a crash between commit and send. A persisted outbox supplies recovery; a dispatcher retries with event IDs and aggregate versions. [Spring transaction-bound events](https://docs.spring.io/spring-framework/reference/data-access/transaction/event.html)

Keep private HTTP responses no-store. Partition frontend caches by user and clear on sign-out. Do not attach internal pricing information to portal responses or notification payloads. Customer ownership is checked in the Spring API, regardless of whether the frontend hid a control.
''')
p = replace(p, '| `profiles` | `auth_user_id`, role, team_id, customer_id nullable, is_active; role/customer mapping is server-controlled |', '| `profiles` | `auth_user_id`, role, team_id, customer_id nullable, is_active, unavailable_until; server-controlled mapping |\n| `approval_delegations` | approver role/team, delegate, valid_from/until, reason, creator; only role-qualified substitutes |')
p = replace(p, '| `quotes` | customer, rep/team, current_revision_id, stage, row_version, valid_until, last_business_activity_at |', '| `quotes` | customer, rep/team, current_revision_id, stage, row_version, valid_until, last_activity_at, last_progress_at, awaiting_external_since |')
p = replace(p, '| `quote_revisions` | quote_id, revision_no unique, source, currency, price/policy snapshots, risk result, commercial_hash, seller_adopted_at, customer_accepted_at |', '| `quote_revisions` | quote_id, revision_no unique, source, currency, price/policy snapshots, risk result, commercial_hash, seller_adopted_at, customer_accepted_at; accepted backorder/invoice/bundle terms |')
p = replace(p, '| `approval_requests` | revision_id, step 1/2, approver_role, status, actor, decision reason/time; unique revision+step |', '| `approval_requests` | revision_id, step 1/2, role/team, optional assignee, due_at, status, actor, reason/time, row_version; unique revision+step |')
p = replace(p, '| `job_runs`, `idempotency_requests` | job/date cursor and lease; actor+operation+key, payload hash, saved result |', '| `job_runs`, `idempotency_requests` | job/date cursor and lease; actor+operation+key, payload hash, saved result |\n| `outbox_events` | event_id, aggregate_id/version, type, minimal payload, attempt_count, next_attempt_at, lease_until, dispatched_at |\n| `processed_events` (optional RabbitMQ stage) | unique consumer+event_id; recorded with that consumer\'s business effect |')
p = replace(p, 'Store relevant versioned configuration as JSON where that saves UI/schema time, but validate it with Zod before saving.', 'Store relevant versioned configuration as JSON where it saves schema time, but validate it with Java DTO/Bean Validation and domain constraints before saving.')
p = replace(p, 'discounts are 0–10,000 basis points.', 'discounts are 0–9,999 basis points; reject any discounted line rounding to zero net in this build.')
p = replace(p, 'Keep tax and net components separate.', 'Use BigDecimal created from strings/integers, not doubles; use a documented high-precision intermediate context and explicit HALF_UP final rounding. Keep tax and net components separate.')
p = replace(p, 'DRAFT -> REVIEW -> SENT -> UNDER_NEGOTIATION -> CONFIRMED\n                    |                              |\n                    +-> LOST / EXPIRED              +-> unique ORDER', 'DRAFT -> REVIEW -> SENT -> UNDER_NEGOTIATION -> CONFIRMED\n   |                |                              |\n   +-> CANCELED     +-> LOST / EXPIRED / CANCELED     +-> unique ORDER')
p = replace(p, 'Manager can review a counter candidate, but approval alone does not imply seller adoption or customer acceptance.', 'All approval and candidate-changing commands lock the quote aggregate and verify expected revision/version. Conflicting/stale commands return 409 rather than overwriting a terminal decision. Manager can review a counter candidate, but approval alone does not imply seller adoption or customer acceptance.')
p = replace(p, 'Display margin as undefined when net is zero; such quotes cannot silently pass a configured margin floor.', 'The calculation function represents margin as undefined when net is zero, but API validation blocks zero-net/100%-discount lines in the selected build. At positive revenue, a line with zero or negative contribution requires Finance.')
p = replace(p, 'Preview results can be recomputed with the same pure function in the browser, but only server results may be persisted.', 'The client can show provisional arithmetic, but the authoritative implementation is Java. Submit identifiers/inputs to the evaluation endpoint and display the returned totals; do not maintain a second authoritative TypeScript pricing engine.')
p = replace(p, 'or any line has negative contribution.', 'or any positive-net line has zero or negative contribution.')
p = replace(p, 'If a quote has no commercial value, reject it rather than divide by zero.', 'Reject zero-net lines and zero-value quotations before routing. Promotion flags only affect recommendation rank; they never relax discount or margin rules. Lower discounts still trigger full re-evaluation; old approvals are not copied.')
p = replace(p, 'Before confirmation the split is only a live preview.', 'Before confirmation the split is only a live preview. Accepted terms contain `ALLOW_BACKORDER` or `IN_STOCK_ONLY`; quote creation itself permits out-of-stock products. A pure backorder has zero shipments/reservations and all requested stocked units in backorders.')
p = replace(p, 'shipment_weight * number_of_used_warehouses\n  + cost_weight * sum(configured_shipping_cost_per_used_warehouse)', 'score_minor = estimated_shipping_cost_minor\n            + extra_shipment_penalty_minor * max(0, shipment_count - 1)')
p = replace(p, 'Tie-break by stable warehouse ID.', 'The default BALANCED mode uses a configurable INR 50 extra-shipment penalty. One shipment costing INR 500 scores 500; two costing INR 100 total score 150, so the two local shipments win. Also offer explicit MIN_SHIPMENTS and MIN_COST modes. Tie-break equal scores by fewer shipments then stable warehouse ID. Empty allocation is a valid zero-stock result, with no empty shipment records.')
p = replace(p, 'If preview stock changed, return a refreshed feasible allocation or a 409 requiring review; never silently oversell.', 'If stock changed, re-evaluate under the accepted policy. ALLOW_BACKORDER reserves available units and explicitly records/displays the remainder; IN_STOCK_ONLY returns 409 and rolls back finalization. No automatic charge to a payment instrument occurs. The selected ON_CONFIRMATION one-time invoicing policy must be disclosed with backorder terms; an issued invoice is not a recorded payment.')
p = replace(p, 'A stock receipt updates inventory and creates/recomputes a consolidation suggestion for affected open backorders. UI polling makes it appear automatically.', 'Reject an infeasible override with 422 and return a feasible proposal; do not silently change its requested quantities. The user may explicitly submit a partial allocation with backorder under the accepted policy. A stock receipt updates inventory and creates/recomputes a consolidation suggestion for affected open backorders. A committed WebSocket notification refreshes the UI, with polling fallback.')
p = replace(p, 'Effective date must be within the open period. Block backdated edits that would require reopening an issued historical period.', 'Effective date must be within the open period and cannot precede the current business date for a new mutation; use an explicit scheduled change for future dates. Block backdated activation and backdated subscription mutations through the application in this hackathon. Existing historical subscriptions are seeded fixtures, not a public backdating bypass.')
p = replace(p, 'Use server-side calendar arithmetic, one company billing timezone', 'Use java.time server-side calendar arithmetic, one company billing timezone')
p = replace(p, 'Tax adjustments mirror the original line tax configuration and rounding.', 'Tax adjustments mirror the original line tax configuration and rounding. Bundle cancellation does not retroactively change hardware pricing: the baseline snapshots `clawback_policy=NONE` and credits only eligible unused support at its actual discounted rate. Conditional clawback contracts are a roadmap feature; no hidden hardware surcharge is generated.')
p = replace(p, 'Stalled = no meaningful rep/customer activity for configurable days (seed 3), excluding terminal deals. Page views, polling, and automatic alerts do not reset activity. An actual comment, revision, or decision does.', 'Stalled = no qualifying business/external progress for a configured elapsed duration (seed 72 hours), excluding terminal deals. Store UTC Instants and compare Duration; do not subtract local date strings. Keep `last_activity_at` for edits/comments and `last_progress_at` for customer response/acceptance or valid approval decisions. First submission starts the waiting window; repeated rep edits/resends preserve it. Keep `awaiting_external_since` across revision loops. A separate revision-churn indicator can explain repeated edits without progress; it does not accuse a rep of manipulation.')
p = replace(p, 'PDF generation uses pdf-lib. ExcelJS produces XLSX; verify whether the brief\'s “XLS” means any Excel workbook or the legacy binary format. If literal XLS is required, add a writer that supports that format; changing a file extension is not a conversion. [pdf-lib](https://github.com/Hopding/pdf-lib) / [ExcelJS](https://github.com/exceljs/exceljs)', 'Generate exports in the Spring backend from the same role-scoped query. Apache PDFBox creates PDFs; Apache POI HSSF writes actual XLS and XSSF writes XLSX. Select the correct MIME type/extension and test both if exposed. A renamed file is not a format conversion. [PDFBox](https://pdfbox.apache.org/), [Apache POI formats](https://poi.apache.org/components/spreadsheet/)')
plan_path.write_text(p, encoding='utf-8')
print('Updated report and plan sections 1–7 for Spring Boot.')
