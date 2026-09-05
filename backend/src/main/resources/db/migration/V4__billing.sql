-- =============================================================================
-- DealFlow360 :: V4 subscriptions, invoices, payments, credits, refunds
--
-- Billing correctness contract (Implementation Plan section 7.5):
--  * Every subscription charge carries a `charge_key` that is UNIQUE across the
--    whole database. That single index is what makes the recurring job safe to
--    run twice, concurrently, or after a missed window (T19).
--  * `outstanding = total - credited - paid`. It is derived, never stored as an
--    independently editable field, and can never go below zero: an over-payment
--    stays unallocated as customer credit instead of making an invoice negative.
--  * Issued amounts are immutable. A correction is an adjustment charge or a
--    credit note, never an UPDATE over history.
-- =============================================================================

create table dealflow.subscriptions (
    id                        uuid primary key,
    reference                 text not null unique,
    order_id                  uuid not null references dealflow.orders (id),
    -- One subscription per recurring order line.
    order_line_id             uuid not null unique references dealflow.order_lines (id),
    customer_id               uuid not null references dealflow.customers (id),
    plan_id                   uuid not null references dealflow.subscription_plans (id),
    currency                  varchar(3) not null,

    quantity                  numeric(18, 3) not null check (quantity > 0),
    -- The accepted discounted price, frozen from the quote. Cancelling later
    -- credits at THIS rate, not the list rate (E14).
    unit_interval_price_minor bigint not null check (unit_interval_price_minor > 0),
    unit_interval_cost_minor  bigint not null default 0 check (unit_interval_cost_minor >= 0),
    tax_rate_bp               int not null default 0,
    interval_months           int not null check (interval_months in (1, 3, 12)),

    -- Preserved across short months: a 31st anchor clamps to Feb 28/29 and then
    -- returns to the 31st, rather than permanently drifting to the 28th.
    anchor_day                int check (anchor_day between 1 and 31),
    billing_anchor            text not null check (billing_anchor in ('ACTIVATION_DATE', 'CALENDAR_MONTH_START')),

    activation_date           date not null,
    period_start              date not null,
    period_end                date not null,
    next_bill_at              date,

    status                    text not null check (status in
        ('PENDING_ACTIVATION', 'ACTIVE', 'CANCEL_AT_PERIOD_END', 'CANCELED')),
    cancel_effective_date     date,
    canceled_at               timestamptz,

    proration_policy          text not null check (proration_policy in ('IMMEDIATE_PRORATED', 'NEXT_PERIOD')),
    cancellation_policy       text not null check (cancellation_policy in ('END_OF_PERIOD', 'IMMEDIATE_PRORATED')),
    clawback_policy           text not null default 'NONE',

    row_version               bigint not null default 0,
    created_at                timestamptz not null default now(),
    updated_at                timestamptz not null default now(),

    constraint subscriptions_period_ck check (period_end > period_start)
);
create trigger subscriptions_touch before update on dealflow.subscriptions
    for each row execute function dealflow.touch_updated_at();
-- The recurring job's claim query rides this index.
create index subscriptions_due_idx on dealflow.subscriptions (next_bill_at)
    where status in ('ACTIVE', 'CANCEL_AT_PERIOD_END');
create index subscriptions_customer_idx on dealflow.subscriptions (customer_id, status);
create index subscriptions_order_idx on dealflow.subscriptions (order_id);

create table dealflow.subscription_changes (
    id                         uuid primary key,
    subscription_id            uuid not null references dealflow.subscriptions (id),
    change_type                text not null check (change_type in ('QUANTITY', 'PLAN', 'CANCEL')),
    effective_date             date not null,
    prior_snapshot             jsonb not null,
    new_snapshot               jsonb not null,
    adjustment_invoice_id      uuid,
    credit_note_id             uuid,
    -- E17/T18: a replayed change request produces no second adjustment.
    request_key                text not null,
    actor_profile_id           uuid references dealflow.profiles (id),
    applied_at                 timestamptz not null default now(),
    created_at                 timestamptz not null default now(),
    constraint subscription_changes_key_uq unique (subscription_id, request_key)
);
create index subscription_changes_sub_idx on dealflow.subscription_changes (subscription_id, effective_date);

-- -----------------------------------------------------------------------------
-- Invoices
-- -----------------------------------------------------------------------------
create table dealflow.invoices (
    id              uuid primary key,
    invoice_no      bigint not null unique,
    reference       text not null unique,
    customer_id     uuid not null references dealflow.customers (id),
    order_id        uuid references dealflow.orders (id),
    subscription_id uuid references dealflow.subscriptions (id),
    invoice_kind    text not null check (invoice_kind in ('ONE_TIME', 'RECURRING', 'ADJUSTMENT')),
    currency        varchar(3) not null,
    status          text not null check (status in ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'VOID')),
    issue_date      date,
    due_date        date,
    net_minor       bigint not null default 0 check (net_minor >= 0),
    tax_minor       bigint not null default 0 check (tax_minor >= 0),
    total_minor     bigint not null default 0 check (total_minor >= 0),
    credited_minor  bigint not null default 0 check (credited_minor >= 0),
    paid_minor      bigint not null default 0 check (paid_minor >= 0),
    row_version     bigint not null default 0,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),

    -- Neither credits nor payments may drive the balance below zero.
    constraint invoices_settled_ck check (credited_minor + paid_minor <= total_minor)
);
create trigger invoices_touch before update on dealflow.invoices
    for each row execute function dealflow.touch_updated_at();
create index invoices_customer_idx on dealflow.invoices (customer_id, status, due_date);
create index invoices_order_idx on dealflow.invoices (order_id);
create index invoices_subscription_idx on dealflow.invoices (subscription_id);
create index invoices_issue_idx on dealflow.invoices (issue_date desc);
create index invoices_open_idx on dealflow.invoices (due_date) where status in ('ISSUED', 'PARTIALLY_PAID');

create table dealflow.invoice_lines (
    id              uuid primary key,
    invoice_id      uuid not null references dealflow.invoices (id) on delete cascade,
    order_line_id   uuid references dealflow.order_lines (id),
    subscription_id uuid references dealflow.subscriptions (id),
    position        int not null default 0,
    description     text not null,
    quantity        numeric(18, 3) not null,
    unit_price_minor bigint not null,
    net_minor       bigint not null,
    tax_rate_bp     int not null default 0,
    tax_minor       bigint not null default 0,
    -- Every charge stores the interval it actually covers, so a later credit
    -- can prove it is not crediting the same days twice.
    coverage_start  date,
    coverage_end    date,
    line_type       text not null check (line_type in ('ONE_TIME', 'RECURRING', 'PRORATION')),
    charge_key      text,
    created_at      timestamptz not null default now(),

    constraint invoice_lines_coverage_ck check (
        coverage_start is null or coverage_end is null or coverage_end > coverage_start
    )
);
-- The idempotency backbone of recurring billing. Key shape:
--   sub:<id>|<coverage_start>|<coverage_end>|<charge_type>|<base|change_id>
create unique index invoice_lines_charge_key_uq on dealflow.invoice_lines (charge_key)
    where charge_key is not null;
create index invoice_lines_invoice_idx on dealflow.invoice_lines (invoice_id, position);
create index invoice_lines_subscription_idx on dealflow.invoice_lines (subscription_id, coverage_start);

-- -----------------------------------------------------------------------------
-- Money in
-- -----------------------------------------------------------------------------
-- A payment is a recorded receipt, not a gateway capture. Nothing in this build
-- charges an instrument; Finance records what actually arrived.
create table dealflow.payments (
    id                     uuid primary key,
    reference              text not null unique,
    customer_id            uuid not null references dealflow.customers (id),
    currency               varchar(3) not null,
    amount_minor           bigint not null check (amount_minor > 0),
    method                 text not null,
    external_reference     text,
    note                   text,
    recorded_by_profile_id uuid references dealflow.profiles (id),
    recorded_at            timestamptz not null default now(),
    created_at             timestamptz not null default now()
);
create index payments_customer_idx on dealflow.payments (customer_id, recorded_at desc);

create table dealflow.payment_allocations (
    id           uuid primary key,
    payment_id   uuid not null references dealflow.payments (id),
    invoice_id   uuid not null references dealflow.invoices (id),
    amount_minor bigint not null check (amount_minor > 0),
    created_at   timestamptz not null default now(),
    constraint payment_allocations_uq unique (payment_id, invoice_id)
);
create index payment_allocations_invoice_idx on dealflow.payment_allocations (invoice_id);

-- -----------------------------------------------------------------------------
-- Credits and refunds
-- -----------------------------------------------------------------------------
create table dealflow.credit_notes (
    id                     uuid primary key,
    reference              text not null unique,
    customer_id            uuid not null references dealflow.customers (id),
    invoice_id             uuid references dealflow.invoices (id),
    subscription_id        uuid references dealflow.subscriptions (id),
    subscription_change_id uuid references dealflow.subscription_changes (id),
    currency               varchar(3) not null,
    reason                 text not null,
    net_minor              bigint not null check (net_minor >= 0),
    tax_minor              bigint not null default 0 check (tax_minor >= 0),
    total_minor            bigint not null check (total_minor > 0),
    -- How much of this credit has been consumed by invoices or refunded.
    applied_minor          bigint not null default 0 check (applied_minor >= 0),
    refunded_minor         bigint not null default 0 check (refunded_minor >= 0),
    coverage_start         date,
    coverage_end           date,
    status                 text not null check (status in
        ('ISSUED', 'PARTIALLY_APPLIED', 'APPLIED', 'VOID')),
    issued_by_profile_id   uuid references dealflow.profiles (id),
    created_at             timestamptz not null default now(),
    updated_at             timestamptz not null default now(),

    constraint credit_notes_balance_ck check (applied_minor + refunded_minor <= total_minor),
    constraint credit_notes_coverage_ck check (
        coverage_start is null or coverage_end is null or coverage_end > coverage_start
    )
);
create trigger credit_notes_touch before update on dealflow.credit_notes
    for each row execute function dealflow.touch_updated_at();
create index credit_notes_customer_idx on dealflow.credit_notes (customer_id, created_at desc);
create index credit_notes_subscription_idx on dealflow.credit_notes (subscription_id);

create table dealflow.credit_allocations (
    id             uuid primary key,
    credit_note_id uuid not null references dealflow.credit_notes (id),
    invoice_id     uuid not null references dealflow.invoices (id),
    amount_minor   bigint not null check (amount_minor > 0),
    created_at     timestamptz not null default now(),
    constraint credit_allocations_uq unique (credit_note_id, invoice_id)
);
create index credit_allocations_invoice_idx on dealflow.credit_allocations (invoice_id);

-- A refund is a recorded outbound payment. It can never exceed money actually
-- received, so it is always backed by an eligible credit-note balance.
create table dealflow.refunds (
    id                     uuid primary key,
    reference              text not null unique,
    customer_id            uuid not null references dealflow.customers (id),
    credit_note_id         uuid not null references dealflow.credit_notes (id),
    currency               varchar(3) not null,
    amount_minor           bigint not null check (amount_minor > 0),
    method                 text not null,
    external_reference     text,
    note                   text,
    recorded_by_profile_id uuid references dealflow.profiles (id),
    recorded_at            timestamptz not null default now(),
    created_at             timestamptz not null default now()
);
create index refunds_customer_idx on dealflow.refunds (customer_id, recorded_at desc);

alter table dealflow.subscription_changes
    add constraint subscription_changes_invoice_fk
        foreign key (adjustment_invoice_id) references dealflow.invoices (id);
alter table dealflow.subscription_changes
    add constraint subscription_changes_credit_fk
        foreign key (credit_note_id) references dealflow.credit_notes (id);
