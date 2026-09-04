import { getAdminSupabaseClient } from "./supabaseClient";
import { PendingOrder, Position } from "../trading/types";

// DB Row Type based on existing schema
export interface PendingOrderRow {
  id: string;
  user_id: string;
  instrument: string;
  side: "LONG" | "SHORT";
  order_type: "Limit";
  limit_price: number;
  quantity: number;
  stop_loss: number | null;
  take_profit: number | null;
  strategy: string;
  status: "PENDING" | "FILLED" | "CANCELLED";
  created_at: string;
  updated_at: string;
}

export class PendingOrderRepository {
  /**
   * Maps a backend PendingOrder to a database PendingOrderRow.
   */
  static mapToRow(order: PendingOrder): Partial<PendingOrderRow> {
    return {
      id: order.id,
      user_id: order.userId,
      instrument: order.instrument,
      side: order.side,
      order_type: "Limit",
      limit_price: order.limitPrice,
      quantity: order.quantity,
      stop_loss: order.stopLoss ?? null,
      take_profit: order.takeProfit ?? null,
      strategy: order.strategy || "Paper Trade",
      status: order.status,
      created_at: order.createdAt,
      updated_at: order.updatedAt,
    };
  }

  /**
   * Maps a database PendingOrderRow back to a backend PendingOrder.
   */
  static mapToPendingOrder(row: PendingOrderRow): PendingOrder {
    return {
      id: row.id,
      userId: row.user_id,
      instrument: row.instrument as any,
      side: row.side,
      quantity: row.quantity,
      limitPrice: row.limit_price,
      stopLoss: row.stop_loss,
      takeProfit: row.take_profit,
      strategy: row.strategy,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      // Note: filledAt and positionId are not in the DB schema yet,
      // so they are intentionally omitted here.
    };
  }

  /**
   * Find all pending orders for a specific verified user.
   */
  async findByUserId(userId: string): Promise<PendingOrder[]> {
    const supabase = getAdminSupabaseClient();
    const { data, error } = await supabase
      .from("pending_orders")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "PENDING");

    if (error) throw new Error(`Failed to find pending orders: ${error.message}`);
    return (data as PendingOrderRow[]).map(PendingOrderRepository.mapToPendingOrder);
  }

  /**
   * Find ALL pending orders across all users for startup recovery.
   * Uses the admin service-role key — backend-only, never exposed to clients.
   * Called once at server startup before market tick processing begins.
   */
  async findAllPendingOrders(): Promise<PendingOrder[]> {
    const supabase = getAdminSupabaseClient();
    const { data, error } = await supabase
      .from("pending_orders")
      .select("*")
      .eq("status", "PENDING");

    if (error) throw new Error(`Startup recovery failed — could not load pending orders: ${error.message}`);
    return (data as PendingOrderRow[]).map(PendingOrderRepository.mapToPendingOrder);
  }

  /**
   * Find a specific pending order by ID, explicitly scoped to the verified user.
   */
  async findById(userId: string, id: string): Promise<PendingOrder | null> {
    const supabase = getAdminSupabaseClient();
    const { data, error } = await supabase
      .from("pending_orders")
      .select("*")
      .eq("user_id", userId)
      .eq("id", id)
      .maybeSingle();

    if (error) throw new Error(`Failed to find pending order: ${error.message}`);
    if (!data) return null;
    return PendingOrderRepository.mapToPendingOrder(data as PendingOrderRow);
  }

  /**
   * Insert a new pending order, explicitly enforcing the verified user ID.
   */
  async insert(userId: string, order: PendingOrder): Promise<void> {
    if (order.userId !== userId) {
      throw new Error("Cannot insert order for a different user.");
    }

    const row = PendingOrderRepository.mapToRow(order);
    
    // Explicitly enforce user_id
    row.user_id = userId;

    const supabase = getAdminSupabaseClient();
    const { error } = await supabase
      .from("pending_orders")
      // @ts-ignore
      .insert(row);

    if (error) throw new Error(`Failed to insert pending order: ${error.message}`);
  }

  /**
   * Update an existing pending order, explicitly scoped to the verified user.
   */
  async update(userId: string, order: PendingOrder): Promise<void> {
    if (order.userId !== userId) {
      throw new Error("Cannot update order for a different user.");
    }

    const row = PendingOrderRepository.mapToRow(order);
    
    // Delete immutable fields
    delete row.id;
    delete row.user_id;
    delete row.created_at;

    const supabase = getAdminSupabaseClient();
    const { error } = await supabase
      .from("pending_orders")
      // @ts-ignore
      .update(row)
      .eq("user_id", userId)
      .eq("id", order.id);

    if (error) throw new Error(`Failed to update pending order: ${error.message}`);
  }

  /**
   * Safely cancel a pending order using userId ownership and conditional status check.
   */
  async cancel(userId: string, order: PendingOrder): Promise<void> {
    if (order.userId !== userId) {
      throw new Error("Cannot cancel order for a different user.");
    }

    const cancelOrder = { ...order, status: "CANCELLED" as const, updatedAt: new Date().toISOString() };
    const row = PendingOrderRepository.mapToRow(cancelOrder);
    
    delete row.id;
    delete row.user_id;
    delete row.created_at;

    const supabase = getAdminSupabaseClient();
    const { data, error } = await supabase
      .from("pending_orders")
      // @ts-ignore
      .update(row)
      .eq("user_id", userId)
      .eq("id", order.id)
      .eq("status", "PENDING")
      .select();

    if (error) throw new Error(`Failed to cancel pending order: ${error.message}`);
    if (data && Array.isArray(data) && data.length === 0) {
      throw new Error("Order is not in PENDING state or already cancelled/filled.");
    }
  }

  /**
   * Mark a pending order as filled using userId ownership and conditional status check.
   */
  async fill(userId: string, order: PendingOrder): Promise<void> {
    if (order.userId !== userId) {
      throw new Error("Cannot fill order for a different user.");
    }

    const fillOrder = { ...order, status: "FILLED" as const, updatedAt: new Date().toISOString() };
    const row = PendingOrderRepository.mapToRow(fillOrder);
    
    delete row.id;
    delete row.user_id;
    delete row.created_at;

    const supabase = getAdminSupabaseClient();
    const { data, error } = await supabase
      .from("pending_orders")
      // @ts-ignore
      .update(row)
      .eq("user_id", userId)
      .eq("id", order.id)
      .eq("status", "PENDING")
      .select();

    if (error) throw new Error(`Failed to fill pending order: ${error.message}`);
    if (data && Array.isArray(data) && data.length === 0) {
      throw new Error("Order is not in PENDING state or already cancelled/filled.");
    }
  }

  /**
   * Atomically fill a pending order and create the corresponding trade in a single transaction.
   * Uses PostgreSQL RPC 'fill_pending_order_and_create_trade' when available,
   * with conditional fallback for test/mock environments.
   */
  async atomicFillAndCreateTrade(
    userId: string,
    order: PendingOrder,
    position: Position
  ): Promise<boolean> {
    if (order.userId !== userId || position.userId !== userId) {
      throw new Error("Cannot fill order for a different user.");
    }

    const supabase = getAdminSupabaseClient();
    const { TradeRepository } = await import("./TradeRepository");
    const tradeRow = TradeRepository.mapToRow(position);
    tradeRow.user_id = userId;

    const params = {
      p_order_id: order.id,
      p_user_id: userId,
      p_trade_id: position.id,
      p_date: tradeRow.date,
      p_time: tradeRow.time,
      p_symbol: tradeRow.symbol,
      p_side: tradeRow.side,
      p_strategy: tradeRow.strategy,
      p_entry_price: tradeRow.entry_price,
      p_stop_loss: tradeRow.stop_loss,
      p_target_price: tradeRow.target_price,
      p_quantity: tradeRow.quantity,
      p_order_type: tradeRow.order_type,
      p_created_at: tradeRow.created_at,
      p_updated_at: tradeRow.updated_at,
      p_fees: tradeRow.fees ?? 0,
      p_r_multiple: tradeRow.r_multiple ?? null,
    };

    // 1. Try PostgreSQL RPC if available
    if (typeof (supabase as any).rpc === "function") {
      try {
        // @ts-ignore
        const { data, error } = await supabase.rpc("fill_pending_order_and_create_trade", params);
        if (!error && typeof data === "boolean") {
          return data;
        }
      } catch {
        // Fall back if RPC call is not supported by mock client
      }
    }

    // 2. Fallback: Conditional update + trade insert
    const fillOrder = { ...order, status: "FILLED" as const, updatedAt: new Date().toISOString() };
    const orderRow = PendingOrderRepository.mapToRow(fillOrder);
    delete orderRow.id;
    delete orderRow.user_id;
    delete orderRow.created_at;

    const { data: updateData, error: updateErr } = await supabase
      .from("pending_orders")
      // @ts-ignore
      .update(orderRow)
      .eq("id", order.id)
      .eq("user_id", userId)
      .eq("status", "PENDING")
      .select();

    if (updateErr) throw new Error(`Failed to fill pending order: ${updateErr.message}`);
    if (updateData && Array.isArray(updateData) && updateData.length === 0) {
      return false; // Order was already FILLED or CANCELLED
    }

    const { error: insertErr } = await supabase
      .from("trades")
      // @ts-ignore
      .insert(tradeRow);

    if (insertErr) {
      // Rollback order status back to PENDING on trade insert failure
      await supabase
        .from("pending_orders")
        // @ts-ignore
        .update({ status: "PENDING", updated_at: new Date().toISOString() })
        .eq("id", order.id)
        .eq("user_id", userId);

      throw new Error(`Failed to insert filled pending order trade: ${insertErr.message}`);
    }

    return true;
  }
}

export const pendingOrderRepository = new PendingOrderRepository();

