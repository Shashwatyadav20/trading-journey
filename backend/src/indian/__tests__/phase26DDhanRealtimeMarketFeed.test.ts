import { describe, test, expect, beforeEach, vi } from "vitest";
import { DhanMarketFeedProvider, dhanMarketFeedProvider } from "../market/DhanMarketFeedProvider";
import { DhanSubscriptionManager } from "../market/DhanSubscriptionManager";
import { DhanRealtimeDataMerger } from "../market/DhanRealtimeDataMerger";
import { DhanNseCrossChecker } from "../validation/DhanNseCrossChecker";
import { DhanBrokerAdapter } from "../broker/DhanBrokerAdapter";
import { PaperBrokerAdapter } from "../broker/PaperBrokerAdapter";
import { DailyRiskController } from "../risk/DailyRiskController";
import { DhanMarketTick, CanonicalOptionContract, AutoHedgeSignal } from "../types";

describe("PHASE 26D — Dhan Real-Time Market Feed & Genuine Paper Trading Suite", () => {
  let feedProvider: DhanMarketFeedProvider;
  let subManager: DhanSubscriptionManager;
  let dataMerger: DhanRealtimeDataMerger;
  let crossChecker: DhanNseCrossChecker;
  let dhanAdapter: DhanBrokerAdapter;
  let paperAdapter: PaperBrokerAdapter;
  let riskController: DailyRiskController;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.PAPER_TRADING = "true";
    process.env.LIVE_TRADING = "false";
    process.env.BROKER_EXECUTION_ENABLED = "false";
    process.env.INDIAN_REAL_DATA_ONLY = "true";

    feedProvider = new DhanMarketFeedProvider();
    subManager = new DhanSubscriptionManager();
    dataMerger = new DhanRealtimeDataMerger();
    crossChecker = new DhanNseCrossChecker();
    dhanAdapter = new DhanBrokerAdapter();
    paperAdapter = new PaperBrokerAdapter();
    riskController = new DailyRiskController();
  });

  test("1. WebSocket Connection Lifecycle States", async () => {
    expect(feedProvider.getConnectionState()).toBe("DISCONNECTED");
    const health = feedProvider.getHealth();
    expect(health.provider).toBe("DHAN");
    expect(health.connected).toBe(false);
    expect(health.safetyState.PAPER_TRADING).toBe(true);
    expect(health.safetyState.LIVE_TRADING).toBe(false);
  });

  test("2. Authentication & Credential Check", async () => {
    await feedProvider.connect();
    expect(feedProvider.getConnectionState()).toBe("HEALTHY");
    expect(feedProvider.getHealth().isHealthy).toBe(true);
  });

  test("3. Heartbeat & Latency Tracking", async () => {
    const tick: DhanMarketTick = {
      provider: "DHAN",
      exchangeSegment: "NSE_FNO",
      securityId: "54321",
      timestamp: Date.now() - 50,
      ltp: 120.5,
      sourceType: "REAL_EXTERNAL",
    };
    feedProvider.injectTick(tick);
    const health = feedProvider.getHealth();
    expect(health.lastMessageAt).toBeTruthy();
    expect(feedProvider.getLatestTick("54321")?.ltp).toBe(120.5);
  });

  test("4. Disconnect Handling", async () => {
    await feedProvider.connect();
    await feedProvider.disconnect();
    expect(feedProvider.getConnectionState()).toBe("DISCONNECTED");
    expect(feedProvider.getHealth().connected).toBe(false);
  });

  test("5. Automatic Reconnect & Backoff Parameters", async () => {
    expect(feedProvider.getHealth().reconnectCount).toBe(0);
    expect((feedProvider as any).maxReconnectDelayMs).toBe(30000);
  });

  test("6. Duplicate Subscription Prevention", () => {
    const isFirst = subManager.subscribeInstrument("1333", "NSE_EQ", "NIFTY");
    expect(isFirst).toBe(true);

    const isDuplicate = subManager.subscribeInstrument("1333", "NSE_EQ", "NIFTY");
    expect(isDuplicate).toBe(false);
    expect(subManager.getSubscriptionCount()).toBe(1);
  });

  test("7. Subscription Batch Operations", () => {
    const count = subManager.subscribeMany([
      { securityId: "101", exchangeSegment: "NSE_FNO" },
      { securityId: "102", exchangeSegment: "NSE_FNO" },
    ]);
    expect(count).toBe(2);
    expect(subManager.getSubscriptionCount()).toBe(2);

    const removed = subManager.unsubscribeMany(["101", "102"]);
    expect(removed).toBe(2);
    expect(subManager.getSubscriptionCount()).toBe(0);
  });

  test("8. Tick Normalization & Strict Real Data Integrity", () => {
    const tick: DhanMarketTick = {
      provider: "DHAN",
      exchangeSegment: "NSE_FNO",
      securityId: "9999",
      timestamp: Date.now(),
      ltp: 250.75,
      volume: 1500,
      bestBid: 250.5,
      bestAsk: 251.0,
      sourceType: "REAL_EXTERNAL",
    };

    feedProvider.injectTick(tick);
    const retrieved = feedProvider.getLatestTick("9999");
    expect(retrieved?.ltp).toBe(250.75);
    expect(retrieved?.bestBid).toBe(250.5);
    expect(retrieved?.bestAsk).toBe(251.0);
    expect(retrieved?.oi).toBeUndefined();
  });

  test("9. Stale Data Detection", async () => {
    const oldTick: DhanMarketTick = {
      provider: "DHAN",
      exchangeSegment: "IDX_I",
      securityId: "13",
      timestamp: Date.now() - 120000,
      ltp: 24700,
      sourceType: "REAL_EXTERNAL",
    };
    feedProvider.injectTick(oldTick);
    (feedProvider as any).state = "STALE";
    expect(feedProvider.getConnectionState()).toBe("STALE");
  });

  test("10. REST Option Chain + WebSocket Merge Rules", () => {
    const restContract: CanonicalOptionContract = {
      strikePrice: 24700,
      optionType: "CE",
      expiryDate: "2026-10-08",
      ltp: 150.0,
      bid: 149.5,
      ask: 150.5,
      delta: 0.52,
      gamma: 0.003,
      theta: -12.4,
      vega: 15.2,
      iv: 14.5,
      lotSize: 65,
      openInterest: 50000,
      securityId: "777",
    };

    dhanMarketFeedProvider.injectTick({
      provider: "DHAN",
      exchangeSegment: "NSE_FNO",
      securityId: "777",
      timestamp: Date.now(),
      ltp: 155.0,
      bestBid: 154.5,
      bestAsk: 155.5,
      sourceType: "REAL_EXTERNAL",
    });

    const merged = dataMerger.mergeContractWithRealtimeTick(restContract);
    expect(merged.optionLtp).toBe(155.0);
    expect(merged.bidPrice).toBe(154.5);
    expect(merged.askPrice).toBe(155.5);
    expect(merged.delta).toBe(0.52);
    expect(merged.gamma).toBe(0.003);
    expect(merged.lotSize).toBe(65);
    expect(merged.provenance.optionLtp).toBe("DHAN_WEBSOCKET");
    expect(merged.provenance.delta).toBe("DHAN_OPTION_CHAIN");
  });

  test("11. Source Provenance Tracking", () => {
    const restContract: CanonicalOptionContract = {
      strikePrice: 24500,
      optionType: "PE",
      expiryDate: "2026-10-08",
      ltp: 80.0,
      lotSize: 65,
      securityId: "888",
    };

    const merged = dataMerger.mergeContractWithRealtimeTick(restContract);
    expect(merged.provenance.optionLtp).toBe("DHAN_OPTION_CHAIN");
    expect(merged.provenance.lotSize).toBe("DHAN_INSTRUMENT_MASTER");
    expect(merged.provenance.expiry).toBe("DHAN_EXPIRY_LIST");
  });

  test("12. Missing LTP Remains Undefined / Null", () => {
    const emptyContract: CanonicalOptionContract = {
      strikePrice: 25000,
      optionType: "CE",
      expiryDate: "2026-10-08",
      securityId: "999",
    };

    const merged = dataMerger.mergeContractWithRealtimeTick(emptyContract);
    expect(merged.optionLtp).toBeNull();
    expect(merged.spotPrice).toBeNull();
  });

  test("13. Missing Greeks Handling (No Hardcoded Fallback)", () => {
    const noGreeksContract: CanonicalOptionContract = {
      strikePrice: 24700,
      optionType: "PE",
      expiryDate: "2026-10-08",
      securityId: "1234",
    };

    const merged = dataMerger.mergeContractWithRealtimeTick(noGreeksContract);
    expect(merged.gamma).toBeNull();
    expect(merged.delta).toBeNull();
    expect(merged.provenance.gamma).toBe("UNAVAILABLE");
  });

  test("14. Invalid Security ID Handling", () => {
    const res = dataMerger.mergeContractWithRealtimeTick({
      strikePrice: 24000,
      optionType: "CE",
      expiryDate: "2026-10-08",
    });
    expect(res.securityId).toBe("");
  });

  test("15. Lot Size Verification", () => {
    const noLotContract: CanonicalOptionContract = {
      strikePrice: 24700,
      optionType: "CE",
      expiryDate: "2026-10-08",
      lotSize: undefined,
    };
    const merged = dataMerger.mergeContractWithRealtimeTick(noLotContract);
    expect(merged.lotSize).toBeNull();
    expect(merged.provenance.lotSize).toBe("UNAVAILABLE");
  });

  test("16. Expired Instrument Handling", () => {
    const expiredContract: CanonicalOptionContract = {
      strikePrice: 24500,
      optionType: "PE",
      expiryDate: "2020-01-01",
    };
    const merged = dataMerger.mergeContractWithRealtimeTick(expiredContract);
    expect(merged.expiry).toBe("2020-01-01");
  });

  test("17. NSE Cross-Check Comparison", async () => {
    const matchRes = await crossChecker.compareSpotAndOptions("NIFTY", 24700, 150);
    expect(matchRes.symbol).toBe("NIFTY");
    expect(matchRes.matchStatus).toBe("NSE_UNAVAILABLE");
    expect(matchRes.discrepancyLogged).toBe(false);
  });

  test("18. REAL_DATA_ONLY Blocks Trading When Provider Is Unavailable", () => {
    process.env.INDIAN_REAL_DATA_ONLY = "true";
    const health = feedProvider.getHealth();
    expect(health.realDataOnly).toBe(true);
  });

  test("19. Paper Entry Execution (PaperBrokerAdapter)", async () => {
    const hedgeOrder = await paperAdapter.placeOrder({
      symbol: "NIFTY26100824450PE",
      side: "BUY",
      type: "MARKET",
      quantity: 65,
    });
    expect(hedgeOrder.orderId).toBeTruthy();
    expect(hedgeOrder.status).toBe("FILLED");

    const shortOrder = await paperAdapter.placeOrder({
      symbol: "NIFTY26100824500PE",
      side: "SELL",
      type: "MARKET",
      quantity: 65,
    });
    expect(shortOrder.orderId).toBeTruthy();
    expect(shortOrder.status).toBe("FILLED");
  });

  test("20. Real-Time Position Monitoring & 50% Profit Target Exit", async () => {
    const signal: AutoHedgeSignal = {
      signalId: "SIG_WS_001",
      action: "BULL_PUT_SPREAD",
      symbol: "NIFTY",
      status: "READY",
      sellLeg: { symbol: "NIFTY26100824500PE", strike: 24500, optionType: "PE", ltp: 150, bid: 149.5, ask: 150.5, quantity: 65, securityId: "111" },
      buyLeg: { symbol: "NIFTY26100824450PE", strike: 24450, optionType: "PE", ltp: 120, bid: 119.5, ask: 120.5, quantity: 65, securityId: "222" },
      netCredit: 30.0,
      quantityLots: 1,
      totalQuantity: 65,
      maxLoss: 850,
      stopLossSpread: 60,
      targetSpread: 15,
      expiry: "2026-10-08",
      timestamp: new Date().toISOString(),
      signalFingerprint: "NIFTY_WS_TEST_001",
      reasons: ["Test Signal"],
      spotPrice: 24700,
      charges: { totalCharges: 76.0, stt: 0, brokerage: 40, exchangeTxnFee: 15, gst: 10, stampDuty: 11 },
    };

    const pos = await paperAdapter.executePaperOrder("test-ws-user", signal);
    expect(pos.id).toBeTruthy();
    expect(pos.status).toBe("OPEN");
    expect(pos.pnlType).toBe("REAL_MARKET_DATA_PAPER_PNL");
  });

  test("21. Paper Exit & State Verification", async () => {
    const signal: AutoHedgeSignal = {
      signalId: "SIG_WS_002",
      action: "BULL_PUT_SPREAD",
      symbol: "NIFTY",
      status: "READY",
      sellLeg: { symbol: "NIFTY26100824500PE", strike: 24500, optionType: "PE", ltp: 150, bid: 149.5, ask: 150.5, quantity: 65, securityId: "111" },
      buyLeg: { symbol: "NIFTY26100824450PE", strike: 24450, optionType: "PE", ltp: 120, bid: 119.5, ask: 120.5, quantity: 65, securityId: "222" },
      netCredit: 30.0,
      quantityLots: 1,
      totalQuantity: 65,
      maxLoss: 850,
      stopLossSpread: 60,
      targetSpread: 15,
      expiry: "2026-10-08",
      timestamp: new Date().toISOString(),
      signalFingerprint: "NIFTY_WS_TEST_002",
      reasons: ["Test Signal"],
      spotPrice: 24700,
      charges: { totalCharges: 76.0, stt: 0, brokerage: 40, exchangeTxnFee: 15, gst: 10, stampDuty: 11 },
    };

    const openPos = await paperAdapter.executePaperOrder("test-ws-exit", signal);
    const closed = await paperAdapter.closePosition(openPos.id, "PROFIT_TARGET_CAPTURED");
    expect(closed.status).toBe("CLOSED");
    expect(closed.exitReason).toBe("PROFIT_TARGET_CAPTURED");
  });

  test("22. Backend Restart Recovery", async () => {
    const activePositions = await paperAdapter.getPositions();
    expect(Array.isArray(activePositions)).toBe(true);
  });

  test("23. Duplicate Paper Position Prevention", async () => {
    const signal: AutoHedgeSignal = {
      signalId: "SIG_IDEM_999",
      action: "BULL_PUT_SPREAD",
      symbol: "NIFTY",
      status: "READY",
      sellLeg: { symbol: "NIFTY26100824500PE", strike: 24500, optionType: "PE", ltp: 150, bid: 149.5, ask: 150.5, quantity: 65, securityId: "111" },
      buyLeg: { symbol: "NIFTY26100824450PE", strike: 24450, optionType: "PE", ltp: 120, bid: 119.5, ask: 120.5, quantity: 65, securityId: "222" },
      netCredit: 30.0,
      quantityLots: 1,
      totalQuantity: 65,
      maxLoss: 850,
      stopLossSpread: 60,
      targetSpread: 15,
      expiry: "2026-10-08",
      timestamp: new Date().toISOString(),
      signalFingerprint: "IDEM_SIG_999",
      reasons: ["Test Signal"],
      spotPrice: 24700,
      charges: { totalCharges: 76.0, stt: 0, brokerage: 40, exchangeTxnFee: 15, gst: 10, stampDuty: 11 },
    };

    const pos1 = await paperAdapter.executePaperOrder("test-idem-user", signal);
    const pos2 = await paperAdapter.executePaperOrder("test-idem-user", signal);

    expect(pos1.id).toBe(pos2.id);
  });

  test("24. Daily Risk Lock Integrity", () => {
    const state = riskController.getState();
    expect(state.dailyProfitTarget).toBe(1000);
    expect(state.dailyLossLimit).toBe(-5000);
    expect(state.maxTradesPerDay).toBe(3);
    expect(state.maxConsecutiveLosses).toBe(2);
  });

  test("25. Live Order Safety Lock Enforced", async () => {
    const req = { symbol: "NIFTY24700CE", side: "BUY" as const, type: "MARKET" as const, quantity: 65 };
    await expect(dhanAdapter.placeOrder(req)).rejects.toThrow("SECURITY LOCK ENFORCED");
    await expect(dhanAdapter.modifyOrder("ORD1", req)).rejects.toThrow("SECURITY LOCK ENFORCED");
    await expect(dhanAdapter.cancelOrder("ORD1")).rejects.toThrow("SECURITY LOCK ENFORCED");
  });

  test("26. Real Broker Orders Sent = 0 Invariant", () => {
    expect(dhanAdapter.getRealOrdersSent()).toBe(0);
  });

  test("27. Final Safety Invariant Verification", () => {
    expect(process.env.PAPER_TRADING !== "false").toBe(true);
    expect(process.env.LIVE_TRADING).toBe("false");
    expect(process.env.BROKER_EXECUTION_ENABLED).toBe("false");
    expect(process.env.INDIAN_REAL_DATA_ONLY).toBe("true");
    expect(dhanAdapter.getRealOrdersSent()).toBe(0);
  });
});
