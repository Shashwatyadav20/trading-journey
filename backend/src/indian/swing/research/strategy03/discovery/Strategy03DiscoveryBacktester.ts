import type { DailyCandleBar } from "../HistoricalValidationEngine.js";
import type { DiscoverySignal } from "./Strategy03InstitutionalAccumulationResearch.js";

export interface DiscoveryTradeOutcome {
  hypothesis: DiscoverySignal["hypothesis"];
  symbol: string;
  sector: string;
  marketCapCategory: string;
  signalDate: string;
  entryDate: string;
  entryPrice: number;
  stopLoss: number;
  target1: number;
  target2: number;
  exitDate: string;
  exitPrice: number;
  exitReason: "GAP_THROUGH_SL" | "SL_HIT" | "TARGET_1" | "TARGET_2" | "TIME_EXIT";
  grossReturnPct: number;
  netReturnPct: number;
  rMultiple: number;
  holdingDays: number;
  mfePct: number;
  maePct: number;
  ret5dPct: number | null;
  ret10dPct: number | null;
  ret20dPct: number | null;
  ret60dPct: number | null;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function simulateDiscoveryTrade(params: {
  signal: DiscoverySignal;
  futureDailyCandles: DailyCandleBar[];
  oneWayCostBps?: number;
  slippageBps?: number;
  maxHoldingDays?: number;
}): DiscoveryTradeOutcome | null {
  const { signal, futureDailyCandles } = params;
  if (!signal.eligible || futureDailyCandles.length === 0 || signal.structuralStopLoss === null || signal.target1 === null || signal.target2 === null) {
    return null;
  }

  const slip = (params.slippageBps ?? 8) / 10_000;
  const cost = ((params.oneWayCostBps ?? 25) / 10_000) * 2 * 100;
  const maxDays = params.maxHoldingDays ?? 30;
  const entryBar = futureDailyCandles[0];
  const entryPrice = round2(entryBar.open * (1 + slip));
  const sl = signal.structuralStopLoss;
  const t1 = signal.target1;
  const t2 = signal.target2;
  const risk = entryPrice - sl;
  if (risk <= 0) return null;

  let exitPrice = futureDailyCandles[Math.min(futureDailyCandles.length - 1, maxDays - 1)].adjClose;
  let exitDate = futureDailyCandles[Math.min(futureDailyCandles.length - 1, maxDays - 1)].date;
  let exitReason: DiscoveryTradeOutcome["exitReason"] = "TIME_EXIT";
  let holdingDays = Math.min(futureDailyCandles.length, maxDays);
  let mfe = -Infinity;
  let mae = Infinity;

  for (let i = 0; i < Math.min(futureDailyCandles.length, maxDays); i++) {
    const b = futureDailyCandles[i];
    mfe = Math.max(mfe, ((b.high - entryPrice) / entryPrice) * 100);
    mae = Math.min(mae, ((b.low - entryPrice) / entryPrice) * 100);

    if (b.open <= sl) {
      exitPrice = round2(b.open * (1 - slip));
      exitDate = b.date;
      exitReason = "GAP_THROUGH_SL";
      holdingDays = i + 1;
      break;
    }
    if (b.low <= sl) {
      exitPrice = round2(sl * (1 - slip));
      exitDate = b.date;
      exitReason = "SL_HIT";
      holdingDays = i + 1;
      break;
    }
    if (b.high >= t2) {
      exitPrice = round2(t2 * (1 - slip));
      exitDate = b.date;
      exitReason = "TARGET_2";
      holdingDays = i + 1;
      break;
    }
    if (b.high >= t1 && i >= 2) {
      exitPrice = round2(t1 * (1 - slip));
      exitDate = b.date;
      exitReason = "TARGET_1";
      holdingDays = i + 1;
      break;
    }
  }

  const grossRet = ((exitPrice - entryPrice) / entryPrice) * 100;
  const netRet = grossRet - cost;
  const riskPct = (risk / entryPrice) * 100;
  const fwd = (d: number) =>
    futureDailyCandles.length >= d
      ? round2(((futureDailyCandles[d - 1].adjClose - entryPrice) / entryPrice) * 100)
      : null;

  return {
    hypothesis: signal.hypothesis,
    symbol: signal.symbol,
    sector: signal.sector,
    marketCapCategory: signal.marketCapCategory,
    signalDate: signal.signalDate,
    entryDate: entryBar.date,
    entryPrice,
    stopLoss: sl,
    target1: t1,
    target2: t2,
    exitDate,
    exitPrice,
    exitReason,
    grossReturnPct: round2(grossRet),
    netReturnPct: round2(netRet),
    rMultiple: round2(netRet / riskPct),
    holdingDays,
    mfePct: Number.isFinite(mfe) ? round2(mfe) : 0,
    maePct: Number.isFinite(mae) ? round2(mae) : 0,
    ret5dPct: fwd(5),
    ret10dPct: fwd(10),
    ret20dPct: fwd(20),
    ret60dPct: fwd(60),
  };
}

