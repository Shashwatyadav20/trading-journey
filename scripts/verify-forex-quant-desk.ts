import {
  evaluateGoldLiquiditySweep,
  evaluateCryptoRangeBreakout,
  evaluateGlobalSmartShield,
  GLOBAL_ACTIVE_STORAGE_KEY,
  GLOBAL_HISTORY_STORAGE_KEY,
  DEFAULT_GLOBAL_ACTIVE_TRADES,
  DEFAULT_GLOBAL_HISTORY_TRADES,
  DEFAULT_GLOBAL_MACRO_CALENDAR,
} from "../lib/forex/forexEngine.ts";
import type {
  GlobalCandle,
  ActiveGlobalTrade,
} from "../lib/forex/forexEngine.ts";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`✅ [PASS] ${label}`);
    passed++;
  } else {
    console.error(`❌ [FAIL] ${label}`);
    failed++;
  }
}

console.log("====================================================================");
console.log("GLOBAL & FOREX QUANT DESK (GOLD & CRYPTO-FX) VERIFICATION SUITE");
console.log("====================================================================\n");

// ─── Test 1: Storage Keys ─────────────────────────────────────────────────────
assert(
  GLOBAL_ACTIVE_STORAGE_KEY === "nse_global_active_trades_v1",
  "Active trades storage key matches 'nse_global_active_trades_v1'"
);
assert(
  GLOBAL_HISTORY_STORAGE_KEY === "nse_global_history_trades_v1",
  "History trades storage key matches 'nse_global_history_trades_v1'"
);

// ─── Test 2: Strategy 1 (Gold Asian Low Liquidity Sweep & OB Mitigation) ─────
const mockGoldCandles: GlobalCandle[] = [
  { timestamp: 1, open: 2740, high: 2742, low: 2738, close: 2739, volume: 5000 },
  { timestamp: 2, open: 2739, high: 2740, low: 2735, close: 2736, volume: 6000 },
  { timestamp: 3, open: 2736, high: 2737, low: 2730, close: 2732, volume: 8000 },
  // Liquidity sweep piercing Asian Low ($2730) down to $2724 and aggressively rejecting
  { timestamp: 4, open: 2732, high: 2733, low: 2724, close: 2728, volume: 15000 },
  { timestamp: 5, open: 2728, high: 2735, low: 2727, close: 2734, volume: 18000 },
  { timestamp: 6, open: 2734, high: 2736, low: 2733, close: 2735, volume: 9000 },
  { timestamp: 7, open: 2735, high: 2738, low: 2734, close: 2737, volume: 8500 },
  { timestamp: 8, open: 2737, high: 2739, low: 2736, close: 2738, volume: 7500 },
  { timestamp: 9, open: 2738, high: 2740, low: 2737, close: 2739, volume: 8200 },
  { timestamp: 10, open: 2739, high: 2741, low: 2738, close: 2740, volume: 9100 },
  { timestamp: 11, open: 2740, high: 2742, low: 2739, close: 2741, volume: 9200 },
  { timestamp: 12, open: 2741, high: 2743, low: 2740, close: 2742, volume: 9300 },
  { timestamp: 13, open: 2742, high: 2744, low: 2741, close: 2743, volume: 9400 },
  { timestamp: 14, open: 2743, high: 2745, low: 2742, close: 2744, volume: 9500 },
  { timestamp: 15, open: 2744, high: 2746, low: 2743, close: 2745, volume: 9600 },
];

const goldSweepOpp = evaluateGoldLiquiditySweep({
  livePrice: 2734.5,
  candles: mockGoldCandles,
  asianHigh: 2752.0,
  asianLow: 2730.0,
});

assert(goldSweepOpp !== null, "Gold London/NY Liquidity Sweep opportunity generated");
assert(goldSweepOpp?.symbol === "XAUUSD", "Asset symbol is XAUUSD");
assert(goldSweepOpp?.direction === "LONG", "Bullish sweep of Asian Low correctly triggers LONG direction");
assert(
  (goldSweepOpp?.rewardRiskRatio ?? 0) >= 2.5,
  `Strict Risk-to-Reward >= 2.5 verified (actual: 1:${goldSweepOpp?.rewardRiskRatio})`
);
assert(
  (goldSweepOpp?.targetPrice ?? 0) > (goldSweepOpp?.entryPrice ?? 0) &&
    (goldSweepOpp?.stopLossPrice ?? 0) < (goldSweepOpp?.entryPrice ?? 0),
  "Gold LONG trade sets valid Entry, Stop Loss below sweep, and elevated Target"
);

// ─── Test 3: Strategy 2 (Crypto-FX Range Breakout & Volume Expansion) ────────
const mockBtcCandles: GlobalCandle[] = Array.from({ length: 20 }, (_, i) => ({
  timestamp: Date.now() - (20 - i) * 60000,
  open: 87000 + i * 20,
  high: 87100 + i * 20,
  low: 86900 + i * 20,
  close: 87050 + i * 20,
  volume: 1000,
}));

const btcBreakoutOpp = evaluateCryptoRangeBreakout({
  symbol: "BTCUSD",
  livePrice: 88500.0, // Breaks above box high $87800
  candles: mockBtcCandles,
  boxHigh: 87800.0,
  boxLow: 86400.0,
  avgVolume: 10000,
  currentVolume: 24500, // 2.45x volume surge >= 2.2x
});

assert(btcBreakoutOpp !== null, "BTC-USD Asian Range Breakout opportunity generated");
assert(btcBreakoutOpp?.symbol === "BTCUSD", "Symbol matches BTCUSD");
assert(btcBreakoutOpp?.direction === "LONG", "Breakout above box high generates LONG");
assert(
  (btcBreakoutOpp?.volumeMultiplier ?? 0) >= 2.2,
  `Volume multiplier meets >= 2.2x requirement (actual: ${btcBreakoutOpp?.volumeMultiplier}x)`
);
assert(
  (btcBreakoutOpp?.rewardRiskRatio ?? 0) >= 2.5,
  `Strict Risk-to-Reward >= 2.5 verified on Crypto (actual: 1:${btcBreakoutOpp?.rewardRiskRatio})`
);

// ─── Test 4: Automated 70% Target Progress -> TSL-to-Cost Locking ─────────────
const runningTrade: ActiveGlobalTrade = {
  tradeId: "TEST-XAU-001",
  symbol: "XAUUSD",
  ticker: "GC=F",
  assetName: "Gold Spot",
  category: "METALS",
  direction: "LONG",
  strategyId: "GOLD_LIQUIDITY_SWEEP_OB",
  strategyBadge: "Asian Low Sweep",
  entryPrice: 2700.0,
  currentPrice: 2700.0,
  initialStopLoss: 2690.0, // $10 risk
  currentStopLoss: 2690.0,
  targetPrice: 2730.0, // $30 reward (1:3 RR)
  rewardRiskRatio: 3.0,
  units: 1.0,
  pnlAmount: 0,
  pnlPercent: 0,
  targetProgressPct: 0,
  peakPrice: 2700.0,
  isTslCostLocked: false,
  status: "ACTIVE",
  macroShieldStatus: "CLEAN",
  entryTimestamp: new Date().toISOString(),
  executionTimeIst: "14:00 IST",
};

// At $2715: Progress is (15 / 30) = 50% -> TSL should NOT lock to cost yet
const eval50Pct = evaluateGlobalSmartShield({
  trade: runningTrade,
  currentPrice: 2715.0,
});
assert(
  !eval50Pct.isTslCostLocked && eval50Pct.updatedStopLoss === 2690.0,
  "At 50% target progress, Stop-Loss remains at initial stop ($2690)"
);
assert(eval50Pct.pnlAmount === 15.0, "Live P&L calculated accurately ($15.00)");

// At $2722: Progress is (22 / 30) = 73.3% >= 70% -> TSL MUST lock to cost (Breakeven $2700)
const eval73Pct = evaluateGlobalSmartShield({
  trade: runningTrade,
  currentPrice: 2722.0,
});
assert(
  eval73Pct.isTslCostLocked,
  "At 73.3% target progress (>= 70%), isTslCostLocked is automatically set to true"
);
assert(
  eval73Pct.updatedStopLoss === 2700.0,
  "Stop-Loss is shifted to entry price ($2700.00) locking breakeven"
);

// ─── Test 5: Target Hit Execution ─────────────────────────────────────────────
const evalTargetHit = evaluateGlobalSmartShield({
  trade: runningTrade,
  currentPrice: 2731.0, // Reaches target $2730
});
assert(
  evalTargetHit.shouldAutoExit && evalTargetHit.exitTag === "TARGET_HIT",
  "Target hit triggers automated exit with 'TARGET_HIT' tag"
);

// ─── Test 6: Breakeven Stop Execution when TSL Locked ─────────────────────────
const tradeWithLockedTsl: ActiveGlobalTrade = {
  ...runningTrade,
  currentStopLoss: 2700.0,
  isTslCostLocked: true,
};
const evalBreakevenExit = evaluateGlobalSmartShield({
  trade: tradeWithLockedTsl,
  currentPrice: 2699.5, // Retraced back to entry
});
assert(
  evalBreakevenExit.shouldAutoExit &&
    evalBreakevenExit.exitTag === "TSL_COST_BREAKEVEN_EXIT",
  "Pullback to entry with locked TSL triggers 'TSL_COST_BREAKEVEN_EXIT' protecting capital"
);

// ─── Test 7: Simulated Macro Shock Catalyst ───────────────────────────────────
const evalMacroShock = evaluateGlobalSmartShield({
  trade: runningTrade,
  currentPrice: 2710.0,
  forcedCatalyst: {
    type: "MACRO_SHOCK",
    headline: "US Core CPI 3.6% YoY vs 3.1% exp - Emergency Yield Spike",
  },
});
assert(
  evalMacroShock.shouldAutoExit && evalMacroShock.exitTag === "MACRO_CATALYST_EXIT",
  "Macro shock catalyst triggers instant 'MACRO_CATALYST_EXIT' safeguard"
);
assert(
  evalMacroShock.reversalMetrics !== undefined &&
    evalMacroShock.reversalMetrics.macroHeadline?.includes("US Core CPI"),
  "Audit metrics contain exact scraped macro catalyst headline"
);

// ─── Test 8: Reversal Climax Detection ────────────────────────────────────────
const evalReversalClimax = evaluateGlobalSmartShield({
  trade: runningTrade,
  currentPrice: 2712.0, // Retraced from peak $2726 (86.6% progress -> 40% progress)
  peakPrice: 2726.0,
});
assert(
  evalReversalClimax.shouldAutoExit && evalReversalClimax.exitTag === "REVERSAL_EXIT",
  "Exhaustion reversal from near-target zone (>65% peak, >25% pullback) triggers 'REVERSAL_EXIT'"
);

// ─── Test 9: Default Seeds & Macro Calendar Integrity ─────────────────────────
assert(
  DEFAULT_GLOBAL_ACTIVE_TRADES.length >= 2,
  "DEFAULT_GLOBAL_ACTIVE_TRADES contains initial Gold & Crypto active positions"
);
assert(
  DEFAULT_GLOBAL_HISTORY_TRADES.length >= 2,
  "DEFAULT_GLOBAL_HISTORY_TRADES contains seed closed trades for Backtest Audit"
);
assert(
  DEFAULT_GLOBAL_MACRO_CALENDAR.some((e) => e.name.includes("CPI")) &&
    DEFAULT_GLOBAL_MACRO_CALENDAR.some((e) => e.name.includes("FOMC")) &&
    DEFAULT_GLOBAL_MACRO_CALENDAR.some((e) => e.name.includes("NFP")),
  "Default macro calendar tracks US CPI, FOMC, and NFP catalysts"
);

console.log("\n====================================================================");
console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
console.log("====================================================================");

if (failed > 0) {
  process.exit(1);
}
