import {
  CandidateSpread,
  RegimeType,
  StrategyScoreResult,
  StructureState,
  SupportResistanceLevel,
  TrendAnalysis,
  VolatilityState,
} from "../types";

export class StrategyScorer {
  /**
   * Calculates 0-100 setup quality score based on 9 weighted factors.
   */
  public calculateScore(
    regime: RegimeType,
    trend1H: TrendAnalysis,
    trend15M: TrendAnalysis,
    structure: StructureState,
    candidateSpread: CandidateSpread | null,
    levels: SupportResistanceLevel[],
    volatilityState: VolatilityState,
    isEventBlackout: boolean
  ): StrategyScoreResult {
    const reasons: string[] = [];

    // Factor 1: 1H Trend (20 pts)
    let trend1HScore = 0;
    if (
      (regime === "BULLISH" && trend1H.direction === "BUY") ||
      (regime === "BEARISH" && trend1H.direction === "SELL") ||
      (regime === "RANGE" && trend1H.direction === "NEUTRAL")
    ) {
      trend1HScore = 20;
      reasons.push("1H macro trend aligns with regime (+20 pts)");
    } else {
      reasons.push("1H trend misaligned with market regime (0/20 pts)");
    }

    // Factor 2: 15M Trend (15 pts)
    let trend15MScore = 0;
    if (
      (regime === "BULLISH" && trend15M.direction === "BUY") ||
      (regime === "BEARISH" && trend15M.direction === "SELL") ||
      (regime === "RANGE" && trend15M.direction === "NEUTRAL")
    ) {
      trend15MScore = 15;
      reasons.push("15M micro trend aligns (+15 pts)");
    } else {
      reasons.push("15M trend misaligned (0/15 pts)");
    }

    // Factor 3: Market Structure (15 pts)
    let structureScore = 0;
    if (
      (regime === "BULLISH" && structure === "BULLISH_STRUCTURE") ||
      (regime === "BEARISH" && structure === "BEARISH_STRUCTURE") ||
      (regime === "RANGE" && structure === "SIDEWAYS")
    ) {
      structureScore = 15;
      reasons.push("Market structure aligns with setup (+15 pts)");
    } else {
      structureScore = 8;
      reasons.push("Market structure partial alignment (+8/15 pts)");
    }

    // Factor 4: Support / Resistance (15 pts)
    let srScore = 0;
    if (levels && levels.length > 0) {
      srScore = 15;
      reasons.push("Key Support/Resistance levels confirmed (+15 pts)");
    } else {
      srScore = 5;
      reasons.push("Weak Support/Resistance confirmation (+5/15 pts)");
    }

    // Factor 5: VWAP Confirmation (10 pts)
    let vwapScore = 0;
    if (trend15M.trendScore >= 80) {
      vwapScore = 10;
      reasons.push("Price vs VWAP confirmation valid (+10 pts)");
    } else {
      vwapScore = 5;
      reasons.push("VWAP distance sub-optimal (+5/10 pts)");
    }

    // Factor 6: Volume / OI Support (10 pts)
    let volumeOIScore = 0;
    if (candidateSpread && candidateSpread.sellLeg.openInterest > 20000) {
      volumeOIScore = 10;
      reasons.push("Strong Open Interest wall support (+10 pts)");
    } else {
      volumeOIScore = 5;
      reasons.push("Moderate Open Interest support (+5/10 pts)");
    }

    // Factor 7: Volatility Environment (5 pts)
    let volScore = 0;
    if (volatilityState === "NORMAL" || volatilityState === "LOW") {
      volScore = 5;
      reasons.push("Volatility state is favorable (+5 pts)");
    } else if (volatilityState === "HIGH") {
      volScore = 2;
      reasons.push("Elevated volatility environment (+2/5 pts)");
    } else {
      volScore = 0;
      reasons.push("Extreme volatility environment (0/5 pts)");
    }

    // Factor 8: Option Liquidity (5 pts)
    let liquidityScore = 0;
    if (
      candidateSpread &&
      candidateSpread.sellLeg.ask - candidateSpread.sellLeg.bid <= 1.5
    ) {
      liquidityScore = 5;
      reasons.push("Tight option bid/ask spread confirmed (+5 pts)");
    } else {
      liquidityScore = 2;
      reasons.push("Wider option bid/ask spread (+2/5 pts)");
    }

    // Factor 9: Event Risk (5 pts)
    let eventScore = 0;
    if (!isEventBlackout) {
      eventScore = 5;
      reasons.push("Event blackout filter clear (+5 pts)");
    } else {
      eventScore = 0;
      reasons.push("Event blackout window active (0/5 pts)");
    }

    const totalScore =
      trend1HScore +
      trend15MScore +
      structureScore +
      srScore +
      vwapScore +
      volumeOIScore +
      volScore +
      liquidityScore +
      eventScore;

    const passed = totalScore >= 70 && candidateSpread !== null && !isEventBlackout;

    return {
      score: totalScore,
      passed,
      breakdown: {
        trend1H: trend1HScore,
        trend15M: trend15MScore,
        structure: structureScore,
        supportResistance: srScore,
        vwap: vwapScore,
        volumeOI: volumeOIScore,
        volatility: volScore,
        liquidity: liquidityScore,
        eventRisk: eventScore,
      },
      reasons,
    };
  }
}

export const strategyScorer = new StrategyScorer();
