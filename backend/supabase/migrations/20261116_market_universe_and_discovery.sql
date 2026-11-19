-- Phase 9.6.12: Full NSE/BSE Market Universe, SEBI/AMFI Market-Cap Classification & Top 5 Discovery Engine
-- Read-only advisory research & market-wide discovery persistence with strict RLS on user-scoped scan history.

create table if not exists public.market_universe_equities (
  id uuid primary key default gen_random_uuid(),
  isin text not null unique,
  symbol text not null,
  company_name text not null,
  nse_symbol text,
  bse_code text,
  exchange text not null check (exchange in ('NSE', 'BSE', 'DUAL')),
  series text,
  listing_status text not null default 'ACTIVE' check (listing_status in ('ACTIVE', 'SUSPENDED', 'EXCLUDED')),
  sector text,
  industry text,
  sub_industry text,
  sector_source text,
  sector_verification_status text check (sector_verification_status in ('VERIFIED', 'UNVERIFIED')),
  sector_retrieved_at timestamptz,
  market_cap_cr numeric,
  market_cap_rank integer,
  market_cap_category text not null default 'UNCLASSIFIED' check (
    market_cap_category in ('LARGE_CAP', 'MID_CAP', 'SMALL_CAP', 'UNCLASSIFIED')
  ),
  amfi_matched boolean not null default false,
  amfi_period text,
  amfi_publication_date text,
  dynamic_cap_estimate_rank integer,
  dynamic_cap_estimate_category text check (
    dynamic_cap_estimate_category in ('LARGE_CAP', 'MID_CAP', 'SMALL_CAP', 'UNCLASSIFIED')
  ),
  classification_date timestamptz,
  classification_source text,
  source_provenance text not null,
  last_refreshed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_market_universe_symbol
  on public.market_universe_equities (symbol);

create index if not exists idx_market_universe_cap_sector
  on public.market_universe_equities (market_cap_category, sector, industry);

create table if not exists public.market_universe_excluded (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  isin text,
  exchange text not null check (exchange in ('NSE', 'BSE')),
  series text,
  instrument_type text not null,
  exclusion_reason text not null,
  raw_name text,
  detected_at timestamptz not null default now()
);

create table if not exists public.market_universe_refresh_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null check (status in ('RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED')),
  total_eligible integer not null default 0,
  nse_count integer not null default 0,
  bse_count integer not null default 0,
  dual_count integer not null default 0,
  excluded_count integer not null default 0,
  small_cap_count integer not null default 0,
  mid_cap_count integer not null default 0,
  large_cap_count integer not null default 0,
  missing_sector_count integer not null default 0,
  source_limitations jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.market_discovery_scans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED')),
  scan_completeness text not null default 'PARTIAL_SCAN' check (
    scan_completeness in ('COMPLETE_SCAN', 'PARTIAL_SCAN')
  ),
  published_final_top5 boolean not null default false,
  completion_pct numeric not null default 0,
  filters jsonb not null default '{}'::jsonb,
  total_universe_count integer not null default 0,
  scanned_count integer not null default 0,
  succeeded_count integer not null default 0,
  failed_count integer not null default 0,
  cursor_offset integer not null default 0,
  failed_symbols jsonb not null default '[]'::jsonb,
  top_picks jsonb not null default '[]'::jsonb,
  methodology_version text not null default 'PHASE_9_6_12_V1',
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_market_discovery_scans_user_started
  on public.market_discovery_scans (user_id, started_at desc);

alter table public.market_discovery_scans enable row level security;

drop policy if exists "market_discovery_scans_select_own" on public.market_discovery_scans;
create policy "market_discovery_scans_select_own"
  on public.market_discovery_scans
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "market_discovery_scans_insert_own" on public.market_discovery_scans;
create policy "market_discovery_scans_insert_own"
  on public.market_discovery_scans
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "market_discovery_scans_update_own" on public.market_discovery_scans;
create policy "market_discovery_scans_update_own"
  on public.market_discovery_scans
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

