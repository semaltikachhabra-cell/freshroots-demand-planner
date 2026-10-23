-- Applied to Supabase project irwfhlsmmtuhlkgfvixp (ap-south-1). Kept here for reference.
-- datasets: the latest uploaded CSV per kind. decisions: Raghav's current decision per SKU per inventory date.
-- decision_log: append-only audit trail written by trigger. runs: one row per upload / reset / export.
create table public.datasets (kind text primary key check (kind in ('sales','inventory','skus','calendar','distributors')), filename text not null, csv text not null check (length(csv) < 2000000), uploaded_at timestamptz not null default now());
create table public.decisions (as_of date not null, sku_id text not null, status text not null check (status in ('approved','override','rejected')), qty integer check (qty >= 0), recommended_qty integer, action text, decided_by text, decided_at timestamptz not null default now(), primary key (as_of, sku_id));
create table public.decision_log (id bigint generated always as identity primary key, as_of date not null, sku_id text not null, status text not null, qty integer, recommended_qty integer, action text, decided_by text, logged_at timestamptz not null default now());
create table public.runs (id bigint generated always as identity primary key, as_of date not null, festival boolean not null, source text not null, config jsonb not null default '{}'::jsonb, summary jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
-- trigger function log_decision() (security definer) copies every insert/update/delete on decisions into decision_log.
-- RLS is on for all four tables. With no login in this demo, the anon (publishable) key may read/write datasets and decisions,
-- insert/read runs, and only read decision_log.
