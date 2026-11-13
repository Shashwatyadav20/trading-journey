import assert from "node:assert";
import {
  cleanNseSymbol,
  computeInstitutionalConviction,
  synthesizeGroundedResearchAnswer,
  type CompanyResearchReport,
} from "../lib/ai/companyResearchEngine";

console.log("================================================================================");
console.log("VERIFYING: AI Research & Company Intelligence Engine (Zero Mock Data)");
console.log("================================================================================");

// 1. Symbol normalization
assert.strictEqual(cleanNseSymbol("NSE:reliance.ns"), "RELIANCE", "Normalizes NSE:reliance.ns -> RELIANCE");
assert.strictEqual(cleanNseSymbol("BAJFINANCE.BO"), "BAJFINANCE", "Normalizes BAJFINANCE.BO -> BAJFINANCE");
console.log("  ✓ PASS: Symbol normalization verified.");

// 2. Conviction scoring with strong fundamentals + 4H Bullish OB + Above VWAP
const strongConviction = computeInstitutionalConviction(
  {
    trailingPE: 24.5,
    forwardPE: 21.0,
    priceToBook: 3.1,
    roePct: 22.4,
    roaPct: 11.2,
    debtToEquity: 0.35,
    quarterlyRevenueGrowthPct: 18.5,
    quarterlyEarningsGrowthPct: 20.1,
    operatingMarginPct: 19.0,
    profitMarginPct: 14.2,
    marketCapCr: 1850000,
    fiftyTwoWeekHigh: 1600,
    fiftyTwoWeekLow: 1150,
    sector: "Energy",
    industry: "Oil & Gas",
  },
  {
    institutionsPercentHeld: 38.5,
    insidersPromoterPercentHeld: 50.2,
    institutionsFloatPercentHeld: 65.0,
    institutionsCount: 1250,
    topHolders: [],
    trendLabel: "HIGH_INSTITUTIONAL",
  },
  {
    ltp: 1320,
    changePct: 1.4,
    vwap: 1305,
    priceVsVwapPct: 1.15,
    vwapAlignment: "ABOVE_VWAP",
    ema20: 1295,
    ema20Alignment: "BULLISH",
    orderBlock4H: {
      direction: "BULLISH",
      bottomPrice: 1300,
      topPrice: 1325,
      retestActive: true,
      quality: "STRONG",
      proximityPct: 0.57,
    },
  },
  35,
  false
);

assert(strongConviction.overallScore >= 75, `Strong setup achieves HIGH_CONVICTION_BUY (${strongConviction.overallScore}%)`);
assert.strictEqual(strongConviction.grade, "HIGH_CONVICTION_BUY", "Grade is HIGH_CONVICTION_BUY");
console.log(`  ✓ PASS: Institutional Conviction Score computed (${strongConviction.overallScore}% - ${strongConviction.grade}).`);

// 3. Zero-Mock Null Safety: When fundamentals are null (feed unavailable), answer states N/A instead of faking numbers
const partialReport: CompanyResearchReport = {
  symbol: "RELIANCE.NS",
  cleanSymbol: "RELIANCE",
  companyName: "Reliance Industries Ltd",
  fetchedAtIST: "09:10:00 IST",
  fundamentals: {
    trailingPE: null,
    forwardPE: null,
    priceToBook: null,
    roePct: null,
    roaPct: null,
    debtToEquity: null,
    quarterlyRevenueGrowthPct: null,
    quarterlyEarningsGrowthPct: null,
    operatingMarginPct: null,
    profitMarginPct: null,
    marketCapCr: null,
    fiftyTwoWeekHigh: null,
    fiftyTwoWeekLow: null,
    sector: null,
    industry: null,
  },
  institutionalHoldings: {
    institutionsPercentHeld: null,
    insidersPromoterPercentHeld: null,
    institutionsFloatPercentHeld: null,
    institutionsCount: null,
    topHolders: [],
    trendLabel: "LOW_OR_UNAVAILABLE",
  },
  technicals: {
    ltp: 1280,
    changePct: 0.5,
    vwap: 1275,
    priceVsVwapPct: 0.39,
    vwapAlignment: "ABOVE_VWAP",
    ema20: 1270,
    ema20Alignment: "BULLISH",
    orderBlock4H: {
      direction: "NONE",
      bottomPrice: null,
      topPrice: null,
      retestActive: false,
      quality: "NONE",
      proximityPct: null,
    },
  },
  newsAndMacro: [],
  newsSentimentScore: 0,
  sentimentLabel: "NEUTRAL",
  catalysts: [],
  riskWarnings: [],
  macroFlags: {
    hasRbiMention: false,
    hasCpiInflationMention: false,
    hasSebiRegulatoryMention: false,
  },
  conviction: computeInstitutionalConviction(
    {
      trailingPE: null,
      forwardPE: null,
      priceToBook: null,
      roePct: null,
      roaPct: null,
      debtToEquity: null,
      quarterlyRevenueGrowthPct: null,
      quarterlyEarningsGrowthPct: null,
      operatingMarginPct: null,
      profitMarginPct: null,
      marketCapCr: null,
      fiftyTwoWeekHigh: null,
      fiftyTwoWeekLow: null,
      sector: null,
      industry: null,
    },
    {
      institutionsPercentHeld: null,
      insidersPromoterPercentHeld: null,
      institutionsFloatPercentHeld: null,
      institutionsCount: null,
      topHolders: [],
      trendLabel: "LOW_OR_UNAVAILABLE",
    },
    {
      ltp: 1280,
      changePct: 0.5,
      vwap: 1275,
      priceVsVwapPct: 0.39,
      vwapAlignment: "ABOVE_VWAP",
      ema20: 1270,
      ema20Alignment: "BULLISH",
      orderBlock4H: {
        direction: "NONE",
        bottomPrice: null,
        topPrice: null,
        retestActive: false,
        quality: "NONE",
        proximityPct: null,
      },
    },
    0,
    false
  ),
  dataTelemetry: {
    fundamentalsSource: "YAHOO_CHART_ONLY_UNAVAILABLE",
    technicalsSource: "YAHOO_4H_VWAP_LIVE",
    newsSource: "NO_HEADLINES_RETURNED",
    zeroMockIntegrity: true,
  },
};

const fundamentalAnswer = synthesizeGroundedResearchAnswer(partialReport, "Check FII holding and PE ROE");
assert(fundamentalAnswer.includes("N/A (unavailable from live feed)"), "Unavailable metrics reported as N/A without fabrication");
console.log("  ✓ PASS: Zero-Mock null safety verified in grounded AI Q&A.");

console.log("\n================================================================================");
console.log("ALL TESTS PASSED! AI Research & Company Intelligence Engine verified.");
console.log("================================================================================");
