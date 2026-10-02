import { DhanMarketTick } from "../types";

export type DhanConnectionState =
  | "CONNECTING"
  | "CONNECTED"
  | "HEALTHY"
  | "DEGRADED"
  | "RECONNECTING"
  | "STALE"
  | "DISCONNECTED"
  | "ERROR";

export interface DhanMarketFeedHealth {
  provider: "DHAN";
  connectionState: DhanConnectionState;
  connected: boolean;
  isHealthy: boolean;
  connectedAt: string | null;
  lastMessageAt: string | null;
  lastHeartbeatAt: string | null;
  reconnectCount: number;
  connectionErrors: number;
  subscriptionCount: number;
  lastError: string | null;
  feedLatencyMs: number | null;
  realDataOnly: boolean;
  safetyState: {
    PAPER_TRADING: boolean;
    LIVE_TRADING: boolean;
    BROKER_EXECUTION_ENABLED: boolean;
  };
}

export interface IDhanMarketFeedProvider {
  getProviderName(): string;
  getConnectionState(): DhanConnectionState;
  getHealth(): DhanMarketFeedHealth;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  subscribe(securityId: number | string, exchangeSegment?: string): Promise<boolean>;
  unsubscribe(securityId: number | string, exchangeSegment?: string): Promise<boolean>;
  subscribeMany(instruments: Array<{ securityId: number | string; exchangeSegment?: string }>): Promise<number>;
  unsubscribeMany(instruments: Array<{ securityId: number | string; exchangeSegment?: string }>): Promise<number>;
  getLatestTick(securityId: number | string): DhanMarketTick | null;
  getAllTicks(): Map<string, DhanMarketTick>;
  onTick(listener: (tick: DhanMarketTick) => void): () => void;
}
