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
  variantId: "A" | "B" | "C" | "D";
}

interface VariantSummary {
  variantId: string;
  name: string;
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

/**
 * Calculates simple moving average on array of prices up to current index (strictly past bars).
 */
function calculateSMA(prices: number[], period: number, currentIndex: number): number {
  if (currentIndex < period - 1) return prices[currentIndex];
  let sum = 0;
  for (let k = currentIndex - period + 1; k <= currentIndex; k++) {
    sum += prices[k];
  }
  return sum / period;
}

describe("Controlled Optimization Experiment: XAU/USD Strategy Variants", () => {
  it("Runs Control A, Variant B, Variant C, Variant D & Robustness Validation", async () => {
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

    const closePrices = candles.map((c) => c.close);

    // ── 2. Strategy Variant Execution Helper ──────────────────────────────────
    function runVariantSimulation(variantId: "A" | "B" | "C" | "D", candleSubset: Candle[]): SimulatedTrade[] {
      const engine = new PineLiquidityEngine({}, 15);
      const signalEngine = new PineSignalEngine();
      const bridge = new PineAlertBridge();
      bridge.registerEngine("XAU/USD", engine);

      const trades: SimulatedTrade[] = [];
      let prevCandle: Candle | null = null;

      // Calculate SMAs for subset relative to full candle index or local index
      for (let i = 0; i < candleSubset.length; i++) {
        const candle = candleSubset[i];

        // Evaluate candle wick
        bridge.evaluateCandleWick("XAU/USD", candle, candle.timestamp);

        // Evaluate PineSignalEngine
        const rawSignals = signalEngine.evaluateCandle("XAU/USD", candle, prevCandle, engine);

        // Compute HTF trend filter from past bars (e.g. 50-period 15M SMA as proxy for 1H trend)
        const localClosePrices = candleSubset.slice(0, i + 1).map((c) => c.close);
        const sma50 = calculateSMA(localClosePrices, Math.min(50, localClosePrices.length), localClosePrices.length - 1);
        const isBullishTrend = candle.close >= sma50;
        const isBearishTrend = candle.close < sma50;

        for (const sig of rawSignals) {
          // ── FILTER LOGIC PER VARIANT ────────────────────────────────────────
          let allowSignal = true;

          if (variantId === "B") {
            // VARIANT B: Block counter-trend SWL entries when HTF structure is bearish
            if (sig.referenceLevelType === "SWL" && isBearishTrend && sig.direction === "BUY") {
              allowSignal = false;
            }
          } else if (variantId === "C") {
            // VARIANT C: Allow SWL entries ONLY when HTF structure is bullish
            if (sig.referenceLevelType === "SWL" && !isBullishTrend) {
              allowSignal = false;
            }
          } else if (variantId === "D") {
            // VARIANT D: LIQUIDITY QUALITY — Filter out weak counter-trend swings, keep Session/PDH/PDL/PWL/PWH & trend-aligned swings
            if (sig.referenceLevelType === "SWL" && isBearishTrend) {
              allowSignal = false;
            }
            if (sig.referenceLevelType === "SWH" && isBullishTrend) {
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

          // Simulate future candles
          let barsHeld = 0;
          for (let j = i + 1; j < candleSubset.length; j++) {
            const futureCandle = candleSubset[j];
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
            } else {
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
            const lastCandle = candleSubset[candleSubset.length - 1];
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

    // Compute metrics for trade array
    function computeSummary(variantId: string, name: string, trades: SimulatedTrade[], controlASummary?: VariantSummary): VariantSummary {
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

    // ── 3. Execute Full Dataset Experiments ───────────────────────────────────
    const tradesA = runVariantSimulation("A", candles);
    const tradesB = runVariantSimulation("B", candles);
    const tradesC = runVariantSimulation("C", candles);
    const tradesD = runVariantSimulation("D", candles);

    const summaryA = computeSummary("A", "Control A (Current Production)", tradesA);
    const summaryB = computeSummary("B", "Variant B (SWL Bearish Filter)", tradesB, summaryA);
    const summaryC = computeSummary("C", "Variant C (Trend-Aligned SWL)", tradesC, summaryA);
    const summaryD = computeSummary("D", "Variant D (Liquidity Quality Filter)", tradesD, summaryA);

    // ── 4. Execute Robustness Check (2 Chronological Halves) ──────────────────
    const halfIndex = Math.floor(candles.length / 2);
    const candlesHalf1 = candles.slice(0, halfIndex);
    const candlesHalf2 = candles.slice(halfIndex);

    const h1TradesA = runVariantSimulation("A", candlesHalf1);
    const h1TradesB = runVariantSimulation("B", candlesHalf1);
    const h1TradesD = runVariantSimulation("D", candlesHalf1);

    const h2TradesA = runVariantSimulation("A", candlesHalf2);
    const h2TradesB = runVariantSimulation("B", candlesHalf2);
    const h2TradesD = runVariantSimulation("D", candlesHalf2);

    const h1SummaryA = computeSummary("A", "Control A (Half 1)", h1TradesA);
    const h1SummaryB = computeSummary("B", "Variant B (Half 1)", h1TradesB, h1SummaryA);
    const h1SummaryD = computeSummary("D", "Variant D (Half 1)", h1TradesD, h1SummaryA);

    const h2SummaryA = computeSummary("A", "Control A (Half 2)", h2TradesA);
    const h2SummaryB = computeSummary("B", "Variant B (Half 2)", h2TradesB, h2SummaryA);
    const h2SummaryD = computeSummary("D", "Variant D (Half 2)", h2TradesD, h2SummaryA);

    // ── 5. Output Controlled Experiment Results ────────────────────────────────
    console.log("\n========================================================================================");
    console.log("             XAU/USD CONTROLLED OPTIMIZATION EXPERIMENT RESULTS                         ");
    console.log("========================================================================================");
    console.log(`Dataset Candles : ${candles.length} (Period: ${candles[0].timestamp} to ${candles[candles.length - 1].timestamp})`);
    console.log(`Friction Model  : $${SPREAD_SLIPPAGE.toFixed(2)}/oz spread/slippage | SL: $${DEFAULT_SL_DIST.toFixed(2)} | Target R:R: 1:${RISK_REWARD_RATIO.toFixed(1)}`);
    console.log("----------------------------------------------------------------------------------------");
    console.table([summaryA, summaryB, summaryC, summaryD].map((s) => ({
      Variant: `${s.variantId}: ${s.name}`,
      Trades: s.totalTrades,
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

    console.log("----------------------------------------------------------------------------------------");
    console.log("ROBUSTNESS CHECK: CHRONOLOGICAL SPLIT (HALF 1 vs HALF 2)");
    console.log("----------------------------------------------------------------------------------------");
    console.log("HALF 1 (Period: " + candlesHalf1[0].timestamp + " to " + candlesHalf1[candlesHalf1.length - 1].timestamp + "):");
    console.table([h1SummaryA, h1SummaryB, h1SummaryD].map((s) => ({
      Variant: `${s.variantId}: ${s.name}`,
      Trades: s.totalTrades,
      "WinRate%": `${s.winRatePct.toFixed(2)}%`,
      "NetPnL($)": `$${s.netPnl.toFixed(2)}`,
      ProfitFactor: s.profitFactor === Infinity ? "Inf" : s.profitFactor.toFixed(2),
      Expectancy: `$${s.expectancy.toFixed(2)}`,
      MaxDD: `$${s.maxDrawdownDollar.toFixed(2)}`,
    })));

    console.log("\nHALF 2 (Period: " + candlesHalf2[0].timestamp + " to " + candlesHalf2[candlesHalf2.length - 1].timestamp + "):");
    console.table([h2SummaryA, h2SummaryB, h2SummaryD].map((s) => ({
      Variant: `${s.variantId}: ${s.name}`,
      Trades: s.totalTrades,
      "WinRate%": `${s.winRatePct.toFixed(2)}%`,
      "NetPnL($)": `$${s.netPnl.toFixed(2)}`,
      ProfitFactor: s.profitFactor === Infinity ? "Inf" : s.profitFactor.toFixed(2),
      Expectancy: `$${s.expectancy.toFixed(2)}`,
      MaxDD: `$${s.maxDrawdownDollar.toFixed(2)}`,
    })));

    console.log("========================================================================================\n");
    console.log("JSON_RESULTS:" + JSON.stringify({ summaryA, summaryB, summaryC, summaryD, h1SummaryA, h1SummaryB, h1SummaryD, h2SummaryA, h2SummaryB, h2SummaryD }));
  });
});
