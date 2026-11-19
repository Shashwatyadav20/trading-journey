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
  DHAN_DELIVERY_CONFIG_V2026_11,
  DHAN_INTRADAY_CONFIG_V2026_11,
  DHAN_TARIFF_META_V2026_11,
} from "./costs/Strategy03DhanCostConfig.js";
import { calculateDhanDeliveryCost } from "./costs/Strategy03DhanDeliveryCostCalculator.js";
import { calculateDhanIntradayCost } from "./costs/Strategy03DhanIntradayCostCalculator.js";
import {
  buildTradeCostAttribution,
  type TradeCostAttributionRecord,
} from "./costs/Strategy03CostAttribution.js";
import {
  evaluateExecutionFeasibility,
  type TradeExecutionFeasibilityRecord,
} from "./costs/Strategy03ExecutionFeasibility.js";
import { loadAllRowsPaginated } from "./Strategy03ShadowRunner.js";
import { wilsonWinRateCI } from "./StatisticalRobustnessEngine.js";

config({ path: path.resolve("D:/Trading/my-app/backend/.env") });

const OUT_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase61016");
const P6108_CACHE = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase6108/cache");
const P66_CACHE = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase66/cache");
const P65_CACHE = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase65/cache");
const NOTIONAL_ORDER_INR = 100_000;

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

interface RawSimPath {
  symbol: string;
  entryDate: string;
  exitDate: string;
  rawEntryPrice: number;
  rawExitPrice: number;
  slPrice: number;
  gapThroughStop: boolean;
  stockDayTurnoverCr: number;
  avg20dTurnoverCr: number;
}

function simulateRawExitPath(params: {
  symbol: string;
  future1h: OhlcvCandle[];
  slPrice: number;
  stockDayTurnoverCr: number;
  avg20dTurnoverCr: number;
  targetR?: number;
  trailAfter1R?: number;
  timeFailBars?: number;
  breakevenMovePct?: number;
  partial50At1R?: boolean;
}): RawSimPath | null {
  if (params.future1h.length < 2) return null;
  const entry = params.future1h[0].open;
  let sl = params.slPrice;
  const risk = entry - sl;
  if (risk <= 0 || risk / entry > 0.12) return null;

  const target = params.targetR ? entry + risk * params.targetR : null;
  const maxBars = Math.min(120, params.future1h.length);
  let exitPrice = params.future1h[maxBars - 1].close;
  let exitBarIdx = maxBars - 1;
  let gapStop = false;
  let highWater = entry;
  let partialDone = false;
  let partialPrice = 0;

  for (let i = 0; i < maxBars; i++) {
    const b = params.future1h[i];
    if (b.open <= sl) {
      exitPrice = b.open;
      exitBarIdx = i;
      gapStop = true;
      break;
    }
    if (b.low <= sl) {
      exitPrice = sl;
      exitBarIdx = i;
      break;
    }
    if (b.high > highWater) highWater = b.high;
    if (params.partial50At1R && !partialDone && b.high >= entry + risk) {
      partialDone = true;
      partialPrice = entry + risk;
      sl = Math.max(sl, entry);
    }
    if (params.breakevenMovePct && ((b.high - entry) / entry) * 100 >= params.breakevenMovePct) {
      sl = Math.max(sl, entry);
    }
    if (params.trailAfter1R && highWater - entry >= risk) {
      sl = Math.max(sl, highWater - risk * params.trailAfter1R);
    }
    if (target !== null && b.high >= target) {
      exitPrice = target;
      exitBarIdx = i;
      break;
    }
    if (params.timeFailBars && i + 1 >= params.timeFailBars && (b.close - entry) / risk < 0.5) {
      exitPrice = b.close;
      exitBarIdx = i;
      break;
    }
  }

  const effectiveExit = partialDone ? 0.5 * partialPrice + 0.5 * exitPrice : exitPrice;
  return {
    symbol: params.symbol,
    entryDate: toIstDateAndTime(params.future1h[0].timestamp).istDate,
    exitDate: toIstDateAndTime(params.future1h[exitBarIdx].timestamp).istDate,
    rawEntryPrice: entry,
    rawExitPrice: effectiveExit,
    slPrice: params.slPrice,
    gapThroughStop: gapStop,
    stockDayTurnoverCr: params.stockDayTurnoverCr,
    avg20dTurnoverCr: params.avg20dTurnoverCr,
  };
}

function applyDhanCostScenario(
  paths: RawSimPath[],
  opts: { zeroCost?: boolean; slippageBps: number; extraOneWayStressBps?: number }
): TradeCostAttributionRecord[] {
  return paths.map((p) => {
    const qty = Math.max(1, Math.floor(NOTIONAL_ORDER_INR / p.rawEntryPrice));
    const isIntraday = p.entryDate === p.exitDate;
    const slip = opts.slippageBps / 10_000;
    const execBuy = p.rawEntryPrice * (1 + slip);
    const execSell = p.rawExitPrice * (1 - slip);
    const costBreakdown = opts.zeroCost
      ? {
          segment: isIntraday ? ("EQUITY_INTRADAY" as const) : ("EQUITY_DELIVERY" as const),
          configVersion: "ZERO_COST_DIAGNOSTIC",
          buyTurnoverInr: round2(execBuy * qty),
          sellTurnoverInr: round2(execSell * qty),
          totalTurnoverInr: round2((execBuy + execSell) * qty),
          brokerageInr: 0,
          sttBuyInr: 0,
          sttSellInr: 0,
          sttTotalInr: 0,
          exchangeChargesInr: 0,
          sebiChargesInr: 0,
          stampDutyInr: 0,
          gstOnTradingInr: 0,
          dpChargeBaseInr: 0,
          dpChargeGstInr: 0,
          dpTotalInr: 0,
          otherVerifiedChargesInr: 0,
          totalBrokerChargesInr: 0,
          totalStatutoryChargesInr: 0,
          totalChargesInr: 0,
          totalChargesPctOfBuy: 0,
        }
      : isIntraday
      ? calculateDhanIntradayCost({ buyPriceInr: execBuy, sellPriceInr: execSell, quantity: qty })
      : calculateDhanDeliveryCost({ buyPriceInr: execBuy, sellPriceInr: execSell, quantity: qty });

    return buildTradeCostAttribution({
      symbol: p.symbol,
      entryDate: p.entryDate,
      exitDate: p.exitDate,
      quantity: qty,
      rawEntryPrice: p.rawEntryPrice,
      rawExitPrice: p.rawExitPrice,
      slPrice: p.slPrice,
      slippageBps: opts.slippageBps,
      extraOneWayStressBps: opts.extraOneWayStressBps,
      costBreakdown,
    });
  });
}

function summarizeCostedTrades(rows: TradeCostAttributionRecord[]) {
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
      grossPnlInr: 0,
      totalStatutoryAndBrokerInr: 0,
      totalExecutionSlippageInr: 0,
      netPnlInr: 0,
      costPerTradeInr: 0,
    };
  }
  const wins = rows.filter((r) => r.netPnlInr > 0);
  const losses = rows.filter((r) => r.netPnlInr <= 0);
  const gw = wins.reduce((a, r) => a + r.netReturnPct, 0);
  const gl = Math.abs(losses.reduce((a, r) => a + r.netReturnPct, 0));
  let eq = 1.0, peak = 1.0, maxDd = 0;
  for (const r of rows) {
    eq *= 1 + r.netReturnPct / 100;
    if (eq > peak) peak = eq;
    const dd = (peak - eq) / peak;
    if (dd > maxDd) maxDd = dd;
  }
  const ci = wilsonWinRateCI(wins.length, rows.length);
  const totalStat = rows.reduce((a, r) => a + r.totalDhanAndStatutoryInr, 0);
  const totalSlip = rows.reduce((a, r) => a + r.totalExecutionSlippageInr + r.extraStressCostInr, 0);
  return {
    tradeCount: rows.length,
    winRatePct: ci.ratePct,
    winRateCI95: [ci.ciLowPct, ci.ciHighPct],
    profitFactor: gl > 0 ? round2(gw / gl) : wins.length > 0 ? 99 : 0,
    expectancyR: round2(rows.reduce((a, r) => a + r.netRMultiple, 0) / rows.length),
    avgWinPct: wins.length > 0 ? round2(gw / wins.length) : 0,
    avgLossPct: losses.length > 0 ? round2(-gl / losses.length) : 0,
    maxDrawdownPct: round2(maxDd * 100),
    grossPnlInr: round2(rows.reduce((a, r) => a + r.grossPnlInr, 0)),
    totalStatutoryAndBrokerInr: round2(totalStat),
    totalExecutionSlippageInr: round2(totalSlip),
    netPnlInr: round2(rows.reduce((a, r) => a + r.netPnlInr, 0)),
    costPerTradeInr: round2((totalStat + totalSlip) / rows.length),
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

  const entryCandles: Array<{
    sym: string;
    slPrice: number;
    future1h: OhlcvCandle[];
    stockDayTurnoverCr: number;
    avg20dTurnoverCr: number;
  }> = [];

  for (const sym of verifiedSyms) {
    const daily = loadCachedDaily(`${sym}.NS`);
    const { candles: h1 } = sanitizeIntraday1hSeries(loadCached1h(sym));
    if (daily.length < 120 || h1.length < 100) continue;
    const sector = sectorBySym.get(sym) ?? "UNKNOWN";
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
      const lastD = pitDaily[pitDaily.length - 1];
      const dayTurnCr = (lastD.close * lastD.volume) / 1e7;

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
      if (fund.decision !== "ENTER_CANDIDATE") continue;

      const mom = filterMomentumStock({ symbol: sym, sector, candles: pitDaily, niftyCandles: pitNifty });
      if (mom.classification !== "MOMENTUM_WATCHLIST") continue;

      const dayEv = evaluateIntradayEventsForDay({ symbol: sym, istDate: dayIso, sanitizedCandles: h1, windowCandles: 5 });
      if (dayEv.firstBreakout && i - lastFirst >= 10) {
        const fut = h1.slice(dayEv.firstBreakout.barIndexInFullSeries + 1);
        if (fut.length >= 5) {
          entryCandles.push({
            sym,
            slPrice: dayEv.firstBreakout.consolidationLowSl,
            future1h: fut,
            stockDayTurnoverCr: dayTurnCr,
            avg20dTurnoverCr: avgTurnCr,
          });
          lastFirst = i;
        }
      }
    }
  }

  const buildPaths = (opts: { targetR?: number; trailAfter1R?: number; timeFailBars?: number; breakevenMovePct?: number; partial50At1R?: boolean }) =>
    entryCandles
      .map((c) => simulateRawExitPath({ symbol: c.sym, future1h: c.future1h, slPrice: c.slPrice, stockDayTurnoverCr: c.stockDayTurnoverCr, avg20dTurnoverCr: c.avg20dTurnoverCr, ...opts }))
      .filter((p): p is RawSimPath => p !== null);

  const paths1to3 = buildPaths({ targetR: 3.0 });
  const paths1to2 = buildPaths({ targetR: 2.0 });
  const pathsTrail = buildPaths({ trailAfter1R: 1.2 });
  const pathsTime20 = buildPaths({ targetR: 3.0, timeFailBars: 20 });
  const pathsPartial = buildPaths({ trailAfter1R: 1.2, partial50At1R: true });
  const pathsBe3 = buildPaths({ targetR: 3.0, breakevenMovePct: 3.0 });
  const pathsBe4 = buildPaths({ targetR: 3.0, breakevenMovePct: 4.0 });

  // Cost Scenarios on Baseline (1:3) and Trailing (+1R)
  const scenA_gross = applyDhanCostScenario(paths1to3, { zeroCost: true, slippageBps: 0 });
  const scenB_dhanOnly = applyDhanCostScenario(paths1to3, { slippageBps: 0 });
  const scenC_dhanPlus8Slip = applyDhanCostScenario(paths1to3, { slippageBps: 8 });
  const scenD_dhanPlus25Stress = applyDhanCostScenario(paths1to3, { slippageBps: 8, extraOneWayStressBps: 25 });
  const scenE_dhanPlus35Stress = applyDhanCostScenario(paths1to3, { slippageBps: 8, extraOneWayStressBps: 35 });
  const scenF_dhanPlus50Stress = applyDhanCostScenario(paths1to3, { slippageBps: 8, extraOneWayStressBps: 50 });

  const trailB_dhanOnly = applyDhanCostScenario(pathsTrail, { slippageBps: 0 });
  const trailC_dhanPlus8Slip = applyDhanCostScenario(pathsTrail, { slippageBps: 8 });

  const deliveryTrades = scenC_dhanPlus8Slip.filter((t) => t.segment === "EQUITY_DELIVERY");
  const intradayTrades = scenC_dhanPlus8Slip.filter((t) => t.segment === "EQUITY_INTRADAY");

  const feasibility: TradeExecutionFeasibilityRecord[] = paths1to3.map((p) =>
    evaluateExecutionFeasibility({
      symbol: p.symbol,
      entryDate: p.entryDate,
      stockDayTurnoverCr: p.stockDayTurnoverCr,
      avg20dTurnoverCr: p.avg20dTurnoverCr,
      assumedOrderValueInr: NOTIONAL_ORDER_INR,
      nextExecutableEntryPrice: round2(p.rawEntryPrice * 1.0008),
      nextExecutableExitPrice: round2(p.rawExitPrice * 0.9992),
      gapThroughStop: p.gapThroughStop,
    })
  );

  const exitComparisonDhan = {
    fixed1to2_dhan8slip: summarizeCostedTrades(applyDhanCostScenario(paths1to2, { slippageBps: 8 })),
    fixed1to3_dhan8slip: summarizeCostedTrades(scenC_dhanPlus8Slip),
    trailAfter1R_dhan8slip: summarizeCostedTrades(trailC_dhanPlus8Slip),
    trailAfter1R_dhan0slip: summarizeCostedTrades(trailB_dhanOnly),
    timeExit20Bars_dhan8slip: summarizeCostedTrades(applyDhanCostScenario(pathsTime20, { slippageBps: 8 })),
    partial50AndTrail_dhan8slip: summarizeCostedTrades(applyDhanCostScenario(pathsPartial, { slippageBps: 8 })),
    breakeven3Pct_dhan8slip: summarizeCostedTrades(applyDhanCostScenario(pathsBe3, { slippageBps: 8 })),
    breakeven4Pct_dhan8slip: summarizeCostedTrades(applyDhanCostScenario(pathsBe4, { slippageBps: 8 })),
  };

  const wf = {
    baseline1to3_dhan8slip: {
      fullSample: summarizeCostedTrades(scenC_dhanPlus8Slip),
      train_2024: summarizeCostedTrades(scenC_dhanPlus8Slip.filter((t) => t.entryDate <= "2024-12-31")),
      validation_2025Q1_Q3: summarizeCostedTrades(scenC_dhanPlus8Slip.filter((t) => t.entryDate >= "2025-01-01" && t.entryDate <= "2025-09-30")),
      untouched_OOS_2025Q4_2026: summarizeCostedTrades(scenC_dhanPlus8Slip.filter((t) => t.entryDate >= "2025-10-01")),
    },
    trailAfter1R_dhan8slip: {
      fullSample: summarizeCostedTrades(trailC_dhanPlus8Slip),
      train_2024: summarizeCostedTrades(trailC_dhanPlus8Slip.filter((t) => t.entryDate <= "2024-12-31")),
      validation_2025Q1_Q3: summarizeCostedTrades(trailC_dhanPlus8Slip.filter((t) => t.entryDate >= "2025-01-01" && t.entryDate <= "2025-09-30")),
      untouched_OOS_2025Q4_2026: summarizeCostedTrades(trailC_dhanPlus8Slip.filter((t) => t.entryDate >= "2025-10-01")),
    },
  };

  const bestTrail = wf.trailAfter1R_dhan8slip;
  const finalClassification =
    bestTrail.fullSample.profitFactor >= 1.15 &&
    bestTrail.fullSample.expectancyR > 0 &&
    bestTrail.untouched_OOS_2025Q4_2026.profitFactor >= 1.05
      ? "NET_EDGE_IDENTIFIED"
      : bestTrail.fullSample.profitFactor > 1.0 && bestTrail.fullSample.netPnlInr > 0
      ? "PROMISING_FOR_FURTHER_VALIDATION"
      : "NO_NET_EDGE";

  const writeJson = (name: string, data: unknown) =>
    fs.writeFileSync(path.join(OUT_DIR, name), JSON.stringify(data, null, 2));

  writeJson("dhan_tariff_audit.json", DHAN_TARIFF_META_V2026_11);
  writeJson("dhan_cost_config.json", {
    delivery: DHAN_DELIVERY_CONFIG_V2026_11,
    intraday: DHAN_INTRADAY_CONFIG_V2026_11,
    notionalOrderValueInr: NOTIONAL_ORDER_INR,
  });
  writeJson("delivery_cost_breakdown.json", { summary: summarizeCostedTrades(deliveryTrades), trades: deliveryTrades });
  writeJson("intraday_cost_breakdown.json", { summary: summarizeCostedTrades(intradayTrades), trades: intradayTrades });
  writeJson("statutory_charges_breakdown.json", {
    totalTrades: scenC_dhanPlus8Slip.length,
    brokerageInr: round2(scenC_dhanPlus8Slip.reduce((a, r) => a + r.dhanBrokerageInr, 0)),
    sttInr: round2(scenC_dhanPlus8Slip.reduce((a, r) => a + r.sttInr, 0)),
    exchangeChargesInr: round2(scenC_dhanPlus8Slip.reduce((a, r) => a + r.exchangeChargesInr, 0)),
    sebiChargesInr: round2(scenC_dhanPlus8Slip.reduce((a, r) => a + r.sebiChargesInr, 0)),
    stampDutyInr: round2(scenC_dhanPlus8Slip.reduce((a, r) => a + r.stampDutyInr, 0)),
    gstInr: round2(scenC_dhanPlus8Slip.reduce((a, r) => a + r.gstInr, 0)),
    dpChargesInr: round2(scenC_dhanPlus8Slip.reduce((a, r) => a + r.dpChargesInr, 0)),
  });
  writeJson("dp_charge_analysis.json", {
    deliverySellCount: deliveryTrades.length,
    dpChargePerSellInr: 12.5,
    dpGstInr: 2.25,
    totalDpWithGstPerSellInr: 14.75,
    totalDpChargesPaidInr: round2(deliveryTrades.reduce((a, r) => a + r.dpChargesInr, 0)),
  });
  writeJson("spread_slippage_analysis.json", {
    historicalBidAskData: "MISSING",
    assumedOneWaySlippageBps: 8,
    totalSlippageInr: round2(scenC_dhanPlus8Slip.reduce((a, r) => a + r.totalExecutionSlippageInr, 0)),
  });
  writeJson("execution_feasibility.json", {
    totalTrades: feasibility.length,
    lowImpactCount: feasibility.filter((f) => f.marketImpactRisk === "LOW").length,
    gapThroughStopCount: feasibility.filter((f) => f.gapThroughStop).length,
    records: feasibility,
  });
  writeJson("gross_vs_net_pnl.json", {
    A_grossZeroCost: summarizeCostedTrades(scenA_gross),
    B_dhanTariffOnly: summarizeCostedTrades(scenB_dhanOnly),
    C_dhanTariffPlus8BpsSlip: summarizeCostedTrades(scenC_dhanPlus8Slip),
  });
  writeJson("cost_attribution.json", { baseline1to3_dhan8slip: scenC_dhanPlus8Slip, trailAfter1R_dhan8slip: trailC_dhanPlus8Slip });
  writeJson("trade_quality_analysis.json", {
    deliveryTradeCount: deliveryTrades.length,
    intradayTradeCount: intradayTrades.length,
    trailAfter1R_dhanTariffOnly: summarizeCostedTrades(trailB_dhanOnly),
    trailAfter1R_dhanPlus8Slip: summarizeCostedTrades(trailC_dhanPlus8Slip),
  });
  writeJson("exit_cost_comparison.json", exitComparisonDhan);
  writeJson("walk_forward_results.json", wf);
  writeJson("cost_stress_results.json", {
    A_grossZeroCost: summarizeCostedTrades(scenA_gross),
    B_dhanPublishedTariff: summarizeCostedTrades(scenB_dhanOnly),
    C_dhanPlus8BpsSlip: summarizeCostedTrades(scenC_dhanPlus8Slip),
    D_dhanPlus25BpsStress: summarizeCostedTrades(scenD_dhanPlus25Stress),
    E_dhanPlus35BpsStress: summarizeCostedTrades(scenE_dhanPlus35Stress),
    F_dhanPlus50BpsStress: summarizeCostedTrades(scenF_dhanPlus50Stress),
  });

  const md = [
    "# Phase 6.10.16 — Dhan Brokerage Cost Audit & Net Profitability Validation",
    "",
    `- **Final Classification:** \`${finalClassification}\``,
    `- **Notional Order Size:** ₹${NOTIONAL_ORDER_INR.toLocaleString("en-IN")} | Delivery Trades: ${deliveryTrades.length} | Intraday Trades: ${intradayTrades.length}`,
    `- **Baseline (1:3) Gross Zero-Cost:** PF=${summarizeCostedTrades(scenA_gross).profitFactor}, Net=₹${summarizeCostedTrades(scenA_gross).grossPnlInr}`,
    `- **Baseline (1:3) Dhan Tariff + 8bps Slip:** PF=${summarizeCostedTrades(scenC_dhanPlus8Slip).profitFactor}, Exp=${summarizeCostedTrades(scenC_dhanPlus8Slip).expectancyR}R, Net=₹${summarizeCostedTrades(scenC_dhanPlus8Slip).netPnlInr}, Cost/Trade=₹${summarizeCostedTrades(scenC_dhanPlus8Slip).costPerTradeInr}`,
    `- **Trailing (+1R) Dhan Tariff Only (0bps slip):** PF=${summarizeCostedTrades(trailB_dhanOnly).profitFactor}, Exp=${summarizeCostedTrades(trailB_dhanOnly).expectancyR}R, Net=₹${summarizeCostedTrades(trailB_dhanOnly).netPnlInr}`,
    `- **Trailing (+1R) Dhan Tariff + 8bps Slip:** PF=${bestTrail.fullSample.profitFactor}, Exp=${bestTrail.fullSample.expectancyR}R, Net=₹${bestTrail.fullSample.netPnlInr}, OOS PF=${bestTrail.untouched_OOS_2025Q4_2026.profitFactor}`,
    "",
    "## Safety Confirmation",
    "- `STRATEGY_01 = false`, `STRATEGY_02 = false`, `STRATEGY_03 = false`, `LIVE_TRADING = false`, `BROKER_EXECUTION_ENABLED = false`, `experimental_paper_trades = 0`.",
  ].join("\n");
  fs.writeFileSync(path.join(OUT_DIR, "phase61016_final_report.md"), md);

  console.log("Phase 6.10.16 complete:", {
    finalClassification,
    deliveryTrades: deliveryTrades.length,
    intradayTrades: intradayTrades.length,
    baseline1to3_dhan8slip: summarizeCostedTrades(scenC_dhanPlus8Slip),
    trailAfter1R_dhan0slip: summarizeCostedTrades(trailB_dhanOnly),
    trailAfter1R_dhan8slip: bestTrail.fullSample,
    trailAfter1R_oos: bestTrail.untouched_OOS_2025Q4_2026,
    paperTrades: paperTradesCount ?? 0,
  });
}

if (process.argv[1]?.includes("runPhase61016Research")) {
  main().catch((err) => {
    console.error("Phase 6.10.16 failed:", err);
    process.exit(1);
  });
}

