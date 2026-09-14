/**
 * PinePaperTracker (Shadow Paper / Non-Executing Tracker)
 * ========================================================
 * Evaluates live signals in parallel across Baseline (Control A) and Variant B
 * without executing any real broker orders.
 *
 * Safety Guarantees:
 *   - PURE SHADOW MONITORING — NO order execution, NO broker API integration.
 *   - NEVER mutates live trading engine state.
 *   - LIVE_TRADING remains strictly false.
 */
import { PineSignal, Candle } from "./PineTypes";

export interface PaperTrackRecord {
  recordId: string;
  timestamp: string;
  instrument: string;
  direction: "BUY" | "SELL";
  liquidityType: string;
  referenceLevel: string;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  baselineSignal: boolean;
  variantBSignal: boolean;
  isFilteredByVariantB: boolean;
  htfTrendState: "BULLISH" | "BEARISH";
  status: "PENDING" | "TP" | "SL";
  exitTime?: string;
  exitPrice?: number;
  pnlDollar?: number;
  realizedR?: number;
}

export interface PaperTrackSummary {
  totalSignalsTracked: number;
  baselineTradesCount: number;
  baselineWinRatePct: number;
  baselineNetPnl: number;
  baselineProfitFactor: number;
  variantBTradesCount: number;
  variantBWinRatePct: number;
  variantBNetPnl: number;
  variantBProfitFactor: number;
  signalsFilteredByVariantBCount: number;
}

export class PinePaperTracker {
  private records: Map<string, PaperTrackRecord> = new Map();
  private recordHistory: PaperTrackRecord[] = [];

  constructor() {}

  /**
   * Tracks a newly emitted live PineSignal, recording both Baseline and Variant B states.
   */
  public trackSignal(
    signal: PineSignal,
    currentMarketPrice: number,
    htfTrendState: "BULLISH" | "BEARISH"
  ): PaperTrackRecord {
    const recordId = `paper_${signal.signalId}`;
    if (this.records.has(recordId)) {
      return this.records.get(recordId)!;
    }

    const SPREAD_SLIPPAGE = 0.30;
    const DEFAULT_SL_DIST = 5.00;
    const RISK_REWARD = 2.0;

    const entryPrice =
      signal.direction === "BUY"
        ? currentMarketPrice + SPREAD_SLIPPAGE
        : currentMarketPrice - SPREAD_SLIPPAGE;

    const stopLoss =
      signal.direction === "BUY"
        ? entryPrice - DEFAULT_SL_DIST
        : entryPrice + DEFAULT_SL_DIST;

    const takeProfit =
      signal.direction === "BUY"
        ? entryPrice + DEFAULT_SL_DIST * RISK_REWARD
        : entryPrice - DEFAULT_SL_DIST * RISK_REWARD;

    // Variant B Rule: Block BUY signals referencing SWL when HTF trend is BEARISH
    const isFilteredByVariantB =
      signal.referenceLevelType === "SWL" &&
      signal.direction === "BUY" &&
      htfTrendState === "BEARISH";

    const record: PaperTrackRecord = {
      recordId,
      timestamp: signal.timestamp,
      instrument: signal.instrument,
      direction: signal.direction,
      liquidityType: signal.referenceLevelType,
      referenceLevel: signal.referenceLevel,
      entryPrice,
      stopLoss,
      takeProfit,
      baselineSignal: true,
      variantBSignal: !isFilteredByVariantB,
      isFilteredByVariantB,
      htfTrendState,
      status: "PENDING",
    };

    this.records.set(recordId, record);
    this.recordHistory.push(record);
    if (this.recordHistory.length > 500) this.recordHistory.shift();

    return record;
  }

  /**
   * Evaluates pending paper trade records against incoming market tick / candle.
   */
  public updatePriceTick(candle: Candle): void {
    for (const record of this.records.values()) {
      if (record.status !== "PENDING") continue;

      const riskAmount = Math.abs(record.entryPrice - record.stopLoss);

      if (record.direction === "BUY") {
        const hitSL = candle.low <= record.stopLoss;
        const hitTP = candle.high >= record.takeProfit;

        if (hitSL && hitTP) {
          record.status = "SL";
          record.exitTime = candle.timestamp;
          record.exitPrice = record.stopLoss;
          record.pnlDollar = -riskAmount;
          record.realizedR = -1.0;
        } else if (hitSL) {
          record.status = "SL";
          record.exitTime = candle.timestamp;
          record.exitPrice = record.stopLoss;
          record.pnlDollar = -riskAmount;
          record.realizedR = -1.0;
        } else if (hitTP) {
          record.status = "TP";
          record.exitTime = candle.timestamp;
          record.exitPrice = record.takeProfit;
          record.pnlDollar = riskAmount * 2.0;
          record.realizedR = 2.0;
        }
      } else {
        const hitSL = candle.high >= record.stopLoss;
        const hitTP = candle.low <= record.takeProfit;

        if (hitSL && hitTP) {
          record.status = "SL";
          record.exitTime = candle.timestamp;
          record.exitPrice = record.stopLoss;
          record.pnlDollar = -riskAmount;
          record.realizedR = -1.0;
        } else if (hitSL) {
          record.status = "SL";
          record.exitTime = candle.timestamp;
          record.exitPrice = record.stopLoss;
          record.pnlDollar = -riskAmount;
          record.realizedR = -1.0;
        } else if (hitTP) {
          record.status = "TP";
          record.exitTime = candle.timestamp;
          record.exitPrice = record.takeProfit;
          record.pnlDollar = riskAmount * 2.0;
          record.realizedR = 2.0;
        }
      }
    }
  }

  public getRecords(): PaperTrackRecord[] {
    return Array.from(this.records.values());
  }

  public getSummary(): PaperTrackSummary {
    const all = Array.from(this.records.values());
    const baselineClosed = all.filter((r) => r.baselineSignal && r.status !== "PENDING");
    const variantBClosed = all.filter((r) => r.variantBSignal && r.status !== "PENDING");

    const baselineWins = baselineClosed.filter((r) => r.status === "TP");
    const variantBWins = variantBClosed.filter((r) => r.status === "TP");

    const baselineProfit = baselineClosed.reduce((sum, r) => sum + (r.pnlDollar && r.pnlDollar > 0 ? r.pnlDollar : 0), 0);
    const baselineLoss = baselineClosed.reduce((sum, r) => sum + (r.pnlDollar && r.pnlDollar < 0 ? Math.abs(r.pnlDollar) : 0), 0);

    const variantBProfit = variantBClosed.reduce((sum, r) => sum + (r.pnlDollar && r.pnlDollar > 0 ? r.pnlDollar : 0), 0);
    const variantBLoss = variantBClosed.reduce((sum, r) => sum + (r.pnlDollar && r.pnlDollar < 0 ? Math.abs(r.pnlDollar) : 0), 0);

    return {
      totalSignalsTracked: all.length,
      baselineTradesCount: baselineClosed.length,
      baselineWinRatePct: baselineClosed.length > 0 ? (baselineWins.length / baselineClosed.length) * 100 : 0,
      baselineNetPnl: baselineProfit - baselineLoss,
      baselineProfitFactor: baselineLoss > 0 ? baselineProfit / baselineLoss : baselineProfit > 0 ? Infinity : 0,
      variantBTradesCount: variantBClosed.length,
      variantBWinRatePct: variantBClosed.length > 0 ? (variantBWins.length / variantBClosed.length) * 100 : 0,
      variantBNetPnl: variantBProfit - variantBLoss,
      variantBProfitFactor: variantBLoss > 0 ? variantBProfit / variantBLoss : variantBProfit > 0 ? Infinity : 0,
      signalsFilteredByVariantBCount: all.filter((r) => r.isFilteredByVariantB).length,
    };
  }

  public clear(): void {
    this.records.clear();
    this.recordHistory = [];
  }
}

export const pinePaperTracker = new PinePaperTracker();
