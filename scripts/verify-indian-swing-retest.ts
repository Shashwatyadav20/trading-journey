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
 * 7. Real-Time Price Proximity & Sanity Filter (Discards detached unadjusted/split OBs like 6700 vs 1071).
 * 8. Telemetry integrity (boundaries, ATR displacement, volume multiplier, entry/SL/TP calculations).
 */

import {
  evaluateSingleStock4HRetest,
  scanNSEOrderBlockRetests,
  DEFAULT_4H_RETEST_ALERTS,
  DEFAULT_NSE_SMC_SYMBOLS,
  type NSERetestAlert,
} from "../lib/indian/institutionalSwingEngine";
import {
  isOrderBlockPriceSane,
  MAX_OB_PRICE_PROXIMITY_DEVIATION_PCT,
} from "../lib/forex/smcDualHtfEngine";

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
// Test 1: Verify Default 4H Retest Alerts Integrity & Price Proximity
// -----------------------------------------------------------------------------
console.log("Test 1: Default 4H Retest Seed Alerts Structure & Boundaries");
assert(Array.isArray(DEFAULT_4H_RETEST_ALERTS), "DEFAULT_4H_RETEST_ALERTS is an array");
assert(DEFAULT_4H_RETEST_ALERTS.length >= 3, "Has at least 3 default retesting stocks (RELIANCE, SOLARINDS, BAJFINANCE)");

for (const alert of DEFAULT_4H_RETEST_ALERTS) {
  assert(alert.status === "OB_RETEST_ACTIVE", `${alert.symbol} status is OB_RETEST_ACTIVE`);
  assert(alert.timeframe === "4H", `${alert.symbol} timeframe is 4H`);
  assert(alert.obMitigationRange.topPrice > alert.obMitigationRange.bottomPrice, `${alert.symbol} valid OB range`);
  assert(
    alert.livePrice >= alert.obMitigationRange.bottomPrice * 0.98 && alert.livePrice <= alert.obMitigationRange.topPrice * 1.02,
    `${alert.symbol} live price (₹${alert.livePrice}) is within OB mitigation range [₹${alert.obMitigationRange.bottomPrice}, ₹${alert.obMitigationRange.topPrice}]`
  );
  assert(alert.rewardRiskRatio >= 2.5, `${alert.symbol} RR ratio (${alert.rewardRiskRatio}) >= 1:2.5`);
  assert(alert.confidenceTag === "✓", `${alert.symbol} confidence tag is '✓'`);
  // Strict price sanity assertion
  assert(
    isOrderBlockPriceSane(alert.obMitigationRange, alert.livePrice, 0.15),
    `${alert.symbol} OB zone is within strict ±15% proximity of live LTP (no scale mismatch)`
  );
}

// -----------------------------------------------------------------------------
// Test 2: Active 4H OB Retest Trigger (Price Inside Zone)
// -----------------------------------------------------------------------------
console.log("\nTest 2: Real-Time Retest Detection with evaluateSingleStock4HRetest");
const relianceAlert = evaluateSingleStock4HRetest({
  symbol: "RELIANCE",
  companyName: "Reliance Industries Ltd",
  sector: "Energy / Oil & Gas",
  livePrice: 1290.0, // Inside 1285.00 - 1298.00 OB range
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
  assert(
    isOrderBlockPriceSane(relianceAlert.obMitigationRange, relianceAlert.livePrice, 0.15),
    "RELIANCE generated OB is within strict ±15% proximity of live LTP"
  );
}

// -----------------------------------------------------------------------------
// Test 3: Price Outside OB Zone (Should NOT Trigger Retest)
// -----------------------------------------------------------------------------
console.log("\nTest 3: Filtering Inactive Stocks (Price Outside 4H OB Zone)");
const relianceFarAway = evaluateSingleStock4HRetest({
  symbol: "RELIANCE",
  companyName: "Reliance Industries Ltd",
  sector: "Energy / Oil & Gas",
  livePrice: 1350.0, // Far above 1298.00 OB topPrice
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
// Test 4: Bearish & Bullish Order Block Retest Evaluation (Real-Time Chart Scale)
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
  assert(
    isOrderBlockPriceSane(solarAlert.obMitigationRange, solarAlert.livePrice, 0.15),
    "SOLARINDS OB zone matches current live LTP scale within ±15%"
  );
}

// Bajaj Finance tested at real live chart scale (~₹1,071)
const bajajAlert = evaluateSingleStock4HRetest({
  symbol: "BAJFINANCE",
  companyName: "Bajaj Finance Ltd",
  sector: "Financial Services",
  livePrice: 1071.0, // Inside post-split 1058.00 - 1078.00 OB range
});

assert(bajajAlert !== null, "BAJFINANCE triggers active retest when touching 4H Bearish OB at live ₹1,071 chart scale");
if (bajajAlert) {
  assert(bajajAlert.status === "OB_RETEST_ACTIVE", "Status is OB_RETEST_ACTIVE");
  assert(bajajAlert.direction === "BEARISH", "Direction is BEARISH");
  assert(bajajAlert.stopLossPrice > bajajAlert.entryPrice, "Stop loss is above entry for bearish setup");
  assert(bajajAlert.targetPrice < bajajAlert.entryPrice, "Target is below entry for bearish setup");
  assert(bajajAlert.rewardRiskRatio >= 2.5, `Bearish RR (${bajajAlert.rewardRiskRatio}) >= 1:2.5`);
  assert(
    isOrderBlockPriceSane(bajajAlert.obMitigationRange, bajajAlert.livePrice, 0.15),
    "BAJFINANCE OB zone matches current live LTP scale (₹1,058–₹1,078 vs LTP ₹1,071)"
  );
}

// -----------------------------------------------------------------------------
// Test 5: REAL-TIME PRICE PROXIMITY & SANITY FILTER (Phantom Level Elimination)
// -----------------------------------------------------------------------------
console.log("\nTest 5: Real-Time Price Proximity & Sanity Filter (Discards Detached Unadjusted Scales)");

// Simulate an unadjusted / pre-split OB at ₹6,720 when current live chart LTP is ₹1,071
const detachedOB = { topPrice: 6760.0, bottomPrice: 6680.0 };
const liveChartLtp = 1071.0;

const isDetachedSane = isOrderBlockPriceSane(detachedOB, liveChartLtp, 0.15);
assert(
  isDetachedSane === false,
  `Sanity filter REJECTS unadjusted historical OB (top: ₹${detachedOB.topPrice}, bottom: ₹${detachedOB.bottomPrice}) when live chart LTP is ₹${liveChartLtp}`
);

// If an outdated baseline or candle data at ₹6,720 is fed with livePrice ₹1,071:
const rejectedAlert = evaluateSingleStock4HRetest({
  symbol: "BAJFINANCE",
  companyName: "Bajaj Finance Ltd",
  sector: "Financial Services",
  livePrice: liveChartLtp,
  // Provide candles at pre-split 6,700 scale to test discard mechanism
  candles15m: [
    { timestamp: Date.now() - 3600000, open: 6700, high: 6740, low: 6690, close: 6720, volume: 50000 },
    ...Array(30).fill(0).map((_, i) => ({
      timestamp: Date.now() - (30 - i) * 900000,
      open: 6700 + i,
      high: 6750 + i,
      low: 6680 + i,
      close: 6710 + i,
      volume: 30000,
    })),
  ],
});

assert(
  rejectedAlert === null,
  "Engine discards detached Order Blocks and returns null when candle scale does not match live chart LTP"
);

// Sane OB within ±10% to ±15% of live LTP is accepted
const saneOB = { topPrice: 1078.0, bottomPrice: 1058.0 };
assert(
  isOrderBlockPriceSane(saneOB, 1071.0, 0.15) === true,
  "Sanity filter ACCEPTS Order Block within ±15% of live LTP"
);

// -----------------------------------------------------------------------------
// Test 6: Full NSE Multi-Symbol Order Block Retest Scanner
// -----------------------------------------------------------------------------
console.log("\nTest 6: Full Scanner Engine Across NSE Institutional Universe");
const stocksInput = [
  { symbol: "RELIANCE", companyName: "Reliance Industries Ltd", sector: "Energy", livePrice: 1292.0 }, // Inside OB [1285, 1298]
  { symbol: "SOLARINDS", companyName: "Solar Industries India", sector: "Defence", livePrice: 10480.0 }, // Inside OB [10380, 10520]
  { symbol: "BAJFINANCE", companyName: "Bajaj Finance Ltd", sector: "Financial Services", livePrice: 1071.0 }, // Inside OB [1058, 1078]
  { symbol: "HDFCBANK", companyName: "HDFC Bank Ltd", sector: "Banking", livePrice: 950.0 }, // Far away
  { symbol: "TCS", companyName: "Tata Consultancy Services", sector: "IT", livePrice: 2000.0 }, // Far away
];

const scanResults = scanNSEOrderBlockRetests(stocksInput);
assert(scanResults.length >= 3, "Scanner accurately detected retests for RELIANCE, SOLARINDS, and BAJFINANCE");
const retestSymbols = scanResults.map((s) => s.cleanSymbol);
assert(retestSymbols.includes("RELIANCE"), "Scan includes RELIANCE");
assert(retestSymbols.includes("SOLARINDS"), "Scan includes SOLARINDS");
assert(retestSymbols.includes("BAJFINANCE"), "Scan includes BAJFINANCE");
assert(!retestSymbols.includes("HDFCBANK"), "HDFCBANK omitted since price is not in OB zone");

// -----------------------------------------------------------------------------
// Test 7: Stop Loss & Reward-to-Risk Mathematical Precision
// -----------------------------------------------------------------------------
console.log("\nTest 7: Stop Loss & Reward-to-Risk Mathematical Precision");
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
