import { MarketPrice } from "./types";

type SubscriberCallback = (price: MarketPrice) => void;

export class MarketPriceStore {
  private prices: Map<string, MarketPrice> = new Map();
  private subscribers: Set<SubscriberCallback> = new Set();

  /**
   * Set or update a price and notify all subscribers
   */
  setPrice(instrument: string, price: MarketPrice): void {
    this.prices.set(instrument, price);
    this.notifySubscribers(price);
  }

  /**
   * Get the latest known price for an instrument
   */
  getPrice(instrument: string): MarketPrice | undefined {
    return this.prices.get(instrument);
  }

  /**
   * Get all current prices
   */
  getAllPrices(): MarketPrice[] {
    return Array.from(this.prices.values());
  }

  /**
   * Subscribe to all price updates
   */
  subscribe(callback: SubscriberCallback): void {
    this.subscribers.add(callback);
  }

  /**
   * Unsubscribe from price updates
   */
  unsubscribe(callback: SubscriberCallback): void {
    this.subscribers.delete(callback);
  }

  private notifySubscribers(price: MarketPrice): void {
    this.subscribers.forEach((callback) => {
      try {
        callback(price);
      } catch (err) {
        console.error("Subscriber callback threw an error:", err);
      }
    });
  }
}

// Export a singleton instance
export const priceStore = new MarketPriceStore();
