import { BitcoinProvider } from "./BitcoinProvider";

/**
 * BinanceProvider has been replaced by BitcoinProvider using CoinGecko public API
 * to prevent Binance HTTP 451 legal eligibility blocks in cloud host environments.
 */
export class BinanceProvider extends BitcoinProvider {}
