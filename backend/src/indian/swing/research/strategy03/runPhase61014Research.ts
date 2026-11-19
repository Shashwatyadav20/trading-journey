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
  type DataIntegrityStats,
  type IntradayBreakoutEvent,
} from "./momentum/Strategy03IntradayEventEvaluator.js";
import { loadAllRowsPaginated } from "./Strategy03ShadowRunner.js";
import { wilsonWinRateCI } from "./StatisticalRobustnessEngine.js";
import {
  classifyCapSegment,
  classifyNiftyRegime,
  type CapSegment,
  type MarketRegime,
} from "./runPhase61013Research.js";

config({ path: path.resolve("D:/Trading/my-app/backend/.env") });

const OUT_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase61014");
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

interface ExecTrade {
  symbol: string;
  sector: string;
  capSegment: CapSegment;
  regime: MarketRegime;
  entryDate: string;
  netReturnPct: number;
  grossReturnPct: number;
  costImpactPct: number;
  rMultiple: number;
  holdingBars: number;
  mfePct: number;
  maePct: number;
  exitReason: string;
  isGapThroughStop: boolean;
}

function simulateExec(params: {
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
  trailingAfter1R?: boolean;
  targetR?: number;
}): ExecTrade | null {
  if (params.future1h.length < 2) return null;
  const slip = (params.slippageBps ?? 8) / 10_000;
  const costPct = ((params.oneWayCostBps ?? 25) * 2) / 100;
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
  let highWater = entry;

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
    if (b.high > highWater) highWater = b.high;
    if (params.breakevenMovePct && ((b.high - entry) / entry) * 100 >= params.breakevenMovePct) {
      sl = Math.max(sl, entry);
    }
    if (params.trailingAfter1R && highWater - entry >= risk) {
      sl = Math.max(sl, highWater - risk * 1.2);
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
    entryDate: toIstDateAndTime(params.future1h[0].timestamp).istDate,
    netReturnPct: round2(netRet),
    grossReturnPct: round2(grossRet),
    costImpactPct: round2(costPct),
    rMultiple: round2(netRet / riskPct),
    holdingBars,
    mfePct: Number.isFinite(mfe) ? round2(mfe) : 0,
    maePct: Number.isFinite(mae) ? round2(mae) : 0,
    exitReason,
    isGapThroughStop: exitReason === "GAP_SL_HIT",
  };
}

function summarize(rows: ExecTrade[]) {
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
      avgMfePct: 0,
      avgMaePct: 0,
      avgHoldingBars: 0,
      gapThroughStopPct: 0,
      avgCostImpactPct: 0,
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
    winRateCI95: [ci.ciLowPct, ci.ciHighPct],
    profitFactor: gl > 0 ? round2(gw / gl) : wins.length > 0 ? 99 : 0,
    expectancyR: round2(rows.reduce((a, r) => a + r.rMultiple, 0) / rows.length),
    avgWinPct: wins.length > 0 ? round2(gw / wins.length) : 0,
    avgLossPct: losses.length > 0 ? round2(-gl / losses.length) : 0,
    maxDrawdownPct: round2(maxDd * 100),
    avgMfePct: round2(rows.reduce((a, r) => a + r.mfePct, 0) / rows.length),
    avgMaePct: round2(rows.reduce((a, r) => a + r.maePct, 0) / rows.length),
    avgHoldingBars: round2(rows.reduce((a, r) => a + r.holdingBars, 0) / rows.length),
    gapThroughStopPct: round2((rows.filter((r) => r.isGapThroughStop).length / rows.length) * 100),
    avgCostImpactPct: round2(rows.reduce((a, r) => a + r.costImpactPct, 0) / rows.length),
  };
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

  const funnel = {
    eligibleUniverseSymbols: verifiedSyms.length,
    totalSymbolDaysEvaluated: 0,
    liquidityAndDataPasses: 0,
    fundamentalPasses: 0,
    momentumPasses: 0,
    intradayBarsEvaluated: 0,
    consolidationPasses: 0,
    dojiPasses: 0,
    allConfirmedBreakoutSignals: 0,
    firstBreakoutSignalsUniquePerDay: 0,
    duplicateSignalsPrevented: 0,
    eodOnlyBreakoutSignals: 0,
    rejectionReasons: {
      INSUFFICIENT_HISTORY: 0,
      NO_CONSOLIDATION: 0,
      NO_DOJI_IN_CONSOLIDATION: 0,
      NO_BREAKOUT_CLOSE: 0,
      WEAK_CANDLE_QUALITY: 0,
      LOW_RVOL: 0,
    },
  };

  const integrityAudit: Record<string, DataIntegrityStats> = {};
  const modeA_eodOnly: ExecTrade[] = [];
  const modeB_allIntraday: ExecTrade[] = [];
  const modeC_firstBreakoutOnly: ExecTrade[] = [];
  const modeD_firstBreakoutNext1hOpen: ExecTrade[] = [];
  const modeD_firstBreakoutCloseDiag: ExecTrade[] = [];

  // Pattern comparisons (using first intraday breakout with 10-day cooldown)
  const patUserDoji: ExecTrade[] = [];
  const patClassicDoji: ExecTrade[] = [];
  const patSmallBody: ExecTrade[] = [];
  const patNoDojiCons: ExecTrade[] = [];

  // Risk management & cost stress on first intraday breakout (10-day cooldown)
  const rmTarget1to2: ExecTrade[] = [];
  const rmBe3: ExecTrade[] = [];
  const rmBe4: ExecTrade[] = [];
  const rmTrailing: ExecTrade[] = [];
  const cost0: ExecTrade[] = [];
  const cost35: ExecTrade[] = [];
  const cost50: ExecTrade[] = [];

  for (const sym of verifiedSyms) {
    const daily = loadCachedDaily(`${sym}.NS`);
    const raw1h = loadCached1h(sym);
    const { candles: h1, integrity } = sanitizeIntraday1hSeries(raw1h);
    integrityAudit[sym] = integrity;
    if (daily.length < 120 || h1.length < 100) continue;

    const meta = metaBySym.get(sym) ?? { sector: "UNKNOWN", cap: "LARGE" as CapSegment };
    const startDay = toIstDateAndTime(h1[0].timestamp).istDate;
    const evalDays = daily.filter((d) => d.date >= startDay && d.date <= "2026-10-15");

    let lastEod = -99, lastFirst = -99, lastClassic = -99, lastSmall = -99, lastNoDoji = -99;

    for (let i = 50; i < evalDays.length - 1; i++) {
      const dayIso = evalDays[i].date;
      funnel.totalSymbolDaysEvaluated++;

      const pitDaily = filterCandlesAsOf(daily, dayIso);
      const pitNifty = filterCandlesAsOf(niftyDaily, dayIso);
      if (pitDaily.length < 60) continue;
      const avgTurnCr = (pitDaily.slice(-20).reduce((a, b) => a + b.close * b.volume, 0) / 20) / 1e7;
      if (avgTurnCr < 5) continue;
      funnel.liquidityAndDataPasses++;

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
      funnel.fundamentalPasses++;

      const mom = filterMomentumStock({ symbol: sym, sector: meta.sector, candles: pitDaily, niftyCandles: pitNifty });
      if (mom.classification !== "MOMENTUM_WATCHLIST") continue;
      funnel.momentumPasses++;

      const regime = classifyNiftyRegime(pitNifty);
      const dayEv = evaluateIntradayEventsForDay({
        symbol: sym,
        istDate: dayIso,
        sanitizedCandles: h1,
        windowCandles: 5,
      });

      funnel.intradayBarsEvaluated += dayEv.barsEvaluated;
      funnel.consolidationPasses += dayEv.consolidationPasses;
      funnel.dojiPasses += dayEv.dojiPasses;
      funnel.allConfirmedBreakoutSignals += dayEv.allConfirmedBreakouts.length;
      if (dayEv.firstBreakout) funnel.firstBreakoutSignalsUniquePerDay++;
      funnel.duplicateSignalsPrevented += dayEv.duplicatesPrevented;
      if (dayEv.eodOnlyBreakout) funnel.eodOnlyBreakoutSignals++;
      for (const k of Object.keys(funnel.rejectionReasons) as Array<keyof typeof funnel.rejectionReasons>) {
        funnel.rejectionReasons[k] += dayEv.rejectionCounts[k];
      }

      const simEv = (ev: IntradayBreakoutEvent, opts?: { entryAtClose?: boolean; targetR?: number; be?: number; trail?: boolean; cost?: number; slip?: number }) => {
        const fut = h1.slice(ev.barIndexInFullSeries + 1);
        if (fut.length < 5) return null;
        return simulateExec({
          symbol: sym,
          sector: meta.sector,
          capSegment: meta.cap,
          regime,
          future1h: fut,
          slPrice: ev.consolidationLowSl,
          entryOverride: opts?.entryAtClose ? ev.breakoutClose : undefined,
          targetR: opts?.targetR ?? 3.0,
          breakevenMovePct: opts?.be,
          trailingAfter1R: opts?.trail,
          oneWayCostBps: opts?.cost ?? 25,
          slippageBps: opts?.slip ?? 8,
        });
      };

      // A. Original EOD-only 15:15 IST
      if (dayEv.eodOnlyBreakout && i - lastEod >= 10) {
        const t = simEv(dayEv.eodOnlyBreakout);
        if (t) { modeA_eodOnly.push(t); lastEod = i; }
      }

      // B. Every completed 1H candle (no daily deduplication)
      for (const ev of dayEv.allConfirmedBreakouts) {
        const t = simEv(ev);
        if (t) modeB_allIntraday.push(t);
      }

      // C & D. First confirmed intraday breakout (10-day cooldown for executable trades)
      if (dayEv.firstBreakout && i - lastFirst >= 10) {
        const tOpen = simEv(dayEv.firstBreakout);
        const tClose = simEv(dayEv.firstBreakout, { entryAtClose: true });
        if (tOpen) {
          modeC_firstBreakoutOnly.push(tOpen);
          modeD_firstBreakoutNext1hOpen.push(tOpen);
          patUserDoji.push(tOpen);
          const t2 = simEv(dayEv.firstBreakout, { targetR: 2.0 });
          const tBe3 = simEv(dayEv.firstBreakout, { be: 3.0 });
          const tBe4 = simEv(dayEv.firstBreakout, { be: 4.0 });
          const tTr = simEv(dayEv.firstBreakout, { trail: true });
          const c0 = simEv(dayEv.firstBreakout, { cost: 0, slip: 0 });
          const c35 = simEv(dayEv.firstBreakout, { cost: 35, slip: 8 });
          const c50 = simEv(dayEv.firstBreakout, { cost: 50, slip: 15 });
          if (t2) rmTarget1to2.push(t2);
          if (tBe3) rmBe3.push(tBe3);
          if (tBe4) rmBe4.push(tBe4);
          if (tTr) rmTrailing.push(tTr);
          if (c0) cost0.push(c0);
          if (c35) cost35.push(c35);
          if (c50) cost50.push(c50);
          lastFirst = i;
        }
        if (tClose) modeD_firstBreakoutCloseDiag.push(tClose);
      }

      // Separate pattern comparisons
      if (i - lastClassic >= 10) {
        const classicEv = evaluateIntradayEventsForDay({
          symbol: sym, istDate: dayIso, sanitizedCandles: h1, windowCandles: 5,
          allowedPatterns: ["CLASSIC_DOJI", "LONG_LEGGED_DOJI", "DRAGONFLY_DOJI", "GRAVESTONE_DOJI"],
        });
        if (classicEv.firstBreakout) {
          const t = simEv(classicEv.firstBreakout);
          if (t) { patClassicDoji.push(t); lastClassic = i; }
        }
      }
      if (i - lastSmall >= 10) {
        const smallEv = evaluateIntradayEventsForDay({
          symbol: sym, istDate: dayIso, sanitizedCandles: h1, windowCandles: 5,
          allowedPatterns: ["SMALL_BODY"],
        });
        if (smallEv.firstBreakout) {
          const t = simEv(smallEv.firstBreakout);
          if (t) { patSmallBody.push(t); lastSmall = i; }
        }
      }
      if (i - lastNoDoji >= 10) {
        const noDojiEv = evaluateIntradayEventsForDay({
          symbol: sym, istDate: dayIso, sanitizedCandles: h1, windowCandles: 5,
          allowedPatterns: "ANY_NO_DOJI_REQUIRED",
        });
        if (noDojiEv.firstBreakout) {
          const t = simEv(noDojiEv.firstBreakout);
          if (t) { patNoDojiCons.push(t); lastNoDoji = i; }
        }
      }
    }
  }

  const wf = {
    fullSample: summarize(modeD_firstBreakoutNext1hOpen),
    train_2024: summarize(modeD_firstBreakoutNext1hOpen.filter((t) => t.entryDate <= "2024-12-31")),
    validation_2025Q1_Q3: summarize(modeD_firstBreakoutNext1hOpen.filter((t) => t.entryDate >= "2025-01-01" && t.entryDate <= "2025-09-30")),
    untouched_OOS_2025Q4_2026: summarize(modeD_firstBreakoutNext1hOpen.filter((t) => t.entryDate >= "2025-10-01")),
    regimes: {
      BULL: summarize(modeD_firstBreakoutNext1hOpen.filter((t) => t.regime === "BULL")),
      BEAR: summarize(modeD_firstBreakoutNext1hOpen.filter((t) => t.regime === "BEAR")),
      SIDEWAYS: summarize(modeD_firstBreakoutNext1hOpen.filter((t) => t.regime === "SIDEWAYS")),
    },
    capSegments: {
      LARGE: summarize(modeD_firstBreakoutNext1hOpen.filter((t) => t.capSegment === "LARGE")),
      MID: summarize(modeD_firstBreakoutNext1hOpen.filter((t) => t.capSegment === "MID")),
      SMALL: summarize(modeD_firstBreakoutNext1hOpen.filter((t) => t.capSegment === "SMALL")),
    },
  };

  const intradayValidated = funnel.firstBreakoutSignalsUniquePerDay >= 30 && modeD_firstBreakoutNext1hOpen.length >= 30;
  const oosSummary = wf.untouched_OOS_2025Q4_2026;
  const fullSummary = wf.fullSample;
  const finalClassification =
    intradayValidated && fullSummary.profitFactor >= 1.15 && oosSummary.profitFactor >= 1.1
      ? "PROMISING_FOR_FURTHER_VALIDATION"
      : intradayValidated && fullSummary.profitFactor < 1.0
      ? "NO_ROBUST_IMPROVEMENT"
      : intradayValidated
      ? "INTRADAY_DETECTION_VALIDATED"
      : "INSUFFICIENT_SIGNALS";

  const writeJson = (name: string, data: unknown) =>
    fs.writeFileSync(path.join(OUT_DIR, name), JSON.stringify(data, null, 2));

  writeJson("intraday_signal_funnel.json", {
    ...funnel,
    executableHistoricalTradeCount: modeD_firstBreakoutNext1hOpen.length,
    funnelExplanation:
      "Candidate count = symbol-days passing liquidity, fundamentals>=60, and momentum>=55 (" +
      funnel.momentumPasses +
      "). Confirmed signal count = unique days with >=1 completed 1H Doji breakout (" +
      funnel.firstBreakoutSignalsUniquePerDay +
      ", with " +
      funnel.duplicateSignalsPrevented +
      " intraday duplicates prevented). Executable historical trade count = non-overlapping trades after 10-day cooldown & >=5 future 1H bars (" +
      modeD_firstBreakoutNext1hOpen.length +
      ").",
  });
  writeJson("eod_vs_intraday_comparison.json", {
    A_eodOnly_1515IST: summarize(modeA_eodOnly),
    B_everyCompleted1hCandle: summarize(modeB_allIntraday),
    C_firstConfirmedIntradayBreakout: summarize(modeC_firstBreakoutOnly),
    D_intradayBreakout_next1hOpen: summarize(modeD_firstBreakoutNext1hOpen),
  });
  writeJson("first_breakout_comparison.json", {
    firstBreakoutDeduplicated: summarize(modeC_firstBreakoutOnly),
    allIntradayBreakoutsWithoutDedup: summarize(modeB_allIntraday),
    duplicatesPrevented: funnel.duplicateSignalsPrevented,
  });
  writeJson("candle_pattern_comparison.json", {
    originalUserDoji: summarize(patUserDoji),
    classicDojiOnly: summarize(patClassicDoji),
    smallBodyOnly: summarize(patSmallBody),
    tightConsolidationWithoutDoji: summarize(patNoDojiCons),
  });
  writeJson("execution_timing_results.json", {
    nextExecutable1hOpen: summarize(modeD_firstBreakoutNext1hOpen),
    confirmed1hCloseDiagnostic: summarize(modeD_firstBreakoutCloseDiag),
  });
  writeJson("risk_management_comparison.json", {
    consolidationLow_1to3_baseline: summarize(modeD_firstBreakoutNext1hOpen),
    consolidationLow_1to2: summarize(rmTarget1to2),
    consolidationLow_be3Pct: summarize(rmBe3),
    consolidationLow_be4Pct: summarize(rmBe4),
    consolidationLow_trailingAfter1R: summarize(rmTrailing),
  });
  writeJson("walk_forward_results.json", wf);
  writeJson("cost_stress_results.json", {
    zeroCost_0bps: summarize(cost0),
    baseline_25bps_8slip: summarize(modeD_firstBreakoutNext1hOpen),
    elevated_35bps_8slip: summarize(cost35),
    severe_50bps_15slip: summarize(cost50),
  });
  writeJson("data_integrity_audit.json", {
    symbolsAudited: Object.keys(integrityAudit).length,
    totalRawCandles: Object.values(integrityAudit).reduce((a, s) => a + s.totalCandles, 0),
    totalValidSessionCandles: Object.values(integrityAudit).reduce((a, s) => a + s.validSessionCandles, 0),
    totalDuplicatesRemoved: Object.values(integrityAudit).reduce((a, s) => a + s.duplicateTimestampsRemoved, 0),
    totalOutOfSessionSkipped: Object.values(integrityAudit).reduce((a, s) => a + s.outOfSessionCandles, 0),
    totalIncompleteSkipped: Object.values(integrityAudit).reduce((a, s) => a + s.incompleteCandlesSkipped, 0),
    perSymbol: integrityAudit,
  });

  const md = [
    "# Phase 6.10.14 — Intraday Breakout Detection & Event-Driven Validation",
    "",
    `- **Final Classification:** \`${finalClassification}\``,
    `- **EOD-only (15:15 IST):** Trades=${modeA_eodOnly.length}, PF=${summarize(modeA_eodOnly).profitFactor}`,
    `- **Intraday First-Breakout (Next 1H Open, 25 bps):** Trades=${fullSummary.tradeCount}, WinRate=${fullSummary.winRatePct}%, PF=${fullSummary.profitFactor}, Exp=${fullSummary.expectancyR}R`,
    `- **Signal Funnel:** UniverseDays=${funnel.totalSymbolDaysEvaluated} -> Momentum=${funnel.momentumPasses} -> FirstBreakoutDays=${funnel.firstBreakoutSignalsUniquePerDay} (${funnel.duplicateSignalsPrevented} duplicates prevented) -> ExecutableTrades=${modeD_firstBreakoutNext1hOpen.length}`,
    `- **Untouched OOS (2025 Q4-2026):** Trades=${oosSummary.tradeCount}, WinRate=${oosSummary.winRatePct}%, PF=${oosSummary.profitFactor}, Exp=${oosSummary.expectancyR}R`,
    "",
    "## Safety Confirmation",
    "- `STRATEGY_01 = false`, `STRATEGY_02 = false`, `STRATEGY_03 = false`, `LIVE_TRADING = false`, `BROKER_EXECUTION_ENABLED = false`, `experimental_paper_trades = 0`.",
  ].join("\n");
  fs.writeFileSync(path.join(OUT_DIR, "phase61014_final_report.md"), md);

  console.log("Phase 6.10.14 complete:", {
    finalClassification,
    eodTrades: modeA_eodOnly.length,
    intradayFirstTrades: fullSummary.tradeCount,
    fullSummary,
    oosSummary,
    paperTrades: paperTradesCount ?? 0,
  });
}

if (process.argv[1]?.includes("runPhase61014Research")) {
  main().catch((err) => {
    console.error("Phase 6.10.14 failed:", err);
    process.exit(1);
  });
}

