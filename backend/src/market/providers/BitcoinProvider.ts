import { CoinGeckoProvider } from "./CoinGeckoProvider";

export class BitcoinProvider extends CoinGeckoProvider {
  constructor(pollIntervalMs: number = 2000) {
    super({
      instrument: "BTC/USD",
      coinId: "bitcoin",
      isProxy: false,
      logTag: "BitcoinProvider",
      pollIntervalMs,
    });
  }
}

// Re-export for backward compatibility
export { BitcoinProvider as BinanceProvider };
