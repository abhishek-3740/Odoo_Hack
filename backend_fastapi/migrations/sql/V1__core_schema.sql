-- =============================================================================
-- DealFlow360 :: V1 core schema
-- Identity, organisation, catalogue, pricing and commercial policy.
--
-- Design notes (see docs/DealFlow360-Implementation-Plan.md sections 5 and 10):
--  * All business tables live in the `dealflow` schema. That schema is NOT in
--    the Supabase Data API `schemas` allow-list, so PostgREST never exposes it
--    to `anon`/`authenticated`. Authorisation is enforced in the Spring API.
--  * `dealflow.profiles.auth_user_id` mirrors `auth.users.id` but carries no
--    foreign key: the identity provider is external to this schema, and the
--    identical migrations must also apply to a bare PostgreSQL container used
--    by the integration tests. Removing a person is a profile deactivation,
--    never a delete, because commercial history must stay attributable.
--  * Money is persisted as BIGINT minor units (INR 10,000.00 -> 1000000).
--    Quantities are NUMERIC. Percentages are integer basis points (bp);
--    1500 bp = 15.00%.
-- =============================================================================

create schema if not exists dealflow;

-- Keeps updated_at honest even for native SQL writes that bypass Hibernate.
create or replace function dealflow.touch_updated_at() returns trigger as $$
begin
    new.updated_at := now();
    return new;
end;
$$ language plpgsql;

-- Human-readable document references. The UUID stays the technical key.
create sequence dealflow.quote_reference_seq start with 1000;
create sequence dealflow.order_reference_seq start with 1000;
create sequence dealflow.invoice_number_seq start with 1000;
create sequence dealflow.payment_reference_seq start with 1000;
create sequence dealflow.credit_note_reference_seq start with 1000;
create sequence dealflow.refund_reference_seq start with 1000;
create sequence dealflow.discount_policy_version_seq start with 1;

-- -----------------------------------------------------------------------------
-- Organisation
-- -----------------------------------------------------------------------------
create table dealflow.teams (
    id          uuid primary key,
    name        text not null unique,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);
create trigger teams_touch before update on dealflow.teams
    for each row execute function dealflow.touch_updated_at();

create table dealflow.customers (
    id                   uuid primary key,
    name                 text not null,
    tier                 text not null check (tier in ('BRONZE', 'SILVER', 'GOLD')),
    currency             varchar(3) not null default 'INR',
    contact_email        text,
    contact_phone        text,
    billing_address      text,
    owner_rep_profile_id uuid,
    is_active            boolean not null default true,
    created_at           timestamptz not null default now(),
    updated_at           timestamptz not null default now()
);
create trigger customers_touch before update on dealflow.customers
    for each row execute function dealflow.touch_updated_at();
create index customers_tier_idx on dealflow.customers (tier) where is_active;
create index customers_owner_idx on dealflow.customers (owner_rep_profile_id);

-- Application identity. Roles are server-controlled; a signup never chooses one.
create table dealflow.profiles (
    id                uuid primary key,
    -- Nullable: an administrator may provision a profile by email before the
    -- person signs in; the first verified token for that email binds it.
    auth_user_id      uuid unique,
    email             text not null unique,
    full_name         text,
    role              text not null check (role in ('REP', 'MANAGER', 'FINANCE', 'ADMIN', 'CUSTOMER')),
    team_id           uuid references dealflow.teams (id),
    customer_id       uuid references dealflow.customers (id),
    is_active         boolean not null default true,
    unavailable_until timestamptz,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),
    -- A portal identity is always bound to exactly one customer; an internal
    -- identity never is. This is the structural half of portal isolation.
    constraint profiles_customer_binding_ck check (
        (role = 'CUSTOMER' and customer_id is not null)
            or (role <> 'CUSTOMER' and customer_id is null)
    )
);
create trigger profiles_touch before update on dealflow.profiles
    for each row execute function dealflow.touch_updated_at();
create index profiles_role_idx on dealflow.profiles (role) where is_active;
create index profiles_team_idx on dealflow.profiles (team_id);
create index profiles_customer_idx on dealflow.profiles (customer_id);

alter table dealflow.customers
    add constraint customers_owner_rep_fk
        foreign key (owner_rep_profile_id) references dealflow.profiles (id);

-- Dated, role-qualified stand-ins for an unavailable approver (E07).
create table dealflow.approval_delegations (
    id                    uuid primary key,
    approver_role         text not null check (approver_role in ('MANAGER', 'FINANCE')),
    team_id               uuid references dealflow.teams (id),
    delegate_profile_id   uuid not null references dealflow.profiles (id),
    valid_from            timestamptz not null,
    valid_until           timestamptz not null,
    reason                text not null,
    created_by_profile_id uuid not null references dealflow.profiles (id),
    created_at            timestamptz not null default now(),
    updated_at            timestamptz not null default now(),
    constraint approval_delegations_window_ck check (valid_until > valid_from)
);
create trigger approval_delegations_touch before update on dealflow.approval_delegations
    for each row execute function dealflow.touch_updated_at();
create index approval_delegations_lookup_idx
    on dealflow.approval_delegations (approver_role, valid_from, valid_until);

-- -----------------------------------------------------------------------------
-- Catalogue
-- -----------------------------------------------------------------------------
create table dealflow.categories (
    id         uuid primary key,
    code       text not null unique,
    name       text not null,
    kind       text not null check (kind in ('HARDWARE', 'SERVICE', 'SUBSCRIPTION')),
    is_active  boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create trigger categories_touch before update on dealflow.categories
    for each row execute function dealflow.touch_updated_at();

create table dealflow.products (
    id               uuid primary key,
    category_id      uuid not null references dealflow.categories (id),
    code             text not null unique,
    name             text not null,
    description      text,
    unit             text not null default 'unit',
    base_price_minor bigint not null check (base_price_minor >= 0),
    base_cost_minor  bigint not null check (base_cost_minor >= 0),
    currency         varchar(3) not null default 'INR',
    tax_rate_bp      int not null default 0 check (tax_rate_bp between 0 and 10000),
    -- STOCK lines participate in warehouse allocation; NONE lines (services,
    -- subscription seats) bypass it entirely.
    fulfillment_kind text not null check (fulfillment_kind in ('STOCK', 'NONE')),
    charge_kind      text not null check (charge_kind in ('ONE_TIME', 'RECURRING')),
    quantity_mode    text not null default 'INTEGER' check (quantity_mode in ('INTEGER', 'DECIMAL')),
    promoted         boolean not null default false,
    is_active        boolean not null default true,
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now(),
    -- A recurring product is billed through a subscription plan and is never
    -- allocated from stock.
    constraint products_recurring_not_stocked_ck check (
        charge_kind = 'ONE_TIME' or fulfillment_kind = 'NONE'
    )
);
create trigger products_touch before update on dealflow.products
    for each row execute function dealflow.touch_updated_at();
create index products_category_idx on dealflow.products (category_id) where is_active;
create index products_promoted_idx on dealflow.products (promoted) where is_active;

create table dealflow.product_variants (
    id                 uuid primary key,
    product_id         uuid not null references dealflow.products (id),
    sku                text not null unique,
    name               text not null,
    attributes         jsonb not null default '{}'::jsonb,
    price_extra_minor  bigint not null default 0,
    -- NULL means "inherit the product base cost".
    cost_minor         bigint check (cost_minor >= 0),
    weight_grams       int not null default 0 check (weight_grams >= 0),
    -- Explicit equivalence set used by upsell/substitution. Generic co-purchase
    -- statistics may only ever ADD a complementary item, never swap one.
    substitution_group text,
    is_active          boolean not null default true,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now()
);
create trigger product_variants_touch before update on dealflow.product_variants
    for each row execute function dealflow.touch_updated_at();
create index product_variants_product_idx on dealflow.product_variants (product_id) where is_active;
create index product_variants_substitution_idx on dealflow.product_variants (substitution_group)
    where substitution_group is not null;

create table dealflow.price_rules (
    id               uuid primary key,
    variant_id       uuid not null references dealflow.product_variants (id),
    tier             text not null check (tier in ('BRONZE', 'SILVER', 'GOLD')),
    currency         varchar(3) not null,
    unit_price_minor bigint not null check (unit_price_minor >= 0),
    priority         int not null default 0,
    active_from      date not null,
    active_until     date,
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now(),
    constraint price_rules_window_ck check (active_until is null or active_until > active_from)
);
create trigger price_rules_touch before update on dealflow.price_rules
    for each row execute function dealflow.touch_updated_at();
-- Two rules may still overlap in time at the same priority; resolution rejects
-- that ambiguity at read time rather than silently picking one.
create unique index price_rules_slot_uq
    on dealflow.price_rules (variant_id, tier, currency, priority, active_from);
create index price_rules_lookup_idx on dealflow.price_rules (variant_id, tier, currency);

create table dealflow.subscription_plans (
    id                   uuid primary key,
    product_id           uuid not null references dealflow.products (id),
    code                 text not null unique,
    name                 text not null,
    interval_months      int not null check (interval_months in (1, 3, 12)),
    currency             varchar(3) not null default 'INR',
    interval_price_minor bigint not null check (interval_price_minor > 0),
    interval_cost_minor  bigint not null default 0 check (interval_cost_minor >= 0),
    tax_rate_bp          int not null default 0 check (tax_rate_bp between 0 and 10000),
    billing_anchor       text not null default 'ACTIVATION_DATE'
        check (billing_anchor in ('ACTIVATION_DATE', 'CALENDAR_MONTH_START')),
    proration_policy     text not null default 'IMMEDIATE_PRORATED'
        check (proration_policy in ('IMMEDIATE_PRORATED', 'NEXT_PERIOD')),
    cancellation_policy  text not null default 'END_OF_PERIOD'
        check (cancellation_policy in ('END_OF_PERIOD', 'IMMEDIATE_PRORATED')),
    -- E14: this build never claws back an accepted hardware discount when a
    -- bundled support plan is cancelled. Conditional recovery is a roadmap item
    -- that would need its own accepted-terms formula.
    clawback_policy      text not null default 'NONE' check (clawback_policy in ('NONE')),
    is_active            boolean not null default true,
    created_at           timestamptz not null default now(),
    updated_at           timestamptz not null default now()
);
create trigger subscription_plans_touch before update on dealflow.subscription_plans
    for each row execute function dealflow.touch_updated_at();
create index subscription_plans_product_idx on dealflow.subscription_plans (product_id) where is_active;

-- -----------------------------------------------------------------------------
-- Commercial policy (immutable versions)
-- -----------------------------------------------------------------------------
-- Editing policy publishes a NEW version. Submitted revisions keep the version
-- they were evaluated against, so a later configuration change can never
-- retroactively rewrite an approval decision that has already been made.
create table dealflow.discount_policies (
    id                    uuid primary key,
    version_no            int not null unique,
    definition            jsonb not null,
    effective_at          timestamptz not null,
    note                  text,
    created_by_profile_id uuid references dealflow.profiles (id),
    created_at            timestamptz not null default now()
);
create index discount_policies_effective_idx on dealflow.discount_policies (effective_at desc);

-- Singleton-ish key/value settings for engines that do not deserve a table.
create table dealflow.app_settings (
    key                   text primary key,
    value                 jsonb not null,
    updated_by_profile_id uuid references dealflow.profiles (id),
    updated_at            timestamptz not null default now()
);
