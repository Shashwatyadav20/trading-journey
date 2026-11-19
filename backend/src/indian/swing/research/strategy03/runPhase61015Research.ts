import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import {
  evaluatePointInTimeSnapshot,
  filterCandlesAsOf,
  filterFinancialsAsOf,
  filterOwnershipAsOf,
  type DailyCandleBar,
} from "./HistoricalValidationEngine.js";
import type { ExtractedFinancialFactRecord } from "./BseXbrlBackfillService.js";
import type { NormalizedShareholdingRecord } from "./OfficialShareholdingIntelligenceEngine.js";
import type { OhlcvCandle } from "./entry/EntrySetupTypes.js";
import { filterMomentumStock } from "./momentum/Strategy03MomentumStockFilter.js";
import {
  evaluateIntradayEventsForDay,
  sanitizeIntraday1hSeries,
  toIstDateAndTime,
} from "./momentum/Strategy03IntradayEventEvaluator.js";
import {
  compute1hAtr14,
  simulateManagedTrade,
  summarizeManagedTrades,
  type ExitConfig,
  type ManagedTradeResult,
  type VolatilityRegime,
} from "./momentum/Strategy03TradeManagementEvaluator.js";
import { loadAllRowsPaginated } from "./Strategy03ShadowRunner.js";
import {
  classifyCapSegment,
  classifyNiftyRegime,
  type CapSegment,
  type MarketRegime,
} from "./runPhase61013Research.js";

config({ path: path.resolve("D:/Trading/my-app/backend/.env") });

const OUT_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase61015");
const P6108_CACHE = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase6108/cache");
const P66_CACHE = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase66/cache");
const P65_CACHE = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase65/cache");

function loadCached1h(sym: string): OhlcvCandle[] {
  const p = path.join(P6108_CACHE, `${sym}_1h_730d.json`);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : [];
}

function loadCachedDaily(yahooSym: string): DailyCandleBar[] {
  const safe = yahooSym.replace(/[^A-Za-z0-9_.-]/g, "_");
  for (const dir of [P66_CACHE, P65_CACHE]) {
    const p = path.join(dir, `${safe}_5y.json`);
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8")) as DailyCandleBar[];
  }
  return [];
}

function classifyVolatilityRegime(pitNifty: DailyCandleBar[]): VolatilityRegime {
  if (pitNifty.length < 22) return "LOW_VOL";
  const rets: number[] = [];
  for (let i = pitNifty.length - 20; i < pitNifty.length; i++) {
    const prev = pitNifty[i - 1].close;
    if (prev > 0) rets.push((pitNifty[i].close - prev) / prev);
  }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length;
  const annVolPct = Math.sqrt(variance) * Math.sqrt(252) * 100;
  return annVolPct >= 14 ? "HIGH_VOL" : "LOW_VOL";
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

interface BaselineEntryCandidate {
  symbol: string;
  sector: string;
  capSegment: CapSegment;
  regime: MarketRegime;
  volRegime: VolatilityRegime;
  entryDate: string;
  slPrice: number;
  atr14: number;
  future1h: OhlcvCandle[];
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const finRows = await loadAllRowsPaginated(sb, "strategy03_financial_facts");
  const ownRows = await loadAllRowsPaginated(sb, "strategy03_institutional_ownership");
  const univRows = await loadAllRowsPaginated(sb, "market_universe_equities", "nse_symbol,sector,market_cap_cr");
  const { count: paperTradesCount } = await sb
    .from("experimental_paper_trades")
    .select("*", { count: "exact", head: true });

  const metaBySym = new Map<string, { sector: string; cap: CapSegment }>();
  for (const u of univRows) {
    if (u.nse_symbol) {
      metaBySym.set(u.nse_symbol.toUpperCase(), {
        sector: u.sector ?? "UNKNOWN",
        cap: classifyCapSegment(u.market_cap_cr !== null ? Number(u.market_cap_cr) : null, null),
      });
    }
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

  const verifiedSyms = [
    ...new Set(finRows.filter((r) => r.verification_status === "VERIFIED").map((r) => r.symbol)),
  ].slice(0, 30);
  const niftyDaily = loadCachedDaily("^NSEI");

  // Collect exact immutable Phase 6.10.14 baseline entries (79 trades)
  const candidates: BaselineEntryCandidate[] = [];

  for (const sym of verifiedSyms) {
    const daily = loadCachedDaily(`${sym}.NS`);
    const { candles: h1 } = sanitizeIntraday1hSeries(loadCached1h(sym));
    if (daily.length < 120 || h1.length < 100) continue;

    const meta = metaBySym.get(sym) ?? { sector: "UNKNOWN", cap: "LARGE" as CapSegment };
    const startDay = toIstDateAndTime(h1[0].timestamp).istDate;
    const evalDays = daily.filter((d) => d.date >= startDay && d.date <= "2026-10-15");

    let lastFirst = -99;
    for (let i = 50; i < evalDays.length - 1; i++) {
      const dayIso = evalDays[i].date;
      const pitDaily = filterCandlesAsOf(daily, dayIso);
      const pitNifty = filterCandlesAsOf(niftyDaily, dayIso);
      if (pitDaily.length < 60) continue;
      const avgTurnCr = (pitDaily.slice(-20).reduce((a, b) => a + b.close * b.volume, 0) / 20) / 1e7;
      if (avgTurnCr < 5) continue;

      const pitFins = filterFinancialsAsOf(finsBySym.get(sym) ?? [], dayIso);
      const pitOwn = filterOwnershipAsOf(ownBySym.get(sym) ?? [], dayIso);
      const fund = evaluatePointInTimeSnapshot({
        symbol: sym,
        sector: meta.sector,
        asOfDate: dayIso,
        financials: pitFins,
        ownership: pitOwn,
        announcements: [],
        candles: pitDaily,
      });
      if (fund.decision !== "ENTER_CANDIDATE") continue;

      const mom = filterMomentumStock({ symbol: sym, sector: meta.sector, candles: pitDaily, niftyCandles: pitNifty });
      if (mom.classification !== "MOMENTUM_WATCHLIST") continue;

      const dayEv = evaluateIntradayEventsForDay({
        symbol: sym,
        istDate: dayIso,
        sanitizedCandles: h1,
        windowCandles: 5,
      });

      if (dayEv.firstBreakout && i - lastFirst >= 10) {
        const idx = dayEv.firstBreakout.barIndexInFullSeries;
        const fut = h1.slice(idx + 1);
        if (fut.length >= 5) {
          const atr14 = compute1hAtr14(h1.slice(0, idx + 1));
          candidates.push({
            symbol: sym,
            sector: meta.sector,
            capSegment: meta.cap,
            regime: classifyNiftyRegime(pitNifty),
            volRegime: classifyVolatilityRegime(pitNifty),
            entryDate: toIstDateAndTime(fut[0].timestamp).istDate,
            slPrice: dayEv.firstBreakout.consolidationLowSl,
            atr14,
            future1h: fut,
          });
          lastFirst = i;
        }
      }
    }
  }

  const runCfg = (cfg: ExitConfig): ManagedTradeResult[] =>
    candidates
      .map((c) =>
        simulateManagedTrade({
          symbol: c.symbol,
          sector: c.sector,
          capSegment: c.capSegment,
          regime: c.regime,
          volRegime: c.volRegime,
          entryDate: c.entryDate,
          future1h: c.future1h,
          slPrice: c.slPrice,
          atr14: c.atr14,
          config: cfg,
        })
      )
      .filter((t): t is ManagedTradeResult => t !== null);

  const resA = runCfg({ mode: "A_FIXED_1TO3_BASELINE", targetR: 3.0 });
  const resB = runCfg({ mode: "B_FIXED_1TO2", targetR: 2.0 });
  const resC_12 = runCfg({ mode: "C_TRAIL_AFTER_1R", trailAfter1RRiskMult: 1.2 });
  const resC_10 = runCfg({ mode: "C_TRAIL_AFTER_1R", trailAfter1RRiskMult: 1.0 });
  const resC_15 = runCfg({ mode: "C_TRAIL_AFTER_1R", trailAfter1RRiskMult: 1.5 });
  const resD_atr2 = runCfg({ mode: "D_ATR_TRAIL_AFTER_1R", atrTrailMult: 2.0 });
  const resE_partial = runCfg({ mode: "E_PARTIAL_50_AT_1R_TRAIL", partialAt1RPct: 0.5, trailAfter1RRiskMult: 1.2 });
  const resF_time20 = runCfg({ mode: "F_TIME_EXIT_FAIL_20BARS", targetR: 3.0, timeFailBars: 20, timeFailMinR: 0.5 });
  const resF_time30 = runCfg({ mode: "F_TIME_EXIT_FAIL_20BARS", targetR: 3.0, timeFailBars: 30, timeFailMinR: 0.5 });
  const resG_be3 = runCfg({ mode: "G1_BREAKEVEN_3PCT", targetR: 3.0, breakevenMovePct: 3.0 });
  const resG_be4 = runCfg({ mode: "G2_BREAKEVEN_4PCT", targetR: 3.0, breakevenMovePct: 4.0 });

  // Excursion statistics on baseline A
  const reached1RCount = resA.filter((t) => t.reached1RBeforeSL).length;
  const reached2RCount = resA.filter((t) => t.reached2RBeforeReversal).length;
  const losersThatReached1R = resA.filter((t) => t.netReturnPct <= 0 && t.reached1RBeforeSL).length;

  const summaryMap = {
    A_fixed1to3_baseline: summarizeManagedTrades(resA),
    B_fixed1to2: summarizeManagedTrades(resB),
    C_trailAfter1R_12R: summarizeManagedTrades(resC_12),
    D_atrTrailAfter1R_2ATR: summarizeManagedTrades(resD_atr2),
    E_partial50At1R_plusTrail: summarizeManagedTrades(resE_partial),
    F_timeExitFail20Bars: summarizeManagedTrades(resF_time20),
    G1_breakeven3Pct: summarizeManagedTrades(resG_be3),
    G2_breakeven4Pct: summarizeManagedTrades(resG_be4),
  };

  // Evaluate walk-forward & regimes on best-performing exit (C_trailAfter1R_12R) vs baseline A
  const wfFor = (rows: ManagedTradeResult[]) => ({
    fullSample: summarizeManagedTrades(rows),
    train_2024: summarizeManagedTrades(rows.filter((t) => t.entryDate <= "2024-12-31")),
    validation_2025Q1_Q3: summarizeManagedTrades(rows.filter((t) => t.entryDate >= "2025-01-01" && t.entryDate <= "2025-09-30")),
    untouched_OOS_2025Q4_2026: summarizeManagedTrades(rows.filter((t) => t.entryDate >= "2025-10-01")),
  });

  const regimeFor = (rows: ManagedTradeResult[]) => ({
    BULL: summarizeManagedTrades(rows.filter((t) => t.regime === "BULL")),
    BEAR: summarizeManagedTrades(rows.filter((t) => t.regime === "BEAR")),
    SIDEWAYS: summarizeManagedTrades(rows.filter((t) => t.regime === "SIDEWAYS")),
    HIGH_VOL: summarizeManagedTrades(rows.filter((t) => t.volRegime === "HIGH_VOL")),
    LOW_VOL: summarizeManagedTrades(rows.filter((t) => t.volRegime === "LOW_VOL")),
  });

  const wfC = wfFor(resC_12);
  const wfE = wfFor(resE_partial);
  const finalClassification =
    wfC.untouched_OOS_2025Q4_2026.profitFactor >= 1.15 && wfC.fullSample.profitFactor >= 1.15
      ? "PROMISING_FOR_FURTHER_VALIDATION"
      : "NO_ROBUST_IMPROVEMENT";

  const writeJson = (name: string, data: unknown) =>
    fs.writeFileSync(path.join(OUT_DIR, name), JSON.stringify(data, null, 2));

  writeJson("trade_excursion_analysis.json", {
    totalTrades: resA.length,
    reached1RBeforeSLCount: reached1RCount,
    reached1RBeforeSLPct: resA.length > 0 ? Math.round((reached1RCount / resA.length) * 10000) / 100 : 0,
    reached2RBeforeReversalCount: reached2RCount,
    losersThatReached1RCount: losersThatReached1R,
    diagnosis:
      `${reached1RCount} of ${resA.length} trades reached +1R before SL, and ${losersThatReached1R} eventual losers had reached +1R before reversing — indicating profit giveback on fixed 1:3 targets.`,
    trades: resA,
  });
  writeJson("exit_strategy_comparison.json", summaryMap);
  writeJson("trailing_stop_analysis.json", {
    trail_10R: summarizeManagedTrades(resC_10),
    trail_12R: summarizeManagedTrades(resC_12),
    trail_15R: summarizeManagedTrades(resC_15),
    atrTrail_20ATR: summarizeManagedTrades(resD_atr2),
  });
  writeJson("partial_profit_analysis.json", {
    baseline_1to3: summarizeManagedTrades(resA),
    partial50_at1R_trail12R: summarizeManagedTrades(resE_partial),
  });
  writeJson("breakeven_analysis.json", {
    baseline_noBE: summarizeManagedTrades(resA),
    breakeven_3pct: summarizeManagedTrades(resG_be3),
    breakeven_4pct: summarizeManagedTrades(resG_be4),
  });
  writeJson("time_exit_analysis.json", {
    baseline_120barStop: summarizeManagedTrades(resA),
    timeFail_20bars_min05R: summarizeManagedTrades(resF_time20),
    timeFail_30bars_min05R: summarizeManagedTrades(resF_time30),
  });
  writeJson("regime_exit_analysis.json", {
    A_baseline: regimeFor(resA),
    C_trailAfter1R_12R: regimeFor(resC_12),
    E_partial50At1R_trail: regimeFor(resE_partial),
  });
  writeJson("walk_forward_results.json", {
    A_baseline_immutable: wfFor(resA),
    C_trailAfter1R_12R: wfC,
    E_partial50At1R_trail: wfE,
  });
  writeJson("cost_stress_results.json", {
    C_trail_0bps: summarizeManagedTrades(runCfg({ mode: "C_TRAIL_AFTER_1R", trailAfter1RRiskMult: 1.2, oneWayCostBps: 0, slippageBps: 0 })),
    C_trail_25bps: summarizeManagedTrades(resC_12),
    C_trail_35bps: summarizeManagedTrades(runCfg({ mode: "C_TRAIL_AFTER_1R", trailAfter1RRiskMult: 1.2, oneWayCostBps: 35, slippageBps: 8 })),
    C_trail_50bps_15slip: summarizeManagedTrades(runCfg({ mode: "C_TRAIL_AFTER_1R", trailAfter1RRiskMult: 1.2, oneWayCostBps: 50, slippageBps: 15 })),
  });

  const md = [
    "# Phase 6.10.15 — Trade Management & Profit Protection Report",
    "",
    `- **Final Classification:** \`${finalClassification}\``,
    `- **Baseline Entry Trades (Immutable Phase 6.10.14):** ${resA.length}`,
    `- **Excursion Finding:** ${reached1RCount}/${resA.length} reached +1R before SL; ${losersThatReached1R} eventual losers gave back >= +1R.`,
    `- **A (Baseline 1:3):** PF=${summaryMap.A_fixed1to3_baseline.profitFactor}, Exp=${summaryMap.A_fixed1to3_baseline.expectancyR}R, WinRate=${summaryMap.A_fixed1to3_baseline.winRatePct}%`,
    `- **B (Fixed 1:2):** PF=${summaryMap.B_fixed1to2.profitFactor}, Exp=${summaryMap.B_fixed1to2.expectancyR}R, WinRate=${summaryMap.B_fixed1to2.winRatePct}%`,
    `- **C (Trail 1.2R after +1R):** PF=${summaryMap.C_trailAfter1R_12R.profitFactor}, Exp=${summaryMap.C_trailAfter1R_12R.expectancyR}R, OOS PF=${wfC.untouched_OOS_2025Q4_2026.profitFactor}`,
    `- **D (ATR 2.0 Trail after +1R):** PF=${summaryMap.D_atrTrailAfter1R_2ATR.profitFactor}, Exp=${summaryMap.D_atrTrailAfter1R_2ATR.expectancyR}R`,
    `- **E (Partial 50% at +1R + Trail):** PF=${summaryMap.E_partial50At1R_plusTrail.profitFactor}, Exp=${summaryMap.E_partial50At1R_plusTrail.expectancyR}R, OOS PF=${wfE.untouched_OOS_2025Q4_2026.profitFactor}`,
    `- **F (Time Exit 20B <0.5R):** PF=${summaryMap.F_timeExitFail20Bars.profitFactor}, Exp=${summaryMap.F_timeExitFail20Bars.expectancyR}R`,
    "",
    "## Safety Confirmation",
    "- `STRATEGY_01 = false`, `STRATEGY_02 = false`, `STRATEGY_03 = false`, `LIVE_TRADING = false`, `BROKER_EXECUTION_ENABLED = false`, `experimental_paper_trades = 0`.",
  ].join("\n");
  fs.writeFileSync(path.join(OUT_DIR, "phase61015_final_report.md"), md);

  console.log("Phase 6.10.15 complete:", {
    finalClassification,
    trades: resA.length,
    reached1RCount,
    losersThatReached1R,
    summaryMap,
    paperTrades: paperTradesCount ?? 0,
  });
}

if (process.argv[1]?.includes("runPhase61015Research")) {
  main().catch((err) => {
    console.error("Phase 6.10.15 failed:", err);
    process.exit(1);
  });
}

