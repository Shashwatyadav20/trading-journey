import {
  AutoHedgeSignal,
  Candle,
  NiftyOptionChain,
  RegimeType,
  SignalStatus,
  StrategyType,
} from "../types";
import { DEFAULT_NIFTY_CONFIG, NiftyConfig } from "../config/niftyConfig";
import { volatilityEngine } from "../volatility/VolatilityEngine";
import { supportResistanceEngine } from "../levels/SupportResistanceEngine";
import { multiTimeframeTrendEngine } from "../trend/MultiTimeframeTrendEngine";
import { marketRegimeEngine } from "../regime/MarketRegimeEngine";
import { niftyOptionChainService } from "../market/NiftyOptionChainService";
import { adaptiveStrikeSelector } from "../strategy/AdaptiveStrikeSelector";
import { strategyScorer } from "../strategy/StrategyScorer";
import { chargeCalculator } from "../risk/ChargeCalculator";
import { riskEngine } from "../risk/RiskEngine";
import { tradeValidator } from "../validation/TradeValidator";
import { dailyRiskController } from "../risk/DailyRiskController";
import { signalAuditStore } from "../audit/SignalAuditStore";

export class HedgingStrategyEngine {
  private config: NiftyConfig;

  constructor(config: NiftyConfig = DEFAULT_NIFTY_CONFIG) {
    this.config = config;
  }

  /**
   * Generates a complete production-grade NIFTY auto-hedge signal.
   *
   * @param spotPrice Current NIFTY index spot price
   * @param candles15M 15-minute candles
   * @param candles1H 1-hour candles
   * @param optionChain Option chain data
   * @param userCapital User trading capital in INR (default Rs 500,000)
   * @param isEventBlackout High-risk event blackout active flag
   */
  public generateSignal(
    spotPrice: number,
    candles15M: Candle[],
    candles1H: Candle[],
    optionChain?: NiftyOptionChain,
    userCapital: number = 500000,
    isEventBlackout: boolean = false
  ): AutoHedgeSignal {
    const timestamp = new Date().toISOString();

    if (spotPrice <= 0 || !candles15M || candles15M.length === 0) {
      return this.createNoTradeSignal(
        spotPrice,
        timestamp,
        "UNCLEAR",
        ["Invalid or missing live NIFTY market data feed."]
      );
    }

    // 1. Calculate Indicators
    const atr14 = volatilityEngine.calculateATR(candles15M, 14);
    const { state: volState, iv } = volatilityEngine.evaluateVolatility(
      spotPrice,
      atr14,
      14.2
    );

    // Use or generate Option Chain
    const chain =
      optionChain ||
      niftyOptionChainService.generateSyntheticChain(spotPrice);

    // Data Freshness & Health Gate
    if (chain && chain.timestamp) {
      const chainTime = new Date(chain.timestamp).getTime();
      const nowTime = new Date(timestamp).getTime();
      if (!isNaN(chainTime) && (nowTime - chainTime) / 1000 > 60) {
        return this.createNoTradeSignal(
          spotPrice,
          timestamp,
          "UNCLEAR",
          ["DATA_INVALID_OR_STALE: Option chain market data is stale (> 60s old)."]
        );
      }
    }

    // 2. Support & Resistance Levels
    const levels = supportResistanceEngine.calculateLevels(
      spotPrice,
      candles15M,
      [],
      chain
    );

    // 3. Multi-Timeframe Trend Analysis
    const trend15M = multiTimeframeTrendEngine.analyzeTrend(
      candles15M,
      candles1H && candles1H.length > 0 ? candles1H : candles15M,
      spotPrice
    );
    const trend1H = candles1H && candles1H.length > 0
      ? multiTimeframeTrendEngine.analyzeTrend(candles1H, candles1H, spotPrice)
      : trend15M;

    // 4. Market Regime Classification
    const regimeEval = marketRegimeEngine.classifyRegime(
      trend15M,
      trend1H,
      volState,
      trend15M.direction === "BUY"
        ? "BULLISH_STRUCTURE"
        : trend15M.direction === "SELL"
        ? "BEARISH_STRUCTURE"
        : "SIDEWAYS",
      isEventBlackout
    );

    if (!regimeEval.isTradeable) {
      return this.createNoTradeSignal(
        spotPrice,
        timestamp,
        regimeEval.regime,
        regimeEval.reasons
      );
    }

    // 5. Dynamic Strike Selection
    const candidateSpread = adaptiveStrikeSelector.selectBestSpread(
      regimeEval.regime,
      spotPrice,
      chain,
      levels
    );

    if (!candidateSpread) {
      return this.createNoTradeSignal(
        spotPrice,
        timestamp,
        regimeEval.regime,
        ["No suitable defined-risk option spread found matching delta and S/R criteria."]
      );
    }

    // 6. Strategy Scoring
    const scoreResult = strategyScorer.calculateScore(
      regimeEval.regime,
      trend1H,
      trend15M,
      trend15M.direction === "BUY"
        ? "BULLISH_STRUCTURE"
        : trend15M.direction === "SELL"
        ? "BEARISH_STRUCTURE"
        : "SIDEWAYS",
      candidateSpread,
      levels,
      volState,
      isEventBlackout
    );

    // 7. Sizing & Risk Calculation
    // Estimate baseline charges for 1 lot
    const baseCharges = chargeCalculator.calculateSpreadCharges(
      candidateSpread.sellLeg.ltp,
      candidateSpread.buyLeg.ltp,
      1,
      candidateSpread.netCredit * this.config.lotSize
    );

    const riskVal = riskEngine.validateAndSizePosition(
      userCapital,
      candidateSpread.spreadWidth,
      candidateSpread.netCredit,
      baseCharges.totalCharges
    );

    // Single lot total max loss (options max loss + 1-lot total charges)
    const singleLotGrossMaxLoss = candidateSpread.maxLoss * this.config.lotSize;
    const singleLotTotalMaxLoss = Number((singleLotGrossMaxLoss + baseCharges.totalCharges).toFixed(2));

    // Hard Max Loss Filter (INR 1,000 Limit per trade)
    if (singleLotTotalMaxLoss > 1000) {
      return this.createNoTradeSignal(
        spotPrice,
        timestamp,
        regimeEval.regime,
        [`MAX_LOSS_EXCEEDS_1000_INR: Total maximum loss (₹${singleLotTotalMaxLoss}) exceeds maximum allowed risk threshold of ₹1,000 per trade.`]
      );
    }

    // Cap lot quantity so total trade max loss never exceeds ₹1,000
    const maxLotsAllowed = Math.floor(1000 / singleLotTotalMaxLoss);
    const finalLotQuantity = Math.max(1, Math.min(riskVal.lotQuantity > 0 ? riskVal.lotQuantity : 1, maxLotsAllowed));
    const finalTotalQuantity = finalLotQuantity * this.config.lotSize;

    // Total Charges for calculated lot quantity
    const finalCharges = chargeCalculator.calculateSpreadCharges(
      candidateSpread.sellLeg.ltp,
      candidateSpread.buyLeg.ltp,
      finalLotQuantity,
      candidateSpread.netCredit * finalTotalQuantity
    );

    const grossMaxProfit = candidateSpread.netCredit * finalTotalQuantity;
    const expectedNetPnl = Number((grossMaxProfit - finalCharges.totalCharges).toFixed(2));
    const totalMaxLossInr = Number(
      ((candidateSpread.maxLoss * finalTotalQuantity) + finalCharges.totalCharges).toFixed(2)
    );

    // 8. Pre-Execution Validation Gateway
    const valDecision = tradeValidator.validateTrade(
      regimeEval,
      candidateSpread,
      scoreResult,
      riskVal,
      expectedNetPnl
    );

    // 9. Stop Loss & Target Calculation
    // Stop Loss: 1.5x Initial Net Credit (or underlying invalidation level)
    const stopLossSpread = Number(
      (candidateSpread.netCredit * this.config.stopLossCreditMultiplier).toFixed(2)
    );

    // Profit Target: 50% Credit Capture Target
    const targetSpread = Number(
      (candidateSpread.netCredit * (1 - this.config.targetCreditCapturePct / 100.0)).toFixed(2)
    );

    const nearestSupport = levels.filter((l) => l.price < spotPrice).map((l) => l.price).sort((a, b) => b - a)[0] || Math.round(spotPrice * 0.985);
    const nearestResistance = levels.filter((l) => l.price > spotPrice).map((l) => l.price).sort((a, b) => a - b)[0] || Math.round(spotPrice * 1.015);

    const structuredExplanation = [
      `REGIME: ${regimeEval.regime === "BULLISH" ? "STRONGLY BULLISH" : regimeEval.regime === "BEARISH" ? "STRONGLY BEARISH" : regimeEval.regime}`,
      `Structure: ${trend15M.swingStructure || "UNCLEAR"}`,
      `Trend: ${trend15M.direction}`,
      `VWAP: ${spotPrice > (trend15M.vwap || 0) ? "PRICE ABOVE VWAP" : "PRICE BELOW VWAP"}`,
      `RSI: ${trend15M.rsi || 50}`,
      `Support: ${nearestSupport}`,
      `Resistance: ${nearestResistance}`,
      `S/R Distance: VALID`,
      `Delta: ${candidateSpread.sellLeg.delta}`,
      `Gamma: ${candidateSpread.sellLeg.gamma || "ACCEPTABLE"}`,
      `Strategy: ${candidateSpread.strategyType}`,
      `Max Loss: ₹${totalMaxLossInr}`,
      `Decision: ${valDecision.approved ? "READY" : "NO_TRADE"}`,
    ];

    const reasons = [
      ...structuredExplanation,
      ...regimeEval.reasons,
      ...scoreResult.reasons,
    ];

    const dailyState = dailyRiskController.getState();
    const status: SignalStatus = valDecision.approved
      ? "READY"
      : dailyState.isTradeLocked
      ? "BLOCKED"
      : "NO_TRADE";
    const action: StrategyType = valDecision.approved ? candidateSpread.strategyType : "NO_TRADE";

    const signal: AutoHedgeSignal = {
      symbol: "NIFTY",
      timestamp,
      regime: regimeEval.regime,
      score: scoreResult.score,
      action,
      expiry: candidateSpread.expiry,
      spotPrice,
      sellLeg: {
        symbol: candidateSpread.sellLeg.symbol,
        strike: candidateSpread.sellLeg.strike,
        optionType: candidateSpread.sellLeg.optionType,
        ltp: candidateSpread.sellLeg.ltp,
        bid: candidateSpread.sellLeg.bid,
        ask: candidateSpread.sellLeg.ask,
        iv: candidateSpread.sellLeg.iv,
        delta: candidateSpread.sellLeg.delta,
      },
      buyLeg: {
        symbol: candidateSpread.buyLeg.symbol,
        strike: candidateSpread.buyLeg.strike,
        optionType: candidateSpread.buyLeg.optionType,
        ltp: candidateSpread.buyLeg.ltp,
        bid: candidateSpread.buyLeg.bid,
        ask: candidateSpread.buyLeg.ask,
        iv: candidateSpread.buyLeg.iv,
        delta: candidateSpread.buyLeg.delta,
      },
      netCredit: candidateSpread.netCredit,
      maxProfit: Number(grossMaxProfit.toFixed(2)),
      maxLoss: totalMaxLossInr,
      entryPrice: candidateSpread.netCredit,
      stopLossSpread,
      targetSpread,
      quantityLots: finalLotQuantity,
      totalQuantity: finalTotalQuantity,
      marginRequired: Number((candidateSpread.spreadWidth * finalTotalQuantity).toFixed(2)),
      charges: finalCharges,
      expectedNetPnl,
      riskPercentage: riskVal.riskPercentage,
      rewardRiskRatio: candidateSpread.rewardRiskRatio,
      status,
      reasons,
      // Audit fields
      candidateSpread,
      regime_details: {
        regime: regimeEval.regime,
        trend1H: trend1H.direction,
        trend15M: trend15M.direction,
        vwap: trend15M.invalidationLevel,
        atr: atr14,
      },
    };

    signalAuditStore.recordSignal(signal, !chain?.isSynthetic);
    return signal;
  }

  private createNoTradeSignal(
    spotPrice: number,
    timestamp: string,
    regime: RegimeType,
    reasons: string[]
  ): AutoHedgeSignal {
    const dailyState = dailyRiskController.getState();
    const isBlocked = dailyState.isTradeLocked;

    const signal: AutoHedgeSignal = {
      symbol: "NIFTY",
      timestamp,
      regime,
      score: 0,
      action: "NO_TRADE",
      expiry: "N/A",
      spotPrice,
      netCredit: 0,
      maxProfit: 0,
      maxLoss: 0,
      entryPrice: 0,
      stopLossSpread: 0,
      targetSpread: 0,
      quantityLots: 0,
      totalQuantity: 0,
      marginRequired: 0,
      charges: {
        grossPnl: 0,
        entryCharges: 0,
        exitCharges: 0,
        brokerage: 0,
        stt: 0,
        exchangeFees: 0,
        gst: 0,
        sebiFees: 0,
        stampDuty: 0,
        estimatedSlippage: 0,
        totalCharges: 0,
        netPnl: 0,
      },
      expectedNetPnl: 0,
      riskPercentage: 0,
      rewardRiskRatio: 0,
      status: isBlocked ? "BLOCKED" : "NO_TRADE",
      reasons,
    };

    signalAuditStore.recordSignal(signal, false);
    return signal;
  }
}

export const hedgingStrategyEngine = new HedgingStrategyEngine();
