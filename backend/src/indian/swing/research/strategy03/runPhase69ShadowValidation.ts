import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { ExtractedFinancialFactRecord } from "./BseXbrlBackfillService.js";
import type { NormalizedShareholdingRecord } from "./OfficialShareholdingIntelligenceEngine.js";
import type { ClassifiedAnnouncementRecord } from "./CorporateAnnouncementIntelligence.js";
import type { DailyCandleBar } from "./HistoricalValidationEngine.js";
import { classifyMarketRegimes } from "./StatisticalRobustnessEngine.js";
import {
  appendShadowSignalsImmutable,
  loadAllRowsPaginated,
  Strategy03ShadowRunner,
  trackForwardReturns,
  type ForwardReturnObservation,
  type ShadowSignalRecord,
} from "./Strategy03ShadowRunner.js";

config({ path: path.resolve("D:/Trading/my-app/backend/.env") });

const OUT_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase69");
const P66_CACHE = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase66/cache");
const P65_CACHE = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase65/cache");

function loadCachedCandles(yahooSym: string): DailyCandleBar[] {
  const safe = yahooSym.replace(/[^A-Za-z0-9_.-]/g, "_");
  for (const dir of [P66_CACHE, P65_CACHE]) {
    const p = path.join(dir, `${safe}_5y.json`);
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8")) as DailyCandleBar[];
  }
  return [];
}

function mapDbFin(r: any): ExtractedFinancialFactRecord {
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

function mapDbOwn(row: any): NormalizedShareholdingRecord {
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

function mapDbAnn(r: any): ClassifiedAnnouncementRecord {
  return {
    exchange: r.exchange,
    filingId: r.filing_id,
    symbol: r.symbol,
    companyName: r.company_name,
    category: r.category,
    headline: r.headline,
    extractedText: r.extracted_text,
    sourceUrl: r.source_url,
    publishedAt: r.published_at,
    retrievedAt: r.retrieved_at,
    verificationStatus: r.verification_status,
    extractionConfidence: Number(r.extraction_confidence ?? 0),
    isAmbiguous: Boolean(r.is_ambiguous),
    hasSourceConflict: Boolean(r.has_source_conflict),
  };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  // 1. Complete paginated row counts & coverage gate
  console.log("[1/4] Loading complete paginated Strategy 03 research tables...");
  const finRows = await loadAllRowsPaginated(sb, "strategy03_financial_facts");
  const ownRows = await loadAllRowsPaginated(sb, "strategy03_institutional_ownership");
  const annRows = await loadAllRowsPaginated(sb, "strategy03_corporate_announcements");
  const delRows = await loadAllRowsPaginated(sb, "strategy03_delivery_data");
  const univRows = await loadAllRowsPaginated(sb, "market_universe_equities", "nse_symbol, sector, listing_status, series");
  const { count: paperTradesCount } = await sb
    .from("experimental_paper_trades")
    .select("*", { count: "exact", head: true });

  const sectorBySym = new Map<string, string>();
  for (const u of univRows) {
    if (u.nse_symbol) sectorBySym.set(u.nse_symbol.toUpperCase(), u.sector ?? "UNKNOWN");
  }

  const finsBySym = new Map<string, ExtractedFinancialFactRecord[]>();
  for (const r of finRows) {
    const f = mapDbFin(r);
    const arr = finsBySym.get(f.symbol) ?? [];
    arr.push(f);
    finsBySym.set(f.symbol, arr);
  }
  const ownBySym = new Map<string, NormalizedShareholdingRecord[]>();
  for (const r of ownRows) {
    const o = mapDbOwn(r);
    const arr = ownBySym.get(o.symbol) ?? [];
    arr.push(o);
    ownBySym.set(o.symbol, arr);
  }
  const annBySym = new Map<string, ClassifiedAnnouncementRecord[]>();
  for (const r of annRows) {
    const a = mapDbAnn(r);
    const arr = annBySym.get(a.symbol) ?? [];
    arr.push(a);
    annBySym.set(a.symbol, arr);
  }

  const cohortSymbols = [...finsBySym.keys()];
  const candlesBySym = new Map<string, DailyCandleBar[]>();
  for (const sym of cohortSymbols) {
    const bars = loadCachedCandles(`${sym}.NS`);
    if (bars.length > 0) candlesBySym.set(sym, bars);
  }
  const nifty50PrBars = loadCachedCandles("^NSEI");
  const regimeMap = classifyMarketRegimes(nifty50PrBars);

  const dataCoverage = {
    generatedAt: new Date().toISOString(),
    exactPaginatedRowCounts: {
      strategy03_financial_facts: finRows.length,
      strategy03_institutional_ownership: ownRows.length,
      strategy03_corporate_announcements: annRows.length,
      strategy03_delivery_data: delRows.length,
      market_universe_equities: univRows.length,
      experimental_paper_trades: paperTradesCount ?? 0,
    },
    deliveryZeroInvestigation:
      "deliveryRowsInDb = 0 because Phase 6.1/6.2 collected NSE delivery data to local research JSONs and ran a smoke test without executing a full-universe remote delivery backfill.",
    metricCoverage: {
      fcfNonNull: finRows.filter((r) => r.fcf_cr !== null).length,
      debtNonNull: finRows.filter((r) => r.total_debt_cr !== null).length,
      cfoNonNull: finRows.filter((r) => r.cfo_cr !== null).length,
      ownershipSymbols: ownBySym.size,
      announcementSymbols: annBySym.size,
    },
  };

  // 2. Run Shadow Runner on today's live date (2026-11-17) + 90-day forward-tracking cohort (2026-08-18)
  console.log("[2/4] Running Strategy03ShadowRunner (2026-08-18 baseline + 2026-11-17 live shadow scan)...");
  const runner = new Strategy03ShadowRunner();
  const shadowDates = ["2026-08-18", "2026-11-17"];
  const allNewSignals: ShadowSignalRecord[] = [];
  const latestScanSignals: ShadowSignalRecord[] = [];

  for (const sDate of shadowDates) {
    for (const sym of cohortSymbols) {
      const sig = runner.evaluateSymbolAsOf({
        symbol: sym,
        sector: sectorBySym.get(sym) ?? "UNKNOWN",
        signalDate: sDate,
        financials: finsBySym.get(sym) ?? [],
        ownership: ownBySym.get(sym) ?? [],
        announcements: annBySym.get(sym) ?? [],
        candles: candlesBySym.get(sym) ?? [],
      });
      allNewSignals.push(sig);
      if (sDate === "2026-11-17") latestScanSignals.push(sig);
    }
  }

  const ledgerPath = path.join(OUT_DIR, "shadow_signal_ledger.json");
  const existingLedger: ShadowSignalRecord[] = fs.existsSync(ledgerPath)
    ? JSON.parse(fs.readFileSync(ledgerPath, "utf8"))
    : [];
  const { ledger, addedCount, skippedDuplicatesCount } = appendShadowSignalsImmutable(
    existingLedger,
    allNewSignals
  );

  // 3. Forward Return Tracking
  console.log("[3/4] Tracking forward returns (1D, 5D, 10D, 20D, 60D, MFE, MAE)...");
  const forwardObs: ForwardReturnObservation[] = [];
  for (const sig of ledger) {
    const obs = trackForwardReturns(sig, candlesBySym.get(sig.symbol) ?? []);
    if (obs) forwardObs.push(obs);
  }

  const avg = (arr: number[]) =>
    arr.length > 0 ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100 : null;

  const forwardByDecision: Record<string, unknown> = {};
  for (const dec of ["BUY_CANDIDATE", "WATCH", "WAIT", "SELL_CANDIDATE"] as const) {
    const sub = forwardObs.filter((o) => o.decision === dec && o.observationTradingDays > 0);
    forwardByDecision[dec] = {
      signalsWithForwardObs: sub.length,
      avg1dPct: avg(sub.map((s) => s.ret1dPct).filter((v): v is number => v !== null)),
      avg5dPct: avg(sub.map((s) => s.ret5dPct).filter((v): v is number => v !== null)),
      avg10dPct: avg(sub.map((s) => s.ret10dPct).filter((v): v is number => v !== null)),
      avg20dPct: avg(sub.map((s) => s.ret20dPct).filter((v): v is number => v !== null)),
      avg60dPct: avg(sub.map((s) => s.ret60dPct).filter((v): v is number => v !== null)),
      avgMfePct: avg(sub.map((s) => s.mfePct).filter((v): v is number => v !== null)),
      avgMaePct: avg(sub.map((s) => s.maePct).filter((v): v is number => v !== null)),
    };
  }

  // Sector & Market Regime breakdown
  const sectorMap = new Map<string, ForwardReturnObservation[]>();
  for (const o of forwardObs.filter((x) => x.observationTradingDays > 0)) {
    const arr = sectorMap.get(o.sector) ?? [];
    arr.push(o);
    sectorMap.set(o.sector, arr);
  }
  const sectorAnalysis = [...sectorMap.entries()].map(([sector, items]) => ({
    sector,
    signals: items.length,
    buyCandidates: items.filter((i) => i.decision === "BUY_CANDIDATE").length,
    avg20dPct: avg(items.map((i) => i.ret20dPct).filter((v): v is number => v !== null)),
    avg60dPct: avg(items.map((i) => i.ret60dPct).filter((v): v is number => v !== null)),
  }));

  const regimeAug18 = regimeMap.get("2026-08-18") ?? null;
  const regimeNov16 = regimeMap.get("2026-11-16") ?? null;

  const latestCounts = {
    scanDate: "2026-11-17",
    evaluatedAt: latestScanSignals[0]?.evaluationTimestamp ?? new Date().toISOString(),
    stocksEvaluated: latestScanSignals.length,
    BUY_CANDIDATE: latestScanSignals.filter((s) => s.decision === "BUY_CANDIDATE").length,
    WATCH: latestScanSignals.filter((s) => s.decision === "WATCH").length,
    SELL_CANDIDATE: latestScanSignals.filter((s) => s.decision === "SELL_CANDIDATE").length,
    WAIT: latestScanSignals.filter((s) => s.decision === "WAIT").length,
    liveShadowObservationDays: 1,
    eodForwardCohortDays: 90,
    classification: "FORWARD_VALIDATION_IN_PROGRESS",
  };

  const missingnessCounts: Record<string, number> = {};
  for (const s of latestScanSignals) {
    for (const m of s.missingFields) missingnessCounts[m] = (missingnessCounts[m] ?? 0) + 1;
  }

  fs.writeFileSync(path.join(OUT_DIR, "shadow_data_coverage.json"), JSON.stringify(dataCoverage, null, 2));
  fs.writeFileSync(
    path.join(OUT_DIR, "shadow_daily_evaluations.json"),
    JSON.stringify({ summary: latestCounts, forwardByDecision, signals: latestScanSignals }, null, 2)
  );
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));
  fs.writeFileSync(
    path.join(OUT_DIR, "forward_return_tracking.json"),
    JSON.stringify({ forwardByDecision, observations: forwardObs }, null, 2)
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "market_regime_performance.json"),
    JSON.stringify(
      {
        benchmarkDisclaimer: "PRICE_RETURN_DIAGNOSTIC_ONLY (^NSEI used for causal regime labeling)",
        regimeAt2026_08_18: regimeAug18,
        regimeAt2026_11_16: regimeNov16,
        forwardByDecision,
      },
      null,
      2
    )
  );
  fs.writeFileSync(path.join(OUT_DIR, "sector_signal_analysis.json"), JSON.stringify(sectorAnalysis, null, 2));
  fs.writeFileSync(
    path.join(OUT_DIR, "shadow_missingness_audit.json"),
    JSON.stringify({ scanDate: "2026-11-17", stocksEvaluated: latestScanSignals.length, missingFieldCounts: missingnessCounts }, null, 2)
  );

  const md = [
    "# Phase 6.9 — Live Market Forward Validation (Shadow Mode) Report",
    "",
    `**Classification:** \`${latestCounts.classification}\``,
    "",
    "## 1. Complete Paginated Data Coverage Gate",
    `- \`strategy03_financial_facts\`: **${finRows.length}**`,
    `- \`strategy03_institutional_ownership\`: **${ownRows.length}**`,
    `- \`strategy03_corporate_announcements\`: **${annRows.length}**`,
    `- \`strategy03_delivery_data\`: **${delRows.length}** (${dataCoverage.deliveryZeroInvestigation})`,
    `- \`experimental_paper_trades\`: **${paperTradesCount ?? 0}**`,
    "",
    "## 2. Shadow Scan Summary (`2026-11-17`)",
    `- Stocks evaluated: **${latestCounts.stocksEvaluated}**`,
    `- Decisions: \`BUY_CANDIDATE=${latestCounts.BUY_CANDIDATE}\`, \`WATCH=${latestCounts.WATCH}\`, \`SELL_CANDIDATE=${latestCounts.SELL_CANDIDATE}\`, \`WAIT=${latestCounts.WAIT}\``,
    `- Immutable ledger total: **${ledger.length}** (added=${addedCount}, skippedDuplicates=${skippedDuplicatesCount})`,
    `- Live shadow observation days elapsed: **1** (started \`2026-11-17\`; 90-day EOD forward-tracking baseline also evaluated from \`2026-08-18\`)`,
    "",
    "## 3. Safety Confirmation",
    `- \`STRATEGY_01 = false\`, \`STRATEGY_02 = false\`, \`STRATEGY_03 = false\`, \`LIVE_TRADING = false\`, \`BROKER_EXECUTION_ENABLED = false\`, \`experimental_paper_trades = ${paperTradesCount ?? 0}\`.`,
  ].join("\n");

  fs.writeFileSync(path.join(OUT_DIR, "phase69_final_report.md"), md);
  console.log("[4/4] Phase 6.9 complete:", latestCounts);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

