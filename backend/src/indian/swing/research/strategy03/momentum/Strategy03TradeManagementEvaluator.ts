import type { OhlcvCandle } from "../entry/EntrySetupTypes.js";
import { wilsonWinRateCI } from "../StatisticalRobustnessEngine.js";
import type { CapSegment, MarketRegime } from "../runPhase61013Research.js";

export type VolatilityRegime = "HIGH_VOL" | "LOW_VOL";

export type ExitModeId =
  | "A_FIXED_1TO3_BASELINE"
  | "B_FIXED_1TO2"
  | "C_TRAIL_AFTER_1R"
  | "D_ATR_TRAIL_AFTER_1R"
  | "E_PARTIAL_50_AT_1R_TRAIL"
  | "F_TIME_EXIT_FAIL_20BARS"
  | "G1_BREAKEVEN_3PCT"
  | "G2_BREAKEVEN_4PCT";

export interface ExitConfig {
  mode: ExitModeId;
  targetR?: number;
  trailAfter1RRiskMult?: number;
  atrTrailMult?: number;
  partialAt1RPct?: number;
  timeFailBars?: number;
  timeFailMinR?: number;
  breakevenMovePct?: number;
  slippageBps?: number;
  oneWayCostBps?: number;
}

export interface ManagedTradeResult {
  symbol: string;
  sector: string;
  capSegment: CapSegment;
  regime: MarketRegime;
  volRegime: VolatilityRegime;
  entryDate: string;
  entryPrice: number;
  initialSl: number;
  riskInr: number;
  riskPct: number;
  exitPrice: number;
  exitReason: string;
  grossReturnPct: number;
  netReturnPct: number;
  rMultiple: number;
  holdingBars: number;
  mfePct: number;
  mfeR: number;
  maePct: number;
  maeR: number;
  barsTo05R: number | null;
  barsTo1R: number | null;
  barsTo2R: number | null;
  barsTo3R: number | null;
  reached1RBeforeSL: boolean;
  reached2RBeforeReversal: boolean;
  profitGivebackPct: number;
  isGapThroughStop: boolean;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function compute1hAtr14(candles: OhlcvCandle[]): number {
  if (candles.length < 15) return 0;
  let sum = 0;
  for (let i = candles.length - 14; i < candles.length; i++) {
    const cur = candles[i];
    const prev = candles[i - 1];
    sum += Math.max(cur.high - cur.low, Math.abs(cur.high - prev.close), Math.abs(cur.low - prev.close));
  }
  return sum / 14;
}

export function simulateManagedTrade(params: {
  symbol: string;
  sector: string;
  capSegment: CapSegment;
  regime: MarketRegime;
  volRegime: VolatilityRegime;
  entryDate: string;
  future1h: OhlcvCandle[];
  slPrice: number;
  atr14: number;
  config: ExitConfig;
}): ManagedTradeResult | null {
  if (params.future1h.length < 2) return null;
  const slip = (params.config.slippageBps ?? 8) / 10_000;
  const costPct = ((params.config.oneWayCostBps ?? 25) * 2) / 100;
  const entry = params.future1h[0].open * (1 + slip);
  let sl = params.slPrice;
  const risk = entry - sl;
  if (risk <= 0 || risk / entry > 0.12) return null;

  const target = params.config.targetR ? entry + risk * params.config.targetR : null;
  const maxBars = Math.min(120, params.future1h.length);

  let exitPrice = params.future1h[maxBars - 1].close * (1 - slip);
  let exitReason = "TIME_STOP";
  let holdingBars = maxBars;

  let mfe = -Infinity;
  let mae = Infinity;
  let highWater = entry;
  let barsTo05R: number | null = null;
  let barsTo1R: number | null = null;
  let barsTo2R: number | null = null;
  let barsTo3R: number | null = null;
  let reached1RBeforeSL = false;
  let reached2RBeforeReversal = false;

  let partialBookedWeight = 0;
  let partialGrossPct = 0;

  for (let i = 0; i < maxBars; i++) {
    const b = params.future1h[i];
    const barMfe = ((b.high - entry) / entry) * 100;
    const barMae = ((b.low - entry) / entry) * 100;
    mfe = Math.max(mfe, barMfe);
    mae = Math.min(mae, barMae);

    const barMfeR = (b.high - entry) / risk;
    if (barsTo05R === null && barMfeR >= 0.5) barsTo05R = i + 1;
    if (barsTo1R === null && barMfeR >= 1.0) {
      barsTo1R = i + 1;
      reached1RBeforeSL = true;
    }
    if (barsTo2R === null && barMfeR >= 2.0) {
      barsTo2R = i + 1;
      reached2RBeforeReversal = true;
    }
    if (barsTo3R === null && barMfeR >= 3.0) barsTo3R = i + 1;

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

    // Partial profit at +1R
    if (params.config.partialAt1RPct && partialBookedWeight === 0 && b.high >= entry + risk) {
      const bookPrice = (entry + risk) * (1 - slip);
      partialBookedWeight = params.config.partialAt1RPct;
      partialGrossPct = ((bookPrice - entry) / entry) * 100;
      sl = Math.max(sl, entry); // protect remainder at breakeven
    }

    // Breakeven % rules
    if (params.config.breakevenMovePct && barMfe >= params.config.breakevenMovePct) {
      sl = Math.max(sl, entry);
    }

    // Trailing after +1R (R-based or ATR-based)
    if (highWater - entry >= risk) {
      if (params.config.trailAfter1RRiskMult) {
        sl = Math.max(sl, highWater - risk * params.config.trailAfter1RRiskMult);
      }
      if (params.config.atrTrailMult && params.atr14 > 0) {
        sl = Math.max(sl, highWater - params.atr14 * params.config.atrTrailMult);
      }
    }

    // Fixed target
    if (target !== null && b.high >= target) {
      exitPrice = target * (1 - slip);
      exitReason = "TARGET_HIT";
      holdingBars = i + 1;
      break;
    }

    // Time-based momentum failure exit
    if (
      params.config.timeFailBars &&
      i + 1 >= params.config.timeFailBars &&
      (b.close - entry) / risk < (params.config.timeFailMinR ?? 0.5)
    ) {
      exitPrice = b.close * (1 - slip);
      exitReason = "TIME_MOMENTUM_FAIL";
      holdingBars = i + 1;
      break;
    }
  }

  const remGrossPct = ((exitPrice - entry) / entry) * 100;
  const grossRet =
    partialBookedWeight > 0
      ? partialBookedWeight * partialGrossPct + (1 - partialBookedWeight) * remGrossPct
      : remGrossPct;
  const netRet = grossRet - costPct;
  const riskPct = (risk / entry) * 100;
  const mfePct = Number.isFinite(mfe) ? mfe : 0;
  const maePct = Number.isFinite(mae) ? mae : 0;

  return {
    symbol: params.symbol,
    sector: params.sector,
    capSegment: params.capSegment,
    regime: params.regime,
    volRegime: params.volRegime,
    entryDate: params.entryDate,
    entryPrice: round2(entry),
    initialSl: round2(params.slPrice),
    riskInr: round2(risk),
    riskPct: round2(riskPct),
    exitPrice: round2(exitPrice),
    exitReason,
    grossReturnPct: round2(grossRet),
    netReturnPct: round2(netRet),
    rMultiple: round2(netRet / riskPct),
    holdingBars,
    mfePct: round2(mfePct),
    mfeR: round2(mfePct / riskPct),
    maePct: round2(maePct),
    maeR: round2(maePct / riskPct),
    barsTo05R,
    barsTo1R,
    barsTo2R,
    barsTo3R,
    reached1RBeforeSL,
    reached2RBeforeReversal,
    profitGivebackPct: round2(Math.max(0, mfePct - grossRet)),
    isGapThroughStop: exitReason === "GAP_SL_HIT",
  };
}

export function summarizeManagedTrades(rows: ManagedTradeResult[]) {
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
      avgMfePct: 0,
      avgMaePct: 0,
      avgGivebackPct: 0,
      avgHoldingBars: 0,
      gapLossPct: 0,
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
    avgMfePct: round2(rows.reduce((a, r) => a + r.mfePct, 0) / rows.length),
    avgMaePct: round2(rows.reduce((a, r) => a + r.maePct, 0) / rows.length),
    avgGivebackPct: round2(rows.reduce((a, r) => a + r.profitGivebackPct, 0) / rows.length),
    avgHoldingBars: round2(rows.reduce((a, r) => a + r.holdingBars, 0) / rows.length),
    gapLossPct: round2((rows.filter((r) => r.isGapThroughStop).length / rows.length) * 100),
  };
}

