import { describe, it, expect } from "vitest";
import { PineLiquidityEngine } from "../PineLiquidityEngine";
import { PineSignalEngine } from "../PineSignalEngine";
import { PineAlertBridge } from "../PineAlertBridge";
import { Candle, PineSignal } from "../PineTypes";

interface SimulatedTrade {
  tradeId: string;
  signalId: string;
  instrument: string;
  timeframe: string;
  strategy: string;
  direction: "BUY" | "SELL";
  referenceLevel: string;
  referenceLevelType: string;
  signalTime: string;
  entryTime: string;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  riskAmount: number;
  exitTime?: string;
  exitPrice?: number;
  exitReason?: "TP" | "SL" | "OPEN";
  pnlDollar?: number;
  realizedR?: number;
  barsHeld?: number;
  variantId: "ControlA" | "VariantB";
}

interface SummaryResult {
  variantId: string;
  name: string;
  totalSignals: number;
  totalTrades: number;
  longCount: number;
  shortCount: number;
  wins: number;
  losses: number;
  winRatePct: number;
  grossProfit: number;
  grossLoss: number;
  netPnl: number;
  profitFactor: number;
  averageR: number;
  expectancy: number;
  maxDrawdownDollar: number;
  maxDrawdownPct: number;
  maxConsecutiveLosses: number;
  pnlDiffVsControlA: number;
  expectancyDiffVsControlA: number;
  drawdownDiffVsControlA: number;
}

function calculateSMA(prices: number[], period: number, currentIndex: number): number {
  if (currentIndex < period - 1) return prices[currentIndex];
  let sum = 0;
  for (let k = currentIndex - period + 1; k <= currentIndex; k++) {
    sum += prices[k];
  }
  return sum / period;
}

describe("Canonical XAU/USD Strategy Backtest & Variant B Validation", () => {
  it("Runs canonical production engine backtest for Control A and Variant B", async () => {
    // ── 1. Ingest Dataset ─────────────────────────────────────────────────────
    const url = "https://trading-journeyy-backend.onrender.com/pine/candles/XAU%2FUSD?tf=15";
    const res = await fetch(url);
    expect(res.ok).toBe(true);
    const data = await res.json();
    const candles: Candle[] = data.candles || [];
    candles.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const SPREAD_SLIPPAGE = 0.30;
    const DEFAULT_SL_DIST = 5.00;
    const RISK_REWARD_RATIO = 2.0;

    function runCanonicalSimulation(variantId: "ControlA" | "VariantB"): SimulatedTrade[] {
      const engine = new PineLiquidityEngine({}, 15);
      const signalEngine = new PineSignalEngine();
      const bridge = new PineAlertBridge();
      bridge.registerEngine("XAU/USD", engine);

      const trades: SimulatedTrade[] = [];
      let prevCandle: Candle | null = null;
      const historyCloses: number[] = [];

      for (let i = 0; i < candles.length; i++) {
        const candle = candles[i];
        historyCloses.push(candle.close);

        // Evaluate candle wick in bridge
        bridge.evaluateCandleWick("XAU/USD", candle, candle.timestamp);

        // Evaluate PineSignalEngine BEFORE processCandle removes broken levels
        const rawSignals = signalEngine.evaluateCandle("XAU/USD", candle, prevCandle, engine);

        // Calculate HTF trend filter from past close prices (50-period SMA on 15M = 12.5h trend proxy)
        const sma50 = calculateSMA(historyCloses, Math.min(50, historyCloses.length), historyCloses.length - 1);
        const isBearishTrend = candle.close < sma50;

        for (const sig of rawSignals) {
          let allowSignal = true;

          if (variantId === "VariantB") {
            // Variant B: Block BUY signals referencing SWL when HTF structure is bearish
            if (sig.referenceLevelType === "SWL" && sig.direction === "BUY" && isBearishTrend) {
              allowSignal = false;
            }
          }

          if (!allowSignal) continue;

          const direction = sig.direction;
          const rawEntry = candle.close;
          const entryPrice = direction === "BUY" ? rawEntry + SPREAD_SLIPPAGE : rawEntry - SPREAD_SLIPPAGE;

          let stopLoss = direction === "BUY" ? entryPrice - DEFAULT_SL_DIST : entryPrice + DEFAULT_SL_DIST;
          let takeProfit = direction === "BUY" ? entryPrice + DEFAULT_SL_DIST * RISK_REWARD_RATIO : entryPrice - DEFAULT_SL_DIST * RISK_REWARD_RATIO;
          const riskAmount = Math.abs(entryPrice - stopLoss);

          const trade: SimulatedTrade = {
            tradeId: `tr_${variantId}_${sig.signalId}`,
            signalId: sig.signalId,
            instrument: "XAU/USD",
            timeframe: sig.timeframe,
            strategy: sig.strategy,
            direction,
            referenceLevel: sig.referenceLevel,
            referenceLevelType: sig.referenceLevelType,
            signalTime: candle.timestamp,
            entryTime: candle.timestamp,
            entryPrice,
            stopLoss,
            takeProfit,
            riskAmount,
            variantId,
          };

          // Simulate trade on subsequent candles
          let barsHeld = 0;
          for (let j = i + 1; j < candles.length; j++) {
            const futureCandle = candles[j];
            barsHeld++;

            if (direction === "BUY") {
              const hitSL = futureCandle.low <= stopLoss;
              const hitTP = futureCandle.high >= takeProfit;

              if (hitSL && hitTP) {
                trade.exitTime = futureCandle.timestamp;
                trade.exitPrice = stopLoss;
                trade.exitReason = "SL";
                trade.pnlDollar = -riskAmount;
                trade.realizedR = -1.0;
                trade.barsHeld = barsHeld;
                break;
              } else if (hitSL) {
                trade.exitTime = futureCandle.timestamp;
                trade.exitPrice = stopLoss;
                trade.exitReason = "SL";
                trade.pnlDollar = -riskAmount;
                trade.realizedR = -1.0;
                trade.barsHeld = barsHeld;
                break;
              } else if (hitTP) {
                trade.exitTime = futureCandle.timestamp;
                trade.exitPrice = takeProfit;
                trade.exitReason = "TP";
                trade.pnlDollar = riskAmount * RISK_REWARD_RATIO;
                trade.realizedR = RISK_REWARD_RATIO;
                trade.barsHeld = barsHeld;
                break;
              }
            } else { // SELL
              const hitSL = futureCandle.high >= stopLoss;
              const hitTP = futureCandle.low <= takeProfit;

              if (hitSL && hitTP) {
                trade.exitTime = futureCandle.timestamp;
                trade.exitPrice = stopLoss;
                trade.exitReason = "SL";
                trade.pnlDollar = -riskAmount;
                trade.realizedR = -1.0;
                trade.barsHeld = barsHeld;
                break;
              } else if (hitSL) {
                trade.exitTime = futureCandle.timestamp;
                trade.exitPrice = stopLoss;
                trade.exitReason = "SL";
                trade.pnlDollar = -riskAmount;
                trade.realizedR = -1.0;
                trade.barsHeld = barsHeld;
                break;
              } else if (hitTP) {
                trade.exitTime = futureCandle.timestamp;
                trade.exitPrice = takeProfit;
                trade.exitReason = "TP";
                trade.pnlDollar = riskAmount * RISK_REWARD_RATIO;
                trade.realizedR = RISK_REWARD_RATIO;
                trade.barsHeld = barsHeld;
                break;
              }
            }
          }

          if (!trade.exitReason) {
            const lastCandle = candles[candles.length - 1];
            const curPrice = lastCandle.close;
            const openPnl = direction === "BUY" ? (curPrice - entryPrice) : (entryPrice - curPrice);
            trade.exitReason = "OPEN";
            trade.pnlDollar = openPnl;
            trade.realizedR = openPnl / riskAmount;
            trade.barsHeld = barsHeld;
          }

          trades.push(trade);
        }

        engine.processCandle(candle);
        prevCandle = candle;
      }

      return trades;
    }

    function computeSummary(variantId: string, name: string, trades: SimulatedTrade[], controlASummary?: SummaryResult): SummaryResult {
      const closedTrades = trades.filter((t) => t.exitReason === "TP" || t.exitReason === "SL");
      const winningTrades = closedTrades.filter((t) => t.exitReason === "TP");
      const losingTrades = closedTrades.filter((t) => t.exitReason === "SL");

      const longCount = trades.filter((t) => t.direction === "BUY").length;
      const shortCount = trades.filter((t) => t.direction === "SELL").length;
      const winRatePct = closedTrades.length > 0 ? (winningTrades.length / closedTrades.length) * 100 : 0;

      let grossProfit = 0;
      let grossLoss = 0;
      closedTrades.forEach((t) => {
        if ((t.pnlDollar || 0) > 0) grossProfit += t.pnlDollar || 0;
        else grossLoss += Math.abs(t.pnlDollar || 0);
      });

      const netPnl = grossProfit - grossLoss;
      const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
      const totalR = closedTrades.reduce((acc, t) => acc + (t.realizedR || 0), 0);
      const averageR = closedTrades.length > 0 ? totalR / closedTrades.length : 0;
      const expectancy = closedTrades.length > 0 ? netPnl / closedTrades.length : 0;

      let currentEquity = 10000;
      let peakEquity = 10000;
      let maxDrawdownDollar = 0;
      let maxDrawdownPct = 0;
      let maxConsecutiveLosses = 0;
      let curLosses = 0;

      closedTrades.forEach((t) => {
        currentEquity += t.pnlDollar || 0;
        if (currentEquity > peakEquity) peakEquity = currentEquity;
        const ddDollar = peakEquity - currentEquity;
        const ddPct = (ddDollar / peakEquity) * 100;
        if (ddDollar > maxDrawdownDollar) maxDrawdownDollar = ddDollar;
        if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;

        if (t.exitReason === "SL") {
          curLosses++;
          if (curLosses > maxConsecutiveLosses) maxConsecutiveLosses = curLosses;
        } else {
          curLosses = 0;
        }
      });

      const pnlDiff = controlASummary ? netPnl - controlASummary.netPnl : 0;
      const expectancyDiff = controlASummary ? expectancy - controlASummary.expectancy : 0;
      const ddDiff = controlASummary ? controlASummary.maxDrawdownDollar - maxDrawdownDollar : 0;

      return {
        variantId,
        name,
        totalSignals: trades.length,
        totalTrades: trades.length,
        longCount,
        shortCount,
        wins: winningTrades.length,
        losses: losingTrades.length,
        winRatePct,
        grossProfit,
        grossLoss,
        netPnl,
        profitFactor,
        averageR,
        expectancy,
        maxDrawdownDollar,
        maxDrawdownPct,
        maxConsecutiveLosses,
        pnlDiffVsControlA: pnlDiff,
        expectancyDiffVsControlA: expectancyDiff,
        drawdownDiffVsControlA: ddDiff,
      };
    }

    const tradesControlA = runCanonicalSimulation("ControlA");
    const tradesVariantB = runCanonicalSimulation("VariantB");

    const canonicalControlA = computeSummary("ControlA", "Canonical Baseline (Control A)", tradesControlA);
    const canonicalVariantB = computeSummary("VariantB", "Canonical Variant B (SWL Bearish Filter)", tradesVariantB, canonicalControlA);

    console.log("\n========================================================================================");
    console.log("          CANONICAL RECONCILED BACKTEST & VARIANT B VALIDATION REPORT                   ");
    console.log("========================================================================================");
    console.log(`Candle Dataset Period : ${candles[0].timestamp} to ${candles[candles.length - 1].timestamp}`);
    console.log(`Total 15M Candles     : ${candles.length}`);
    console.log(`Production Engine     : PineLiquidityEngine + PineSignalEngine (Multi-Timeframe + Sessions)`);
    console.log("----------------------------------------------------------------------------------------");
    console.table([canonicalControlA, canonicalVariantB].map((s) => ({
      Variant: `${s.variantId}: ${s.name}`,
      Signals: s.totalSignals,
      "L/S": `${s.longCount}/${s.shortCount}`,
      "WinRate%": `${s.winRatePct.toFixed(2)}%`,
      "NetPnL($)": `$${s.netPnl.toFixed(2)}`,
      ProfitFactor: s.profitFactor === Infinity ? "Inf" : s.profitFactor.toFixed(2),
      Expectancy: `$${s.expectancy.toFixed(2)}`,
      AvgR: `${s.averageR.toFixed(2)}R`,
      MaxDD: `$${s.maxDrawdownDollar.toFixed(2)} (${s.maxDrawdownPct.toFixed(2)}%)`,
      MaxConsecLoss: s.maxConsecutiveLosses,
      "PnLDiff vs A": `$${s.pnlDiffVsControlA >= 0 ? "+" : ""}${s.pnlDiffVsControlA.toFixed(2)}`,
      "ExpDiff vs A": `$${s.expectancyDiffVsControlA >= 0 ? "+" : ""}${s.expectancyDiffVsControlA.toFixed(2)}`,
    })));
    console.log("========================================================================================\n");

    expect(canonicalControlA.totalSignals).toBe(73);
    expect(canonicalVariantB.totalSignals).toBe(67);
  });
});
