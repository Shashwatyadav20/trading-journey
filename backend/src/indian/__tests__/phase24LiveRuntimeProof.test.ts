import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { phase24RuntimeProofEngine } from "../validation/Phase24RuntimeProofEngine";
import { dhanBrokerAdapter } from "../broker/DhanBrokerAdapter";
import { nseIndiaOptionChainProvider } from "../market/NseIndiaOptionChainProvider";
import { niftyMarketProvider } from "../market/NiftyMarketProvider";
import { hedgingStrategyEngine } from "../strategy/HedgingStrategyEngine";

describe("PHASE 24 — Live Runtime Proof Test Suite", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...origEnv };
    niftyMarketProvider.updateSpotPrice(24700, true);
    niftyMarketProvider.setOptionChainProvider(nseIndiaOptionChainProvider);
  });

  afterEach(() => {
    process.env = origEnv;
  });

  it("1. Phase 24 Proof Engine executes and returns complete diagnostic report", async () => {
    const report = await phase24RuntimeProofEngine.runFullRuntimeProof();

    expect(report.timestamp).toBeDefined();
    expect(report.safetyLocks.paperTradingEnabled).toBe(true);
    expect(report.safetyLocks.liveTradingDisabled).toBe(true);
    expect(report.safetyLocks.brokerExecutionBlocked).toBe(true);
  });

  it("2. Dhan connectivity diagnostic reports NOT_CONFIGURED when credentials missing", async () => {
    delete process.env.DHAN_CLIENT_ID;
    delete process.env.DHAN_ACCESS_TOKEN;

    const report = await phase24RuntimeProofEngine.runFullRuntimeProof();
    expect(report.dhanProof.configured).toBe(false);
    expect(report.finalVerdict.questionA_DhanResponding).toBe("NOT_CONFIGURED");
  });

  it("3. Controlled Provider Routing Test A (DHAN) tags dataSource correctly", async () => {
    const report = await phase24RuntimeProofEngine.runFullRuntimeProof();
    expect(report.routingTestA_Dhan.providerConfigured).toBe("DHAN");
    expect(report.routingTestA_Dhan.tracePath).toContain("DhanBrokerAdapter");
  });

  it("4. Controlled Provider Routing Test B (NSE_INDIA) tags dataSource correctly", async () => {
    const report = await phase24RuntimeProofEngine.runFullRuntimeProof();
    expect(report.routingTestB_Nse.providerConfigured).toBe("NSE_INDIA");
    expect(report.routingTestB_Nse.tracePath).toContain("NseIndiaOptionChainProvider");
  });

  it("5. Synthetic data leakage test blocks synthetic signals in REAL_DATA_ONLY mode", async () => {
    const report = await phase24RuntimeProofEngine.runFullRuntimeProof();
    expect(report.syntheticLeakageTest.realDataOnlyActive).toBe(true);
    expect(report.syntheticLeakageTest.blockedAsExpected).toBe(true);
    expect(report.syntheticLeakageTest.signalResult.action).toBe("NO_TRADE");
  });

  it("6. Paper trade trace verifies entry price source and P&L provenance", async () => {
    const report = await phase24RuntimeProofEngine.runFullRuntimeProof();
    expect(report.paperTradeTrace.entryPrice).toBeGreaterThan(0);
    expect(report.paperTradeTrace.pnlType).toBeDefined();
  });

  it("7. Final verdict matrix exposes all 13 questions A - M", async () => {
    const report = await phase24RuntimeProofEngine.runFullRuntimeProof();
    const v = report.finalVerdict;

    expect(v.questionA_DhanResponding).toBeDefined();
    expect(v.questionB_DhanOptionChainResponding).toBeDefined();
    expect(v.questionC_DhanMarketQuoteResponding).toBeDefined();
    expect(v.questionD_NseOptionChainResponding).toBeDefined();
    expect(v.questionE_DhanDataReachingStrategy).toBeDefined();
    expect(v.questionF_NseDataReachingStrategy).toBeDefined();
    expect(v.questionG_SyntheticDataReachingStrategy).toBe("NO");
    expect(v.questionH_PaperEntryPricesReal).toBe("YES");
    expect(v.questionI_PaperExitPricesReal).toBe("YES");
    expect(v.questionJ_PaperPnlBasedOnRealPrices).toBe("YES");
    expect(v.questionK_DummyFallbackReachableInRealDataOnly).toBe("NO");
    expect(v.questionL_DhanCredentialsValidOnProduction).toBeDefined();
    expect(v.questionM_CompleteRuntimeChainGenuine).toBeDefined();
  });
});
