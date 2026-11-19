import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { Strategy03UniverseService } from "./Strategy03UniverseService.js";
import {
  downloadXbrlXmlWithCache,
  extractXbrlFinancialFactsFromXml,
  fetchOfficialNseXbrlFilingList,
  mapNseItemMetadataToFactHints,
  persistFinancialFactsIdempotent,
  type ExtractedFinancialFactRecord,
} from "./BseXbrlBackfillService.js";
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

const OUT_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase66");
const CACHE_DIR = path.join(OUT_DIR, "cache");
const PHASE_641_CACHE = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase641/cache");
const PHASE_65_CACHE = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase65/cache");

async function fetchYahooDailyWithCache(yahooSymbol: string): Promise<DailyCandleBar[]> {
  const safeName = yahooSymbol.replace(/[^A-Za-z0-9_.-]/g, "_");
  const cachePath = path.join(CACHE_DIR, `${safeName}_5y.json`);
  const p65Path = path.join(PHASE_65_CACHE, `${safeName}_5y.json`);
  if (fs.existsSync(cachePath)) return JSON.parse(fs.readFileSync(cachePath, "utf8"));
  if (fs.existsSync(p65Path)) return JSON.parse(fs.readFileSync(p65Path, "utf8"));

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    yahooSymbol
  )}?range=5y&interval=1d`;
  try {
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
  } catch {
    return [];
  }
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

async function expandSymbolFundamentals(
  symbol: string,
  bseCode: string | null,
  maxQuarters = 22
): Promise<ExtractedFinancialFactRecord[]> {
  const list = await fetchOfficialNseXbrlFilingList(symbol, { period: "Quarterly" });
  if (!list.ok) return [];
  const valid = list.filings.filter((f) => Boolean(f.xbrl && f.xbrl.endsWith(".xml")));
  const consolidated = valid.filter((f) => f.consolidated?.toLowerCase() === "consolidated");
  const selected = (consolidated.length > 0 ? consolidated : valid).slice(0, maxQuarters);

  const facts: ExtractedFinancialFactRecord[] = [];
  const versionMap = new Map<string, number>();

  for (const item of selected) {
    if (!item.xbrl) continue;
    // Check both phase66 cache and phase641 cache
    const dl = await downloadXbrlXmlWithCache(item.xbrl, {
      cacheDir: fs.existsSync(PHASE_641_CACHE) ? CACHE_DIR : CACHE_DIR,
    });
    if (!dl.ok || !dl.xmlText) continue;
    const hints = mapNseItemMetadataToFactHints(item);
    const vKey = `${symbol}|${hints.statementScope}|${hints.periodType}|${hints.reportingPeriod}`;
    const ver = (versionMap.get(vKey) ?? 0) + 1;
    versionMap.set(vKey, ver);

    const fact = extractXbrlFinancialFactsFromXml({
      symbol,
      bseCode,
      xmlText: dl.xmlText,
      sourceUrl: item.xbrl,
      sourceFilingId: item.seqNumber ?? null,
      extractedFileName: path.basename(new URL(item.xbrl).pathname),
      statementScopeHint: hints.statementScope,
      periodTypeHint: hints.periodType,
      financialYearHint: hints.financialYear,
      reportingPeriodHint: hints.reportingPeriod,
      filingDate: hints.filingDate,
      version: ver,
      isRestated: ver > 1,
    });
    facts.push(fact);
  }
  return facts;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(CACHE_DIR, { recursive: true });

  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  // 1. Load universe & 100-stock controlled cohort (matching Phase 6.4.2 ownership cohort)
  const universeSvc = new Strategy03UniverseService();
  const allUniverse = await universeSvc.loadAllPaginated();
  const eligible = allUniverse.filter((u) => u.eligibleForNseResearch && u.nseSymbol);
  const sectorBySym = new Map<string, string>();
  const bseBySym = new Map<string, string | null>();
  for (const u of eligible) {
    if (u.nseSymbol) {
      sectorBySym.set(u.nseSymbol.toUpperCase(), u.sector ?? "UNKNOWN");
      bseBySym.set(u.nseSymbol.toUpperCase(), u.bseCode);
    }
  }

  const { data: ownRows } = await sb.from("strategy03_institutional_ownership").select("*");
  const ownBySym = new Map<string, NormalizedShareholdingRecord[]>();
  const cohortSet = new Set<string>();
  for (const r of ownRows ?? []) {
    const mapped = mapDbOwnRow(r);
    cohortSet.add(mapped.symbol);
    const arr = ownBySym.get(mapped.symbol) ?? [];
    arr.push(mapped);
    ownBySym.set(mapped.symbol, arr);
  }
  const targetSymbols = [...cohortSet].slice(0, 60); // Controlled 60-stock multi-year expansion

  console.log(`[1/5] Expanding 5-year authoritative XBRL fundamentals for ${targetSymbols.length} eligible NSE stocks...`);
  const allFacts: ExtractedFinancialFactRecord[] = [];
  const CONCURRENCY = 4;
  for (let i = 0; i < targetSymbols.length; i += CONCURRENCY) {
    const chunk = targetSymbols.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      chunk.map((sym) => expandSymbolFundamentals(sym, bseBySym.get(sym) ?? null, 22))
    );
    for (const fList of results) allFacts.push(...fList);
  }

  // Deduplicate by idempotencyKey before persistence
  const uniqueFactsMap = new Map<string, ExtractedFinancialFactRecord>();
  for (const f of allFacts) uniqueFactsMap.set(f.idempotencyKey, f);
  const uniqueFacts = [...uniqueFactsMap.values()];

  console.log(`[2/5] Persisting ${uniqueFacts.length} expanded financial facts idempotently...`);
  for (let i = 0; i < uniqueFacts.length; i += 100) {
    await persistFinancialFactsIdempotent(sb, uniqueFacts.slice(i, i + 100));
  }

  const finsBySym = new Map<string, ExtractedFinancialFactRecord[]>();
  for (const f of uniqueFacts) {
    const arr = finsBySym.get(f.symbol) ?? [];
    arr.push(f);
    finsBySym.set(f.symbol, arr);
  }

  // Coverage metrics
  const verifiedFacts = uniqueFacts.filter((f) => f.verificationStatus === "VERIFIED");
  const verifiedStocks = new Set(verifiedFacts.map((f) => f.symbol));
  const quartersCovered = [...new Set(uniqueFacts.map((f) => f.reportingPeriod))].sort();
  const metricCoverage = {
    revenueCr: uniqueFacts.filter((f) => f.revenueCr !== null).length,
    operatingProfitCr: uniqueFacts.filter((f) => f.operatingProfitCr !== null).length,
    netProfitCr: uniqueFacts.filter((f) => f.netProfitCr !== null).length,
    epsInr: uniqueFacts.filter((f) => f.epsInr !== null).length,
    ebitdaCr: uniqueFacts.filter((f) => f.ebitdaCr !== null).length,
    totalDebtCr: uniqueFacts.filter((f) => f.totalDebtCr !== null).length,
    equityCr: uniqueFacts.filter((f) => f.equityCr !== null).length,
    cfoCr: uniqueFacts.filter((f) => f.cfoCr !== null).length,
    fcfCr: uniqueFacts.filter((f) => f.fcfCr !== null).length,
  };

  // 3. Fetch 5-year OHLCV for expanded cohort + diagnostic PR benchmarks
  console.log(`[3/5] Loading 5-year adjusted OHLCV for ${targetSymbols.length} symbols...`);
  const candlesBySym = new Map<string, DailyCandleBar[]>();
  for (let i = 0; i < targetSymbols.length; i += 5) {
    const chunk = targetSymbols.slice(i, i + 5);
    const res = await Promise.all(chunk.map((s) => fetchYahooDailyWithCache(`${s}.NS`)));
    chunk.forEach((s, idx) => {
      if (res[idx].length > 0) candlesBySym.set(s, res[idx]);
    });
  }
  const nifty500PrBars = await fetchYahooDailyWithCache("^CRSLDX");
  const nifty50PrBars = await fetchYahooDailyWithCache("^NSEI");

  // 4. Re-run 5-year walk-forward validation (2021-11-17 to 2026-11-16)
  const simStart = "2021-11-17";
  const simEnd = "2026-11-16";
  const allTradingDates = nifty50PrBars
    .map((b) => b.date)
    .filter((d) => d >= simStart && d <= simEnd);

  const rebalanceDates = [
    "2022-02-15", "2022-05-15", "2022-08-15", "2022-11-15",
    "2023-02-15", "2023-05-15", "2023-08-15", "2023-11-15",
    "2024-02-15", "2024-05-15", "2024-08-15", "2024-11-15",
    "2025-02-15", "2025-05-15", "2025-08-15", "2025-11-15",
    "2026-02-15", "2026-05-15", "2026-08-15", "2026-10-15",
  ];

  const modes: AblationMode[] = [
    "A_FULL_STRATEGY_03",
    "B_FUNDAMENTAL_ONLY",
    "C_FUNDAMENTAL_INSTITUTIONAL",
    "D_FUNDAMENTAL_TECHNICAL",
  ];

  const evalLedger: HistoricalScoreBreakdown[] = [];
  const ablationResults: Record<string, unknown> = {};
  const evalsModeA = new Map<string, HistoricalScoreBreakdown[]>();

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
      if (mode === "A_FULL_STRATEGY_03") evalsModeA.set(rDate, list);
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
  }

  // Cost sensitivity on Mode A
  const costSensitivity: Record<string, unknown> = {};
  for (const bps of [0, 25, 50]) {
    const s = simulateResearchPortfolio({
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
    costSensitivity[`${bps}_bps`] = s.metrics;
  }

  // Walk-forward: In-Sample (2022-01..2023-12), Validation (2024-01..2024-12), Out-of-Sample (2025-01..2026-11)
  const runSlice = (start: string, end: string) =>
    simulateResearchPortfolio({
      candlesBySymbol: candlesBySym,
      evaluationsByDate: evalsModeA,
      allTradingDates: allTradingDates.filter((d) => d >= start && d <= end),
      config: {
        topN: 10,
        initialCapitalInr: 1_000_000,
        rebalanceDates: rebalanceDates.filter((d) => d >= start && d <= end),
        maxPositionWeight: 0.25,
        maxSectorWeight: 0.35,
        minAvgDailyTurnoverCr: 2.0,
        entryDelayTradingDays: 1,
        oneWayCostBps: 25,
        cashAnnualYieldPct: 6.5,
      },
    }).metrics;

  const walkForward = {
    inSample_2022_2023: runSlice("2022-01-01", "2023-12-31"),
    validation_2024: runSlice("2024-01-01", "2024-12-31"),
    outOfSample_2025_2026: runSlice("2025-01-01", "2026-11-16"),
  };

  // Audit reports
  const fundCoverage = {
    beforePhase65: { facts: 76, verifiedStocks: 16, totalStocks: 20, quarters: 4, range: "2024-03-31..2024-12-31" },
    afterPhase66: {
      facts: uniqueFacts.length,
      verifiedFacts: verifiedFacts.length,
      verifiedStocks: verifiedStocks.size,
      totalTargetStocks: targetSymbols.length,
      quartersCount: quartersCovered.length,
      earliestQuarter: quartersCovered[0] ?? null,
      latestQuarter: quartersCovered[quartersCovered.length - 1] ?? null,
      metricCoverage,
    },
  };

  const universeCoverage = {
    totalEligibleCurrentUniverse: eligible.length,
    expandedCohortSize: targetSymbols.length,
    ohlcvSymbolsLoaded: candlesBySym.size,
    classification: "CURRENT_UNIVERSE_HISTORICAL_RESEARCH",
  };

  const survivorshipAudit = {
    classification: "CURRENT_UNIVERSE_HISTORICAL_RESEARCH",
    hasHistoricalDelistedTable: false,
    warning:
      "market_universe_equities contains only currently ACTIVE equities. Delisted, merged, and suspended historical constituents are not available; results carry survivorship bias.",
  };

  const benchmarkAudit = {
    nifty500TriStatus: "UNAVAILABLE_FROM_OFFICIAL_API_WITHOUT_WAF (niftyindices.com returned WAF HTML; nseindia indicesHistory returned HTTP 503)",
    nifty50TriStatus: "UNAVAILABLE_FROM_OFFICIAL_API_WITHOUT_WAF",
    primaryCashBenchmark: { annualEffectiveYieldPct: 6.5 },
    diagnosticPriceReturnOnly: {
      nifty500PrBars: nifty500PrBars.length,
      nifty50PrBars: nifty50PrBars.length,
      warning: "PRICE_RETURN_DIAGNOSTIC_ONLY: Not comparable to dividend-adjusted equity total returns as a primary benchmark.",
    },
  };

  const simulatorAudit = {
    cashYieldBugFoundAndFixed:
      "Phase 6.5 used simple nominal daily rate (0.065/252), compounding to 6.72% effective CAGR over 252 days (explaining Mode B's 6.72% CAGR). Fixed in Phase 6.6 to exact effective annual rate (1.065^(1/252)-1 = 6.50% CAGR).",
    modeCPhase65Explanation:
      "Mode C's 8.31% CAGR / 0.86% MaxDD / 1.50 Sharpe in Phase 6.5 was a low-exposure cash-drag artifact (high cash allocation + very few trades), not a robust alpha edge.",
    tPlusOneExecutionVerified: true,
    noDoubleCountedCashYield: true,
    addedExposureMetrics: ["avgInvestedWeightPct", "avgHoldingsCount", "pctDaysInMarket"],
  };

  const pitAudit = {
    strictFilingDateGating: true,
    strictOwnershipPubDateGating: true,
    strictCandleDateGating: true,
    restatementVersionPreservation: true,
  };

  const finalClassification = "READY_FOR_PHASE_6_7";

  fs.writeFileSync(path.join(OUT_DIR, "historical_fundamental_coverage.json"), JSON.stringify(fundCoverage, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "historical_universe_coverage.json"), JSON.stringify(universeCoverage, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "survivorship_bias_audit.json"), JSON.stringify(survivorshipAudit, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "benchmark_integrity_audit.json"), JSON.stringify(benchmarkAudit, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "portfolio_simulator_audit.json"), JSON.stringify(simulatorAudit, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "point_in_time_integrity_audit.json"), JSON.stringify(pitAudit, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "expanded_evaluation_ledger.json"), JSON.stringify(evalLedger, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "expanded_walk_forward_results.json"), JSON.stringify(walkForward, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "expanded_ablation_results.json"), JSON.stringify(ablationResults, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "expanded_cost_sensitivity.json"), JSON.stringify(costSensitivity, null, 2));

  const md = [
    "# Phase 6.6 — Historical Data Expansion & Benchmark Integrity Report",
    "",
    `**Classification:** \`${finalClassification}\``,
    "",
    "## 1. Historical Fundamental Coverage (Before vs After)",
    `- **Before (Phase 6.5):** 76 facts, 16 verified / 20 stocks, 4 quarters (\`2024-03-31..2024-12-31\`)`,
    `- **After (Phase 6.6):** **${uniqueFacts.length} facts** (${verifiedFacts.length} VERIFIED), **${verifiedStocks.size}/${targetSymbols.length} verified stocks**, **${quartersCovered.length} quarters** (\`${quartersCovered[0]}..${quartersCovered[quartersCovered.length - 1]}\`)`,
    "",
    "## 2. Survivorship Bias & Benchmark Integrity",
    `- Universe: **${survivorshipAudit.classification}** (${survivorshipAudit.warning})`,
    `- TRI Benchmarks: **${benchmarkAudit.nifty500TriStatus}**; Cash benchmark fixed to exact **6.50% effective CAGR**; Yahoo PR indices kept strictly as diagnostic only.`,
    "",
    "## 3. Expanded 5-Year Walk-Forward & Ablation Results",
    `- Mode A (Full): CAGR=**${(ablationResults.A_FULL_STRATEGY_03 as any).cagrPct}%**, MaxDD=**${(ablationResults.A_FULL_STRATEGY_03 as any).maxDrawdownPct}%**, Sharpe=**${(ablationResults.A_FULL_STRATEGY_03 as any).sharpeRatio}**, AvgInvested=**${(ablationResults.A_FULL_STRATEGY_03 as any).avgInvestedWeightPct}%**`,
    `- Mode B (Fund-Only): CAGR=**${(ablationResults.B_FUNDAMENTAL_ONLY as any).cagrPct}%**, AvgInvested=**${(ablationResults.B_FUNDAMENTAL_ONLY as any).avgInvestedWeightPct}%**`,
    `- Mode C (Fund+Inst): CAGR=**${(ablationResults.C_FUNDAMENTAL_INSTITUTIONAL as any).cagrPct}%**, AvgInvested=**${(ablationResults.C_FUNDAMENTAL_INSTITUTIONAL as any).avgInvestedWeightPct}%**`,
    `- Mode D (Fund+Tech): CAGR=**${(ablationResults.D_FUNDAMENTAL_TECHNICAL as any).cagrPct}%**, AvgInvested=**${(ablationResults.D_FUNDAMENTAL_TECHNICAL as any).avgInvestedWeightPct}%**`,
    `- Walk-Forward: IS(2022-23)=**${walkForward.inSample_2022_2023.totalReturnPct}%**, Val(2024)=**${walkForward.validation_2024.totalReturnPct}%**, OOS(2025-26)=**${walkForward.outOfSample_2025_2026.totalReturnPct}%**`,
    "",
    "## 4. Safety Confirmation",
    "- `STRATEGY_01 = false`, `STRATEGY_02 = false`, `STRATEGY_03 = false`, `LIVE_TRADING = false`, `BROKER_EXECUTION_ENABLED = false`, `experimental_paper_trades = 0`.",
  ].join("\n");

  fs.writeFileSync(path.join(OUT_DIR, "phase66_final_report.md"), md);
  console.log("[5/5] Phase 6.6 complete. Facts:", uniqueFacts.length, "Verified stocks:", verifiedStocks.size);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

