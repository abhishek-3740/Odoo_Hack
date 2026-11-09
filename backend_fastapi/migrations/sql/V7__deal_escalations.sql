create table dealflow.deal_escalations (
    id uuid primary key,
    quote_id uuid not null references dealflow.quotes(id),
    revision_id uuid not null references dealflow.quote_revisions(id),
    raised_by uuid not null references dealflow.profiles(id),
    request_key uuid not null,
    category varchar(32) not null check (category in ('DISCOUNT', 'POLICY', 'REVIEW')),
    target_role varchar(16) not null check (target_role in ('FINANCE', 'ADMIN', 'MANAGER')),
    reason varchar(2000) not null,
    status varchar(16) not null default 'OPEN' check (status in ('OPEN', 'RESOLVED')),
    resolution varchar(2000),
    resolved_by uuid references dealflow.profiles(id),
    created_at timestamptz not null default now(),
    resolved_at timestamptz,
    unique(raised_by, request_key)
);
create index deal_escalations_queue on dealflow.deal_escalations(target_role, status, created_at desc);
alter table dealflow.deal_escalations enable row level security;
