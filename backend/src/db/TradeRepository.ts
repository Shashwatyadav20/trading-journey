import { getAdminSupabaseClient } from "./supabaseClient";
import { Position } from "../trading/types";

// DB Row Type based on existing schema
export interface TradeRow {
  id: string;
  user_id: string;
  date: string;
  time: string;
  exit_time: string | null;
  holding_time: string | null;
  symbol: string;
  side: "LONG" | "SHORT";
  strategy: string;
  entry_price: number;
  stop_loss: number | null;
  target_price: number | null;
  exit_price: number | null;
  quantity: number;
  pnl: number | null;
  fees: number | null;
  r_multiple: number | null;
  status: "OPEN" | "WIN" | "LOSS" | "BREAKEVEN";
  order_type: string;
  notes: string | null;
  mistake_tag: string | null;
  screenshot_url: string | null;
  updated_at: string;
  created_at: string;
}

export class TradeRepository {
  /**
   * Maps a backend Position to a database TradeRow.
   */
  static mapToRow(position: Position): Partial<TradeRow> {
    const entryDate = new Date(position.entryTime);
    const date = entryDate.toISOString().split("T")[0];
    const time = entryDate.toISOString().split("T")[1].substring(0, 5); // HH:MM

    let exit_time: string | null = null;
    if (position.exitTime) {
      exit_time = new Date(position.exitTime).toISOString().split("T")[1].substring(0, 5);
    }

    let holding_time: string | null = null;
    if (position.status === "CLOSED" && position.exitTime && position.entryTime) {
      const entryMs = new Date(position.entryTime).getTime();
      const exitMs = new Date(position.exitTime).getTime();
      const diffMs = Math.max(0, exitMs - entryMs);
      const diffSec = Math.floor(diffMs / 1000);
      const mins = Math.floor(diffSec / 60);
      const secs = diffSec % 60;
      const hours = Math.floor(mins / 60);
      const remMins = mins % 60;

      if (hours > 0) {
        holding_time = `${hours}h ${remMins}m`;
      } else if (mins > 0) {
        holding_time = `${mins}m ${secs}s`;
      } else {
        holding_time = `${secs}s`;
      }
    }

    let r_multiple: number | null = null;
    if (position.status === "CLOSED" && position.exitPrice != null) {
      if (position.stopLoss != null) {
        const risk = Math.abs(position.entryPrice - position.stopLoss);
        if (risk > 0) {
          const reward = position.side === "LONG"
            ? position.exitPrice - position.entryPrice
            : position.entryPrice - position.exitPrice;
          r_multiple = Number((reward / risk).toFixed(2));
        }
      } else {
        const pnl = position.realizedPnl ?? 0;
        r_multiple = pnl > 0 ? 1 : pnl < 0 ? -1 : 0;
      }
    }

    let status: TradeRow["status"] = "OPEN";
    if (position.status === "CLOSED") {
      const pnl = position.realizedPnl || 0;
      if (pnl > 0) status = "WIN";
      else if (pnl < 0) status = "LOSS";
      else status = "BREAKEVEN";
    }
    // Note: "CLOSING" is never persisted. If it's CLOSING, it stays OPEN in DB until fully closed.

    return {
      id: position.id,
      user_id: position.userId,
      date,
      time,
      exit_time,
      holding_time,
      symbol: position.instrument,
      side: position.side,
      strategy: position.strategy || "Paper Trade",
      entry_price: position.entryPrice,
      stop_loss: position.stopLoss ?? null,
      target_price: position.takeProfit ?? null,
      exit_price: position.exitPrice ?? null,
      quantity: position.quantity,
      pnl: position.realizedPnl ?? null,
      fees: 0, // Paper trading uses 0 fees
      r_multiple,
      status,
      order_type: position.orderType || "Market",
      updated_at: position.updatedAt,
      created_at: position.createdAt,
    };
  }

  /**
   * Maps a database TradeRow back to a backend Position.
   */
  static mapToPosition(row: TradeRow): Position {
    let status: Position["status"] = "OPEN";
    if (row.status === "WIN" || row.status === "LOSS" || row.status === "BREAKEVEN") {
      status = "CLOSED";
    }

    return {
      id: row.id,
      userId: row.user_id,
      instrument: row.symbol as any,
      side: row.side,
      quantity: row.quantity,
      entryPrice: row.entry_price,
      entryTime: row.created_at,
      status,
      stopLoss: row.stop_loss,
      takeProfit: row.target_price,
      exitPrice: row.exit_price ?? undefined,
      exitTime: row.exit_time ? `${row.date}T${row.exit_time}:00.000Z` : undefined,
      realizedPnl: row.pnl ?? undefined,
      unrealizedPnl: 0,
      strategy: row.strategy,
      orderType: (row.order_type === "LIMIT" ? "LIMIT" : "Market") as "Market" | "LIMIT",
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Find all open trades for a specific verified user.
   */
  async findOpenTrades(userId: string): Promise<Position[]> {
    const supabase = getAdminSupabaseClient();
    const { data, error } = await supabase
      .from("trades")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "OPEN");

    if (error) throw new Error(`Failed to find open trades: ${error.message}`);
    return (data as TradeRow[]).map(TradeRepository.mapToPosition);
  }

  /**
   * Find ALL open trades across all users for startup recovery.
   * Uses the admin service-role key — backend-only, never exposed to clients.
   * Called once at server startup before market tick processing begins.
   */
  async findAllOpenTrades(): Promise<Position[]> {
    const supabase = getAdminSupabaseClient();
    const { data, error } = await supabase
      .from("trades")
      .select("*")
      .eq("status", "OPEN");

    if (error) throw new Error(`Startup recovery failed — could not load open trades: ${error.message}`);
    return (data as TradeRow[]).map(TradeRepository.mapToPosition);
  }

  /**
   * Find a specific trade by ID, explicitly scoped to the verified user.
   */
  async findById(userId: string, id: string): Promise<Position | null> {
    const supabase = getAdminSupabaseClient();
    const { data, error } = await supabase
      .from("trades")
      .select("*")
      .eq("user_id", userId)
      .eq("id", id)
      .maybeSingle();

    if (error) throw new Error(`Failed to find trade: ${error.message}`);
    if (!data) return null;
    return TradeRepository.mapToPosition(data as TradeRow);
  }

  /**
   * Insert a new trade, explicitly enforcing the verified user ID.
   */
  async insert(userId: string, position: Position): Promise<void> {
    if (position.userId !== userId) {
      throw new Error("Cannot insert trade for a different user.");
    }

    const row = TradeRepository.mapToRow(position);
    
    // Explicitly enforce user_id to prevent any mapping mistakes
    row.user_id = userId;

    const supabase = getAdminSupabaseClient();
    const { error } = await supabase
      .from("trades")
      // @ts-ignore
      .insert(row);

    if (error) throw new Error(`Failed to insert trade: ${error.message}`);
  }

  /**
   * Update an existing trade, explicitly scoped to the verified user.
   */
  async update(userId: string, position: Position): Promise<void> {
    if (position.userId !== userId) {
      throw new Error("Cannot update trade for a different user.");
    }

    const row = TradeRepository.mapToRow(position);
    
    // Delete immutable fields before update just in case
    delete row.id;
    delete row.user_id;
    delete row.created_at;

    const supabase = getAdminSupabaseClient();
    const { error } = await supabase
      .from("trades")
      // @ts-ignore
      .update(row)
      .eq("user_id", userId)
      .eq("id", position.id);

    if (error) throw new Error(`Failed to update trade: ${error.message}`);
  }

  /**
   * Safely close a trade using conditional status check (WHERE status = 'OPEN').
   */
  async closeTrade(userId: string, position: Position): Promise<void> {
    if (position.userId !== userId) {
      throw new Error("Cannot close trade for a different user.");
    }

    const row = TradeRepository.mapToRow(position);
    
    delete row.id;
    delete row.user_id;
    delete row.created_at;

    const supabase = getAdminSupabaseClient();
    const { data, error } = await supabase
      .from("trades")
      // @ts-ignore
      .update(row)
      .eq("user_id", userId)
      .eq("id", position.id)
      .eq("status", "OPEN")
      .select();

    if (error) throw new Error(`Failed to close trade: ${error.message}`);
    if (data && Array.isArray(data) && data.length === 0) {
      throw new Error("Trade is not in OPEN state or already closed.");
    }
  }
}

export const tradeRepository = new TradeRepository();

