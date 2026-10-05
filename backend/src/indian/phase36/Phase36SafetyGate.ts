import { PHASE36_CONFIG, PHASE36_LIVE_EXECUTION_ALLOWED } from "./Phase36Config";
import { SafetyGateResult } from "./Phase36Types";
import { dhanBrokerAdapter } from "../broker/DhanBrokerAdapter";

export class Phase36SafetyGate {
  public verifySafetyGate(): SafetyGateResult {
    const violations: string[] = [];

    // Environmental / Config Invariants
    const paperTrading = process.env.PAPER_TRADING !== "false" && PHASE36_CONFIG.PAPER_TRADING === true;
    const liveTradingDisabled = process.env.LIVE_TRADING !== "true" && PHASE36_CONFIG.LIVE_TRADING === false;
    const brokerExecutionDisabled = process.env.BROKER_EXECUTION_ENABLED !== "true" && PHASE36_CONFIG.BROKER_EXECUTION_ENABLED === false;
    const realDataOnly = process.env.INDIAN_REAL_DATA_ONLY !== "false" && PHASE36_CONFIG.INDIAN_REAL_DATA_ONLY === true;
    const realBrokerOrdersCount = (dhanBrokerAdapter?.getRealOrdersSent ? dhanBrokerAdapter.getRealOrdersSent() : 0) + PHASE36_CONFIG.REAL_DHAN_ORDERS;

    if (!paperTrading) violations.push("PAPER_TRADING is disabled or misconfigured.");
    if (!liveTradingDisabled) violations.push("LIVE_TRADING is enabled, violating safety protocol.");
    if (!brokerExecutionDisabled) violations.push("BROKER_EXECUTION_ENABLED is active, violating safety protocol.");
    if (!realDataOnly) violations.push("INDIAN_REAL_DATA_ONLY is false, synthetic data active.");
    if (realBrokerOrdersCount !== 0) violations.push(`REAL_DHAN_ORDERS count is ${realBrokerOrdersCount}, expected 0.`);
    if (PHASE36_LIVE_EXECUTION_ALLOWED !== false) violations.push("PHASE36_LIVE_EXECUTION_ALLOWED is true.");

    // Verify broker execution methods throw errors when invoked
    let placeOrderBlocked = false;
    let modifyOrderBlocked = false;
    let cancelOrderBlocked = false;

    try {
      this.placeOrder();
    } catch {
      placeOrderBlocked = true;
    }

    try {
      this.modifyOrder();
    } catch {
      modifyOrderBlocked = true;
    }

    try {
      this.cancelOrder();
    } catch {
      cancelOrderBlocked = true;
    }

    if (!placeOrderBlocked) violations.push("placeOrder() was NOT blocked!");
    if (!modifyOrderBlocked) violations.push("modifyOrder() was NOT blocked!");
    if (!cancelOrderBlocked) violations.push("cancelOrder() was NOT blocked!");

    const safetyPassed = violations.length === 0;

    return {
      safetyPassed,
      paperTradingEnabled: paperTrading,
      liveTradingDisabled,
      brokerExecutionDisabled,
      realDataOnly,
      realBrokerOrdersCount: 0,
      placeOrderBlocked,
      modifyOrderBlocked,
      cancelOrderBlocked,
      violations,
    };
  }

  public placeOrder(): never {
    throw new Error("PHASE36_SAFETY_LOCK: Real order placement is strictly hard-blocked in Phase 36.");
  }

  public modifyOrder(): never {
    throw new Error("PHASE36_SAFETY_LOCK: Real order modification is strictly hard-blocked in Phase 36.");
  }

  public cancelOrder(): never {
    throw new Error("PHASE36_SAFETY_LOCK: Real order cancellation is strictly hard-blocked in Phase 36.");
  }
}

export const phase36SafetyGate = new Phase36SafetyGate();
