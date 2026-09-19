import {
  INiftyMarketDataProvider,
  SpotPriceResult,
  CandlesResult,
  OptionChainResult,
  NiftyDataHealth,
} from "./INiftyMarketDataProvider";
import {
  Candle,
  NiftyOptionChain,
  OptionContract,
  DataComponentHealthMap,
  DataComponentStatus,
  Phase17DataHealth,
  ComponentHealth,
} from "../types";
import { niftyOptionChainService } from "./NiftyOptionChainService";
import { priceStore } from "../../market/MarketPriceStore";
import { INiftyOptionChainProvider } from "./INiftyOptionChainProvider";
import { nseIndiaOptionChainProvider } from "./NseIndiaOptionChainProvider";

export class NiftyMarketProvider implements INiftyMarketDataProvider {
  private providerName = "NiftyMarketProvider";
  private lastUpdateTimestampMs: number = Date.now();
  private staleTimeoutMs: number = 60000; // 60 seconds stale timeout
  private overrideSpotPrice: number | null = null;
  private isOverrideReal: boolean = false;
  private optionChainProvider: INiftyOptionChainProvider | null = null;

  constructor(
    staleTimeoutMs = 60000,
    optionChainProvider: INiftyOptionChainProvider | null = nseIndiaOptionChainProvider,
  ) {
    this.staleTimeoutMs = staleTimeoutMs;
    this.optionChainProvider = optionChainProvider;
  }

  public getProviderName(): string {
    return this.providerName;
  }

  /**
   * Sets or replaces the option chain provider.
   */
  public setOptionChainProvider(provider: INiftyOptionChainProvider | null): void {
    this.optionChainProvider = provider;
  }

  /**
   * Directly sets spot price & timestamps for testing or feed ingestion.
   */
  public updateSpotPrice(price: number, isReal: boolean = false, timestampMs: number = Date.now()) {
    this.overrideSpotPrice = price;
    this.isOverrideReal = isReal;
    this.lastUpdateTimestampMs = timestampMs;
  }

  public async getSpotPrice(): Promise<SpotPriceResult> {
    const now = Date.now();

    if (this.overrideSpotPrice !== null) {
      return {
        spotPrice: this.overrideSpotPrice,
        timestamp: this.lastUpdateTimestampMs,
        isReal: this.isOverrideReal,
      };
    }

    const storedPrice = priceStore.getPrice("NIFTY");
    if (storedPrice && storedPrice.price > 0) {
      const storedMs = new Date(storedPrice.timestamp).getTime();
      const ageMs = now - storedMs;

      if (ageMs < this.staleTimeoutMs) {
        this.lastUpdateTimestampMs = storedMs;
        return {
          spotPrice: storedPrice.price,
          timestamp: storedMs,
          isReal: true,
        };
      }
    }

    // No live data — return default paper/synthetic price
    return {
      spotPrice: 24700.45,
      timestamp: this.lastUpdateTimestampMs,
      isReal: false,
    };
  }

  public async getCandles(timeframe: "15M" | "1H", limit = 30): Promise<CandlesResult> {
    const spotRes = await this.getSpotPrice();
    const spot = spotRes.spotPrice;
    const now = Math.floor(Date.now() / 1000);
    const intervalSec = timeframe === "15M" ? 900 : 3600;

    const candles: Candle[] = [];
    for (let i = limit - 1; i >= 0; i--) {
      const time = now - i * intervalSec;
      const base = spot - (limit / 2 - i) * 3;
      candles.push({
        time,
        open: Number((base - 2).toFixed(2)),
        high: Number((base + 8).toFixed(2)),
        low: Number((base - 5).toFixed(2)),
        close: Number((base + 4).toFixed(2)),
        volume: 15000 + i * 200,
      });
    }

    return { candles, isReal: spotRes.isReal };
  }

  public async getOptionChain(spotPrice: number): Promise<OptionChainResult> {
    const spotRes = await this.getSpotPrice();
    const effectiveSpot = spotRes.spotPrice > 0 ? spotRes.spotPrice : spotPrice;

    if (this.optionChainProvider) {
      const fetchResult = await this.optionChainProvider.fetchOptionChain(effectiveSpot);
      if (fetchResult.success && fetchResult.contracts.length > 0) {
        const contracts: OptionContract[] = fetchResult.contracts.map((c) => ({
          symbol: `NIFTY${c.expiry.replace(/-/g, "")}${c.strike}${c.optionType}`,
          expiry: c.expiry,
          strike: c.strike,
          optionType: c.optionType,
          ltp: c.ltp,
          bid: c.bid,
          ask: c.ask,
          volume: c.volume ?? 0,
          openInterest: c.openInterest ?? 0,
          changeInOI: 0,
          iv: c.iv ?? 0.15,
          delta: c.delta ?? (c.optionType === "CE" ? 0.5 : -0.5),
          gamma: c.gamma,
          timestamp: c.timestamp,
        }));

        const chain: NiftyOptionChain = {
          spotPrice: fetchResult.spotPrice ?? effectiveSpot,
          timestamp: fetchResult.underlyingTimestamp ?? new Date().toISOString(),
          contracts,
          isSynthetic: false,
        };

        return {
          chain,
          isReal: true,
        };
      } else {
        // Option chain provider fetch failed or returned 0 contracts -> NO synthetic fallback
        return {
          chain: {
            spotPrice: effectiveSpot,
            timestamp: new Date().toISOString(),
            contracts: [],
            isSynthetic: true,
          },
          isReal: false,
        };
      }
    }

    // Explicitly no provider set (e.g. legacy fallback) -> synthetic chain
    const chain: NiftyOptionChain = niftyOptionChainService.generateSyntheticChain(spotPrice);
    chain.isSynthetic = true;

    return {
      chain,
      isReal: false,
    };
  }

  public getDataHealth(): NiftyDataHealth {
    const now = Date.now();
    const ageMs = now - this.lastUpdateTimestampMs;
    const isStale = ageMs > this.staleTimeoutMs;

    return {
      isHealthy: !isStale,
      isStale,
      lastUpdateTimestamp: this.lastUpdateTimestampMs,
      providerName: this.providerName,
      errorMessage: isStale
        ? `Data is stale (last update ${Math.round(ageMs / 1000)}s ago)`
        : undefined,
    };
  }

  /**
   * Phase 17: Evaluates complete data health across spot, option chain, and option prices.
   */
  public async getPhase17DataHealth(): Promise<Phase17DataHealth> {
    const now = Date.now();
    const spotRes = await this.getSpotPrice();
    const providerHealth = this.optionChainProvider ? this.optionChainProvider.getProviderHealth() : null;

    const spotAgeMs = now - spotRes.timestamp;
    const spotStatus: ComponentHealth = {
      status: spotAgeMs > this.staleTimeoutMs ? "STALE" : spotRes.isReal ? "AVAILABLE" : "INVALID",
      sourceType: spotRes.isReal ? "REAL" : "SYNTHETIC",
      ageMs: spotAgeMs,
      lastUpdateMs: spotRes.timestamp,
      errorMessage: !spotRes.isReal ? "Spot price is synthetic or unverified" : undefined,
    };

    let chainStatus: ComponentHealth;
    let optionPricesStatus: ComponentHealth;
    let chainMs = 0;

    if (providerHealth && providerHealth.lastSuccessMs > 0) {
      chainMs = providerHealth.lastSuccessMs;
      const chainAgeMs = now - chainMs;
      const isChainStale = chainAgeMs > this.staleTimeoutMs;

      chainStatus = {
        status: isChainStale ? "STALE" : providerHealth.status === "OK" ? "AVAILABLE" : "ERROR",
        sourceType: isChainStale ? "STALE" : providerHealth.status === "OK" ? "REAL" : "INVALID",
        ageMs: chainAgeMs,
        lastUpdateMs: chainMs,
        errorMessage: providerHealth.errorMessage,
      };
      optionPricesStatus = { ...chainStatus };
    } else {
      chainStatus = {
        status: "MISSING",
        sourceType: "UNKNOWN",
        ageMs: Infinity,
        lastUpdateMs: 0,
        errorMessage: providerHealth?.errorMessage ?? "Option chain provider not connected or fetch failed",
      };
      optionPricesStatus = { ...chainStatus };
    }

    const maxAgeMs = Math.max(
      spotStatus.ageMs,
      chainStatus.ageMs === Infinity ? 999999 : chainStatus.ageMs,
    );

    const genuineDataReady =
      spotStatus.sourceType === "REAL" &&
      spotStatus.status === "AVAILABLE" &&
      chainStatus.sourceType === "REAL" &&
      chainStatus.status === "AVAILABLE" &&
      optionPricesStatus.sourceType === "REAL" &&
      optionPricesStatus.status === "AVAILABLE";

    let blockedReason: string | null = null;
    if (!genuineDataReady) {
      if (spotStatus.sourceType !== "REAL") blockedReason = "REAL_SPOT_UNAVAILABLE";
      else if (spotStatus.status === "STALE") blockedReason = "SPOT_DATA_STALE";
      else if (chainStatus.sourceType !== "REAL") blockedReason = "REAL_OPTION_CHAIN_UNAVAILABLE";
      else if (chainStatus.status === "STALE") blockedReason = "OPTION_CHAIN_STALE";
      else blockedReason = "GENUINE_DATA_UNAVAILABLE";
    }

    return {
      spot: spotStatus,
      optionChain: chainStatus,
      optionPrices: optionPricesStatus,
      timestamps: {
        spotMs: spotRes.timestamp,
        optionChainMs: chainMs,
      },
      providerStatus: providerHealth?.status ?? "NOT_CONFIGURED",
      authenticationStatus: providerHealth?.isAuthenticated ? "OK" : "NOT_REQUIRED",
      marketStatus: this.getMarketStatus(),
      dataSource: this.optionChainProvider?.getProviderName() ?? "SYNTHETIC",
      lastUpdate: new Date(now).toISOString(),
      ageMs: maxAgeMs,
      genuineDataReady,
      blockedReason,
    };
  }

  private getMarketStatus(): "OPEN" | "CLOSED" | "PRE_MARKET" | "UNKNOWN" {
    const now = new Date();
    const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
    const istNow = new Date(utcMs + 5.5 * 3600000);
    const day = istNow.getDay();
    if (day === 0 || day === 6) return "CLOSED";
    const minutes = istNow.getHours() * 60 + istNow.getMinutes();
    if (minutes >= 540 && minutes < 555) return "PRE_MARKET";
    if (minutes >= 555 && minutes <= 930) return "OPEN";
    return "CLOSED";
  }

  /**
   * Evaluates granular status for all 8 data components as required by Phase 12.
   */
  public getDataComponentHealthMap(): DataComponentHealthMap {
    const health = this.getDataHealth();
    const isStale = health.isStale;

    const spotStatus: DataComponentStatus = isStale ? "STALE" : this.isOverrideReal ? "REAL" : "SYNTHETIC";
    const candleStatus: DataComponentStatus = isStale ? "STALE" : "SYNTHETIC";

    const providerHealth = this.optionChainProvider?.getProviderHealth();
    const isChainReal = providerHealth?.status === "OK" && (providerHealth?.lastSuccessMs ?? 0) > 0;
    const optionChainStatus: DataComponentStatus = isStale ? "STALE" : isChainReal ? "REAL" : "SYNTHETIC";

    const optionPricesStatus: DataComponentStatus = isStale ? "STALE" : isChainReal ? "REAL" : "SYNTHETIC";
    const ivStatus: DataComponentStatus = isStale ? "STALE" : isChainReal ? "REAL" : "SYNTHETIC";
    const deltaStatus: DataComponentStatus = isStale ? "STALE" : isChainReal ? "REAL" : "SYNTHETIC";
    const gammaStatus: DataComponentStatus = isStale ? "STALE" : "SYNTHETIC";
    const oiStatus: DataComponentStatus = isStale ? "STALE" : isChainReal ? "REAL" : "SYNTHETIC";

    const overallQuality = isStale
      ? "STALE_DATA"
      : isChainReal
      ? "REAL LIVE PERFORMANCE"
      : "SYNTHETIC OPTION DATA — PAPER ESTIMATION";


    return {
      spot: spotStatus,
      candles: candleStatus,
      optionChain: optionChainStatus,
      optionPrices: optionPricesStatus,
      iv: ivStatus,
      delta: deltaStatus,
      gamma: gammaStatus,
      oi: oiStatus,
      overallDataQuality: overallQuality,
    };
  }

  public touchDataTimestamp() {
    this.lastUpdateTimestampMs = Date.now();
  }
}

export const niftyMarketProvider = new NiftyMarketProvider();


