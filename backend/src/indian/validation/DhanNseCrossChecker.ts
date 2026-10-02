import { DhanNseComparisonResult } from "../types";
import { niftyMarketProvider } from "../market/NiftyMarketProvider";
import { operationalAlertLogger } from "../audit/OperationalAlertLogger";

export class DhanNseCrossChecker {
  /**
   * Performs read-only cross-check comparison between Dhan and NSE market data.
   */
  public async compareSpotAndOptions(
    symbol: string = "NIFTY",
    dhanSpot: number | null,
    dhanOptionLtp: number | null = null,
    tolerancePercentage: number = 1.0 // 1% threshold
  ): Promise<DhanNseComparisonResult> {
    const timestamp = new Date().toISOString();

    if (dhanSpot === null || dhanSpot <= 0) {
      return {
        timestamp,
        symbol,
        dhanSpot,
        nseSpot: null,
        spotDifference: null,
        dhanOptionLtp,
        nseOptionLtp: null,
        optionLtpDifference: null,
        matchStatus: "NSE_UNAVAILABLE",
        discrepancyLogged: false,
      };
    }

    try {
      const nseSpotRes = await niftyMarketProvider.getSpotPrice();
      const nseSpot = nseSpotRes.spotPrice && nseSpotRes.spotPrice > 0 ? nseSpotRes.spotPrice : null;

      if (!nseSpot) {
        return {
          timestamp,
          symbol,
          dhanSpot,
          nseSpot: null,
          spotDifference: null,
          dhanOptionLtp,
          nseOptionLtp: null,
          optionLtpDifference: null,
          matchStatus: "NSE_UNAVAILABLE",
          discrepancyLogged: false,
        };
      }

      const spotDiff = Math.abs(dhanSpot - nseSpot);
      const spotDiffPercent = (spotDiff / nseSpot) * 100;
      const isMatch = spotDiffPercent <= tolerancePercentage;

      const matchStatus = isMatch ? "DHAN_NSE_MATCH" : "DHAN_NSE_MISMATCH";
      let discrepancyLogged = false;

      if (!isMatch) {
        discrepancyLogged = true;
        operationalAlertLogger.logAlert(
          "DATA_SOURCE_MISMATCH",
          `Market data mismatch detected: Dhan spot ₹${dhanSpot} vs NSE spot ₹${nseSpot} (${spotDiffPercent.toFixed(2)}% diff)`,
          "WARNING",
          { dhanSpot, nseSpot, spotDiff, spotDiffPercent }
        );
      }

      return {
        timestamp,
        symbol,
        dhanSpot,
        nseSpot,
        spotDifference: spotDiff,
        dhanOptionLtp,
        nseOptionLtp: null,
        optionLtpDifference: null,
        matchStatus,
        discrepancyLogged,
      };
    } catch {
      return {
        timestamp,
        symbol,
        dhanSpot,
        nseSpot: null,
        spotDifference: null,
        dhanOptionLtp,
        nseOptionLtp: null,
        optionLtpDifference: null,
        matchStatus: "NSE_UNAVAILABLE",
        discrepancyLogged: false,
      };
    }
  }
}

export const dhanNseCrossChecker = new DhanNseCrossChecker();
