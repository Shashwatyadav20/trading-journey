import { describe, it, expect } from "vitest";
import { genuineDataValidator } from "../validation/GenuineDataValidator";
import { genuinePaperValidationEngine } from "../validation/GenuinePaperValidationEngine";
import { paperSampleSimulator } from "../validation/PaperSampleSimulator";
import { niftyMarketProvider } from "../market/NiftyMarketProvider";
import { NiftySpreadPosition } from "../types";

describe("Phase 15 — Genuine Live Paper Trading Validation Test Suite", () => {
  it("1. Genuine Data Gate Evaluation (Rejects Synthetic Option Chain from Phase 15)", async () => {
    const dataGate = await genuineDataValidator.evaluateGenuineDataGate();
    expect(dataGate.isGenuineSessionValidating).toBe(false);
    expect(dataGate.optionChainReal).toBe(false);
    expect(dataGate.rejectionReason).toContain("SYNTHETIC OPTION DATA — SESSION NON-VALIDATING FOR PHASE 15");
  });

  it("2. Provider Transparency Audit (8-Component Source Recording)", async () => {
    const dataGate = await genuineDataValidator.evaluateGenuineDataGate();
    const t = dataGate.transparency;

    expect(t.spotProvider).toBeDefined();
    expect(t.candleProvider).toBeDefined();
    expect(t.optionChainProvider).toBeDefined();
    expect(t.optionPriceProvider).toBeDefined();

    expect(t.optionChainLabel).toBe("SYNTHETIC");
    expect(t.ivLabel).toBe("UNAVAILABLE");
    expect(t.deltaLabel).toBe("CALCULATED");
    expect(t.gammaLabel).toBe("CALCULATED");
    expect(t.dataTimestamp).toBeDefined();
  });

  it("3. Stale Data Protection (Flags DATA_STALE when data age exceeds limit)", async () => {
    // Touch data timestamp with old timestamp (70s ago)
    niftyMarketProvider.updateSpotPrice(25000, false, Date.now() - 70000);
    const dataGate = await genuineDataValidator.evaluateGenuineDataGate();
    expect(dataGate.rejectionReason).toBe("DATA_STALE");

    // Reset timestamp
    niftyMarketProvider.touchDataTimestamp();
  });

  it("4. Anti-Simulation Safety (Simulated Phase 14 Trades NEVER Count Toward Phase 15)", async () => {
    // Generate simulated dataset (Phase 14)
    const sim = paperSampleSimulator.generateSampleDataset({ sessionsCount: 25, winRatePct: 80, tradesPerSession: 1.5 });

    // Pass simulated sessions to Genuine Validation Engine
    const genuineReport = await genuinePaperValidationEngine.generateGenuineReport(sim.sessions, sim.trades);

    // Simulated sessions have isSyntheticOptionData = true, so genuine count must be 0!
    expect(genuineReport.genuineSample.genuineSessionsCount).toBe(0);
    expect(genuineReport.genuineSample.genuineTradesCount).toBe(0);
    expect(genuineReport.genuineSample.genuineActiveSessionsCount).toBe(0);
    expect(genuineReport.antiSimulationCheckPassed).toBe(true);
  });

  it("5. Genuine Paper Trade Identification", async () => {
    const sim = paperSampleSimulator.generateSampleDataset({ sessionsCount: 22, winRatePct: 75, tradesPerSession: 1.5 });

    // Mark 5 trades as genuine real data trades
    const genuineTrades: NiftySpreadPosition[] = sim.trades.map((t, idx) => {
      if (idx < 5) {
        return { ...t, isGenuineRealDataTrade: true } as any;
      }
      return t;
    });

    const report = await genuinePaperValidationEngine.generateGenuineReport([], genuineTrades);
    expect(report.genuineSample.genuineTradesCount).toBe(5);
  });

  it("6. Phase 15 Scorecard Status when Live Option Chain is Synthetic", async () => {
    const genuineReport = await genuinePaperValidationEngine.generateGenuineReport();

    expect(genuineReport.scorecardStatus).toBe(
      "VALIDATION BLOCKED — GENUINE LIVE NIFTY OPTION-CHAIN DATA REQUIRED"
    );
    expect(genuineReport.blockedMessage).toBe(
      "PHASE 15 BLOCKED — GENUINE LIVE NIFTY OPTION-CHAIN DATA REQUIRED"
    );
    expect(genuineReport.isGenuineOptionChainAvailable).toBe(false);
  });

  it("7. Phase 14 vs Phase 15 Side-by-Side Separation", async () => {
    const report = await genuinePaperValidationEngine.generateGenuineReport();
    const comparison = report.phase14VsPhase15;

    expect(comparison.phase14SimulatedBenchmark).toBeDefined();
    expect(comparison.phase15GenuineLivePaper).toBeDefined();
    expect(comparison.phase14SimulatedBenchmark).not.toBe(comparison.phase15GenuineLivePaper);
  });

  it("8. Critical Safety Locks Enforcement", async () => {
    const report = await genuinePaperValidationEngine.generateGenuineReport();
    const locks = report.safetyLocks;

    expect(locks.paperTradingEnabled).toBe(true);
    expect(locks.liveTradingLocked).toBe(true);
    expect(locks.brokerExecutionDisabled).toBe(true);
  });
});
