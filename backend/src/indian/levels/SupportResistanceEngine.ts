import { SupportResistanceLevel, Candle, NiftyOptionChain } from "../types";

export class SupportResistanceEngine {
  /**
   * Identifies key support and resistance levels across timeframes and option chain walls.
   */
  public calculateLevels(
    spotPrice: number,
    candles15M: Candle[],
    dailyCandles: Candle[] = [],
    optionChain?: NiftyOptionChain
  ): SupportResistanceLevel[] {
    const rawLevels: SupportResistanceLevel[] = [];

    if (spotPrice <= 0) return [];

    // 1. Daily & Weekly Levels (if daily candles available)
    if (dailyCandles && dailyCandles.length >= 2) {
      const prevDay = dailyCandles[dailyCandles.length - 2];

      rawLevels.push({
        price: prevDay.high,
        type: "PDH",
        strengthScore: 8,
        source: "Previous Day High",
        distanceFromSpotPct: Number(
          (((prevDay.high - spotPrice) / spotPrice) * 100).toFixed(2)
        ),
        distancePoints: Number((prevDay.high - spotPrice).toFixed(2)),
      });

      rawLevels.push({
        price: prevDay.low,
        type: "PDL",
        strengthScore: 8,
        source: "Previous Day Low",
        distanceFromSpotPct: Number(
          (((prevDay.low - spotPrice) / spotPrice) * 100).toFixed(2)
        ),
        distancePoints: Number((prevDay.low - spotPrice).toFixed(2)),
      });

      rawLevels.push({
        price: prevDay.close,
        type: "PC",
        strengthScore: 7,
        source: "Previous Close",
        distanceFromSpotPct: Number(
          (((prevDay.close - spotPrice) / spotPrice) * 100).toFixed(2)
        ),
        distancePoints: Number((prevDay.close - spotPrice).toFixed(2)),
      });
    } else {
      // Fallback synthetic levels if daily candles not fully available
      rawLevels.push({
        price: Number((spotPrice * 1.008).toFixed(2)),
        type: "PDH",
        strengthScore: 8,
        source: "Estimated PDH",
        distanceFromSpotPct: 0.8,
        distancePoints: Number((spotPrice * 0.008).toFixed(2)),
      });

      rawLevels.push({
        price: Number((spotPrice * 0.992).toFixed(2)),
        type: "PDL",
        strengthScore: 8,
        source: "Estimated PDL",
        distanceFromSpotPct: -0.8,
        distancePoints: Number((-spotPrice * 0.008).toFixed(2)),
      });
    }

    // 2. 15M Swing Levels
    if (candles15M && candles15M.length >= 5) {
      const highs = candles15M.map((c) => c.high);
      const lows = candles15M.map((c) => c.low);

      const swingHigh = Math.max(...highs);
      const swingLow = Math.min(...lows);

      rawLevels.push({
        price: swingHigh,
        type: "SWING_HIGH",
        strengthScore: 6,
        source: "15M Swing High",
        distanceFromSpotPct: Number(
          (((swingHigh - spotPrice) / spotPrice) * 100).toFixed(2)
        ),
        distancePoints: Number((swingHigh - spotPrice).toFixed(2)),
      });

      rawLevels.push({
        price: swingLow,
        type: "SWING_LOW",
        strengthScore: 6,
        source: "15M Swing Low",
        distanceFromSpotPct: Number(
          (((swingLow - spotPrice) / spotPrice) * 100).toFixed(2)
        ),
        distancePoints: Number((swingLow - spotPrice).toFixed(2)),
      });
    }

    // 3. Option Chain High-OI Walls
    if (optionChain && optionChain.contracts && optionChain.contracts.length > 0) {
      const callContracts = optionChain.contracts.filter(
        (c) => c.optionType === "CE"
      );
      const putContracts = optionChain.contracts.filter(
        (c) => c.optionType === "PE"
      );

      if (callContracts.length > 0) {
        callContracts.sort((a, b) => b.openInterest - a.openInterest);
        const maxCallOI = callContracts[0];
        if (maxCallOI && maxCallOI.openInterest > 0) {
          rawLevels.push({
            price: maxCallOI.strike,
            type: "OI_WALL_CALL",
            strengthScore: 10,
            source: `Max Call OI Wall (${maxCallOI.strike} CE)`,
            distanceFromSpotPct: Number(
              (((maxCallOI.strike - spotPrice) / spotPrice) * 100).toFixed(2)
            ),
            distancePoints: Number((maxCallOI.strike - spotPrice).toFixed(2)),
          });
        }
      }

      if (putContracts.length > 0) {
        putContracts.sort((a, b) => b.openInterest - a.openInterest);
        const maxPutOI = putContracts[0];
        if (maxPutOI && maxPutOI.openInterest > 0) {
          rawLevels.push({
            price: maxPutOI.strike,
            type: "OI_WALL_PUT",
            strengthScore: 10,
            source: `Max Put OI Wall (${maxPutOI.strike} PE)`,
            distanceFromSpotPct: Number(
              (((maxPutOI.strike - spotPrice) / spotPrice) * 100).toFixed(2)
            ),
            distancePoints: Number((maxPutOI.strike - spotPrice).toFixed(2)),
          });
        }
      }
    }

    // 4. Cluster levels within 0.25% tolerance
    const sorted = rawLevels.sort((a, b) => b.strengthScore - a.strengthScore);
    const clustered: SupportResistanceLevel[] = [];

    for (const level of sorted) {
      const exists = clustered.some(
        (c) => Math.abs(c.price - level.price) / spotPrice < 0.0025
      );
      if (!exists) {
        clustered.push(level);
      }
    }

    return clustered;
  }
}

export const supportResistanceEngine = new SupportResistanceEngine();
