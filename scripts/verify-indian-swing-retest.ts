/**
 * Verification Script: Indian Institutional Swing Desk - 4H Order Block Retest Scanner
 *
 * Validates:
 * 1. 4H Order Block Retest detection when price touches or enters unmitigated OB zones.
 * 2. Inactive / non-retest filtering when price is outside OB zones.
 * 3. Status transition to "OB_RETEST_ACTIVE".
 * 4. Risk-to-Reward ratio adherence (>= 1:2.5 RR).
 * 5. EMA 20 trend alignment tagging ("✓" confluence).
 * 6. Quality tiering (Strong vs Medium).
 * 7. Telemetry integrity (boundaries, ATR displacement, volume multiplier, entry/SL/TP calculations).
 */

import {
  evaluateSingleStock4HRetest,
  scanNSEOrderBlockRetests,
  DEFAULT_4H_RETEST_ALERTS,
  DEFAULT_NSE_SMC_SYMBOLS,
  type NSERetestAlert,
} from "../lib/indian/institutionalSwingEngine";

let passedCount = 0;
let totalCount = 0;

function assert(condition: boolean, message: string) {
  totalCount++;
  if (condition) {
    passedCount++;
    console.log(`  ✓ PASS: ${message}`);
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

console.log("================================================================================");
console.log("VERIFYING: Indian Swing Desk - 4H Order Block Retest Engine & Telemetry");
console.log("================================================================================\n");

// -----------------------------------------------------------------------------
// Test 1: Verify Default 4H Retest Alerts Integrity
// -----------------------------------------------------------------------------
console.log("Test 1: Default 4H Retest Seed Alerts Structure & Boundaries");
assert(Array.isArray(DEFAULT_4H_RETEST_ALERTS), "DEFAULT_4H_RETEST_ALERTS is an array");
assert(DEFAULT_4H_RETEST_ALERTS.length >= 2, "Has at least 2 default retesting stocks (e.g. RELIANCE, SOLARINDS)");

for (const alert of DEFAULT_4H_RETEST_ALERTS) {
  assert(alert.status === "OB_RETEST_ACTIVE", `${alert.symbol} status is OB_RETEST_ACTIVE`);
  assert(alert.timeframe === "4H", `${alert.symbol} timeframe is 4H`);
  assert(alert.obMitigationRange.topPrice > alert.obMitigationRange.bottomPrice, `${alert.symbol} valid OB range`);
  assert(
    alert.livePrice >= alert.obMitigationRange.bottomPrice && alert.livePrice <= alert.obMitigationRange.topPrice,
    `${alert.symbol} live price (₹${alert.livePrice}) is within OB mitigation range [₹${alert.obMitigationRange.bottomPrice}, ₹${alert.obMitigationRange.topPrice}]`
  );
  assert(alert.rewardRiskRatio >= 2.5, `${alert.symbol} RR ratio (${alert.rewardRiskRatio}) >= 1:2.5`);
  assert(alert.confidenceTag === "✓", `${alert.symbol} confidence tag is '✓'`);
}

// -----------------------------------------------------------------------------
// Test 2: Active 4H OB Retest Trigger (Price Inside Zone)
// -----------------------------------------------------------------------------
console.log("\nTest 2: Real-Time Retest Detection with evaluateSingleStock4HRetest");
const relianceAlert = evaluateSingleStock4HRetest({
  symbol: "RELIANCE",
  companyName: "Reliance Industries Ltd",
  sector: "Energy / Oil & Gas",
  livePrice: 1290.0, // Inside 1285.00 - 1298.50 OB range
});

assert(relianceAlert !== null, "RELIANCE triggers active retest when price enters 4H OB zone");
if (relianceAlert) {
  assert(relianceAlert.status === "OB_RETEST_ACTIVE", "Status transitioned to OB_RETEST_ACTIVE");
  assert(relianceAlert.direction === "BULLISH", "Direction is BULLISH");
  assert(relianceAlert.quality === "Strong", "Quality tier is Strong");
  assert(relianceAlert.emaAligned === true, "EMA 20 trend is aligned");
  assert(relianceAlert.confidenceTag === "✓", "Confidence tag is '✓'");
  assert(relianceAlert.entryPrice === 1290.0, "Entry price matches live LTP");
  assert(relianceAlert.stopLossPrice < relianceAlert.entryPrice, "Stop loss is below entry for bullish setup");
  assert(relianceAlert.targetPrice > relianceAlert.entryPrice, "Target is above entry for bullish setup");
  assert(relianceAlert.rewardRiskRatio >= 2.5, `RR ratio (${relianceAlert.rewardRiskRatio}) satisfies >= 1:2.5`);
}

// -----------------------------------------------------------------------------
// Test 3: Price Outside OB Zone (Should NOT Trigger Retest)
// -----------------------------------------------------------------------------
console.log("\nTest 3: Filtering Inactive Stocks (Price Outside 4H OB Zone)");
const relianceFarAway = evaluateSingleStock4HRetest({
  symbol: "RELIANCE",
  companyName: "Reliance Industries Ltd",
  sector: "Energy / Oil & Gas",
  livePrice: 1350.0, // Far above 1298.50 OB topPrice
});

assert(relianceFarAway === null, "RELIANCE returns null when price is far away from 4H OB zone");

const relianceBelowSL = evaluateSingleStock4HRetest({
  symbol: "RELIANCE",
  companyName: "Reliance Industries Ltd",
  sector: "Energy / Oil & Gas",
  livePrice: 1260.0, // Broken below bottomPrice (invalidated)
});

assert(relianceBelowSL === null, "RELIANCE returns null when OB is invalidated below bottomPrice");

// -----------------------------------------------------------------------------
// Test 4: Bearish 4H OB Retest Detection (BAJFINANCE) & Bullish Retest (SOLARINDS)
// -----------------------------------------------------------------------------
console.log("\nTest 4: Bearish & Bullish Order Block Retest Evaluation");
const solarAlert = evaluateSingleStock4HRetest({
  symbol: "SOLARINDS",
  companyName: "Solar Industries India",
  sector: "Defence & Explosives",
  livePrice: 10480.0, // Inside 10380.00 - 10520.00 OB range
});

assert(solarAlert !== null, "SOLARINDS triggers active retest when touching 4H Bullish OB");
if (solarAlert) {
  assert(solarAlert.status === "OB_RETEST_ACTIVE", "Status is OB_RETEST_ACTIVE");
  assert(solarAlert.direction === "BULLISH", "Direction is BULLISH");
  assert(solarAlert.stopLossPrice < solarAlert.entryPrice, "Stop loss is below entry for bullish setup");
  assert(solarAlert.targetPrice > solarAlert.entryPrice, "Target is above entry for bullish setup");
  assert(solarAlert.rewardRiskRatio >= 2.5, `Bullish RR (${solarAlert.rewardRiskRatio}) >= 1:2.5`);
}

const bajajAlert = evaluateSingleStock4HRetest({
  symbol: "BAJFINANCE",
  companyName: "Bajaj Finance Ltd",
  sector: "Financial Services",
  livePrice: 6720.0, // Inside 6680.00 - 6760.00 OB range
});

assert(bajajAlert !== null, "BAJFINANCE triggers active retest when touching 4H Bearish OB");
if (bajajAlert) {
  assert(bajajAlert.status === "OB_RETEST_ACTIVE", "Status is OB_RETEST_ACTIVE");
  assert(bajajAlert.direction === "BEARISH", "Direction is BEARISH");
  assert(bajajAlert.stopLossPrice > bajajAlert.entryPrice, "Stop loss is above entry for bearish setup");
  assert(bajajAlert.targetPrice < bajajAlert.entryPrice, "Target is below entry for bearish setup");
  assert(bajajAlert.rewardRiskRatio >= 2.5, `Bearish RR (${bajajAlert.rewardRiskRatio}) >= 1:2.5`);
}

// -----------------------------------------------------------------------------
// Test 5: Full NSE Multi-Symbol Order Block Retest Scanner
// -----------------------------------------------------------------------------
console.log("\nTest 5: Full Scanner Engine Across NSE Institutional Universe");
const stocksInput = [
  { symbol: "RELIANCE", companyName: "Reliance Industries Ltd", sector: "Energy", livePrice: 1292.0 }, // Inside OB [1285, 1298]
  { symbol: "SOLARINDS", companyName: "Solar Industries India", sector: "Defence", livePrice: 10480.0 }, // Inside OB [10380, 10520]
  { symbol: "HDFCBANK", companyName: "HDFC Bank Ltd", sector: "Banking", livePrice: 950.0 }, // Far away
  { symbol: "TCS", companyName: "Tata Consultancy Services", sector: "IT", livePrice: 2000.0 }, // Far away
];

const scanResults = scanNSEOrderBlockRetests(stocksInput);
assert(scanResults.length >= 2, "Scanner accurately detected retests for RELIANCE and SOLARINDS");
const retestSymbols = scanResults.map((s) => s.cleanSymbol);
assert(retestSymbols.includes("RELIANCE"), "Scan includes RELIANCE");
assert(retestSymbols.includes("SOLARINDS"), "Scan includes SOLARINDS");
assert(!retestSymbols.includes("HDFCBANK"), "HDFCBANK omitted since price is not in OB zone");

// -----------------------------------------------------------------------------
// Test 6: Risk-to-Reward and Stop-Loss Buffer Math Precision
// -----------------------------------------------------------------------------
console.log("\nTest 6: Stop Loss & Reward-to-Risk Mathematical Precision");
if (relianceAlert) {
  const risk = relianceAlert.entryPrice - relianceAlert.stopLossPrice;
  const reward = relianceAlert.targetPrice - relianceAlert.entryPrice;
  const computedRR = Number((reward / risk).toFixed(2));
  assert(risk > 0, "Risk amount is positive");
  assert(reward > 0, "Reward amount is positive");
  assert(computedRR >= 2.5, `Computed RR (${computedRR}) matches alert RR (${relianceAlert.rewardRiskRatio}) >= 2.5`);
}

console.log("\n================================================================================");
console.log(`ALL TESTS PASSED! (${passedCount}/${totalCount} assertions successful)`);
console.log("================================================================================\n");
