import { CanonicalOptionContract, DataSourceType } from "../types";

/**
 * Health status for an option chain provider.
 */
export interface OptionChainProviderHealth {
  isConfigured: boolean;
  isAuthenticated: boolean;
  lastFetchMs: number;
  lastSuccessMs: number;
  consecutiveFailures: number;
  currentBackoffMs: number;
  providerName: string;
  status: "OK" | "DEGRADED" | "FAILED" | "NOT_CONFIGURED";
  errorMessage?: string;
}

/**
 * Result from a single option chain fetch attempt.
 * sourceType is explicit — never implicit.
 */
export interface OptionChainFetchResult {
  success: boolean;
  sourceType: DataSourceType;
  providerName: string;
  contracts: CanonicalOptionContract[];
  spotPrice: number | null;
  expiryDates: string[];
  nearestExpiry: string | null;
  lotSize: number | null;            // from provider; null if not supplied
  underlyingTimestamp: string | null;
  fetchDurationMs: number;
  errorMessage?: string;
  errorCode?: string;
}

/**
 * Provider-neutral interface for any NIFTY option chain source.
 * Implementors: NseIndiaOptionChainProvider, ZerodhaDhanOptionChainProvider, etc.
 *
 * Rules:
 * - Never return synthetic data when fetch fails — return success=false
 * - Never fabricate Greeks or IV — use ivSource / deltaSource labels
 * - Never silently swallow errors — always populate errorMessage + errorCode
 */
export interface INiftyOptionChainProvider {
  getProviderName(): string;
  isConfigured(): boolean;
  fetchOptionChain(spotPrice: number): Promise<OptionChainFetchResult>;
  getProviderHealth(): OptionChainProviderHealth;
}
