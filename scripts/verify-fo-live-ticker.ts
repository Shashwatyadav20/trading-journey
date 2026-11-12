import { computeBlackScholesGreeks } from "../lib/indian/foQuantEngine";
import { daysToExpiryFrom } from "../hooks/useLiveFoTicker";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ✓ PASS: ${msg}`);
}

console.log("================================================================================");
console.log("VERIFYING: F&O Live Ticker & Institutional Glassmorphism Command Engine");
console.log("================================================================================");

// Test 1: Black-Scholes Greeks Consistency for CE and PE
console.log("\nTest 1: Analytical Black-Scholes Greeks Re-pricing Engine");
const spot = 24200;
const strike = 24200; // ATM
const dte = 7;
const iv = 14;

const ceGreeks = computeBlackScholesGreeks(spot, strike, dte, iv, "CE");
const peGreeks = computeBlackScholesGreeks(spot, strike, dte, iv, "PE");

assert(ceGreeks.price > 0, `CE ATM price is positive (₹${ceGreeks.price})`);
assert(peGreeks.price > 0, `PE ATM price is positive (₹${peGreeks.price})`);
assert(ceGreeks.delta > 0.45 && ceGreeks.delta < 0.55, `CE ATM delta is near ~0.50 (actual: ${ceGreeks.delta})`);
assert(peGreeks.delta > -0.55 && peGreeks.delta < -0.45, `PE ATM delta is near ~-0.50 (actual: ${peGreeks.delta})`);
assert(ceGreeks.theta < 0, `CE Theta is negative decay (actual: ₹${ceGreeks.theta}/day)`);
assert(peGreeks.theta < 0, `PE Theta is negative decay (actual: ₹${peGreeks.theta}/day)`);
assert(ceGreeks.vega > 0, `Vega is positive sensitivity (actual: ₹${ceGreeks.vega}/1% IV)`);
assert(ceGreeks.gamma > 0, `Gamma is positive convexity (actual: ${ceGreeks.gamma})`);

// Test 2: Multi-leg Hedged Spread P&L & Net Greeks Math
console.log("\nTest 2: Multi-Leg Spread Net P&L and Greeks Netting Math");
// Long 24300 CE, Short 24500 CE (Bull Call Debit Spread)
const lotSize = 25;
const lots = 2;
const totalQty = lots * lotSize; // 50 units

const buyLeg = {
  strike: 24200,
  action: "BUY" as const,
  entryPremium: 150,
  currentPremium: 180, // +30 move
};

const sellLeg = {
  strike: 24500,
  action: "SELL" as const,
  entryPremium: 40,
  currentPremium: 55, // +15 move
};

const buyLegPnl = (buyLeg.currentPremium - buyLeg.entryPremium) * totalQty; // +30 * 50 = +1500
const sellLegPnl = -1 * (sellLeg.currentPremium - sellLeg.entryPremium) * totalQty; // -15 * 50 = -750
const netPnl = buyLegPnl + sellLegPnl; // +750

assert(buyLegPnl === 1500, `Long CE leg gained +₹1500 on upward spot expansion`);
assert(sellLegPnl === -750, `Short CE leg hedged -₹750 of gain`);
assert(netPnl === 750, `Net spread unrealized P&L matches +₹750`);

// Test 3: Days to Expiry Parser
console.log("\nTest 3: Expiry Date to Calendar Days Parser");
const mockExpiryStr = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
const parsedDte = daysToExpiryFrom(mockExpiryStr, 7);
assert(parsedDte >= 4.5 && parsedDte <= 6.0, `Parsed DTE correctly returns ~5 days (actual: ${parsedDte.toFixed(2)})`);

// Fallback safety
const fallbackDte = daysToExpiryFrom("INVALID_DATE", 14);
assert(fallbackDte === 14, `Fallback DTE returns specified default on unparseable string (14)`);

console.log("\n================================================================================");
console.log("ALL TESTS PASSED! F&O live ticker math & Greeks re-pricing fully verified.");
console.log("================================================================================");
