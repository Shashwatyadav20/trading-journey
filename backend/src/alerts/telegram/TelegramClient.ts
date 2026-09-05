/**
 * TelegramClient
 * ==============
 * Focused backend client for Telegram Bot API sendMessage.
 *
 * Security rules (MUST NOT violate):
 *   - TELEGRAM_BOT_TOKEN is read ONLY from process.env at call time.
 *   - The token is NEVER logged, included in error messages returned to
 *     callers, or exposed in any API response.
 *   - TELEGRAM_CHAT_ID is never exposed in API responses.
 *   - Credentials are never accepted as function arguments so they cannot
 *     accidentally be passed from user-supplied input.
 *
 * Reliability rules:
 *   - Never throws — all failure paths return { sent: false, error }.
 *   - Applies a 10-second fetch timeout so Telegram outages cannot stall
 *     the market-data processing pipeline.
 *   - Handles: missing env vars, HTTP failure, non-2xx status,
 *     Telegram ok=false, and network-level errors.
 */

const TELEGRAM_API_TIMEOUT_MS = 10_000;

export interface TelegramSendResult {
  sent: boolean;
  error?: string;
}

/**
 * Returns true if both TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set
 * in the environment. Does NOT expose the values.
 */
export function isTelegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

/**
 * Sends a plain-text message to the configured Telegram chat.
 *
 * @param text - The message body to send. Must not contain the bot token.
 * @returns TelegramSendResult — never throws.
 */
export async function sendTelegramMessage(text: string): Promise<TelegramSendResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  // ── Dry-run mode: credentials not configured ──────────────────────────────
  if (!token || !chatId) {
    console.log('[TelegramClient] (Dry-Run) Credentials not configured. Alert would send:\n' + text);
    return { sent: false, error: 'Telegram credentials not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID).' };
  }

  // Build URL in a way that keeps the token out of any logs that might
  // capture the full request URL at the application layer.
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  const body = JSON.stringify({
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TELEGRAM_API_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // ── Non-2xx HTTP status ───────────────────────────────────────────────
    if (!res.ok) {
      // Log only the HTTP status, never the request URL (which contains the token)
      console.error(`[TelegramClient] HTTP error: ${res.status} ${res.statusText}`);
      return { sent: false, error: `Telegram API HTTP error: ${res.status}` };
    }

    // ── Telegram ok=false ─────────────────────────────────────────────────
    let json: { ok: boolean; description?: string } | undefined;
    try {
      json = await res.json();
    } catch {
      console.error('[TelegramClient] Failed to parse Telegram API response JSON.');
      return { sent: false, error: 'Telegram API response parse error.' };
    }

    if (!json?.ok) {
      const desc = json?.description ?? 'unknown';
      console.error(`[TelegramClient] Telegram API returned ok=false: ${desc}`);
      return { sent: false, error: `Telegram API error: ${desc}` };
    }

    console.log('[TelegramClient] Alert delivered successfully.');
    return { sent: true };

  } catch (err: any) {
    clearTimeout(timeoutId);

    // ── Timeout ───────────────────────────────────────────────────────────
    if (err?.name === 'AbortError') {
      console.error(`[TelegramClient] Request timed out after ${TELEGRAM_API_TIMEOUT_MS}ms.`);
      return { sent: false, error: 'Telegram request timed out.' };
    }

    // ── Network / other error ─────────────────────────────────────────────
    // Log err.message only — it cannot contain the token because the token
    // is embedded in the URL, which fetch does not include in error messages.
    console.error(`[TelegramClient] Network error: ${err?.message ?? 'unknown'}`);
    return { sent: false, error: 'Telegram network error.' };
  }
}
