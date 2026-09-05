# DealFlow360: recommendations, reviews and role assistants

## What changed

Merged `origin/main` at `f1c18ca` into the existing `feature/dealflow360-backend` checkout. The previous untracked frontend was preserved at `C:\Users\Nikhil1616\Desktop\odoo-frontend-backup-20260905`. The working UI is now the Vite React application under `frontend`. `frontend_new` was left intact.

### Deal recommendations

- Cross-sell ranks products using actual confirmed-order co-purchases, promotion and contribution. It counts products once per order. Below five historical anchor orders, it uses an explicitly labelled catalog fallback instead of presenting an unreliable confidence score.
- Upsell proposes higher-priced variants in the same explicitly configured compatibility group. Administrators edit groups in **Master Catalog → Compatible upgrade groups**. Groups also influence inventory substitutions, so only genuinely interchangeable variants belong together.
- Each offer previews customer-specific unit price, deal net change, contribution change, margin percentage-point change, stock and required approval. The configured candidate margin floor applies after discounts.
- **Add & save** adds one cross-sell item. **Apply upgrade** replaces the selected line while preserving its quantity and discount. Both preserve other lines and the order discount, run normal pricing/policy checks and create a saved draft revision.
- Applying requires the exact current revision and row version. Stale or no-longer-eligible offers are rejected. Existing orders and closed quotes cannot be changed through recommendations.
- Dismissals persist for the current revision. Unsaved edits disable recommendation mutations until the quote is saved.

No separately trained ML model is required. Purchase-pattern ranking and explicit compatibility rules remain explainable with the small hackathon dataset. Sarvam is used for conversational explanation, not arithmetic or commercial decisions.

### Customer negotiation and internal review

The customer deal room retains structured counteroffers and acceptance. The assistant can help customers phrase questions; the explicit **Send my last question to salesperson** action records the customer's own message in the existing negotiation workflow. AI text never creates a counteroffer, grants a discount or accepts a quotation automatically.

Salespeople see questions and counteroffers under **Keep the conversation moving**, can reply, and can raise a review linked to the saved quotation revision:

| Question category | Reviewer |
|---|---|
| Discount or pricing ambiguity | Finance |
| Policy exception or unclear rule | Admin |
| Routine commercial review | Manager |

Reviews persist in PostgreSQL with audit records and notifications. Repeated requests with the same request key return the original case. Only the target role or Admin can resolve a case, within the quotation access rules. A review resolution records advice; actual changed terms still pass through a new revision, the required approval sequence, seller adoption and customer acceptance. Finance approval cannot skip a required Manager step.

Flyway migration `V7__deal_escalations.sql` adds the review table and indexes, with RLS enabled. It does not rewrite existing migrations.

### Sarvam assistants

**Ask DealFlow** is available throughout authenticated customer and internal workspaces. On a quotation page, the assistant receives the current authorized quote. Elsewhere it receives a bounded workspace snapshot:

| Role | Context |
|---|---|
| Customer | Their own restricted portal quotations and invoices; no internal costs, margins, policy ceilings or review notes |
| Sales representative | Their quotation records, review cases and pending approval steps |
| Manager | Team quotation records, reviews and manager approval queue |
| Finance | Accessible quotations, reviews, finance approval sequence and financial summary |
| Admin | Accessible quotations, review cases, pending approval steps and financial summary |

The server determines identity and scope. Browser requests cannot supply a role or arbitrary database context. Answers are plain text, have no executable tools and cannot write to the database. Chat history stays in browser memory and resets on role, user or route changes. The provider receives the authorized snapshot and recent messages for that request; chat is not a permanent conversation archive.

The client uses the [Sarvam chat completion API](https://docs.sarvam.ai/api-reference/chat/chat-completions), model `sarvam-105b`, with explicit `reasoning_effort: null` so hidden reasoning does not consume the visible response budget. Limits: 2,000-character question, eight history messages, four simultaneous provider requests and twelve messages per minute per profile in each backend process. There is a 5-second connect timeout and 35-second read timeout. Errors remain visible and retryable; there are no fake fallback answers. For multiple backend replicas, move the process-local limiter to shared storage.

## Run the product

1. Use Java 21. From `backend`, run `mvnw.cmd spring-boot:run`. Existing ignored `backend/.env` is loaded automatically.
2. Keep hosted Supabase database variables, issuer and JWKS configuration in `backend/.env`. Supabase verification and the existing separately signed demo tokens are retained. `application.yml` once again reads database settings and `PORT` from environment variables, with port 8080 as fallback.
3. Set `SARVAM_API_KEY` in that same backend environment file and optionally `SARVAM_MODEL=sarvam-105b`. The supplied key is already configured locally. Never place it in `VITE_*`, browser JavaScript or tracked configuration.
4. From `frontend`, run `npm ci` and `npm run dev`. Vite uses port 3000 and proxies `/api` and `/ws` to port 8080. If the backend uses another port, set `API_PROXY_TARGET=http://127.0.0.1:<port>` in `frontend/.env.local`.
5. In production, serve `frontend/dist` with SPA fallback and reverse-proxy `/api` and `/ws` to Spring Boot. Vite's development proxy is not part of the production bundle.

The live provider key and authenticated backend-to-Sarvam requests for all five roles were checked successfully. Automated database/browser mutations used a separate PostgreSQL test database, not hosted Supabase. No full local Supabase stack is required.

## Verification

- Backend: `mvnw.cmd verify` — 76 unit tests and 30 PostgreSQL integration tests passed. Covers stale recommendation application, preserved quantity/discount, reviewer authorization, unchanged commercial gates after resolution, customer context isolation, forged history roles, provider errors, missing keys and explicit reasoning configuration, alongside existing lifecycle tests.
- Frontend: `npm run build`; `npm run lint` (existing warnings remain).
- Browser suite: `npm run test:e2e` — all four scenarios passed. Uses a disposable seeded backend at port 8082 and Vite at 3000 with `API_PROXY_TARGET=http://127.0.0.1:8082`. The tests mutate this test database. They must not target a production or shared customer database.
- Playwright defaults to installed Microsoft Edge; change `channel` in `playwright.config.js` if using another installed browser.
- Browser cases cover real recommendation application, review routing/resolution, persisted customer handoff, unsaved edits, dismissals, provider error recovery, keyboard focus, Escape and 320/768/1024/1440px layouts. Assistant WCAG A/AA checks use axe. UI chat replies are mocked for determinism; live Sarvam connectivity is verified separately.

For a disposable browser-test backend, use a standalone PostgreSQL database (for example `postgres:16-alpine`), override `spring.datasource.*`, set `server.port=8082`, enable demo auth and seed with test-only signing secrets, and set `dealflow.jobs.enabled=false`. Keep hosted `.env` untouched. On Windows, stop a running packaged test JAR before rebuilding it; Windows locks open JAR files.

## Scope and limits

Suggestions depend on catalog quality and purchase history; they do not claim learned conversion probabilities. AI may misunderstand context, so users review its advice and use normal product controls to act. Workspace summaries are bounded snapshots; financial figures keep one-time sales, MRR, invoices, cash and outstanding balances separate. Review inbox currently shows the latest 100 accessible cases. No automatic negotiation, payment processing or approval authority is delegated to AI.

The UI refresh introduces a forest-green workspace palette, consistent recommendation/review cards, responsive chat drawer, accessible native dialogs, focus states and visible loading/error/empty states. It also repairs existing pagination response handling, variant loading, invalid empty quote evaluation requests, approval reason/revision payloads, stage names, audit labels and overlapping floating controls. Quote mutation responses now flush their version before returning, preventing a false stale-version conflict on the next save. This verification covers the changed workflows, not an exhaustive audit of every inherited screen.

## Current local preview

The normal portal at `http://127.0.0.1:3000` now proxies to the actual backend on port 8080, using hosted Supabase settings from `backend/.env`. Demo authentication and Sarvam are configured locally. The earlier isolated preview on 8082 has been stopped. No application source was stored outside the active `frontend` and `backend` folders; only the previous frontend backup is outside the repository. See `frontend/README.md` for the two-terminal VS Code startup procedure. The normal backend successfully connected to Supabase and validated its existing schema at version 7. The old 8080 process was restarted to load the updated implementation.
