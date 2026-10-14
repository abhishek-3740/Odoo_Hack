# MIGRATION_MEMORY.md — DealFlow360 Spring Boot ➔ FastAPI migration memory

> Persistent memory file. Update after every step. Root: `C:\Users\rajak\Desktop\DealFlow360\MIGRATION_MEMORY.md`
> Constraints: NO Docker / no new features / keep `dealflow` PG schema (V1–V7) / port 8080 / Postman + Vite frontend untouched.

## 0. Progress log
- [x] **Phase 1 (2026-10-14): repo audit complete.** 6 parallel domain audits done. ~200 main java files catalogued.
- [x] **Step A (2026-10-14): core foundations.** backend_fastapi/requirements.txt,
  app/core/{config,exceptions,response,database}.py, app/main.py, tests/test_core_foundations.py.
  Decisions: (1) VALIDATION_FAILED stays HTTP 400 per ErrorCode enum. (2) Unhandled code is INTERNAL_ERROR.
  (3) Decimal-wire rule: DecimalJSONResponse + DecimalStr + dumps() + stringify() (see global fix G2 below).
  (4) PageResponse shape: {"data": [...], "meta": {page,size,total,requestId,evaluatedAt}}.
- [x] **Step B: pure math engines + unit tests
  DONE (2026-10-14): app/engines/{shared_math,pricing_engine,risk_engine,allocation_engine,
  proration_calculator,anomaly,commercial_hash}.py + tests/test_engines.py — 64/64 engine tests pass
  (75/75 with core). Precision: Context(prec=34, HALF_UP) for all intermediate math (=Java CALC/DECIMAL128).
  Anomaly uses prec=20 context (=Java CALC) + double-sqrt path mirrored via math.sqrt(float()).
  CommercialHash byte-format verified against CommercialHash.java (FIELD |, RECORD \n, v1 head,
  sorted lines, stripZeros qty, SHA-256 hex).
- [x] **Step C: SQLAlchemy models
  DONE (2026-10-14): app/models/{base,enums,auth,catalog,quotes,policy,approvals,portal,orders,
  fulfillment,billing,ops}.py + repositories/{sequences,escalations_repo}.py + tests/test_models.py.
  Verified: metadata-vs-live-information_schema diff = 44/44 tables, 0 column mismatches (read-only).
  Notes: JSONB columns map to dict (Java used JSON strings — services handle dicts natively);
  row_version uses version_id_col (StaleDataError -> STALE_VERSION); deal_escalations raw SQL only;
  AuditEvent extends Base (no created_at, matches Java).
- [x] **Step D: auth dependency + actor resolution
  DONE (2026-10-14): app/core/security.py (3-issuer routing, mint/verify demo+local+Supabase HS/JWKS,
  DB-resolved Actor, bcrypt-direct passwords [$2a$/$2b$ interoperable with Spring], capabilities),
  app/api/deps.py (get_current_actor/require_roles/require_internal/require_customer/idempotency_key/404-scope),
  app/services/{idempotency_service,audit_service}.py + tests/test_security.py — 90/90 total pass.
  Notes: passlib unusable with bcrypt>=4.1 (version-detection crash) -> bcrypt used directly;
  passlib stays in requirements per spec. Idempotency completes deterministic ApiExceptions (replayable
  errors), deletes claim on unexpected failure (retryable). local sub falls back to profile.id.
- [x] **Steps E+F+G: 100% COMPLETE (2026-10-14). Full suite 168/168 green.**
  Wiring: app/api/v1/api_router.py aggregates 7 routers into app/main.py (live-verified route table).
  Step F: app/websocket/{manager,endpoint}.py (native WS /ws, pre-accept bearer auth, 4401, private
  per-profile stream), app/workers/{outbox,scheduler}.py (1s SKIP LOCKED batch-50 poller, 2^attempts<=300s
  backoff, park after 8; 60s leased billing/health/expiry sweeps), lifespan (DEMO_SEED + JOBS_ENABLED),
  tests/test_realtime.py. Step G: app/services/demo_seeder.py (idempotent core reference data;
  HIST/SUB/LATE/STALLED demo orders deferred — flow tests seed their own), backend_fastapi/.env.example,
  tests/test_api_flows.py (Flow A E2E to PAID, Flow B counter+backorder, IN_STOCK_ONLY rollback, parallel
  accepts->1 order, idempotency matrix, stale version), tests/test_seeder.py.
  Launch: `cd backend_fastapi && ../backend_fastapi/venv/Scripts/python -m uvicorn app.main:app
  --host 0.0.0.0 --port 8080` (or PORT in .env). Smoke-verified on :8080 against live PG.
  GLOBAL FIX G1 (request-id): Starlette 1.x BaseHTTPMiddleware drops contextvars on re-raised paths
  (proven: DB-down 500s lost the id) -> middleware now ALSO stamps request.state.request_id and all
  exception handlers resolve state-first (test: test_request_id_survives_dependency_failure).
  GLOBAL FIX G2 (decimals): FastAPI jsonable_encoder demotes bare-dict Decimals to float (proven:
  onHand 2.0) -> ApiResponse/PageResponse/ErrorResponse .of() now run stringify() (plainQuantity+ISO),
  so every envelope path holds the exact-decimals contract regardless of route return style.
  Test hygiene: shared dealflow_test DB is append-only — all seeds MUST use unique()/max()+1
  (fixed version_no=980 broke test_portal on reruns; fixed). Deliberate deviations kept: reports xls->400,
  VALIDATION_FAILED=400, WS native (not STOMP), no HIST demo orders in seeder.
  - [x] **QUOTES + APPROVALS + ESCALATIONS + RECOMMENDATIONS(staff) (2026-10-14).**
    Files: app/schemas/quotes.py (requests + plain-dict builders holding Decimals),
    app/services/{quote_service,approval_service,escalation_service (+staff negotiation
    desk),recommendations_service,price_resolver}.py, app/api/v1/routers/quotes.py
    (24 routes, `router`), tests/test_quotes.py — full suite 157/157 green.
    Decisions: (1) FastAPI jsonable_encoder turns bare-dict Decimals into floats, so
    routes return DecimalJSONResponse(ApiResponse.of(...)) explicitly (response class
    alone only saves Pydantic-model returns). (2) hook_gates_cleared delegates to
    app.services.order_finalization.hook_gates_cleared/try_finalize when present,
    else no-ops. (3) effective_policy is a local helper (latest DiscountPolicy <=
    now); DRAFT revisions judge against current policy, SUBMITTED against snapshot.
    (4) Approval audit uses Java names APPROVAL_<DECISION>/REASSIGNED/SUPERSEDED;
    adopt audits REVISION_ADOPTED. (5) dealflow_test is shared + persistent:
    test_portal's fixed version_no=952 fixture collides with itself on reruns
    (one stale row cleaned once); all new seeds use unique()/max+1 (rerun-safe).
  - [x] PORTAL (2026-10-14): app/schemas/portal.py (requests + portal-only dict builders),
    app/services/{portal_service,portal_account_service,portal_quote_request_service,
    portal_recommendation_service}.py, app/api/v1/routers/portal.py (router, full literal
    paths, CUSTOMER-only), tests/test_portal.py — 8/8 pass.
    Notes: (1) portal_service reuses billing-owned app/services/invoice_exporter.py via its
    (invoice, lines, customer) signature — no duplicate exporter. (2) Acceptance calls the
    live order_finalization.hook_gates_cleared (NOT_REQUIRED+adopted test quote finalizes
    inline to SO-*). (3) Quantity wire fix: builders strip NUMERIC scale>2 themselves
    (jsonable_encoder keeps DB zeros, so "1.000"->"1"). (4) tzdata added to requirements
    (Windows zoneinfo for Asia/Kolkata). (5) VALIDATION_FAILED stays 400 per enum, incl.
    preferences/quote-request-shape/export-format errors. Full suite: stable files green
    (98); test_ops/test_quotes failures are other agents' mid-edit WIP, unrelated.
  - [x] ORDERS + FULFILLMENT (2026-10-14): app/services/order_finalization.py
    (hook_gates_cleared + on_gates_possibly_cleared alias for quotes/portal callers +
    try_finalize FINALIZED|ALREADY_FINALIZED|WAITING dict; local
    initialize_billing_for_order with SO-/INV-/SUB- refs, activation/backdate rules,
    grouped recurring first-charges), app/services/fulfillment_service.py (preview/
    fulfillment/override/replan/dispatch/record_movement/stock-levels/visibility),
    app/api/v1/routers/orders.py (single `router`: 2 order + 4 fulfillment +
    stock-movement + 2 stock-level routes), tests/test_fulfillment.py (8 tests).
    Notes: (1) Java-name alias kept — quote_service calls on_gates_possibly_cleared.
    (2) Plain-dict responses rely on DecimalJSONResponse.dumps for Decimal->str wire
    rule (no new schemas). (3) Stock-movement idempotency via request_key column
    (Java parity), not idempotency_requests. 106/106 pass (foundations+engines+
    models+security+fulfillment+portal); quotes(3)/ops failures are other agents'
    in-progress code, no traceback touches orders/fulfillment modules.
- [x] Step F: DONE (see Steps E+F+G 100% entry above)
  DONE (2026-10-14): app/websocket/{manager,endpoint}.py (native WS /ws; ?token=/Bearer auth pre-accept,
  4401 on refusal; private per-profile stream; client frames ignored), app/workers/{outbox,scheduler}.py
  (1s SKIP LOCKED batch-50 poller, recipient resolution owner/customer/team/roles, 2^attempts<=300s
  backoff, park after 8; 60s leased billing/health/expiry sweeps), lifespan wiring in main.py
  (DEMO_SEED seeder + JOBS_ENABLED workers), tests/test_realtime.py (4/4).
  Note: STOMP replaced by native WS — same auth + private-queue invariants, documented transport swap.

## 1. Source layout (backend/)
- Entry: `backend/src/main/java/com/dealflow/ApiApplication.java` (forces UTC TZ; PG18 rejects Asia/Calcutta legacy).
- Parent `spring-boot-starter-parent:4.1.1`, Java 21, pdfbox 3.0.8, poi 5.5.1, testcontainers 1.21.4.
- Starters: webmvc, validation, websocket, security, oauth2-resource-server, security-messaging, data-jpa, flyway, postgresql, actuator.
- Surefire excludes `**/*IT.java`; failsafe includes them (IT = Testcontainers PG).
- Key tests: `quotes/service/PricingEngineTest`, `RiskEngineTest`, `fulfillment/service/AllocationEngineTest`, `billing/service/ProrationCalculatorTest`, `auth/service/DemoTokenServiceTest`, `health/service/DiscountAnomalyDetectorTest`, `assistant/SarvamClientTest`, `flows/*IT` (14 files).
- Postman: `backend/DealFlow360-Postman-Collection.json` — 15 requests, baseUrl http://localhost:8080. NOTE: several paths stale vs impl (e.g. `/api/v1/health/alerts` real `/api/v1/alerts`, `/api/v1/approvals` real `/api/v1/approval-requests`, `/api/v1/portal/proposals` real `/api/v1/portal/quotes`).

## 2. API response envelopes (MUST preserve exactly)
- Success: `{"data": ..., "meta": {"requestId": "...", "evaluatedAt": "..."}}` (Jackson non_null; BigDecimal serialized as JSON **string** via Money.plainQuantity).
- Paginated: `PageResponse` items+page/pageSize/totalItems/totalPages wrapped in ApiResponse; per-row null-map drops row, keeps DB total.
- Error: `{"error": {"code": "...", "message": "...", "details": [...]}, "requestId": "..."}` + `Cache-Control: no-store`.
- `X-Request-Id`: accept+sanitize `[^A-Za-z0-9._:-]`→"", cap 64, else random UUID; echo header; MDC logging.
- Paging: `MAX_PAGE_SIZE=100`, default 25; page<0→0; sort `field,asc|desc` default DESC; unknown field→VALIDATION_FAILED.

## 3. ErrorCode → HTTP (shared/error/ErrorCode.java)
- 400: VALIDATION_FAILED, MALFORMED_REQUEST, IDEMPOTENCY_KEY_REQUIRED
- 401: UNAUTHENTICATED
- 403: PROFILE_NOT_PROVISIONED, PROFILE_INACTIVE, FORBIDDEN, SELF_APPROVAL_FORBIDDEN, APPROVER_NOT_QUALIFIED
- 404: NOT_FOUND (also used for out-of-scope masquerade)
- 409: STALE_QUOTE_VERSION, STALE_VERSION, CONFLICTING_STATE, IDEMPOTENCY_KEY_REUSED, IDEMPOTENT_REQUEST_IN_PROGRESS, APPROVAL_SEQUENCE_VIOLATION, APPROVAL_ALREADY_DECIDED, QUOTE_NOT_SUBMITTED, NEGOTIATION_CLOSED, ACCEPTANCE_HASH_MISMATCH, ALREADY_ORDERED, INSUFFICIENT_STOCK, DUPLICATE_STOCK_MOVEMENT, SUBSCRIPTION_NOT_ACTIVE, INVOICE_NOT_PAYABLE
- 422: PRICE_NOT_RESOLVABLE, AMBIGUOUS_PRICE_RULE, DISCOUNT_OUT_OF_RANGE, ZERO_NET_LINE, EMPTY_QUOTE, POLICY_NOT_CONFIGURED, NO_AVAILABLE_APPROVER, QUOTE_EXPIRED, GATES_NOT_MET, ALLOCATION_INFEASIBLE, ALLOCATION_MISMATCH, NOTHING_TO_DISPATCH, BACKDATED_CHANGE_REJECTED, EFFECTIVE_DATE_OUT_OF_PERIOD, OVER_ALLOCATION, REFUND_EXCEEDS_ELIGIBLE, CURRENCY_MISMATCH
- 429: ASSISTANT_RATE_LIMITED, RATE_LIMITED
- 500: INTERNAL_ERROR. 503: ASSISTANT_UNAVAILABLE
- Handler mapping: ApiException→code.status; MethodArgumentNotValid/ConstraintViolation→VALIDATION_FAILED; MessageNotReadable→MALFORMED_REQUEST; NoResource→NOT_FOUND; AccessDenied→FORBIDDEN; Auth→UNAUTHENTICATED; OptimisticLock→STALE_VERSION; PessimisticLock→CONFLICTING_STATE; DataIntegrity→CONFLICTING_STATE. Never leak SQL/stack.

## 4. Auth (3 token sources → DB-resolved Actor every request)
- Roles: REP, MANAGER, FINANCE, ADMIN, CUSTOMER. `isInternal`=all but CUSTOMER; `isApprover`=MANAGER,FINANCE; `canDecide`=self or ADMIN.
- Capabilities (MeController): REP quotes:create/edit-own/submit/share/adopt, recommendations:read, reports:own, alerts:own; MANAGER quotes:read-team, approvals:manager, policy:read, reports:team, alerts:team/nudge; FINANCE quotes:read-all, approvals:finance, allocations:override, stock:receive, shipments:dispatch, payments/refunds record, subscriptions:change, reports:all, alerts:all, jobs:run; ADMIN admin:* + approvals:reassign + quotes:read-all + reports:all + alerts:all + jobs:run + stock + override; CUSTOMER portal:*.
- Token dispatch (unverified iss+marker claim, then validate):
  1. Supabase: sub=UUID; HS256 (jwt-secret ≥32B) XOR JWKS RS256/ES256; validators skew 60s + optional issuer + optional audience (`authenticated`, require=true).
  2. Demo: iss=aud=`dealflow-demo`, claim `dealflow_demo:true`, HS256 demo.secret ≥32B, 30d TTL. Only if `demo.auth-enabled=true` else FORBIDDEN/disabled (controller bean absent → 404).
  3. Local: iss=aud=`dealflow-local`, claim `dealflow_local:true`, secret local→demo→auth first ≥32B, 7d TTL.
- Converter: sub→UUID else UNAUTHENTICATED; findByAuthUserId else provision-or-reject (autoProvisionRep flag; email claim else user_metadata.email; bind null-authUserId row by email; mismatch→PROFILE_NOT_PROVISIONED); inactive→PROFILE_INACTIVE 403. Token role ignored; role/team/customer re-read from DB.
- 8 demo personas, deterministic UUIDs `00000000-0000-4000-8000-00000000000{1..8}`: admin@dealflow.demo/ADMIN, rep.a/rep.b/REP→Sales East, manager.a/manager.backup/MANAGER→Sales East, finance@/FINANCE, alpha@customer.demo/CUSTOMER→Alpha Traders/BRONZE, beta@customer.demo/CUSTOMER→Beta Systems/GOLD.
- LocalAuth: BCrypt; register→CUSTOMER+own Customer(BRONZE/INR, owner=first active REP)+CUSTOMER_REGISTERED audit; registerInternal (public; role must be internal; team explicit→name find-or-create→default Sales East; ADMIN/FINANCE team=null); login branch: hasLocalCredential→local else demo-persona→demo else UNAUTHENTICATED; changePassword.
- Endpoints: `GET /api/v1/auth/options` {passwordLogin,selfRegistration,demoPersonas}; `POST /api/v1/auth/register` 201; `POST /api/v1/auth/register-internal` 201; `GET /api/v1/auth/teams` (auto-creates Sales East); `POST /api/v1/auth/login`; demo `GET /api/v1/auth/demo-accounts`, `POST /api/v1/auth/demo-token` {email?,role?,password?}; `GET /api/v1/me` {profileId,email,fullName,phone,role,teamId,customerId,customerName,customerTier,internal,authProvider LOCAL|DEMO|SUPABASE,capabilities}; admin (ADMIN only) `GET/POST /api/v1/admin/profiles`, `PATCH /api/v1/admin/profiles/{id}` (self-demote/deactivate guard→CONFLICTING_STATE), `GET/POST /api/v1/admin/delegations`, `GET/POST /api/v1/admin/teams`; portal `POST /api/v1/portal/account/password` (CUSTOMER).
- AuthTokenResponse {email,fullName,role,tokenType Bearer,accessToken,expiresIn 2592000 demo / 604800 local,capabilities,sampleCurl}.

## 5. Endpoint catalog (method + path + roles)
### quotes `/api/v1/quotes`
- `GET /` staff only (CUSTOMER 403); REP→own, MANAGER→team. sorts createdAt,updatedAt,lastActivityAt,stage.
- `POST /` 201 staff; `GET /{quoteId}` read-policy; `POST /{quoteId}/evaluations` preview (no persist); `POST /{quoteId}/revisions` save draft (expectedRowVersion); `GET /{quoteId}/revisions`; `GET /{quoteId}/revisions/{revisionId}`; `POST /{quoteId}/submissions` {expectedRevisionId*,expectedRowVersion,note}; `POST /{quoteId}/shares` → {quoteId,stage,portalPath,commercialHash}; `POST /{quoteId}/adoptions` {revisionId*,expectedRowVersion,note}; `POST /{quoteId}/cancellations` {reason,expectedRowVersion} idempotent; `GET /{quoteId}/history` audit desc.
- `GET|POST /{quoteId}/requests`, `POST /{quoteId}/requests/{requestId}/responses` (staff); `/api/v1/escalations` GET?quoteId, POST, POST /{id}/resolutions.
### approvals `/api/v1/approval-requests`
- `GET /?status=PENDING` (MANAGER→team, REP post-filter own; step2 not actionable until step1 approved); `GET /{id}`; `POST /{id}/decisions` {APPROVE|REJECT|RETURN_FOR_REVISION,expectedRevisionId,expectedRowVersion,reason} + Idempotency-Key → {approvalRequestId,stepStatus,revisionApprovalStatus,orderId?,FINALIZED|WAITING,remainingGates}; `POST /{id}/reassignments` ADMIN only.
### orders `/api/v1/orders` (read-only; creation via gates)
- `GET /?customerId` (REP own); `GET /{orderId}` (REP own-only, CUSTOMER→404 masquerade).
### fulfillment `/api/v1`
- `GET /orders/{orderId}/allocation` (preview if UNALLOCATED); `GET /orders/{orderId}/fulfillment`; `POST /orders/{orderId}/allocations` FINANCE,ADMIN {allocations!≥1,reason}; `POST /orders/{orderId}/replans` FINANCE,ADMIN; `POST /shipments/{shipmentId}/dispatches` FINANCE,ADMIN {trackingReference,note}; `POST /stock-movements` FINANCE,ADMIN + Idempotency-Key {variantId,warehouseId,quantity,movementType RECEIPT|ADJUSTMENT,expectedNextReceiptDate/Qty,note} → +meta consolidatableOrderIds; `GET /stock-levels?warehouseId&variantId` internal; `PATCH /stock-levels` FINANCE,ADMIN upsert.
### billing `/api/v1`
- `GET /invoices?customerId|orderId` internal (REP filtered); `GET /invoices/{id}`; `GET /invoices/{id}/export?format=pdf|xlsx,excel|doc,docx,word` (invalid→400); `GET /subscriptions?customerId|orderId`; `GET /subscriptions/{id}`; `POST /subscriptions/{id}/change-previews` + `/changes` (+Idempotency-Key) FINANCE,ADMIN {newQuantity,effectiveDate,note}; `POST /subscriptions/{id}/cancellations` (+Idempotency-Key) {policy?,effectiveDate?,reason?}; `POST /payments` (+Idempotency-Key) {customerId,amount,method,externalReference,note,allocations?}; `GET /payments?customerId!`; `POST /refunds` (+Idempotency-Key) {creditNoteId,amount,method,...}; `GET /credit-notes?customerId!`; plan-switch `POST /subscriptions/{id}/plan-change-previews|/plan-changes` (+Idempotency-Key) {newPlanId,effectiveDate,note,expectedRowVersion}.
### catalog `/api/v1` + public
- Internal reads all internal roles; writes mostly ADMIN (customers POST/PATCH ADMIN,MANAGER,REP per §catalog; PATCH customers ADMIN,MANAGER): `GET /customers?search`, `GET /customers/{id}`, `POST /customers` 201, `PATCH /customers/{id}`, `GET /categories`, `POST /categories`, `GET /products?categoryId&search`, `GET /products/{id}`, `POST|PATCH /products`, `GET /variants?productId*`, `POST|PATCH /variants`, `GET /price-rules?variantId*`, `POST|PATCH /price-rules`, `GET /subscription-plans?productId`, `POST|PATCH /subscription-plans`, `GET|POST|PATCH /warehouses`. Archive via active=false. Public anonymous `GET /api/v1/public/catalog` → {categories,products,variants,plans} (no cost/margin/counts; listPrice only; inStock bool; non-recurring variants only).
### policy `/api/v1/discount-policies` — `GET /current`, `GET /` history, `POST /` 201 ADMIN,MANAGER {definition*,note}.
### portal `/api/v1/portal` (CUSTOMER only; foreign → 404 not 403)
- `GET /quotes` (excl DRAFT); `POST /quote-requests` (+opt Idempotency-Key) {title,note,lines[1..50]{variantId|planId exactly-one,quantity}}; `GET /quotes/{id}` restricted view; `POST /quotes/{id}/requests` (+Idempotency-Key) {COMMENT|CHANGE|COUNTER,lineKey,message,lines[{lineKey,quantity,requestedDiscountBp}],requestedOrderDiscountBp,expectedRevisionId*}; `POST /quotes/{id}/acceptances` (+Idempotency-Key) {revisionId*,commercialHash 8..128*,note} → {accepted,conditional,orderReference?,remainingSteps}; `GET /invoices` (excl DRAFT); `GET /invoices/{id}`; `GET /invoices/{id}/export?format`; account `GET|PATCH /portal/account`, `PUT /portal/account/preferences` (allowlist keys), `POST /portal/account/password`; `GET /portal/quotes/{id}/recommendations`, `POST /portal/quotes/{id}/recommendation-requests` (+opt key) {variantId*,replaceLineKey,expectedRevisionId*}.
- Seller side: `GET /api/v1/quotes/{id}/requests`, `POST /{id}/requests/{reqId}/responses` {message*,decision ANSWERED|DECLINED}.
- Recommendations staff: `GET /api/v1/quotes/{id}/recommendations`, `POST .../recommendation-applications` {variantId*,replaceLineKey,expectedRevisionId*,expectedRowVersion*}, `POST .../recommendation-dismissals` {variantId*}.
### health `/api/v1` — `GET /alerts?status=OPEN|ALL&type` (CUSTOMER 403; REP own, MANAGER team); `POST /alerts/{id}/nudges` {message?} (429 cooldown 12h); `POST /alerts/sweeps` MANAGER,FINANCE,ADMIN; `GET /notifications` (+meta unread) own inbox; `POST /notifications/{id}/reads` own else 404.
### reports `/api/v1/reports` — `GET /sales?from,to,ownerProfileId,teamId,customerId,stage,categoryId` (CUSTOMER 403; REP forced self, MANAGER forced team); `GET /sales/export?format=pdf|xlsx|xls&...` filename `dealflow-sales-<14digit>.<ext>`.
### jobs `/api/v1/internal/job-runs` FINANCE,ADMIN — `POST` {jobName: recurring-billing|deal-health|quote-expiry}; `GET` last 50.
### assistant `/api/v1/assistant` any auth — `GET /status` {configured,provider Sarvam,role}; `POST /chat` {message≤2000*,quoteId?,history≤8 {role user|assistant (system→400),content≤3000}} (12/min/user + 4-concurrency → ASSISTANT_RATE_LIMITED; context cap 40k chars).
### websocket `/ws` — STOMP: CONNECT requires `Authorization: Bearer <jwt>` native header (URL tokens rejected); SUBSCRIBE only exactly `/user/queue/deal-events`; SEND rejected. Broker /queue, heartbeat 10s/10s. Outbox poller drains to per-profile queue.

## 6. Enums (persisted UPPER strings)
- CustomerTier BRONZE,SILVER,GOLD; CategoryKind HARDWARE,SERVICE,SUBSCRIPTION; FulfillmentKind STOCK,NONE; ChargeKind ONE_TIME,RECURRING; QuantityMode INTEGER,DECIMAL; BillingAnchor ACTIVATION_DATE,CALENDAR_MONTH_START; ProrationPolicy IMMEDIATE_PRORATED,NEXT_PERIOD; CancellationPolicy END_OF_PERIOD,IMMEDIATE_PRORATED (clawback always NONE).
- Quote Stage DRAFT,REVIEW,SENT,UNDER_NEGOTIATION,CONFIRMED,CANCELED,LOST,EXPIRED (terminal=last 4); RevisionStatus DRAFT,SUBMITTED,SUPERSEDED,CANCELED; RevisionSource SELLER,CUSTOMER_COUNTER,SYSTEM; ApprovalStatus NOT_EVALUATED,NOT_REQUIRED,PENDING_MANAGER,PENDING_FINANCE,APPROVED,REJECTED,REVISION_REQUIRED (clears=N REQUIRED|APPROVED); BackorderTerms ALLOW_BACKORDER,IN_STOCK_ONLY; InvoicingTerms ON_CONFIRMATION; ApprovalReqStatus PENDING,APPROVED,REJECTED,REVISION_REQUIRED,SUPERSEDED; NegotiationType COMMENT,CHANGE,COUNTER; NegotiationStatus OPEN,ANSWERED,ADOPTED,DECLINED,SUPERSEDED; LineSource MANUAL,RECOMMENDATION,COUNTER,SCENARIO; Risk ApprovalLevel NONE,MANAGER,MANAGER_FINANCE; Decision APPROVE,REJECT,RETURN_FOR_REVISION; LineKind ONE_TIME,RECURRING.
- Order OrderStatus CONFIRMED,CANCELED; FulfillmentStatus NOT_REQUIRED,UNALLOCATED,PARTIALLY_RESERVED,RESERVED,PARTIALLY_DISPATCHED,DISPATCHED; BillingStatus PENDING,INITIALIZED.
- Stock: MovementType RECEIPT,DISPATCH,ADJUSTMENT; ReservationStatus HELD,CONSUMED,RELEASED; ShipmentStatus DRAFT,RESERVED,DISPATCHED,CANCELED (open=DRAFT|RESERVED); BackorderStatus OPEN,RESOLVED,CANCELED; AllocationMode BALANCED,MIN_SHIPMENTS,MIN_COST.
- Billing: InvoiceKind ONE_TIME,RECURRING,ADJUSTMENT; InvoiceStatus DRAFT,ISSUED,PARTIALLY_PAID,PAID,VOID; LineType ONE_TIME,RECURRING,PRORATION; CreditNoteStatus ISSUED,PARTIALLY_APPLIED,APPLIED,VOID; SubStatus PENDING_ACTIVATION,ACTIVE,CANCEL_AT_PERIOD_END,CANCELED (live=ACTIVE|CANCEL_AT_PERIOD_END); SubChangeType QUANTITY,PLAN,CANCEL.
- Health: AlertType STALLED_QUOTE,DISCOUNT_ANOMALY,DELIVERY_SLIPPAGE,APPROVAL_OVERDUE,NO_APPROVER,LOW_STOCK,BACKORDER_OPEN(unused),INVOICE_OVERDUE; Severity INFO,WARNING,CRITICAL; AlertStatus OPEN,RESOLVED.
- Ops: JobStatus RUNNING,SUCCESS,FAILED; Trigger SCHEDULED,MANUAL; EscalationCategory DISCOUNT,POLICY,REVIEW; targetRole FINANCE,ADMIN,MANAGER.

## 7. DB schema (dealflow, money BIGINT minor, qty NUMERIC(18,3), pct INT bp; touch_updated_at triggers; seqs quote/order/invoice/payment/credit/refund start 1000, discount_policy_version_seq start 1)
- V1 core: teams; customers(tier CK, owner_rep FK); profiles(auth_user_id UQ, email UQ lowercased, role CK, team/customer FK, CUSTOMER⇔customer CK, password_hash, phone, preferences '{}', unavailable_until); approval_delegations(MANAGER|FINANCE, valid_until>from); categories(kind CK); products(code UQ, base_price/cost_minor≥0, tax 0..10000, fulfillment STOCK|NONE, charge ONE_TIME|RECURRING, qtymode, promoted, CK recurring→fulfillment NONE); product_variants(sku UQ, attributes '{}', price_extra, cost NULL=inherit, weight≥0, substitution_group); price_rules(variant,tier,currency,price≥0,priority,from,until exclusive; UQ slot); subscription_plans(code UQ, interval 1|3|12, price>0, anchors/policies CK); discount_policies(version_no UQ, definition JSONB, effective_at); app_settings(key PK, value JSONB).
- V2 quotes/approvals: quotes(reference UQ, customer/owner/team FK, stage CK, valid_until, last_activity/progress/awaiting_external_since, revision_count, row_version); quote_revisions(quote FK, revision_no, UQ(quote,rev), source CK, status CK, currency, order_discount 0..9999, policy_version/snapshot, risk JSON, approval_status CK, required_level CK, commercial_hash, one_time/recurring net/tax/cost, contribution, margin NUMERIC(9,4), base/discount totals, backorder/invoicing CK, activation_date, submitted/seller_adopted/customer_accepted + by/hash); quote_lines(revision FK CASCADE, line_key, UQ(rev,key), position, kind CK, product/category/variant/plan FK, description, qty>0, unit price/cost≥0, tax 0..10000, line/applied/effective disc 0..9999, base/net/tax/cost/margin, net>0 CK, interval 1|3|12 NULL, requires_stock, promised_date, source CK; recurring⇔plan+interval CK; stock→variant CK); approval_requests(quote/revision FK, step 1|2, role CK, step↔role CK, team/assignee/original_assignee FK, due_at, status CK, reasons '[]', decided_by/at/reason, reassignment_reason, row_version; UQ(rev,step); pending⇔undecided CK); negotiation_requests(quote/revision/candidate FK, actor FK, line_key, type CK, payload '{}', message, status CK, response + by/at; COMMENT∨candidate CK); recommendation_dismissals(UQ rev+variant, CASCADE).
- V3 orders/fulfillment: warehouses(code UQ, fixed/perkg≥0, sort_order); stock_levels(UQ wh+variant, on_hand/reserved≥0, reserved≤on_hand, reorder/target≥0, expected receipt; row_version); stock_movements(qty≠0, type CK, sign CK receipt>0/dispatch<0, ref type/id, request_key UQ-WHERE-NOT-NULL, actor, occurred_at); orders(reference UQ, quote UQ FK, revision/customer/owner FK, currency, order_status CK, fulfillment CK, billing CK, backorder CK, one_time net/tax, confirmed/canceled_at, row_version); order_lines(UQ order+key, kind CK, qty>0, price≥0, net>0, interval CK NULL, stock→variant CK); shipments(UQ-PARTIAL open per order+wh, status CK, est_cost, dispatched_at/by, tracking); shipment_lines(UQ ship+orderline, CASCADE); reservations(order/line/shiptionline/wh/variant FK, qty>0, status CK, consumed/released_at; invariant ΣHELD==reserved); backorders(UQ-PARTIAL open per line, qty>0, expected_date real-only, status CK, resolved_at).
- V4 billing: subscriptions(reference UQ, order FK, order_line UQ FK, customer/plan FK, qty>0, unit price>0, cost≥0, tax, interval 1|3|12, anchor_day 1..31 NULL, anchors/policies CK, activation/period_start/period_end (end>start), next_bill_at NULL-if-cancelled, status CK, cancel dates, row_version); subscription_changes(sub FK, type CK, effective, prior/new JSON, invoice/credit FK NULL, request_key, UQ(sub,key), actor, applied_at); invoices(invoice_no UQ, reference UQ INV-, customer/order/sub FK, kind CK, currency, status CK, issue/due, net/tax/total/credited/paid≥0, CK credited+paid≤total, row_version); invoice_lines(invoice CASCADE, order_line/sub FK NULL, position, desc, qty, unit_price, net, tax_bp, tax, coverage [start,end) end>start CK, type CK, charge_key UQ-WHERE-NOT-NULL `sub:<id>|<s>|<e>|RECURRING|base`, `sub:<id>|<s>|<e>|PRORATION|<changeId>`, `order-line:<id>|ONE_TIME|base`); payments(reference UQ PAY-, customer, amount>0, method, ext_ref, note, by, recorded_at); payment_allocations(UQ pay+inv, amount>0); credit_notes(reference UQ CN-, customer/invoice/sub/change FK, currency, reason, net≥0, tax≥0, total>0, applied/refunded≥0, CK applied+refunded≤total, coverage, status CK, by); credit_allocations(UQ note+inv, amount>0); refunds(reference UQ REF-, customer, note FK, currency, amount>0, method, by, recorded_at).
- V5 ops: alerts(type CK 8, severity CK, dedupe_key UQ, title, reasons '[]', status CK, quote/order/sub/invoice/variant/owner/team FK, first/last_seen, resolved/nudged_at, nudge_count); notifications(recipient FK, type, title, body, quote/order/invoice/alert FK, dedupe NULL, read_at; UQ(recipient,dedupe) partial); audit_events(actor NULL, kind USER|SYSTEM, action, entity_type, entity_id, quote/revision/order, before/after JSON, reason, request_id, occurred_at; append-only); job_runs(name, business_date, status CK, trigger_kind CK, started/finished_at, processed/failure_count, message); job_leases(name PK, lease_until, holder, cursor_date); idempotency_requests(actor, operation, key, hash SHA-256 canonical JSON, status IN_PROGRESS|COMPLETED, resp_status/body, entity_id; UQ(actor,op,key)); outbox_events(type, agg_type, agg_id, version, payload '{}', scope '{}', attempts, next_attempt=now, lease_until, dispatched_at, last_error); processed_events(consumer,event PK).
- V6: profiles += password_hash, phone, preferences '{}'.
- V7: deal_escalations(quote/revision/raised_by FK, request_key UUID, UQ(raised, key), category DISCOUNT|POLICY|REVIEW, target_role FINANCE|ADMIN|MANAGER, reason ≤2000, status OPEN|RESOLVED, resolution, resolved_by/at).

## 8. Pure math invariants (Decimal, HALF_UP, minor units; ports to app/engines/ with ZERO I/O)
- Money: MINOR_SCALE=2; CALC=Decimal128 HALF_UP; toMinor=major*100→0dp HALF_UP exact; toMajor=minor/100; parseMajor; round=x→0dp HALF_UP; percentOf=base==0?null:part*100/base 4dp; format plain; plainQuantity strips trailing zeros (4.000→4) but keeps scale-2 money.
- Bp: 10000=100%; MAX 9999 (99.99%). fraction=bp/10000; keep=1-fraction; toPercent=bp/100 2dp; fromPercent=p*100 0dp exact; **combine(l,o)=(1-(1-l)(1-o))*10000 0dp** — 10%+10%=1900bp≠2000.
- ResidualAllocator.roundPreservingTotal(exacts, stableKeys): round each HALF_UP; residual=round(Σexact)-Σrounded; distribute ±1 by loss DESC/ASC then key ASC, wrap-around. Guarantees Σrounded==target, deterministic.
- PricingEngine per line: base=q·p; net=base·keep(l)·keep(o) exact; tax=round(net·rate); margin=net-q·cost. Group ONE_TIME + per-interval RECURRING; residual-allocate base/net/cost per group. eff=combine(l,o). net≤0→ZERO_NET_LINE. Empty→EMPTY_QUOTE; disc>9999→DISCOUNT_OUT_OF_RANGE. Totals: oneTime/recurring sums; comparisonNet=one+rec; contribution=comparison-cost; contribution%=4dp; initialDue=oneTimeNet+oneTimeTax; MRR=Σnet·monthlyNorm HALF_UP (report only); totalBase=Σbase; totalDiscount=Σ(base-net).
- RiskEngine: allowed=min(tier,category) (missing cat→tier; both missing→0); excess=max(0,eff-allowed); value=base·excess/100; M=max excess; W=Σvalue/Σbase·100 (0 if base 0); E=round Σvalue; D=totalDisc·100/totalBase 4dp. Seed policy: tiers B5/S10/G15; cats HW15/SVC10/SUB10; manager (anyExcess, D>12 strict, margin<20 strict); finance (M≥8, W≥3, E≥500000=₹5000, margin<15 strict, nonPositive→finance). Non-positive-margin line→MANAGER or MANAGER_FINANCE flag. required=max levels.
- CommercialHash: SHA-256 hex of `v1|currency|orderDisc|backorder|invoicing|activation` + per-line sorted-by-key `key|kind|variant|plan|qty(stripped)|unitPrice|taxBp|lineDisc|effDisc|net|interval|promised` joined `|`/`\n`. Incl discounts/net, excl unitCost.
- AllocationEngine: (1) max-fillable per SKU first (never cheap-plan by backordering shippable); (2) minimise score=shipping+penalty·max(0,parcels-1); penalty BALANCED=extraShipmentPenalty(5000), MIN_COST=0, MIN_SHIPMENTS=10^12. Warehouses sorted (sortOrder,id); exhaustive if count≤8 (2^n-1 subsets, meetsTarget filter); else greedy cheapest-first. Shipping per wh: kg=Σgrams/1000 3dp CEILING; variable=kg·perKg HALF_UP; cost+=fixed+variable. Tie-break: score→parcels→lexicographic UUIDs.
- ProrationCalculator (round ONCE at end; denominator=actual period length incl leap): firstPeriodCharge(qty,price,start,end,anchor,interval,tax): fullStart=previousBoundary(end,anchor,interval); total=days(fullStart,end); covered=days(start,end); fraction=start>fullStart?covered/total:1; net=round(qty·price·fraction); tax on rounded net. quantityChange(old,new,price,eff,start,end,tax): remaining=days(eff,end)/days(start,end); net=round((new-old)·price·remaining). remainderAtNewPrice=quantityChange(0,qty,newPrice). unusedCoverage(segments,eff): per seg skip consumed (end≤eff); creditFrom=max(eff,start); fraction=remaining; net=round(segNet·fraction), tax likewise; skip ≤0. taxOn(net,bp)=round(net·bp/10000).
- BusinessCalendar: half-open [start,end); nextBoundary(cur,anchor,interval)=YearMonth+interval→min(anchor,len); previousBoundary symmetric; firstPeriodEnd(act,anchor,interval)=act.day==clamped?nextBoundary: first anchored strictly after; remainingFraction=(end-eff)/(end-start) unrounded (0/1 clamps); elapsed=1-remaining; cadenceLabel 1 monthly/3 quarterly/12 yearly; monthlyNorm=1/interval 10dp.
- PriceResolver: rule(highest-priority in-date for variant+tier+currency) → variant default (base+extra) → error; ties→AMBIGUOUS_PRICE_RULE; inactive→PRICE_NOT_RESOLVABLE; currency mismatch→CURRENCY_MISMATCH. until exclusive.
- DiscountAnomalyDetector: minObs 5, minExcess 5pp, sigma×2, floor 2pp. <min→insufficientHistory (null mean/z). Population mean/σ; σeff=max(σ,floor); excess=cur-mean; z=excess/σeff 4dp; anomalous=excess≥5 AND z>2.
- Recommendation score=0.75·history+0.15·promoted+0.10·normContribution; minHistoryOrders 5, maxResults 5, minCandidateMargin 0.

## 9. Test vectors (must hold in FastAPI)
- Pricing: l=o=1000 on 1×1000000/700000 → eff 1900bp, net 810000. (500,0)+o=1000 → eff 1450,1000. FlowB (4×1000000/700000@1200 + 1×500000/350000@1800 + 10×30000/12000@0/m1, o=0) → oneTimeNet 3930000, recurring 300000, comparison 4230000, contribution 960000 (22.6950%), initialDue 3930000. Rounding 3×10001@o=3333 → Σlines==oneTimeNet, deterministic. 10000bp→DISCOUNT_OUT_OF_RANGE; 1 minor@9999→ZERO_NET_LINE. Cadences 30000/m1+90000/m3+360000/m12 → MRR 90000, recurringFirst 480000.
- Risk (seed): FlowB GOLD → MANAGER_FINANCE, M=8, E=40000, W=0.8333, base 4800000. 20%@HW vs 10% GOLD(ceil15): E=50000,W=2.5,M=5. Split invariance: 10×1M@2500 identical to 1×. 5×1M@1500+5×100k@1500 GOLD: M=0,E=0 but AGGREGATE_DISCOUNT_OVER_CEILING→MANAGER. 100@70 30% off→MANAGER_FINANCE. BRONZE 100000@2000 HW(ceil5): M=15→FINANCE. Boundary: +2300bp→M=8→FINANCE; 2299→M=7.99→MANAGER; single 1800→WEIGHTED_EXCESS finance; flat o=1200→D=12 not >12→NONE.
- Allocation (penalty 5000): BALANCED locals ship 10000 score 15000 parcels 2; MIN_SHIPMENTS remote parcels 1 ship 50000; MIN_COST locals ship 10000 score 10000; penalty 100000→remote. FlowB MAIN2/EAST1 demand4→shortage1. Zero stock→empty plan, shortage=demand. Tie deterministic.
- Proration: 10→15@300 eff 09-16 per 09-01→10-01 (30d,15 left) → net 75000; reverse → -75000. Yearly 10→20@3650 per 2026-01-01→2027-01-01 eff 01-15 → rem 351 net 3510000; eff 01-16 → 3500000. Leap 2028 qty0→1@3660 → total 366 net 366000. Last-day → rem1 net 1000. Rounding 0→1@99.99 per 31d eff 01-16 → net 5161 (51.61). Tax 100000@1800bp full → tax 18000. Cancel segments [(09-01→10-01,300000),(09-16→10-01,75000)] eff 09-21 → credits 100000+50000. First-period activation==anchor → fraction 1 (300000); calendar anchor1 09-16→10-01 → 150000. Boundaries: next(01-31,31,1)=02-28; (02-28,31,1)=03-31; leap (01-31,31,1)=02-29; (01-31,31,3)=04-30; first(09-16,1,1)=10-01; (09-16,16,1)=10-16; (09-01,1,1)=10-01.
- Flow A E2E: 2×10000+1×1000@0 BRONZE → 21000.00, risk NONE; submit NOT_REQUIRED; share SENT; portal acceptable, dueOnConfirmation 21000.00, no cost/margin; accept→SO-*; fulfillment RESERVED/1 shipment/0 BO; invoice ONE_TIME ISSUED 21000.00; dispatch onHand 2/reserved 0; rep pay 403; finance 5000→PARTIALLY_PAID/16000, +16000→PAID; post-order counter→409 NEGOTIATION_CLOSED.
- Flow B: draft oneTime 39300.00, recurring 3000.00/monthly, contribution 9600.00, MANAGER_FINANCE; finance-early→409 SEQUENCE; mgr+fin→APPROVED/WAITING; counter→v2 oneTime 38950.00; stale accept→409 STALE; accept v2 conditional; adopt; approve v2→FINALIZED; PARTIALLY_RESERVED/2 shipments/1 BO qty1; replan→RESERVED/0 open; dispatch→DISPATCHED. IN_STOCK_ONLY 5v1→409 INSUFFICIENT_STOCK, no order.
- Auth: demo-token ADMIN→200→/me ADMIN; unknown→400; disabled→demo routes 404. register duplicate→409; wrong pw→401. Self-demote→CONFLICTING_STATE.
- Idempotency: parallel accepts diff keys→1 order; payment replay same key→same id; diff body same key→409 REUSED; no key→400 REQUIRED; stale rowVersion→409 STALE_QUOTE_VERSION.
- Anomaly: 0/4 obs→insufficient; 35% vs [8,10,9,11,12,10]→anomalous; 11%→not; 14% vs all-10→not; 15.1% vs all-10→anomalous z=2.5500.
- Sarvam: header api-subscription-key; body {model, reasoning_effort:null, messages}; temp 0.2, max_tokens 1100; 429→RATE_LIMITED; else non-2xx→UNAVAILABLE (no upstream echo); blank content→no-answer; blank key→unconfigured, no HTTP.

## 10. Atomic order finalization (preserve exactly)
1. SELECT Quote FOR UPDATE. 2. findByQuoteId→ALREADY_FINALIZED if exists (UQ backstop). 3. blockingReasons: cancelled|cancelled; not SUBMITTED; approval not clearing; seller null; customer null; expired(businessToday). Non-empty→WAITING. 4. lines ordered; empty→EMPTY_QUOTE. 5. CommercialHash re-check vs customerAcceptedHash→ACCEPTANCE_HASH_MISMATCH. 6. Insert Order SO-seq + frozen OrderLines. 7. reserveForOrder under lockStock ORDER BY (variant,warehouse): IN_STOCK_ONLY shortfall→INSUFFICIENT_STOCK rollback; else reserve+open-shipment reuse/merge+Reservation HELD+Backorder(expectedDate=earliest receipt, never fabricated). 8. initializeBilling (activation=requested??today; <today→BACKDATED_REJECTED; one-time invoice ON_CONFIRMATION issued due=today+15; subscriptions ACTIVE [activation,firstPeriodEnd) nextBill=periodEnd, frozen discounted price; group first charges by interval|activation|end). 9. stage=CONFIRMED+recordProgress. 10. Audit ORDER_CREATED + outbox ORDER_CREATED (+BACKORDER_UPDATED if shortage).

## 11. Cross-cutting rules
- Money minor BIGINT; currency default INR; invoice due +15d; billing tz Asia/Kolkata (businessToday) vs UTC instants.
- Idempotency: INSERT ... ON CONFLICT(actor,op,key) DO UPDATE (row-lock) RETURNING (xmax=0)=inserted; missing key→REQUIRED; same key diff hash→REUSED; COMPLETED→replay; IN_PROGRESS <10min→IN_PROGRESS else take over. Hash=SHA-256 canonical JSON. Ops: approval-decision:{id}, record-payment, record-refund, plan-switch:{id}, stock-movements request_key UQ, portal-quote-request, portal-request:{quote}, portal-accept:{quote}, portal-recommendation:{quote}, sub changes (sub,key).
- Approval: NONE→NOT_REQUIRED; else due=now+48h; chain MANAGER→[M], MANAGER_FINANCE→[M,F] (both upfront); candidates=findAvailableApprovers(role,team,now) minus owner/creator; 0→unassigned blocking. Decide: lock quote+step; role==required or ADMIN; not owner/creator→SELF_APPROVAL_FORBIDDEN; available now; assigned-other→delegation(active role+team+validAt) or ADMIN or same-team manager; step PENDING else ALREADY_DECIDED; SUBMITTED+current else 409; expectedRevision/RowVersion else 409; step2 needs step1 APPROVED else SEQUENCE_VIOLATION. APPROVE→PENDING_FINANCE|APPROVED; REJECT→REJECTED; RETURN→REVISION_REQUIRED (both supersede-later). New terms route from scratch; supersede never grants.
- Quote gates to execute: SUBMITTED + approval clears + sellerAdopted + customerAccepted + unexpired + no order. Stage never authorises execution.
- Stock: reservations≠movements; available=onHand-reserved (active wh only); needsReplenishment=reorder>0&&avail≤reorder; suggestion=max(0,target-avail). Dispatch idempotent if DISPATCHED; requires HELD sums, onHand+reserved else Recount CONFLICTING_STATE. Receipt replay by request_key (no stock change). Override: feasibility avail+ownHeld else ALLOCATION_INFEASIBLE + proposed counter-plan, existing untouched; release HELD, cancel open shipments, rebuild.
- Billing: charge-key idempotency (period/adjustment/one-time); auto-allocate oldest-due-first (due nulls last); explicit alloc Σ≤payment else OVER_ALLOCATION; same-customer else 404; same-currency else CURRENCY_MISMATCH; non-payable (DRAFT/VOID/PAID) else INVOICE_NOT_PAYABLE. Overpayment stays unallocated. Credit: apply to debt first; refund capped by available AND cash received (sumReceived-sumRefunded) else REFUND_EXCEEDS_ELIGIBLE. Invoice DRAFT/VOID sticky; fully-credited→PAID. Sub changes: live only; backdate→BACKDATED_REJECTED; outside [periodStart,periodEnd)→EFFECTIVE_DATE_OUT_OF_PERIOD; same-qty→400; NEXT_PERIOD leaves period untouched; cancel END_OF_PERIOD→CANCEL_AT_PERIOD_END else CANCELED+credit unused. Plan switch: effective==today only; same product+currency+active; interval change→new [today,today+newMonths), anchor=today.dom, anchor=ACTIVATION_DATE.
- Portal: COMMENT changes nothing (recordProgress clears stall); CHANGE/COUNTER server-priced, zero-net refused, new CUSTOMER_COUNTER SUBMITTED revision, fresh chain, seller adoption unset, stage UNDER_NEGOTIATION. Acceptance needs revisionId+commercialHash match; conditional if gates open. Status map: DRAFT/REVIEW→IN_PREPARATION; SENT→AWAITING_YOUR_REVIEW|ACCEPTED_PENDING_CONFIRMATION; UNDER_NEGOTIATION→UNDER_DISCUSSION; CONFIRMED→CONFIRMED; CANCELED→WITHDRAWN; LOST→CLOSED; EXPIRED→EXPIRED. Availability notes plain, no warehouse, no invented dates.
- Health sweeps: stalled (awaitingExternalSince>72h; CRITICAL if >144h); overdue approvals (WARNING) + NO_APPROVER (CRITICAL); delivery slippage (today>promised or expected>promised; +UNCONFIRMED if expected null; CRITICAL); low stock (INFO +suggestion); overdue invoices (CRITICAL if >30d). DISCOUNT_ANOMALY only via submission evaluation; resolveCleared excludes it. Nudge cooldown 12h→429; recipient owner else first active MANAGER≠actor. expireQuotes→EXPIRED+system audit (scheduler, not sweep).
- Outbox events: QUOTE_REVISED,SUBMITTED,APPROVAL_UPDATED,NEGOTIATION_UPDATED,ORDER_CREATED,ALLOCATION_UPDATED,BACKORDER_UPDATED,INVOICE_UPDATED,SUBSCRIPTION_UPDATED,ALERT_UPDATED,STOCK_UPDATED. Payloads minimal (ids/refs/versions, no money). Scopes: internalOnly/owner/deal(customer,owner,team)/roles (never broadcast CUSTOMER). Dispatcher 1s poll, batch 50, SKIP LOCKED, retry 2^attempts capped 300s, park after 8. Jobs lease upsert anti-redundancy; billing batch 25 per-sub REQUIRES_NEW, one interval/pass, SYSTEM actor; sweeps each 60s (billing 20s init, health 40s lease 110s, expiry 50s lease 110s).
- Reports: window default today-90d→today+1d; scope REP→self, MANAGER→team, CUSTOMER→403; four figures never summed (oneTime, MRR-normalised, invoiced, collected); export = same query ("file is the screen"); PDF %PDF-, XLSX PK, XLS D0CF11E0.
- Exports: invoice PDF (PDFBox A4 Courier; header+GSTIN; 80-col table 36ch trunc; reconciliation; HDFC 50200098765432/HDFC0000123/HDFCINBBXXX), XLSX (POI sheet `Invoice {ref}`, 9-col table, #,##0.00), DOC (Word-HTML TAX INVOICE, msword).
- Sarvam: endpoint https://api.sarvam.ai/v1/chat/completions, model sarvam-105b, key header api-subscription-key, temp 0.2, max 1100, timeouts 5s/35s; context-first (404 foreign = no provider call); customer context = portal DTO only.
- Seed (demo.seed-on-startup, idempotent): Sales East; 6 staff + Alpha/Beta/Gamma/Delta/Epsilon customers; delegations valid+expired; HW/SVC/SUB cats; LAPTOP/DOCK(promoted)/SETUP/SUPPORT products + variants + LAPTOP-16 GOLD rule 1100000 pri10 from 2026-01-01; SUPPORT-M/Q/Y plans (CALENDAR_MONTH_START/IMMEDIATE/IMMEDIATE); MAIN/EAST warehouses; stock; policy v1 seedDefault; 12 HIST orders (8/12 dock, setup every 4th) + 2 SUB + LATE (UNALLOCATED+BO 3) + STALLED (SENT 5d, awaiting external); extras catalogue top-up.

## 12. Env → FastAPI settings map
SPRING_DATASOURCE_URL/USERNAME/PASSWORD, DB_POOL_MAX=5, SPRING_FLYWAY_USER/PASSWORD; AUTH_JWT_SECRET, AUTH_JWK_SET_URI, AUTH_ISSUER_URI (def http://127.0.0.1:54321/auth/v1), AUTH_EXPECTED_AUDIENCE=authenticated, AUTH_AUTO_PROVISION_REP=true, APP_ALLOWED_ORIGINS (def http://localhost:3000), SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY, AUTH_LOCAL_JWT_SECRET, BILLING_TIMEZONE=Asia/Kolkata, ALLOCATION_MODE=BALANCED (+penalty 5000, limit 8), JOBS_ENABLED=true (+batch 25/50, lease 120s, maxAttempts 8), DEMO_MODE/SEED/BUSINESS_DATE/AUTH_ENABLED/JWT_SECRET, SARVAM_API_KEY/MODEL=sarvam-105b, PORT=8080, LOG_LEVEL_APP=INFO, LOG_LEVEL_SQL=WARN. Server 0.0.0.0:PORT, CORS exact origins, methods GET/POST/PATCH/PUT/DELETE/OPTIONS, headers Authorization/Content-Type/Idempotency-Key/X-Request-Id/X-Expected-Version, expose X-Request-Id, maxAge 30m. Actuator health/info → /health; /actuator/** ADMIN.

## 13. Target layout (to build)
app/api/deps.py, api/v1/api_router.py, routers(auth,catalog,quotes,approvals,portal,orders,fulfillment,billing,health,reports,assistant,jobs); core(config,database,exceptions,response,security); engines(pricing,risk,allocation,proration + money/bp/residual/calendar/anomaly/policy/recommend); models/(~40 tables, schema dealflow); schemas/; services/; workers/; websocket/; main.py (CORS, handlers, port 8080).

## 14. File conversion checklist
- [x] app/core/config.py ← AppProperties + application.yml + .env.example
- [x] app/core/exceptions.py ← ErrorCode + ApiException
- [x] app/core/response.py ← ApiResponse/PageResponse/ErrorResponse/Paging/RequestIdFilter/RequestContext
- [x] app/core/security.py ← SecurityConfig + DemoTokenService + LocalAuthService + ProfileJwtAuthenticationConverter + Actor/CurrentActor/Role/Profile
- [x] app/core/database.py ← datasource + JPA settings
- [x] app/engines/money.py ← Money + Bp + ResidualAllocator
- [x] app/engines/pricing_engine.py ← PricingEngine (+CommercialHash, PricingModel)
- [x] app/engines/risk_engine.py ← RiskEngine (+RiskModel, DiscountPolicyDefinition)
- [x] app/engines/allocation_engine.py ← AllocationEngine (+AllocationModel)
- [x] app/engines/proration_calculator.py ← ProrationCalculator + BusinessCalendar + UnusedSubscriptionCoverage
- [x] app/engines/anomaly.py ← DiscountAnomalyDetector
- [x] app/engines/recommend.py ← RecommendationService scoring
- [x] models: catalog(7) + quotes(4: Quote/Revision/Line/Negotiation+Dismissal) + approvals(1) + orders(2) + fulfillment(7) + billing(9) + policy(1) + portal(escalations via JDBC!) + health(2) + outbox(1) + jobs(2: run+lease) + shared(audit, idempotency, teams/profiles/delegations)
- [x] schemas per domain (CatalogDtos, StorefrontDtos, QuoteDtos, ApprovalDtos, FulfillmentDtos, BillingDtos, PortalDtos, PortalAccountDtos, ReportDtos, AuthDtos)
- [x] services: QuoteService/QuoteEvaluationService/QuoteLineBuilder/Factory/AccessPolicy/GateListener, ApprovalService/RoutingService, OrderFinalizationService, AllocationService/StockAvailability/StockOperationsService, BillingService/Settlement/Subscription/PlanSwitch, PriceResolver, DiscountPolicyService, Portal* (6), Recommendation* (2), DealHealthService, ReportService, OutboxWriter/Dispatcher, JobLease/RecurringBilling/ScheduledJobs, SarvamClient/AssistantContextService, DealEventPublisher, AuditService, IdempotencyService
- [x] routers: auth, catalog(+public), quotes(+negotiation+escalation), approvals, portal(+account+recommendation), orders, fulfillment, billing(+plan-switch), health(alerts+notifications), reports, assistant, jobs, seed?
- [x] workers: outbox dispatcher + leased sweeps (billing/health/expiry)
- [x] websocket /ws (FastAPI native; STOMP semantics → document replacement but keep auth + private-queue invariants)
- [x] exporters: InvoiceDocumentExporter (reportlab+openpyxl+doc-html), PdfReportExporter + SpreadsheetReportExporter
- [x] main.py + CORS + exception handlers + request-id middleware
- [x] Assistant LLM integration: Groq (openai/gpt-oss-120b) + Google AI Studio Gemini (gemini-3.5-flash-lite) + Sarvam fallback. 168/168 tests green. Live tested on :8080 and :3000.

