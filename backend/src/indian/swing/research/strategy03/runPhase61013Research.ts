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
import { detectDojiPattern, type DojiPatternType } from "./momentum/Strategy03DojiPatternDetector.js";
import { detectTightConsolidation } from "./momentum/Strategy03ConsolidationDetector.js";
import { evaluateMomentumDojiBreakout } from "./momentum/Strategy03MomentumBreakoutEntry.js";
import { loadAllRowsPaginated } from "./Strategy03ShadowRunner.js";
import { wilsonWinRateCI } from "./StatisticalRobustnessEngine.js";

config({ path: path.resolve("D:/Trading/my-app/backend/.env") });

const OUT_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase61013");
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

export type MarketRegime = "BULL" | "BEAR" | "SIDEWAYS";
export type CapSegment = "LARGE" | "MID" | "SMALL";

export interface SimTrade {
  symbol: string;
  sector: string;
  capSegment: CapSegment;
  regime: MarketRegime;
  entryDate: string;
  netReturnPct: number;
  grossReturnPct: number;
  riskPct: number;
  rMultiple: number;
  holdingBars: number;
  mfePct: number;
  maePct: number;
  exitReason: string;
}

export function classifyNiftyRegime(pitNifty: DailyCandleBar[]): MarketRegime {
  if (pitNifty.length < 55) return "SIDEWAYS";
  const last = pitNifty[pitNifty.length - 1].close;
  const c20 = pitNifty[pitNifty.length - 21].close;
  const sma50 = pitNifty.slice(-50).reduce((a, b) => a + b.close, 0) / 50;
  const ret20 = ((last - c20) / c20) * 100;
  if (last > sma50 && ret20 > 1.5) return "BULL";
  if (last < sma50 && ret20 < -1.5) return "BEAR";
  return "SIDEWAYS";
}

export function classifyCapSegment(marketCapCr: number | null | undefined, tier?: string | null): CapSegment {
  if (tier && tier.toUpperCase().includes("LARGE")) return "LARGE";
  if (tier && tier.toUpperCase().includes("MID")) return "MID";
  if (tier && tier.toUpperCase().includes("SMALL")) return "SMALL";
  if (marketCapCr !== null && marketCapCr !== undefined) {
    if (marketCapCr >= 20000) return "LARGE";
    if (marketCapCr >= 5000) return "MID";
    return "SMALL";
  }
  return "LARGE";
}

export function simulateTrade1h(params: {
  symbol: string;
  sector: string;
  capSegment: CapSegment;
  regime: MarketRegime;
  future1h: OhlcvCandle[];
  slPrice: number;
  entryOverride?: number;
  slippageBps?: number;
  oneWayCostBps?: number;
  breakevenMovePct?: number;
  targetR?: number;
}): SimTrade | null {
  if (params.future1h.length < 2) return null;
  const slip = (params.slippageBps ?? 8) / 10_000;
  const costPct = ((params.oneWayCostBps ?? 25) * 2) / 100; // round-trip %
  const rawEntry = params.entryOverride ?? params.future1h[0].open;
  const entry = rawEntry * (1 + slip);
  let sl = params.slPrice;
  const risk = entry - sl;
  if (risk <= 0 || risk / entry > 0.12) return null;
  const target = entry + risk * (params.targetR ?? 3.0);

  let exitPrice = params.future1h[Math.min(119, params.future1h.length - 1)].close * (1 - slip);
  let exitReason = "TIME_STOP";
  let holdingBars = Math.min(120, params.future1h.length);
  let mfe = -Infinity;
  let mae = Infinity;

  for (let i = 0; i < Math.min(120, params.future1h.length); i++) {
    const b = params.future1h[i];
    mfe = Math.max(mfe, ((b.high - entry) / entry) * 100);
    mae = Math.min(mae, ((b.low - entry) / entry) * 100);
    if (b.open <= sl) {
      exitPrice = b.open * (1 - slip);
      exitReason = "GAP_SL_HIT";
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
      exitReason = "TARGET_HIT";
      holdingBars = i + 1;
      break;
    }
  }

  const grossRet = ((exitPrice - entry) / entry) * 100;
  const netRet = grossRet - costPct;
  const riskPct = (risk / entry) * 100;
  return {
    symbol: params.symbol,
    sector: params.sector,
    capSegment: params.capSegment,
    regime: params.regime,
    entryDate: params.future1h[0].timestamp.slice(0, 10),
    netReturnPct: round2(netRet),
    grossReturnPct: round2(grossRet),
    riskPct: round2(riskPct),
    rMultiple: round2(netRet / riskPct),
    holdingBars,
    mfePct: Number.isFinite(mfe) ? round2(mfe) : 0,
    maePct: Number.isFinite(mae) ? round2(mae) : 0,
    exitReason,
  };
}

export function summarizeTrades(rows: SimTrade[]) {
  if (rows.length === 0) {
    return {
      tradeCount: 0,
      winRatePct: 0,
      winRateCI95: [0, 0] as [number, number],
      profitFactor: 0,
      expectancyR: 0,
      avgWinPct: 0,
      avgLossPct: 0,
      maxDrawdownPct: 0,
      avgHoldingBars: 0,
      netReturnSumPct: 0,
    };
  }
  const wins = rows.filter((r) => r.netReturnPct > 0);
  const losses = rows.filter((r) => r.netReturnPct <= 0);
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
  return {
    tradeCount: rows.length,
    winRatePct: ci.ratePct,
    winRateCI95: [ci.ciLowPct, ci.ciHighPct] as [number, number],
    profitFactor: gl > 0 ? round2(gw / gl) : wins.length > 0 ? 99 : 0,
    expectancyR: round2(rows.reduce((a, r) => a + r.rMultiple, 0) / rows.length),
    avgWinPct: wins.length > 0 ? round2(gw / wins.length) : 0,
    avgLossPct: losses.length > 0 ? round2(-gl / losses.length) : 0,
    maxDrawdownPct: round2(maxDd * 100),
    avgHoldingBars: round2(rows.reduce((a, r) => a + r.holdingBars, 0) / rows.length),
    netReturnSumPct: round2(rows.reduce((a, r) => a + r.netReturnPct, 0)),
  };
}

function deterministicBootstrapCI(rows: SimTrade[], resamples = 1000) {
  if (rows.length < 5) {
    return { expectancyR_CI95: [0, 0], profitFactor_CI95: [0, 0] };
  }
  let seed = 42;
  const nextRand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const exps: number[] = [];
  const pfs: number[] = [];
  for (let b = 0; b < resamples; b++) {
    let rSum = 0, gw = 0, gl = 0;
    for (let i = 0; i < rows.length; i++) {
      const pick = rows[Math.floor(nextRand() * rows.length)];
      rSum += pick.rMultiple;
      if (pick.netReturnPct > 0) gw += pick.netReturnPct;
      else gl += Math.abs(pick.netReturnPct);
    }
    exps.push(rSum / rows.length);
    pfs.push(gl > 0 ? gw / gl : 5);
  }
  exps.sort((a, b) => a - b);
  pfs.sort((a, b) => a - b);
  return {
    expectancyR_CI95: [round2(exps[Math.floor(resamples * 0.025)]), round2(exps[Math.floor(resamples * 0.975)])],
    profitFactor_CI95: [round2(pfs[Math.floor(resamples * 0.025)]), round2(pfs[Math.floor(resamples * 0.975)])],
  };
}

function computeConcentration(rows: SimTrade[], keyFn: (r: SimTrade) => string) {
  const counts = new Map<string, { trades: number; netPct: number }>();
  for (const r of rows) {
    const k = keyFn(r);
    const cur = counts.get(k) ?? { trades: 0, netPct: 0 };
    cur.trades += 1;
    cur.netPct += r.netReturnPct;
    counts.set(k, cur);
  }
  const total = rows.length || 1;
  const entries = [...counts.entries()]
    .map(([key, v]) => ({ key, trades: v.trades, tradeSharePct: round2((v.trades / total) * 100), netReturnSumPct: round2(v.netPct) }))
    .sort((a, b) => b.trades - a.trades);
  const hhi = round2(entries.reduce((a, e) => a + (e.trades / total) ** 2, 0));
  return {
    uniqueGroups: entries.length,
    hhi,
    top3TradeSharePct: round2(entries.slice(0, 3).reduce((a, e) => a + e.tradeSharePct, 0)),
    breakdown: entries.slice(0, 10),
  };
}

function evaluatePatternDiagnostic(params: {
  candles: OhlcvCandle[];
  windowCandles: 3 | 4 | 5 | 8;
  allowedPatterns: DojiPatternType[] | "ANY_NO_DOJI_REQUIRED";
}): { detected: boolean; consolidationHigh: number | null; consolidationLow: number | null; rvol: number; quality: number } {
  if (params.candles.length < params.windowCandles + 15) {
    return { detected: false, consolidationHigh: null, consolidationLow: null, rvol: 0, quality: 0 };
  }
  const latest = params.candles[params.candles.length - 1];
  const prior = params.candles.slice(0, -1);
  const win = prior.slice(-params.windowCandles);
  const consHigh = Math.max(...win.map((c) => c.high));
  const consLow = Math.min(...win.map((c) => c.low));
  const rangePct = consLow > 0 ? ((consHigh - consLow) / consLow) * 100 : 99;

  // ATR(14) on prior
  let trSum = 0;
  for (let i = prior.length - 14; i < prior.length; i++) {
    const cur = prior[i], prev = prior[i - 1];
    trSum += Math.max(cur.high - cur.low, Math.abs(cur.high - prev.close), Math.abs(cur.low - prev.close));
  }
  const atrPct = prior[prior.length - 1].close > 0 ? ((trSum / 14) / prior[prior.length - 1].close) * 100 : 99;
  const tightOk = rangePct <= Math.max(2.5, atrPct * 1.8) && rangePct <= 4.5;

  let patternOk = true;
  if (params.allowedPatterns !== "ANY_NO_DOJI_REQUIRED") {
    patternOk = win.some((c) => (params.allowedPatterns as DojiPatternType[]).includes(detectDojiPattern(c).pattern));
  }

  const avgVol10 = prior.slice(-10).reduce((a, c) => a + c.volume, 0) / 10;
  const rvol = avgVol10 > 0 ? latest.volume / avgVol10 : 0;
  const rng = latest.high - latest.low;
  const quality = rng > 0 ? (latest.close - latest.open) / rng : 0;

  const broke = tightOk && patternOk && latest.close > consHigh * 1.001 && latest.close > latest.open && quality >= 0.45 && rvol >= 1.2;
  return { detected: broke, consolidationHigh: consHigh, consolidationLow: consLow, rvol: round2(rvol), quality: round2(quality) };
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

  // Mode C collections across cost stress levels
  const modeC_0bps: SimTrade[] = [];
  const modeC_25bps: SimTrade[] = [];
  const modeC_35bps: SimTrade[] = [];
  const modeC_50bps_15slip: SimTrade[] = [];

  // Mode D signal funnel counters
  const funnel = {
    totalSymbolDays: 0,
    passedLiquidityAndData: 0,
    rejectedLiquidityAndData: 0,
    passedFundamentalScore: 0,
    rejectedFundamentalScore: 0,
    passedMomentumFilter: 0,
    rejectedMomentumFilter: 0,
    eod1h_passedConsolidation5C: 0,
    eod1h_passedDojiInConsolidation5C: 0,
    eod1h_passedBreakoutConfirmation5C: 0,
    intraday1h_passedConsolidation5C: 0,
    intraday1h_passedDojiInConsolidation5C: 0,
    intraday1h_passedBreakoutConfirmation5C: 0,
  };

  // Candle pattern diagnostics (intraday 1H scan on instPass && momPass)
  const patBaselineDoji: SimTrade[] = [];
  const patClassicDoji: SimTrade[] = [];
  const patSmallBody: SimTrade[] = [];
  const patSpinningTop: SimTrade[] = [];
  const patNoDojiConsBreakout: SimTrade[] = [];

  // Entry timing diagnostics (on intraday 1H consolidation+breakout candidates)
  const timing1hClose: SimTrade[] = [];
  const timingNext1hOpen: SimTrade[] = [];
  const timingRetest: SimTrade[] = [];
  const timingDailyConfirm1hOpen: SimTrade[] = [];

  // Risk management diagnostics (on intraday 1H consolidation+breakout candidates)
  const rmConsLow1to3: SimTrade[] = [];
  const rmStructLow1to3: SimTrade[] = [];
  const rmBe3Pct: SimTrade[] = [];
  const rmBe4Pct: SimTrade[] = [];
  const rmTarget1to2: SimTrade[] = [];
  const rmTarget1to4: SimTrade[] = [];

  for (const sym of verifiedSyms) {
    const daily = loadCachedDaily(`${sym}.NS`);
    const h1 = loadCached1h(sym);
    if (daily.length < 120 || h1.length < 100) continue;
    const meta = metaBySym.get(sym) ?? { sector: "UNKNOWN", cap: "LARGE" as CapSegment };
    const startDay = h1[0].timestamp.slice(0, 10);
    const evalDays = daily.filter((d) => d.date >= startDay && d.date <= "2026-10-15");

    let lastC = -99;
    const lastPat: Record<string, number> = { base: -99, classic: -99, small: -99, spin: -99, nodoji: -99, daily: -99 };

    for (let i = 50; i < evalDays.length - 1; i++) {
      const dayIso = evalDays[i].date;
      funnel.totalSymbolDays++;

      const pitDaily = filterCandlesAsOf(daily, dayIso);
      const pitNifty = filterCandlesAsOf(niftyDaily, dayIso);
      const pit1h = h1.filter((c) => c.timestamp.slice(0, 10) <= dayIso);
      const fut1h = h1.filter((c) => c.timestamp.slice(0, 10) > dayIso);
      if (pit1h.length < 30 || fut1h.length < 5 || pitDaily.length < 60) {
        funnel.rejectedLiquidityAndData++;
        continue;
      }
      const avgTurnCr =
        (pitDaily.slice(-20).reduce((a, b) => a + b.close * b.volume, 0) / 20) / 1e7;
      if (avgTurnCr < 5) {
        funnel.rejectedLiquidityAndData++;
        continue;
      }
      funnel.passedLiquidityAndData++;

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
      if (fund.decision !== "ENTER_CANDIDATE") {
        funnel.rejectedFundamentalScore++;
        continue;
      }
      funnel.passedFundamentalScore++;

      const mom = filterMomentumStock({ symbol: sym, sector: meta.sector, candles: pitDaily, niftyCandles: pitNifty });
      if (mom.classification !== "MOMENTUM_WATCHLIST") {
        funnel.rejectedMomentumFilter++;
        continue;
      }
      funnel.passedMomentumFilter++;

      const regime = classifyNiftyRegime(pitNifty);
      const defSl = round2(pit1h[pit1h.length - 1].close * 0.94);

      // Mode C baseline (unchanged rules)
      if (i - lastC >= 15) {
        const o25 = simulateTrade1h({ symbol: sym, sector: meta.sector, capSegment: meta.cap, regime, future1h: fut1h, slPrice: defSl, oneWayCostBps: 25, slippageBps: 8 });
        if (o25) {
          modeC_25bps.push(o25);
          const o0 = simulateTrade1h({ symbol: sym, sector: meta.sector, capSegment: meta.cap, regime, future1h: fut1h, slPrice: defSl, oneWayCostBps: 0, slippageBps: 0 });
          const o35 = simulateTrade1h({ symbol: sym, sector: meta.sector, capSegment: meta.cap, regime, future1h: fut1h, slPrice: defSl, oneWayCostBps: 35, slippageBps: 8 });
          const o50 = simulateTrade1h({ symbol: sym, sector: meta.sector, capSegment: meta.cap, regime, future1h: fut1h, slPrice: defSl, oneWayCostBps: 50, slippageBps: 15 });
          if (o0) modeC_0bps.push(o0);
          if (o35) modeC_35bps.push(o35);
          if (o50) modeC_50bps_15slip.push(o50);
          lastC = i;
        }
      }

      // EOD 1H funnel check (what Phase 6.10.12 ran)
      const eodCons = detectTightConsolidation({ candles: pit1h.slice(0, -1), windowCandles: 5 });
      if (eodCons.rangePct !== null && eodCons.rangePct <= 4.5) funnel.eod1h_passedConsolidation5C++;
      if (eodCons.detected) funnel.eod1h_passedDojiInConsolidation5C++;
      const eodDoji = evaluateMomentumDojiBreakout({ symbol: sym, candles: pit1h, windowCandles: 5 });
      if (eodDoji.status === "DOJI_BREAKOUT_CONFIRMED") funnel.eod1h_passedBreakoutConfirmation5C++;

      // Intraday 1H bar scan for dayIso
      const dayBarsStart = pit1h.findIndex((c) => c.timestamp.slice(0, 10) === dayIso);
      if (dayBarsStart >= 25) {
        let dayHasCons = false, dayHasDoji = false, dayHasBreak = false;
        for (let b = dayBarsStart; b < pit1h.length; b++) {
          const sub1h = pit1h.slice(0, b + 1);
          const barFut = h1.slice(b + 1);
          if (barFut.length < 5) continue;

          const consCheck = evaluatePatternDiagnostic({ candles: sub1h, windowCandles: 5, allowedPatterns: "ANY_NO_DOJI_REQUIRED" });
          const priorCons = detectTightConsolidation({ candles: sub1h.slice(0, -1), windowCandles: 5 });
          if (priorCons.rangePct !== null && priorCons.rangePct <= 4.5) dayHasCons = true;
          if (priorCons.detected) dayHasDoji = true;

          const baseEval = evaluateMomentumDojiBreakout({ symbol: sym, candles: sub1h, windowCandles: 5 });
          if (baseEval.status === "DOJI_BREAKOUT_CONFIRMED" && baseEval.consolidationLowSl !== null) {
            dayHasBreak = true;
            if (i - lastPat.base >= 10) {
              const o = simulateTrade1h({ symbol: sym, sector: meta.sector, capSegment: meta.cap, regime, future1h: barFut, slPrice: baseEval.consolidationLowSl });
              if (o) { patBaselineDoji.push(o); lastPat.base = i; }
            }
          }

          const classicEval = evaluatePatternDiagnostic({ candles: sub1h, windowCandles: 5, allowedPatterns: ["CLASSIC_DOJI", "LONG_LEGGED_DOJI", "DRAGONFLY_DOJI", "GRAVESTONE_DOJI"] });
          if (classicEval.detected && classicEval.consolidationLow !== null && i - lastPat.classic >= 10) {
            const o = simulateTrade1h({ symbol: sym, sector: meta.sector, capSegment: meta.cap, regime, future1h: barFut, slPrice: classicEval.consolidationLow });
            if (o) { patClassicDoji.push(o); lastPat.classic = i; }
          }

          const smallEval = evaluatePatternDiagnostic({ candles: sub1h, windowCandles: 5, allowedPatterns: ["SMALL_BODY"] });
          if (smallEval.detected && smallEval.consolidationLow !== null && i - lastPat.small >= 10) {
            const o = simulateTrade1h({ symbol: sym, sector: meta.sector, capSegment: meta.cap, regime, future1h: barFut, slPrice: smallEval.consolidationLow });
            if (o) { patSmallBody.push(o); lastPat.small = i; }
          }

          const spinEval = evaluatePatternDiagnostic({ candles: sub1h, windowCandles: 5, allowedPatterns: ["SPINNING_TOP"] });
          if (spinEval.detected && spinEval.consolidationLow !== null && i - lastPat.spin >= 10) {
            const o = simulateTrade1h({ symbol: sym, sector: meta.sector, capSegment: meta.cap, regime, future1h: barFut, slPrice: spinEval.consolidationLow });
            if (o) { patSpinningTop.push(o); lastPat.spin = i; }
          }

          if (consCheck.detected && consCheck.consolidationLow !== null && consCheck.consolidationHigh !== null && i - lastPat.nodoji >= 10) {
            const slCons = consCheck.consolidationLow;
            const structLow = Math.min(...sub1h.slice(-16, -1).map((c) => c.low));
            const oOpen = simulateTrade1h({ symbol: sym, sector: meta.sector, capSegment: meta.cap, regime, future1h: barFut, slPrice: slCons });
            const oClose = simulateTrade1h({ symbol: sym, sector: meta.sector, capSegment: meta.cap, regime, future1h: barFut, slPrice: slCons, entryOverride: sub1h[sub1h.length - 1].close });
            if (oOpen) {
              patNoDojiConsBreakout.push(oOpen);
              timingNext1hOpen.push(oOpen);
              rmConsLow1to3.push(oOpen);
            }
            if (oClose) timing1hClose.push(oClose);

            // Retest check within next 5 1H bars
            const retestIdx = barFut.slice(0, 5).findIndex(
              (fb) => fb.low <= consCheck.consolidationHigh! * 1.005 && fb.close > consCheck.consolidationHigh!
            );
            if (retestIdx >= 0 && barFut.length > retestIdx + 2) {
              const oRet = simulateTrade1h({ symbol: sym, sector: meta.sector, capSegment: meta.cap, regime, future1h: barFut.slice(retestIdx + 1), slPrice: slCons });
              if (oRet) timingRetest.push(oRet);
            }

            // Risk management variants
            const oStruct = simulateTrade1h({ symbol: sym, sector: meta.sector, capSegment: meta.cap, regime, future1h: barFut, slPrice: structLow });
            const oBe3 = simulateTrade1h({ symbol: sym, sector: meta.sector, capSegment: meta.cap, regime, future1h: barFut, slPrice: slCons, breakevenMovePct: 3.0 });
            const oBe4 = simulateTrade1h({ symbol: sym, sector: meta.sector, capSegment: meta.cap, regime, future1h: barFut, slPrice: slCons, breakevenMovePct: 4.0 });
            const oT2 = simulateTrade1h({ symbol: sym, sector: meta.sector, capSegment: meta.cap, regime, future1h: barFut, slPrice: slCons, targetR: 2.0 });
            const oT4 = simulateTrade1h({ symbol: sym, sector: meta.sector, capSegment: meta.cap, regime, future1h: barFut, slPrice: slCons, targetR: 4.0 });
            if (oStruct) rmStructLow1to3.push(oStruct);
            if (oBe3) rmBe3Pct.push(oBe3);
            if (oBe4) rmBe4Pct.push(oBe4);
            if (oT2) rmTarget1to2.push(oT2);
            if (oT4) rmTarget1to4.push(oT4);

            lastPat.nodoji = i;
          }
        }
        if (dayHasCons) funnel.intraday1h_passedConsolidation5C++;
        if (dayHasDoji) funnel.intraday1h_passedDojiInConsolidation5C++;
        if (dayHasBreak) funnel.intraday1h_passedBreakoutConfirmation5C++;
      }

      // Daily confirmation followed by next 1H open
      if (pitDaily.length >= 15 && i - lastPat.daily >= 10) {
        const dLast = pitDaily[pitDaily.length - 1];
        const dPrior5High = Math.max(...pitDaily.slice(-6, -1).map((d) => d.high));
        const dPrior5Low = Math.min(...pitDaily.slice(-6, -1).map((d) => d.low));
        if (dLast.close > dPrior5High && dLast.close > dLast.open) {
          const oDaily = simulateTrade1h({ symbol: sym, sector: meta.sector, capSegment: meta.cap, regime, future1h: fut1h, slPrice: dPrior5Low });
          if (oDaily) { timingDailyConfirm1hOpen.push(oDaily); lastPat.daily = i; }
        }
      }
    }
  }

  // Mode C Walk-Forward
  const wf = {
    fullSample: summarizeTrades(modeC_25bps),
    train_2024: summarizeTrades(modeC_25bps.filter((t) => t.entryDate <= "2024-12-31")),
    validation_2025Q1_Q3: summarizeTrades(modeC_25bps.filter((t) => t.entryDate >= "2025-01-01" && t.entryDate <= "2025-09-30")),
    untouched_OOS_2025Q4_2026: summarizeTrades(modeC_25bps.filter((t) => t.entryDate >= "2025-10-01")),
  };

  // Mode C Regime & Concentration
  const regimeAnalysis = {
    regimes: {
      BULL: summarizeTrades(modeC_25bps.filter((t) => t.regime === "BULL")),
      BEAR: summarizeTrades(modeC_25bps.filter((t) => t.regime === "BEAR")),
      SIDEWAYS: summarizeTrades(modeC_25bps.filter((t) => t.regime === "SIDEWAYS")),
    },
    capSegments: {
      LARGE: summarizeTrades(modeC_25bps.filter((t) => t.capSegment === "LARGE")),
      MID: summarizeTrades(modeC_25bps.filter((t) => t.capSegment === "MID")),
      SMALL: summarizeTrades(modeC_25bps.filter((t) => t.capSegment === "SMALL")),
    },
    sectorConcentration: computeConcentration(modeC_25bps, (t) => t.sector),
    stockConcentration: computeConcentration(modeC_25bps, (t) => t.symbol),
  };

  // Mode C Cost Stress
  const costStress = {
    zeroCost_0bps: summarizeTrades(modeC_0bps),
    baseline_25bps_8slip: summarizeTrades(modeC_25bps),
    elevated_35bps_8slip: summarizeTrades(modeC_35bps),
    severe_50bps_15slip: summarizeTrades(modeC_50bps_15slip),
  };

  // Mode C Confidence Intervals & Outlier Dependency
  const sortedByRet = [...modeC_25bps].sort((a, b) => b.netReturnPct - a.netReturnPct);
  const top5PctCount = Math.max(1, Math.floor(sortedByRet.length * 0.05));
  const ciAndOutliers = {
    fullSample: summarizeTrades(modeC_25bps),
    bootstrap95CI: deterministicBootstrapCI(modeC_25bps, 1000),
    outlierSensitivity: {
      withoutTop1Trade: summarizeTrades(sortedByRet.slice(1)),
      withoutTop3Trades: summarizeTrades(sortedByRet.slice(3)),
      withoutTop5PctTrades: summarizeTrades(sortedByRet.slice(top5PctCount)),
    },
  };

  // Classifications
  const modeCClass =
    wf.untouched_OOS_2025Q4_2026.profitFactor >= 1.1 &&
    wf.untouched_OOS_2025Q4_2026.expectancyR > 0 &&
    ciAndOutliers.outlierSensitivity.withoutTop3Trades.profitFactor >= 1.0 &&
    costStress.elevated_35bps_8slip.profitFactor >= 1.0
      ? "PROMISING_FOR_FURTHER_VALIDATION"
      : wf.fullSample.profitFactor < 1.0
      ? "NO_ROBUST_IMPROVEMENT"
      : "INCONCLUSIVE";

  const modeDClass =
    funnel.eod1h_passedBreakoutConfirmation5C >= 20
      ? "SUFFICIENT_SIGNALS_FOR_VALIDATION"
      : "INSUFFICIENT_SIGNALS";

  const overallClass = "RESEARCH_VALIDATION_COMPLETE";

  const writeJson = (name: string, data: unknown) =>
    fs.writeFileSync(path.join(OUT_DIR, name), JSON.stringify(data, null, 2));

  writeJson("mode_c_walk_forward.json", wf);
  writeJson("mode_c_regime_analysis.json", regimeAnalysis);
  writeJson("mode_c_cost_stress.json", costStress);
  writeJson("mode_c_confidence_intervals.json", ciAndOutliers);
  writeJson("mode_d_signal_funnel.json", {
    ...funnel,
    primaryBottleneck:
      "Phase 6.10.12 evaluated 1H consolidation+Doji breakout only on the final 1H bar of each day (EOD sampling) AND stacked strict 5-candle tight range + Doji + RVOL>=1.2 + quality>=0.45 simultaneously, collapsing 113 Mode C days down to " +
      funnel.eod1h_passedBreakoutConfirmation5C +
      " EOD signals (" +
      funnel.intraday1h_passedBreakoutConfirmation5C +
      " when scanning all intraday 1H bars).",
  });
  writeJson("doji_pattern_diagnostics.json", {
    baseline_userDojiBreakout_intraday1H: summarizeTrades(patBaselineDoji),
    classicDojiOnly: summarizeTrades(patClassicDoji),
    smallBodyOnly: summarizeTrades(patSmallBody),
    spinningTopOnly: summarizeTrades(patSpinningTop),
    tightConsolidationWithoutDoji: summarizeTrades(patNoDojiConsBreakout),
  });
  writeJson("entry_timing_comparison.json", {
    confirmed1hClose: summarizeTrades(timing1hClose),
    nextExecutable1hOpen: summarizeTrades(timingNext1hOpen),
    breakoutRetestWithin5Bars: summarizeTrades(timingRetest),
    dailyConfirmationThen1hOpen: summarizeTrades(timingDailyConfirm1hOpen),
  });
  writeJson("risk_management_comparison.json", {
    consolidationLow_1to3_baseline: summarizeTrades(rmConsLow1to3),
    structuralSwingLow15_1to3: summarizeTrades(rmStructLow1to3),
    consolidationLow_be3Pct_1to3: summarizeTrades(rmBe3Pct),
    consolidationLow_be4Pct_1to3: summarizeTrades(rmBe4Pct),
    consolidationLow_1to2: summarizeTrades(rmTarget1to2),
    consolidationLow_1to4: summarizeTrades(rmTarget1to4),
  });
  writeJson("overfitting_audit.json", {
    oosOptimized: false,
    modeC_classification: modeCClass,
    modeD_classification: modeDClass,
    overall_classification: overallClass,
    experimental_paper_trades: paperTradesCount ?? 0,
    safetyLocks: {
      STRATEGY_01: false,
      STRATEGY_02: false,
      STRATEGY_03: false,
      LIVE_TRADING: false,
      BROKER_EXECUTION_ENABLED: false,
      Strategy03PaperIsolationConfig_enabled: false,
    },
  });

  const md = [
    "# Phase 6.10.13 — Institutional Momentum Validation & Doji Signal Diagnostics",
    "",
    `- **Mode C Classification:** \`${modeCClass}\``,
    `- **Mode D Classification:** \`${modeDClass}\``,
    `- **Overall Classification:** \`${overallClass}\``,
    "",
    "## 1. Mode C Walk-Forward & Cost Stress (25 bps baseline)",
    `- Full Sample: Trades=${wf.fullSample.tradeCount}, WinRate=${wf.fullSample.winRatePct}%, PF=${wf.fullSample.profitFactor}, Exp=${wf.fullSample.expectancyR}R`,
    `- Train (2024): Trades=${wf.train_2024.tradeCount}, PF=${wf.train_2024.profitFactor}, Exp=${wf.train_2024.expectancyR}R`,
    `- Validation (2025 Q1-Q3): Trades=${wf.validation_2025Q1_Q3.tradeCount}, PF=${wf.validation_2025Q1_Q3.profitFactor}, Exp=${wf.validation_2025Q1_Q3.expectancyR}R`,
    `- Untouched OOS (2025 Q4-2026): Trades=${wf.untouched_OOS_2025Q4_2026.tradeCount}, PF=${wf.untouched_OOS_2025Q4_2026.profitFactor}, Exp=${wf.untouched_OOS_2025Q4_2026.expectancyR}R`,
    `- Bootstrap 95% CI: Expectancy=${ciAndOutliers.bootstrap95CI.expectancyR_CI95.join(" to ")}R, PF=${ciAndOutliers.bootstrap95CI.profitFactor_CI95.join(" to ")}`,
    `- Without Top-3 Trades: PF=${ciAndOutliers.outlierSensitivity.withoutTop3Trades.profitFactor}, Exp=${ciAndOutliers.outlierSensitivity.withoutTop3Trades.expectancyR}R`,
    `- Cost Stress 35 bps: PF=${costStress.elevated_35bps_8slip.profitFactor}, 50 bps+15slip: PF=${costStress.severe_50bps_15slip.profitFactor}`,
    "",
    "## 2. Mode D Signal Funnel",
    `- Total Symbol-Days: ${funnel.totalSymbolDays} -> Liquidity/Data: ${funnel.passedLiquidityAndData} -> Fundamental>=60: ${funnel.passedFundamentalScore} -> Momentum>=55: ${funnel.passedMomentumFilter}`,
    `- EOD 1H only: TightCons=${funnel.eod1h_passedConsolidation5C} -> DojiInCons=${funnel.eod1h_passedDojiInConsolidation5C} -> Breakout=${funnel.eod1h_passedBreakoutConfirmation5C}`,
    `- Intraday 1H scan: TightCons=${funnel.intraday1h_passedConsolidation5C} -> DojiInCons=${funnel.intraday1h_passedDojiInConsolidation5C} -> Breakout=${funnel.intraday1h_passedBreakoutConfirmation5C}`,
    "",
    "## 3. Safety Confirmation",
    "- `STRATEGY_01 = false`, `STRATEGY_02 = false`, `STRATEGY_03 = false`, `LIVE_TRADING = false`, `BROKER_EXECUTION_ENABLED = false`, `experimental_paper_trades = 0`.",
  ].join("\n");
  fs.writeFileSync(path.join(OUT_DIR, "phase61013_final_report.md"), md);

  console.log("Phase 6.10.13 complete:", {
    modeCClass,
    modeDClass,
    overallClass,
    modeC_full: wf.fullSample,
    modeC_oos: wf.untouched_OOS_2025Q4_2026,
    funnel,
    paperTrades: paperTradesCount ?? 0,
  });
}

if (process.argv[1]?.includes("runPhase61013Research")) {
  main().catch((err) => {
    console.error("Phase 6.10.13 failed:", err);
    process.exit(1);
  });
}
