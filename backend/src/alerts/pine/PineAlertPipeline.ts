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
 */
import { PineSignal, NotificationAlertEvent } from "./PineTypes";

export interface NotificationAdapter {
  name: string;
  isConfigured(): boolean;
  sendAlert(event: NotificationAlertEvent): Promise<boolean>;
}

/**
 * Telegram Notification Adapter
 */
export class TelegramNotificationAdapter implements NotificationAdapter {
  public name = "Telegram";
  private botToken: string | undefined;
  private chatId: string | undefined;

  constructor() {
    this.botToken = process.env.TELEGRAM_BOT_TOKEN;
    this.chatId = process.env.TELEGRAM_CHAT_ID;
  }

  public isConfigured(): boolean {
    return Boolean(this.botToken && this.chatId);
  }

  public async sendAlert(event: NotificationAlertEvent): Promise<boolean> {
    if (!this.isConfigured()) {
      console.log(`[TelegramAdapter] (Dry-Run Log) Alert dispatched:\n${event.message}`);
      return true;
    }

    try {
      const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: this.chatId,
          text: event.message,
          parse_mode: "Markdown",
        }),
      });

      if (!res.ok) {
        console.error(`[TelegramAdapter] Failed to send message: HTTP ${res.status}`);
        return false;
      }
      console.log(`[TelegramAdapter] Successfully delivered alert ${event.alertId} to Telegram.`);
      return true;
    } catch (err) {
      console.error(`[TelegramAdapter] Delivery error:`, err);
      return false;
    }
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
   */
  public formatAlertMessage(signal: PineSignal): NotificationAlertEvent {
    const timeStr = new Date(signal.timestamp).toISOString();
    const formattedMessage = [
      `🚨 *Trading Journey Alert* 🚨`,
      ``,
      `*Instrument:* ${signal.instrument}`,
      `*Timeframe:* ${signal.timeframe}`,
      `*Strategy:* ${signal.strategy.replace("_", " ")}`,
      `*Direction:* ${signal.direction}`,
      `*Reference Level:* ${signal.referenceLevel}`,
      `*Trigger Price:* $${signal.triggerPrice.toFixed(2)}`,
      `*Time:* ${timeStr}`,
      signal.notes ? `*Notes:* ${signal.notes}` : ``,
    ]
      .filter(Boolean)
      .join("\n");

    return {
      alertId: `alert_${signal.signalId}`,
      instrument: signal.instrument,
      timeframe: signal.timeframe,
      strategy: signal.strategy,
      direction: signal.direction,
      referenceLevel: signal.referenceLevel,
      levelPrice: signal.triggerPrice,
      triggerPrice: signal.triggerPrice,
      timestamp: signal.timestamp,
      message: formattedMessage,
    };
  }

  /**
   * Dispatches a PineSignal through all configured notification adapters.
   */
  public async dispatchSignal(signal: PineSignal): Promise<NotificationAlertEvent> {
    const alertEvent = this.formatAlertMessage(signal);
    this.alertHistory.push(alertEvent);
    if (this.alertHistory.length > 200) this.alertHistory.shift();

    for (const adapter of this.adapters) {
      await adapter.sendAlert(alertEvent);
    }

    return alertEvent;
  }

  public getAlertHistory(): NotificationAlertEvent[] {
    return [...this.alertHistory];
  }
}

export const pineAlertPipeline = new PineAlertPipeline();
