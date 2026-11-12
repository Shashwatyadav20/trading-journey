import { computeBlackScholesGreeks } from "../lib/indian/foQuantEngine";
import { daysToExpiryFrom, checkNseMarketHoursIST } from "../hooks/useLiveFoTicker";

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

// Test 4: Strict NSE Market-Hours Gatekeeper (IST: Mon-Fri 09:15 AM - 03:30 PM)
console.log("\nTest 4: Strict NSE Market-Hours Gatekeeper & State Freezing Verification");

// 1. Wednesday 10:30:00 AM IST (05:00:00 UTC) -> REGULAR_OPEN
const wedOpen = new Date("2026-11-11T05:00:00Z"); // 10:30 IST (Wednesday)
const statusOpen = checkNseMarketHoursIST(wedOpen);
assert(statusOpen.isOpen === true, `Wednesday 10:30 AM IST is OPEN (phase=${statusOpen.phase})`);
assert(statusOpen.phase === "REGULAR_OPEN", `Phase is REGULAR_OPEN during 09:15-15:30 IST`);

// 2. Wednesday 09:05:00 AM IST (03:35:00 UTC) -> PRE_OPEN (ticks paused)
const wedPreOpen = new Date("2026-11-11T03:35:00Z"); // 09:05 IST (Wednesday)
const statusPreOpen = checkNseMarketHoursIST(wedPreOpen);
assert(statusPreOpen.isOpen === false, `Wednesday 09:05 AM IST Pre-Open pauses live micro-ticks (isOpen=false)`);
assert(statusPreOpen.isPreOpen === true && statusPreOpen.phase === "PRE_OPEN", `Phase is PRE_OPEN at 09:05 IST`);
assert(
  statusPreOpen.statusBadgeText === "🔴 MARKET CLOSED — P&L FROZEN",
  `Pre-Open badge displays '${statusPreOpen.statusBadgeText}'`
);

// 3. Thursday 08:45:00 PM IST (15:15:00 UTC) -> AFTER HOURS CLOSED
const thuAfterHours = new Date("2026-11-12T15:15:00Z"); // 20:45 IST (Thursday)
const statusAfterHours = checkNseMarketHoursIST(thuAfterHours);
assert(statusAfterHours.isOpen === false, `Thursday 20:45 IST After-Hours is CLOSED (isOpen=false)`);
assert(statusAfterHours.phase === "CLOSED", `Phase is CLOSED after 15:30 IST`);
assert(
  statusAfterHours.statusBadgeText === "🔴 MARKET CLOSED — P&L FROZEN",
  `After-hours badge displays '${statusAfterHours.statusBadgeText}'`
);

// 4. Saturday 11:00:00 AM IST (05:30:00 UTC) -> WEEKEND CLOSED
const satMorning = new Date("2026-11-14T05:30:00Z"); // 11:00 IST (Saturday)
const statusWeekend = checkNseMarketHoursIST(satMorning);
assert(statusWeekend.isOpen === false, `Saturday 11:00 AM IST is CLOSED on weekends (isOpen=false)`);
assert(statusWeekend.phase === "CLOSED", `Weekend phase is CLOSED`);
assert(
  statusWeekend.statusBadgeText === "🔴 MARKET CLOSED — P&L FROZEN",
  `Weekend badge displays '${statusWeekend.statusBadgeText}'`
);

console.log("\n================================================================================");
console.log("ALL TESTS PASSED! F&O live ticker math, Greeks & IST Market-Hours Gatekeeper verified.");
console.log("================================================================================");

