import { describe, it, expect, beforeEach } from "vitest";
import { PaperBrokerAdapter } from "../broker/PaperBrokerAdapter";
import { SimulatedBrokerAdapter } from "../broker/SimulatedBrokerAdapter";
import { IBrokerAdapter, BrokerOrderRequest } from "../broker/IBrokerAdapter";
import { instrumentMasterResolver } from "../broker/InstrumentMasterResolver";
import { standardBrokerChargeAdapter } from "../broker/BrokerChargeAdapter";

describe("Phase 16 — Broker Interface & Abstraction Test Suite", () => {
  let paperAdapter: IBrokerAdapter;
  let mockAdapter: IBrokerAdapter;

  beforeEach(async () => {
    paperAdapter = new PaperBrokerAdapter();
    mockAdapter = new SimulatedBrokerAdapter(100000);
    await paperAdapter.connect();
    await mockAdapter.connect();
  });

  it("1. Provider-Neutral Interface: Both PaperBrokerAdapter and SimulatedBrokerAdapter implement IBrokerAdapter", async () => {
    const paperStatus = await paperAdapter.connect();
    const mockStatus = await mockAdapter.connect();

    expect(paperStatus.state).toBe("CONNECTED");
    expect(paperStatus.isPaper).toBe(true);
    expect(mockStatus.state).toBe("CONNECTED");
    expect(mockStatus.isPaper).toBe(true);
  });

  it("2. Core Operations: getAccount, getPositions, getOrders, placeOrder, getOrder, cancelOrder, getQuote, getInstrument", async () => {
    // getAccount
    const acc = await mockAdapter.getAccount();
    expect(acc.accountId).toBe("MOCK_ACC_1001");
    expect(acc.availableMargin).toBe(100000);

    // placeOrder
    const req: BrokerOrderRequest = {
      clientOrderId: "CL_TEST_001",
      symbol: "NIFTY",
      exchange: "NFO",
      instrument: "NIFTY2692424500CE",
      expiry: "2026-09-24T00:00:00.000Z",
      strike: 24500,
      optionType: "CE",
      side: "BUY",
      quantity: 65,
      orderType: "LIMIT",
      price: 120.5,
      product: "NRML",
      isHedgeLeg: true,
    };

    const res = await mockAdapter.placeOrder(req);
    expect(res.status).toBe("FILLED");
    expect(res.filledQuantity).toBe(65);

    // getOrders & getOrder
    const orders = await mockAdapter.getOrders();
    expect(orders.length).toBe(1);

    const singleOrder = await mockAdapter.getOrder(res.orderId);
    expect(singleOrder).not.toBeNull();
    expect(singleOrder?.clientOrderId).toBe("CL_TEST_001");

    // getPositions
    const positions = await mockAdapter.getPositions();
    expect(positions.length).toBe(1);
    expect(positions[0].quantity).toBe(65);

    // cancelOrder
    const cancelRes = await mockAdapter.cancelOrder(res.orderId);
    expect(cancelRes.status).toBe("CANCELLED");

    // getQuote
    const quote = await mockAdapter.getQuote("NIFTY");
    expect(quote.lastPrice).toBeGreaterThan(0);

    // getInstrument
    const inst = await mockAdapter.getInstrument("NIFTY");
    expect(inst?.symbol).toBe("NIFTY");
  });

  it("3. Instrument Master Resolver: Validates NIFTY contracts, lot sizes, and strike increments", () => {
    const valid = instrumentMasterResolver.resolveInstrument("NIFTY", "2026-09-24T00:00:00.000Z", 24500, "CE");
    expect(valid.valid).toBe(true);
    expect(valid.instrument?.lotSize).toBe(65);

    const invalidStrike = instrumentMasterResolver.resolveInstrument("NIFTY", "2026-09-24T00:00:00.000Z", 24533, "CE");
    expect(invalidStrike.valid).toBe(false);
    expect(invalidStrike.reason).toContain("multiples of 50");

    const invalidUnderlying = instrumentMasterResolver.resolveInstrument("BANKNIFTY", "2026-09-24T00:00:00.000Z", 50000, "CE");
    expect(invalidUnderlying.valid).toBe(false);
  });

  it("4. Broker Charge Adapter: Calculates brokerage, STT, exchange fees, GST, SEBI charges, and stamp duty", () => {
    const charges = standardBrokerChargeAdapter.calculateTotalCharges(65, 100, 150);
    expect(charges.grossPnl).toBe(3250); // (150 - 100) * 65
    expect(charges.brokerage).toBe(40); // ₹20 entry + ₹20 exit
    expect(charges.stt).toBeGreaterThan(0);
    expect(charges.totalCharges).toBeGreaterThan(40);
    expect(charges.netPnl).toBeLessThan(charges.grossPnl);
  });
});
