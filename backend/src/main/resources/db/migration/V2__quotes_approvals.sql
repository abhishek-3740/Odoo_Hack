-- =============================================================================
-- DealFlow360 :: V2 quotations, revisions, approvals, negotiation
--
-- Versioning contract (Implementation Plan section 6):
--  * A quote is a container. Every commercial fact lives on a REVISION.
--  * Submitting freezes prices, costs, tax and the policy version onto the
--    revision. Changing any commercial term creates a NEW revision and clears
--    that revision's acceptance and approval state; the old revision keeps its
--    own decisions as history.
--  * `commercial_hash` is what the customer actually accepted. Acceptance of a
--    hash that is no longer current is refused rather than reinterpreted.
-- =============================================================================

create table dealflow.quotes (
    id                      uuid primary key,
    reference               text not null unique,
    customer_id             uuid not null references dealflow.customers (id),
    owner_profile_id        uuid not null references dealflow.profiles (id),
    team_id                 uuid references dealflow.teams (id),
    title                   text,
    current_revision_id     uuid,
    stage                   text not null check (stage in
        ('DRAFT', 'REVIEW', 'SENT', 'UNDER_NEGOTIATION', 'CONFIRMED', 'CANCELED', 'LOST', 'EXPIRED')),
    valid_until             date,
    -- E21/E22: activity and progress are deliberately different clocks.
    -- `last_activity_at`  -- any edit or comment (used for churn display only)
    -- `last_progress_at`  -- customer response / valid approver decision only
    -- `awaiting_external_since` -- survives revision loops; a rep's own edits
    --                             must not restart the external waiting window.
    last_activity_at        timestamptz not null default now(),
    last_progress_at        timestamptz not null default now(),
    awaiting_external_since timestamptz,
    revision_count          int not null default 0,
    row_version             bigint not null default 0,
    created_at              timestamptz not null default now(),
    updated_at              timestamptz not null default now()
);
create trigger quotes_touch before update on dealflow.quotes
    for each row execute function dealflow.touch_updated_at();
create index quotes_owner_stage_idx on dealflow.quotes (owner_profile_id, stage);
create index quotes_customer_idx on dealflow.quotes (customer_id, stage);
create index quotes_team_idx on dealflow.quotes (team_id, stage);
create index quotes_activity_idx on dealflow.quotes (last_progress_at) where stage not in
    ('CONFIRMED', 'CANCELED', 'LOST', 'EXPIRED');
create index quotes_created_idx on dealflow.quotes (created_at desc);

create table dealflow.quote_revisions (
    id                        uuid primary key,
    quote_id                  uuid not null references dealflow.quotes (id),
    revision_no               int not null,
    source                    text not null check (source in ('SELLER', 'CUSTOMER_COUNTER', 'SYSTEM')),
    status                    text not null check (status in ('DRAFT', 'SUBMITTED', 'SUPERSEDED', 'CANCELED')),
    currency                  varchar(3) not null,

    order_discount_bp         int not null default 0 check (order_discount_bp between 0 and 9999),

    -- Frozen policy the revision was evaluated against.
    policy_version_no         int,
    policy_snapshot           jsonb,
    risk_result               jsonb,

    approval_status           text not null default 'NOT_EVALUATED' check (approval_status in
        ('NOT_EVALUATED', 'NOT_REQUIRED', 'PENDING_MANAGER', 'PENDING_FINANCE',
         'APPROVED', 'REJECTED', 'REVISION_REQUIRED')),
    required_level            text not null default 'NONE'
        check (required_level in ('NONE', 'MANAGER', 'MANAGER_FINANCE')),

    commercial_hash           text,

    -- Totals are stored per metric. One-time money, recurring money and the
    -- comparison contribution are different numbers and are never added into a
    -- single "total" field (section 5.2).
    one_time_net_minor        bigint not null default 0,
    one_time_tax_minor        bigint not null default 0,
    one_time_cost_minor       bigint not null default 0,
    recurring_first_cycle_net_minor  bigint not null default 0,
    recurring_first_cycle_tax_minor  bigint not null default 0,
    recurring_first_cycle_cost_minor bigint not null default 0,
    contribution_minor        bigint not null default 0,
    margin_percent            numeric(9, 4),
    total_base_minor          bigint not null default 0,
    total_discount_minor      bigint not null default 0,

    -- Terms the customer actually accepts, snapshotted with the revision.
    backorder_terms           text not null default 'ALLOW_BACKORDER'
        check (backorder_terms in ('ALLOW_BACKORDER', 'IN_STOCK_ONLY')),
    invoicing_terms           text not null default 'ON_CONFIRMATION'
        check (invoicing_terms in ('ON_CONFIRMATION')),
    requested_activation_date date,

    submitted_at              timestamptz,
    seller_adopted_at         timestamptz,
    seller_adopted_by         uuid references dealflow.profiles (id),
    customer_accepted_at      timestamptz,
    customer_accepted_by      uuid references dealflow.profiles (id),
    customer_accepted_hash    text,

    created_by_profile_id     uuid references dealflow.profiles (id),
    created_at                timestamptz not null default now(),
    updated_at                timestamptz not null default now(),

    constraint quote_revisions_no_uq unique (quote_id, revision_no)
);
create trigger quote_revisions_touch before update on dealflow.quote_revisions
    for each row execute function dealflow.touch_updated_at();
create index quote_revisions_quote_idx on dealflow.quote_revisions (quote_id, revision_no desc);
create index quote_revisions_approval_idx on dealflow.quote_revisions (approval_status)
    where approval_status in ('PENDING_MANAGER', 'PENDING_FINANCE');

alter table dealflow.quotes
    add constraint quotes_current_revision_fk
        foreign key (current_revision_id) references dealflow.quote_revisions (id);

create table dealflow.quote_lines (
    id                        uuid primary key,
    revision_id               uuid not null references dealflow.quote_revisions (id) on delete cascade,
    -- Stable across revisions so a comment or counteroffer can address "the
    -- same line" even after the commercial terms changed.
    line_key                  text not null,
    position                  int not null,
    line_kind                 text not null check (line_kind in ('ONE_TIME', 'RECURRING')),

    product_id                uuid not null references dealflow.products (id),
    category_id               uuid not null references dealflow.categories (id),
    variant_id                uuid references dealflow.product_variants (id),
    plan_id                   uuid references dealflow.subscription_plans (id),
    description               text not null,

    quantity                  numeric(18, 3) not null check (quantity > 0),
    unit_price_minor          bigint not null check (unit_price_minor >= 0),
    unit_cost_minor           bigint not null check (unit_cost_minor >= 0),
    tax_rate_bp               int not null default 0 check (tax_rate_bp between 0 and 10000),

    line_discount_bp          int not null default 0 check (line_discount_bp between 0 and 9999),
    applied_order_discount_bp int not null default 0 check (applied_order_discount_bp between 0 and 9999),
    -- 1 - (1-line)(1-order). A 10% + 10% stack is 1900 bp, not 2000 bp.
    effective_discount_bp     int not null default 0 check (effective_discount_bp between 0 and 9999),

    base_minor                bigint not null default 0,
    net_minor                 bigint not null,
    tax_minor                 bigint not null default 0,
    cost_total_minor          bigint not null default 0,
    margin_minor              bigint not null default 0,

    interval_months           int check (interval_months in (1, 3, 12)),
    requires_stock            boolean not null default false,
    promised_date             date,
    source                    text not null default 'MANUAL'
        check (source in ('MANUAL', 'RECOMMENDATION', 'COUNTER', 'SCENARIO')),
    created_at                timestamptz not null default now(),

    constraint quote_lines_key_uq unique (revision_id, line_key),
    -- E03: this build refuses a line that nets to zero. Margin percent at zero
    -- revenue is undefined, not zero, so it must never reach risk routing.
    constraint quote_lines_positive_net_ck check (net_minor > 0),
    constraint quote_lines_recurring_shape_ck check (
        (line_kind = 'RECURRING' and plan_id is not null and interval_months is not null)
            or (line_kind = 'ONE_TIME' and plan_id is null and interval_months is null)
    ),
    constraint quote_lines_stock_shape_ck check (not requires_stock or variant_id is not null)
);
create index quote_lines_revision_idx on dealflow.quote_lines (revision_id, position);
create index quote_lines_variant_idx on dealflow.quote_lines (variant_id);

-- -----------------------------------------------------------------------------
-- Approvals
-- -----------------------------------------------------------------------------
-- One row per (revision, step). Step 1 is Manager, step 2 is Finance. Finance
-- can never be decided while step 1 is still PENDING; the uniqueness constraint
-- plus an aggregate lock makes a terminal decision immutable (E05).
create table dealflow.approval_requests (
    id                           uuid primary key,
    quote_id                     uuid not null references dealflow.quotes (id),
    revision_id                  uuid not null references dealflow.quote_revisions (id),
    step                         int not null check (step in (1, 2)),
    required_role                text not null check (required_role in ('MANAGER', 'FINANCE')),
    team_id                      uuid references dealflow.teams (id),
    assignee_profile_id          uuid references dealflow.profiles (id),
    original_assignee_profile_id uuid references dealflow.profiles (id),
    due_at                       timestamptz,
    status                       text not null check (status in
        ('PENDING', 'APPROVED', 'REJECTED', 'REVISION_REQUIRED', 'SUPERSEDED')),
    reasons                      jsonb not null default '[]'::jsonb,
    decided_by_profile_id        uuid references dealflow.profiles (id),
    decided_at                   timestamptz,
    decision_reason              text,
    reassignment_reason          text,
    row_version                  bigint not null default 0,
    created_at                   timestamptz not null default now(),
    updated_at                   timestamptz not null default now(),

    constraint approval_requests_step_uq unique (revision_id, step),
    constraint approval_requests_step_role_ck check (
        (step = 1 and required_role = 'MANAGER') or (step = 2 and required_role = 'FINANCE')
    ),
    constraint approval_requests_decision_ck check (
        (status = 'PENDING' and decided_at is null)
            or (status <> 'PENDING')
    )
);
create trigger approval_requests_touch before update on dealflow.approval_requests
    for each row execute function dealflow.touch_updated_at();
create index approval_requests_queue_idx on dealflow.approval_requests (required_role, status, due_at)
    where status = 'PENDING';
create index approval_requests_assignee_idx on dealflow.approval_requests (assignee_profile_id, status);
create index approval_requests_quote_idx on dealflow.approval_requests (quote_id);

-- -----------------------------------------------------------------------------
-- Customer negotiation
-- -----------------------------------------------------------------------------
create table dealflow.negotiation_requests (
    id                     uuid primary key,
    quote_id               uuid not null references dealflow.quotes (id),
    revision_id            uuid not null references dealflow.quote_revisions (id),
    -- Populated for CHANGE/COUNTER: the candidate revision holding the
    -- customer's proposed terms. A comment never creates one.
    candidate_revision_id  uuid references dealflow.quote_revisions (id),
    actor_profile_id       uuid not null references dealflow.profiles (id),
    line_key               text,
    request_type           text not null check (request_type in ('COMMENT', 'CHANGE', 'COUNTER')),
    payload                jsonb not null default '{}'::jsonb,
    message                text,
    status                 text not null check (status in
        ('OPEN', 'ANSWERED', 'ADOPTED', 'DECLINED', 'SUPERSEDED')),
    response_message       text,
    responded_by_profile_id uuid references dealflow.profiles (id),
    responded_at           timestamptz,
    created_at             timestamptz not null default now(),
    updated_at             timestamptz not null default now(),

    constraint negotiation_requests_candidate_ck check (
        request_type = 'COMMENT' or candidate_revision_id is not null
    )
);
create trigger negotiation_requests_touch before update on dealflow.negotiation_requests
    for each row execute function dealflow.touch_updated_at();
create index negotiation_requests_quote_idx on dealflow.negotiation_requests (quote_id, created_at desc);
create index negotiation_requests_open_idx on dealflow.negotiation_requests (status) where status = 'OPEN';

-- A dismissal sticks to the revision it was made on, so the panel does not keep
-- re-proposing something the rep already rejected for this version of the deal.
create table dealflow.recommendation_dismissals (
    id               uuid primary key,
    quote_id         uuid not null references dealflow.quotes (id),
    revision_id      uuid not null references dealflow.quote_revisions (id) on delete cascade,
    variant_id       uuid not null references dealflow.product_variants (id),
    actor_profile_id uuid not null references dealflow.profiles (id),
    created_at       timestamptz not null default now(),
    constraint recommendation_dismissals_uq unique (revision_id, variant_id)
);
