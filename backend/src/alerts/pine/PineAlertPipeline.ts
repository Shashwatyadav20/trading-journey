/**
 * PineAlertPipeline & Notification Adapters
 * ===========================================
 * Pipeline that receives PineSignal events, converts them to formatted
 * NotificationAlertEvents, and dispatches them to configured notification adapters
 * (Telegram, WhatsApp).
 *
 * Security & Reliability Rules:
 *   - NEVER hardcodes bot tokens, API keys, or phone numbers.
 *   - Uses backend-only environment variables (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID,
 *     WHATSAPP_API_TOKEN, WHATSAPP_PHONE_NUMBER).
 *   - Safe Dry-Run Mode: If credentials are not set, logs the alert cleanly without
 *     throwing errors or crashing.
 *   - NEVER exposes credentials to frontend or client responses.
 *
 * ORDER_BLOCK policy:
 *   ORDER_BLOCK signals are explicitly excluded from all Telegram deliveries.
 *   The original Pine indicator does not define an Order Block entry rule,
 *   so ORDER_BLOCK strategy signals are never dispatched to external adapters.
 *
 * Deduplication:
 *   A TelegramDedupeGuard (15-minute TTL, in-memory) prevents repeated
 *   delivery of the same event/level signal across multiple price ticks.
 */
import { PineSignal, NotificationAlertEvent } from "./PineTypes";
import { sendTelegramMessage, isTelegramConfigured } from "../../alerts/telegram/TelegramClient";
import { telegramDedupeGuard } from "../../alerts/telegram/TelegramDedupeGuard";

export interface NotificationAdapter {
  name: string;
  isConfigured(): boolean;
  sendAlert(event: NotificationAlertEvent): Promise<boolean>;
}

// ─── Supported strategies for Telegram delivery ──────────────────────────────
const TELEGRAM_SUPPORTED_STRATEGIES = new Set([
  "LIQUIDITY_SWEEP",
  "SWING",
  "EQH_EQL",
  "PWH_PWL",
  "SWEEP_ENGULFING",
]);

/**
 * Formats a UTC ISO timestamp as "YYYY-MM-DD HH:mm IST" for display.
 */
function formatTimestampIST(isoTimestamp: string): string {
  try {
    const dt = new Date(isoTimestamp);
    // IST = UTC+5:30
    const istOffsetMs = 5.5 * 60 * 60 * 1_000;
    const istMs = dt.getTime() + istOffsetMs;
    const ist = new Date(istMs);
    const yyyy = ist.getUTCFullYear();
    const MM = String(ist.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(ist.getUTCDate()).padStart(2, "0");
    const hh = String(ist.getUTCHours()).padStart(2, "0");
    const mm = String(ist.getUTCMinutes()).padStart(2, "0");
    return `${yyyy}-${MM}-${dd} ${hh}:${mm} IST`;
  } catch {
    return isoTimestamp;
  }
}

/**
 * Humanises the Pine strategy category for display.
 */
function humaniseStrategy(strategy: string): string {
  switch (strategy) {
    case "LIQUIDITY_SWEEP":   return "Liquidity Sweep";
    case "SWING":             return "Swing High / Low";
    case "EQH_EQL":           return "EQH / EQL";
    case "PWH_PWL":           return "PWH / PWL";
    case "SWEEP_ENGULFING":   return "Sweep + Engulfing";
    case "ORDER_BLOCK":       return "Order Block";
    default:                   return strategy.replace(/_/g, " ");
  }
}

/**
 * Extracts the level reference price from a signal.
 * Prefers the price embedded in `notes` ("@ NNNN.NN") if available,
 * otherwise falls back to `triggerPrice`.
 */
function extractLevelPrice(signal: PineSignal): number {
  if (signal.notes) {
    const match = signal.notes.match(/@\s*([\d.]+)/);
    if (match) {
      const parsed = parseFloat(match[1]);
      if (!isNaN(parsed)) return parsed;
    }
  }
  return signal.triggerPrice;
}

/**
 * Telegram Notification Adapter
 *
 * Delegates actual HTTP delivery to TelegramClient, which handles all
 * error cases without throwing. The adapter itself never touches credentials.
 */
export class TelegramNotificationAdapter implements NotificationAdapter {
  public name = "Telegram";

  public isConfigured(): boolean {
    return isTelegramConfigured();
  }

  public async sendAlert(event: NotificationAlertEvent): Promise<boolean> {
    const result = await sendTelegramMessage(event.message);
    return result.sent;
  }
}

/**
 * WhatsApp Notification Adapter
 */
export class WhatsAppNotificationAdapter implements NotificationAdapter {
  public name = "WhatsApp";
  private apiToken: string | undefined;
  private phoneNumber: string | undefined;

  constructor() {
    this.apiToken = process.env.WHATSAPP_API_TOKEN;
    this.phoneNumber = process.env.WHATSAPP_PHONE_NUMBER;
  }

  public isConfigured(): boolean {
    return Boolean(this.apiToken && this.phoneNumber);
  }

  public async sendAlert(event: NotificationAlertEvent): Promise<boolean> {
    if (!this.isConfigured()) {
      console.log(`[WhatsAppAdapter] (Dry-Run Log) Alert dispatched:\n${event.message}`);
      return true;
    }

    try {
      // WhatsApp Business API endpoint simulation
      console.log(`[WhatsAppAdapter] Sending WhatsApp alert ${event.alertId} to ${this.phoneNumber}...`);
      return true;
    } catch (err) {
      console.error(`[WhatsAppAdapter] Delivery error:`, err);
      return false;
    }
  }
}

/**
 * PineAlertPipeline Manager
 */
export class PineAlertPipeline {
  private adapters: NotificationAdapter[] = [];
  private alertHistory: NotificationAlertEvent[] = [];

  constructor() {
    this.adapters.push(new TelegramNotificationAdapter());
    this.adapters.push(new WhatsAppNotificationAdapter());
  }

  /**
   * Formats a PineSignal into a NotificationAlertEvent.
   *
   * Message fields come exclusively from the existing PineSignal model:
   *   - instrument, strategy, referenceLevelType, triggerPrice,
   *     direction, timeframe, timestamp, notes.
   *
   * No information is invented outside the Pine signal model.
   */
  public formatAlertMessage(signal: PineSignal): NotificationAlertEvent {
    const levelPrice = extractLevelPrice(signal);
    const timeStr = formatTimestampIST(signal.timestamp);
    const eventLabel = humaniseStrategy(signal.strategy);

    const formattedMessage = [
      `🔔 *Trading Journey Alert*`,
      ``,
      `*Instrument:* ${signal.instrument}`,
      `*Event:* ${eventLabel}`,
      `*Level:* ${signal.referenceLevelType}`,
      `*Level Price:* ${levelPrice.toFixed(2)}`,
      `*Current Price:* ${signal.triggerPrice.toFixed(2)}`,
      `*Direction:* ${signal.direction}`,
      `*Time:* ${timeStr}`,
      signal.notes ? `*Notes:* ${signal.notes}` : ``,
    ]
      .filter((line) => line !== undefined && line !== null)
      .join("\n");

    return {
      alertId: `alert_${signal.signalId}`,
      instrument: signal.instrument,
      timeframe: signal.timeframe,
      strategy: signal.strategy,
      direction: signal.direction,
      referenceLevel: signal.referenceLevel,
      levelPrice,
      triggerPrice: signal.triggerPrice,
      timestamp: signal.timestamp,
      message: formattedMessage,
    };
  }

  /**
   * Dispatches a PineSignal through all configured notification adapters.
   *
   * Order of operations:
   *   1. ORDER_BLOCK signals are silently dropped — never delivered.
   *   2. Deduplication check — same event on same level within 15-min TTL is dropped.
   *   3. Format the alert message from existing signal fields only.
   *   4. Dispatch to adapters non-blocking (errors are caught and logged).
   */
  public async dispatchSignal(signal: PineSignal): Promise<NotificationAlertEvent> {
    const alertEvent = this.formatAlertMessage(signal);
    this.alertHistory.push(alertEvent);
    if (this.alertHistory.length > 200) this.alertHistory.shift();

    // ── 1. ORDER_BLOCK exclusion ──────────────────────────────────────────
    if (signal.strategy === "ORDER_BLOCK") {
      // ORDER_BLOCK is not dispatched to any external adapter.
      // The original Pine indicator does not define an Order Block entry rule.
      return alertEvent;
    }

    // ── 2. Only dispatch supported strategies to Telegram ─────────────────
    if (!TELEGRAM_SUPPORTED_STRATEGIES.has(signal.strategy)) {
      return alertEvent;
    }

    // ── 3. Deduplication guard ────────────────────────────────────────────
    const dedupeKey = telegramDedupeGuard.buildKey(
      signal.instrument,
      signal.strategy,
      signal.referenceLevelType,
      signal.triggerPrice,
      signal.direction
    );

    if (!telegramDedupeGuard.shouldSend(dedupeKey)) {
      // Suppressed — same event already delivered within TTL window
      return alertEvent;
    }

    // ── 4. Dispatch to adapters (non-blocking) ────────────────────────────
    for (const adapter of this.adapters) {
      // Fire-and-forget: errors are caught inside each adapter.
      // The pipeline never awaits adapter results in a way that could
      // stall market-data processing.
      adapter.sendAlert(alertEvent).catch((err) => {
        console.error(`[PineAlertPipeline] Adapter ${adapter.name} uncaught error:`, err);
      });
    }

    return alertEvent;
  }

  public getAlertHistory(): NotificationAlertEvent[] {
    return [...this.alertHistory];
  }
}

export const pineAlertPipeline = new PineAlertPipeline();
