from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
path=ROOT/'DealFlow360-Implementation-Plan.md'
p=path.read_text(encoding='utf-8')
def section(start,end,new):
    global p
    a=p.index(start); b=p.index(end,a)
    p=p[:a]+new.strip()+'\n\n'+p[b:]
def rep(old,new):
    global p
    if old not in p: raise ValueError(old[:150])
    p=p.replace(old,new)

section('## 8. Service and API contracts','### 8.1 REST resources','''
## 8. Service and API contracts

Agree on `contracts/openapi.yaml` in hour 1. Generate frontend TypeScript request/response types from it. Java records/DTOs use Bean Validation and application validators; contract tests keep runtime JSON aligned with the spec. Frontend Zod is for UX/input checking, not the backend security boundary.

Amounts and precise decimals serialize as strings. Dates are ISO calendar dates; timestamps are ISO UTC instants. Enum values are stable uppercase strings. Use separate internal and customer DTOs, not one entity serializer with fields hidden at runtime.

```java
// Illustrative contracts; imports and record components omitted for brevity.
public record Actor(UUID userId, Role role, UUID customerId) {}
public enum ApprovalLevel { NONE, MANAGER, MANAGER_FINANCE }

public interface PricingEngine {
    PricingResult evaluate(PricingInput input);
}
public interface RiskEngine {
    RiskResult evaluate(RiskInput input);
}
public interface AllocationEngine {
    AllocationResult allocate(AllocationInput input);
}
public interface BillingCalculator {
    ProrationResult prorate(ProrationInput input);
}

// Application services called through Spring-managed beans/proxies.
// Each command accepts actor, expected version and request identity.
QuoteEvaluation submitQuote(SubmitQuoteCommand command, Actor actor);
QuoteEvaluation createCounterRevision(CounterCommand command, Actor actor);
ApprovalResult recordApproval(ApprovalCommand command, Actor actor);
FinalizationResult tryFinalizeOrder(FinalizeCommand command, Actor actor);
AllocationResult reserveOrder(UUID orderId, Actor actor);
BillingResult initializeBilling(UUID orderId, Actor actor);
ChangeResult applySubscriptionChange(ChangeCommand command, Actor actor);
InvoiceBalance recordPayment(PaymentCommand command, Actor actor);
```

The finalization coordinator is a Spring application-service method with `@Transactional(rollbackFor = Exception.class)`. It locks the quote, verifies current revision/hash/version and all gates, returns WAITING if a gate is missing, and creates the order only once. It calls reservation and billing services with REQUIRED propagation in the same database transaction. Audit and outbox entries commit with that result. No RabbitMQ publish, HTTP call, or WebSocket send occurs while those business locks are held.

Return FINALIZED with the existing order on an exact idempotent replay. A new incompatible command against an already-confirmed quote returns 409. Shortages obey the accepted backorder policy. A constraint violation or failed mutation rolls back all core writes. Expected domain conflicts map to stable API codes rather than raw Hibernate exceptions.

Expose evaluation fields for one-time totals, recurring totals grouped by cadence, initial due, blended/worst-line excess, excess concession amount, policy version, inventory snapshot, and structured reasons. Use Spring `Clock` injection and `Instant`/`LocalDate` consistently.
''')
rep('`GET /reports/sales`; `GET /reports/sales/export?format=pdf|xlsx`', '`GET /reports/sales`; `GET /reports/sales/export?format=pdf|xls|xlsx`')
rep('| `POST /internal/job-runs` | Cron-authorized bounded billing/alert processing |', '| `POST /internal/job-runs` | Finance/Admin-authorized manual recovery using the scheduled job service |\n| `GET /notifications` | Persisted user-scoped inbox/cursor for reconnect recovery |\n| `POST /approval-requests/:id/reassignments` | Admin-controlled role-qualified reassignment with reason |\n| `POST /quotes/:id/cancellations` | Authorized pre-order cancellation; obsolete approvals cannot execute |')
rep('Order finalization, stock receipts, payments, adjustments, and approval actions accept `Idempotency-Key`.', 'Order finalization, stock receipts, payments, adjustments, approval actions, and customer counter submissions require `Idempotency-Key`. The browser creates one key per logical submission and reuses it on retries/double clicks; expected revision additionally rejects parallel requests that mistakenly carry different keys.')
rep('Validate inputs with Zod and whitelist writable fields;', 'Validate Java request DTOs with Bean Validation/domain validators and whitelist writable fields;')
rep('419', '419') if False else None
section('## 10. Authorization and data protection','## 11. Jobs, freshness, and infrastructure','''
## 10. Authorization and data protection

| Role | Allowed scope |
|---|---|
| Sales Rep | Own quotes/related orders, permitted prices/stock, seller adoption; no approval or allocation-override privilege |
| Sales Manager | Team quote decisions, discount policy/chain setup, team health/reporting |
| Finance/Operations | Finance after Manager, allocations/receipts, billing/payments/credits/refunds |
| Customer | Their own customer-linked quotes and invoice view; negotiate/accept only before order creation |
| Admin | Configuration and user administration, audited approval reassignment to qualified users |

Supabase handles signup/login. First internal signup is mapped server-side to Rep; supplied role/customer fields are ignored. Admin grants other roles and maps portal identities. Spring verifies asymmetric JWT signatures using the configured issuer/JWKS, expiry/not-before, and expected audience, then reads the current profile/active state. Do not trust arbitrary decoded claims or browser-supplied role metadata. [Spring JWT resource server](https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/jwt.html)

The frontend sends an access token in the HTTPS Authorization Bearer header. Refresh occurs through the identity SDK; the Java API neither accepts a Supabase browser cookie as authority nor duplicates passwords. The Spring bearer-only API is stateless with an explicit CORS origin/method/header allowlist. If cookie authentication is introduced, implement CSRF protections for it rather than applying bearer-only assumptions.

Use service-method authorization plus scoped repository queries. Portal results explicitly omit cost, margin, policy thresholds, other customers, and sensitive internal history. Next.js navigation guards are a convenience, not the enforcement boundary. Fetch the current DB role for privileged writes; deactivation makes new API actions fail even if a JWT has not expired.

Runtime DB role is non-superuser and lacks BYPASSRLS; business tables are in a non-browser-exposed schema. Revoke direct anon/authenticated business-table access. JPA uses backend credentials, so the customer's Supabase JWT does not automatically apply row security to an entity query. Scope every query and test ownership. Use separate migration credentials and append-only audit privileges.

Approvals are assigned by role/team, optionally to a named available user. Store availability/delegation dates. Admin may reassign to a role-qualified backup with a reason; record original and replacement actor. An SLA alert reports no available approver. No approver never means auto-approval. A rep cannot approve their own submission, and Manager/Finance decisions use distinct actors in the seeded flow.

Customer links are identifiers, not credentials. No client-selected role switch bypasses real authentication. No REST or WebSocket payload should reveal foreign customer IDs/fields merely because the UI would hide them.
''')
section('## 11. Jobs, freshness, and infrastructure','## 12. Four-person execution plan','''
## 11. Jobs, WebSockets, optional RabbitMQ, and traffic

### 11.1 Scheduled work and committed events

Use Spring scheduled jobs in the persistent backend. A one-minute sweep handles due billing and time-based health rules; a short outbox sweep, initially every second, handles committed notification events. Configure a bounded scheduler executor so a long billing sweep does not stop notification delivery. DB leases and unique charge keys protect against overlap/restarts; timing is not a substitute for idempotency.

Jobs process bounded batches (for example 25 due subscriptions) and persist counts, success/failure, last run and lease expiry. Claim work using locked rows/leases and `FOR UPDATE SKIP LOCKED` where appropriate. Use transaction-aware JPA/native queries; never open an unrelated connection and assume it belongs to the business transaction. Catch-up processes each missed coverage interval once. The Finance/Admin manual job action calls the same implementation.

Every important mutation inserts an outbox event with event_id, aggregate_id/version, event_type, and a minimal payload. A dispatcher claims committed rows, sends notifications, and marks progress. A crash can cause redelivery, so receivers tolerate duplicate IDs. Durable in-app notifications are stored independently of transient socket delivery. An AFTER_COMMIT callback can wake the dispatcher but is not the durable queue.

On stock receipt or quote mutation, immediate rules run in the normal command; time-driven jobs handle stalled/expired/overdue conditions later. Run jobs with a SYSTEM actor and no fabricated human approver. [Spring scheduling](https://docs.spring.io/spring-framework/reference/integration/scheduling.html)

### 11.2 Authenticated STOMP over WebSocket

Use a native WebSocket endpoint at `/ws` with STOMP and Spring's simple broker in the single-instance backend. Use `@stomp/stompjs` in the frontend; no SockJS fallback is needed for the targeted browsers. The API remains HTTPS REST for all business commands.

The browser WebSocket API cannot attach an arbitrary HTTP Authorization header. Instead send the access token in the **STOMP CONNECT header**, and validate it in a ChannelInterceptor before the messaging authorization interceptor. Set the authenticated Principal to the verified user ID. Never put tokens in URLs or assume HTTP JWT security alone has authenticated an initially anonymous WebSocket handshake. [Spring token authentication](https://docs.spring.io/spring-framework/reference/web/websocket/stomp/authentication-token-based.html)

Use this explicit security contract:

- Permit the `/ws` HTTP upgrade with an exact allowed-Origin list, but require an authenticated STOMP CONNECT promptly (close unauthenticated sessions after a short timeout).
- After JWT CONNECT validation, run SecurityContext and messaging authorization interceptors. Allow SUBSCRIBE only to the authenticated user's `/user/queue/deal-events`; deny arbitrary `/topic/**`, broker queue destinations, and client SEND to business/broker destinations.
- This design uses explicit bearer-only messaging interceptors. Spring's `@EnableWebSocketSecurity` default CONNECT CSRF behavior must not be accidentally mixed with it: either configure this token-only chain deliberately or supply the CSRF token required by a cookie/session design. Do not globally weaken cookie endpoints to make a socket connect.
- Recheck active profile for connection/subscription and calculate recipients from current database ownership/roles at dispatch. Reject the customer attempting another user's/quote's destination.
- Close/reauthenticate on token expiry; stop delivery to deactivated users and revoke relevant sessions. Reconnect obtains a fresh access token. Bound per-user/IP connections, payload size and outbound buffers.

Spring messaging authorization must be configured separately from URL authorization. [WebSocket security](https://docs.spring.io/spring-security/reference/servlet/integrations/websocket.html)

After commit, use a per-user send such as `convertAndSendToUser` with a minimal event: event ID, type, authorized entity ID, aggregate version, and occurrence timestamp. Keep costs/margins and complete quotation bodies out of push payloads. The client invalidates and fetches the authorized REST view. Events include QUOTE_REVISED, APPROVAL_UPDATED, BACKORDER_UPDATED, INVOICE_UPDATED, and ALERT_UPDATED.

Reconnect uses bounded exponential backoff with jitter and heartbeat support, then refetches active data and the persisted notification inbox. Ignore an older version/duplicate event. A missed push must not result in a missed invoice or permanent stale approval. Keep 5-second polling only while disconnected or where push is unavailable, and show connection/freshness status. Event latency below two seconds on the demo is a target, not a measured claim.

The simple broker holds subscriptions in one process. Before adding backend replicas, introduce shared broker/routing for user destinations and sessions. Sticky connections alone do not guarantee an event produced on one replica reaches a user on another. [Spring external broker](https://docs.spring.io/spring-framework/reference/web/websocket/stomp/handle-broker-relay.html)

### 11.3 RabbitMQ — optional asynchronous stage

RabbitMQ is justified when actual notification/export/integration backlog warrants independent workers. It is not necessary to use Spring WebSockets, and AMQP job queues are not the same configuration as a STOMP WebSocket broker relay. A RabbitMQ relay additionally needs its STOMP plugin and the corresponding Spring routing setup.

If added after required behavior passes, use: committed DB outbox -> publisher with confirms -> durable queue -> worker -> committed effect/inbox -> consumer acknowledgment. Publisher confirms show broker acceptance, not completed business processing. A crash between publish and marking the outbox sent can duplicate a message; assume at-least-once delivery. [RabbitMQ confirms and acknowledgments](https://www.rabbitmq.com/docs/confirms)

Define event_id/type/schema_version/aggregate_id/aggregate_version. Record a unique consumer+event_id with the consumer's DB effect. Acknowledge only after that transaction commits. Configure bounded prefetch (initial target 20), bounded retry with backoff, and a dead-letter queue plus an operator-visible failure state. Do not endlessly requeue poison messages. Do not depend on global message ordering; consumers refetch current state when versions are stale or gaps exist.

Keep quote acceptance, approval gates, stock reservation, and invoice/payment writes synchronous and transactional in the initial backend. Broker failure may delay optional notifications/exports; it must not grant approval, oversell inventory, or create a fake paid status. Microservice extraction would require new ownership/compensation design and is outside the 24-hour baseline.

### 11.4 Traffic and resource controls

Start with one backend replica and the measured DB limits. Use indexed/paginated reads, request-body/quote-line limits (initial 100 lines), debounced evaluations (initial 250 ms), connection acquisition timeouts, bounded jobs, and per-user/IP endpoint limits. Return 429 with retry guidance for a measured/configured limit; never route every quote edit through RabbitMQ just to buffer traffic.

Do not cache stock availability as an authorization for reservation. Cache only safe catalog/configuration data with explicit version invalidation. Use Actuator readiness/liveness and metrics for pool use, request latency, slow queries, job lag, outbox age, and WebSocket connections; expose sensitive diagnostics only internally.

A suggested demo load check is 10 simultaneous builders with two evaluation requests per second each, plus competing confirmations of one scarce item. Measure p95 response time, DB pool saturation, errors, and correctness. This is a test target, not a claim about production throughput.

### 11.5 Clock and environment

Use injected `java.time.Clock`. Store timestamps as UTC Instants and billing boundaries as LocalDate in Asia/Kolkata. Stalled checks use elapsed Duration; they do not depend on where the server happens to run. Only an Admin in a separate DEMO deployment can change the visible demo business date. Production ignores/rejects client business-clock overrides. Historical test fixtures are seeded, not public backdated-activation requests.

```text
# Frontend only
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
NEXT_PUBLIC_API_BASE_URL
NEXT_PUBLIC_WS_URL

# Spring runtime only
SPRING_DATASOURCE_URL            # JDBC direct or session-pooler URL
SPRING_DATASOURCE_USERNAME
SPRING_DATASOURCE_PASSWORD
AUTH_ISSUER_URI
AUTH_JWK_SET_URI
AUTH_EXPECTED_AUDIENCE
APP_ALLOWED_ORIGINS
BILLING_TIMEZONE=Asia/Kolkata
DEMO_MODE=false
PORT

# Migration/seed process only
FLYWAY_URL
FLYWAY_USER
FLYWAY_PASSWORD
# Optional messaging profile only
RABBITMQ_HOST
RABBITMQ_USERNAME
RABBITMQ_PASSWORD
```

Auth administrator credentials are needed only by a controlled demo-user seed script, not the browser. Keep env examples as placeholders and live secrets out of git. Enable TLS verification and use separately scoped development/demo data.
''')
rep('Each member owns domain code and its screens. This prevents a single frontend member from becoming the integration bottleneck.', 'Letters below name module ownership. Assign Java implementation to experienced members and pair frontend-focused members through the API contract. If only two members are Java-capable, A/C own backend changes while B/D own the corresponding screens and acceptance tests; explicitly rebalance C\'s inventory/billing load with A rather than assuming four Java specialists.')
rep('| A — integration lead | Bootstrap/Auth, shared schemas, catalog/pricing, quotes/risk/approval, finalization coordinator | QuoteEvaluation, TxContext, tryFinalizeOrder |', '| A — integration lead | Spring/Auth, contracts, catalog/pricing, quotes/risk/approval, transaction coordinator | OpenAPI, Java commands/DTOs, tryFinalizeOrder |')
rep('During hours 0–2, D helps build shared shell/forms and auth screens; B owns schema/migration infrastructure; C owns money/date primitives and seed conventions.', 'During hours 0–2, D builds shared shell/forms and auth screens; B coordinates Flyway/schema and early WebSocket smoke setup with A; C owns Java money/date primitives and seed conventions.')
rep('All four agree on database keys, money units, statuses, and service signatures', 'All four agree on database keys, money units, statuses, and OpenAPI/Java service signatures') if 'All four agree on database keys, money units, statuses, and service signatures' in p else None
rep('Shared UI/auth pages, portal DTO | Deployed login + DB query;', 'Shared UI/auth pages, portal DTO | Deployed frontend + Spring DB query + socket CONNECT;')
rep('Schema/migration, stock tables', 'Flyway/stock tables, socket smoke test')
rep('Money/date helpers, billing schema', 'Java money/date helpers, billing schema')
rep('Portal ownership + recommendations query', 'Portal ownership + recommendations query; WS client')
rep('Health alerts, nudge, filters/charts', 'Health/progress alerts, push events, filters/charts')
rep('UI states, reports, portal negative tests', 'UI states, reports, portal/socket negative tests')
rep('eliminate Deal Lab, LLM, magic links, recommendation rule editor, and elaborate visualizations', 'eliminate RabbitMQ/microservices, Deal Lab, LLM, magic links, recommendation rule editor, and elaborate visualizations')
rep('Create Admin, Rep A, Manager A, Finance/Ops, Customer Alpha, and Customer Beta accounts.', 'Create Admin, Rep A, Manager A, Backup Manager, Finance/Ops, Customer Alpha, and Customer Beta accounts. Add a valid and an expired manager delegation for the unavailability tests.')
rep('First full recurring invoice', 'First full recurring invoice') if False else None
rep('| T06 | Finance acts before Manager / Rep self-approval | Forbidden or invalid state, no decision recorded |', '| T06 | Finance before Manager / Rep self-approval / concurrent decisions | Forbidden or 409 stale state; no conflicting terminal decisions |')
rep('| T10 | Two concurrent orders compete for last item | At most one reservation for that unit; other backordered/conflict |', '| T10 | Two orders compete for last item / all stock zero | No oversell; accepted ALLOW_BACKORDER creates remainder, IN_STOCK_ONLY conflicts |')
rep('| T21 | Refresh/poll versus meaningful activity | Only business action resets stalled timer |', '| T21 | Refresh, rep edits, and actual external progress | Only qualifying progress resets stalled timer; revisions preserve waiting age |')
rep('Use Vitest for pure pricing/risk/allocation/date formulas; database-backed tests for locks, retries and constraints; Playwright for role journeys.', 'Use JUnit/Spring Boot Test for Java pricing/risk/allocation/date rules, Testcontainers PostgreSQL for locks/retries/constraints, and Playwright for browser journeys. Add a STOMP integration client for unauthorized subscriptions, token expiry and reconnect behavior.')
rep('Proposed required commands after implementation: `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:integration`, `npm run test:e2e`, `npm run build`.', 'Proposed required checks after implementation: backend `./mvnw verify` (PowerShell `.\\mvnw.cmd verify`) with real integration tests; frontend `npm run typecheck`, `npm run lint`, `npm run test:e2e`, `npm run build`; contract-generation diff check. Do not confuse planning fixture checks with tests of an implemented service.')
section('## 14. Deployment, recovery, and handover','## 15. Five-minute live demo','''
## 14. Deployment, recovery, and handover

1. By hour 2 deploy the Next.js frontend, one persistent Spring container and a scoped PostgreSQL query. Verify an actual authenticated WSS connection using the deployed frontend Origin. Hosting only the UI is not an integrated deployment.
2. Use Java 21 in build/runtime images and a supported Node runtime for Next.js. Spring binds to `0.0.0.0` and the host's PORT. Build an executable JAR with the Maven wrapper and a minimal Java runtime image. Vercel hosts the UI, not the persistent Java/WebSocket server.
3. Use Railway or an equivalent host that supports persistent processes and WebSocket upgrades. Keep one backend instance running for jobs and the simple STOMP broker. Verify account/plan limits and billing; no free, unsleeping capacity is assumed. [Railway WebSockets](https://docs.railway.com/networking/public-networking/specs-and-limits)
4. Configure the direct/session-pooled JDBC connection and Hikari limit; use Flyway deployment/migration credentials separately from the restricted runtime DB role. Apply migrations before code requiring them. Keep Hibernate schema validation enabled.
5. Configure issuer/JWKS/audience, CORS/Origin allowlists, HTTPS API URL, WSS URL, and secure secrets. Authenticate real role accounts. Confirm expired JWT and foreign-customer API/socket requests fail.
6. Verify jobs execute without a browser, survive restart, and catch up without duplicate charges. Verify outbox recovery and a reconnect refresh. RabbitMQ is absent from the baseline deployment; if enabled, independently verify its durability, retries, DLQ and consumer idempotency.
7. Freeze features around hour 22. Run backend, browser, contract and edge-case checks; open PDF/XLS/XLSX downloads. Record both deployment revisions, migration version and test results.
8. Retain the prior working artifacts/database export. Prefer additive migrations near the demo; rollback of a JAR cannot undo a destructive DB change safely by itself.
9. Test local fallback with the Java JAR and Next.js production build. Hosted Supabase still requires internet. A truly offline setup requires separately prepared local identity/PostgreSQL and is not implied by a local UI.

README must include Java/Node/Docker prerequisites, frontend/backend commands, Maven wrapper, Flyway/seed steps, environment placeholders, Auth roles, JWT/WebSocket setup, scheduler/outbox operation, business policies, test results, known gaps, demo journeys, and architecture.

This task changes planning documents only. It does not create deployment accounts, execute payments, or send external messages.
''')
rep('matching account', 'matching account') if False else None
rep('No ML training is required for any baseline capability or I1/I2.', 'No ML training is required for any baseline capability or I1/I2. Spring Boot changes the engineering stack, not the need for model training.')
rep('- Jobs run without a browser; retries do not create duplicate charges or movements.', '- Jobs run without a browser; retries do not duplicate charges/movements; outbox and WebSocket reconnect recover missed notifications.')
rep('- Customer access is actually restricted, including API payloads and exports.', '- Customer access is restricted in REST, WebSocket subscriptions/payloads, and exports.')
rep('- PDF and workbook downloads open and match the chosen filters.', '- PDF and XLS/XLSX downloads open and match the chosen filters.\n- All 23 edge-case contracts in section 19 and infrastructure checks in section 20 are verified or explicitly reported incomplete.')
rep('Exact runtime/library patches, hosting availability, and whether “XLS” must be legacy format should be resolved at setup.', 'Exact runtime/library patches and hosting availability should be resolved at setup. Apache POI allows a real legacy XLS option if the organizer requires it.')
path.write_text(p,encoding='utf-8')
print('Updated Spring services, security, jobs, tests, deployment, and ownership.')
