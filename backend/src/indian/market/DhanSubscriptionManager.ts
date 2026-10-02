import { DhanSubscriptionRecord } from "../types";
import { instrumentMasterResolver } from "../broker/InstrumentMasterResolver";

export class DhanSubscriptionManager {
  private subscriptions: Map<string, DhanSubscriptionRecord> = new Map();

  public subscribeInstrument(
    securityId: number | string,
    exchangeSegment: string = "NSE_FNO",
    instrumentName: string = "NIFTY_OPTION",
    subscriptionMode: "TICKER" | "QUOTE" | "FULL" = "QUOTE"
  ): boolean {
    const secIdStr = String(securityId).trim();
    if (!secIdStr) return false;

    // Check if subscription already exists to prevent duplicates
    if (this.subscriptions.has(secIdStr)) {
      const existing = this.subscriptions.get(secIdStr)!;
      existing.subscriptionMode = subscriptionMode;
      return false; // Already subscribed
    }

    const record: DhanSubscriptionRecord = {
      securityId: secIdStr,
      exchangeSegment,
      instrument: instrumentName,
      subscriptionMode,
      subscriptionTime: new Date().toISOString(),
      lastPacketTime: null,
      packetCount: 0,
    };

    this.subscriptions.set(secIdStr, record);
    return true;
  }

  public unsubscribeInstrument(securityId: number | string): boolean {
    const secIdStr = String(securityId).trim();
    return this.subscriptions.delete(secIdStr);
  }

  public subscribeMany(
    instruments: Array<{
      securityId: number | string;
      exchangeSegment?: string;
      instrumentName?: string;
      subscriptionMode?: "TICKER" | "QUOTE" | "FULL";
    }>
  ): number {
    let added = 0;
    for (const inst of instruments) {
      if (
        this.subscribeInstrument(
          inst.securityId,
          inst.exchangeSegment ?? "NSE_FNO",
          inst.instrumentName ?? "NIFTY_OPTION",
          inst.subscriptionMode ?? "QUOTE"
        )
      ) {
        added++;
      }
    }
    return added;
  }

  public unsubscribeMany(securityIds: Array<number | string>): number {
    let removed = 0;
    for (const id of securityIds) {
      if (this.unsubscribeInstrument(id)) {
        removed++;
      }
    }
    return removed;
  }

  public recordPacket(securityId: number | string): void {
    const secIdStr = String(securityId).trim();
    const sub = this.subscriptions.get(secIdStr);
    if (sub) {
      sub.lastPacketTime = new Date().toISOString();
      sub.packetCount++;
    }
  }

  public hasSubscription(securityId: number | string): boolean {
    return this.subscriptions.has(String(securityId).trim());
  }

  public getSubscription(securityId: number | string): DhanSubscriptionRecord | undefined {
    return this.subscriptions.get(String(securityId).trim());
  }

  public getSubscriptions(): DhanSubscriptionRecord[] {
    return Array.from(this.subscriptions.values());
  }

  public getSubscriptionCount(): number {
    return this.subscriptions.size;
  }

  public clear(): void {
    this.subscriptions.clear();
  }
}

export const dhanSubscriptionManager = new DhanSubscriptionManager();
