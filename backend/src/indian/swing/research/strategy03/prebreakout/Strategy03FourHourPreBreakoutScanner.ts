import type { FourHourCandle } from "./Strategy03FourHourCandleProvider.js";

export type FourHourPreBreakoutStatus = "READY" | "FORMING" | "BREAKOUT" | "INVALIDATED" | "WAIT";

export interface FourHourSupportZone {
  detected: boolean;
  supportRelevance: "IMMEDIATE" | "DISTANT_HISTORICAL" | "NONE";
  supportDistancePct: number | null;
  supportHigh: number | null;
  supportLow: number | null;
  reactionCount: number;
  liquiditySweepDetected: boolean;
  sweepLow: number | null;
  reclaimTimestampIst: string | null;
  zoneStartIst: string | null;
  zoneEndIst: string | null;
  reason: string;
}

export type ConsolidationDurationCategory =
  | "SHORT_HIGH_QUALITY"
  | "MEDIUM_CLEAN"
  | "LONG_CLEAN"
  | "EXTENDED_BASE"
  | "NONE";

export interface FourHourConsolidationBox {
  detected: boolean;
  tier: ConsolidationDurationCategory;
  startIst: string | null;
  endIst: string | null;
  high: number | null;
  low: number | null;
  candleCount: number;
  tradingDaysElapsed: number;
  rangePct: number | null;
}

export interface FourHourOrderBlock {
  detected: boolean;
  obHigh: number | null;
  obLow: number | null;
  timestampIst: string | null;
  mitigated: boolean;
  invalidated: boolean;
  reason: string;
}

export interface FourHourPreBreakoutItem {
  idempotencyKey: string;
  nseSymbol: string;
  companyName: string;
  timeframe: "4H";
  status: FourHourPreBreakoutStatus;
  currentPrice: number | null;
  lastUpdatedIst: string;
  priorityScore: number;
  scoringReasons: string[];
  supportZone: FourHourSupportZone;
  impulse: {
    detected: boolean;
    candleCount: number;
    startIst: string | null;
    endIst: string | null;
    bodyExpansionRatio: number;
    displacementPct: number;
    rvol: number;
    volumeConfirmed: boolean;
  };
  consolidation: FourHourConsolidationBox;
  orderBlock: FourHourOrderBlock;
  breakoutDistancePct: number | null;
  dataProvider: string;
  sourceReference: string;
  sourceTimestampIst: string;
  independentVerificationStatus: "UNVERIFIED" | "VERIFIED" | "MISSING" | "CONFLICTED";
  reason: string;
  ohlcv4hDrilldownIst: Array<FourHourCandle & { timestampIst: string }>;
}

export interface FourHourScannerConfig {
  minHistory4hBars: number;
  maxDataAgeHours: number;
  minImpulseCandles: number;
  minBodyExpansion: number;
  minBodyToRange: number;
  minDisplacementPct: number;
  minRvol: number;
  shortConsMinBars: number;
  shortConsMaxBars: number;
  shortConsMaxRangePct: number;
  mediumConsMinBars: number;
  mediumConsMaxBars: number;
  mediumConsMaxRangePct: number;
  longConsMinBars: number;
  longConsMaxBars: number;
  longConsMaxRangePct: number;
  extendedBaseMaxRangePct: number;
  readyMaxBreakoutDistPct: number;
}

export const DEFAULT_4H_SCANNER_CONFIG: FourHourScannerConfig = {
  minHistory4hBars: 25,
  maxDataAgeHours: 96,
  minImpulseCandles: 3,
  minBodyExpansion: 1.3,
  minBodyToRange: 0.48,
  minDisplacementPct: 2.0,
  minRvol: 1.15,
  shortConsMinBars: 6,
  shortConsMaxBars: 8,
  shortConsMaxRangePct: 4.5,
  mediumConsMinBars: 9,
  mediumConsMaxBars: 16,
  mediumConsMaxRangePct: 6.5,
  longConsMinBars: 17,
  longConsMaxBars: 30,
  longConsMaxRangePct: 8.0,
  extendedBaseMaxRangePct: 9.5,
  readyMaxBreakoutDistPct: 4.0,
};

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function toIstIso(utcIso: string): string {
  const ms = Date.parse(utcIso);
  if (!Number.isFinite(ms)) return utcIso;
  return new Date(ms + 330 * 60_000).toISOString().replace("Z", "+05:30");
}

function makeWaitItem(params: {
  nseSymbol: string;
  companyName: string;
  reason: string;
  dataProvider: string;
  sourceReference: string;
  lastUpdatedIst?: string;
  currentPrice?: number | null;
  missing?: boolean;
}): FourHourPreBreakoutItem {
  const ts = params.lastUpdatedIst ?? "";
  return {
    idempotencyKey: `${params.nseSymbol}|4H|${ts || "NO_DATA"}`,
    nseSymbol: params.nseSymbol,
    companyName: params.companyName,
    timeframe: "4H",
    status: "WAIT",
    currentPrice: params.currentPrice ?? null,
    lastUpdatedIst: ts,
    priorityScore: 0,
    scoringReasons: [params.reason],
    supportZone: {
      detected: false,
      supportRelevance: "NONE",
      supportDistancePct: null,
      supportHigh: null,
      supportLow: null,
      reactionCount: 0,
      liquiditySweepDetected: false,
      sweepLow: null,
      reclaimTimestampIst: null,
      zoneStartIst: null,
      zoneEndIst: null,
      reason: params.reason,
    },
    impulse: {
      detected: false,
      candleCount: 0,
      startIst: null,
      endIst: null,
      bodyExpansionRatio: 0,
      displacementPct: 0,
      rvol: 0,
      volumeConfirmed: false,
    },
    consolidation: {
      detected: false,
      tier: "NONE",
      startIst: null,
      endIst: null,
      high: null,
      low: null,
      candleCount: 0,
      tradingDaysElapsed: 0,
      rangePct: null,
    },
    orderBlock: {
      detected: false,
      obHigh: null,
      obLow: null,
      timestampIst: null,
      mitigated: false,
      invalidated: false,
      reason: params.reason,
    },
    breakoutDistancePct: null,
    dataProvider: params.dataProvider,
    sourceReference: params.sourceReference,
    sourceTimestampIst: ts,
    independentVerificationStatus: params.missing ? "MISSING" : "UNVERIFIED",
    reason: params.reason,
    ohlcv4hDrilldownIst: [],
  };
}

/**
 * Evaluates Strategy 03 Swing Pre-Breakout strictly on completed 4H candles.
 * Never accepts 1H candles or incomplete 4H candles.
 */
export function evaluateFourHourPreBreakout(params: {
  nseSymbol: string;
  companyName: string;
  candles: FourHourCandle[];
  now?: Date;
  dataProvider: string;
  sourceReference: string;
  config?: FourHourScannerConfig;
}): FourHourPreBreakoutItem {
  const cfg = params.config ?? DEFAULT_4H_SCANNER_CONFIG;

  // 1. Strict 4H-only timeframe gate
  if (params.candles.some((c) => (c.timeframe as string) !== "4H")) {
    return makeWaitItem({
      nseSymbol: params.nseSymbol,
      companyName: params.companyName,
      reason: "TIMEFRAME_VIOLATION_1H_NOT_ALLOWED_IN_SWING",
      dataProvider: params.dataProvider,
      sourceReference: params.sourceReference,
    });
  }

  // 2. Completed 4H candles only (drop/reject incomplete latest bar from confirmed detection)
  const completed = params.candles.filter((c) => c.isComplete === true);
  if (completed.length < cfg.minHistory4hBars) {
    return makeWaitItem({
      nseSymbol: params.nseSymbol,
      companyName: params.companyName,
      reason:
        params.candles.length > completed.length && completed.length === 0
          ? "INCOMPLETE_4H_CANDLE_ONLY"
          : `MISSING_OR_INSUFFICIENT_4H_DATA_${completed.length}`,
      dataProvider: params.dataProvider,
      sourceReference: params.sourceReference,
      missing: completed.length === 0,
    });
  }

  const lastBar = completed[completed.length - 1];
  const lastIst = toIstIso(lastBar.timestamp);

  // 3. Freshness gate
  if (params.now) {
    const ageHours = (params.now.getTime() - Date.parse(lastBar.timestamp)) / 3_600_000;
    if (!Number.isFinite(ageHours) || ageHours > cfg.maxDataAgeHours) {
      return makeWaitItem({
        nseSymbol: params.nseSymbol,
        companyName: params.companyName,
        reason: `STALE_4H_DATA_${Math.round(ageHours)}H_OLD`,
        dataProvider: params.dataProvider,
        sourceReference: params.sourceReference,
        lastUpdatedIst: lastIst,
        currentPrice: lastBar.close,
      });
    }
  }

  // 4. Detect Strong Bullish Impulse on completed 4H bars (leaving >= 3 bars for post-impulse consolidation)
  let impStart = -1;
  let impEnd = -1;
  let impBodyExp = 0;
  let impDispPct = 0;
  let impRvol = 0;
  let impCount = 0;

  const searchEnd = completed.length - cfg.shortConsMinBars - 1;
  const searchStart = Math.max(10, completed.length - 65);

  for (let e = searchEnd; e >= searchStart + cfg.minImpulseCandles - 1; e--) {
    const sStart = Math.max(10, e - 5);
    const win = completed.slice(sStart, e + 1);
    const base = completed.slice(sStart - 10, sStart);
    const avgBody = base.reduce((a, c) => a + Math.abs(c.close - c.open), 0) / base.length;
    const volPerHr = (c: FourHourCandle) => {
      const hrs = c.blockDurationMinutes ? c.blockDurationMinutes / 60 : Math.max(1, c.constituentBarCount || 4);
      return c.volume / hrs;
    };
    const avgBaseVolPerHr = base.reduce((a, c) => a + volPerHr(c), 0) / base.length;
    if (avgBody <= 0) continue;

    const bullBars = win.filter((c) => {
      const r = c.high - c.low;
      const b = c.close - c.open;
      return b > 0 && r > 0 && b / r >= cfg.minBodyToRange && b >= avgBody * cfg.minBodyExpansion;
    });
    if (bullBars.length < cfg.minImpulseCandles) continue;

    const fIdx = completed.indexOf(bullBars[0]);
    const lIdx = completed.indexOf(bullBars[bullBars.length - 1]);
    const impSlice = completed.slice(fIdx, lIdx + 1);
    const startLow = Math.min(...impSlice.map((c) => c.low));
    const endClose = impSlice[impSlice.length - 1].close;
    const disp = startLow > 0 ? round2(((endClose - startLow) / startLow) * 100) : 0;
    if (disp < cfg.minDisplacementPct) continue;

    impStart = fIdx;
    impEnd = lIdx;
    impCount = impSlice.length;
    impBodyExp = round2((impSlice.reduce((a, c) => a + Math.max(0, c.close - c.open), 0) / impSlice.length) / avgBody);
    impDispPct = disp;
    impRvol = avgBaseVolPerHr > 0 ? round2((impSlice.reduce((a, c) => a + volPerHr(c), 0) / impSlice.length) / avgBaseVolPerHr) : 0;
    break;
  }

  if (impStart < 0) {
    return {
      ...makeWaitItem({
        nseSymbol: params.nseSymbol,
        companyName: params.companyName,
        reason: "NO_4H_BULLISH_IMPULSE",
        dataProvider: params.dataProvider,
        sourceReference: params.sourceReference,
        lastUpdatedIst: lastIst,
        currentPrice: lastBar.close,
      }),
      status: "FORMING",
      ohlcv4hDrilldownIst: completed.slice(-12).map((c) => ({ ...c, timestampIst: toIstIso(c.timestamp) })),
    };
  }

  // 5. Major Support / Liquidity Zone before impulse
  const preImp = completed.slice(Math.max(0, impStart - 16), impStart + 1);
  const preWindow = preImp.slice(0, -1);
  const priorSwingWindow = preWindow.length > 1 ? preWindow.slice(0, -1) : preWindow;
  const clusterAnchor = priorSwingWindow.length > 0 ? Math.min(...priorSwingWindow.map((c) => c.low)) : completed[impStart].low;
  const reactions = priorSwingWindow.filter((c) => c.low <= clusterAnchor * 1.015 && c.close >= clusterAnchor);
  const sweepBar = preImp.find(
    (c, idx) => idx > 1 && c.low < clusterAnchor && c.close > clusterAnchor && (c.close - c.low) > 0
  );
  const supportDetected = reactions.length >= 2 || Boolean(sweepBar);
  const supportLow = round2(sweepBar ? sweepBar.low : clusterAnchor);
  const supportHigh = round2(supportLow * 1.018);
  const supportDistancePct =
    supportDetected && lastBar.close > 0 ? round2(((lastBar.close - supportHigh) / supportHigh) * 100) : null;
  const supportRelevance: "IMMEDIATE" | "DISTANT_HISTORICAL" | "NONE" = !supportDetected
    ? "NONE"
    : supportDistancePct !== null && supportDistancePct <= 8.0
    ? "IMMEDIATE"
    : "DISTANT_HISTORICAL";

  const supportZone: FourHourSupportZone = {
    detected: supportDetected,
    supportRelevance,
    supportDistancePct,
    supportHigh: supportDetected ? supportHigh : null,
    supportLow: supportDetected ? supportLow : null,
    reactionCount: reactions.length,
    liquiditySweepDetected: Boolean(sweepBar),
    sweepLow: sweepBar ? sweepBar.low : null,
    reclaimTimestampIst: sweepBar ? toIstIso(sweepBar.timestamp) : null,
    zoneStartIst: preWindow[0] ? toIstIso(preWindow[0].timestamp) : null,
    zoneEndIst: preWindow[preWindow.length - 1] ? toIstIso(preWindow[preWindow.length - 1].timestamp) : null,
    reason: sweepBar
      ? "LIQUIDITY_SWEEP_AND_BULLISH_RECLAIM"
      : reactions.length >= 2
      ? `SUPPORT_CLUSTER_${reactions.length}_REACTIONS`
      : "NO_INSTITUTIONAL_SUPPORT_CLUSTER",
  };

  // 6. Valid Bullish Order Block (bearish candle before impulse displacement)
  const obSearch = completed.slice(Math.max(0, impStart - 3), impStart);
  const obCandle = [...obSearch].reverse().find((c) => c.close < c.open) ?? null;
  const postImp = completed.slice(impEnd + 1);
  const obInvalidated = obCandle ? postImp.some((c) => c.close < obCandle.low) : false;
  const obMitigated = obCandle ? postImp.some((c) => c.low <= obCandle.high && c.close >= obCandle.low) : false;

  const orderBlock: FourHourOrderBlock = {
    detected: Boolean(obCandle) && impDispPct >= cfg.minDisplacementPct,
    obHigh: obCandle ? obCandle.high : null,
    obLow: obCandle ? obCandle.low : null,
    timestampIst: obCandle ? toIstIso(obCandle.timestamp) : null,
    mitigated: obMitigated,
    invalidated: obInvalidated,
    reason: obCandle ? "BEARISH_4H_OB_WITH_DISPLACEMENT" : "NO_BEARISH_OB_CANDLE_BEFORE_IMPULSE",
  };

  // 7. Multi-Duration Post-Impulse Consolidation (actual completed 4H blocks & distinct NSE trading dates)
  const consCount = postImp.length;
  const tradingDaysElapsed = new Set(postImp.map((c) => toIstIso(c.timestamp).slice(0, 10))).size;
  const priorCons = consCount > 1 ? postImp.slice(0, -1) : postImp;
  const consHigh = Math.max(...priorCons.map((c) => c.high));
  const consLow = Math.min(...priorCons.map((c) => c.low));
  const rangePct = consLow > 0 ? round2(((consHigh - consLow) / consLow) * 100) : 99;

  let consTier: ConsolidationDurationCategory = "NONE";
  if (consCount >= cfg.shortConsMinBars && consCount <= cfg.shortConsMaxBars && rangePct <= cfg.shortConsMaxRangePct && supportDetected) {
    consTier = "SHORT_HIGH_QUALITY";
  } else if (consCount >= cfg.mediumConsMinBars && consCount <= cfg.mediumConsMaxBars && rangePct <= cfg.mediumConsMaxRangePct) {
    consTier = "MEDIUM_CLEAN";
  } else if (consCount >= cfg.longConsMinBars && consCount <= cfg.longConsMaxBars && rangePct <= cfg.longConsMaxRangePct) {
    consTier = "LONG_CLEAN";
  } else if (consCount > cfg.longConsMaxBars && rangePct <= cfg.extendedBaseMaxRangePct && supportDetected) {
    consTier = "EXTENDED_BASE";
  }

  const currentPrice = lastBar.close;
  const breakoutDistPct = currentPrice > 0 ? round2(((consHigh - currentPrice) / currentPrice) * 100) : null;

  // 8. Priority Scoring (short strong setups not penalized; longer duration does not auto-score higher)
  let score = 0;
  const reasons: string[] = [];
  if (reactions.length >= 2 && supportRelevance === "IMMEDIATE") {
    score += 15;
    reasons.push(`+15 Immediate support cluster (${reactions.length} reactions, ${supportDistancePct}% below)`);
  } else if (reactions.length >= 2) {
    reasons.push(`+0 Distant historical support (${supportDistancePct}% below; not immediate)`);
  }
  if (sweepBar) {
    score += 10;
    reasons.push("+10 Liquidity sweep & reclaim");
  }
  score += 20;
  reasons.push(`+20 4H Bullish impulse (${impCount}B, +${impDispPct}%)`);
  if (impBodyExp >= 1.6) {
    score += 5;
    reasons.push(`+5 Strong body expansion (${impBodyExp}x)`);
  }
  if (consTier === "SHORT_HIGH_QUALITY") {
    const pts = rangePct <= 3.5 ? 25 : 22;
    score += pts;
    reasons.push(`+${pts} Short high-quality consolidation (${consCount}B / ${tradingDaysElapsed}D, ${rangePct}%)`);
  } else if (consTier === "MEDIUM_CLEAN") {
    score += 25;
    reasons.push(`+25 Medium clean consolidation (${consCount}B / ${tradingDaysElapsed}D, ${rangePct}%)`);
  } else if (consTier === "LONG_CLEAN") {
    score += 23;
    reasons.push(`+23 Long clean consolidation (${consCount}B / ${tradingDaysElapsed}D, ${rangePct}%)`);
  } else if (consTier === "EXTENDED_BASE") {
    score += 20;
    reasons.push(`+20 Extended base (${consCount}B / ${tradingDaysElapsed}D, ${rangePct}%)`);
  }
  if (orderBlock.detected && !orderBlock.invalidated) {
    score += 15;
    reasons.push("+15 Valid 4H Bullish OB");
  }
  if (breakoutDistPct !== null && breakoutDistPct >= 0 && breakoutDistPct <= cfg.readyMaxBreakoutDistPct) {
    score += 5;
    reasons.push(`+5 Near breakout (${breakoutDistPct}% below high)`);
  }
  const volumeConfirmed = impRvol >= cfg.minRvol;
  if (volumeConfirmed) {
    score += 5;
    reasons.push(`+5 Volume confirmed (${impRvol}x)`);
  }

  // 9. Status Classification
  let status: FourHourPreBreakoutStatus = "FORMING";
  let reason = "4H_SETUP_DEVELOPING";

  if (obInvalidated || currentPrice < consLow || (supportDetected && currentPrice < supportLow)) {
    status = "INVALIDATED";
    reason = obInvalidated ? "4H_OB_INVALIDATED" : "4H_CONSOLIDATION_OR_SUPPORT_LOW_BROKEN";
  } else if (currentPrice > consHigh * 1.001) {
    status = "BREAKOUT";
    reason = "CONFIRMED_4H_BREAKOUT_ALREADY_OCCURRED";
  } else if (
    consTier !== "NONE" &&
    supportDetected &&
    breakoutDistPct !== null &&
    breakoutDistPct >= 0 &&
    breakoutDistPct <= cfg.readyMaxBreakoutDistPct
  ) {
    status = "READY";
    reason = `4H_PRE_BREAKOUT_READY_${consTier}_${breakoutDistPct}PCT`;
  }

  const drillStart = Math.max(0, impStart - 6);
  return {
    idempotencyKey: `${params.nseSymbol}|4H|${lastIst}`,
    nseSymbol: params.nseSymbol,
    companyName: params.companyName,
    timeframe: "4H",
    status,
    currentPrice,
    lastUpdatedIst: lastIst,
    priorityScore: score,
    scoringReasons: reasons,
    supportZone,
    impulse: {
      detected: true,
      candleCount: impCount,
      startIst: toIstIso(completed[impStart].timestamp),
      endIst: toIstIso(completed[impEnd].timestamp),
      bodyExpansionRatio: impBodyExp,
      displacementPct: impDispPct,
      rvol: impRvol,
      volumeConfirmed,
    },
    consolidation: {
      detected: consTier !== "NONE",
      tier: consTier,
      startIst: postImp[0] ? toIstIso(postImp[0].timestamp) : null,
      endIst: postImp[postImp.length - 1] ? toIstIso(postImp[postImp.length - 1].timestamp) : null,
      high: consHigh,
      low: consLow,
      candleCount: consCount,
      tradingDaysElapsed,
      rangePct,
    },
    orderBlock,
    breakoutDistancePct: breakoutDistPct,
    dataProvider: params.dataProvider,
    sourceReference: params.sourceReference,
    sourceTimestampIst: lastIst,
    independentVerificationStatus: "UNVERIFIED",
    reason,
    ohlcv4hDrilldownIst: completed.slice(drillStart).map((c) => ({ ...c, timestampIst: toIstIso(c.timestamp) })),
  };
}
