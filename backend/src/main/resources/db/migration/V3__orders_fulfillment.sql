-- =============================================================================
-- DealFlow360 :: V3 orders, warehouses, stock, reservations, shipments
--
-- Stock correctness contract (Implementation Plan section 7.4):
--  * `available = on_hand - reserved`, and the table refuses to let either go
--    negative or let `reserved` exceed `on_hand`. These CHECKs are the last
--    line of defence behind the row locks, not a substitute for them.
--  * A preview allocation reserves nothing. Reservation happens once, inside
--    the finalisation transaction, after re-reading the rows under
--    `SELECT ... FOR UPDATE` in a stable (variant_id, warehouse_id) order.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Warehouses and stock
-- -----------------------------------------------------------------------------
create table dealflow.warehouses (
    id                          uuid primary key,
    code                        text not null unique,
    name                        text not null,
    location                    text,
    -- Configured estimates used by the allocation score. Not a courier quote.
    shipping_fixed_cost_minor   bigint not null default 0 check (shipping_fixed_cost_minor >= 0),
    shipping_cost_per_kg_minor  bigint not null default 0 check (shipping_cost_per_kg_minor >= 0),
    sort_order                  int not null default 0,
    is_active                   boolean not null default true,
    created_at                  timestamptz not null default now(),
    updated_at                  timestamptz not null default now()
);
create trigger warehouses_touch before update on dealflow.warehouses
    for each row execute function dealflow.touch_updated_at();

create table dealflow.stock_levels (
    id                    uuid primary key,
    warehouse_id          uuid not null references dealflow.warehouses (id),
    variant_id            uuid not null references dealflow.product_variants (id),
    on_hand               numeric(18, 3) not null default 0,
    reserved              numeric(18, 3) not null default 0,
    reorder_point         numeric(18, 3) not null default 0 check (reorder_point >= 0),
    target_qty            numeric(18, 3) not null default 0 check (target_qty >= 0),
    expected_receipt_date date,
    expected_receipt_qty  numeric(18, 3) check (expected_receipt_qty is null or expected_receipt_qty > 0),
    row_version           bigint not null default 0,
    created_at            timestamptz not null default now(),
    updated_at            timestamptz not null default now(),

    constraint stock_levels_uq unique (warehouse_id, variant_id),
    constraint stock_levels_on_hand_ck check (on_hand >= 0),
    constraint stock_levels_reserved_ck check (reserved >= 0),
    constraint stock_levels_no_oversell_ck check (reserved <= on_hand)
);
create trigger stock_levels_touch before update on dealflow.stock_levels
    for each row execute function dealflow.touch_updated_at();
create index stock_levels_variant_idx on dealflow.stock_levels (variant_id, warehouse_id);
-- Replenishment sweep: cheap scan for rows that dropped under their threshold.
create index stock_levels_reorder_idx on dealflow.stock_levels (variant_id)
    where reorder_point > 0;

-- Append-only physical inventory ledger. Reservations are NOT movements: they
-- hold stock without changing on_hand, and live in `reservations`.
create table dealflow.stock_movements (
    id               uuid primary key,
    variant_id       uuid not null references dealflow.product_variants (id),
    warehouse_id     uuid not null references dealflow.warehouses (id),
    quantity         numeric(18, 3) not null check (quantity <> 0),
    movement_type    text not null check (movement_type in ('RECEIPT', 'DISPATCH', 'ADJUSTMENT')),
    reference_type   text,
    reference_id     uuid,
    -- E11/T11: replaying a receipt with the same key must not add stock twice.
    request_key      text,
    note             text,
    actor_profile_id uuid references dealflow.profiles (id),
    occurred_at      timestamptz not null default now(),
    created_at       timestamptz not null default now(),

    constraint stock_movements_sign_ck check (
        (movement_type = 'RECEIPT' and quantity > 0)
            or (movement_type = 'DISPATCH' and quantity < 0)
            or movement_type = 'ADJUSTMENT'
    )
);
create unique index stock_movements_request_key_uq on dealflow.stock_movements (request_key)
    where request_key is not null;
create index stock_movements_variant_idx on dealflow.stock_movements (variant_id, warehouse_id, occurred_at desc);
create index stock_movements_reference_idx on dealflow.stock_movements (reference_type, reference_id);

-- -----------------------------------------------------------------------------
-- Orders
-- -----------------------------------------------------------------------------
-- Exactly one order per quote. That single UNIQUE constraint is what makes a
-- double-clicked customer acceptance safe (T13): the second transaction loses.
create table dealflow.orders (
    id                 uuid primary key,
    reference          text not null unique,
    quote_id           uuid not null unique references dealflow.quotes (id),
    revision_id        uuid not null references dealflow.quote_revisions (id),
    customer_id        uuid not null references dealflow.customers (id),
    owner_profile_id   uuid not null references dealflow.profiles (id),
    currency           varchar(3) not null,
    order_status       text not null check (order_status in ('CONFIRMED', 'CANCELED')),
    fulfillment_status text not null check (fulfillment_status in
        ('NOT_REQUIRED', 'UNALLOCATED', 'PARTIALLY_RESERVED', 'RESERVED',
         'PARTIALLY_DISPATCHED', 'DISPATCHED')),
    billing_status     text not null check (billing_status in ('PENDING', 'INITIALIZED')),
    backorder_terms    text not null check (backorder_terms in ('ALLOW_BACKORDER', 'IN_STOCK_ONLY')),
    one_time_net_minor bigint not null default 0,
    one_time_tax_minor bigint not null default 0,
    confirmed_at       timestamptz not null default now(),
    canceled_at        timestamptz,
    row_version        bigint not null default 0,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now()
);
create trigger orders_touch before update on dealflow.orders
    for each row execute function dealflow.touch_updated_at();
create index orders_customer_idx on dealflow.orders (customer_id, confirmed_at desc);
create index orders_owner_idx on dealflow.orders (owner_profile_id, confirmed_at desc);
create index orders_fulfillment_idx on dealflow.orders (fulfillment_status)
    where order_status = 'CONFIRMED';

-- Immutable commercial snapshot. Nothing here is ever edited after the order
-- exists; corrections go through an adjustment or a credit note.
create table dealflow.order_lines (
    id                    uuid primary key,
    order_id              uuid not null references dealflow.orders (id),
    quote_line_id         uuid not null references dealflow.quote_lines (id),
    line_key              text not null,
    position              int not null,
    line_kind             text not null check (line_kind in ('ONE_TIME', 'RECURRING')),

    product_id            uuid not null references dealflow.products (id),
    category_id           uuid not null references dealflow.categories (id),
    variant_id            uuid references dealflow.product_variants (id),
    plan_id               uuid references dealflow.subscription_plans (id),
    description           text not null,

    quantity              numeric(18, 3) not null check (quantity > 0),
    unit_price_minor      bigint not null check (unit_price_minor >= 0),
    unit_cost_minor       bigint not null check (unit_cost_minor >= 0),
    tax_rate_bp           int not null default 0,
    effective_discount_bp int not null default 0,
    net_minor             bigint not null check (net_minor > 0),
    tax_minor             bigint not null default 0,

    interval_months       int check (interval_months in (1, 3, 12)),
    requires_stock        boolean not null default false,
    promised_date         date,
    created_at            timestamptz not null default now(),

    constraint order_lines_key_uq unique (order_id, line_key),
    constraint order_lines_stock_shape_ck check (not requires_stock or variant_id is not null)
);
create index order_lines_order_idx on dealflow.order_lines (order_id, position);
create index order_lines_variant_idx on dealflow.order_lines (variant_id);

-- -----------------------------------------------------------------------------
-- Shipments, reservations, backorders
-- -----------------------------------------------------------------------------
create table dealflow.shipments (
    id                      uuid primary key,
    order_id                uuid not null references dealflow.orders (id),
    warehouse_id            uuid not null references dealflow.warehouses (id),
    status                  text not null check (status in ('DRAFT', 'RESERVED', 'DISPATCHED', 'CANCELED')),
    estimated_cost_minor    bigint not null default 0,
    dispatched_at           timestamptz,
    dispatched_by_profile_id uuid references dealflow.profiles (id),
    tracking_reference      text,
    created_at              timestamptz not null default now(),
    updated_at              timestamptz not null default now()
);
create trigger shipments_touch before update on dealflow.shipments
    for each row execute function dealflow.touch_updated_at();
-- At most one open shipment per (order, warehouse), so a replan after a stock
-- receipt consolidates into the existing unshipped shipment (T12) instead of
-- growing a second one for the same destination.
create unique index shipments_open_uq on dealflow.shipments (order_id, warehouse_id)
    where status in ('DRAFT', 'RESERVED');
create index shipments_order_idx on dealflow.shipments (order_id);

create table dealflow.shipment_lines (
    id            uuid primary key,
    shipment_id   uuid not null references dealflow.shipments (id) on delete cascade,
    order_line_id uuid not null references dealflow.order_lines (id),
    variant_id    uuid not null references dealflow.product_variants (id),
    quantity      numeric(18, 3) not null check (quantity > 0),
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),
    constraint shipment_lines_uq unique (shipment_id, order_line_id)
);
create trigger shipment_lines_touch before update on dealflow.shipment_lines
    for each row execute function dealflow.touch_updated_at();
create index shipment_lines_order_line_idx on dealflow.shipment_lines (order_line_id);

-- Tracks exactly the stock held for an order line and not yet dispatched.
-- Dispatch turns HELD into CONSUMED and decrements on_hand and reserved by the
-- same amount, in one movement.
create table dealflow.reservations (
    id               uuid primary key,
    order_id         uuid not null references dealflow.orders (id),
    order_line_id    uuid not null references dealflow.order_lines (id),
    shipment_line_id uuid references dealflow.shipment_lines (id) on delete set null,
    warehouse_id     uuid not null references dealflow.warehouses (id),
    variant_id       uuid not null references dealflow.product_variants (id),
    quantity         numeric(18, 3) not null check (quantity > 0),
    status           text not null check (status in ('HELD', 'CONSUMED', 'RELEASED')),
    consumed_at      timestamptz,
    released_at      timestamptz,
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now()
);
create trigger reservations_touch before update on dealflow.reservations
    for each row execute function dealflow.touch_updated_at();
create index reservations_line_idx on dealflow.reservations (order_line_id, status);
create index reservations_stock_idx on dealflow.reservations (variant_id, warehouse_id, status);
create index reservations_order_idx on dealflow.reservations (order_id, status);

-- A real, first-class shortage record. Never inferred from a status label, and
-- never given an invented expected date (E09).
create table dealflow.backorders (
    id            uuid primary key,
    order_id      uuid not null references dealflow.orders (id),
    order_line_id uuid not null references dealflow.order_lines (id),
    variant_id    uuid not null references dealflow.product_variants (id),
    quantity      numeric(18, 3) not null check (quantity > 0),
    expected_date date,
    status        text not null check (status in ('OPEN', 'RESOLVED', 'CANCELED')),
    resolved_at   timestamptz,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);
create trigger backorders_touch before update on dealflow.backorders
    for each row execute function dealflow.touch_updated_at();
create unique index backorders_open_uq on dealflow.backorders (order_line_id) where status = 'OPEN';
create index backorders_variant_idx on dealflow.backorders (variant_id, status);
create index backorders_order_idx on dealflow.backorders (order_id, status);
