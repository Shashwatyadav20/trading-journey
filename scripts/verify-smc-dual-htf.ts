import {
  detectSMCOrderBlocks,
  aggregateCandlesTo4H,
  evaluateSMCOrderBlockRetests,
  calculateATRSeries,
  calculateVolumeSMASeries,
  calculateEMASeries,
  DEFAULT_SMC_CONFIG,
} from "../lib/forex/smcDualHtfEngine.ts";
import type {
  SMCCandle,
  SMCOrderBlock,
  SMCRetestSetup,
} from "../lib/forex/smcDualHtfEngine.ts";

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
console.log("SMC PRO+ v6.6-FixedDualHTF ORDER BLOCK ENGINE VERIFICATION SUITE");
console.log("====================================================================\n");

// ─── 1. Build Base Candle Sequence ───────────────────────────────────────────
// 22 baseline candles to establish stable ATR(14), Volume SMA(20), and EMA(20)
const baseCandles: SMCCandle[] = [];
const startMs = Date.now() - 35 * 15 * 60 * 1000;

for (let i = 0; i < 22; i++) {
  baseCandles.push({
    timestamp: startMs + i * 15 * 60 * 1000,
    open: 2700 + (i % 2 === 0 ? 1 : -1),
    high: 2702,
    low: 2698,
    close: 2700 + (i % 2 === 0 ? -1 : 1),
    volume: 10000, // baseline 20-period volume SMA is ~10,000
  });
}

// ─── 2. Test Bullish Displacement & Order Block Detection ────────────────────
// Candidate OB: Bar 22 is a bearish candle (down candle)
const obBearishCandle: SMCCandle = {
  timestamp: startMs + 22 * 15 * 60 * 1000,
  open: 2704,
  high: 2706,
  low: 2698,
  close: 2700, // Red/bearish candle
  volume: 12000,
};

// Displacement Trigger: Bar 23 is a massive bullish candle (body = 12 pts > 1.5x ATR, close 2712 > prev.high 2706)
// Volume = 22,000 > 1.4x 10,000 (volumeMultiplier = 2.2x)
const displacementBullishCandle: SMCCandle = {
  timestamp: startMs + 23 * 15 * 60 * 1000,
  open: 2700,
  high: 2713,
  low: 2699,
  close: 2712, // Green candle breaking above 2706
  volume: 22000, // 2.2x volume surge
};

const bullishTestSeries = [...baseCandles, obBearishCandle, displacementBullishCandle];
const detectedBullishOBs = detectSMCOrderBlocks("XAUUSD", bullishTestSeries, "15M", {
  invalidationType: "Close",
  displacementMultiplier: 1.5,
  minBodyRatio: 0.35,
  volumeMultiplierThreshold: 1.4,
});

assert(detectedBullishOBs.length >= 1, "Bullish Order Block detected from displacement breakout");
const bullOB = detectedBullishOBs[0];
assert(bullOB.direction === "BULLISH", "Order block direction classified as BULLISH");
assert(bullOB.topPrice === 2706 && bullOB.bottomPrice === 2698, "OB boundary matches previous opposite candle (2698 - 2706)");
assert(bullOB.midpoint === 2702, "50% equilibrium midpoint calculated at 2702.00");
assert(bullOB.volumeMultiplier >= 1.4, `Volume confirmation verified (${bullOB.volumeMultiplier}x >= 1.4x)`);
assert(bullOB.quality === "Strong", `Quality classified as Strong (actual: ${bullOB.quality})`);
assert(bullOB.confidenceTag === "✓", "Trend-aligned with 20 EMA assigned confidence check '✓'");

// ─── 3. Test Bearish Displacement & Order Block Detection ────────────────────
const obBullishCandle: SMCCandle = {
  timestamp: startMs + 22 * 15 * 60 * 1000,
  open: 2700,
  high: 2708,
  low: 2699,
  close: 2707, // Green/bullish candle
  volume: 11000,
};

const displacementBearishCandle: SMCCandle = {
  timestamp: startMs + 23 * 15 * 60 * 1000,
  open: 2707,
  high: 2708,
  low: 2692,
  close: 2693, // Red candle breaking below prev.low 2699
  volume: 24000, // > 1.4x volume
};

const bearishTestSeries = [...baseCandles, obBullishCandle, displacementBearishCandle];
const detectedBearishOBs = detectSMCOrderBlocks("XAUUSD", bearishTestSeries, "15M", {
  invalidationType: "Close",
  displacementMultiplier: 1.5,
  minBodyRatio: 0.35,
});

assert(detectedBearishOBs.length >= 1, "Bearish Order Block detected from downward displacement");
const bearOB = detectedBearishOBs[0];
assert(bearOB.direction === "BEARISH", "Order block direction classified as BEARISH");
assert(bearOB.topPrice === 2708 && bearOB.bottomPrice === 2699, "OB boundary matches previous opposite candle (2699 - 2708)");
assert(bearOB.confidenceTag === "✓", "Bearish displacement below EMA20 assigned confidence check '✓'");

// ─── 4. Test Invalidation Filter (Close vs Wick) ─────────────────────────────
// Add candle that wicks below 2698 but closes above (e.g. low 2696, close 2701)
const wickPiercingCandle: SMCCandle = {
  timestamp: startMs + 24 * 15 * 60 * 1000,
  open: 2708,
  high: 2709,
  low: 2696, // Wicks below OB bottom (2698)
  close: 2701, // Closes inside OB zone
  volume: 12000,
};

// Under "Close" invalidation rule, wick does NOT invalidate
const closeRuleSeries = [...bullishTestSeries, wickPiercingCandle];
const obsUnderCloseRule = detectSMCOrderBlocks("XAUUSD", closeRuleSeries, "15M", {
  invalidationType: "Close",
});
assert(!obsUnderCloseRule[0].isInvalidated, "In 'Close' invalidation mode, wick piercing does not invalidate OB");

// Under "Wick" invalidation rule, wick DOES invalidate
const obsUnderWickRule = detectSMCOrderBlocks("XAUUSD", closeRuleSeries, "15M", {
  invalidationType: "Wick",
});
assert(obsUnderWickRule[0].isInvalidated, "In 'Wick' invalidation mode, wick piercing correctly marks isInvalidated = true");

// ─── 5. Test 4H HTF Aggregation (240m from 15m) ──────────────────────────────
const fourHourBucket = Math.floor(1700000000000 / (4 * 3600 * 1000)) * (4 * 3600 * 1000);
const sixteenCandles15m: SMCCandle[] = Array.from({ length: 16 }, (_, i) => ({
  timestamp: fourHourBucket + i * 15 * 60 * 1000,
  open: 100 + i,
  high: 105 + i,
  low: 95 + i,
  close: 101 + i,
  volume: 1000,
}));

const aggregated4H = aggregateCandlesTo4H(sixteenCandles15m);
assert(aggregated4H.length === 1, "16 15-minute candles aggregated into exactly 1 4-Hour (240m) candle");
assert(aggregated4H[0].open === sixteenCandles15m[0].open, "4H Open matches first 15m Open");
assert(aggregated4H[0].close === sixteenCandles15m[15].close, "4H Close matches last 15m Close");
assert(aggregated4H[0].volume === 16000, "4H Volume matches sum of all 15m volumes (16,000)");

// ─── 6. Test Order Block Retest & Strict 1:2.5 RR Calculation ────────────────
const retestSetups = evaluateSMCOrderBlockRetests(
  "XAUUSD",
  2704.5, // Live price entered inside OB zone (2698 - 2706)
  [bullOB],
  { riskRewardRatio: 2.6 }
);

assert(retestSetups.length === 1, "SMC Order Block Retest trigger generated");
const setup = retestSetups[0];
assert(setup.isInRetestZone, "Price confirmed inside 15M OB retest zone");
assert(setup.entryPrice === 2704.5, "Locked entry price matches live market price ($2704.50)");
assert(setup.stopLossPrice < bullOB.bottomPrice, "Stop loss placed safely below OB bottom boundary");
assert(setup.rewardRiskRatio >= 2.5, `Risk-to-Reward ratio satisfies strict institutional requirement (actual: 1:${setup.rewardRiskRatio})`);
assert(setup.confidenceTag === "✓", "Retest inherits '✓' EMA trend alignment tag");
assert(setup.quality === "Strong", "Retest inherits 'Strong' Quality score");

// ─── 7. Test Single-Entry Per OB Protection ──────────────────────────────────
// Mark order block as hasTriggeredEntry = true
bullOB.hasTriggeredEntry = true;
const secondRetestAttempt = evaluateSMCOrderBlockRetests("XAUUSD", 2704.5, [bullOB]);
assert(secondRetestAttempt.length === 0, "Single-entry per OB protection prevents repetitive duplicate signals");

console.log("\n====================================================================");
console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
console.log("====================================================================");

if (failed > 0) {
  process.exit(1);
}
