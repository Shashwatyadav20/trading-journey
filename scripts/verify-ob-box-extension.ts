/**
 * Verification Script: SMC PRO+ v6.6 Dynamic Order Block Box Extensions & Boundaries
 *
 * Validates:
 * 1. f_createOB initializes boxes with dynamic right boundary:
 *    rightBarIndex = Math.max(currentBarIndex + 100, ob.originalRightBar + obExtend).
 * 2. Active unbroken Order Block boxes continuously stretch their right boundary into
 *    the future chart viewport, ensuring they never terminate prematurely.
 * 3. Exact height and span match the displacement bounds calculated by smcDualHtfEngine.ts.
 * 4. Broken/invalidated OB boxes lock their right edge at the breaking candle index.
 * 5. Mitigated OB boxes track mitigation touch while preserving active visibility.
 * 6. Dual-HTF detectSMCOrderBlocks seamlessly integrates with f_createOB and f_manageOB.
 */

import {
  detectSMCOrderBlocks,
  f_createOB,
  f_manageOB,
  DEFAULT_OB_EXTEND_BARS,
  type SMCCandle,
  type SMCOrderBlock,
  type SMCOrderBlockBox,
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
console.log("VERIFYING: SMC PRO+ Dynamic Order Block Box Extension Engine (f_createOB / f_manageOB)");
console.log("================================================================================\n");

// -----------------------------------------------------------------------------
// Test 1: f_createOB Initialization & Dynamic Right Boundary
// -----------------------------------------------------------------------------
console.log("Test 1: f_createOB Box Creation & Viewport Right Boundary Extension");
const sampleOB: SMCOrderBlock = {
  id: "OB-GOLD-4H-BULL-1000",
  symbol: "XAUUSD",
  timeframe: "4H",
  direction: "BULLISH",
  candleIndex: 20,
  candleTimestamp: 1700000000000,
  topPrice: 2710.0,
  bottomPrice: 2695.0,
  midpoint: 2702.5,
  displacementBody: 18.0,
  displacementVolume: 45000,
  atr14: 10.0,
  volumeMultiplier: 2.1,
  quality: "Strong",
  ema20: 2690.0,
  emaAligned: true,
  confidenceTag: "✓",
  invalidationType: "Close",
  isMitigated: false,
  isInvalidated: false,
  hasTriggeredEntry: false,
};

const confirmationBarIndex = 22;
const obExtend = 30;
const box = f_createOB(sampleOB, confirmationBarIndex, obExtend);

assert(box.orderBlockId === sampleOB.id, "Box links correctly to orderBlockId");
assert(box.leftBarIndex === 20, "Box leftBarIndex matches OB candleIndex (20)");
assert(box.topPrice === 2710.0, "Box topPrice matches OB topPrice");
assert(box.bottomPrice === 2695.0, "Box bottomPrice matches OB bottomPrice");
assert(box.midpoint === 2702.5, "Box midpoint matches 50% equilibrium");
assert(box.height === 15.0, "Box height matches exact displacement span (2710 - 2695 = 15)");

// Test right boundary: Math.max(22 + 100, 22 + 30) = 122
const expectedRightBar = Math.max(confirmationBarIndex + 100, confirmationBarIndex + obExtend);
assert(box.rightBarIndex === expectedRightBar, `rightBarIndex (${box.rightBarIndex}) matches Math.max(currentBarIndex + 100, ...) = ${expectedRightBar}`);
assert(box.rightBarIndex >= confirmationBarIndex + 100, "Box extends at least 100 bars forward across chart viewport");
assert(box.isInfiniteExtension === true, "isInfiniteExtension is true for active unbroken box");
assert(box.status === "ACTIVE", "Initial status is ACTIVE");

// -----------------------------------------------------------------------------
// Test 2: Dynamic Extension on Subsequent Live Bars (f_manageOB)
// -----------------------------------------------------------------------------
console.log("\nTest 2: Dynamic Continuous Extension as Chart Advances (Live Bar Updates)");

// Advance chart to bar 50 (price staying above OB zone)
const bar50: SMCCandle = {
  timestamp: 1700000000000 + 30 * 4 * 3600 * 1000,
  open: 2720.0,
  high: 2735.0,
  low: 2718.0,
  close: 2730.0,
  volume: 30000,
};

const updatedBoxAt50 = f_manageOB(box, 50, bar50, "Close");
assert(updatedBoxAt50.status === "ACTIVE", "Status remains ACTIVE while unbroken");
assert(updatedBoxAt50.rightBarIndex === 150, "rightBarIndex stretches dynamically to Math.max(50 + 100, ...) = 150");
assert(updatedBoxAt50.rightBarIndex > box.rightBarIndex, "Right edge pushed further into the future");
assert(updatedBoxAt50.isInfiniteExtension === true, "Infinite extension maintained");

// Advance chart to bar 85
const bar85: SMCCandle = {
  timestamp: 1700000000000 + 65 * 4 * 3600 * 1000,
  open: 2735.0,
  high: 2740.0,
  low: 2732.0,
  close: 2738.0,
  volume: 32000,
};

const updatedBoxAt85 = f_manageOB(updatedBoxAt50, 85, bar85, "Close");
assert(updatedBoxAt85.rightBarIndex === 185, "rightBarIndex stretches dynamically to Math.max(85 + 100, ...) = 185");
assert(updatedBoxAt85.isInvalidated === false, "Box not invalidated");

// -----------------------------------------------------------------------------
// Test 3: Mitigation Tracking Without Premature Termination
// -----------------------------------------------------------------------------
console.log("\nTest 3: Mitigation Handling (Price Touches Zone Without Invalidation)");

// Bar 90 touches the zone (low = 2700, inside 2695 - 2710)
const bar90: SMCCandle = {
  timestamp: 1700000000000 + 70 * 4 * 3600 * 1000,
  open: 2712.0,
  high: 2715.0,
  low: 2700.0, // Touches zone!
  close: 2708.0,
  volume: 50000,
};

const mitigatedBox = f_manageOB(updatedBoxAt85, 90, bar90, "Close");
assert(mitigatedBox.status === "MITIGATED", "Status transitions to MITIGATED");
assert(mitigatedBox.isMitigated === true, "isMitigated set to true");
assert(mitigatedBox.mitigationBarIndex === 90, "mitigationBarIndex recorded at bar 90");
assert(mitigatedBox.mitigationTimestamp === bar90.timestamp, "mitigationTimestamp recorded");
assert(mitigatedBox.rightBarIndex === 190, "Mitigated box STILL stretches to bar 190 (remains visible)");
assert(mitigatedBox.isInfiniteExtension === true, "Preserves infinite extension until broken");

// -----------------------------------------------------------------------------
// Test 4: Invalidation Locking (Right Boundary Stops Extending When Broken)
// -----------------------------------------------------------------------------
console.log("\nTest 4: Invalidation Break (Locks Right Edge at Breaking Candle)");

// Bar 95 breaks below bottomPrice (close = 2690 < 2695)
const bar95: SMCCandle = {
  timestamp: 1700000000000 + 75 * 4 * 3600 * 1000,
  open: 2705.0,
  high: 2706.0,
  low: 2688.0,
  close: 2690.0, // Breaks below bottomPrice!
  volume: 60000,
};

const brokenBox = f_manageOB(mitigatedBox, 95, bar95, "Close");
assert(brokenBox.status === "INVALIDATED", "Status transitions to INVALIDATED");
assert(brokenBox.isInvalidated === true, "isInvalidated set to true");
assert(brokenBox.breakBarIndex === 95, "breakBarIndex recorded at breaking candle (95)");
assert(brokenBox.rightBarIndex === 95, "rightBarIndex locked at breaking candle (95) - extension stops!");
assert(brokenBox.rightTimestamp === bar95.timestamp, "rightTimestamp locked at break timestamp");
assert(brokenBox.isInfiniteExtension === false, "isInfiniteExtension disabled once broken");

// Subsequent bar does NOT stretch the broken box further
const bar100: SMCCandle = {
  timestamp: 1700000000000 + 80 * 4 * 3600 * 1000,
  open: 2692.0,
  high: 2695.0,
  low: 2685.0,
  close: 2688.0,
  volume: 25000,
};

const postBreakBox = f_manageOB(brokenBox, 100, bar100, "Close");
assert(postBreakBox.rightBarIndex === 95, "rightBarIndex stays firmly locked at 95 (no phantom extension)");
assert(postBreakBox.isInvalidated === true, "Remains invalidated");

// -----------------------------------------------------------------------------
// Test 5: Bearish Order Block Invalidation & Extension
// -----------------------------------------------------------------------------
console.log("\nTest 5: Bearish Order Block Lifecycle & Extension");
const bearishOB: SMCOrderBlock = {
  id: "OB-BTC-15M-BEAR-2000",
  symbol: "BTCUSD",
  timeframe: "15M",
  direction: "BEARISH",
  candleIndex: 30,
  candleTimestamp: 1700000000000,
  topPrice: 95500.0,
  bottomPrice: 95100.0,
  midpoint: 95300.0,
  displacementBody: 480.0,
  displacementVolume: 200,
  atr14: 250.0,
  volumeMultiplier: 2.3,
  quality: "Strong",
  ema20: 95700.0,
  emaAligned: true,
  confidenceTag: "✓",
  invalidationType: "Close",
  isMitigated: false,
  isInvalidated: false,
  hasTriggeredEntry: false,
};

const bearBox = f_createOB(bearishOB, 31, 30);
assert(bearBox.rightBarIndex === Math.max(31 + 100, 31 + 30), "Bearish box extends right to 131");
assert(bearBox.height === 400.0, "Bearish box height is exactly 400.00 pts (95500 - 95100)");

// Bar breaking upward (close = 95600 > 95500)
const breakBar: SMCCandle = {
  timestamp: 1700000000000 + 10 * 15 * 60 * 1000,
  open: 95400.0,
  high: 95650.0,
  low: 95380.0,
  close: 95600.0,
  volume: 350,
};

const brokenBearBox = f_manageOB(bearBox, 41, breakBar, "Close");
assert(brokenBearBox.isInvalidated === true, "Bearish OB invalidated on close above topPrice");
assert(brokenBearBox.rightBarIndex === 41, "Bearish OB locked at break bar 41");

// -----------------------------------------------------------------------------
// Test 6: Full Dual-HTF detectSMCOrderBlocks Integration with f_createOB / f_manageOB
// -----------------------------------------------------------------------------
console.log("\nTest 6: detectSMCOrderBlocks Integrated Box Pipeline");

// Build 30 candles with a clear bullish displacement at index 23
const candles: SMCCandle[] = [];
for (let i = 0; i < 30; i++) {
  const isOpposite = i === 22;
  const isDisplacement = i === 23;
  const open = isOpposite ? 100.0 : isDisplacement ? 99.0 : i > 23 ? 103.0 + (i - 23) * 0.2 : 95.0 + i * 0.1;
  const close = isOpposite ? 99.0 : isDisplacement ? 103.0 : open + 0.1; // Big green candle at 23, then stays above OB!
  const high = Math.max(open, close) + 0.5;
  const low = Math.min(open, close) - 0.2;
  const volume = isDisplacement ? 50000 : 10000;
  candles.push({ timestamp: 1700000000000 + i * 15 * 60 * 1000, open, high, low, close, volume });
}

const detectedOBs = detectSMCOrderBlocks("XAUUSD", candles, "15M");
assert(detectedOBs.length > 0, "detectSMCOrderBlocks detected displacement OB");

const targetOB = detectedOBs[0];
assert(targetOB.box !== undefined, "Detected OB automatically has box attached");
if (targetOB.box) {
  assert(targetOB.box.leftBarIndex === targetOB.candleIndex, "box.leftBarIndex matches candleIndex");
  assert(targetOB.box.topPrice === targetOB.topPrice, "box.topPrice matches OB topPrice");
  assert(targetOB.box.bottomPrice === targetOB.bottomPrice, "box.bottomPrice matches OB bottomPrice");
  assert(targetOB.box.height === Number((targetOB.topPrice - targetOB.bottomPrice).toFixed(2)), "box.height matches displacement height");
  assert(
    targetOB.box.rightBarIndex >= candles.length + 90,
    `Active unbroken box stretches beyond current chart bar (${targetOB.box.rightBarIndex} >= ${candles.length + 90})`
  );
  assert(targetOB.box.isInfiniteExtension === true, "Active box has infinite extension enabled");
}

console.log("\n================================================================================");
console.log(`ALL TESTS PASSED! (${passedCount}/${totalCount} assertions successful)`);
console.log("================================================================================\n");
