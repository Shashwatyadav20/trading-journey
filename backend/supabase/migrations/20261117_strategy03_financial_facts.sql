-- PHASE 6.4.1: Strategy 03 Authoritative Financial Facts Table
-- Strictly research-only storage for extracted/normalized Ind-AS financial facts.

create table if not exists public.strategy03_financial_facts (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  symbol text not null,
  bse_code text,
  statement_scope text not null check (statement_scope in ('CONSOLIDATED', 'STANDALONE')),
  period_type text not null check (period_type in ('Q1', 'Q2', 'Q3', 'Q4', 'H1', 'M9', 'ANNUAL')),
  financial_year text not null,
  reporting_period date not null,
  filing_date date,
  version integer not null default 1 check (version >= 1),
  is_restated boolean not null default false,
  is_derived_quarterly boolean not null default false,

  -- Normalized monetary metrics in INR Crores
  revenue_cr numeric,
  ebitda_cr numeric,
  operating_profit_cr numeric,
  pbt_cr numeric,
  net_profit_cr numeric,
  eps_inr numeric,
  interest_expense_cr numeric,
  depreciation_cr numeric,
  total_debt_cr numeric,
  cash_and_equivalents_cr numeric,
  equity_cr numeric,
  cfo_cr numeric,
  capex_cr numeric,
  fcf_cr numeric,

  -- Source & Extraction Provenance
  source_name text not null,
  source_filing_id text,
  source_url text,
  extracted_file_name text,
  extraction_method text not null check (extraction_method in ('XBRL_XML', 'PDF_ONLY_NO_XML', 'OFFICIAL_JSON', 'THIRD_PARTY_FALLBACK')),
  verification_status text not null check (verification_status in ('VERIFIED', 'UNVERIFIED', 'MISSING', 'STALE', 'CONFLICTED')),
  has_source_conflict boolean not null default false,
  conflict_notes jsonb not null default '[]'::jsonb,
  confidence numeric not null default 0 check (confidence >= 0 and confidence <= 1),
  raw_context_summary jsonb not null default '{}'::jsonb,
  retrieved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint strategy03_financial_facts_versioned_uk unique (symbol, statement_scope, period_type, reporting_period, version)
);

create index if not exists idx_strategy03_fin_facts_symbol_period
  on public.strategy03_financial_facts (symbol, reporting_period desc);

create index if not exists idx_strategy03_fin_facts_bse_code
  on public.strategy03_financial_facts (bse_code);

create index if not exists idx_strategy03_fin_facts_verification
  on public.strategy03_financial_facts (verification_status, extraction_method);

create index if not exists idx_strategy03_fin_facts_filing_id
  on public.strategy03_financial_facts (source_filing_id);

alter table public.strategy03_financial_facts enable row level security;

drop policy if exists "strategy03_financial_facts_service_role_all" on public.strategy03_financial_facts;
create policy "strategy03_financial_facts_service_role_all"
  on public.strategy03_financial_facts
  for all
  to service_role
  using (true)
  with check (true);

