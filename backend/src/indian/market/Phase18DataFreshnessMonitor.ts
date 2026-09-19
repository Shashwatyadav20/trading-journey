import {
  Phase18FreshnessMetrics,
  Phase18ComponentFreshness,
  Phase18ComponentStatus,
  DataSourceType,
} from "../types";
import { niftyMarketProvider } from "./NiftyMarketProvider";
import { nseIndiaOptionChainProvider } from "./NseIndiaOptionChainProvider";

export class Phase18DataFreshnessMonitor {
  private staleThresholdMs: number;

  constructor(staleThresholdMs: number = 60000) {
    this.staleThresholdMs = staleThresholdMs;
  }

  public async getFreshnessMetrics(): Promise<Phase18FreshnessMetrics> {
    const now = Date.now();
    const spotRes = await niftyMarketProvider.getSpotPrice();
    const providerHealth = nseIndiaOptionChainProvider.getProviderHealth();

    // 1. Spot Component Freshness
    const spotAgeMs = now - spotRes.timestamp;
    let spotStatus: Phase18ComponentStatus = "HEALTHY";
    let spotSource: DataSourceType = spotRes.isReal ? "REAL" : "SYNTHETIC";

    if (!spotRes.isReal) {
      spotStatus = "MISSING";
    } else if (spotAgeMs > this.staleThresholdMs) {
      spotStatus = "STALE";
      spotSource = "STALE";
    }

    const spotComponent: Phase18ComponentFreshness = {
      status: spotStatus,
      sourceType: spotSource,
      ageMs: spotAgeMs,
      lastSuccessfulUpdateMs: spotRes.timestamp,
      errorMessage: spotStatus === "MISSING" ? "Spot price is synthetic/unverified" : spotStatus === "STALE" ? `Spot data stale (${Math.round(spotAgeMs / 1000)}s old)` : undefined,
    };


    // 2. Option Chain Component Freshness
    const chainLastSuccessMs = providerHealth.lastSuccessMs;
    const chainAgeMs = chainLastSuccessMs > 0 ? now - chainLastSuccessMs : Infinity;
    let chainStatus: Phase18ComponentStatus = "HEALTHY";
    let chainSource: DataSourceType = providerHealth.status === "OK" && chainLastSuccessMs > 0 ? "REAL" : "UNKNOWN";

    if (chainLastSuccessMs === 0) {
      chainStatus = "MISSING";
      chainSource = "UNKNOWN";
    } else if (chainAgeMs > this.staleThresholdMs) {
      chainStatus = "STALE";
      chainSource = "STALE";
    } else if (providerHealth.status === "FAILED") {
      chainStatus = "ERROR";
      chainSource = "INVALID";
    }

    const chainComponent: Phase18ComponentFreshness = {
      status: chainStatus,
      sourceType: chainSource,
      ageMs: chainAgeMs === Infinity ? 999999 : chainAgeMs,
      lastSuccessfulUpdateMs: chainLastSuccessMs,
      errorMessage: providerHealth.errorMessage ?? (chainStatus === "STALE" ? `Option chain stale (${Math.round(chainAgeMs / 1000)}s old)` : undefined),
    };

    // 3. Option Prices Component Freshness (linked to Option Chain)
    const pricesComponent: Phase18ComponentFreshness = {
      ...chainComponent,
    };

    // Overall Status
    const isAnyError = spotComponent.status === "ERROR" || chainComponent.status === "ERROR";
    const isAnyMissing = spotComponent.status === "MISSING" || chainComponent.status === "MISSING";
    const isAnyStale = spotComponent.status === "STALE" || chainComponent.status === "STALE";

    const overallStatus: Phase18ComponentStatus = isAnyError
      ? "ERROR"
      : isAnyMissing
      ? "MISSING"
      : isAnyStale
      ? "STALE"
      : "HEALTHY";

    const maxAgeMs = Math.max(
      spotComponent.ageMs,
      chainComponent.ageMs === 999999 ? 999999 : chainComponent.ageMs,
    );

    return {
      spot: spotComponent,
      optionChain: chainComponent,
      optionPrices: pricesComponent,
      overallStatus,
      maxAgeMs,
      evaluatedAt: new Date(now).toISOString(),
    };
  }
}

export const phase18DataFreshnessMonitor = new Phase18DataFreshnessMonitor();
