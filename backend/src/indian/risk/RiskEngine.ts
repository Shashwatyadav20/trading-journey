import { RiskValidation } from "../types";
import { DEFAULT_NIFTY_CONFIG, NiftyConfig } from "../config/niftyConfig";

export class RiskEngine {
  private config: NiftyConfig;

  constructor(config: NiftyConfig = DEFAULT_NIFTY_CONFIG) {
    this.config = config;
  }

  /**
   * Validates risk and calculates lot quantity for a proposed spread setup.
   *
   * @param capital Account balance in INR (e.g. 500,000)
   * @param spreadWidth Distance between sell strike and buy hedge strike (e.g. 200 points)
   * @param netCredit Net credit received per share (e.g. 45 points)
   * @param estimatedCharges Per-trade estimated fees and slippage
   */
  public validateAndSizePosition(
    capital: number,
    spreadWidth: number,
    netCredit: number,
    estimatedCharges: number = 0
  ): RiskValidation {
    if (capital <= 0) {
      return {
        allowed: false,
        capital,
        allowedRisk: 0,
        maxLossPerLot: 0,
        lotQuantity: 0,
        totalQuantity: 0,
        marginRequired: 0,
        riskPercentage: 0,
        rejectionReason: "Invalid capital balance (must be > 0).",
      };
    }

    // Allowed risk amount = capital * 1% (e.g. Rs 5,000 for Rs 500k capital)
    const allowedRisk = (capital * this.config.maxCapitalRiskPctPerTrade) / 100.0;

    // Max loss per lot = (Spread Width - Net Credit) * Lot Size + Estimated Charges
    const grossLossPerShare = spreadWidth - netCredit;
    const maxLossPerLot = grossLossPerShare * this.config.lotSize + estimatedCharges;

    if (maxLossPerLot <= 0) {
      return {
        allowed: false,
        capital,
        allowedRisk,
        maxLossPerLot: 0,
        lotQuantity: 0,
        totalQuantity: 0,
        marginRequired: 0,
        riskPercentage: 0,
        rejectionReason: "Invalid spread risk structure (max loss <= 0).",
      };
    }

    // Automatic Lot Sizing: floor(allowedRisk / maxLossPerLot)
    const lotQuantity = Math.floor(allowedRisk / maxLossPerLot);

    if (lotQuantity < 1) {
      return {
        allowed: false,
        capital,
        allowedRisk: Number(allowedRisk.toFixed(2)),
        maxLossPerLot: Number(maxLossPerLot.toFixed(2)),
        lotQuantity: 0,
        totalQuantity: 0,
        marginRequired: 0,
        riskPercentage: 0,
        rejectionReason: `Single lot risk (₹${maxLossPerLot.toFixed(
          0
        )}) exceeds max allowed 1% risk limit (₹${allowedRisk.toFixed(0)}).`,
      };
    }

    const totalQuantity = lotQuantity * this.config.lotSize;
    const totalMaxLoss = maxLossPerLot * lotQuantity;

    // Span Margin requirement approximation for defined risk credit spread:
    // Approx = (Spread Width * Lot Size * Quantity)
    const marginRequired = spreadWidth * totalQuantity;
    const riskPercentage = Number(((totalMaxLoss / capital) * 100).toFixed(2));

    return {
      allowed: true,
      capital,
      allowedRisk: Number(allowedRisk.toFixed(2)),
      maxLossPerLot: Number(maxLossPerLot.toFixed(2)),
      lotQuantity,
      totalQuantity,
      marginRequired: Number(marginRequired.toFixed(2)),
      riskPercentage,
      rejectionReason: null,
    };
  }
}

export const riskEngine = new RiskEngine();
