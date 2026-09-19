import {
  CandidateSpread,
  NiftyOptionChain,
  OptionContract,
  RegimeType,
  SupportResistanceLevel,
} from "../types";

export class AdaptiveStrikeSelector {
  /**
   * Evaluates option chain and technical levels to select optimal defined-risk spread candidates.
   */
  public selectBestSpread(
    regime: RegimeType,
    spotPrice: number,
    optionChain: NiftyOptionChain,
    levels: SupportResistanceLevel[]
  ): CandidateSpread | null {
    if (!optionChain || !optionChain.contracts || optionChain.contracts.length === 0) {
      return null;
    }

    if (regime === "BULLISH") {
      return this.selectBullPutSpread(spotPrice, optionChain, levels);
    } else if (regime === "BEARISH") {
      return this.selectBearCallSpread(spotPrice, optionChain, levels);
    } else if (regime === "RANGE") {
      return this.selectIronCondorSpread(spotPrice, optionChain, levels);
    }

    return null; // NO_TRADE for HIGH_VOLATILITY, EVENT_RISK, UNCLEAR
  }

  /**
   * Bull Put Credit Spread: SELL OTM PUT + BUY further OTM PUT
   */
  private selectBullPutSpread(
    spotPrice: number,
    optionChain: NiftyOptionChain,
    levels: SupportResistanceLevel[]
  ): CandidateSpread | null {
    const putContracts = optionChain.contracts.filter(
      (c) => c.optionType === "PE" && c.strike < spotPrice
    );

    if (putContracts.length < 2) return null;

    // Filter Support levels below spot
    const supports = levels
      .filter((l) => l.price < spotPrice)
      .map((l) => l.price);
    const nearestSupport = supports.length > 0 ? Math.max(...supports) : spotPrice * 0.985;

    const candidates: CandidateSpread[] = [];

    // Candidate sell puts (Target Delta: -0.15 to -0.38)
    for (const sellPut of putContracts) {
      if (sellPut.delta > -0.15 || sellPut.delta < -0.38) continue;
      if (sellPut.strike >= spotPrice) continue;
      // Gamma Risk Filter: reject if short leg gamma is excessive near spot
      if (sellPut.gamma !== undefined && sellPut.gamma > 0.005 && Math.abs(spotPrice - sellPut.strike) < 50) {
        continue;
      }
      // Mandatory S/R Distance: spot must have adequate distance from nearest support
      if (Math.abs(spotPrice - nearestSupport) < 25) continue;

      // Find hedge buy puts (50 to 200 points lower)
      const buyHedgePuts = putContracts.filter(
        (b) => b.strike < sellPut.strike && sellPut.strike - b.strike >= 50 && sellPut.strike - b.strike <= 200
      );

      for (const buyPut of buyHedgePuts) {
        const netCredit = sellPut.bid - buyPut.ask;
        const spreadWidth = sellPut.strike - buyPut.strike;
        const maxLoss = spreadWidth - netCredit;

        if (netCredit < 10 || maxLoss <= 0) continue; // Reject low credit
        // Mandate gross max loss constraint <= Rs 1,000 per lot
        if (maxLoss * 25 > 1000) continue;

        const rewardRiskRatio = Number((netCredit / maxLoss).toFixed(2));
        const srDistancePct = Math.abs((spotPrice - sellPut.strike) / spotPrice);

        // Quality score math
        const score = Number(
          (rewardRiskRatio * 150 + srDistancePct * 100 + (sellPut.openInterest / 10000)).toFixed(0)
        );

        candidates.push({
          strategyType: "BULL_PUT_SPREAD",
          expiry: sellPut.expiry,
          sellLeg: sellPut,
          buyLeg: buyPut,
          netCredit: Number(netCredit.toFixed(2)),
          maxLoss: Number(maxLoss.toFixed(2)),
          rewardRiskRatio,
          spreadWidth,
          score,
          gammaRisk: sellPut.gamma,
        });
      }
    }

    if (candidates.length === 0) return null;

    // Sort by score descending and return best candidate
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0];
  }

  /**
   * Bear Call Credit Spread: SELL OTM CALL + BUY further OTM CALL
   */
  private selectBearCallSpread(
    spotPrice: number,
    optionChain: NiftyOptionChain,
    levels: SupportResistanceLevel[]
  ): CandidateSpread | null {
    const callContracts = optionChain.contracts.filter(
      (c) => c.optionType === "CE" && c.strike > spotPrice
    );

    if (callContracts.length < 2) return null;

    // Filter Resistance levels above spot
    const resistances = levels
      .filter((l) => l.price > spotPrice)
      .map((l) => l.price);
    const nearestResistance =
      resistances.length > 0 ? Math.min(...resistances) : spotPrice * 1.015;

    const candidates: CandidateSpread[] = [];

    // Candidate sell calls (Target Delta: 0.15 to 0.38)
    for (const sellCall of callContracts) {
      if (sellCall.delta < 0.15 || sellCall.delta > 0.38) continue;
      if (sellCall.strike <= spotPrice) continue;
      // Gamma Risk Filter: reject if short leg gamma is excessive near spot
      if (sellCall.gamma !== undefined && sellCall.gamma > 0.005 && Math.abs(spotPrice - sellCall.strike) < 50) {
        continue;
      }
      // Mandatory S/R Distance: spot must have adequate distance from nearest resistance
      if (Math.abs(nearestResistance - spotPrice) < 25) continue;

      // Find hedge buy calls (50 to 200 points higher)
      const buyHedgeCalls = callContracts.filter(
        (b) => b.strike > sellCall.strike && b.strike - sellCall.strike >= 50 && b.strike - sellCall.strike <= 200
      );

      for (const buyCall of buyHedgeCalls) {
        const netCredit = sellCall.bid - buyCall.ask;
        const spreadWidth = buyCall.strike - sellCall.strike;
        const maxLoss = spreadWidth - netCredit;

        if (netCredit < 10 || maxLoss <= 0) continue;
        if (maxLoss * 25 > 1000) continue;

        const rewardRiskRatio = Number((netCredit / maxLoss).toFixed(2));
        const srDistancePct = Math.abs((sellCall.strike - spotPrice) / spotPrice);

        const score = Number(
          (rewardRiskRatio * 150 + srDistancePct * 100 + (sellCall.openInterest / 10000)).toFixed(0)
        );

        candidates.push({
          strategyType: "BEAR_CALL_SPREAD",
          expiry: sellCall.expiry,
          sellLeg: sellCall,
          buyLeg: buyCall,
          netCredit: Number(netCredit.toFixed(2)),
          maxLoss: Number(maxLoss.toFixed(2)),
          rewardRiskRatio,
          spreadWidth,
          score,
          gammaRisk: sellCall.gamma,
        });
      }
    }

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => b.score - a.score);
    return candidates[0];
  }

  /**
   * Iron Condor: Combination of Bull Put + Bear Call Spread in Range Market
   */
  private selectIronCondorSpread(
    spotPrice: number,
    optionChain: NiftyOptionChain,
    levels: SupportResistanceLevel[]
  ): CandidateSpread | null {
    const bullPut = this.selectBullPutSpread(spotPrice, optionChain, levels);
    const bearCall = this.selectBearCallSpread(spotPrice, optionChain, levels);

    if (!bullPut || !bearCall) return null;

    // Use Bull Put side for baseline representation in Iron Condor structure
    const totalCredit = Number((bullPut.netCredit + bearCall.netCredit).toFixed(2));
    const maxLoss = Number(
      (Math.max(bullPut.maxLoss, bearCall.maxLoss) - bearCall.netCredit).toFixed(2)
    );

    if (maxLoss <= 0 || totalCredit < 25) return null;

    return {
      strategyType: "IRON_CONDOR",
      expiry: bullPut.expiry,
      sellLeg: bullPut.sellLeg,
      buyLeg: bullPut.buyLeg,
      netCredit: totalCredit,
      maxLoss,
      rewardRiskRatio: Number((totalCredit / maxLoss).toFixed(2)),
      spreadWidth: bullPut.spreadWidth,
      score: Math.round((bullPut.score + bearCall.score) / 2),
    };
  }
}

export const adaptiveStrikeSelector = new AdaptiveStrikeSelector();
