-- PHASE 6.4.2: Strategy 03 Official Institutional Shareholding Intelligence Table
-- Strictly research-only storage for exchange-verified quarterly shareholding patterns.
-- Does not modify strategy03_shareholding_history or activate any trading strategy.

create table if not exists public.strategy03_institutional_ownership (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  symbol text not null,
  isin text,
  exchange text not null check (exchange in ('NSE', 'BSE')),
  reporting_quarter date not null,
  filing_date date,
  publication_timestamp timestamptz,
  retrieved_at timestamptz not null default now(),
  filing_id text,
  source_name text not null,
  source_url text not null,
  extraction_version text not null default '1.0.0',
  version integer not null default 1 check (version >= 1),
  is_restated boolean not null default false,

  -- Normalized ownership percentages (0..100, null if missing — never coerced to 0)
  promoter_pct numeric check (promoter_pct is null or (promoter_pct >= 0 and promoter_pct <= 100)),
  promoter_pledged_pct numeric check (promoter_pledged_pct is null or (promoter_pledged_pct >= 0 and promoter_pledged_pct <= 100)),
  fii_pct numeric check (fii_pct is null or (fii_pct >= 0 and fii_pct <= 100)),
  fpi_cat1_pct numeric check (fpi_cat1_pct is null or (fpi_cat1_pct >= 0 and fpi_cat1_pct <= 100)),
  fpi_cat2_pct numeric check (fpi_cat2_pct is null or (fpi_cat2_pct >= 0 and fpi_cat2_pct <= 100)),
  dii_pct numeric check (dii_pct is null or (dii_pct >= 0 and dii_pct <= 100)),
  mutual_fund_pct numeric check (mutual_fund_pct is null or (mutual_fund_pct >= 0 and mutual_fund_pct <= 100)),
  insurance_pct numeric check (insurance_pct is null or (insurance_pct >= 0 and insurance_pct <= 100)),
  banks_fi_pct numeric check (banks_fi_pct is null or (banks_fi_pct >= 0 and banks_fi_pct <= 100)),
  government_pct numeric check (government_pct is null or (government_pct >= 0 and government_pct <= 100)),
  public_pct numeric check (public_pct is null or (public_pct >= 0 and public_pct <= 100)),
  other_institutional_pct numeric check (other_institutional_pct is null or (other_institutional_pct >= 0 and other_institutional_pct <= 100)),
  total_reported_pct numeric,
  is_total_reconciled boolean not null default false,

  -- Historical trend metrics (percentage points)
  fii_qoq_change_pp numeric,
  dii_qoq_change_pp numeric,
  mf_qoq_change_pp numeric,
  promoter_qoq_change_pp numeric,
  pledge_qoq_change_pp numeric,
  fii_yoy_change_pp numeric,
  dii_yoy_change_pp numeric,
  mf_yoy_change_pp numeric,
  consecutive_fii_accum_qtrs integer not null default 0,
  consecutive_fii_reduce_qtrs integer not null default 0,
  consecutive_dii_accum_qtrs integer not null default 0,
  consecutive_dii_reduce_qtrs integer not null default 0,

  -- Provenance, raw taxonomy & validation
  raw_classifications jsonb not null default '{}'::jsonb,
  validation_notes jsonb not null default '[]'::jsonb,
  verification_status text not null check (verification_status in ('VERIFIED', 'UNVERIFIED', 'MISSING', 'STALE', 'CONFLICTED')),
  has_source_conflict boolean not null default false,
  confidence numeric not null default 0 check (confidence >= 0 and confidence <= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint strategy03_inst_own_versioned_uk unique (symbol, exchange, reporting_quarter, version)
);

create index if not exists idx_strategy03_inst_own_symbol_qtr
  on public.strategy03_institutional_ownership (symbol, reporting_quarter desc, version desc);

create index if not exists idx_strategy03_inst_own_status
  on public.strategy03_institutional_ownership (verification_status, reporting_quarter desc);

create index if not exists idx_strategy03_inst_own_filing
  on public.strategy03_institutional_ownership (filing_id);

alter table public.strategy03_institutional_ownership enable row level security;

drop policy if exists "strategy03_inst_own_service_role_all" on public.strategy03_institutional_ownership;
create policy "strategy03_inst_own_service_role_all"
  on public.strategy03_institutional_ownership
  for all
  to service_role
  using (true)
  with check (true);

