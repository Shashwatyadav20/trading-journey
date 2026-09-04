import { MarketPrice } from "../types";

export interface MarketProvider {
  /**
   * Starts the provider (e.g. opens websockets or begins polling)
   */
  start(): void;

  /**
   * Stops the provider
   */
  stop(): void;

  /**
   * Returns the latest known price from this provider
   */
  getCurrentPrice(): MarketPrice;

  /**
   * Set callback to notify the service when a new price arrives
   */
  onUpdate(callback: (price: MarketPrice) => void): void;
}
