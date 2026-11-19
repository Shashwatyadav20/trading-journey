import type { OhlcvCandle } from "../entry/EntrySetupTypes.js";
import { detectBullishImpulse, type ImpulseStructureEvidence } from "./Strategy03ImpulseDetector.js";
import { detectBullishOrderBlock } from "./Strategy03OrderBlockDetector.js";
import { DEFAULT_PREBREAKOUT_CONFIG, type PreBreakoutConfig } from "./Strategy03PreBreakoutConfig.js";

export type PreBreakoutStatus = "READY" | "FORMING" | "BREAKOUT" | "INVALIDATED" | "WAIT";

export interface PreBreakoutSetupItem {
  idempotencyKey: string;
  nseSymbol: string;
  companyName: string;
  timeframe: "1H";
  status: PreBreakoutStatus;
  currentPrice: number | null;
  lastUpdatedIst: string;
  impulseStartIst: string | null;
  impulseEndIst: string | null;
  impulseCandleCount: number;
  impulseBodyExpansion: number;
  impulseRvol: number;
  consolidationStartIst: string | null;
  consolidationEndIst: string | null;
  consolidationHigh: number | null;
  consolidationLow: number | null;
  consolidationCandleCount: number;
  consolidationRangePct: number | null;
  obHigh: number | null;
  obLow: number | null;
  obTimestampIst: string | null;
  obMitigated: boolean;
  structureEvidence: ImpulseStructureEvidence;
  breakoutDistancePct: number | null;
  dataProvider: string;
  sourceReference: string;
  sourceTimestampIst: string;
  internalDetected: boolean;
  independentVerificationStatus: "UNVERIFIED" | "VERIFIED" | "MISSING" | "CONFLICTED";
  reason: string;
  ohlcvDrilldownIst: Array<OhlcvCandle & { timestampIst: string }>;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function toIstIso(utcIso: string): string {
  const ms = Date.parse(utcIso);
  if (!Number.isFinite(ms)) return utcIso;
  return new Date(ms + 330 * 60_000).toISOString().replace("Z", "+05:30");
}

function hasValidOhlcv(candles: OhlcvCandle[]): boolean {
  return candles.every(
    (c) =>
      Number.isFinite(c.open) &&
      Number.isFinite(c.high) &&
      Number.isFinite(c.low) &&
      Number.isFinite(c.close) &&
      Number.isFinite(c.volume) &&
      c.close > 0 &&
      c.high >= Math.max(c.open, c.close) &&
      c.low <= Math.min(c.open, c.close)
  );
}

/**
 * Evaluates pre-breakout status strictly on completed historical candles (no future candle access).
 */
export function evaluatePreBreakoutSetup(params: {
  nseSymbol: string;
  companyName: string;
  completedCandles: OhlcvCandle[];
  dataProvider: string;
  sourceReference: string;
  config?: PreBreakoutConfig;
}): PreBreakoutSetupItem {
  const cfg = params.config ?? DEFAULT_PREBREAKOUT_CONFIG;
  const candles = params.completedCandles;
  const lastBar = candles[candles.length - 1];
  const lastIst = lastBar ? toIstIso(lastBar.timestamp) : "";

  const makeWait = (reason: string): PreBreakoutSetupItem => ({
    idempotencyKey: `${params.nseSymbol}|${lastIst || "NO_DATA"}`,
    nseSymbol: params.nseSymbol,
    companyName: params.companyName,
    timeframe: cfg.timeframe,
    status: "WAIT",
    currentPrice: lastBar?.close ?? null,
    lastUpdatedIst: lastIst,
    impulseStartIst: null,
    impulseEndIst: null,
    impulseCandleCount: 0,
    impulseBodyExpansion: 0,
    impulseRvol: 0,
    consolidationStartIst: null,
    consolidationEndIst: null,
    consolidationHigh: null,
    consolidationLow: null,
    consolidationCandleCount: 0,
    consolidationRangePct: null,
    obHigh: null,
    obLow: null,
    obTimestampIst: null,
    obMitigated: false,
    structureEvidence: "NONE",
    breakoutDistancePct: null,
    dataProvider: params.dataProvider,
    sourceReference: params.sourceReference,
    sourceTimestampIst: lastIst,
    internalDetected: false,
    independentVerificationStatus: candles.length === 0 ? "MISSING" : "UNVERIFIED",
    reason,
    ohlcvDrilldownIst: [],
  });

  if (candles.length < cfg.minHistoryCandles) {
    return makeWait(`INSUFFICIENT_HISTORY_${candles.length}_LT_${cfg.minHistoryCandles}`);
  }
  if (!hasValidOhlcv(candles.slice(-cfg.minHistoryCandles))) {
    return makeWait("INVALID_OR_CONFLICTING_OHLCV");
  }

  const impulse = detectBullishImpulse(candles, cfg);
  if (!impulse.detected) {
    return {
      ...makeWait(impulse.reason),
      status: "FORMING",
      reason: "NO_STRONG_BULLISH_IMPULSE_YET",
      ohlcvDrilldownIst: candles.slice(-15).map((c) => ({ ...c, timestampIst: toIstIso(c.timestamp) })),
    };
  }

  const ob = detectBullishOrderBlock({ completedCandles: candles, impulse });
  const consSlice = candles.slice(impulse.endIndex + 1);
  const consCount = consSlice.length;

  if (consCount < cfg.consolidationMinCandles) {
    return {
      ...makeWait("CONSOLIDATION_TOO_SHORT"),
      status: "FORMING",
      impulseStartIst: impulse.startIst,
      impulseEndIst: impulse.endIst,
      impulseCandleCount: impulse.candleCount,
      impulseBodyExpansion: impulse.bodyExpansionRatio,
      impulseRvol: impulse.rvol,
      obHigh: ob.obHigh,
      obLow: ob.obLow,
      obTimestampIst: ob.timestampIst || null,
      obMitigated: ob.mitigated,
      structureEvidence: impulse.structureEvidence,
      reason: `FORMING_CONSOLIDATION_${consCount}_CANDLES`,
      ohlcvDrilldownIst: candles.slice(Math.max(0, impulse.startIndex - 3)).map((c) => ({ ...c, timestampIst: toIstIso(c.timestamp) })),
    };
  }

  // Consolidation boundaries use bars strictly after impulse up to prior completed bar (or all post-impulse bars if checking pre-breakout)
  const boxBars = consSlice.slice(0, Math.min(consCount, cfg.consolidationMaxCandles));
  const priorBoxBars = consCount > 1 ? consSlice.slice(0, -1) : boxBars;
  const consHigh = Math.max(...priorBoxBars.map((c) => c.high));
  const consLow = Math.min(...priorBoxBars.map((c) => c.low));
  const rangePct = consLow > 0 ? round2(((consHigh - consLow) / consLow) * 100) : 99;
  const currentPrice = lastBar.close;
  const breakoutDistancePct = currentPrice > 0 ? round2(((consHigh - currentPrice) / currentPrice) * 100) : null;

  let status: PreBreakoutStatus = "FORMING";
  let reason = "CONSOLIDATION_IN_PROGRESS";

  if (ob.invalidated || currentPrice < consLow) {
    status = "INVALIDATED";
    reason = ob.invalidated ? "OB_LOW_BROKEN" : "CONSOLIDATION_LOW_BROKEN";
  } else if (currentPrice > consHigh * 1.001) {
    status = "BREAKOUT";
    reason = "BREAKOUT_CANDLE_ALREADY_CLOSED_ABOVE_CONSOLIDATION_HIGH";
  } else if (rangePct > cfg.consolidationMaxRangePct) {
    status = "FORMING";
    reason = `CONSOLIDATION_TOO_WIDE_${rangePct}PCT`;
  } else if (
    ob.detected &&
    breakoutDistancePct !== null &&
    breakoutDistancePct >= 0 &&
    breakoutDistancePct <= cfg.readyMaxBreakoutDistancePct
  ) {
    status = "READY";
    reason = `PRE_BREAKOUT_READY_${breakoutDistancePct}PCT_BELOW_HIGH`;
  }

  const drillStart = Math.max(0, impulse.startIndex - 3);
  return {
    idempotencyKey: `${params.nseSymbol}|${lastIst}`,
    nseSymbol: params.nseSymbol,
    companyName: params.companyName,
    timeframe: cfg.timeframe,
    status,
    currentPrice,
    lastUpdatedIst: lastIst,
    impulseStartIst: impulse.startIst,
    impulseEndIst: impulse.endIst,
    impulseCandleCount: impulse.candleCount,
    impulseBodyExpansion: impulse.bodyExpansionRatio,
    impulseRvol: impulse.rvol,
    consolidationStartIst: toIstIso(boxBars[0].timestamp),
    consolidationEndIst: toIstIso(boxBars[boxBars.length - 1].timestamp),
    consolidationHigh: consHigh,
    consolidationLow: consLow,
    consolidationCandleCount: consCount,
    consolidationRangePct: rangePct,
    obHigh: ob.obHigh,
    obLow: ob.obLow,
    obTimestampIst: ob.timestampIst || null,
    obMitigated: ob.mitigated,
    structureEvidence: impulse.structureEvidence,
    breakoutDistancePct,
    dataProvider: params.dataProvider,
    sourceReference: params.sourceReference,
    sourceTimestampIst: lastIst,
    internalDetected: true,
    independentVerificationStatus: "UNVERIFIED",
    reason,
    ohlcvDrilldownIst: candles.slice(drillStart).map((c) => ({ ...c, timestampIst: toIstIso(c.timestamp) })),
  };
}

