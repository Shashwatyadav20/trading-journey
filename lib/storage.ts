import { Trade, PendingOrder } from "../types/trade";

export const STORAGE_KEY = "trading-journey-trades";
const PENDING_ORDERS_KEY = "trading-journey-pending-orders";

/**
 * Safely loads trades from browser localStorage.
 */
export function loadTradesFromStorage(): Trade[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const rawData = window.localStorage.getItem(STORAGE_KEY);
    if (!rawData) {
      return [];
    }

    const parsed = JSON.parse(rawData);
    if (Array.isArray(parsed)) {
      return parsed;
    } else {
      console.warn("Storage warning: Corrupted data format found in localStorage. Resetting.");
      return [];
    }
  } catch (error) {
    console.error("Storage error: Failed to parse trades from localStorage:", error);
    return [];
  }
}

/**
 * Safely saves trades array to browser localStorage.
 */
export function saveTradesToStorage(trades: Trade[]): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const serialized = JSON.stringify(trades);
    window.localStorage.setItem(STORAGE_KEY, serialized);
  } catch (error) {
    console.error("Storage error: Failed to save trades to localStorage:", error);
  }
}

/**
 * Removes trades key from browser localStorage.
 */
export function clearTradesStorage(): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error("Storage error: Failed to clear trades from localStorage:", error);
  }
}

/**
 * Triggers a browser JSON file download of the current trades data.
 */
export function exportTradesToFile(trades: Trade[]): void {
  if (typeof window === "undefined") return;

  try {
    const jsonStr = JSON.stringify(trades, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const todayStr = new Date().toISOString().split("T")[0];
    const link = document.createElement("a");
    link.href = url;
    link.download = `trading-journey-backup-${todayStr}.json`;

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);
  } catch (error) {
    console.error("Export error: Failed to export trades to JSON file:", error);
  }
}

/**
 * Validates parsed JSON content to ensure it matches the Trade[] schema.
 */
export function validateTradesJson(parsed: any): {
  valid: boolean;
  error?: string;
  trades?: Trade[];
} {
  if (!parsed) {
    return { valid: false, error: "File content is empty." };
  }

  if (!Array.isArray(parsed)) {
    return { valid: false, error: "Invalid backup format. File must contain a JSON array of trade objects." };
  }

  for (let i = 0; i < parsed.length; i++) {
    const item = parsed[i] as Record<string, unknown>;
    if (typeof item !== "object" || item === null) {
      return { valid: false, error: `Trade item at index ${i} is not a valid object.` };
    }

    if (!item.symbol || typeof item.symbol !== "string") {
      return { valid: false, error: `Trade item #${i + 1} is missing a valid 'symbol' string.` };
    }

    if (!item.side || (item.side !== "LONG" && item.side !== "SHORT")) {
      return { valid: false, error: `Trade item #${i + 1} (${item.symbol}) must have side 'LONG' or 'SHORT'.` };
    }

    if (typeof item.entryPrice !== "number" || isNaN(item.entryPrice)) {
      return { valid: false, error: `Trade item #${i + 1} (${item.symbol}) is missing a valid numeric 'entryPrice'.` };
    }

    if (typeof item.exitPrice !== "number" || isNaN(item.exitPrice)) {
      return { valid: false, error: `Trade item #${i + 1} (${item.symbol}) is missing a valid numeric 'exitPrice'.` };
    }

    if (typeof item.quantity !== "number" || isNaN(item.quantity)) {
      return { valid: false, error: `Trade item #${i + 1} (${item.symbol}) is missing a valid numeric 'quantity'.` };
    }
  }

  return { valid: true, trades: parsed as Trade[] };
}

// ──────────────────────────────────────────────────
//  Pending Orders localStorage
// ──────────────────────────────────────────────────

export function loadPendingOrdersFromStorage(): PendingOrder[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PENDING_ORDERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error("Failed to load pending orders from localStorage:", e);
    return [];
  }
}

export function savePendingOrdersToStorage(orders: PendingOrder[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PENDING_ORDERS_KEY, JSON.stringify(orders));
  } catch (e) {
    console.error("Failed to save pending orders to localStorage:", e);
  }
}

export function clearPendingOrdersStorage(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(PENDING_ORDERS_KEY);
  } catch (e) {
    console.error("Failed to clear pending orders storage:", e);
  }
}
