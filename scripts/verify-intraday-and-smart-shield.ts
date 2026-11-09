import {
  evaluateIntradayMomentumSetup,
  evaluateActiveTradeSmartShield,
  checkIntradaySquareOffWindow,
} from "../lib/indian/intradayEngine.ts";
import {
  scoreFinancialHeadlineSentiment,
  evaluateCombinedNewsAndReversalShield,
  generateMicrostructureNewsFallback,
  computeReportContentHash,
} from "../lib/indian/aiNewsReversalEngine.ts";

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
console.log("INTRADAY QUANT DESK & SMART REVERSAL / NEWS SHIELD VERIFICATION");
console.log("====================================================================\n");

// 1. Test Intraday LONG Setup (9:15-9:45 ORB + VWAP Volume Surge + 5m Doji Squeeze)
const solarLong = evaluateIntradayMomentumSetup({
  symbol: "SOLARINDS",
  companyName: "Solar Industries India",
  sector: "Defense & Explosives",
  liveLtp: 10520,
  todayOpen: 10360,
  todayHigh: 10545,
  todayLow: 10340,
  todayVolume: 2400000,
  avgDailyVolume: 950000,
  prevClose: 10350,
});

assert(solarLong !== null, "Intraday LONG setup generated for SOLARINDS");
assert(solarLong?.direction === "LONG", "SOLARINDS classified as Intraday LONG above 5m VWAP");
assert(
  (solarLong?.orbHigh915_945 ?? 0) > (solarLong?.orbLow915_945 ?? 0),
  "9:15 AM - 9:45 AM Opening Range (ORB High > ORB Low) computed accurately"
);
assert(
  solarLong?.entryPrice === 10520 && (solarLong?.targetPrice ?? 0) > 10520 && (solarLong?.stopLossPrice ?? 0) < 10520,
  "Intraday LONG locks Entry at exact Live LTP with valid SL and Target"
);

// 2. Test Intraday SHORT Setup
const shortSetup = evaluateIntradayMomentumSetup({
  symbol: "TATAMOTORS",
  companyName: "Tata Motors",
  sector: "Automobiles",
  liveLtp: 795,
  todayOpen: 814,
  todayHigh: 816,
  todayLow: 792,
  todayVolume: 5200000,
  avgDailyVolume: 2100000,
  prevClose: 812,
});

assert(shortSetup !== null && shortSetup.direction === "SHORT", "Intraday SHORT setup generated below 5m VWAP & ORB Low");
assert(
  (shortSetup?.targetPrice ?? 999) < 795 && (shortSetup?.stopLossPrice ?? 0) > 795,
  "Intraday SHORT sets Target below Entry and Stop-Loss above Entry"
);

// 3. Test Automated Profit Locking (TSL to Cost / Breakeven at >= 70% Target Distance)
// Entry = 1000, StopLoss = 970, Target = 1100 (Target Distance = 100 pts; 70% = 1070)
const shieldAt75Pct = evaluateActiveTradeSmartShield({
  symbol: "SOLARINDS",
  direction: "LONG",
  entryPrice: 1000,
  stopLossPrice: 970,
  targetPrice: 1100,
  currentPrice: 1075,
  peakPrice: 1075,
  quantity: 100,
});

assert(
  shieldAt75Pct.targetProgressPct === 75 && shieldAt75Pct.shouldLockTslToCost === true,
  "Smart Shield detects 75% target distance (>= 70% threshold) and activates TSL-to-Cost"
);
assert(
  shieldAt75Pct.updatedStopLossPrice === 1000,
  "Smart Shield automatically trails Stop-Loss from ₹970 to Entry Price ₹1000 (Breakeven)"
);

// 4. Test Automated Reversal Exit (Solar Industries reaches near target 85% = ₹1085, then prints exhaustion reversal to ₹1068)
const shieldReversal = evaluateActiveTradeSmartShield({
  symbol: "SOLARINDS",
  direction: "LONG",
  entryPrice: 1000,
  stopLossPrice: 970,
  targetPrice: 1100,
  currentPrice: 1068, // -1.56% pullback off ₹1085 peak
  peakPrice: 1085,    // 85% of target distance reached
  quantity: 100,
});

assert(
  shieldReversal.shouldAutoExit === true && shieldReversal.autoExitTag === "REVERSAL_EXIT",
  "Near-target volume exhaustion pullback automatically triggers REVERSAL_EXIT to lock in gains"
);

// 5. Test Automated Breaking News Catalyst Exit (NEWS_TRIGGER_EXIT)
const shieldNewsExit = evaluateActiveTradeSmartShield({
  symbol: "HAL",
  direction: "LONG",
  entryPrice: 4300,
  stopLossPrice: 4180,
  targetPrice: 4550,
  currentPrice: 4340,
  peakPrice: 4360,
  quantity: 50,
  forcedCatalyst: {
    type: "NEGATIVE_NEWS",
    headline: "High-impact adverse catalyst detected on exchange feed",
  },
});

assert(
  shieldNewsExit.shouldAutoExit === true && shieldNewsExit.autoExitTag === "NEWS_TRIGGER_EXIT",
  "High-impact negative news catalyst automatically triggers NEWS_TRIGGER_EXIT"
);

// 6. Test Mandatory 3:15 PM IST Auto-Square-Off Window Detection
// 15:18 IST = 09:48 UTC
const sim318PmIst = new Date(Date.UTC(2026, 10, 9, 9, 48, 0));
const sqOffCheck = checkIntradaySquareOffWindow(sim318PmIst);
assert(
  sqOffCheck.isAutoSquareOffWindow === true,
  "Mandatory 3:15 PM IST auto-square-off window accurately triggers at 15:18 IST"
);

// 7. Test AI News & Reversal Reader Engine (scoreFinancialHeadlineSentiment & evaluateCombinedNewsAndReversalShield)
const cleanHeadline = scoreFinancialHeadlineSentiment({
  title: "Solar Industries order win of Rs 1,250 Cr defense contract with strong margin expansion",
  publisher: "NSE Corporate Filing",
  publishedAt: "10:15:00",
});
assert(
  cleanHeadline.sentimentScore > 0 && cleanHeadline.sentimentCategory === "POSITIVE",
  "AI News Lexicon scores positive order win & margin expansion headline as POSITIVE (>0)"
);

const cleanReport = evaluateCombinedNewsAndReversalShield({
  symbol: "SOLARINDS",
  headlines: [cleanHeadline],
  tradeContext: {
    symbol: "SOLARINDS",
    direction: "LONG",
    entryPrice: 10000,
    targetPrice: 10800,
    stopLossPrice: 9700,
    currentPrice: 10300,
    peakPrice: 10320,
  },
  liveLtp: 10300,
  todayHigh: 10340,
  todayLow: 9980,
  todayOpen: 10010,
  volumeSpikeMultiplier: 1.4,
  changePercent: 2.9,
});
assert(
  (cleanReport.shieldStatus === "CLEAN" || cleanReport.shieldStatus === "BULLISH_CATALYST") &&
    cleanReport.shouldAutoExit === false &&
    cleanReport.badgeText.includes("🟢 Clean"),
  "AI Sentiment Shield outputs '🟢 Clean' badge with shouldAutoExit=false for healthy news flow"
);

const adverseHeadline = scoreFinancialHeadlineSentiment({
  title: "Breaking: SEBI notice and earnings miss after guidance cut triggers downgrade",
  publisher: "Exchange Regulatory Wire",
  publishedAt: "11:20:00",
});
assert(
  adverseHeadline.sentimentScore <= -50 && adverseHeadline.sentimentCategory === "CRITICAL_NEGATIVE",
  "AI News Lexicon detects critical negative regulatory warning / earnings miss / downgrade"
);

const catalystExitReport = evaluateCombinedNewsAndReversalShield({
  symbol: "INFY",
  headlines: [adverseHeadline],
  tradeContext: {
    symbol: "INFY",
    direction: "LONG",
    entryPrice: 1500,
    targetPrice: 1620,
    stopLossPrice: 1450,
    currentPrice: 1490,
    peakPrice: 1585,
  },
  liveLtp: 1490,
  todayHigh: 1595,
  todayLow: 1480,
  todayOpen: 1510,
  volumeSpikeMultiplier: 3.1,
  changePercent: -2.4,
});
assert(
  catalystExitReport.shouldAutoExit === true &&
    catalystExitReport.exitStatusTag === "NEWS_TRIGGER_EXIT" &&
    catalystExitReport.badgeText.includes("⚠️"),
  "AI News & Reversal Worker automatically triggers NEWS_TRIGGER_EXIT and '⚠️ Catalyst Alert' badge on high-impact negative catalyst"
);

// 8. Test Dynamic Microstructure Fallback Uniqueness (No Static Cloned Sentences)
const relianceFallback = generateMicrostructureNewsFallback({
  symbol: "RELIANCE",
  companyName: "Reliance Industries",
  liveLtp: 1305,
  todayOpen: 1290,
  todayHigh: 1312,
  todayLow: 1288,
  changePercent: 1.16,
  volumeMultiplier: 2.1,
  direction: "LONG",
});

const sbinFallback = generateMicrostructureNewsFallback({
  symbol: "SBIN",
  companyName: "State Bank of India",
  liveLtp: 812,
  todayOpen: 825,
  todayHigh: 826,
  todayLow: 810,
  changePercent: -1.58,
  volumeMultiplier: 1.8,
  direction: "SHORT",
});

const solarFallback = generateMicrostructureNewsFallback({
  symbol: "SOLARINDS",
  companyName: "Solar Industries India",
  liveLtp: 10480,
  todayOpen: 10450,
  todayHigh: 10520,
  todayLow: 10440,
  changePercent: 0.28,
  volumeMultiplier: 1.1,
  direction: "LONG",
});

assert(
  relianceFallback.title !== sbinFallback.title &&
    relianceFallback.title !== solarFallback.title &&
    sbinFallback.title !== solarFallback.title,
  "Microstructure fallbacks generate completely distinct, tailored narratives across RELIANCE, SBIN, and SOLARINDS"
);

assert(
  !relianceFallback.title.includes("breaks 9:15–9:45 ORB high with 1.45x") &&
    !sbinFallback.title.includes("breaks 9:15–9:45 ORB high with 1.45x"),
  "Microstructure fallbacks eliminated the repetitive static 'breaks 9:15-9:45 ORB high with 1.45x' template"
);

// 9. Test Content-Hash Stability for Preventing Redundant Timestamp Loops
const hash1 = computeReportContentHash({
  symbol: "RELIANCE",
  topHeadline: relianceFallback.title,
  sentimentScore: 25,
  shieldStatus: "BULLISH_CATALYST",
  shouldAutoExit: false,
  badgeText: "🟢 Clean (Bullish Flow)",
});

const hash2 = computeReportContentHash({
  symbol: "RELIANCE",
  topHeadline: relianceFallback.title,
  sentimentScore: 25,
  shieldStatus: "BULLISH_CATALYST",
  shouldAutoExit: false,
  badgeText: "🟢 Clean (Bullish Flow)",
});

const hashChanged = computeReportContentHash({
  symbol: "RELIANCE",
  topHeadline: "Breaking: New regulatory penalty announced",
  sentimentScore: -45,
  shieldStatus: "CRITICAL_NEWS_EXIT",
  shouldAutoExit: true,
  badgeText: "⚠️ Catalyst Alert · Auto-Exit",
});

assert(hash1 === hash2, "Content-hash remains identical when headline and sentiment are unchanged");
assert(hash1 !== hashChanged, "Content-hash updates immediately when new breaking headline/catalyst occurs");

// 10. Test Interactive Trade Exit Audit Seeds (POLYCAB, PGEL, SUNPHARMA)
const { DEFAULT_CLOSED_TRADE_AUDIT_SEEDS } = await import("../lib/indian/backtestSeeds.ts");
const polycab = DEFAULT_CLOSED_TRADE_AUDIT_SEEDS.find((t) => t.cleanSymbol === "POLYCAB");
const pgel = DEFAULT_CLOSED_TRADE_AUDIT_SEEDS.find((t) => t.cleanSymbol === "PGEL");
const sunpharma = DEFAULT_CLOSED_TRADE_AUDIT_SEEDS.find((t) => t.cleanSymbol === "SUNPHARMA");

assert(
  polycab !== undefined && polycab.status === "NEWS_TRIGGER_EXIT" && (polycab.exitSentimentScore ?? 0) <= -40,
  "POLYCAB seed verified with NEWS_TRIGGER_EXIT and critical negative sentiment score"
);
assert(
  Boolean(polycab?.exitHeadline && polycab?.exitPublisher && polycab?.volumeSpikeMultiplier),
  "POLYCAB contains complete exit audit details (scraped headline, publisher, volume spike ratio)"
);

assert(
  pgel !== undefined && pgel.status === "REVERSAL_EXIT" && (pgel.targetProgressPct ?? 0) >= 80,
  "PGEL seed verified with REVERSAL_EXIT and near-target exhaustion microstructure"
);

assert(
  sunpharma !== undefined && sunpharma.status === "TARGET_HIT" && (sunpharma.pnlAmount ?? 0) > 0,
  "SUNPHARMA seed verified with TARGET_HIT and positive realized P&L"
);

console.log(`\n====================================================================`);
console.log(`TEST RESULTS: ${passed}/${passed + failed} PASSED (${failed === 0 ? "100% SUCCESS" : `${failed} FAILED`})`);
console.log(`====================================================================`);

if (failed > 0) process.exit(1);

