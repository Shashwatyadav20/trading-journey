export type SlippageType = "FIXED_POINTS" | "BID_ASK_SPREAD" | "PERCENTAGE";

export interface SlippageConfig {
  type: SlippageType;
  fixedPointsPerLeg: number; // Default 0.5 points
  percentageOfPremium: number; // Default 0.005 (0.5%)
}

export class SlippageModel {
  private config: SlippageConfig = {
    type: "FIXED_POINTS",
    fixedPointsPerLeg: 0.5,
    percentageOfPremium: 0.005,
  };

  constructor(config?: Partial<SlippageConfig>) {
    if (config) {
      this.config = { ...this.config, ...config };
    }
  }

  public setConfig(config: Partial<SlippageConfig>) {
    this.config = { ...this.config, ...config };
  }

  public getConfig(): SlippageConfig {
    return { ...this.config };
  }

  /**
   * Calculates execution price with slippage applied.
   * - BUY side: price increases due to slippage (fill at higher price).
   * - SELL side: price decreases due to slippage (fill at lower price).
   */
  public calculateExecutionPrice(
    side: "BUY" | "SELL",
    ltp: number,
    bid?: number,
    ask?: number
  ): { executionPrice: number; slippageAmount: number } {
    let slippageAmount = 0;

    if (this.config.type === "BID_ASK_SPREAD" && bid && ask && bid > 0 && ask > 0) {
      if (side === "BUY") {
        const executionPrice = ask;
        slippageAmount = Math.max(0, ask - ltp);
        return { executionPrice, slippageAmount };
      } else {
        const executionPrice = bid;
        slippageAmount = Math.max(0, ltp - bid);
        return { executionPrice, slippageAmount };
      }
    }

    if (this.config.type === "PERCENTAGE") {
      slippageAmount = ltp * this.config.percentageOfPremium;
    } else {
      // Default: FIXED_POINTS
      slippageAmount = this.config.fixedPointsPerLeg;
    }

    const executionPrice = side === "BUY" ? ltp + slippageAmount : Math.max(0.05, ltp - slippageAmount);
    return {
      executionPrice: Number(executionPrice.toFixed(2)),
      slippageAmount: Number(slippageAmount.toFixed(2)),
    };
  }
}

export const defaultSlippageModel = new SlippageModel();
