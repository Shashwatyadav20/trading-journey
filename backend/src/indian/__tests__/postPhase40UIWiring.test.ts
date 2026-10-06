/**
 * POST-PHASE-40 UI WIRING BUG FIX — TEST SUITE
 *
 * Tests for all acceptance criteria from the Post-Phase-40 production UI
 * runtime/data wiring issue fix.
 *
 * Tests:
 *  1.  IMStrategy calls /api/indian/signal via apiUrl (no hardcoded URL)
 *  2.  No hardcoded strategy values in IMStrategy
 *  3.  NO_TRADE rendering in IMStrategy
 *  4.  MAX_LOSS_EXCEEDS_1000_INR correctly surfaced from backend reasons
 *  5.  REAL signal rendering uses backend data fields
 *  6.  Backend disconnected state shown (BACKEND DISCONNECTED)
 *  7.  Synthetic data never rendered as valid strategy
 *  8.  NEXT_PUBLIC_BACKEND_URL usage in backendUrl helper
 *  9.  No localhost hardcoding in Indian market components
 * 10.  INDIAN_REAL_DATA_ONLY enforcement in NiftyMarketProvider
 * 11.  Missing NIFTY data → NO_TRADE
 * 12.  Missing option chain → NO_TRADE
 * 13.  Missing option prices → NO_TRADE
 * 14.  Live trading remains false (safety invariant)
 * 15.  Broker execution remains false (safety invariant)
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { NiftyMarketProvider } from "../market/NiftyMarketProvider";
import { HedgingStrategyEngine } from "../strategy/HedgingStrategyEngine";
import type { NiftyOptionChain } from "../types";

// ── helpers ──────────────────────────────────────────────────────────────────

const FRONTEND_COMPONENTS_DIR = path.resolve(__dirname, "../../../../components/indian-market");
const LIB_DIR = path.resolve(__dirname, "../../../../lib");

function readComponentSource(filename: string): string {
  return fs.readFileSync(path.join(FRONTEND_COMPONENTS_DIR, filename), "utf8");
}

function readLibSource(filename: string): string {
  return fs.readFileSync(path.join(LIB_DIR, filename), "utf8");
}

// ── 1. IMStrategy calls /api/indian/signal ───────────────────────────────────

describe("1. IMStrategy — API wiring", () => {
  let src: string;
  beforeAll(() => { src = readComponentSource("IMStrategy.tsx"); });

  it("calls /api/indian/signal via apiUrl helper (not hardcoded)", () => {
    expect(src).toContain('apiUrl("/api/indian/signal")');
    expect(src).not.toMatch(/fetch\(["']http:\/\/localhost:4000/);
  });

  it("imports apiUrl from lib/backendUrl", () => {
    expect(src).toContain("from \"../../lib/backendUrl\"");
  });
});

// ── 2. No hardcoded strategy values ──────────────────────────────────────────

describe("2. No hardcoded strategy values in IMStrategy", () => {
  let src: string;
  beforeAll(() => { src = readComponentSource("IMStrategy.tsx"); });

  it("contains no hardcoded NIFTY spot price 24700 as JSX string literal", () => {
    // Should not appear as a plain value string in the component
    expect(src).not.toMatch(/["'`]24,?700\.?4?5?["'`]/);
  });

  it("contains no hardcoded strike prices as static JSX text nodes", () => {
    expect(src).not.toMatch(/>\s*245\d\d\s*</);
    expect(src).not.toMatch(/>\s*247\d\d\s*</);
  });

  it("contains no hardcoded premiums like ₹85 or ₹35 as JSX literals", () => {
    expect(src).not.toMatch(/[₹]\s*85\b/);
    expect(src).not.toMatch(/[₹]\s*35\b/);
  });
});

// ── 3. NO_TRADE rendering ─────────────────────────────────────────────────────

describe("3. NO_TRADE rendering", () => {
  it("IMStrategy renders NoTradeCard when status is NO_TRADE", () => {
    const src = readComponentSource("IMStrategy.tsx");
    expect(src).toContain("NoTradeCard");
    expect(src).toContain("NO_TRADE");
  });

  it("NoTradeCard shows backend rejection reasons (signal.reasons.map)", () => {
    const src = readComponentSource("IMStrategy.tsx");
    expect(src).toContain("signal.reasons.map");
  });

  it("IMCurrentSignal renders BACKEND DISCONNECTED guard", () => {
    const src = readComponentSource("IMCurrentSignal.tsx");
    expect(src).toContain("BACKEND DISCONNECTED");
    expect(src).toContain("backendError");
  });
});

// ── 4. MAX_LOSS_EXCEEDS_1000_INR rendering ───────────────────────────────────

describe("4. MAX_LOSS_EXCEEDS_1000_INR rendering", () => {
  it("NoTradeCard in IMStrategy highlights MAX_LOSS_EXCEEDS_1000_INR reason", () => {
    const src = readComponentSource("IMStrategy.tsx");
    expect(src).toContain("MAX_LOSS_EXCEEDS_1000_INR");
    expect(src).toMatch(/isMaxLoss/);
  });
});

// ── 5. REAL signal rendering ──────────────────────────────────────────────────

describe("5. REAL signal rendering uses backend data fields", () => {
  let src: string;
  beforeAll(() => { src = readComponentSource("IMStrategy.tsx"); });

  it("uses signal.netCredit", () => { expect(src).toContain("signal.netCredit"); });
  it("uses signal.maxLoss", () => { expect(src).toContain("signal.maxLoss"); });
  it("uses signal.maxProfit", () => { expect(src).toContain("signal.maxProfit"); });
  it("uses signal.charges", () => { expect(src).toContain("signal.charges"); });
  it("uses signal.dataSource for provenance", () => { expect(src).toContain("signal.dataSource"); });
  it("uses signal.timestamp", () => { expect(src).toContain("signal.timestamp"); });
  it("uses signal.rewardRiskRatio", () => { expect(src).toContain("signal.rewardRiskRatio"); });
});

// ── 6. Backend disconnected state ────────────────────────────────────────────

describe("6. Backend disconnected state", () => {
  it("IMStrategy shows DisconnectedCard when backend unreachable", () => {
    const src = readComponentSource("IMStrategy.tsx");
    expect(src).toContain("DisconnectedCard");
    expect(src).toContain("BACKEND DISCONNECTED");
    expect(src).toContain("NEXT_PUBLIC_BACKEND_URL");
  });

  it("IMCurrentSignal does not silently show demo data on error", () => {
    const src = readComponentSource("IMCurrentSignal.tsx");
    expect(src).toContain("!backendError");
  });

  it("IMCurrentSignal mentions NEXT_PUBLIC_BACKEND_URL in disconnected message", () => {
    const src = readComponentSource("IMCurrentSignal.tsx");
    expect(src).toContain("NEXT_PUBLIC_BACKEND_URL");
  });
});

// ── 7. Synthetic data never rendered as valid strategy ───────────────────────

describe("7. Synthetic data never rendered as valid strategy", () => {
  it("IMStrategy shows DataUnavailableCard if signal is not genuine", () => {
    const src = readComponentSource("IMStrategy.tsx");
    expect(src).toContain("DataUnavailableCard");
  });

  it("SignalCard only rendered when isReal=true", () => {
    const src = readComponentSource("IMStrategy.tsx");
    expect(src).toContain("pageState.isReal");
  });

  it("IMCurrentSignal never shows 24,700 as hardcoded fallback", () => {
    const src = readComponentSource("IMCurrentSignal.tsx");
    expect(src).not.toContain('"24,700"');
    expect(src).not.toContain("'24,700'");
  });

  it("IMOverviewView no longer shows 24,700.45 as hardcoded NIFTY spot", () => {
    const src = readComponentSource("IMOverviewView.tsx");
    expect(src).not.toContain('"24,700.45"');
    expect(src).not.toContain("'24,700.45'");
  });

  it("IMPostPhase40OperationsDashboard no longer shows ₹24,700.45 hardcoded", () => {
    const src = readComponentSource("IMPostPhase40OperationsDashboard.tsx");
    expect(src).not.toContain("₹24,700.45");
  });
});

// ── 8. NEXT_PUBLIC_BACKEND_URL usage ─────────────────────────────────────────

describe("8. NEXT_PUBLIC_BACKEND_URL usage", () => {
  let src: string;
  beforeAll(() => { src = readLibSource("backendUrl.ts"); });

  it("reads from NEXT_PUBLIC_BACKEND_URL env variable", () => {
    expect(src).toContain("NEXT_PUBLIC_BACKEND_URL");
    expect(src).toContain("process.env.NEXT_PUBLIC_BACKEND_URL");
  });

  it("falls back to localhost:4000 if env not set", () => {
    expect(src).toContain("http://localhost:4000");
    expect(src).toMatch(/NEXT_PUBLIC_BACKEND_URL[\s\S]*localhost/);
  });

  it("exports apiUrl() function", () => {
    expect(src).toContain("export function apiUrl");
  });
});

// ── 9. No localhost hardcoding in Indian market components ────────────────────

describe("9. No localhost hardcoding in Indian market components", () => {
  const INDIAN_COMPONENTS = [
    "IMStrategy.tsx",
    "IMCurrentSignal.tsx",
    "IMOverviewView.tsx",
    "IMBacktestView.tsx",
    "IMPostPhase40OperationsDashboard.tsx",
    "IMHeader.tsx",
  ];

  INDIAN_COMPONENTS.forEach((filename) => {
    it(`${filename} must not contain hardcoded http://localhost:4000`, () => {
      const src = readComponentSource(filename);
      expect(src).not.toMatch(/http:\/\/localhost:4000/);
    });
  });
});

// ── 10. INDIAN_REAL_DATA_ONLY enforcement ────────────────────────────────────

describe("10. INDIAN_REAL_DATA_ONLY enforcement", () => {
  afterEach(() => {
    delete process.env.INDIAN_REAL_DATA_ONLY;
  });

  it("returns isReal=false and spotPrice=0 when INDIAN_REAL_DATA_ONLY=true", async () => {
    process.env.INDIAN_REAL_DATA_ONLY = "true";
    const provider = new NiftyMarketProvider(60000, null);
    const result = await provider.getSpotPrice();
    expect(result.isReal).toBe(false);
    expect(result.spotPrice).toBe(0);
  });

  it("returns synthetic fallback 24700.45 when INDIAN_REAL_DATA_ONLY is not set", async () => {
    delete process.env.INDIAN_REAL_DATA_ONLY;
    const provider = new NiftyMarketProvider(60000, null);
    const result = await provider.getSpotPrice();
    expect(result.isReal).toBe(false);
    expect(result.spotPrice).toBe(24700.45);
  });

  it("synthetic fallback 24700.45 is always marked isReal=false", async () => {
    delete process.env.INDIAN_REAL_DATA_ONLY;
    const provider = new NiftyMarketProvider(60000, null);
    const result = await provider.getSpotPrice();
    expect(result.isReal).toBe(false);
  });
});

// ── 11. Missing NIFTY data → NO_TRADE ────────────────────────────────────────

describe("11. Missing NIFTY data → NO_TRADE", () => {
  afterEach(() => {
    delete process.env.INDIAN_REAL_DATA_ONLY;
  });

  it("generateSignal returns NO_TRADE when spotPrice=0", () => {
    process.env.INDIAN_REAL_DATA_ONLY = "true";
    const engine = new HedgingStrategyEngine();
    const signal = engine.generateSignal(0, [], []);
    expect(signal.status).toBe("NO_TRADE");
    expect(signal.action).toBe("NO_TRADE");
    expect(signal.reasons.length).toBeGreaterThan(0);
  });

  it("NO_TRADE signal includes a data-related rejection reason when spot=0", () => {
    process.env.INDIAN_REAL_DATA_ONLY = "true";
    const engine = new HedgingStrategyEngine();
    const signal = engine.generateSignal(0, [], []);
    const hasDataReason = signal.reasons.some(
      (r) =>
        r.includes("Invalid") ||
        r.includes("missing") ||
        r.includes("UNAVAILABLE") ||
        r.includes("DATA") ||
        r.includes("REAL")
    );
    expect(hasDataReason).toBe(true);
  });
});

// ── 12. Missing option chain → NO_TRADE ──────────────────────────────────────

describe("12. Missing option chain → NO_TRADE", () => {
  afterEach(() => {
    delete process.env.INDIAN_REAL_DATA_ONLY;
  });

  it("returns NO_TRADE when option chain is empty with INDIAN_REAL_DATA_ONLY=true", () => {
    process.env.INDIAN_REAL_DATA_ONLY = "true";
    const engine = new HedgingStrategyEngine();
    // Pass a valid spot but an empty synthetic option chain
    const emptyChain: NiftyOptionChain = {
      spotPrice: 24700,
      timestamp: new Date().toISOString(),
      contracts: [],
      isSynthetic: true,
    };
    const signal = engine.generateSignal(24700, [{ time: Date.now() / 1000, open: 24700, high: 24710, low: 24690, close: 24700, volume: 1000 }], [], emptyChain);
    expect(signal.status).toBe("NO_TRADE");
    const hasChainReason = signal.reasons.some(
      (r) => r.includes("REAL_OPTION_CHAIN_UNAVAILABLE") || r.includes("OPTION_CHAIN")
    );
    expect(hasChainReason).toBe(true);
  });
});

// ── 13. Missing option prices → NO_TRADE ─────────────────────────────────────

describe("13. Missing option prices → NO_TRADE", () => {
  afterEach(() => {
    delete process.env.INDIAN_REAL_DATA_ONLY;
  });

  it("returns NO_TRADE when all contracts have zero ltp with INDIAN_REAL_DATA_ONLY=true", () => {
    process.env.INDIAN_REAL_DATA_ONLY = "true";
    const engine = new HedgingStrategyEngine();
    // Provide contracts with ltp=0 — HedgingStrategyEngine should reject
    const zeroChain: NiftyOptionChain = {
      spotPrice: 24700,
      timestamp: new Date().toISOString(),
      contracts: [
        { symbol: "NIFTY_PE", expiry: "2026-10-09", strike: 24500, optionType: "PE", ltp: 0, bid: 0, ask: 0, volume: 0, openInterest: 0, changeInOI: 0, iv: 0.15, delta: -0.3, gamma: 0.003, timestamp: new Date().toISOString(), source: "TEST" },
        { symbol: "NIFTY_CE", expiry: "2026-10-09", strike: 24500, optionType: "CE", ltp: 0, bid: 0, ask: 0, volume: 0, openInterest: 0, changeInOI: 0, iv: 0.15, delta: 0.3, gamma: 0.003, timestamp: new Date().toISOString(), source: "TEST" },
      ],
      isSynthetic: false, // Mark as non-synthetic so it passes the REAL_OPTION_CHAIN_UNAVAILABLE gate
    };
    const mockCandles = [{ time: Date.now() / 1000, open: 24700, high: 24710, low: 24690, close: 24700, volume: 1000 }];
    const signal = engine.generateSignal(24700, mockCandles, [], zeroChain);
    // With zero prices, no valid spread can be found OR max-loss gate fires → NO_TRADE
    expect(signal.status).toBe("NO_TRADE");
  });
});

// ── 14. Live trading remains false ───────────────────────────────────────────

describe("14. Live trading remains false (safety invariant)", () => {
  it("HedgingStrategyEngine source never sets LIVE_TRADING=true", () => {
    const engineSrc = fs.readFileSync(
      path.resolve(__dirname, "../strategy/HedgingStrategyEngine.ts"),
      "utf8"
    );
    expect(engineSrc).not.toMatch(/LIVE_TRADING\s*=\s*true/);
    expect(engineSrc).not.toMatch(/liveTrading:\s*true/);
  });

  it("IMStrategy.tsx footer shows LIVE_TRADING=false", () => {
    const src = readComponentSource("IMStrategy.tsx");
    expect(src).toContain("LIVE_TRADING=false");
  });

  it("IMStrategy.tsx footer shows PAPER_TRADING=true", () => {
    const src = readComponentSource("IMStrategy.tsx");
    expect(src).toContain("PAPER_TRADING=true");
  });
});

// ── 15. Broker execution remains false ───────────────────────────────────────

describe("15. Broker execution remains false (safety invariant)", () => {
  it("HedgingStrategyEngine source never sets BROKER_EXECUTION_ENABLED=true", () => {
    const engineSrc = fs.readFileSync(
      path.resolve(__dirname, "../strategy/HedgingStrategyEngine.ts"),
      "utf8"
    );
    expect(engineSrc).not.toMatch(/BROKER_EXECUTION_ENABLED\s*=\s*true/);
    expect(engineSrc).not.toMatch(/brokerExecution:\s*true/);
  });

  it("IMStrategy.tsx footer shows BROKER_EXECUTION_ENABLED=false", () => {
    const src = readComponentSource("IMStrategy.tsx");
    expect(src).toContain("BROKER_EXECUTION_ENABLED=false");
  });

  it("IMStrategy.tsx footer shows INDIAN_REAL_DATA_ONLY=true", () => {
    const src = readComponentSource("IMStrategy.tsx");
    expect(src).toContain("INDIAN_REAL_DATA_ONLY=true");
  });
});
