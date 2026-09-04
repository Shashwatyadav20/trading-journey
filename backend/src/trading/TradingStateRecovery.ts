import { tradeRepository } from "../db/TradeRepository";
import { pendingOrderRepository } from "../db/PendingOrderRepository";
import { positionStore } from "./PositionStore";
import { pendingOrderStore } from "./PendingOrderStore";

export interface RecoveryResult {
  positions: number;
  pendingOrders: number;
}

/**
 * TradingStateRecovery restores in-memory trading state from Supabase at startup.
 *
 * MUST be called BEFORE market tick processing starts (before MarketDataService.start()).
 *
 * If any database query fails, recover() throws — the caller must treat this as a
 * fatal startup error and prevent market tick processing from beginning.
 *
 * Recovery is:
 *   - Read-only: no INSERT/UPDATE/DELETE on the database
 *   - Silent: no trading events are emitted for recovered records
 *   - Idempotent: safe to call more than once; duplicate IDs are skipped
 *   - Multi-user safe: each Position/PendingOrder carries its own userId from the DB
 */
export class TradingStateRecovery {
  /**
   * Loads all OPEN positions and PENDING orders from Supabase and hydrates memory.
   *
   * @throws Error if either database query fails — callers must handle this.
   */
  async recover(): Promise<RecoveryResult> {
    // ─── Step 1: Recover OPEN positions ──────────────────────────────────────
    // findAllOpenTrades() uses the service-role admin key and filters status=OPEN.
    // Each returned Position carries its own userId from the database row,
    // preserving multi-user isolation exactly as positions were created.
    const positions = await tradeRepository.findAllOpenTrades();
    let restoredPositions = 0;

    for (const position of positions) {
      // Defensive guard: only restore OPEN positions.
      // The repository already filters this, but we guard in case of edge cases.
      if (position.status !== "OPEN") continue;

      if (!positionStore.get(position.id)) {
        positionStore.restore(position); // silent — no positionCreated event
        restoredPositions++;
      }
    }

    // ─── Step 2: Recover PENDING orders ──────────────────────────────────────
    // findAllPendingOrders() uses the service-role admin key and filters status=PENDING.
    // FILLED and CANCELLED orders are excluded at the database query level.
    const orders = await pendingOrderRepository.findAllPendingOrders();
    let restoredOrders = 0;

    for (const order of orders) {
      // Defensive guard: only restore PENDING orders.
      if (order.status !== "PENDING") continue;

      if (!pendingOrderStore.get(order.id)) {
        pendingOrderStore.restore(order); // silent — no pendingOrderCreated event
        restoredOrders++;
      }
    }

    return { positions: restoredPositions, pendingOrders: restoredOrders };
  }
}

export const tradingStateRecovery = new TradingStateRecovery();
