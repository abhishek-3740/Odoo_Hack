-- =============================================================================
-- DealFlow360 :: V5 alerts, notifications, audit, jobs, idempotency, outbox
--
-- Recovery contract (Implementation Plan sections 8 and 11.1):
--  * `idempotency_requests` is claimed with INSERT ... ON CONFLICT DO UPDATE
--    inside the SAME transaction as the business mutation, so a replay cannot
--    slip between the claim and the write.
--  * `outbox_events` rows are written in the business transaction and dispatched
--    afterwards. A WebSocket frame is never the source of truth; a crash between
--    commit and send is recovered by re-claiming the undispatched row.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Deal health
-- -----------------------------------------------------------------------------
create table dealflow.alerts (
    id             uuid primary key,
    alert_type     text not null check (alert_type in
        ('STALLED_QUOTE', 'DISCOUNT_ANOMALY', 'DELIVERY_SLIPPAGE', 'APPROVAL_OVERDUE',
         'NO_APPROVER', 'LOW_STOCK', 'BACKORDER_OPEN', 'INVOICE_OVERDUE')),
    severity       text not null check (severity in ('INFO', 'WARNING', 'CRITICAL')),
    -- One row per real-world condition. Re-running the sweep refreshes
    -- `last_seen_at` instead of stacking duplicates.
    dedupe_key     text not null unique,
    title          text not null,
    reasons        jsonb not null default '[]'::jsonb,
    status         text not null check (status in ('OPEN', 'RESOLVED')),

    quote_id       uuid references dealflow.quotes (id),
    order_id       uuid references dealflow.orders (id),
    subscription_id uuid references dealflow.subscriptions (id),
    invoice_id     uuid references dealflow.invoices (id),
    variant_id     uuid references dealflow.product_variants (id),
    owner_profile_id uuid references dealflow.profiles (id),
    team_id        uuid references dealflow.teams (id),

    first_seen_at  timestamptz not null default now(),
    last_seen_at   timestamptz not null default now(),
    resolved_at    timestamptz,
    last_nudged_at timestamptz,
    nudge_count    int not null default 0,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now()
);
create trigger alerts_touch before update on dealflow.alerts
    for each row execute function dealflow.touch_updated_at();
create index alerts_open_idx on dealflow.alerts (alert_type, severity, last_seen_at desc)
    where status = 'OPEN';
create index alerts_owner_idx on dealflow.alerts (owner_profile_id, status);
create index alerts_quote_idx on dealflow.alerts (quote_id);

-- Durable inbox. Survives a missed WebSocket frame; reconnect reads it back.
create table dealflow.notifications (
    id                   uuid primary key,
    recipient_profile_id uuid not null references dealflow.profiles (id),
    notification_type    text not null,
    title                text not null,
    body                 text,
    quote_id             uuid references dealflow.quotes (id),
    order_id             uuid references dealflow.orders (id),
    invoice_id           uuid references dealflow.invoices (id),
    alert_id             uuid references dealflow.alerts (id),
    dedupe_key           text,
    read_at              timestamptz,
    created_at           timestamptz not null default now()
);
create unique index notifications_dedupe_uq
    on dealflow.notifications (recipient_profile_id, dedupe_key) where dedupe_key is not null;
create index notifications_inbox_idx on dealflow.notifications (recipient_profile_id, created_at desc);
create index notifications_unread_idx on dealflow.notifications (recipient_profile_id)
    where read_at is null;

-- -----------------------------------------------------------------------------
-- Audit
-- -----------------------------------------------------------------------------
-- Append-only. Every attributable action lands here in the same transaction as
-- the change it describes, including SYSTEM actions performed by scheduled jobs
-- (which never borrow a human approver's identity).
create table dealflow.audit_events (
    id               uuid primary key,
    actor_profile_id uuid references dealflow.profiles (id),
    actor_kind       text not null default 'USER' check (actor_kind in ('USER', 'SYSTEM')),
    action           text not null,
    entity_type      text not null,
    entity_id        uuid,
    quote_id         uuid,
    revision_id      uuid,
    order_id         uuid,
    before_summary   jsonb,
    after_summary    jsonb,
    reason           text,
    request_id       text,
    occurred_at      timestamptz not null default now()
);
create index audit_events_entity_idx on dealflow.audit_events (entity_type, entity_id, occurred_at desc);
create index audit_events_quote_idx on dealflow.audit_events (quote_id, occurred_at desc);
create index audit_events_actor_idx on dealflow.audit_events (actor_profile_id, occurred_at desc);

-- -----------------------------------------------------------------------------
-- Scheduled work
-- -----------------------------------------------------------------------------
create table dealflow.job_runs (
    id              uuid primary key,
    job_name        text not null,
    business_date   date,
    status          text not null check (status in ('RUNNING', 'SUCCESS', 'FAILED')),
    trigger_kind    text not null default 'SCHEDULED' check (trigger_kind in ('SCHEDULED', 'MANUAL')),
    started_at      timestamptz not null default now(),
    finished_at     timestamptz,
    processed_count int not null default 0,
    failure_count   int not null default 0,
    message         text,
    created_at      timestamptz not null default now()
);
create index job_runs_name_idx on dealflow.job_runs (job_name, started_at desc);

-- Single-row lease per job. Prevents an overlapping sweep from double-running
-- work; the unique charge keys remain the real correctness guarantee.
create table dealflow.job_leases (
    job_name    text primary key,
    lease_until timestamptz not null,
    holder      text not null,
    cursor_date date,
    updated_at  timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Idempotency
-- -----------------------------------------------------------------------------
-- Bound to actor + operation + key, with the canonical request-body hash. A
-- replay of the same body returns the stored result; the same key with a
-- different body is a conflict, not a silent second operation (T27).
create table dealflow.idempotency_requests (
    id               uuid primary key,
    actor_profile_id uuid not null references dealflow.profiles (id),
    operation        text not null,
    idempotency_key  text not null,
    request_hash     text not null,
    status           text not null check (status in ('IN_PROGRESS', 'COMPLETED')),
    response_status  int,
    response_body    text,
    entity_id        uuid,
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now(),
    constraint idempotency_requests_uq unique (actor_profile_id, operation, idempotency_key)
);
create index idempotency_requests_created_idx on dealflow.idempotency_requests (created_at);

-- -----------------------------------------------------------------------------
-- Transactional outbox
-- -----------------------------------------------------------------------------
-- Payloads stay minimal on purpose: an event carries an id, a type, an entity
-- reference and a version. Costs, margins and quote bodies never travel in a
-- push frame; the client refetches the authorised REST view.
create table dealflow.outbox_events (
    id                uuid primary key,
    event_type        text not null,
    aggregate_type    text not null,
    aggregate_id      uuid not null,
    aggregate_version bigint not null default 0,
    payload           jsonb not null default '{}'::jsonb,
    -- Resolved at dispatch time against current ownership, never trusted from
    -- the producer alone.
    recipient_scope   jsonb not null default '{}'::jsonb,
    attempt_count     int not null default 0,
    next_attempt_at   timestamptz not null default now(),
    lease_until       timestamptz,
    dispatched_at     timestamptz,
    last_error        text,
    created_at        timestamptz not null default now()
);
create index outbox_events_pending_idx on dealflow.outbox_events (next_attempt_at)
    where dispatched_at is null;
create index outbox_events_aggregate_idx on dealflow.outbox_events (aggregate_type, aggregate_id);

-- Reserved for the optional RabbitMQ stage: a consumer records its own effect
-- against (consumer, event_id) so at-least-once delivery stays idempotent.
create table dealflow.processed_events (
    consumer     text not null,
    event_id     uuid not null,
    processed_at timestamptz not null default now(),
    primary key (consumer, event_id)
);
