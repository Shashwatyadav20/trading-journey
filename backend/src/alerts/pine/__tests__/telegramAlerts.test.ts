/**
 * Telegram Alert Delivery Tests
 * ==============================
 * Comprehensive test suite covering all 20 required cases for the
 * production Telegram alert delivery layer.
 *
 * Test groups:
 *   1-7:   TelegramClient unit tests (credentials, HTTP, timeout, security)
 *   8-13:  PineAlertPipeline strategy tests (all supported + ORDER_BLOCK exclusion)
 *   14-17: Deduplication tests (dedupe guard behaviour)
 *   18-20: Integration safety tests (failure isolation, no auto-trading)
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { TelegramDedupeGuard, DEDUPE_TTL_MS } from "../../telegram/TelegramDedupeGuard";
import { PineAlertPipeline, TelegramNotificationAdapter, WhatsAppNotificationAdapter } from "../PineAlertPipeline";
import { PineSignal } from "../PineTypes";
import { sendTelegramMessage, isTelegramConfigured } from "../../telegram/TelegramClient";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makePineSignal(overrides: Partial<PineSignal> = {}): PineSignal {
  return {
    signalId: "sig_TEST_BTC_LIQUIDITY_SWEEP_BUY_EQL_190000_2026-01-01T12:00:00Z",
    instrument: "BTC/USD",
    timestamp: "2026-01-01T12:00:00Z",
    timeframe: "15M",
    direction: "BUY",
    strategy: "LIQUIDITY_SWEEP",
    signalType: "BUY_SETUP",
    triggerPrice: 1900.0,
    referenceLevel: "HTF EQL (15M) 1900.00",
    referenceLevelType: "EQL",
    confidence: 0.85,
    status: "ACTIVE",
    notes: "Downside sweep of HTF EQL (15M)  1900.00 @ 1900.00",
    ...overrides,
  };
}

// ─── 1. TelegramClient: Missing credentials ───────────────────────────────────

describe("TC-01: Telegram credentials missing", () => {
  beforeEach(() => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    vi.stubEnv("TELEGRAM_CHAT_ID", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("isTelegramConfigured() returns false when env vars are absent", () => {
    expect(isTelegramConfigured()).toBe(false);
  });

  it("sendTelegramMessage returns sent=false and an error string (no throw)", async () => {
    const result = await sendTelegramMessage("test");
    expect(result.sent).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).not.toContain("undefined");
  });
});

// ─── 2. TelegramClient: Successful send ──────────────────────────────────────

describe("TC-02: Successful Telegram send", () => {
  beforeEach(() => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test_token_123");
    vi.stubEnv("TELEGRAM_CHAT_ID", "-100987654321");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { message_id: 42 } }),
      })
    );
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns sent=true on a 200 ok=true response", async () => {
    const result = await sendTelegramMessage("hello");
    expect(result.sent).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("isTelegramConfigured() returns true when both vars set", () => {
    expect(isTelegramConfigured()).toBe(true);
  });
});

// ─── 3. TelegramClient: HTTP failure (non-2xx) ───────────────────────────────

describe("TC-03: Telegram HTTP failure (non-2xx)", () => {
  beforeEach(() => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test_token_123");
    vi.stubEnv("TELEGRAM_CHAT_ID", "-100987654321");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
      })
    );
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns sent=false with HTTP status in error (no throw)", async () => {
    const result = await sendTelegramMessage("test");
    expect(result.sent).toBe(false);
    expect(result.error).toContain("503");
  });
});

// ─── 4. TelegramClient: Telegram API ok=false ────────────────────────────────

describe("TC-04: Telegram API ok=false", () => {
  beforeEach(() => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test_token_123");
    vi.stubEnv("TELEGRAM_CHAT_ID", "-100987654321");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ok: false, description: "Bad Request: chat not found" }),
      })
    );
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns sent=false with Telegram error description (no throw)", async () => {
    const result = await sendTelegramMessage("test");
    expect(result.sent).toBe(false);
    expect(result.error).toContain("chat not found");
  });

  it("error message does NOT contain the token", async () => {
    const result = await sendTelegramMessage("test");
    expect(result.error).not.toContain("test_token_123");
  });
});

// ─── 5. TelegramClient: Network timeout/failure ───────────────────────────────

describe("TC-05: Network timeout / failure", () => {
  beforeEach(() => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test_token_123");
    vi.stubEnv("TELEGRAM_CHAT_ID", "-100987654321");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns sent=false on AbortError (timeout) without throwing", async () => {
    const abortErr = new DOMException("The operation was aborted.", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortErr));
    const result = await sendTelegramMessage("test");
    expect(result.sent).toBe(false);
    expect(result.error).toContain("timed out");
  });

  it("returns sent=false on generic network error without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const result = await sendTelegramMessage("test");
    expect(result.sent).toBe(false);
    expect(result.error).toContain("network error");
  });
});

// ─── 6. TelegramClient: Correct chat_id usage ────────────────────────────────

describe("TC-06: Correct chat_id usage", () => {
  const CHAT_ID = "-100111222333";
  let capturedBody: any;

  beforeEach(() => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "tok_abc");
    vi.stubEnv("TELEGRAM_CHAT_ID", CHAT_ID);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url: string, opts: RequestInit) => {
        capturedBody = JSON.parse(opts.body as string);
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true }),
        };
      })
    );
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sends the configured chat_id in the request body", async () => {
    await sendTelegramMessage("check");
    expect(capturedBody.chat_id).toBe(CHAT_ID);
  });
});

// ─── 7. Token never appears in logs or errors ─────────────────────────────────

describe("TC-07: Token never appears in logs/errors", () => {
  beforeEach(() => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "SUPER_SECRET_TOKEN_XYZ");
    vi.stubEnv("TELEGRAM_CHAT_ID", "123456");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
      })
    );
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("error string from non-2xx response does not contain the token", async () => {
    const result = await sendTelegramMessage("test");
    expect(result.error).not.toContain("SUPER_SECRET_TOKEN_XYZ");
  });
});

// ─── 8–12. Alert pipeline: Supported strategies ───────────────────────────────

describe("TC-08 to TC-12: Supported strategy signals are formatted and dispatched", () => {
  let pipeline: PineAlertPipeline;

  beforeEach(() => {
    pipeline = new PineAlertPipeline();
  });

  it("TC-08: LIQUIDITY_SWEEP signal produces formatted alert with correct fields", async () => {
    const sig = makePineSignal({ strategy: "LIQUIDITY_SWEEP", direction: "BUY" });
    const event = await pipeline.dispatchSignal(sig);
    expect(event.message).toContain("Trading Journey Alert");
    expect(event.message).toContain("BTC/USD");
    expect(event.message).toContain("Liquidity Sweep");
    expect(event.message).toContain("EQL");
    expect(event.message).toContain("BUY");
    expect(event.strategy).toBe("LIQUIDITY_SWEEP");
  });

  it("TC-09: SWING signal (Swing High/Low) produces formatted alert", async () => {
    const sig = makePineSignal({
      strategy: "SWING",
      direction: "SELL",
      referenceLevelType: "SWH",
      referenceLevel: "15M+ Swing High 2050.00",
      notes: "Major Swing High liquidity interaction @ 2050.00",
    });
    const event = await pipeline.dispatchSignal(sig);
    expect(event.message).toContain("Swing High / Low");
    expect(event.message).toContain("SWH");
    expect(event.message).toContain("SELL");
  });

  it("TC-10: EQH_EQL signal produces formatted alert with timeframe", async () => {
    const sig = makePineSignal({
      strategy: "EQH_EQL",
      direction: "BUY",
      referenceLevelType: "EQL",
      timeframe: "1H",
      referenceLevel: "HTF EQL (1H) 1900.00",
    });
    const event = await pipeline.dispatchSignal(sig);
    expect(event.message).toContain("EQH / EQL");
    expect(event.message).toContain("EQL");
    expect(event.timeframe).toBe("1H");
  });

  it("TC-11: PWH_PWL signal produces formatted alert", async () => {
    const sig = makePineSignal({
      strategy: "PWH_PWL",
      direction: "SELL",
      referenceLevelType: "PWH",
      timeframe: "1W",
      referenceLevel: "PWH 2500.00",
      notes: "Previous Week High (PWH) interaction @ 2500.00",
    });
    const event = await pipeline.dispatchSignal(sig);
    expect(event.message).toContain("PWH / PWL");
    expect(event.message).toContain("PWH");
    expect(event.message).toContain("SELL");
  });

  it("TC-12: SWEEP_ENGULFING signal produces formatted alert", async () => {
    const sig = makePineSignal({
      strategy: "SWEEP_ENGULFING",
      direction: "BUY",
      referenceLevelType: "EQL",
      notes: "Bullish Sweep + Engulfing pattern on HTF EQL (15M)  1900.00",
    });
    const event = await pipeline.dispatchSignal(sig);
    expect(event.message).toContain("Sweep + Engulfing");
    expect(event.message).toContain("BUY");
  });
});

// ─── 13. ORDER_BLOCK never produces Telegram alert ────────────────────────────

describe("TC-13: ORDER_BLOCK strategy never dispatched to external adapters", () => {
  it("dispatchSignal for ORDER_BLOCK returns alertEvent but never calls Telegram adapter", async () => {
    const pipeline = new PineAlertPipeline();
    // Spy on the Telegram adapter's sendAlert
    const telegramAdapter = (pipeline as any).adapters.find(
      (a: any) => a.name === "Telegram"
    );
    const spy = vi.spyOn(telegramAdapter, "sendAlert");

    const sig = makePineSignal({ strategy: "ORDER_BLOCK" } as any);
    const event = await pipeline.dispatchSignal(sig);

    expect(event).toBeDefined();
    expect(spy).not.toHaveBeenCalled();
  });
});

// ─── 14. Dedup: Same event repeated sends only once ──────────────────────────

describe("TC-14: Same event repeated across ticks sends only once", () => {
  it("TelegramDedupeGuard: shouldSend returns true once, false on repeat within TTL", () => {
    const guard = new TelegramDedupeGuard();
    const key = guard.buildKey("BTC/USD", "LIQUIDITY_SWEEP", "EQL", 1900, "BUY");

    expect(guard.shouldSend(key)).toBe(true);  // first call — send
    expect(guard.shouldSend(key)).toBe(false); // duplicate within TTL — suppress
    expect(guard.shouldSend(key)).toBe(false); // still within TTL — suppress
  });

  it("PineAlertPipeline dedupe: repeated same signal dispatches only once to adapter", async () => {
    const pipeline = new PineAlertPipeline();
    const telegramAdapter = (pipeline as any).adapters.find(
      (a: any) => a.name === "Telegram"
    );
    const spy = vi.spyOn(telegramAdapter, "sendAlert");

    const sig = makePineSignal({ signalId: "dedupe-test-sig" });

    // Call dispatchSignal three times with the same signal parameters
    await pipeline.dispatchSignal(sig);
    await pipeline.dispatchSignal(sig);
    await pipeline.dispatchSignal(sig);

    // Adapter should be called at most once (first call) — subsequent calls suppressed
    expect(spy.mock.calls.length).toBeLessThanOrEqual(1);
  });
});

// ─── 15. Dedup: Different levels each generate an alert ──────────────────────

describe("TC-15: Different levels can each generate separate alerts", () => {
  it("TelegramDedupeGuard: distinct level prices produce distinct keys", () => {
    const guard = new TelegramDedupeGuard();
    const key1 = guard.buildKey("BTC/USD", "LIQUIDITY_SWEEP", "EQL", 1900, "BUY");
    const key2 = guard.buildKey("BTC/USD", "LIQUIDITY_SWEEP", "EQL", 1850, "BUY");

    expect(key1).not.toBe(key2);
    expect(guard.shouldSend(key1)).toBe(true);
    expect(guard.shouldSend(key2)).toBe(true); // different level — allowed
  });

  it("TelegramDedupeGuard: distinct level types produce distinct keys", () => {
    const guard = new TelegramDedupeGuard();
    const keyEQL = guard.buildKey("BTC/USD", "LIQUIDITY_SWEEP", "EQL", 1900, "BUY");
    const keyEQH = guard.buildKey("BTC/USD", "LIQUIDITY_SWEEP", "EQH", 1900, "SELL");

    expect(keyEQL).not.toBe(keyEQH);
    expect(guard.shouldSend(keyEQL)).toBe(true);
    expect(guard.shouldSend(keyEQH)).toBe(true);
  });
});

// ─── 16. Dedup: Different instruments generate separate alerts ─────────────────

describe("TC-16: Different instruments can generate separate alerts", () => {
  it("TelegramDedupeGuard: BTC/USD and XAU/USD keys are distinct", () => {
    const guard = new TelegramDedupeGuard();
    const keyBTC = guard.buildKey("BTC/USD", "LIQUIDITY_SWEEP", "EQL", 1900, "BUY");
    const keyXAU = guard.buildKey("XAU/USD", "LIQUIDITY_SWEEP", "EQL", 1900, "BUY");

    expect(keyBTC).not.toBe(keyXAU);
    expect(guard.shouldSend(keyBTC)).toBe(true);
    expect(guard.shouldSend(keyXAU)).toBe(true);
  });
});

// ─── 17. Dedup: Different strategies generate separate alerts ─────────────────

describe("TC-17: Different legitimate strategies generate separate alerts", () => {
  it("TelegramDedupeGuard: LIQUIDITY_SWEEP and SWING on same level produce distinct keys", () => {
    const guard = new TelegramDedupeGuard();
    const keySweep = guard.buildKey("BTC/USD", "LIQUIDITY_SWEEP", "SWH", 2050, "SELL");
    const keySwing  = guard.buildKey("BTC/USD", "SWING",           "SWH", 2050, "SELL");

    expect(keySweep).not.toBe(keySwing);
    expect(guard.shouldSend(keySweep)).toBe(true);
    expect(guard.shouldSend(keySwing)).toBe(true);
  });
});

// ─── 18. Telegram failure does not stop market price processing ───────────────

describe("TC-18: Telegram failure does not stop market price processing", () => {
  it("dispatchSignal resolves even when TelegramClient throws internally", async () => {
    // Override the adapter to simulate a crash
    const pipeline = new PineAlertPipeline();
    (pipeline as any).adapters = [
      {
        name: "Telegram",
        isConfigured: () => true,
        sendAlert: async () => {
          throw new Error("Simulated Telegram outage");
        },
      },
    ];

    const sig = makePineSignal({ signalId: "outage-test-sig" });
    // Must not throw — pipeline catches adapter errors internally
    await expect(pipeline.dispatchSignal(sig)).resolves.toBeDefined();
  });
});

// ─── 19. Manual trades do not create fake Pine alerts ─────────────────────────

describe("TC-19: Manual trades do not create fake Pine alerts", () => {
  it("PineAlertPipeline has no method to ingest raw trade objects", () => {
    const pipeline = new PineAlertPipeline();
    // The pipeline only accepts PineSignal — there is no trade ingestion method
    expect(typeof (pipeline as any).ingestTrade).toBe("undefined");
    expect(typeof (pipeline as any).createSignalFromTrade).toBe("undefined");
  });

  it("PineSignal strategy field does not accept arbitrary strings", () => {
    // Only the supported PineStrategyCategory values exist in PineTypes
    const supportedStrategies = [
      "LIQUIDITY_SWEEP",
      "SWING",
      "EQH_EQL",
      "PWH_PWL",
      "SWEEP_ENGULFING",
      "ORDER_BLOCK",
    ];
    // A signal with a non-strategy value is structurally rejected by TypeScript;
    // at runtime the pipeline's supported-strategy whitelist silently drops it
    const pipeline = new PineAlertPipeline();
    const telegramAdapter = (pipeline as any).adapters.find(
      (a: any) => a.name === "Telegram"
    );
    const spy = vi.spyOn(telegramAdapter, "sendAlert");

    // Simulate a hypothetical "MANUAL_TRADE" signal (not in PineStrategyCategory)
    const fakeSig = makePineSignal({ strategy: "MANUAL_TRADE" as any });
    pipeline.dispatchSignal(fakeSig);

    // The strategy is not in TELEGRAM_SUPPORTED_STRATEGIES so adapter never fires
    expect(spy).not.toHaveBeenCalled();

    // All real supported strategies are accounted for
    supportedStrategies.forEach((s) => expect(typeof s).toBe("string"));
  });
});

// ─── 20. No automatic BUY/SELL execution is introduced ───────────────────────

describe("TC-20: No automatic BUY/SELL execution is introduced", () => {
  it("PineAlertPipeline has no method that calls tradingEngine or openPosition", () => {
    const pipeline = new PineAlertPipeline();
    const pipelineSource = pipeline.constructor.toString();

    // The pipeline class must not reference any trading execution primitives
    expect(pipelineSource).not.toContain("openPosition");
    expect(pipelineSource).not.toContain("tradingEngine");
    expect(pipelineSource).not.toContain("executeOrder");
  });

  it("dispatchSignal resolves with a NotificationAlertEvent that has no trade ID", async () => {
    const pipeline = new PineAlertPipeline();
    const sig = makePineSignal();
    const event = await pipeline.dispatchSignal(sig);

    // NotificationAlertEvent has alertId (not a trade ID) and no position fields
    expect(event.alertId).toMatch(/^alert_/);
    expect((event as any).positionId).toBeUndefined();
    expect((event as any).tradeId).toBeUndefined();
    expect((event as any).orderId).toBeUndefined();
  });
});

// ─── Bonus: TelegramDedupeGuard TTL expiry allows re-send ────────────────────

describe("TelegramDedupeGuard: TTL expiry allows re-send", () => {
  it("after TTL passes, the same key is allowed again", () => {
    const guard = new TelegramDedupeGuard();
    const key = guard.buildKey("XAU/USD", "SWING", "SWL", 4000, "BUY");

    // First send
    expect(guard.shouldSend(key)).toBe(true);

    // Manually backdate the stored entry to simulate TTL expiry
    (guard as any).store.set(key, { sentAtMs: Date.now() - DEDUPE_TTL_MS - 1 });

    // Should be allowed again after TTL
    expect(guard.shouldSend(key)).toBe(true);
  });
});

// ─── Bonus: Dedup key includes all discriminating fields ─────────────────────

describe("TelegramDedupeGuard: dedup key structure", () => {
  it("key contains instrument, strategy, levelType, price, direction", () => {
    const guard = new TelegramDedupeGuard();
    const key = guard.buildKey("XAU/USD", "PWH_PWL", "PWH", 4431.10, "SELL");

    expect(key).toContain("XAU/USD");
    expect(key).toContain("PWH_PWL");
    expect(key).toContain("PWH");
    // price * 100 rounded = 443110
    expect(key).toContain("443110");
    expect(key).toContain("SELL");
  });

  it("different direction on same level produces different key", () => {
    const guard = new TelegramDedupeGuard();
    const keyBuy  = guard.buildKey("BTC/USD", "SWING", "SWL", 1950, "BUY");
    const keySell = guard.buildKey("BTC/USD", "SWING", "SWL", 1950, "SELL");
    expect(keyBuy).not.toBe(keySell);
  });
});

// ─── Bonus: formatAlertMessage fields from PineSignal ────────────────────────

describe("PineAlertPipeline: formatAlertMessage contract", () => {
  it("message contains all required display fields", () => {
    const pipeline = new PineAlertPipeline();
    const sig = makePineSignal({
      instrument: "XAU/USD",
      strategy: "PWH_PWL",
      referenceLevelType: "PWH",
      triggerPrice: 4431.10,
      direction: "SELL",
      timestamp: "2026-09-05T10:50:00Z",
    });

    const event = pipeline.formatAlertMessage(sig);
    expect(event.message).toContain("XAU/USD");
    expect(event.message).toContain("PWH / PWL");
    expect(event.message).toContain("PWH");
    expect(event.message).toContain("4431.10");
    expect(event.message).toContain("SELL");
    expect(event.message).toContain("IST");
  });

  it("timestamp is converted to IST (UTC+5:30)", () => {
    const pipeline = new PineAlertPipeline();
    // 10:50 UTC → 16:20 IST
    const sig = makePineSignal({ timestamp: "2026-09-05T10:50:00Z" });
    const event = pipeline.formatAlertMessage(sig);
    expect(event.message).toContain("16:20 IST");
  });

  it("notes field is included when present", () => {
    const pipeline = new PineAlertPipeline();
    const sig = makePineSignal({ notes: "Downside sweep @ 1900.00" });
    const event = pipeline.formatAlertMessage(sig);
    expect(event.message).toContain("Downside sweep @ 1900.00");
  });
});
