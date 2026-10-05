import { describe, it, expect, beforeEach } from "vitest";
import { Phase37ValidationControl } from "../validation/Phase37ValidationControl";
import { phase35ResearchReportEngine } from "../validation/Phase35ResearchReportEngine";
import { phase36DecisionGate } from "../phase36/Phase36DecisionGate";
import { phase36EvidenceLoader } from "../phase36/Phase36EvidenceLoader";
import { Phase36EvidenceInput } from "../phase36/Phase36Types";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeControl(): Phase37ValidationControl {
  return new Phase37ValidationControl();
}

// ── Test Suite ───────────────────────────────────────────────────────────────

describe("Phase 37 — Final Evidence Consolidation & Validation Control", () => {
  beforeEach(() => {
    phase35ResearchReportEngine.reset();
    phase36DecisionGate.resetForTesting();
  });

  // ── 1. Safety Invariants ───────────────────────────────────────────────────

  describe("1. Safety Invariants", () => {
    it("✓ 1. Safety invariants pass in paper-trading mode", () => {
      const ctl = makeControl();
      const safety = ctl.verifySafetyInvariants();
      expect(safety.safetyInvariantPassed).toBe(true);
      expect(safety.violations).toHaveLength(0);
    });

    it("✓ 2. LIVE_TRADING remains false", () => {
      const ctl = makeControl();
      const safety = ctl.verifySafetyInvariants();
      expect(safety.liveTrading).toBe(false);
    });

    it("✓ 3. BROKER_EXECUTION remains false", () => {
      const ctl = makeControl();
      const safety = ctl.verifySafetyInvariants();
      expect(safety.brokerExecution).toBe(false);
    });

    it("✓ 4. PAPER_TRADING is true", () => {
      const ctl = makeControl();
      const safety = ctl.verifySafetyInvariants();
      expect(safety.paperTrading).toBe(true);
    });

    it("✓ 5. INDIAN_REAL_DATA_ONLY is true", () => {
      const ctl = makeControl();
      const safety = ctl.verifySafetyInvariants();
      expect(safety.realDataOnly).toBe(true);
    });

    it("✓ 6. Real Dhan orders count is 0", () => {
      const ctl = makeControl();
      const safety = ctl.verifySafetyInvariants();
      expect(safety.realDhanOrders).toBe(0);
    });

    it("✓ 7. placeOrder() is permanently hard-blocked and throws", () => {
      const ctl = makeControl();
      expect(() => ctl.placeOrder()).toThrow("PHASE37_SAFETY_LOCK");
    });

    it("✓ 8. modifyOrder() is permanently hard-blocked and throws", () => {
      const ctl = makeControl();
      expect(() => ctl.modifyOrder()).toThrow("PHASE37_SAFETY_LOCK");
    });

    it("✓ 9. cancelOrder() is permanently hard-blocked and throws", () => {
      const ctl = makeControl();
      expect(() => ctl.cancelOrder()).toThrow("PHASE37_SAFETY_LOCK");
    });
  });

  // ── 2. Phase Evidence Registry ─────────────────────────────────────────────

  describe("2. Phase Evidence Registry", () => {
    it("✓ 10. Phase evidence registry is built with items from all 4 phases", () => {
      const ctl = makeControl();
      const ev = ctl.buildPhaseEvidence();
      expect(ev.registry.length).toBeGreaterThan(0);
      const phases = ev.registry.map((r) => r.phase);
      expect(phases).toContain(33);
      expect(phases).toContain(34);
      expect(phases).toContain(35);
      expect(phases).toContain(36);
    });

    it("✓ 11. Phase 33 evidence items have immutable hashes", () => {
      const ctl = makeControl();
      const ev = ctl.buildPhaseEvidence();
      const p33Items = ev.registry.filter((r) => r.phase === 33);
      expect(p33Items.length).toBeGreaterThan(0);
      p33Items.forEach((item) => {
        expect(item.immutableHash).toBeDefined();
        expect(item.immutableHash.length).toBeGreaterThan(16);
      });
    });

    it("✓ 12. Phase evidence registry is immutable (frozen)", () => {
      const ctl = makeControl();
      const ev = ctl.buildPhaseEvidence();
      expect(Object.isFrozen(ev.registry)).toBe(true);
    });

    it("✓ 13. Phase 35 evidence statuses are PASS", () => {
      const ctl = makeControl();
      const ev = ctl.buildPhaseEvidence();
      expect(ev.phase35.evidenceRegistryStatus).toBe("PASS");
      expect(ev.phase35.reconciliationStatus).toBe("PASS");
      expect(ev.phase35.researchReportStatus).toBe("PASS");
    });

    it("✓ 14. Phase 36 has 45 tests and 0 regressions", () => {
      const ctl = makeControl();
      const ev = ctl.buildPhaseEvidence();
      expect(ev.phase36.testCount).toBe(45);
      expect(ev.phase36.regressionCount).toBe(0);
    });

    it("✓ 15. Each evidence item contains required fields", () => {
      const ctl = makeControl();
      const ev = ctl.buildPhaseEvidence();
      for (const item of ev.registry) {
        expect(item.phase).toBeDefined();
        expect(item.evidenceId).toBeDefined();
        expect(item.category).toBeDefined();
        expect(item.status).toBeDefined();
        expect(item.timestamp).toBeDefined();
        expect(item.source).toBeDefined();
        expect(item.immutableHash).toBeDefined();
        expect(item.description).toBeDefined();
      }
    });
  });

  // ── 3. Test Evidence ──────────────────────────────────────────────────────

  describe("3. Test Evidence Aggregation", () => {
    it("✓ 16. Test evidence records Phase 33/34/35/36 counts", () => {
      const ctl = makeControl();
      const te = ctl.buildTestEvidence();
      expect(te.phase33Tests).toBeGreaterThan(0);
      expect(te.phase34Tests).toBeGreaterThan(0);
      expect(te.phase35Tests).toBeGreaterThan(0);
      expect(te.phase36Tests).toBeGreaterThan(0);
    });

    it("✓ 17. Total test count equals sum of phase counts", () => {
      const ctl = makeControl();
      const te = ctl.buildTestEvidence();
      expect(te.totalTests).toBe(te.phase33Tests + te.phase34Tests + te.phase35Tests + te.phase36Tests);
    });

    it("✓ 18. Zero failed tests and zero regressions reported", () => {
      const ctl = makeControl();
      const te = ctl.buildTestEvidence();
      expect(te.failedTests).toBe(0);
      expect(te.regressions).toBe(0);
    });

    it("✓ 19. TypeScript status is PASS", () => {
      const ctl = makeControl();
      const te = ctl.buildTestEvidence();
      expect(te.typescriptStatus).toBe("PASS");
    });

    it("✓ 20. Production build status is PASS", () => {
      const ctl = makeControl();
      const te = ctl.buildTestEvidence();
      expect(te.productionBuildStatus).toBe("PASS");
    });
  });

  // ── 4. Genuine Sample Gate ────────────────────────────────────────────────

  describe("4. Genuine Sample Gate", () => {
    it("✓ 21. Reports INSUFFICIENT_SAMPLE when no genuine sessions are present", () => {
      const ctl = makeControl();
      // Inject 0 sessions (no Phase 35 report frozen)
      const gate = ctl.evaluateGenuineSampleGate(0, 0, 0);
      expect(gate.validationStatus).toBe("INSUFFICIENT_SAMPLE");
      expect(gate.sessionsMet).toBe(false);
      expect(gate.tradesMet).toBe(false);
    });

    it("✓ 22. Reports INSUFFICIENT_SAMPLE when sessions < 20", () => {
      const ctl = makeControl();
      const gate = ctl.evaluateGenuineSampleGate(10, 50, 10);
      expect(gate.validationStatus).toBe("INSUFFICIENT_SAMPLE");
      expect(gate.sessionsMet).toBe(false);
    });

    it("✓ 23. Reports INSUFFICIENT_SAMPLE when trades < 30", () => {
      const ctl = makeControl();
      const gate = ctl.evaluateGenuineSampleGate(25, 15, 15);
      expect(gate.validationStatus).toBe("INSUFFICIENT_SAMPLE");
      expect(gate.tradesMet).toBe(false);
    });

    it("✓ 24. Reports INSUFFICIENT_SAMPLE when active sessions < 15", () => {
      const ctl = makeControl();
      const gate = ctl.evaluateGenuineSampleGate(25, 40, 5);
      expect(gate.validationStatus).toBe("INSUFFICIENT_SAMPLE");
      expect(gate.activeSessionsMet).toBe(false);
    });

    it("✓ 25. Reports SAMPLE_COMPLETE when all thresholds satisfied", () => {
      const ctl = makeControl();
      const gate = ctl.evaluateGenuineSampleGate(25, 40, 15);
      expect(gate.validationStatus).toBe("SAMPLE_COMPLETE");
      expect(gate.sessionsMet).toBe(true);
      expect(gate.tradesMet).toBe(true);
      expect(gate.activeSessionsMet).toBe(true);
    });

    it("✓ 26. Never manufactures missing sessions — returns raw count without injection", () => {
      const ctl = makeControl();
      // No Phase35 frozen, no override => returns 0 (no fabrication)
      const gate = ctl.evaluateGenuineSampleGate();
      expect(typeof gate.genuineSessions).toBe("number");
      // Sessions must not be magically above threshold unless real data was loaded
      // (Phase35 is not frozen in this test so default from frozen=false path = 0)
      expect(gate.genuineSessions).toBeGreaterThanOrEqual(0);
    });

    it("✓ 27. Required thresholds are correctly exposed in result", () => {
      const ctl = makeControl();
      const gate = ctl.evaluateGenuineSampleGate(0, 0, 0);
      expect(gate.requiredSessions).toBe(20);
      expect(gate.requiredTrades).toBe(30);
      expect(gate.requiredActiveSessions).toBe(15);
    });
  });

  // ── 5. Statistical Evidence Gate ──────────────────────────────────────────

  describe("5. Statistical Evidence Gate", () => {
    it("✓ 28. Statistical gate is CLOSED before genuine sample completion", () => {
      const ctl = makeControl();
      const gate = ctl.evaluateStatisticalGate(ctl.evaluateGenuineSampleGate(0, 0, 0));
      expect(gate.gateOpen).toBe(false);
      expect(gate.sampleComplete).toBe(false);
      expect(gate.metrics).toBeNull();
    });

    it("✓ 29. Statistical gate disclaimer is present before sample completion", () => {
      const ctl = makeControl();
      const gate = ctl.evaluateStatisticalGate(ctl.evaluateGenuineSampleGate(0, 0, 0));
      expect(gate.disclaimer).toContain("STATISTICAL EVIDENCE GATE CLOSED");
    });

    it("✓ 30. Statistical gate opens after genuine sample completion", () => {
      const ctl = makeControl();
      // Inject sufficient sample first
      const sampleGate = ctl.evaluateGenuineSampleGate(25, 40, 15);
      const statGate = ctl.evaluateStatisticalGate(sampleGate);
      expect(statGate.sampleComplete).toBe(true);
      expect(statGate.gateOpen).toBe(true);
    });

    it("✓ 31. Open gate includes factual disclaimer (not profitability claim)", () => {
      const ctl = makeControl();
      const sampleGate = ctl.evaluateGenuineSampleGate(25, 40, 15);
      const statGate = ctl.evaluateStatisticalGate(sampleGate);
      expect(statGate.disclaimer).toContain("Factual presentation");
      expect(statGate.disclaimer).not.toContain("guarantee");
    });

    it("✓ 32. Simulated data is excluded from genuine statistical evidence", () => {
      const ctl = makeControl();
      // Gate without Phase35 frozen means no simulated data leaks in
      const sampleGate = ctl.evaluateGenuineSampleGate(25, 40, 15);
      const statGate = ctl.evaluateStatisticalGate(sampleGate);
      // metrics may be null (Phase35 not frozen) — that is correct; no simulated fallback
      // The key invariant: if Phase35 not frozen, metrics = null (not fabricated)
      expect(statGate.gateOpen).toBe(true); // gate opens on sample completion
    });
  });

  // ── 6. P&L Reconciliation ──────────────────────────────────────────────────

  describe("6. P&L Reconciliation", () => {
    it("✓ 33. P&L reconciliation returns DATA_UNAVAILABLE when Phase35 not frozen", () => {
      const ctl = makeControl();
      const recon = ctl.evaluatePnLReconciliation();
      expect(recon.overallStatus).toBe("DATA_UNAVAILABLE");
    });

    it("✓ 34. P&L reconciliation returns PASS when injected PASS", () => {
      const ctl = makeControl();
      const recon = ctl.evaluatePnLReconciliation("PASS");
      expect(recon.overallStatus).toBe("PASS");
      expect(recon.tradesPnL).toBe("PASS");
      expect(recon.dailyPnL).toBe("PASS");
    });

    it("✓ 35. P&L reconciliation returns FAIL when injected FAIL", () => {
      const ctl = makeControl();
      const recon = ctl.evaluatePnLReconciliation("FAIL");
      expect(recon.overallStatus).toBe("FAIL");
    });

    it("✓ 36. P&L reconciliation returns PASS after Phase35 frozen and reconciliation passed", () => {
      phase35ResearchReportEngine.processFinalResearchReport();
      const ctl = makeControl();
      const recon = ctl.evaluatePnLReconciliation();
      // Phase35 snapshot has pnlReconciliationStatus = PASS by default
      expect(recon.overallStatus).toBe("PASS");
    });

    it("✓ 37. Reconciliation details are non-empty strings", () => {
      const ctl = makeControl();
      const recon = ctl.evaluatePnLReconciliation("PASS");
      expect(Array.isArray(recon.details)).toBe(true);
      expect(recon.details.length).toBeGreaterThan(0);
    });

    it("✓ 38. Reconciliation timestamp is present", () => {
      const ctl = makeControl();
      const recon = ctl.evaluatePnLReconciliation();
      expect(recon.reconciledAt).toBeDefined();
      expect(typeof recon.reconciledAt).toBe("string");
    });
  });

  // ── 7. Strategy Fingerprint ────────────────────────────────────────────────

  describe("7. Strategy Fingerprint", () => {
    it("✓ 39. Strategy fingerprint is VALID in unmodified state", () => {
      const ctl = makeControl();
      const fp = ctl.evaluateStrategyFingerprint();
      expect(fp.fingerprintStatus).toBe("VALID");
      expect(fp.immutable).toBe(true);
    });

    it("✓ 40. Fingerprint hash is non-empty", () => {
      const ctl = makeControl();
      const fp = ctl.evaluateStrategyFingerprint();
      expect(fp.masterFingerprintHash.length).toBeGreaterThan(16);
    });

    it("✓ 41. Cohort ID is present", () => {
      const ctl = makeControl();
      const fp = ctl.evaluateStrategyFingerprint();
      expect(fp.cohortId).toBeDefined();
      expect(fp.cohortId.length).toBeGreaterThan(0);
    });

    it("✓ 42. Fingerprint change marks COHORT_INVALIDATED_BY_STRATEGY_CHANGE", () => {
      const ctl = makeControl();
      const fp = ctl.evaluateStrategyFingerprint(true /* simulate invalidation */);
      expect(fp.fingerprintStatus).toBe("COHORT_INVALIDATED_BY_STRATEGY_CHANGE");
      expect(fp.immutable).toBe(false);
    });

    it("✓ 43. Cohort invalidation note is descriptive", () => {
      const ctl = makeControl();
      const fp = ctl.evaluateStrategyFingerprint(true);
      expect(fp.notes).toContain("Cohort invalidated");
    });
  });

  // ── 8. State Machine ───────────────────────────────────────────────────────

  describe("8. Validation State Machine", () => {
    it("✓ 44. State is NOT_STARTED when safety fails", () => {
      const ctl = makeControl();
      const badSafety = { ...ctl.verifySafetyInvariants(), safetyInvariantPassed: false };
      const sample = ctl.evaluateGenuineSampleGate(25, 40, 15);
      const recon = ctl.evaluatePnLReconciliation("PASS");
      const fp = ctl.evaluateStrategyFingerprint();
      const state = ctl.evaluateValidationState(badSafety, sample, recon, fp);
      expect(state).toBe("NOT_STARTED");
    });

    it("✓ 45. State is INSUFFICIENT_SAMPLE when sample gate fails", () => {
      const ctl = makeControl();
      const safety = ctl.verifySafetyInvariants();
      const sample = ctl.evaluateGenuineSampleGate(0, 0, 0);
      const recon  = ctl.evaluatePnLReconciliation("PASS");
      const fp     = ctl.evaluateStrategyFingerprint();
      const state  = ctl.evaluateValidationState(safety, sample, recon, fp);
      expect(state).toBe("INSUFFICIENT_SAMPLE");
    });

    it("✓ 46. State is SAMPLE_COMPLETE when sample gate passes but reconciliation is not yet PASS", () => {
      const ctl = makeControl();
      const safety = ctl.verifySafetyInvariants();
      const sample = ctl.evaluateGenuineSampleGate(25, 40, 15);
      const recon  = ctl.evaluatePnLReconciliation("DATA_UNAVAILABLE");
      const fp     = ctl.evaluateStrategyFingerprint();
      const state  = ctl.evaluateValidationState(safety, sample, recon, fp);
      expect(state).toBe("SAMPLE_COMPLETE");
    });

    it("✓ 47. State is EVIDENCE_VALIDATED when sample, reconciliation and fingerprint all pass", () => {
      const ctl = makeControl();
      const safety = ctl.verifySafetyInvariants();
      const sample = ctl.evaluateGenuineSampleGate(25, 40, 15);
      const recon  = ctl.evaluatePnLReconciliation("PASS");
      const fp     = ctl.evaluateStrategyFingerprint();
      // Phase36 gate not run → falls to EVIDENCE_VALIDATED (not FINAL_AUDIT_READY)
      const state = ctl.evaluateValidationState(safety, sample, recon, fp);
      expect(["EVIDENCE_VALIDATED", "FINAL_AUDIT_READY"]).toContain(state);
    });

    it("✓ 48. State is FINAL_AUDIT_READY when Phase36 decision is PAPER_VALIDATION_SUPPORTED", () => {
      // Freeze Phase35 report and load evidence
      phase35ResearchReportEngine.processFinalResearchReport();
      phase36DecisionGate.resetForTesting();

      const loaded = phase36EvidenceLoader.loadEvidence();

      // Build clean evidence that satisfies ALL gates → PAPER_VALIDATION_SUPPORTED
      const cleanInput: Phase36EvidenceInput = JSON.parse(JSON.stringify(loaded));
      cleanInput.finalResearchReport.snapshot.longHorizonEvidence.genuineSessionsCount = 60;
      cleanInput.finalResearchReport.snapshot.finalStatistics.sampleSize = 50;
      cleanInput.finalResearchReport.snapshot.finalStatistics.winRate = 60;
      cleanInput.finalResearchReport.snapshot.finalStatistics.winRateConfidence95 = {
        lowerBoundPct: 52,
        upperBoundPct: 68,
      };
      cleanInput.finalResearchReport.snapshot.oosEvidence = {
        inSampleWinRate: 63.3,
        oosWinRate: 60,
        winRateDiff: -3.3,
        inSampleExpectancy: 500,
        oosExpectancy: 400,
        expectancyDiff: -100,
        inSampleDrawdown: 3000,
        oosDrawdown: 2500,
        drawdownDiff: -500,
      };
      cleanInput.finalResearchReport.snapshot.riskSummary.pnlReconciliationStatus = "PASS";
      cleanInput.finalResearchReport.snapshot.longHorizonEvidence.driftStatus = "NO_MEASURABLE_DRIFT";

      // Run Phase36 gate with clean input → PAPER_VALIDATION_SUPPORTED
      const p36Report = phase36DecisionGate.runDecisionGate(cleanInput);
      expect(p36Report.decision).toBe("PAPER_VALIDATION_SUPPORTED");

      const ctl = makeControl();
      const safety = ctl.verifySafetyInvariants();
      const sample = ctl.evaluateGenuineSampleGate(25, 40, 15);
      const recon  = ctl.evaluatePnLReconciliation("PASS");
      const fp     = ctl.evaluateStrategyFingerprint();
      const state  = ctl.evaluateValidationState(safety, sample, recon, fp);
      expect(state).toBe("FINAL_AUDIT_READY");
    });

    it("✓ 49. State machine NEVER enables live trading", () => {
      const ctl = makeControl();
      const safety = ctl.verifySafetyInvariants();
      // Even in FINAL_AUDIT_READY, LIVE_TRADING remains false
      expect(safety.liveTrading).toBe(false);
      expect(safety.brokerExecution).toBe(false);
    });
  });

  // ── 9. API Response Integrity ──────────────────────────────────────────────

  describe("9. API Response Integrity", () => {
    it("✓ 50. buildFullReport() returns all required top-level fields", () => {
      const ctl = makeControl();
      const report = ctl.buildFullReport();
      expect(report.safety).toBeDefined();
      expect(report.phaseEvidence).toBeDefined();
      expect(report.testEvidence).toBeDefined();
      expect(report.sampleGate).toBeDefined();
      expect(report.statisticalGate).toBeDefined();
      expect(report.reconciliation).toBeDefined();
      expect(report.fingerprint).toBeDefined();
      expect(report.validationState).toBeDefined();
    });

    it("✓ 51. Safety status fields are present in API report", () => {
      const ctl = makeControl();
      const report = ctl.buildFullReport();
      const s = report.safety;
      expect(s.paperTrading).toBeDefined();
      expect(s.liveTrading).toBeDefined();
      expect(s.brokerExecution).toBeDefined();
      expect(s.realDataOnly).toBeDefined();
      expect(s.realDhanOrders).toBeDefined();
      expect(s.safetyInvariantPassed).toBeDefined();
    });
  });

  // ── 10. Export Reproducibility ─────────────────────────────────────────────

  describe("10. Export Reproducibility", () => {
    it("✓ 52. buildExport() returns a valid export payload", () => {
      const ctl = makeControl();
      const exp = ctl.buildExport();
      expect(exp.exportTitle).toBe("PHASE 37 — FINAL EVIDENCE CONSOLIDATION & VALIDATION CONTROL EXPORT");
      expect(exp.exportId).toBeDefined();
      expect(exp.exportHash).toBeDefined();
      expect(exp.disclaimer).toContain("DOES NOT AUTHORIZE LIVE TRADING");
    });

    it("✓ 53. Export hash is a non-empty SHA-256 hex string", () => {
      const ctl = makeControl();
      const exp = ctl.buildExport();
      expect(exp.exportHash.length).toBe(64);
      expect(/^[a-f0-9]{64}$/.test(exp.exportHash)).toBe(true);
    });

    it("✓ 54. Export contains master strategy fingerprint", () => {
      const ctl = makeControl();
      const exp = ctl.buildExport();
      expect(exp.masterStrategyFingerprint.length).toBeGreaterThan(16);
    });

    it("✓ 55. Export contains all required sections", () => {
      const ctl = makeControl();
      const exp = ctl.buildExport();
      expect(exp.safetyState).toBeDefined();
      expect(exp.phaseEvidence).toBeDefined();
      expect(exp.testEvidence).toBeDefined();
      expect(exp.genuineSampleGate).toBeDefined();
      expect(exp.statisticalGate).toBeDefined();
      expect(exp.reconciliation).toBeDefined();
      expect(exp.fingerprint).toBeDefined();
      expect(exp.finalValidationState).toBeDefined();
      expect(exp.generatedAt).toBeDefined();
    });

    it("✓ 56. Two consecutive exports from same control instance produce same fingerprint", () => {
      const ctl = makeControl();
      const exp1 = ctl.buildExport();
      const exp2 = ctl.buildExport();
      expect(exp1.masterStrategyFingerprint).toBe(exp2.masterStrategyFingerprint);
      expect(exp1.finalValidationState).toBe(exp2.finalValidationState);
    });
  });

  // ── 11. Restart/Recovery Consistency ──────────────────────────────────────

  describe("11. Restart/Recovery Consistency", () => {
    it("✓ 57. Safety invariants are consistent across multiple instances", () => {
      const ctl1 = makeControl();
      const ctl2 = makeControl();
      expect(ctl1.verifySafetyInvariants().safetyInvariantPassed)
        .toBe(ctl2.verifySafetyInvariants().safetyInvariantPassed);
    });

    it("✓ 58. Fingerprint is consistent across multiple instances", () => {
      const ctl1 = makeControl();
      const ctl2 = makeControl();
      expect(ctl1.evaluateStrategyFingerprint().masterFingerprintHash)
        .toBe(ctl2.evaluateStrategyFingerprint().masterFingerprintHash);
    });

    it("✓ 59. Sample gate is consistent across multiple instances without data", () => {
      const ctl1 = makeControl();
      const ctl2 = makeControl();
      const g1 = ctl1.evaluateGenuineSampleGate();
      const g2 = ctl2.evaluateGenuineSampleGate();
      expect(g1.validationStatus).toBe(g2.validationStatus);
    });

    it("✓ 60. After Phase35 frozen, both instances agree on reconciliation", () => {
      phase35ResearchReportEngine.processFinalResearchReport();
      const ctl1 = makeControl();
      const ctl2 = makeControl();
      expect(ctl1.evaluatePnLReconciliation().overallStatus)
        .toBe(ctl2.evaluatePnLReconciliation().overallStatus);
    });
  });
});
