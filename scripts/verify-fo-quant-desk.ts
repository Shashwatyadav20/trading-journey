import {
  FO_UNIVERSE,
  buildResilientFOCandles,
  evaluateFOScannerSetup,
  buildStrategyLegsAndDetails,
  calculateSpreadPayoffAndMargin,
} from "../lib/indian/foQuantEngine.ts";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`✅ PASS: ${label}`);
    passed++;
  } else {
    console.error(`❌ FAIL: ${label}`);
    failed++;
  }
}

console.log("=== VERIFYING F&O QUANT DESK ENGINE ===");

// 1. Verify NIFTY & BANKNIFTY Index Derivatives + Stock F&O Universe
const niftySpec = FO_UNIVERSE.find((u) => u.cleanSymbol === "NIFTY")!;
const bnfSpec = FO_UNIVERSE.find((u) => u.cleanSymbol === "BANKNIFTY")!;
assert(Boolean(niftySpec && niftySpec.lotSize === 75), "NIFTY Index spec present with Lot Size 75");
assert(Boolean(bnfSpec && bnfSpec.lotSize === 30), "BANKNIFTY Index spec present with Lot Size 30");

// 2. Verify Strategy Matcher across all 3 Market Structure Regimes
const rangeCandles = buildResilientFOCandles(niftySpec, "RANGE_BOUND");
const rangeSetup = evaluateFOScannerSetup(niftySpec, rangeCandles, "2026-11-08-RANGE");
assert(
  rangeSetup.marketRegime === "RANGE_BOUND" &&
    rangeSetup.strategyCode === "HEDGED_IRON_CONDOR" &&
    rangeSetup.legs.length === 4,
  `RANGE_BOUND matches 4-leg Hedged Iron Condor (PoP: ${rangeSetup.payoffMetrics.probabilityOfProfitPct}%)`
);

const bounceCandles = buildResilientFOCandles(bnfSpec, "SUPPORT_BOUNCE");
const bounceSetup = evaluateFOScannerSetup(bnfSpec, bounceCandles, "2026-11-08-BOUNCE");
assert(
  bounceSetup.marketRegime === "SUPPORT_BOUNCE" &&
    bounceSetup.strategyCode === "BULL_PUT_CREDIT_SPREAD" &&
    bounceSetup.payoffMetrics.isNetCredit === true,
  `SUPPORT_BOUNCE matches Bull Put Credit Spread with Net Credit ₹${bounceSetup.payoffMetrics.netPremiumTotalINR}`
);

const breakoutSpec = FO_UNIVERSE.find((u) => u.cleanSymbol === "HAL")!;
const breakoutCandles = buildResilientFOCandles(breakoutSpec, "BREAKOUT_DOJI_SQUEEZE");
const breakoutSetup = evaluateFOScannerSetup(breakoutSpec, breakoutCandles, "2026-11-08-BREAKOUT");
assert(
  breakoutSetup.marketRegime === "BREAKOUT_DOJI_SQUEEZE" &&
    breakoutSetup.strategyCode === "BULL_CALL_DEBIT_SPREAD",
  `BREAKOUT_DOJI_SQUEEZE matches Bull Call Debit Spread (Max Profit ₹${breakoutSetup.payoffMetrics.maxProfitINR})`
);

// 3. Verify Option Chain & Institutional OI Wall Alignment with Purple Box VAL/VAH
const valRow = rangeSetup.optionChain.strikes.find((s) => s.alignsWithVALSupport);
const vahRow = rangeSetup.optionChain.strikes.find((s) => s.alignsWithVAHResistance);
assert(
  Boolean(valRow && valRow.institutionalZoneTag === "VAL_PUT_WALL_CONFLUENCE" && valRow.peChangeInOIPct > 25),
  `Option Chain highlights VAL Put Wall Confluence at strike ${valRow?.strike} (ΔOI +${valRow?.peChangeInOIPct}%)`
);
assert(
  Boolean(vahRow && vahRow.institutionalZoneTag === "VAH_CALL_WALL_CONFLUENCE" && vahRow.ceChangeInOIPct > 25),
  `Option Chain highlights VAH Call Wall Confluence at strike ${vahRow?.strike} (ΔOI +${vahRow?.ceChangeInOIPct}%)`
);

// 4. Verify Spread Payoff Simulator & Margin Risk Limits
const ratioBuilt = buildStrategyLegsAndDetails(
  "CALL_RATIO_BACKSPREAD",
  niftySpec,
  rangeSetup.spotPrice,
  rangeSetup.purpleBox,
  rangeSetup.optionChain,
  2
);
const ratioMetrics = calculateSpreadPayoffAndMargin(
  ratioBuilt.legs,
  rangeSetup.spotPrice,
  rangeSetup.purpleBox,
  niftySpec,
  rangeSetup.daysToExpiry
);
assert(
  ratioMetrics.payoffCurve.length > 50 &&
    ratioMetrics.estimatedMarginRequiredINR > 0 &&
    ratioMetrics.probabilityOfProfitPct > 0,
  `Payoff Simulator computes 89-point curve, Breakeven ₹${ratioMetrics.lowerBreakeven}, Margin ₹${ratioMetrics.estimatedMarginRequiredINR}`
);

// 5. Verify Same-Day Price Freeze Cache
const cachedSetup = evaluateFOScannerSetup(niftySpec, bounceCandles, "2026-11-08-RANGE");
assert(
  cachedSetup.spotPrice === rangeSetup.spotPrice &&
    cachedSetup.payoffMetrics.netPremiumPerUnit === rangeSetup.payoffMetrics.netPremiumPerUnit,
  "Same-Day Price Freeze cache keeps spot, strikes, and net premium locked for identical dateKey"
);

console.log(`\nSummary: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);

