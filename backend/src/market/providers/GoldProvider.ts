import { CoinGeckoProvider } from "./CoinGeckoProvider";

/**
 * GoldProvider fetches PAX Gold (pax-gold) from CoinGecko as a proxy for XAU/USD.
 * 
 * IMPORTANT: XAU/USD uses Pax Gold (pax-gold) via CoinGecko as an explicitly labeled proxy
 * (isProxy: true) because physical gold spot prices are not provided by standard keyless crypto APIs.
 * The application instrument remains "XAU/USD".
 */
export class GoldProvider extends CoinGeckoProvider {
  constructor(pollIntervalMs: number = 3000) {
    super({
      instrument: "XAU/USD",
      coinId: "pax-gold",
      isProxy: true, // IMPORTANT: Marked as proxy
      logTag: "GoldProvider",
      pollIntervalMs,
    });
  }
}
