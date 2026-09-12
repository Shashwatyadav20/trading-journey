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

export interface TelegramCheckResult {
  configured: boolean;
  httpStatus?: number;
  ok?: boolean;
  description?: string;
  botUsername?: string;
  botId?: number;
  tokenDiagnostics?: {
    length: number;
    startsWithDigits: boolean;
    containsWhitespace: boolean;
    startsWithBot: boolean;
    hasSurroundingQuotes: boolean;
  };
  error?: string;
}

/**
 * Executes a diagnostic getMe call against the Telegram Bot API.
 * Never logs or exposes credentials, tokens, or chat IDs.
 */
export async function checkTelegramBot(): Promise<TelegramCheckResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return {
      configured: false,
      error: 'TELEGRAM_BOT_TOKEN is not set in environment.',
    };
  }

  const trimmedToken = token.trim();
  const tokenDiagnostics = {
    length: token.length,
    startsWithDigits: /^\d/.test(trimmedToken),
    containsWhitespace: /\s/.test(token),
    startsWithBot: /^bot/i.test(trimmedToken),
    hasSurroundingQuotes: /^['"].*['"]$/.test(token),
  };

  const url = `https://api.telegram.org/bot${trimmedToken}/getMe`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TELEGRAM_API_TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    const json: any = await res.json().catch(() => null);

    return {
      configured: true,
      httpStatus: res.status,
      ok: json?.ok ?? false,
      description: json?.description,
      botUsername: json?.result?.username,
      botId: json?.result?.id,
      tokenDiagnostics,
    };
  } catch (err: any) {
    clearTimeout(timeoutId);
    return {
      configured: true,
      tokenDiagnostics,
      error: err?.name === 'AbortError' ? 'Request timed out' : (err?.message ?? 'Network error'),
    };
  }
}

/**
 * Returns true if both TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set
 * in the environment. Does NOT expose the values.
 */
export function isTelegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

// Startup diagnostic — credentials are NEVER logged, only the boolean result.
console.log(
  `[TelegramClient] Startup check: configured=${isTelegramConfigured()} ` +
  `(TELEGRAM_BOT_TOKEN set=${Boolean(process.env.TELEGRAM_BOT_TOKEN)} ` +
  `TELEGRAM_CHAT_ID set=${Boolean(process.env.TELEGRAM_CHAT_ID)})`
);

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
  const url = `https://api.telegram.org/bot${token.trim()}/sendMessage`;

  const body = JSON.stringify({
    chat_id: chatId.trim(),
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
      let description = 'no description';
      try {
        const errJson: any = await res.json();
        if (errJson && typeof errJson.description === 'string') {
          description = errJson.description;
        }
      } catch {
        // Ignored — fallback to 'no description'
      }
      // Log only the HTTP status and safe description, never the request URL (which contains the token)
      console.error(`[TelegramClient] HTTP error: ${res.status} ${res.statusText} - ${description}`);
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
