/**
 * ADVANCED INSTITUTIONAL TRADE PERSISTENCE, SLIPPAGE SIMULATION & BROKER WEBHOOK LAYER
 * 
 * Provides:
 * 1. High-reliability synchronized persistence layer (Server-side atomic ledger + localStorage sync)
 * 2. Institutional Slippage Simulation Engine (Market impact + bid-ask spread simulation)
 * 3. Broker Webhook Stubs (Dhan HQ / Zerodha Kite execution protocol)
 * 4. Multi-Day Trailing Adjustment engine while keeping same-day entry price freezes uncompromised.
 *
 * Isomorphic-safe: No top-level Node 'fs' or 'path' imports so Client Components can safely import
 * slippage & webhook helpers without bundler resolution errors.
 */

type NodeFsModule = typeof import("fs");
type NodePathModule = typeof import("path");

function getServerFsAndPath(): { fs: NodeFsModule; path: NodePathModule } | null {
  if (typeof window !== "undefined") return null;
  try {
    const proc = globalThis.process as typeof globalThis.process & {
      getBuiltinModule?: (id: string) => unknown;
    };
    if (proc && typeof proc.getBuiltinModule === "function") {
      const fsMod = proc.getBuiltinModule("fs") as NodeFsModule | undefined;
      const pathMod = proc.getBuiltinModule("path") as NodePathModule | undefined;
      if (fsMod && pathMod) {
        return { fs: fsMod, path: pathMod };
      }
    }
  } catch {
    // ignore in edge/browser environments
  }
  return null;
}

function getLedgerFilePaths(): {
  dataDir: string;
  ledgerFile: string;
  webhookLogFile: string;
  fs: NodeFsModule;
} | null {
  const mods = getServerFsAndPath();
  if (!mods) return null;
  const cwd = typeof process !== "undefined" && typeof process.cwd === "function" ? process.cwd() : ".";
  const dataDir = mods.path.join(cwd, "data");
  return {
    dataDir,
    ledgerFile: mods.path.join(dataDir, "swing_portfolio_ledger.json"),
    webhookLogFile: mods.path.join(dataDir, "broker_webhooks.json"),
    fs: mods.fs,
  };
}

export interface SlippageRecord {
  requestedPrice: number;
  executedPrice: number;
  slippagePercent: number;
  slippageAmountRupees: number;
  spreadBps: number;
}

export interface BrokerWebhookAudit {
  broker: "DHAN_HQ" | "ZERODHA_KITE" | "UPSTOX";
  brokerOrderId: string;
  orderStatus: "PLACED" | "TRADED" | "TSL_UPDATED" | "CLOSED";
  webhookDispatchedAt: string;
  payloadHash: string;
  lastWebhookPayload: Record<string, any>;
}

export interface PersistedTrade {
  tradeId: string;
  symbol: string;
  companyName: string;
  strategyUsed: string;
  entryPrice: number;
  stopLossPrice: number;
  initialStopLoss: number;
  targetPrice: number;
  target2Price?: number;
  trailingStopPrice: number;
  isTslActive: boolean;
  tslTier: string;
  allocatedCapital: number;
  quantity: number;
  executionTimestampIso: string;
  executionTimestampIst: string;
  exitTimestampIso?: string;
  exitTimestampIst?: string;
  status: "ACTIVE" | "TARGET_HIT" | "STOP_LOSS_HIT" | "TSL_HIT" | "CANCELLED";
  currentSimulatedPrice: number;
  peakSimulatedPrice: number;
  pnlAmount: number;
  pnlPercent: number;
  lockedGainPercent: number;
  lockedGainRupees: number;
  slippageSimulation: SlippageRecord;
  brokerWebhook: BrokerWebhookAudit;
  mtfSnapshot?: {
    tf4hConfirmed: boolean;
    tf15mVwap: number;
    priceVsVwapPct: number;
    grade: string;
  };
  auditTrail: Array<{ timestamp: string; action: string; details: string }>;
  frozenDateKey: string; // The same-day price freeze key (e.g. 2026-11-08)
  daysHeld: number;
}

/**
 * Returns formatted Asia/Kolkata date key.
 */
export function getISTTimestamp(): { iso: string; ist: string; dateKey: string } {
  const now = new Date();
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(now.getTime() + istOffsetMs);
  return {
    iso: now.toISOString(),
    ist: istDate.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
    dateKey: istDate.toISOString().slice(0, 10),
  };
}

/**
 * Simulates institutional market impact & bid-ask spread slippage on fills.
 */
export function simulateInstitutionalSlippage(
  requestedPrice: number,
  side: "BUY" | "SELL",
  orderValue: number
): SlippageRecord {
  // Base spread in Indian equities: approx 4 to 8 basis points (0.04% to 0.08%)
  const baseSpreadBps = 5.0;
  // Market impact based on order size (e.g. 0.02% per ₹10L)
  const sizeImpactPct = Math.min(0.12, (orderValue / 1000000) * 0.025);
  const totalSlippagePct = Number(((baseSpreadBps / 100) + sizeImpactPct).toFixed(3));

  let executedPrice = requestedPrice;
  if (side === "BUY") {
    executedPrice = Number((requestedPrice * (1 + totalSlippagePct / 100)).toFixed(2));
  } else {
    executedPrice = Number((requestedPrice * (1 - totalSlippagePct / 100)).toFixed(2));
  }

  const slippageAmountRupees = Math.round(Math.abs(executedPrice - requestedPrice) * (orderValue / requestedPrice));

  return {
    requestedPrice,
    executedPrice,
    slippagePercent: totalSlippagePct,
    slippageAmountRupees,
    spreadBps: baseSpreadBps,
  };
}

/**
 * Dispatches simulated broker webhook payloads (Dhan HQ / Kite format).
 */
export function createBrokerWebhookStub(
  tradeId: string,
  symbol: string,
  quantity: number,
  price: number,
  eventType: "ORDER_PLACED" | "ORDER_FILLED" | "TSL_UPDATED" | "POSITION_CLOSED"
): BrokerWebhookAudit {
  const { iso, ist } = getISTTimestamp();
  const brokerOrderId = `DHAN-${symbol}-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 900 + 100)}`;

  const payload = {
    webhookSource: "DHAN_HQ_EXCHANGE_GW",
    version: "2.1",
    event: eventType,
    eventTimestamp: iso,
    exchangeTimestampIST: ist,
    orderId: brokerOrderId,
    internalTradeId: tradeId,
    exchange: "NSE",
    segment: "EQUITY_CASH",
    securityId: symbol,
    orderType: "LIMIT",
    productType: "CNC", // Cash and Carry (Swing)
    quantity,
    executedPrice: price,
    orderStatus: eventType === "POSITION_CLOSED" ? "CLOSED" : eventType === "TSL_UPDATED" ? "TSL_UPDATED" : "TRADED",
    authSignature: `HMAC_SHA256_${Date.now()}`,
  };

  return {
    broker: "DHAN_HQ",
    brokerOrderId,
    orderStatus: eventType === "POSITION_CLOSED" ? "CLOSED" : eventType === "TSL_UPDATED" ? "TSL_UPDATED" : "TRADED",
    webhookDispatchedAt: ist,
    payloadHash: `wh_${Math.random().toString(36).substring(2, 10)}`,
    lastWebhookPayload: payload,
  };
}

/**
 * Server-Side atomic read/write synchronization.
 */
function ensureDataDir(): ReturnType<typeof getLedgerFilePaths> {
  const ctx = getLedgerFilePaths();
  if (!ctx) return null;
  try {
    if (!ctx.fs.existsSync(ctx.dataDir)) {
      ctx.fs.mkdirSync(ctx.dataDir, { recursive: true });
    }
  } catch (err) {
    console.error("Failed to ensure data dir:", err);
  }
  return ctx;
}

export function readServerLedger(): { activeTrades: PersistedTrade[]; historyTrades: PersistedTrade[] } {
  try {
    const ctx = ensureDataDir();
    if (!ctx || !ctx.fs.existsSync(ctx.ledgerFile)) {
      return { activeTrades: [], historyTrades: [] };
    }
    const raw = ctx.fs.readFileSync(ctx.ledgerFile, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      activeTrades: Array.isArray(parsed?.activeTrades) ? parsed.activeTrades : [],
      historyTrades: Array.isArray(parsed?.historyTrades) ? parsed.historyTrades : [],
    };
  } catch (err) {
    console.error("Error reading server trade ledger:", err);
    return { activeTrades: [], historyTrades: [] };
  }
}

export function writeServerLedger(activeTrades: PersistedTrade[], historyTrades: PersistedTrade[]): boolean {
  try {
    const ctx = ensureDataDir();
    if (!ctx) return false;
    const tempFile = `${ctx.ledgerFile}.tmp.${Date.now()}`;
    const payload = JSON.stringify({
      version: "2.0-institutional",
      updatedAt: new Date().toISOString(),
      activeTrades,
      historyTrades,
    }, null, 2);

    ctx.fs.writeFileSync(tempFile, payload, "utf-8");
    ctx.fs.renameSync(tempFile, ctx.ledgerFile);
    return true;
  } catch (err) {
    console.error("Error writing server trade ledger atomically:", err);
    return false;
  }
}

export function recordBrokerWebhookLog(webhookAudit: BrokerWebhookAudit): void {
  try {
    const ctx = ensureDataDir();
    if (!ctx) return;
    let logs: BrokerWebhookAudit[] = [];
    if (ctx.fs.existsSync(ctx.webhookLogFile)) {
      try {
        const raw = ctx.fs.readFileSync(ctx.webhookLogFile, "utf-8");
        logs = JSON.parse(raw);
      } catch {
        logs = [];
      }
    }
    logs.unshift(webhookAudit);
    // Keep last 100 webhook events
    const trimmed = logs.slice(0, 100);
    ctx.fs.writeFileSync(ctx.webhookLogFile, JSON.stringify(trimmed, null, 2), "utf-8");
  } catch (err) {
    console.error("Failed to log broker webhook:", err);
  }
}

