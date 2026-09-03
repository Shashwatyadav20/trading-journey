import { supabase } from "@/lib/supabase";
import { Trade, PendingOrder } from "@/types/trade";
import { ChartDrawing } from "@/types/chart";

// ──────────────────────────────────────────────────
//  HELPER: Obtain Current Authenticated Supabase User
// ──────────────────────────────────────────────────
export async function getAuthenticatedUser() {
  try {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
      const { data: sessionData } = await supabase.auth.getSession();
      const sessionUser = sessionData?.session?.user ?? null;
      console.log(`[AUTH] getAuthenticatedUser via session fallback: ${sessionUser?.id ?? 'null'}`);
      return sessionUser;
    }
    console.log(`[AUTH] getAuthenticatedUser direct: ${user.id}`);
    return user;
  } catch (err) {
    console.error("[AUTH] Failed to fetch authenticated user:", err);
    return null;
  }
}

// ──────────────────────────────────────────────────
//  TYPE MAPPERS (CamelCase UI ↔ Snake_case DB)
// ──────────────────────────────────────────────────

export function mapTradeToDb(trade: Trade, userId: string) {
  const isOpen = trade.status === "OPEN";

  return {
    id: trade.id,
    user_id: userId,
    date: trade.date,
    time: trade.time || null,
    exit_time: isOpen ? null : trade.exitTime || null,
    holding_time: isOpen ? null : trade.holdingTime || null,
    symbol: trade.symbol,
    side: trade.side,
    strategy: trade.strategy,
    entry_price: trade.entryPrice,
    stop_loss: trade.stopLoss ?? null,
    target_price: trade.targetPrice ?? null,
    exit_price: isOpen ? null : trade.exitPrice ?? null,
    quantity: trade.quantity,
    pnl: isOpen ? 0 : trade.pnl,
    fees: trade.fees ?? 0,
    r_multiple: isOpen ? 0 : trade.rMultiple,
    status: trade.status,
    order_type: trade.orderType || "MARKET",
    notes: trade.notes || null,
    mistake_tag: trade.mistakeTag || null,
    screenshot_url: trade.screenshotUrl || null,
    updated_at: new Date().toISOString(),
  };
}

export function mapDbToTrade(row: any): Trade {
  const isOpen = row.status === "OPEN";

  return {
    id: row.id,
    date: row.date,
    time: row.time || undefined,
    exitTime: row.exit_time || undefined,
    holdingTime: row.holding_time || undefined,
    symbol: row.symbol,
    side: row.side,
    strategy: row.strategy,
    entryPrice: Number(row.entry_price),
    stopLoss: row.stop_loss !== null && row.stop_loss !== undefined ? Number(row.stop_loss) : undefined,
    targetPrice: row.target_price !== null && row.target_price !== undefined ? Number(row.target_price) : undefined,
    exitPrice: !isOpen && row.exit_price !== null && row.exit_price !== undefined ? Number(row.exit_price) : Number(row.entry_price),
    quantity: Number(row.quantity),
    pnl: Number(row.pnl),
    fees: Number(row.fees ?? 0),
    rMultiple: Number(row.r_multiple),
    status: row.status,
    orderType: row.order_type || undefined,
    notes: row.notes || undefined,
    mistakeTag: row.mistake_tag || undefined,
    screenshotUrl: row.screenshot_url || undefined,
  };
}

export function mapPendingOrderToDb(order: PendingOrder, userId: string) {
  return {
    id: order.id,
    user_id: userId,
    instrument: order.instrument,
    side: order.side,
    order_type: order.orderType,
    limit_price: order.limitPrice,
    quantity: order.quantity,
    stop_loss: order.stopLoss ?? null,
    take_profit: order.takeProfit ?? null,
    strategy: order.strategy,
    created_at: order.createdAt,
    status: order.status,
    updated_at: new Date().toISOString(),
  };
}

export function mapDbToPendingOrder(row: any): PendingOrder {
  return {
    id: row.id,
    instrument: row.instrument,
    side: row.side,
    orderType: row.order_type,
    limitPrice: Number(row.limit_price),
    quantity: Number(row.quantity),
    stopLoss: row.stop_loss !== null && row.stop_loss !== undefined ? Number(row.stop_loss) : 0,
    takeProfit: row.take_profit !== null && row.take_profit !== undefined ? Number(row.take_profit) : 0,
    strategy: row.strategy,
    createdAt: row.created_at,
    status: row.status,
  };
}

export function mapDrawingToDb(drawing: ChartDrawing, userId: string) {
  return {
    id: drawing.id,
    user_id: userId,
    type: drawing.type,
    price: drawing.price,
    label: drawing.label || null,
    color: drawing.color || "#00e5ff",
    line_style: drawing.lineStyle ?? 0,
    time: drawing.time ?? null,
    end_price: drawing.endPrice ?? null,
    end_time: drawing.endTime ?? null,
    is_trade_drawing: drawing.isTradeDrawing ?? false,
    linked_trade_id: drawing.linkedTradeId ?? null,
  };
}

export function mapDbToDrawing(row: any): ChartDrawing {
  return {
    id: row.id,
    type: row.type,
    price: Number(row.price),
    label: row.label || "",
    color: row.color || "#00e5ff",
    lineStyle: Number(row.line_style ?? 0),
    time: row.time !== null && row.time !== undefined ? Number(row.time) : undefined,
    endPrice: row.end_price !== null && row.end_price !== undefined ? Number(row.end_price) : undefined,
    endTime: row.end_time !== null && row.end_time !== undefined ? Number(row.end_time) : undefined,
    isTradeDrawing: Boolean(row.is_trade_drawing),
    linkedTradeId: row.linked_trade_id || undefined,
  };
}

// ──────────────────────────────────────────────────
//  SUPABASE CLOUD QUERY API
// ──────────────────────────────────────────────────

export async function fetchTradesCloud(providedUserId?: string): Promise<{ trades: Trade[]; error: string | null }> {
  console.log("[CLOUD] fetchTradesCloud calling...");
  const user = providedUserId ? { id: providedUserId } : await getAuthenticatedUser();
  if (!user || !user.id) {
    console.warn("[CLOUD] fetchTradesCloud: Unauthenticated user session");
    return { trades: [], error: "Unauthenticated user" };
  }

  console.log(`[CLOUD] fetching trades for user_id = ${user.id}`);
  const { data, error, status } = await supabase
    .from("trades")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  console.log(`[CLOUD] Supabase select status: ${status}, rows count: ${data ? data.length : 0}`);

  if (error) {
    console.error("[CLOUD] fetchTradesCloud Error:", { code: error.code, message: error.message, status });
    return { trades: [], error: `Supabase Error (${error.code}): ${error.message}` };
  }

  const trades = (data || []).map(mapDbToTrade);
  console.log(`[CLOUD] fetched trades count: ${trades.length}`);
  return { trades, error: null };
}

export async function upsertTradeCloud(trade: Trade, providedUserId?: string): Promise<{ success: boolean; error: string | null }> {
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  const userId = user?.id || providedUserId || "";
  const dbPayload = mapTradeToDb(trade, userId);

  console.log("[RLS DEBUG] user comparison", {
    authenticatedUserId: user?.id,
    payloadUserId: dbPayload.user_id,
    matches: user?.id === dbPayload.user_id,
  });

  const { data: sessionData } = await supabase.auth.getSession();

  console.log("[RLS DEBUG] session", {
    sessionUserId: sessionData.session?.user?.id,
    accessTokenExists: !!sessionData.session?.access_token,
  });

  console.log("[SUPABASE WRITE DEBUG]", {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    userId: user?.id,
    userEmail: user?.email,
    authError,
    tradeId: trade.id,
    dbPayload,
  });

  if (!userId) {
    const errMsg = "Cannot save trade: Authenticated Supabase user is missing.";
    console.error("[SUPABASE WRITE ERROR]", errMsg);
    return { success: false, error: errMsg };
  }

  const { data, error, status, statusText } = await supabase
    .from("trades")
    .upsert(dbPayload, { onConflict: "id" })
    .select();

  console.log("[SUPABASE WRITE RESULT]", {
    data,
    error,
    status,
    statusText,
    errorCode: error?.code,
    errorMessage: error?.message,
    errorDetails: error?.details,
    errorHint: error?.hint,
  });

  if (error) {
    console.error("[SUPABASE WRITE FAILED]", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
    return { success: false, error: `Supabase Error (${error.code}): ${error.message}` };
  }

  const { data: verifyData, error: verifyError } = await supabase
    .from("trades")
    .select("*")
    .eq("id", trade.id)
    .maybeSingle();

  console.log("[SUPABASE VERIFY]", {
    verifyData,
    verifyError,
  });

  return { success: true, error: null };
}

export async function deleteTradeCloud(tradeId: string, providedUserId?: string): Promise<{ success: boolean; error: string | null }> {
  const user = providedUserId ? { id: providedUserId } : await getAuthenticatedUser();
  if (!user || !user.id) return { success: false, error: "Unauthenticated" };

  const { error } = await supabase
    .from("trades")
    .delete()
    .eq("id", tradeId)
    .eq("user_id", user.id);

  if (error) {
    console.error("[CLOUD] deleteTradeCloud Error:", error);
    return { success: false, error: error.message };
  }

  return { success: true, error: null };
}

export async function fetchPendingOrdersCloud(providedUserId?: string): Promise<PendingOrder[]> {
  const user = providedUserId ? { id: providedUserId } : await getAuthenticatedUser();
  if (!user || !user.id) return [];

  const { data, error } = await supabase
    .from("pending_orders")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[CLOUD] fetchPendingOrdersCloud Error:", error.message);
    return [];
  }

  return (data || []).map(mapDbToPendingOrder);
}

export async function upsertPendingOrderCloud(
  order: PendingOrder,
  providedUserId?: string
): Promise<{ success: boolean; error: string | null }> {
  const user = providedUserId ? { id: providedUserId } : await getAuthenticatedUser();
  if (!user || !user.id) return { success: false, error: "Unauthenticated" };

  const dbData = mapPendingOrderToDb(order, user.id);
  const { error } = await supabase
    .from("pending_orders")
    .upsert(dbData, { onConflict: "id" })
    .select();

  if (error) {
    console.error("[CLOUD] upsertPendingOrderCloud Error:", error.message);
    return { success: false, error: error.message };
  }

  return { success: true, error: null };
}

export async function deletePendingOrderCloud(
  orderId: string,
  providedUserId?: string
): Promise<{ success: boolean; error: string | null }> {
  const user = providedUserId ? { id: providedUserId } : await getAuthenticatedUser();
  if (!user || !user.id) return { success: false, error: "Unauthenticated" };

  const { error } = await supabase
    .from("pending_orders")
    .delete()
    .eq("id", orderId)
    .eq("user_id", user.id);

  if (error) {
    console.error("[CLOUD] deletePendingOrderCloud Error:", error.message);
    return { success: false, error: error.message };
  }

  return { success: true, error: null };
}

export async function fetchDrawingsCloud(providedUserId?: string): Promise<ChartDrawing[]> {
  const user = providedUserId ? { id: providedUserId } : await getAuthenticatedUser();
  if (!user || !user.id) return [];

  const { data, error } = await supabase
    .from("drawings")
    .select("*")
    .eq("user_id", user.id);

  if (error) {
    console.error("[CLOUD] fetchDrawingsCloud Error:", error.message);
    return [];
  }

  return (data || []).map(mapDbToDrawing);
}

export async function upsertDrawingCloud(
  drawing: ChartDrawing,
  providedUserId?: string
): Promise<void> {
  const user = providedUserId ? { id: providedUserId } : await getAuthenticatedUser();
  if (!user || !user.id) return;

  const dbData = mapDrawingToDb(drawing, user.id);
  const { error } = await supabase.from("drawings").upsert(dbData, { onConflict: "id" });

  if (error) {
    console.error("[CLOUD] upsertDrawingCloud Error:", error.message);
  }
}

export async function deleteDrawingCloud(
  drawingId: string,
  providedUserId?: string
): Promise<void> {
  const user = providedUserId ? { id: providedUserId } : await getAuthenticatedUser();
  if (!user || !user.id) return;

  const { error } = await supabase
    .from("drawings")
    .delete()
    .eq("id", drawingId)
    .eq("user_id", user.id);

  if (error) {
    console.error("[CLOUD] deleteDrawingCloud Error:", error.message);
  }
}

export async function fetchAccountCloud(providedUserId?: string): Promise<number | null> {
  const user = providedUserId ? { id: providedUserId } : await getAuthenticatedUser();
  if (!user || !user.id) return null;

  const { data, error } = await supabase
    .from("account")
    .select("starting_capital")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("[CLOUD] fetchAccountCloud Error:", error.message);
    return null;
  }

  return data ? Number(data.starting_capital) : null;
}

export async function updateAccountCloud(
  startingCapital: number,
  providedUserId?: string
): Promise<void> {
  const user = providedUserId ? { id: providedUserId } : await getAuthenticatedUser();
  if (!user || !user.id) return;

  const { error } = await supabase.from("account").upsert(
    {
      user_id: user.id,
      starting_capital: startingCapital,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  if (error) {
    console.error("[CLOUD] updateAccountCloud Error:", error.message);
  }
}
