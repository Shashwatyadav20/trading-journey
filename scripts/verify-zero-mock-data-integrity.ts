/**
 * Verification Script: Zero Mock Data, Legacy Cache Purge & Real-Time Execution Integrity
 * Validates:
 * 1. Legacy cached mock keys (_v1, _v2, _v12, _v15) holding fake profits (e.g. +₹569.5k) are automatically purged on mount.
 * 2. Synthetic/Auto IDs (AUDIT-, AUTO-, FO-EXIT-, etc.) are stripped even if present in _v3 storage.
 * 3. Backtest Ledger and Overview initialize 100% empty (0 trades, ₹0.00 P&L) when no genuine user trades exist.
 * 4. Strict execution logging when user deploys positions and square-off occurs (Target, SL, or manual) in _v3 keys.
 */

import assert from "node:assert";
import {
  parseAllDeskTrades,
  purgeLegacyAndSyntheticStorage,
  isGenuineUserTrade,
  normalizeDateKey,
  STORAGE_KEY_INTRADAY_HISTORY,
  STORAGE_KEY_SWING_HISTORY,
  STORAGE_KEY_FO_HISTORY,
} from "../components/indian-market/BacktestLedgerView";

// Mock localStorage in Node.js environment
const mockStorage: Record<string, string> = {};
(global as any).localStorage = {
  getItem: (key: string) => mockStorage[key] || null,
  setItem: (key: string, val: string) => {
    mockStorage[key] = val;
  },
  removeItem: (key: string) => {
    delete mockStorage[key];
  },
  clear: () => {
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k]);
  },
};
(global as any).window = global;

console.log("================================================================================");
console.log("VERIFYING: Force Purge of Legacy Mock Cache & _v3 Real-Data Integrity");
console.log("================================================================================\n");

// Test 1: Pollute legacy keys with +₹569.5k fake/seed/auto trades and verify hard reset on mount
console.log("Test 1: Hard Reset & Purge of Legacy Polluted Storage Keys (+₹569.5k Fake Profits)");
localStorage.clear();

localStorage.setItem(
  "nse_intraday_history_trades_v1",
  JSON.stringify([
    { tradeId: "AUDIT-POLYCAB-101", symbol: "POLYCAB.NS", entryPrice: 6520, exitPrice: 6710, pnlAmount: 19000 },
    { tradeId: "AUTO-INTRA-TRENT-999", symbol: "TRENT.NS", entryPrice: 6800, exitPrice: 7100, pnlAmount: 150000 },
  ])
);
localStorage.setItem(
  "nse_swing_backtest_history_v15",
  JSON.stringify([
    { tradeId: "AUTO-SOLARINDS-888", symbol: "SOLARINDS.NS", entryPrice: 9800, exitPrice: 10600, pnlAmount: 400500 },
  ])
);
localStorage.setItem(
  "backtest_portfolio_history_v2",
  JSON.stringify([
    { tradeId: "AUDIT-PGEL-102", symbol: "PGEL.NS", entryPrice: 710, exitPrice: 755, pnlAmount: 22500 },
  ])
);
localStorage.setItem(
  "nse_fo_quant_closed_history_v1",
  JSON.stringify([
    { positionId: "FO-EXIT-NIFTY-101", symbol: "^NSEI", entrySpotPrice: 24150, currentSpotPrice: 24180, realizedPnLINR: 8450 },
  ])
);

// Run parser (which triggers purgeLegacyAndSyntheticStorage)
const initialTrades = parseAllDeskTrades();
assert.strictEqual(initialTrades.length, 0, "parseAllDeskTrades() must return 0 trades after purging legacy keys");
assert.strictEqual(localStorage.getItem("nse_intraday_history_trades_v1"), null, "Legacy intraday v1 key wiped");
assert.strictEqual(localStorage.getItem("nse_swing_backtest_history_v15"), null, "Legacy swing v15 key wiped");
assert.strictEqual(localStorage.getItem("backtest_portfolio_history_v2"), null, "Legacy swing v2 key wiped");
assert.strictEqual(localStorage.getItem("nse_fo_quant_closed_history_v1"), null, "Legacy FO v1 key wiped");
console.log("  ✓ PASS: All legacy keys (+₹569.5k fake trades) permanently wiped; ledger initialized to 0 records.");

// Test 2: Verify synthetic prefix rejection even inside _v3 keys
console.log("\nTest 2: Synthetic Prefix Rejection Inside _v3 Namespace");
localStorage.setItem(
  STORAGE_KEY_SWING_HISTORY,
  JSON.stringify([
    { tradeId: "AUDIT-SUNPHARMA-103", symbol: "SUNPHARMA.NS", entryPrice: 1820, pnlAmount: 25600 },
    { tradeId: "AUTO-BAJFINANCE-777", symbol: "BAJFINANCE.NS", entryPrice: 1050, pnlAmount: 45000 },
  ])
);
purgeLegacyAndSyntheticStorage();
assert.strictEqual(localStorage.getItem(STORAGE_KEY_SWING_HISTORY), null, "Synthetic entries inside _v3 key wiped");
assert.strictEqual(parseAllDeskTrades().length, 0, "Zero trades returned after stripping synthetic IDs");
console.log("  ✓ PASS: Synthetic AUDIT- and AUTO- trades rejected and purged from _v3 storage.");

// Test 3: Indian Locale Date Normalization (DD/MM/YYYY -> YYYY-MM-DD)
console.log("\nTest 3: Indian Locale Date Key Normalization (DD/MM/YYYY)");
assert.strictEqual(normalizeDateKey("12/11/2026, 5:10:00 pm"), "2026-11-12", "Parses DD/MM/YYYY accurately to 2026-11-12");
assert.strictEqual(normalizeDateKey("2026-11-12"), "2026-11-12", "Preserves ISO YYYY-MM-DD");
console.log("  ✓ PASS: Date normalization accurately resolves Indian locale timestamps.");

// Test 4: Simulate Genuine User Deploy & Target Exit in _v3 Keys
console.log("\nTest 4: Genuine User-Deployed Trade Execution Logging in _v3 Namespace");
const genuineIntraday = {
  tradeId: "INTRA-RELIANCE-1763000001",
  symbol: "NSE:RELIANCE",
  cleanSymbol: "RELIANCE",
  companyName: "Reliance Industries Ltd",
  strategyUsed: "⚡ 9:15-9:45 ORB Breakout",
  direction: "LONG" as const,
  entryPrice: 1280.0,
  exitPrice: 1320.0,
  targetPrice: 1320.0,
  stopLossPrice: 1260.0,
  quantity: 50,
  allocatedCapital: 64000,
  pnlAmount: 2000,
  pnlPercent: 3.13,
  status: "TARGET_HIT",
  lockedDateKey: "2026-11-12",
  executionTime: "09:32:15 IST",
  exitTime: "11:45:00 IST",
};

const genuineSwing = {
  tradeId: "TRADE-4H-SOLARINDS-1763000002",
  symbol: "NSE:SOLARINDS",
  cleanSymbol: "SOLARINDS",
  companyName: "Solar Industries Ltd",
  strategyUsed: "🟣 4H Order Block Retest",
  direction: "LONG" as const,
  entryPrice: 10450.0,
  exitPrice: 10150.0,
  targetPrice: 11200.0,
  stopLossPrice: 10150.0,
  quantity: 10,
  allocatedCapital: 104500,
  pnlAmount: -3000,
  pnlPercent: -2.87,
  status: "STOP_LOSS_HIT",
  lockedDateKey: "2026-11-12",
  executionTime: "10:15:00 IST",
  exitTime: "14:10:00 IST",
};

const genuineFO = {
  positionId: "FO-POS-NIFTY-1763000003",
  symbol: "^NSEI",
  cleanSymbol: "NIFTY",
  companyName: "Nifty 50 Index",
  strategyName: "Bull Put Credit Spread",
  entrySpotPrice: 24350,
  currentSpotPrice: 24420,
  targetSpotLevel: 24550,
  stopLossSpotLevel: 24200,
  totalQuantity: 50,
  marginBlockedINR: 85000,
  realizedPnLINR: 4000,
  isNetCredit: true,
  status: "MANUAL_EXIT",
  entryDateKey: "2026-11-12",
  entryTimestamp: "2026-11-12T09:25:00.000Z",
  exitTimestamp: "2026-11-12T13:40:00.000Z",
};

assert.strictEqual(isGenuineUserTrade(genuineIntraday), true, "Genuine intraday trade accepted");
assert.strictEqual(isGenuineUserTrade(genuineSwing), true, "Genuine swing trade accepted");
assert.strictEqual(isGenuineUserTrade(genuineFO), true, "Genuine FO trade accepted");

localStorage.setItem(STORAGE_KEY_INTRADAY_HISTORY, JSON.stringify([genuineIntraday]));
localStorage.setItem(STORAGE_KEY_SWING_HISTORY, JSON.stringify([genuineSwing]));
localStorage.setItem(STORAGE_KEY_FO_HISTORY, JSON.stringify([genuineFO]));

const verifiedLedger = parseAllDeskTrades();
assert.strictEqual(verifiedLedger.length, 3, "All 3 genuine user-executed trades parsed from _v3 storage");
const totalNetPnL = verifiedLedger.reduce((sum, t) => sum + t.realizedPnLINR, 0);
assert.strictEqual(totalNetPnL, 3000, "Consolidated net P&L equals +₹3,000 (+2000 - 3000 + 4000)");
console.log("  ✓ PASS: Genuine _v3 user executions preserved and aggregated accurately (+₹3,000 across 3 trades).");

console.log("\n================================================================================");
console.log("ALL TESTS PASSED! Legacy cache purged & _v3 real-data integrity verified.");
console.log("================================================================================");
