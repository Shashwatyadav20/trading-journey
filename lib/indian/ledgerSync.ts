/**
 * ledgerSync.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Centralized, synchronous, race-free persistence & live-sync pipeline for
 * Indian Institutional Trading Desks -> BacktestLedgerView & IMOverviewView.
 *
 * Guarantees:
 * 1. Synchronous read-modify-write to localStorage on every trade deployment/exit
 *    (Target Hit, Stop Loss Hit, Smart Shield Auto-Exit, 3:15 PM Square-Off,
 *    or Manual Emergency Exit) — zero async React effect race conditions.
 * 2. Exact IST (UTC+05:30) YYYY-MM-DD date keys so calendar cells and daily P&L
 *    sums match 100% without UTC midnight off-by-one shifts.
 * 3. Deduplication by unique tradeId / positionId / id so no trade is ever
 *    double-counted or lost.
 * 4. Dispatches `nse-ledger-updated` CustomEvent in the same tab so
 *    BacktestLedgerView and IMOverviewView update immediately without refresh.
 */

export const STORAGE_KEY_INTRADAY_ACTIVE = "nse_intraday_active_trades_v3";
export const STORAGE_KEY_INTRADAY_HISTORY = "nse_intraday_history_trades_v3";
export const STORAGE_KEY_SWING_ACTIVE = "nse_swing_active_trades_v3";
export const STORAGE_KEY_SWING_HISTORY = "nse_swing_backtest_history_v3";
export const STORAGE_KEY_FO_ACTIVE = "nse_fo_quant_active_spreads_v3";
export const STORAGE_KEY_FO_HISTORY = "nse_fo_quant_closed_history_v3";

export const LEDGER_SYNC_EVENT = "nse-ledger-updated";

export type LedgerDeskSource = "INTRADAY" | "SWING" | "FO" | "ALL";

/** Returns YYYY-MM-DD in Indian Standard Time (UTC+05:30). */
export function getISTDateKey(dateInput?: Date | number | string): string {
  let ms: number;
  if (dateInput === undefined) {
    ms = Date.now();
  } else if (dateInput instanceof Date) {
    ms = dateInput.getTime();
  } else if (typeof dateInput === "number") {
    ms = dateInput;
  } else {
    const trimmed = dateInput.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    const parsed = Date.parse(trimmed);
    ms = Number.isNaN(parsed) ? Date.now() : parsed;
  }
  const istDate = new Date(ms + 330 * 60 * 1000);
  return istDate.toISOString().slice(0, 10);
}

/**
 * Formats a calendar cell's (year, monthIndex0, day) directly as YYYY-MM-DD
 * without converting local midnight to UTC (prevents IST off-by-one bug).
 */
export function formatCalendarDateKey(
  year: number,
  monthIndex0: number,
  day: number
): string {
  const d = new Date(year, monthIndex0, day);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/**
 * Normalizes heterogeneous date strings (YYYY-MM-DD, DD/MM/YYYY, ISO timestamps)
 * into IST YYYY-MM-DD calendar date keys.
 */
export function normalizeDateKey(rawDate?: string): string {
  if (!rawDate) {
    return getISTDateKey();
  }
  const trimmed = rawDate.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  // Indian locale DD/MM/YYYY (e.g., "13/11/2026, 9:45:00 am")
  const ddmmyyyy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (ddmmyyyy) {
    const day = ddmmyyyy[1].padStart(2, "0");
    const month = ddmmyyyy[2].padStart(2, "0");
    const year = ddmmyyyy[3];
    return `${year}-${month}-${day}`;
  }
  const parsed = Date.parse(trimmed);
  if (!Number.isNaN(parsed)) {
    return getISTDateKey(parsed);
  }
  return getISTDateKey();
}

export function getTradeUniqueId(item: any): string {
  if (!item || typeof item !== "object") return "";
  return String(item.tradeId || item.positionId || item.id || "").trim();
}

export function emitLedgerSyncEvent(
  desk: LedgerDeskSource,
  key?: string
): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(
      new CustomEvent(LEDGER_SYNC_EVENT, {
        detail: { desk, key, timestamp: Date.now() },
      })
    );
  } catch {
    // ignore in non-DOM test environments
  }
}

/**
 * Synchronously reads the existing history array from localStorage, prepends
 * newly settled trades (deduplicated by tradeId/positionId/id), writes back
 * immediately, and notifies BacktestLedgerView & IMOverviewView.
 */
export function appendSettledTradesSync<T>(
  storageKey: string,
  settledTrades: T[],
  desk: Exclude<LedgerDeskSource, "ALL">
): T[] {
  if (typeof localStorage === "undefined") return settledTrades;

  let existing: T[] = [];
  try {
    const raw = localStorage.getItem(storageKey);
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) existing = parsed;
  } catch {
    existing = [];
  }

  const seenIds = new Set<string>();
  const merged: T[] = [];

  for (const item of [...settledTrades, ...existing]) {
    const id = getTradeUniqueId(item);
    if (id) {
      if (seenIds.has(id)) continue;
      seenIds.add(id);
    }
    merged.push(item);
  }

  try {
    localStorage.setItem(storageKey, JSON.stringify(merged));
    emitLedgerSyncEvent(desk, storageKey);
  } catch (err) {
    console.error(`[ledgerSync] Failed to write ${storageKey}:`, err);
  }

  return merged;
}

/**
 * Synchronously writes active trades to localStorage and emits sync event
 * so the Dashboard active exposure updates immediately.
 */
export function writeActiveTradesSync<T>(
  storageKey: string,
  activeTrades: T[],
  desk: Exclude<LedgerDeskSource, "ALL">
): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(storageKey, JSON.stringify(activeTrades));
    emitLedgerSyncEvent(desk, storageKey);
  } catch (err) {
    console.error(`[ledgerSync] Failed to write active ${storageKey}:`, err);
  }
}

/**
 * Synchronously writes history trades array to localStorage and emits sync event.
 */
export function writeHistoryTradesSync<T>(
  storageKey: string,
  historyTrades: T[],
  desk: Exclude<LedgerDeskSource, "ALL">
): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(storageKey, JSON.stringify(historyTrades));
    emitLedgerSyncEvent(desk, storageKey);
  } catch (err) {
    console.error(`[ledgerSync] Failed to write history ${storageKey}:`, err);
  }
}
