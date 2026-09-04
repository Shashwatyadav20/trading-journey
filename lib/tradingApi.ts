import { supabase } from "@/lib/supabase";

export interface CreateOrderRequest {
  instrument: string;
  side: "BUY" | "SELL";
  quantity: number;
  stopLoss?: number | null;
  takeProfit?: number | null;
}

export interface CreateLimitOrderRequest extends CreateOrderRequest {
  limitPrice: number;
}

export class TradingAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TradingAuthError";
  }
}

/**
 * Thin API client for the backend trading engine.
 *
 * Security: Uses Authorization: Bearer <supabase_access_token>.
 * The user ID is NEVER sent by the client — it is extracted from the
 * verified JWT on the backend.
 */
export class TradingApiClient {
  private async getAuthHeaders(): Promise<HeadersInit> {
    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;

    if (!accessToken) {
      throw new TradingAuthError("No active session. Please sign in before trading.");
    }

    return {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${accessToken}`,
    };
  }

  private getBaseUrl(): string {
    return process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
  }

  async openMarketOrder(req: CreateOrderRequest) {
    const headers = await this.getAuthHeaders();
    const res = await fetch(`${this.getBaseUrl()}/trading/orders/market`, {
      method: "POST",
      headers,
      body: JSON.stringify(req),
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || "Failed to open position");
    }

    return res.json();
  }

  async openLimitOrder(req: CreateLimitOrderRequest) {
    const headers = await this.getAuthHeaders();
    const res = await fetch(`${this.getBaseUrl()}/trading/orders/limit`, {
      method: "POST",
      headers,
      body: JSON.stringify(req),
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || "Failed to create limit order");
    }

    return res.json();
  }

  async cancelLimitOrder(orderId: string) {
    const headers = await this.getAuthHeaders();
    const res = await fetch(`${this.getBaseUrl()}/trading/orders/${orderId}/cancel`, {
      method: "POST",
      headers,
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || "Failed to cancel limit order");
    }

    return res.json();
  }

  async closePosition(positionId: string) {
    const headers = await this.getAuthHeaders();
    const res = await fetch(`${this.getBaseUrl()}/trading/positions/${positionId}/close`, {
      method: "POST",
      headers,
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || "Failed to close position");
    }

    return res.json();
  }

  async getPositions() {
    const headers = await this.getAuthHeaders();
    const res = await fetch(`${this.getBaseUrl()}/trading/positions`, {
      headers,
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || "Failed to fetch positions");
    }

    return res.json();
  }

  async getPendingOrders() {
    const headers = await this.getAuthHeaders();
    const res = await fetch(`${this.getBaseUrl()}/trading/orders/pending`, {
      headers,
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || "Failed to fetch pending orders");
    }

    return res.json();
  }
}

export const tradingApi = new TradingApiClient();
