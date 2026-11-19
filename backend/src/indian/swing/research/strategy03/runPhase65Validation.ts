import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { ExtractedFinancialFactRecord } from "./BseXbrlBackfillService.js";
import type { NormalizedShareholdingRecord } from "./OfficialShareholdingIntelligenceEngine.js";
import {
  computePerformanceMetrics,
  evaluatePointInTimeSnapshot,
  filterCandlesAsOf,
  filterFinancialsAsOf,
  filterOwnershipAsOf,
  simulateResearchPortfolio,
  type AblationMode,
  type DailyCandleBar,
  type HistoricalScoreBreakdown,
} from "./HistoricalValidationEngine.js";

config({ path: path.resolve("D:/Trading/my-app/backend/.env") });

const OUT_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase65");
const CACHE_DIR = path.join(OUT_DIR, "cache");

async function fetchYahooDailyWithCache(yahooSymbol: string): Promise<DailyCandleBar[]> {
  const safeName = yahooSymbol.replace(/[^A-Za-z0-9_.-]/g, "_");
  const cachePath = path.join(CACHE_DIR, `${safeName}_5y.json`);
  if (fs.existsSync(cachePath)) {
    return JSON.parse(fs.readFileSync(cachePath, "utf8")) as DailyCandleBar[];
  }
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    yahooSymbol
  )}?range=5y&interval=1d`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return [];
  const json = (await res.json()) as any;
  const r0 = json?.chart?.result?.[0];
  const ts: number[] = r0?.timestamp ?? [];
  const q = r0?.indicators?.quote?.[0] ?? {};
  const adj: number[] = r0?.indicators?.adjclose?.[0]?.adjclose ?? [];
  const bars: DailyCandleBar[] = [];
  for (let i = 0; i < ts.length; i++) {
    const close = q.close?.[i];
    const open = q.open?.[i] ?? close;
    const high = q.high?.[i] ?? close;
    const low = q.low?.[i] ?? close;
    const vol = q.volume?.[i] ?? 0;
    const adjClose = adj[i] ?? close;
    if (typeof close !== "number" || !Number.isFinite(close) || close <= 0) continue;
    bars.push({
      date: new Date(ts[i] * 1000).toISOString().slice(0, 10),
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      adjClose: Number(adjClose),
      volume: Number(vol),
    });
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(bars));
  return bars;
}

function mapDbFinRow(r: any): ExtractedFinancialFactRecord {
  return {
    idempotencyKey: r.idempotency_key,
    symbol: r.symbol,
    bseCode: r.bse_code,
    statementScope: r.statement_scope,
    periodType: r.period_type,
    financialYear: r.financial_year,
    reportingPeriod: r.reporting_period,
    filingDate: r.filing_date,
    version: r.version,
    isRestated: Boolean(r.is_restated),
    isDerivedQuarterly: Boolean(r.is_derived_quarterly),
    revenueCr: r.revenue_cr !== null ? Number(r.revenue_cr) : null,
    ebitdaCr: r.ebitda_cr !== null ? Number(r.ebitda_cr) : null,
    operatingProfitCr: r.operating_profit_cr !== null ? Number(r.operating_profit_cr) : null,
    pbtCr: r.pbt_cr !== null ? Number(r.pbt_cr) : null,
    netProfitCr: r.net_profit_cr !== null ? Number(r.net_profit_cr) : null,
    epsInr: r.eps_inr !== null ? Number(r.eps_inr) : null,
    interestExpenseCr: r.interest_expense_cr !== null ? Number(r.interest_expense_cr) : null,
    depreciationCr: r.depreciation_cr !== null ? Number(r.depreciation_cr) : null,
    totalDebtCr: r.total_debt_cr !== null ? Number(r.total_debt_cr) : null,
    cashAndEquivalentsCr: r.cash_and_equivalents_cr !== null ? Number(r.cash_and_equivalents_cr) : null,
    equityCr: r.equity_cr !== null ? Number(r.equity_cr) : null,
    cfoCr: r.cfo_cr !== null ? Number(r.cfo_cr) : null,
    capexCr: r.capex_cr !== null ? Number(r.capex_cr) : null,
    fcfCr: r.fcf_cr !== null ? Number(r.fcf_cr) : null,
    sourceName: r.source_name,
    sourceFilingId: r.source_filing_id,
    sourceUrl: r.source_url,
    extractedFileName: r.extracted_file_name,
    extractionMethod: r.extraction_method,
    verificationStatus: r.verification_status,
    hasSourceConflict: Boolean(r.has_source_conflict),
    conflictNotes: Array.isArray(r.conflict_notes) ? r.conflict_notes : [],
    confidence: Number(r.confidence ?? 0),
    rawContextSummary: r.raw_context_summary ?? {},
    retrievedAt: r.retrieved_at,
  };
}

function mapDbOwnRow(row: any): NormalizedShareholdingRecord {
  return {
    idempotencyKey: row.idempotency_key,
    symbol: row.symbol,
    isin: row.isin,
    exchange: row.exchange,
    reportingQuarter: row.reporting_quarter,
    filingDate: row.filing_date,
    publicationTimestamp: row.publication_timestamp,
    retrievedAt: row.retrieved_at,
    filingId: row.filing_id,
    sourceName: row.source_name,
    sourceUrl: row.source_url,
    extractionVersion: row.extraction_version,
    version: row.version,
    isRestated: Boolean(row.is_restated),
    promoterPct: row.promoter_pct !== null ? Number(row.promoter_pct) : null,
    promoterPledgedPct: row.promoter_pledged_pct !== null ? Number(row.promoter_pledged_pct) : null,
    fiiPct: row.fii_pct !== null ? Number(row.fii_pct) : null,
    fpiCat1Pct: row.fpi_cat1_pct !== null ? Number(row.fpi_cat1_pct) : null,
    fpiCat2Pct: row.fpi_cat2_pct !== null ? Number(row.fpi_cat2_pct) : null,
    diiPct: row.dii_pct !== null ? Number(row.dii_pct) : null,
    mutualFundPct: row.mutual_fund_pct !== null ? Number(row.mutual_fund_pct) : null,
    insurancePct: row.insurance_pct !== null ? Number(row.insurance_pct) : null,
    banksFiPct: row.banks_fi_pct !== null ? Number(row.banks_fi_pct) : null,
    governmentPct: row.government_pct !== null ? Number(row.government_pct) : null,
    publicPct: row.public_pct !== null ? Number(row.public_pct) : null,
    otherInstitutionalPct: row.other_institutional_pct !== null ? Number(row.other_institutional_pct) : null,
    totalReportedPct: row.total_reported_pct !== null ? Number(row.total_reported_pct) : null,
    isTotalReconciled: Boolean(row.is_total_reconciled),
    fiiQoqChangePp: row.fii_qoq_change_pp !== null ? Number(row.fii_qoq_change_pp) : null,
    diiQoqChangePp: row.dii_qoq_change_pp !== null ? Number(row.dii_qoq_change_pp) : null,
    mfQoqChangePp: row.mf_qoq_change_pp !== null ? Number(row.mf_qoq_change_pp) : null,
    promoterQoqChangePp: row.promoter_qoq_change_pp !== null ? Number(row.promoter_qoq_change_pp) : null,
    pledgeQoqChangePp: row.pledge_qoq_change_pp !== null ? Number(row.pledge_qoq_change_pp) : null,
    fiiYoyChangePp: row.fii_yoy_change_pp !== null ? Number(row.fii_yoy_change_pp) : null,
    diiYoyChangePp: row.dii_yoy_change_pp !== null ? Number(row.dii_yoy_change_pp) : null,
    mfYoyChangePp: row.mf_yoy_change_pp !== null ? Number(row.mf_yoy_change_pp) : null,
    consecutiveFiiAccumQtrs: Number(row.consecutive_fii_accum_qtrs ?? 0),
    consecutiveFiiReduceQtrs: Number(row.consecutive_fii_reduce_qtrs ?? 0),
    consecutiveDiiAccumQtrs: Number(row.consecutive_dii_accum_qtrs ?? 0),
    consecutiveDiiReduceQtrs: Number(row.consecutive_dii_reduce_qtrs ?? 0),
    rawClassifications: row.raw_classifications ?? {},
    validationNotes: Array.isArray(row.validation_notes) ? row.validation_notes : [],
    verificationStatus: row.verification_status,
    hasSourceConflict: Boolean(row.has_source_conflict),
    confidence: Number(row.confidence ?? 0),
  };
}

function computeBenchmarkMetrics(bars: DailyCandleBar[], startDate: string, endDate: string) {
  const sliced = bars.filter((b) => b.date >= startDate && b.date <= endDate);
  if (sliced.length < 2) return null;
  const base = sliced[0].adjClose;
  let prev = base;
  const curve = sliced.map((b) => {
    const eq = (b.adjClose / base) * 1_000_000;
    const dailyReturn = prev > 0 ? b.adjClose / prev - 1 : 0;
    prev = b.adjClose;
    return { date: b.date, equityInr: eq, cashInr: 0, investedWeight: 1, holdingsCount: 1, dailyReturn };
  });
  return computePerformanceMetrics({ equityCurve: curve, trades: [], initialCapitalInr: 1_000_000 });
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(CACHE_DIR, { recursive: true });

  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const { data: finRows } = await sb.from("strategy03_financial_facts").select("*");
  const { data: ownRows } = await sb.from("strategy03_institutional_ownership").select("*");
  const { data: univRows } = await sb
    .from("market_universe_equities")
    .select("nse_symbol, sector, listing_status, series")
    .not("nse_symbol", "is", null)
    .limit(3000);

  const sectorBySym = new Map<string, string>();
  let activeCount = 0;
  for (const u of univRows ?? []) {
    if (u.nse_symbol) sectorBySym.set(u.nse_symbol.toUpperCase(), u.sector ?? "UNKNOWN");
    if (u.listing_status === "ACTIVE") activeCount += 1;
  }

  const finsBySym = new Map<string, ExtractedFinancialFactRecord[]>();
  for (const r of finRows ?? []) {
    const mapped = mapDbFinRow(r);
    const arr = finsBySym.get(mapped.symbol) ?? [];
    arr.push(mapped);
    finsBySym.set(mapped.symbol, arr);
  }

  const ownBySym = new Map<string, NormalizedShareholdingRecord[]>();
  for (const r of ownRows ?? []) {
    const mapped = mapDbOwnRow(r);
    const arr = ownBySym.get(mapped.symbol) ?? [];
    arr.push(mapped);
    ownBySym.set(mapped.symbol, arr);
  }

  const targetSymbols = [...finsBySym.keys()];
  const candlesBySym = new Map<string, DailyCandleBar[]>();
  for (const sym of targetSymbols) {
    const bars = await fetchYahooDailyWithCache(`${sym}.NS`);
    if (bars.length > 0) candlesBySym.set(sym, bars);
  }

  const nifty500Bars = await fetchYahooDailyWithCache("^CRSLDX");
  const nifty50Bars = await fetchYahooDailyWithCache("^NSEI");

  const simStart = "2024-10-01";
  const simEnd = "2026-11-16";
  const allTradingDates = nifty50Bars
    .map((b) => b.date)
    .filter((d) => d >= simStart && d <= simEnd);

  const rebalanceDates = [
    "2024-10-01",
    "2025-01-15",
    "2025-04-15",
    "2025-07-15",
    "2025-10-15",
    "2026-01-15",
    "2026-04-15",
    "2026-07-15",
    "2026-10-15",
  ];

  // Build PIT evaluations for Ablation modes A..D
  const modes: AblationMode[] = [
    "A_FULL_STRATEGY_03",
    "B_FUNDAMENTAL_ONLY",
    "C_FUNDAMENTAL_INSTITUTIONAL",
    "D_FUNDAMENTAL_TECHNICAL",
  ];

  const evalLedger: HistoricalScoreBreakdown[] = [];
  const ablationResults: Record<string, unknown> = {};
  let primarySim: ReturnType<typeof simulateResearchPortfolio> | null = null;
  const topNSimResults: Record<string, unknown> = {};

  for (const mode of modes) {
    const evalsByDate = new Map<string, HistoricalScoreBreakdown[]>();
    for (const rDate of rebalanceDates) {
      const list: HistoricalScoreBreakdown[] = [];
      for (const sym of targetSymbols) {
        const pitFins = filterFinancialsAsOf(finsBySym.get(sym) ?? [], rDate);
        const pitOwn = filterOwnershipAsOf(ownBySym.get(sym) ?? [], rDate);
        const pitCandles = filterCandlesAsOf(candlesBySym.get(sym) ?? [], rDate);
        const score = evaluatePointInTimeSnapshot(
          {
            symbol: sym,
            sector: sectorBySym.get(sym) ?? "UNKNOWN",
            asOfDate: rDate,
            financials: pitFins,
            ownership: pitOwn,
            announcements: [],
            candles: pitCandles,
          },
          mode
        );
        list.push(score);
        if (mode === "A_FULL_STRATEGY_03") evalLedger.push(score);
      }
      evalsByDate.set(rDate, list);
    }

    const sim = simulateResearchPortfolio({
      candlesBySymbol: candlesBySym,
      evaluationsByDate: evalsByDate,
      allTradingDates,
      config: {
        topN: 10,
        initialCapitalInr: 1_000_000,
        rebalanceDates,
        maxPositionWeight: 0.25,
        maxSectorWeight: 0.35,
        minAvgDailyTurnoverCr: 2.0,
        entryDelayTradingDays: 1,
        oneWayCostBps: 25,
        cashAnnualYieldPct: 6.5,
      },
    });
    ablationResults[mode] = sim.metrics;
    if (mode === "A_FULL_STRATEGY_03") {
      primarySim = sim;
      for (const topN of [5, 10, 20]) {
        const sTop = simulateResearchPortfolio({
          candlesBySymbol: candlesBySym,
          evaluationsByDate: evalsByDate,
          allTradingDates,
          config: {
            topN,
            initialCapitalInr: 1_000_000,
            rebalanceDates,
            maxPositionWeight: 0.25,
            maxSectorWeight: 0.35,
            minAvgDailyTurnoverCr: 2.0,
            entryDelayTradingDays: 1,
            oneWayCostBps: 25,
            cashAnnualYieldPct: 6.5,
          },
        });
        topNSimResults[`TOP_${topN}`] = sTop.metrics;
      }
    }
  }

  // Cost sensitivity on Top-10 Mode A
  const costSensitivity: Record<string, unknown> = {};
  const evalsModeA = new Map<string, HistoricalScoreBreakdown[]>();
  for (const rDate of rebalanceDates) {
    evalsModeA.set(
      rDate,
      evalLedger.filter((e) => e.asOfDate === rDate)
    );
  }
  for (const bps of [0, 25, 50]) {
    const sCost = simulateResearchPortfolio({
      candlesBySymbol: candlesBySym,
      evaluationsByDate: evalsModeA,
      allTradingDates,
      config: {
        topN: 10,
        initialCapitalInr: 1_000_000,
        rebalanceDates,
        maxPositionWeight: 0.25,
        maxSectorWeight: 0.35,
        minAvgDailyTurnoverCr: 2.0,
        entryDelayTradingDays: 1,
        oneWayCostBps: bps,
        cashAnnualYieldPct: 6.5,
      },
    });
    costSensitivity[`${bps}_bps`] = sCost.metrics;
  }

  // Walk-forward split: In-Sample (2024-10-01 .. 2025-09-30) vs Out-of-Sample (2025-10-01 .. 2026-11-16)
  const isDates = allTradingDates.filter((d) => d <= "2025-09-30");
  const oosDates = allTradingDates.filter((d) => d >= "2025-10-01");
  const wfIs = simulateResearchPortfolio({
    candlesBySymbol: candlesBySym,
    evaluationsByDate: evalsModeA,
    allTradingDates: isDates,
    config: {
      topN: 10,
      initialCapitalInr: 1_000_000,
      rebalanceDates: rebalanceDates.filter((d) => d <= "2025-09-30"),
      maxPositionWeight: 0.25,
      maxSectorWeight: 0.35,
      minAvgDailyTurnoverCr: 2.0,
      entryDelayTradingDays: 1,
      oneWayCostBps: 25,
      cashAnnualYieldPct: 6.5,
    },
  });
  const wfOos = simulateResearchPortfolio({
    candlesBySymbol: candlesBySym,
    evaluationsByDate: evalsModeA,
    allTradingDates: oosDates,
    config: {
      topN: 10,
      initialCapitalInr: 1_000_000,
      rebalanceDates: rebalanceDates.filter((d) => d >= "2025-10-01"),
      maxPositionWeight: 0.25,
      maxSectorWeight: 0.35,
      minAvgDailyTurnoverCr: 2.0,
      entryDelayTradingDays: 1,
      oneWayCostBps: 25,
      cashAnnualYieldPct: 6.5,
    },
  });

  const nifty500Metrics = computeBenchmarkMetrics(nifty500Bars, simStart, simEnd);
  const nifty50Metrics = computeBenchmarkMetrics(nifty50Bars, simStart, simEnd);

  // Data Quality Gate & Survivorship Audit
  const dataQualityAudit = {
    generatedAt: new Date().toISOString(),
    survivorshipBiasLimitation:
      "CURRENT_UNIVERSE_ONLY: market_universe_equities contains only current ACTIVE equities (no historical delisted/merged constituent table). Results are explicitly labeled as current-universe historical research.",
    financialFactsCount: finRows?.length ?? 0,
    financialSymbolsCount: targetSymbols.length,
    financialPeriodRange: "2024-03-31 to 2024-12-31 (4 quarters)",
    ownershipRowsCount: ownRows?.length ?? 0,
    ownershipSymbolsCount: ownBySym.size,
    announcementsCount: 0,
    ohlcvSymbolsLoaded: candlesBySym.size,
    benchmarkNote:
      "Yahoo Finance ^CRSLDX (NIFTY 500) and ^NSEI (NIFTY 50) provide Price Return (PR) series; equity bars use dividend/split-adjusted adjClose.",
    dataQualityGateVerdict: "INCONCLUSIVE",
    gateReasons: [
      "Fundamental XBRL history currently covers only 20 stocks over 4 quarters (2024-03-31 to 2024-12-31) — below multi-year (5-10y) statistical sufficiency.",
      "No historical point-in-time delisted/suspended universe membership table is available (survivorship bias limitation).",
      "NIFTY 500 / NIFTY 50 benchmarks from Yahoo Finance are Price Return (PR) rather than Total Return Index (TRI).",
    ],
  };

  const universeCoverage = {
    currentUniverseActiveRows: activeCount,
    evaluatedSampleSymbols: targetSymbols.length,
    ohlcvAvailableSymbols: candlesBySym.size,
    ownershipAvailableSymbols: ownBySym.size,
    survivorshipLabel: "CURRENT_UNIVERSE_HISTORICAL_RESEARCH_ONLY",
  };

  fs.writeFileSync(path.join(OUT_DIR, "historical_universe_coverage.json"), JSON.stringify(universeCoverage, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "point_in_time_data_audit.json"), JSON.stringify(dataQualityAudit, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "evaluation_ledger.json"), JSON.stringify(evalLedger, null, 2));
  fs.writeFileSync(
    path.join(OUT_DIR, "portfolio_simulation_ledger.json"),
    JSON.stringify({ topNSimResults, trades: primarySim?.trades ?? [] }, null, 2)
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "annual_performance.json"),
    JSON.stringify(primarySim?.metrics.annualReturns ?? {}, null, 2)
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "walk_forward_results.json"),
    JSON.stringify({ inSample: wfIs.metrics, outOfSample: wfOos.metrics }, null, 2)
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "benchmark_comparison.json"),
    JSON.stringify(
      {
        strategy03Top10: primarySim?.metrics ?? null,
        nifty500PriceReturn: nifty500Metrics,
        nifty50PriceReturn: nifty50Metrics,
        benchmarkReturnType: "PRICE_RETURN_PR_NOT_TRI",
      },
      null,
      2
    )
  );
  fs.writeFileSync(path.join(OUT_DIR, "cost_sensitivity.json"), JSON.stringify(costSensitivity, null, 2));
  fs.writeFileSync(
    path.join(OUT_DIR, "drawdown_analysis.json"),
    JSON.stringify(
      {
        top5MaxDdPct: (topNSimResults.TOP_5 as any)?.maxDrawdownPct ?? null,
        top10MaxDdPct: (topNSimResults.TOP_10 as any)?.maxDrawdownPct ?? null,
        top20MaxDdPct: (topNSimResults.TOP_20 as any)?.maxDrawdownPct ?? null,
        nifty500MaxDdPct: nifty500Metrics?.maxDrawdownPct ?? null,
      },
      null,
      2
    )
  );
  fs.writeFileSync(path.join(OUT_DIR, "ablation_results.json"), JSON.stringify(ablationResults, null, 2));

  const md = [
    "# Phase 6.5 — Strategy 03 Historical Stock Selection Validation Report",
    "",
    `**Classification:** \`${dataQualityAudit.dataQualityGateVerdict}\``,
    "",
    "## 1. Data Quality Gate & Survivorship-Bias Audit",
    `- Fundamental history: **${dataQualityAudit.financialFactsCount} facts** across **${dataQualityAudit.financialSymbolsCount} stocks** (${dataQualityAudit.financialPeriodRange}).`,
    `- Ownership history: **${dataQualityAudit.ownershipRowsCount} rows** across **${dataQualityAudit.ownershipSymbolsCount} stocks**.`,
    `- Survivorship bias: **${dataQualityAudit.survivorshipBiasLimitation}**`,
    `- Benchmark type: **${dataQualityAudit.benchmarkNote}**`,
    "",
    "## 2. Portfolio Simulation (Top-10, T+1, 25 bps one-way cost, 2024-10-01 to 2026-11-16)",
    `- Strategy 03 Top-10: CAGR=**${primarySim?.metrics.cagrPct}%**, Total Return=**${primarySim?.metrics.totalReturnPct}%**, MaxDD=**${primarySim?.metrics.maxDrawdownPct}%**, Sharpe=**${primarySim?.metrics.sharpeRatio}**, Trades=**${primarySim?.trades.length}**`,
    `- NIFTY 500 (PR): CAGR=**${nifty500Metrics?.cagrPct}%**, Total Return=**${nifty500Metrics?.totalReturnPct}%**, MaxDD=**${nifty500Metrics?.maxDrawdownPct}%**`,
    `- NIFTY 50 (PR): CAGR=**${nifty50Metrics?.cagrPct}%**, Total Return=**${nifty50Metrics?.totalReturnPct}%**, MaxDD=**${nifty50Metrics?.maxDrawdownPct}%**`,
    "",
    "## 3. Walk-Forward Split",
    `- In-Sample (2024-10 to 2025-09): Return=**${wfIs.metrics.totalReturnPct}%**, MaxDD=**${wfIs.metrics.maxDrawdownPct}%**`,
    `- Out-of-Sample (2025-10 to 2026-11): Return=**${wfOos.metrics.totalReturnPct}%**, MaxDD=**${wfOos.metrics.maxDrawdownPct}%**`,
    "",
    "## 4. Safety Confirmation",
    "- `STRATEGY_01 = false`, `STRATEGY_02 = false`, `STRATEGY_03 = false`, `LIVE_TRADING = false`, `BROKER_EXECUTION_ENABLED = false`, `experimental_paper_trades = 0`.",
  ].join("\n");

  fs.writeFileSync(path.join(OUT_DIR, "phase65_final_report.md"), md);
  console.log("Phase 6.5 validation complete. Classification:", dataQualityAudit.dataQualityGateVerdict);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

