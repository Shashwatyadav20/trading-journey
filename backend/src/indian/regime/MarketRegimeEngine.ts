import {
  RegimeType,
  TrendAnalysis,
  VolatilityState,
  StructureState,
} from "../types";

export interface RegimeEvaluation {
  regime: RegimeType;
  confidenceScore: number;
  isTradeable: boolean;
  reasons: string[];
}

export interface RegimeEvaluation {
  regime: RegimeType;
  confidenceScore: number;
  isTradeable: boolean;
  reasons: string[];
}

export class MarketRegimeEngine {
  /**
   * Evaluates if market satisfies strongly bullish requirements:
   * HH + HL, 1H/15M BUY trend, Price > VWAP, RSI > 50, Volatility non-extreme.
   */
  public isStronglyBullish(
    trend15M: TrendAnalysis,
    trend1H: TrendAnalysis,
    volatilityState: VolatilityState,
    isEventBlackout: boolean = false
  ): boolean {
    if (isEventBlackout || volatilityState === "EXTREME") return false;

    const isStructureBullish = trend15M.swingStructure
      ? trend15M.swingStructure === "HH_HL"
      : trend15M.direction === "BUY";
    const isTrendBullish = trend15M.direction === "BUY" && trend1H.direction === "BUY";
    const isVwapBullish = trend15M.isVwapNeutral !== undefined ? !trend15M.isVwapNeutral : true;
    const isRsiBullish = trend15M.rsi !== undefined ? trend15M.rsi >= 48 : true;

    return isStructureBullish && isTrendBullish && isVwapBullish && isRsiBullish;
  }

  /**
   * Evaluates if market satisfies strongly bearish requirements:
   * LH + LL, 1H/15M SELL trend, Price < VWAP, RSI < 50, Volatility non-extreme.
   */
  public isStronglyBearish(
    trend15M: TrendAnalysis,
    trend1H: TrendAnalysis,
    volatilityState: VolatilityState,
    isEventBlackout: boolean = false
  ): boolean {
    if (isEventBlackout || volatilityState === "EXTREME") return false;

    const isStructureBearish = trend15M.swingStructure
      ? trend15M.swingStructure === "LH_LL"
      : trend15M.direction === "SELL";
    const isTrendBearish = trend15M.direction === "SELL" && trend1H.direction === "SELL";
    const isVwapBearish = trend15M.isVwapNeutral !== undefined ? !trend15M.isVwapNeutral : true;
    const isRsiBearish = trend15M.rsi !== undefined ? trend15M.rsi <= 52 : true;

    return isStructureBearish && isTrendBearish && isVwapBearish && isRsiBearish;
  }

  /**
   * Evaluates if market satisfies range-bound requirements:
   * No strong directional structure/trend, contained range, low/normal volatility.
   */
  public isStrongRange(
    trend15M: TrendAnalysis,
    trend1H: TrendAnalysis,
    volatilityState: VolatilityState,
    structureState: StructureState,
    isEventBlackout: boolean = false
  ): boolean {
    if (isEventBlackout || volatilityState === "EXTREME") return false;

    const isNeutralTrend = trend15M.direction === "NEUTRAL" && trend1H.direction === "NEUTRAL";
    const isSideways =
      structureState === "SIDEWAYS" ||
      (trend15M.swingStructure !== "HH_HL" && trend15M.swingStructure !== "LH_LL");
    const isVolSuitable = volatilityState === "LOW" || volatilityState === "NORMAL";

    return isNeutralTrend && isSideways && isVolSuitable;
  }

  /**
   * Classifies market regime deterministically based on multi-timeframe inputs in priority order.
   */
  public classifyRegime(
    trend15M: TrendAnalysis,
    trend1H: TrendAnalysis,
    volatilityState: VolatilityState,
    structureState: StructureState,
    isEventBlackout: boolean = false
  ): RegimeEvaluation {
    const reasons: string[] = [];

    // 1. Check Event Blackout
    if (isEventBlackout) {
      reasons.push("High-risk macro event blackout window is active.");
      return {
        regime: "EVENT_RISK",
        confidenceScore: 0,
        isTradeable: false,
        reasons,
      };
    }

    // 2. Check Volatility Extreme
    if (volatilityState === "EXTREME") {
      reasons.push("Market volatility is EXTREME (ATR > 2.2% or IV > 25%).");
      return {
        regime: "HIGH_VOLATILITY",
        confidenceScore: 0,
        isTradeable: false,
        reasons,
      };
    }

    // 3. Priority Order 1: STRONGLY BULLISH -> Bull Put
    if (this.isStronglyBullish(trend15M, trend1H, volatilityState, isEventBlackout)) {
      reasons.push("Master Flow 1: Market is STRONGLY BULLISH (HH+HL, Buy trend, Price > VWAP, RSI > 50).");
      reasons.push(...trend15M.reasons);
      return {
        regime: "BULLISH",
        confidenceScore: 90,
        isTradeable: true,
        reasons,
      };
    }

    // 4. Priority Order 2: STRONGLY BEARISH -> Bear Call
    if (this.isStronglyBearish(trend15M, trend1H, volatilityState, isEventBlackout)) {
      reasons.push("Master Flow 2: Market is STRONGLY BEARISH (LH+LL, Sell trend, Price < VWAP, RSI < 50).");
      reasons.push(...trend15M.reasons);
      return {
        regime: "BEARISH",
        confidenceScore: 90,
        isTradeable: true,
        reasons,
      };
    }

    // 5. Priority Order 3: STRONG RANGE -> Iron Condor
    if (this.isStrongRange(trend15M, trend1H, volatilityState, structureState, isEventBlackout)) {
      reasons.push("Master Flow 3: Market is in a clear RANGE (Neutral trend, Sideways structure, Suitable vol).");
      return {
        regime: "RANGE",
        confidenceScore: 80,
        isTradeable: true,
        reasons,
      };
    }

    // 6. Conflicting Signals -> UNCLEAR / NO_TRADE
    reasons.push("Master Flow 4: Market structure or trend signals are conflicting or invalid for entry.");
    if (trend15M.direction !== trend1H.direction) {
      reasons.push(
        `1H trend (${trend1H.direction}) disagrees with 15M trend (${trend15M.direction}).`
      );
    }
    reasons.push(...trend15M.reasons);
    return {
      regime: "UNCLEAR",
      confidenceScore: 30,
      isTradeable: false,
      reasons,
    };
  }
}

export const marketRegimeEngine = new MarketRegimeEngine();
