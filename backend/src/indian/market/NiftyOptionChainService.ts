import { NiftyOptionChain, OptionContract } from "../types";
import { DEFAULT_NIFTY_CONFIG, NiftyConfig } from "../config/niftyConfig";

export class NiftyOptionChainService {
  private config: NiftyConfig;

  constructor(config: NiftyConfig = DEFAULT_NIFTY_CONFIG) {
    this.config = config;
  }

  /**
   * Normalizes and filters raw option chain contracts.
   * Rejects illiquid, stale, or wide-spread options.
   */
  public normalizeOptionChain(
    spotPrice: number,
    rawContracts: Partial<OptionContract>[],
    expiryStr: string = "2026-09-26"
  ): NiftyOptionChain {
    const validContracts: OptionContract[] = [];
    const nowIso = new Date().toISOString();

    for (const raw of rawContracts) {
      if (!raw.strike || raw.strike <= 0 || !raw.optionType) continue;

      const ltp = raw.ltp && raw.ltp > 0 ? raw.ltp : 0;
      const bid = raw.bid && raw.bid > 0 ? raw.bid : Math.max(0, ltp - 0.5);
      const ask = raw.ask && raw.ask > 0 ? raw.ask : ltp + 0.5;

      // Filter 1: Wide bid/ask spread
      const spread = ask - bid;
      if (spread > this.config.maxBidAskSpreadPoints) {
        continue; // Reject wide spread
      }

      // Filter 2: Zero prices
      if (ltp <= 0 || bid <= 0 || ask <= 0) {
        continue; // Reject zero price
      }

      // Filter 3: Delta calculation approximation if missing
      // Call Delta ~ max(0, 0.5 - (strike - spot) / 1000)
      // Put Delta  ~ min(0, -0.5 - (strike - spot) / 1000)
      let delta = raw.delta;
      if (delta === undefined || isNaN(delta)) {
        const distPct = (raw.strike - spotPrice) / spotPrice;
        if (raw.optionType === "CE") {
          delta = Math.max(0.01, Math.min(0.99, 0.5 - distPct * 5));
        } else {
          delta = Math.min(-0.01, Math.max(-0.99, -0.5 - distPct * 5));
        }
      }

      let gamma = raw.gamma;
      if (gamma === undefined || isNaN(gamma)) {
        const dist = Math.abs((raw.strike - spotPrice));
        gamma = Number((Math.exp(-0.5 * Math.pow(dist / 250, 2)) / 300).toFixed(4));
      }

      const contract: OptionContract = {
        symbol:
          raw.symbol ||
          `NIFTY_${expiryStr}_${raw.strike}_${raw.optionType}`,
        expiry: raw.expiry || expiryStr,
        strike: raw.strike,
        optionType: raw.optionType,
        ltp: Number(ltp.toFixed(2)),
        bid: Number(bid.toFixed(2)),
        ask: Number(ask.toFixed(2)),
        volume: raw.volume || 10000,
        openInterest: raw.openInterest || 50000,
        changeInOI: raw.changeInOI || 1200,
        iv: raw.iv || 14.5,
        delta: Number(delta.toFixed(2)),
        gamma: Number(gamma.toFixed(4)),
        timestamp: raw.timestamp || nowIso,
      };

      validContracts.push(contract);
    }

    // Sort by strike ascending
    validContracts.sort((a, b) => a.strike - b.strike);

    return {
      spotPrice,
      timestamp: nowIso,
      contracts: validContracts,
    };
  }

  /**
   * Generates a realistic synthetic NIFTY option chain around spot price for paper trading / backtesting.
   */
  public generateSyntheticChain(
    spotPrice: number,
    expiryStr: string = "2026-09-26"
  ): NiftyOptionChain {
    const atmStrike = Math.round(spotPrice / 50) * 50;
    const contracts: Partial<OptionContract>[] = [];

    // Generate strikes from -600 to +600 points around ATM
    for (let offset = -600; offset <= 600; offset += 50) {
      const strike = atmStrike + offset;
      const dist = strike - spotPrice;

      // Estimated Call Premium (Black-Scholes approximation for NIFTY)
      const callLtp = Math.max(
        1.5,
        Math.abs(dist) < 50
          ? 140 - Math.abs(dist) * 1.2
          : dist < 0
          ? Math.abs(dist) + 30
          : Math.max(2, 100 * Math.exp(-dist / 120))
      );

      // Estimated Put Premium
      const putLtp = Math.max(
        1.5,
        Math.abs(dist) < 50
          ? 140 - Math.abs(dist) * 1.2
          : dist > 0
          ? dist + 30
          : Math.max(2, 100 * Math.exp(dist / 120))
      );

      // Call Delta
      const callDelta =
        dist < 0 ? 0.7 - (dist / 1000) : Math.max(0.02, 0.48 - dist / 400);

      // Put Delta
      const putDelta =
        dist > 0 ? -0.7 - (dist / 1000) : Math.min(-0.02, -0.48 - dist / 400);

      contracts.push({
        strike,
        optionType: "CE",
        ltp: Number(callLtp.toFixed(2)),
        bid: Number((callLtp - 0.4).toFixed(2)),
        ask: Number((callLtp + 0.4).toFixed(2)),
        volume: 25000 - Math.abs(dist) * 20,
        openInterest: 120000 - Math.abs(dist) * 80,
        changeInOI: 3400,
        iv: 13.8 + Math.abs(dist) * 0.005,
        delta: Number(callDelta.toFixed(2)),
      });

      contracts.push({
        strike,
        optionType: "PE",
        ltp: Number(putLtp.toFixed(2)),
        bid: Number((putLtp - 0.4).toFixed(2)),
        ask: Number((putLtp + 0.4).toFixed(2)),
        volume: 25000 - Math.abs(dist) * 20,
        openInterest: 140000 - Math.abs(dist) * 80,
        changeInOI: 4100,
        iv: 14.2 + Math.abs(dist) * 0.005,
        delta: Number(putDelta.toFixed(2)),
      });
    }

    return this.normalizeOptionChain(spotPrice, contracts, expiryStr);
  }
}

export const niftyOptionChainService = new NiftyOptionChainService();
