import { DhanMarketTick, DhanRealtimeMergeResult, CanonicalOptionContract } from "../types";
import { dhanMarketFeedProvider } from "./DhanMarketFeedProvider";
import { dhanBrokerAdapter } from "../broker/DhanBrokerAdapter";

export class DhanRealtimeDataMerger {
  /**
   * Merges REST option chain contract data with real-time WebSocket tick updates.
   */
  public mergeContractWithRealtimeTick(
    contract: CanonicalOptionContract,
    underlyingScrip: number = 13,
    underlyingSpotTick?: DhanMarketTick | null
  ): DhanRealtimeMergeResult {
    const secIdStr = String(contract.securityId || "").trim();
    const wsTick = dhanMarketFeedProvider.getLatestTick(secIdStr);
    const spotTick = underlyingSpotTick ?? dhanMarketFeedProvider.getLatestTick(String(underlyingScrip));

    // Freshest real-time prices from WebSocket ticks
    const optionLtp = wsTick?.ltp ?? contract.ltp ?? null;
    const bidPrice = wsTick?.bestBid ?? contract.bid ?? null;
    const askPrice = wsTick?.bestAsk ?? contract.ask ?? null;
    const spotPrice = spotTick?.ltp ?? contract.underlyingPrice ?? null;

    // REST Option Chain provider-derived fields
    const oi = wsTick?.oi ?? contract.openInterest ?? null;
    const iv = contract.iv ?? null;
    const delta = contract.delta ?? null;
    const gamma = contract.gamma ?? null;
    const theta = contract.theta ?? null;
    const vega = contract.vega ?? null;
    const lotSize = contract.lotSize ?? null;
    const expiry = contract.expiryDate ?? null;
    const strike = contract.strikePrice ?? null;

    // Source provenance tagging
    const provenance = {
      spot: spotTick?.ltp !== undefined ? "DHAN_WEBSOCKET" : "DHAN_REST_SNAPSHOT",
      optionLtp: wsTick?.ltp !== undefined ? "DHAN_WEBSOCKET" : "DHAN_OPTION_CHAIN",
      oi: wsTick?.oi !== undefined ? "DHAN_WEBSOCKET" : "DHAN_OPTION_CHAIN",
      iv: contract.iv !== undefined ? "DHAN_OPTION_CHAIN" : "UNAVAILABLE",
      delta: contract.delta !== undefined ? "DHAN_OPTION_CHAIN" : "UNAVAILABLE",
      gamma: contract.gamma !== undefined ? "DHAN_OPTION_CHAIN" : "UNAVAILABLE",
      lotSize: contract.lotSize !== undefined && contract.lotSize !== null ? "DHAN_INSTRUMENT_MASTER" : "UNAVAILABLE",
      expiry: contract.expiryDate ? "DHAN_EXPIRY_LIST" : "UNAVAILABLE",
    };

    return {
      securityId: secIdStr,
      underlyingScrip,
      spotPrice,
      optionLtp,
      bidPrice,
      askPrice,
      oi,
      iv,
      delta,
      gamma,
      theta,
      vega,
      lotSize,
      expiry,
      strike,
      provenance,
      mergedAt: new Date().toISOString(),
    };
  }
}

export const dhanRealtimeDataMerger = new DhanRealtimeDataMerger();
