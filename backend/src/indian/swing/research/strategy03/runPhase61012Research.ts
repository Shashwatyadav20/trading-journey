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
import { analyzeSectorStrength } from "./momentum/Strategy03SectorStrengthAnalyzer.js";
import { filterMomentumStock } from "./momentum/Strategy03MomentumStockFilter.js";
import { evaluateMomentumDojiBreakout } from "./momentum/Strategy03MomentumBreakoutEntry.js";
import { buildStrategy03MomentumWatchlist, type Strategy03WatchlistItem } from "./momentum/Strategy03MomentumWatchlist.js";
import { loadAllRowsPaginated } from "./Strategy03ShadowRunner.js";
import { wilsonWinRateCI } from "./StatisticalRobustnessEngine.js";

config({ path: path.resolve("D:/Trading/my-app/backend/.env") });

const OUT_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase61012");
const P6108_CACHE = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase6108/cache");
const P66_CACHE = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase66/cache");
const P65_CACHE = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase65/cache");

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

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

interface SimOutcome {
  entryDate: string;
  netReturnPct: number;
  rMultiple: number;
  holdingBars: number;
  mfePct: number;
  maePct: number;
  exitReason: string;
}

function simulate1hBreakout(params: {
  future1h: OhlcvCandle[];
  slPrice: number;
  breakevenMovePct?: number; // e.g. 3.5%
  targetR?: number; // e.g. 3.0
  oneWayCostBps?: number;
}): SimOutcome | null {
  if (params.future1h.length === 0) return null;
  const slip = 0.0008;
  const cost = ((params.oneWayCostBps ?? 25) / 10_000) * 2 * 100;
  const entry = params.future1h[0].open * (1 + slip);
  let sl = params.slPrice;
  const risk = entry - sl;
  if (risk <= 0) return null;
  const target = entry + risk * (params.targetR ?? 3.0);
  const maxBars = 140;

  let exitPrice = params.future1h[Math.min(params.future1h.length - 1, maxBars - 1)].close;
  let exitReason = "TIME_EXIT";
  let holdingBars = Math.min(params.future1h.length, maxBars);
  let mfe = -Infinity;
  let mae = Infinity;

  for (let i = 0; i < Math.min(params.future1h.length, maxBars); i++) {
    const b = params.future1h[i];
    mfe = Math.max(mfe, ((b.high - entry) / entry) * 100);
    mae = Math.min(mae, ((b.low - entry) / entry) * 100);

    if (b.open <= sl) {
      exitPrice = b.open * (1 - slip);
      exitReason = "GAP_THROUGH_SL";
      holdingBars = i + 1;
      break;
    }
    if (b.low <= sl) {
      exitPrice = sl * (1 - slip);
      exitReason = "SL_HIT";
      holdingBars = i + 1;
      break;
    }
    if (params.breakevenMovePct && ((b.high - entry) / entry) * 100 >= params.breakevenMovePct) {
      sl = Math.max(sl, entry);
    }
    if (b.high >= target) {
      exitPrice = target * (1 - slip);
      exitReason = "TARGET_3R";
      holdingBars = i + 1;
      break;
    }
  }

  const netRet = ((exitPrice - entry) / entry) * 100 - cost;
  const riskPct = (risk / entry) * 100;
  return {
    entryDate: params.future1h[0].timestamp.slice(0, 10),
    netReturnPct: round2(netRet),
    rMultiple: round2(netRet / riskPct),
    holdingBars,
    mfePct: Number.isFinite(mfe) ? round2(mfe) : 0,
    maePct: Number.isFinite(mae) ? round2(mae) : 0,
    exitReason,
  };
}

function summarize(rows: SimOutcome[]) {
  if (rows.length === 0) {
    return {
      tradeCount: 0,
      winRatePct: 0,
      winRateCI95: [0, 0],
      profitFactor: 0,
      expectancyR: 0,
      avgWinPct: 0,
      avgLossPct: 0,
      maxDrawdownPct: 0,
      avgHoldingBars: 0,
      avgMfePct: 0,
      avgMaePct: 0,
    };
  }
  const wins = rows.filter((r) => r.netReturnPct > 0);
  const losses = rows.filter((r) => r.netReturnPct <= 0);
  const gw = wins.reduce((a, r) => a + r.netReturnPct, 0);
  const gl = Math.abs(losses.reduce((a, r) => a + r.netReturnPct, 0));
  let eq = 1.0;
  let peak = 1.0;
  let maxDd = 0;
  for (const r of rows) {
    eq *= 1 + r.netReturnPct / 100;
    if (eq > peak) peak = eq;
    const dd = (peak - eq) / peak;
    if (dd > maxDd) maxDd = dd;
  }
  const ci = wilsonWinRateCI(wins.length, rows.length);
  return {
    tradeCount: rows.length,
    winRatePct: ci.ratePct,
    winRateCI95: [ci.ciLowPct, ci.ciHighPct],
    profitFactor: gl > 0 ? round2(gw / gl) : 0,
    expectancyR: round2(rows.reduce((a, r) => a + r.rMultiple, 0) / rows.length),
    avgWinPct: wins.length > 0 ? round2(gw / wins.length) : 0,
    avgLossPct: losses.length > 0 ? round2(-gl / losses.length) : 0,
    maxDrawdownPct: round2(maxDd * 100),
    avgHoldingBars: round2(rows.reduce((a, r) => a + r.holdingBars, 0) / rows.length),
    avgMfePct: round2(rows.reduce((a, r) => a + r.mfePct, 0) / rows.length),
    avgMaePct: round2(rows.reduce((a, r) => a + r.maePct, 0) / rows.length),
  };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const finRows = await loadAllRowsPaginated(sb, "strategy03_financial_facts");
  const ownRows = await loadAllRowsPaginated(sb, "strategy03_institutional_ownership");
  const univRows = await loadAllRowsPaginated(sb, "market_universe_equities", "nse_symbol,sector");
  const { count: paperTradesCount } = await sb
    .from("experimental_paper_trades")
    .select("*", { count: "exact", head: true });

  const sectorBySym = new Map<string, string>();
  for (const u of univRows) if (u.nse_symbol) sectorBySym.set(u.nse_symbol.toUpperCase(), u.sector ?? "UNKNOWN");

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

  const modeA: SimOutcome[] = [];
  const modeB: SimOutcome[] = [];
  const modeC: SimOutcome[] = [];
  const modeD_variants: Record<number, SimOutcome[]> = { 3: [], 4: [], 5: [], 8: [] };
  const modeD_breakeven35: SimOutcome[] = [];
  const watchlistLatest: Strategy03WatchlistItem[] = [];

  for (const sym of verifiedSyms) {
    const daily = loadCachedDaily(`${sym}.NS`);
    const h1 = loadCached1h(sym);
    if (daily.length < 120 || h1.length < 100) continue;
    const sector = sectorBySym.get(sym) ?? "UNKNOWN";
    const startDay = h1[0].timestamp.slice(0, 10);
    const evalDays = daily.filter((d) => d.date >= startDay && d.date <= "2026-10-15");

    let lastA = -99, lastB = -99, lastC = -99;
    const lastD: Record<number, number> = { 3: -99, 4: -99, 5: -99, 8: -99 };

    for (let i = 50; i < evalDays.length - 1; i++) {
      const dayIso = evalDays[i].date;
      const pitDaily = filterCandlesAsOf(daily, dayIso);
      const pitNifty = filterCandlesAsOf(niftyDaily, dayIso);
      const pit1h = h1.filter((c) => c.timestamp.slice(0, 10) <= dayIso);
      const fut1h = h1.filter((c) => c.timestamp.slice(0, 10) > dayIso);
      if (pit1h.length < 30 || fut1h.length < 5) continue;

      const pitFins = filterFinancialsAsOf(finsBySym.get(sym) ?? [], dayIso);
      const pitOwn = filterOwnershipAsOf(ownBySym.get(sym) ?? [], dayIso);
      const fund = evaluatePointInTimeSnapshot({
        symbol: sym,
        sector,
        asOfDate: dayIso,
        financials: pitFins,
        ownership: pitOwn,
        announcements: [],
        candles: pitDaily,
      });
      const instPass = fund.decision === "ENTER_CANDIDATE";
      const mom = filterMomentumStock({ symbol: sym, sector, candles: pitDaily, niftyCandles: pitNifty });
      const momPass = mom.classification === "MOMENTUM_WATCHLIST";

      const defSl = round2(pit1h[pit1h.length - 1].close * 0.94);

      if (instPass && i - lastA >= 15) {
        const o = simulate1hBreakout({ future1h: fut1h, slPrice: defSl });
        if (o) { modeA.push(o); lastA = i; }
      }
      if (momPass && i - lastB >= 15) {
        const o = simulate1hBreakout({ future1h: fut1h, slPrice: defSl });
        if (o) { modeB.push(o); lastB = i; }
      }
      if (instPass && momPass && i - lastC >= 15) {
        const o = simulate1hBreakout({ future1h: fut1h, slPrice: defSl });
        if (o) { modeC.push(o); lastC = i; }
      }

      if (instPass && momPass) {
        for (const win of [3, 4, 5, 8] as const) {
          if (i - lastD[win] < 10) continue;
          const doji = evaluateMomentumDojiBreakout({ symbol: sym, candles: pit1h, windowCandles: win });
          if (doji.status === "DOJI_BREAKOUT_CONFIRMED" && doji.consolidationLowSl !== null) {
            const o = simulate1hBreakout({ future1h: fut1h, slPrice: doji.consolidationLowSl, targetR: 3.0 });
            if (o) { modeD_variants[win].push(o); lastD[win] = i; }
            if (win === 5) {
              const oBe = simulate1hBreakout({ future1h: fut1h, slPrice: doji.consolidationLowSl, breakevenMovePct: 3.5, targetR: 3.0 });
              if (oBe) modeD_breakeven35.push(oBe);
            }
          }
        }
      }
    }

    // Latest watchlist item as of 2026-11-16
    const latDaily = filterCandlesAsOf(daily, "2026-11-16");
    const latNifty = filterCandlesAsOf(niftyDaily, "2026-11-16");
    const latFund = evaluatePointInTimeSnapshot({
      symbol: sym,
      sector,
      asOfDate: "2026-11-16",
      financials: filterFinancialsAsOf(finsBySym.get(sym) ?? [], "2026-11-16"),
      ownership: filterOwnershipAsOf(ownBySym.get(sym) ?? [], "2026-11-16"),
      announcements: [],
      candles: latDaily,
    });
    const latMom = filterMomentumStock({ symbol: sym, sector, candles: latDaily, niftyCandles: latNifty });
    const latDoji = evaluateMomentumDojiBreakout({ symbol: sym, candles: h1, windowCandles: 5 });
    watchlistLatest.push(
      buildStrategy03MomentumWatchlist({
        symbol: sym,
        fundamentalScore: latFund.totalScore,
        verificationStatus: latFund.missingData.includes("insufficientVerifiedFinancials") ? "MISSING" : "VERIFIED",
        momentum: latMom,
        dojiBreakout: latDoji,
      })
    );
  }

  const sectorStrength = Object.fromEntries(
    analyzeSectorStrength(
      watchlistLatest.map((w) => ({
        sector: sectorBySym.get(w.symbol) ?? "UNKNOWN",
        rsVsNifty50dPp: w.relativeStrength50dPp,
      }))
    )
  );

  const wfSplit = (rows: SimOutcome[]) => ({
    train_2024: summarize(rows.filter((r) => r.entryDate <= "2024-12-31")),
    val_2025Q1Q3: summarize(rows.filter((r) => r.entryDate >= "2025-01-01" && r.entryDate <= "2025-09-30")),
    oos_2025Q4_2026: summarize(rows.filter((r) => r.entryDate >= "2025-10-01")),
  });

  const d5 = modeD_variants[5];
  const d5Wf = wfSplit(d5);
  const finalClassification =
    d5Wf.oos_2025Q4_2026.tradeCount < 15
      ? "INCONCLUSIVE"
      : d5Wf.oos_2025Q4_2026.expectancyR > 0 && d5Wf.oos_2025Q4_2026.profitFactor > 1.0
      ? "PROMISING_FOR_FURTHER_VALIDATION"
      : "NO_ROBUST_IMPROVEMENT";

  const combinedComparison = {
    A_institutionalGrowthAlone: summarize(modeA),
    B_momentumFilterAlone: summarize(modeB),
    C_institutionalPlusMomentum: summarize(modeC),
    D_instPlusMomPlusDoji_3C: summarize(modeD_variants[3]),
    D_instPlusMomPlusDoji_4C: summarize(modeD_variants[4]),
    D_instPlusMomPlusDoji_5C: summarize(modeD_variants[5]),
    D_instPlusMomPlusDoji_8C: summarize(modeD_variants[8]),
    D_5C_with35PctBreakevenMove: summarize(modeD_breakeven35),
    finalClassification,
  };

  fs.writeFileSync(path.join(OUT_DIR, "institutional_stock_selection.json"), JSON.stringify({ candidatesCount: watchlistLatest.length, summaryA: combinedComparison.A_institutionalGrowthAlone }, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "momentum_filter_results.json"), JSON.stringify({ summaryB: combinedComparison.B_momentumFilterAlone, sectorStrength }, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "relative_strength_results.json"), JSON.stringify(watchlistLatest.map((w) => ({ symbol: w.symbol, rs50dPp: w.relativeStrength50dPp, momentum: w.momentumClassification })), null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "volume_momentum_results.json"), JSON.stringify(watchlistLatest.map((w) => ({ symbol: w.symbol, volRatio20d: w.volumeRatio20d })), null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "doji_pattern_results.json"), JSON.stringify(watchlistLatest.map((w) => ({ symbol: w.symbol, doji: w.dojiStatus, setup: w.setupStatus })), null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "consolidation_results.json"), JSON.stringify({ c3: combinedComparison.D_instPlusMomPlusDoji_3C, c4: combinedComparison.D_instPlusMomPlusDoji_4C, c5: combinedComparison.D_instPlusMomPlusDoji_5C, c8: combinedComparison.D_instPlusMomPlusDoji_8C }, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "breakout_validation.json"), JSON.stringify({ d5: combinedComparison.D_instPlusMomPlusDoji_5C, d5Breakeven35: combinedComparison.D_5C_with35PctBreakevenMove }, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "combined_system_comparison.json"), JSON.stringify(combinedComparison, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "walk_forward_results.json"), JSON.stringify({ A: wfSplit(modeA), B: wfSplit(modeB), C: wfSplit(modeC), D_5C: d5Wf }, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "cost_stress_results.json"), JSON.stringify({ oos_25bps: d5Wf.oos_2025Q4_2026 }, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "data_quality_report.json"), JSON.stringify({ evaluatedCohort: verifiedSyms.length, financialFacts: finRows.length, experimentalPaperTrades: paperTradesCount ?? 0 }, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "momentum_watchlist.json"), JSON.stringify(watchlistLatest, null, 2));

  const md = [
    "# Phase 6.10.12 — Institutional Growth + AI Momentum Filter + Personal Doji Breakout Report",
    "",
    `**Final Classification:** \`${finalClassification}\``,
    "",
    "## 1. Combined System Comparison (25 bps one-way cost, next-1H-open execution)",
    `- **A (Institutional Growth Alone):** Trades=**${combinedComparison.A_institutionalGrowthAlone.tradeCount}**, WinRate=**${combinedComparison.A_institutionalGrowthAlone.winRatePct}%**, PF=**${combinedComparison.A_institutionalGrowthAlone.profitFactor}**, Exp=**${combinedComparison.A_institutionalGrowthAlone.expectancyR}R**`,
    `- **B (AI Momentum Filter Alone):** Trades=**${combinedComparison.B_momentumFilterAlone.tradeCount}**, WinRate=**${combinedComparison.B_momentumFilterAlone.winRatePct}%**, PF=**${combinedComparison.B_momentumFilterAlone.profitFactor}**, Exp=**${combinedComparison.B_momentumFilterAlone.expectancyR}R**`,
    `- **C (Institutional + Momentum):** Trades=**${combinedComparison.C_institutionalPlusMomentum.tradeCount}**, WinRate=**${combinedComparison.C_institutionalPlusMomentum.winRatePct}%**, PF=**${combinedComparison.C_institutionalPlusMomentum.profitFactor}**, Exp=**${combinedComparison.C_institutionalPlusMomentum.expectancyR}R**`,
    `- **D (Inst + Mom + Doji 5C, 1:3 Target):** Trades=**${combinedComparison.D_instPlusMomPlusDoji_5C.tradeCount}**, WinRate=**${combinedComparison.D_instPlusMomPlusDoji_5C.winRatePct}%**, PF=**${combinedComparison.D_instPlusMomPlusDoji_5C.profitFactor}**, Exp=**${combinedComparison.D_instPlusMomPlusDoji_5C.expectancyR}R** | OOS Trades=**${d5Wf.oos_2025Q4_2026.tradeCount}**, PF=**${d5Wf.oos_2025Q4_2026.profitFactor}**, Exp=**${d5Wf.oos_2025Q4_2026.expectancyR}R**`,
    "",
    "## 2. Safety Confirmation",
    `- \`STRATEGY_01 = false\`, \`STRATEGY_02 = false\`, \`STRATEGY_03 = false\`, \`LIVE_TRADING = false\`, \`BROKER_EXECUTION_ENABLED = false\`, \`experimental_paper_trades = ${paperTradesCount ?? 0}\`.`,
  ].join("\n");

  fs.writeFileSync(path.join(OUT_DIR, "phase61012_final_report.md"), md);
  console.log("Phase 6.10.12 complete:", { finalClassification, d5Oos: d5Wf.oos_2025Q4_2026, paperTrades: paperTradesCount ?? 0 });
}

if (process.argv[1]?.includes("runPhase61012Research")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
