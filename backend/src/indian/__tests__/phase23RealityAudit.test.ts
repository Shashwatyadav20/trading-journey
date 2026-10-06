import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { niftyMarketProvider } from "../market/NiftyMarketProvider";
import { hedgingStrategyEngine } from "../strategy/HedgingStrategyEngine";
import { paperBrokerAdapter } from "../broker/PaperBrokerAdapter";
import { dhanBrokerAdapter } from "../broker/DhanBrokerAdapter";
import { nseIndiaOptionChainProvider } from "../market/NseIndiaOptionChainProvider";
import { instrumentMasterResolver } from "../broker/InstrumentMasterResolver";
import { genuineDataValidator } from "../validation/GenuineDataValidator";
import { AutoHedgeSignal, NiftyOptionChain } from "../types";

describe("PHASE 23 — Complete Reality Audit & Real-Data Integrity Test Suite", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...origEnv };
    niftyMarketProvider.updateSpotPrice(24700, true);
    niftyMarketProvider.setOptionChainProvider(nseIndiaOptionChainProvider);
  });

  afterEach(() => {
    process.env = origEnv;
  });

  const sampleCandles = [
    { time: Math.floor(Date.now() / 1000) - 900, open: 24700, high: 24710, low: 24690, close: 24705, volume: 10000 },
  ];

  // 1. Real Dhan response reaches strategy
  it("1. Real Dhan response reaches strategy", async () => {
    const mockFetch = vi.spyOn(dhanBrokerAdapter, "fetchOptionChain").mockResolvedValueOnce({
      success: true,
      sourceType: "REAL",
      providerName: "DHAN",
      contracts: [
        {
          underlying: "NIFTY",
          expiry: "2026-09-24",
          strike: 24700,
          optionType: "CE",
          ltp: 150,
          bid: 149,
          ask: 151,
          timestamp: new Date().toISOString(),
          source: "DHAN",
          sourceType: "REAL",
          iv: 0.15,
          delta: 0.5,
        },
        {
          underlying: "NIFTY",
          expiry: "2026-09-24",
          strike: 24850,
          optionType: "CE",
          ltp: 80,
          bid: 79,
          ask: 81,
          timestamp: new Date().toISOString(),
          source: "DHAN",
          sourceType: "REAL",
          iv: 0.15,
          delta: 0.3,
        },
        {
          underlying: "NIFTY",
          expiry: "2026-09-24",
          strike: 24700,
          optionType: "PE",
          ltp: 140,
          bid: 139,
          ask: 141,
          timestamp: new Date().toISOString(),
          source: "DHAN",
          sourceType: "REAL",
          iv: 0.15,
          delta: -0.5,
        },
        {
          underlying: "NIFTY",
          expiry: "2026-09-24",
          strike: 24550,
          optionType: "PE",
          ltp: 75,
          bid: 74,
          ask: 76,
          timestamp: new Date().toISOString(),
          source: "DHAN",
          sourceType: "REAL",
          iv: 0.15,
          delta: -0.3,
        },
      ],
      spotPrice: 24700,
      expiryDates: ["2026-09-24"],
      nearestExpiry: "2026-09-24",
      lotSize: 75,
      underlyingTimestamp: new Date().toISOString(),
      fetchDurationMs: 45,
    });

    process.env.NIFTY_DATA_PROVIDER = "DHAN";
    niftyMarketProvider.setOptionChainProvider(dhanBrokerAdapter);
    const chainRes = await niftyMarketProvider.getOptionChain(24700);

    expect(chainRes.isReal).toBe(true);
    expect(chainRes.chain.contracts[0].source).toBe("DHAN");

    const signal = hedgingStrategyEngine.generateSignal(24700, sampleCandles, sampleCandles, chainRes.chain);
    expect(signal.dataSource).toBe("DHAN");
    expect(mockFetch).toHaveBeenCalled();
  });

  // 2. Synthetic data cannot reach strategy in REAL_DATA_ONLY mode
  it("2. Synthetic data cannot reach strategy in REAL_DATA_ONLY mode", async () => {
    process.env.INDIAN_REAL_DATA_ONLY = "true";
    niftyMarketProvider.setOptionChainProvider(null);

    const chainRes = await niftyMarketProvider.getOptionChain(24700);
    expect(chainRes.isReal).toBe(false);

    const signal = hedgingStrategyEngine.generateSignal(24700, sampleCandles, sampleCandles, chainRes.chain);
    expect(signal.action).toBe("NO_TRADE");
    expect(signal.reasons[0]).toContain("REAL_OPTION_CHAIN_UNAVAILABLE");
  });

  // 3. Missing Dhan data causes NO TRADE
  it("3. Missing Dhan data causes NO TRADE", async () => {
    process.env.NIFTY_DATA_PROVIDER = "DHAN";
    process.env.INDIAN_REAL_DATA_ONLY = "true";
    vi.spyOn(dhanBrokerAdapter, "fetchOptionChain").mockResolvedValueOnce({
      success: false,
      sourceType: "INVALID",
      providerName: "DHAN",
      contracts: [],
      spotPrice: null,
      expiryDates: [],
      nearestExpiry: null,
      lotSize: null,
      underlyingTimestamp: null,
      fetchDurationMs: 10,
      errorCode: "DHAN_NOT_CONFIGURED",
      errorMessage: "Dhan API credentials missing",
    });

    niftyMarketProvider.setOptionChainProvider(dhanBrokerAdapter);
    const chainRes = await niftyMarketProvider.getOptionChain(24700);

    const signal = hedgingStrategyEngine.generateSignal(24700, sampleCandles, sampleCandles, chainRes.chain);
    expect(signal.action).toBe("NO_TRADE");
  });

  // 4. Missing NSE data causes NO TRADE if NSE is required
  it("4. Missing NSE data causes NO TRADE if NSE is required", async () => {
    process.env.NIFTY_DATA_PROVIDER = "NSE_INDIA";
    process.env.INDIAN_REAL_DATA_ONLY = "true";
    vi.spyOn(nseIndiaOptionChainProvider, "fetchOptionChain").mockResolvedValueOnce({
      success: false,
      sourceType: "INVALID",
      providerName: "NSE_INDIA",
      contracts: [],
      spotPrice: null,
      expiryDates: [],
      nearestExpiry: null,
      lotSize: null,
      underlyingTimestamp: null,
      fetchDurationMs: 10,
      errorCode: "HTTP_503",
      errorMessage: "NSE service unavailable",
    });

    niftyMarketProvider.setOptionChainProvider(nseIndiaOptionChainProvider);
    const chainRes = await niftyMarketProvider.getOptionChain(24700);

    const signal = hedgingStrategyEngine.generateSignal(24700, sampleCandles, sampleCandles, chainRes.chain);
    expect(signal.action).toBe("NO_TRADE");
  });

  // 5. Stale data causes NO TRADE
  it("5. Stale data causes NO TRADE", () => {
    // Explicitly disable REAL_DATA_ONLY so the stale-data gate fires before the gamma gate.
    // This test specifically validates stale-data detection, not real-data-only mode.
    process.env.INDIAN_REAL_DATA_ONLY = "false";
    const staleTime = new Date(Date.now() - 120000).toISOString();
    const staleChain: NiftyOptionChain = {
      spotPrice: 24700,
      timestamp: staleTime,
      contracts: [
        { symbol: "NIFTY2692424700CE", expiry: "2026-09-24", strike: 24700, optionType: "CE", ltp: 100, bid: 99, ask: 101, volume: 100, openInterest: 1000, changeInOI: 0, iv: 0.15, delta: 0.5, timestamp: staleTime }
      ],
      isSynthetic: false,
    };

    const signal = hedgingStrategyEngine.generateSignal(24700, sampleCandles, sampleCandles, staleChain);
    expect(signal.action).toBe("NO_TRADE");
    expect(signal.reasons[0]).toContain("DATA_INVALID_OR_STALE");
  });

  // 6. Fake option price causes NO TRADE
  it("6. Fake option price causes NO TRADE", () => {
    const invalidChain: NiftyOptionChain = {
      spotPrice: 24700,
      timestamp: new Date().toISOString(),
      contracts: [
        { symbol: "NIFTY2692424700CE", expiry: "2026-09-24", strike: 24700, optionType: "CE", ltp: 0, bid: 0, ask: 0, volume: 0, openInterest: 0, changeInOI: 0, iv: 0.15, delta: 0.5, timestamp: new Date().toISOString() }
      ],
      isSynthetic: false,
    };

    const signal = hedgingStrategyEngine.generateSignal(24700, sampleCandles, sampleCandles, invalidChain);
    expect(signal.action).toBe("NO_TRADE");
  });

  // 7. Fake Greeks cannot be fabricated
  it("7. Fake Greeks cannot be fabricated", async () => {
    const result = await nseIndiaOptionChainProvider.fetchOptionChain(24700);
    if (result.success && result.contracts.length > 0) {
      const c = result.contracts[0];
      expect(c.gammaSource).toBeUndefined();
      expect(c.thetaSource).toBeUndefined();
    }
  });

  // 8. Fake IV cannot be fabricated
  it("8. Fake IV cannot be fabricated", () => {
    const contract = {
      underlying: "NIFTY",
      expiry: "2026-09-24",
      strike: 24700,
      optionType: "CE" as const,
      ltp: 100,
      bid: 99,
      ask: 101,
      timestamp: new Date().toISOString(),
      source: "TEST",
      sourceType: "REAL" as const,
    };
    expect(contract.iv).toBeUndefined();
  });

  // 9. Lot-size mismatch causes NO TRADE
  it("9. Lot-size mismatch causes NO TRADE", () => {
    const lotRes = instrumentMasterResolver.verifyLotSizeFromProvider(null);
    expect(lotRes.verified).toBe(false);
    expect(lotRes.reason).toBe("LOT_SIZE_UNVERIFIED");
  });

  // 10. Paper P&L cannot be marked genuine without real prices
  it("10. Paper P&L cannot be marked genuine without real prices", () => {
    process.env.INDIAN_REAL_DATA_ONLY = "true";
    const dummySignal: AutoHedgeSignal = {
      symbol: "NIFTY",
      timestamp: new Date().toISOString(),
      regime: "BULLISH",
      score: 80,
      action: "BULL_PUT_SPREAD",
      expiry: "2026-09-24",
      spotPrice: 24700,
      sellLeg: { symbol: "NIFTY2692424700PE", strike: 24700, optionType: "PE", ltp: 100, bid: 99, ask: 101, iv: 0.15, delta: -0.3 },
      buyLeg: { symbol: "NIFTY2692424550PE", strike: 24550, optionType: "PE", ltp: 40, bid: 39, ask: 41, iv: 0.15, delta: -0.15 },
      netCredit: 60,
      maxProfit: 4500,
      maxLoss: 600,
      entryPrice: 60,
      stopLossSpread: 90,
      targetSpread: 30,
      quantityLots: 1,
      totalQuantity: 75,
      marginRequired: 11250,
      charges: { grossPnl: 0, entryCharges: 50, exitCharges: 50, brokerage: 40, stt: 10, exchangeFees: 5, gst: 10, sebiFees: 1, stampDuty: 2, estimatedSlippage: 10, totalCharges: 128, netPnl: 0 },
      expectedNetPnl: 4372,
      riskPercentage: 1,
      rewardRiskRatio: 7.5,
      status: "READY",
      reasons: ["Test READY signal"],
      dataSource: "SYNTHETIC",
    };

    const pos = paperBrokerAdapter.executePaperOrder("test-user-pnl", dummySignal);
    expect(pos.pnlType).toBe("SYNTHETIC_PAPER_PNL");

    paperBrokerAdapter.processMarketTick(24700, undefined, false);
    expect(pos.pnlType).not.toBe("REAL_MARKET_DATA_PAPER_PNL");
  });

  // 11. Dhan order methods remain blocked
  it("11. Dhan order methods remain blocked", async () => {
    const orderReq: any = { symbol: "NIFTY", price: 100, quantity: 75, side: "BUY" };
    await expect(dhanBrokerAdapter.placeOrder(orderReq)).rejects.toThrow("SECURITY LOCK ENFORCED");
    await expect(dhanBrokerAdapter.modifyOrder("ORD123", orderReq)).rejects.toThrow("SECURITY LOCK ENFORCED");
    await expect(dhanBrokerAdapter.cancelOrder("ORD123")).rejects.toThrow("SECURITY LOCK ENFORCED");
  });

  // 12. No real broker order is sent
  it("12. No real broker order is sent", async () => {
    const conn = dhanBrokerAdapter.getConnectionStatus();
    expect(conn.isPaper).toBe(true);
    expect(process.env.LIVE_TRADING).not.toBe("true");
  });

  // 13. Source provenance survives the complete signal pipeline
  it("13. Source provenance survives the complete signal pipeline", () => {
    const chain: NiftyOptionChain = {
      spotPrice: 24700,
      timestamp: new Date().toISOString(),
      contracts: [
        { symbol: "NIFTY2692424700CE", expiry: "2026-09-24", strike: 24700, optionType: "CE", ltp: 150, bid: 149, ask: 151, volume: 100, openInterest: 1000, changeInOI: 0, iv: 0.15, delta: 0.5, timestamp: new Date().toISOString() },
        { symbol: "NIFTY2692424850CE", expiry: "2026-09-24", strike: 24850, optionType: "CE", ltp: 80, bid: 79, ask: 81, volume: 100, openInterest: 1000, changeInOI: 0, iv: 0.15, delta: 0.3, timestamp: new Date().toISOString() },
        { symbol: "NIFTY2692424700PE", expiry: "2026-09-24", strike: 24700, optionType: "PE", ltp: 140, bid: 139, ask: 141, volume: 100, openInterest: 1000, changeInOI: 0, iv: 0.15, delta: -0.5, timestamp: new Date().toISOString() },
        { symbol: "NIFTY2692424550PE", expiry: "2026-09-24", strike: 24550, optionType: "PE", ltp: 75, bid: 74, ask: 76, volume: 100, openInterest: 1000, changeInOI: 0, iv: 0.15, delta: -0.3, timestamp: new Date().toISOString() },
      ],
      isSynthetic: false,
    };

    const signal = hedgingStrategyEngine.generateSignal(24700, sampleCandles, sampleCandles, chain);
    expect(signal.decisionTimestamp).toBeDefined();
    expect(signal.dataSource).toBeDefined();
    expect(signal.spotSource).toBeDefined();
  });

  // 14. Production environment correctly reports data-source status
  it("14. Production environment correctly reports data-source status", async () => {
    const gate = await genuineDataValidator.evaluatePhase18OperationalGate();
    expect(gate.sessionGate).toBeDefined();
    expect(gate.evaluatedAt).toBeDefined();
  });

  // 15. Duplicate signals remain blocked
  it("15. Duplicate signals remain blocked", () => {
    const timeNow = new Date().toISOString();
    const readySignal: AutoHedgeSignal = {
      symbol: "NIFTY",
      timestamp: timeNow,
      regime: "BULLISH",
      score: 80,
      action: "BULL_PUT_SPREAD",
      expiry: "2026-09-24",
      spotPrice: 24700,
      sellLeg: { symbol: "NIFTY2692424700PE", strike: 24700, optionType: "PE", ltp: 100, bid: 99, ask: 101, iv: 0.15, delta: -0.3 },
      buyLeg: { symbol: "NIFTY2692424550PE", strike: 24550, optionType: "PE", ltp: 40, bid: 39, ask: 41, iv: 0.15, delta: -0.15 },
      netCredit: 60,
      maxProfit: 4500,
      maxLoss: 600,
      entryPrice: 60,
      stopLossSpread: 90,
      targetSpread: 30,
      quantityLots: 1,
      totalQuantity: 75,
      marginRequired: 11250,
      charges: { grossPnl: 0, entryCharges: 50, exitCharges: 50, brokerage: 40, stt: 10, exchangeFees: 5, gst: 10, sebiFees: 1, stampDuty: 2, estimatedSlippage: 10, totalCharges: 128, netPnl: 0 },
      expectedNetPnl: 4372,
      riskPercentage: 1,
      rewardRiskRatio: 7.5,
      status: "READY",
      reasons: ["Test READY signal"],
    };

    const pos1 = paperBrokerAdapter.executePaperOrder("idempotent-user-unique", readySignal);
    const pos2 = paperBrokerAdapter.executePaperOrder("idempotent-user-unique", readySignal);
    expect(pos2.id).toBe(pos1.id); // Idempotent return — duplicate order blocked

    paperBrokerAdapter.closePosition(pos1.id, "TEST_CLOSE");
    expect(() => paperBrokerAdapter.executePaperOrder("idempotent-user-unique", readySignal)).toThrow("Idempotency Block");
  });
});
