# Strategy 03 — Phase 6.10.19.19: Statistical Performance & Out-of-Sample Validation Report

**Explicit Validation Verdict:** `INSUFFICIENT_SAMPLE`

> All 83 prospective READY signals are at T+0 (0 completed post-signal 4H blocks). Immature signals are strictly excluded from performance calculations; zero matured observations exist to evaluate breakout/invalidation rates, MFE/MAE, or statistical significance.

## 1. Pre-Flight Integrity, Render Deployment & Supabase Reconciliation
- **Phase 6.10.19.11–18 Artifacts Unchanged (SHA-256 Verified):** `true`
- **Immutable Snapshots Verified:** `83 / 83` (`allSnapshotsImmutable=true`)
- **Render Deployment Classification:** `RENDER_SERVICE_ONLINE_STALE_COMMIT_NOT_YET_DEPLOYED` (`renderProductionMonitoringClaimed=false`)
- **Supabase Persistence & Reconciliation:** `REMOTE_SYNCED` (`inSync=true`, Runs=`3==3`, States=`333==333`, Alerts=`579==579`)

## 2. Cohort Sample Maturity & Performance Metrics (Separated by Cohort)

| Cohort | Total Immutable | `T+0` (Excluded) | `1–4` Bars | `5B` | `10B` | `20B+` | Matured `>=1B` | Brk / Inv Rate (95% CI) | Mean / Med MFE & MAE | R/R Ratio | Bootstrap 95% CI | Cohort Verdict |
|---|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|---|
| **SHORT_HIGH_QUALITY** | 16 | 16 | 0 | 0 | 0 | 0 | 0 | `NULL (n=0)` | `NULL / NULL` | `NULL` | `N/A (n<5)` | `INSUFFICIENT_SAMPLE` |
| **MEDIUM_CLEAN** | 49 | 49 | 0 | 0 | 0 | 0 | 0 | `NULL (n=0)` | `NULL / NULL` | `NULL` | `N/A (n<5)` | `INSUFFICIENT_SAMPLE` |
| **LONG_CLEAN** | 18 | 18 | 0 | 0 | 0 | 0 | 0 | `NULL (n=0)` | `NULL / NULL` | `NULL` | `N/A (n<5)` | `INSUFFICIENT_SAMPLE` |
| **ALL_TRACKED_COHORTS** | **83** | **83** | **0** | **0** | **0** | **0** | **0** | `NULL (n=0)` | `NULL / NULL` | `NULL` | `N/A (n<5)` | `INSUFFICIENT_SAMPLE` |

## 3. Out-of-Sample Separation & Sensitivity Breakdown
- **Development Cut-Off (IST):** `2026-11-18T09:15:00.000+05:30`
- **Prospective Window Start (IST):** `2026-11-18T13:15:00.000+05:30`
- **Zero Look-Ahead Bias Verified:** `true` | **Thresholds Modified During Evaluation:** `false`
- **Score Tier Sensitivity (Captured vs. Matured):** SCORE_LT_75=54 (matured=0) · SCORE_GE_75=29 (matured=0)
- **Support Relevance Sensitivity (Captured vs. Matured):** SUPPORT_DISTANT_HISTORICAL=68 (matured=0) · SUPPORT_IMMEDIATE=15 (matured=0)

## 4. Safety-Lock Confirmation
- `STRATEGY_01 = false`, `STRATEGY_02 = false`, `STRATEGY_03 = false`, `LIVE_TRADING = false`, `BROKER_EXECUTION_ENABLED = false`, `Strategy03PaperIsolationConfig.enabled = false`, `experimental_paper_trades = 0`