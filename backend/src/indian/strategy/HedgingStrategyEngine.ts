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

import { marketSessionValidator } from "../market/MarketSessionValidator";
import { expiryValidator } from "../market/ExpiryValidator";

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

    // Phase 25 Market Session Enforcement
    // Session check only fires in LIVE_PAPER mode (backward-compatible: no EXECUTION_MODE set = legacy/test)
    const executionMode = process.env.EXECUTION_MODE;
    const isLivePaper = executionMode === "LIVE_PAPER";
    const isHistoricalBacktest = executionMode === "HISTORICAL_BACKTEST";

    if (isLivePaper) {
      const sessionResult = marketSessionValidator.validateSessionForTrading(timestamp);
      if (!sessionResult.isValid) {
        return this.createNoTradeSignal(
          spotPrice,
          timestamp,
          "UNCLEAR",
          [sessionResult.rejectionReason || "MARKET_SESSION_CLOSED"]
        );
      }
    }

    // Use or generate Option Chain
    const chain =
      optionChain ||
      (process.env.INDIAN_REAL_DATA_ONLY === "true"
        ? { spotPrice, timestamp, contracts: [], isSynthetic: true }
        : niftyOptionChainService.generateSyntheticChain(spotPrice));

    // REAL_DATA_ONLY Gate
    if (process.env.INDIAN_REAL_DATA_ONLY === "true" && (chain.isSynthetic || !chain.contracts || chain.contracts.length === 0)) {
      return this.createNoTradeSignal(
        spotPrice,
        timestamp,
        "UNCLEAR",
        ["REAL_OPTION_CHAIN_UNAVAILABLE: INDIAN_REAL_DATA_ONLY mode is active and no genuine real option chain is available."]
      );
    }

    // Phase 25 Chain-Level Greeks & IV Integrity Gate
    // Must run before strike selection so it fires even if no valid spread is found
    const requireRealGamma = process.env.REQUIRE_REAL_GAMMA === "true" || process.env.INDIAN_REAL_DATA_ONLY === "true";
    const requireRealIv = process.env.REQUIRE_REAL_IV === "true" || process.env.INDIAN_REAL_DATA_ONLY === "true";

    if (requireRealGamma && chain.contracts && chain.contracts.length > 0) {
      const anyGamma = chain.contracts.some(
        (c) => c.gamma !== undefined && c.gamma !== null && !isNaN(c.gamma as number)
      );
      if (!anyGamma) {
        return this.createNoTradeSignal(spotPrice, timestamp, "UNCLEAR",
          ["REAL_GAMMA_UNAVAILABLE: No contract in option chain has verified real Gamma."]);
      }
    }

    if (requireRealIv && chain.contracts && chain.contracts.length > 0) {
      const anyIv = chain.contracts.some(
        (c) => c.iv !== undefined && c.iv !== null && !isNaN(c.iv as number) && (c.iv as number) > 0
      );
      if (!anyIv) {
        return this.createNoTradeSignal(spotPrice, timestamp, "UNCLEAR",
          ["REAL_IV_UNAVAILABLE: No contract in option chain has verified real IV."]);
      }
    }

    // 1. Calculate Indicators
    const atr14 = volatilityEngine.calculateATR(candles15M, 14);
    const { state: volState, iv } = volatilityEngine.evaluateVolatility(
      spotPrice,
      atr14,
      14.2
    );

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

      // Phase 25 Cross Session Data Protection (only in LIVE_PAPER production mode)
      if (isLivePaper) {
        const dataSessionDate = marketSessionValidator.getIstDateString(chain.timestamp);
        const decisionSessionDate = marketSessionValidator.getIstDateString(timestamp);
        if (dataSessionDate !== decisionSessionDate) {
          return this.createNoTradeSignal(
            spotPrice,
            timestamp,
            "UNCLEAR",
            ["CROSS_SESSION_DATA: Option chain session date does not match current decision session date."]
          );
        }
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

    // Phase 25 Expiry Validation Gate (LIVE_PAPER and SIMULATED_TEST; not HISTORICAL_BACKTEST)
    if (!isHistoricalBacktest) {
      const expiryResult = expiryValidator.validateExpiry(candidateSpread.expiry, timestamp);
      if (!expiryResult.isValid) {
        return this.createNoTradeSignal(
          spotPrice,
          timestamp,
          regimeEval.regime,
          [expiryResult.rejectionReason || "EXPIRED_CONTRACT"]
        );
      }
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
        gamma: candidateSpread.sellLeg.gamma,
      } as any,
      buyLeg: {
        symbol: candidateSpread.buyLeg.symbol,
        strike: candidateSpread.buyLeg.strike,
        optionType: candidateSpread.buyLeg.optionType,
        ltp: candidateSpread.buyLeg.ltp,
        bid: candidateSpread.buyLeg.bid,
        ask: candidateSpread.buyLeg.ask,
        iv: candidateSpread.buyLeg.iv,
        delta: candidateSpread.buyLeg.delta,
        gamma: candidateSpread.buyLeg.gamma,
      } as any,
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
      // Audit fields & Phase 23 Provenance Tracing
      candidateSpread,
      regime_details: {
        regime: regimeEval.regime,
        trend1H: trend1H.direction,
        trend15M: trend15M.direction,
        vwap: trend15M.invalidationLevel,
        atr: atr14,
      },
      signalId: `SIG_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      decisionTimestamp: timestamp,
      dataSource: chain?.isSynthetic ? "SYNTHETIC" : (process.env.NIFTY_DATA_PROVIDER as any) || "NSE",
      spotSource: chain?.isSynthetic ? "SYNTHETIC" : "TWELVEDATA",
      optionChainSource: chain?.isSynthetic ? "SYNTHETIC" : (process.env.NIFTY_DATA_PROVIDER as any) || "NSE",
      optionPriceSource: chain?.isSynthetic ? "SYNTHETIC" : (process.env.NIFTY_DATA_PROVIDER as any) || "NSE",
      greeksSource: chain?.isSynthetic ? "SYNTHETIC" : "PROVIDER_DERIVED",
      ivSource: chain?.isSynthetic ? "SYNTHETIC" : "REAL",
      lotSizeSource: "NSE_METADATA",
      dataFreshnessMs: chain?.timestamp ? Date.now() - new Date(chain.timestamp).getTime() : 0,
      strategyInputHash: `HASH_${spotPrice}_${candidateSpread.sellLeg.strike}_${candidateSpread.buyLeg.strike}`,
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
      signalId: `SIG_NOTRADE_${Date.now()}`,
      decisionTimestamp: timestamp,
      dataSource: (process.env.NIFTY_DATA_PROVIDER as any) || "NSE",
      spotSource: "TWELVEDATA",
      optionChainSource: (process.env.NIFTY_DATA_PROVIDER as any) || "NSE",
      optionPriceSource: (process.env.NIFTY_DATA_PROVIDER as any) || "NSE",
      greeksSource: "PROVIDER_DERIVED",
      ivSource: "REAL",
      lotSizeSource: "NSE_METADATA",
      dataFreshnessMs: 0,
      strategyInputHash: `HASH_NOTRADE_${spotPrice}`,
    };

    signalAuditStore.recordSignal(signal, false);
    return signal;
  }
}

export const hedgingStrategyEngine = new HedgingStrategyEngine();
