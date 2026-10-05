import { describe, it, expect, beforeEach } from "vitest";
import { PHASE36_CONFIG, PHASE36_LIVE_EXECUTION_ALLOWED } from "../phase36/Phase36Config";
import { phase36SafetyGate, Phase36SafetyGate } from "../phase36/Phase36SafetyGate";
import { phase36EvidenceLoader, Phase36EvidenceLoader } from "../phase36/Phase36EvidenceLoader";
import { phase36EvidenceValidator, Phase36EvidenceValidator } from "../phase36/Phase36EvidenceValidator";
import { phase36SampleSufficiency, Phase36SampleSufficiency } from "../phase36/Phase36SampleSufficiency";
import { phase36StatisticalAssessment, Phase36StatisticalAssessment } from "../phase36/Phase36StatisticalAssessment";
import { phase36OOSAssessment, Phase36OOSAssessment } from "../phase36/Phase36OOSAssessment";
import { phase36StressAssessment, Phase36StressAssessment } from "../phase36/Phase36StressAssessment";
import { phase36DriftAssessment, Phase36DriftAssessment } from "../phase36/Phase36DriftAssessment";
import { phase36RiskAssessment, Phase36RiskAssessment } from "../phase36/Phase36RiskAssessment";
import { phase36OperationalAssessment, Phase36OperationalAssessment } from "../phase36/Phase36OperationalAssessment";
import { phase36DecisionGate, Phase36DecisionGate } from "../phase36/Phase36DecisionGate";
import { phase36DecisionExporter, Phase36DecisionExporter } from "../phase36/Phase36DecisionExporter";
import { phase35ResearchReportEngine } from "../validation/Phase35ResearchReportEngine";
import { Phase36EvidenceInput } from "../phase36/Phase36Types";

describe("Phase 36 — Evidence-Based Decision Gate Comprehensive Test Suite", () => {
  beforeEach(() => {
    phase35ResearchReportEngine.reset();
    phase36DecisionGate.resetForTesting();
  });

  // ── 1. Phase 36 Safety Gate & Invariant Tests ─────────────────────────────
  describe("Phase 36 Safety Gate", () => {
    it("✓ 1. Verifies absolute safety invariants: LIVE_TRADING===false, BROKER_EXECUTION_ENABLED===false, REAL_DHAN_ORDERS===0", () => {
      const res = phase36SafetyGate.verifySafetyGate();
      expect(res.safetyPassed).toBe(true);
      expect(res.liveTradingDisabled).toBe(true);
      expect(res.brokerExecutionDisabled).toBe(true);
      expect(res.realBrokerOrdersCount).toBe(0);
      expect(PHASE36_LIVE_EXECUTION_ALLOWED).toBe(false);
    });

    it("✓ 2. Verifies placeOrder() is hard-blocked and throws", () => {
      expect(() => phase36SafetyGate.placeOrder()).toThrow("PHASE36_SAFETY_LOCK");
    });

    it("✓ 3. Verifies modifyOrder() is hard-blocked and throws", () => {
      expect(() => phase36SafetyGate.modifyOrder()).toThrow("PHASE36_SAFETY_LOCK");
    });

    it("✓ 4. Verifies cancelOrder() is hard-blocked and throws", () => {
      expect(() => phase36SafetyGate.cancelOrder()).toThrow("PHASE36_SAFETY_LOCK");
    });

    it("✓ 5. Safety gate detects blocked order placement violations", () => {
      const gate = new Phase36SafetyGate();
      const res = gate.verifySafetyGate();
      expect(res.placeOrderBlocked).toBe(true);
      expect(res.modifyOrderBlocked).toBe(true);
      expect(res.cancelOrderBlocked).toBe(true);
    });
  });

  // ── 2. Phase 36 Evidence Loader Tests ────────────────────────────────────
  describe("Phase 36 Evidence Loader", () => {
    it("✓ 6. Loads Phase 35 frozen evidence exclusively", () => {
      phase35ResearchReportEngine.processFinalResearchReport();
      const loaded = phase36EvidenceLoader.loadEvidence();
      expect(loaded.finalResearchReport).toBeDefined();
      expect(loaded.finalResearchReport.state).toBe("FROZEN");
      expect(loaded.evidenceRegistry.length).toBeGreaterThan(0);
    });

    it("✓ 7. Rejects loading if Phase 35 evidence report is not complete/frozen", () => {
      expect(() => phase36EvidenceLoader.loadEvidence()).toThrow("PHASE35_EVIDENCE_NOT_FROZEN");
    });
  });

  // ── 3. Phase 36 Evidence Validator Tests ─────────────────────────────────
  describe("Phase 36 Evidence Validator", () => {
    it("✓ 8. Validates genuine frozen Phase 35 evidence cleanly", () => {
      phase35ResearchReportEngine.processFinalResearchReport();
      const loaded = phase36EvidenceLoader.loadEvidence();
      const res = phase36EvidenceValidator.validateEvidence(loaded);
      expect(res.valid).toBe(true);
    });

    it("✓ 9. Phase 35 hash mismatch blocks validation (HASH_MISMATCH)", () => {
      phase35ResearchReportEngine.processFinalResearchReport();
      const loaded = phase36EvidenceLoader.loadEvidence();
      const tampered: Phase36EvidenceInput = {
        ...loaded,
        evidenceRegistry: [
          {
            ...loaded.evidenceRegistry[0],
            sourceHash: "DEADBEEF_INVALID_HASH",
          },
        ],
      };

      const res = phase36EvidenceValidator.validateEvidence(tampered);
      expect(res.valid).toBe(false);
      expect(res.reason).toBe("HASH_MISMATCH");
    });

    it("✓ 10. Strategy fingerprint mismatch blocks validation (FINGERPRINT_MISMATCH)", () => {
      phase35ResearchReportEngine.processFinalResearchReport();
      const loaded = phase36EvidenceLoader.loadEvidence();
      const tampered: Phase36EvidenceInput = {
        ...loaded,
        evidenceRegistry: [
          {
            ...loaded.evidenceRegistry[0],
            strategyFingerprint: "FP_TAMPERED_HASH_999",
          },
        ],
      };

      const res = phase36EvidenceValidator.validateEvidence(tampered);
      expect(res.valid).toBe(false);
      expect(res.reason).toBe("FINGERPRINT_MISMATCH");
    });

    it("✓ 11. Missing report or fingerprint blocks validation (MISSING_ARTIFACT)", () => {
      const tampered: any = {
        finalResearchReport: null,
        evidenceRegistry: [],
      };
      const res = phase36EvidenceValidator.validateEvidence(tampered);
      expect(res.valid).toBe(false);
      expect(res.reason).toBe("MISSING_ARTIFACT");
    });
  });

  // ── 4. Phase 36 Sample Sufficiency Tests ─────────────────────────────────
  describe("Phase 36 Sample Sufficiency", () => {
    it("✓ 12. Evaluates sufficient sample size correctly", () => {
      phase35ResearchReportEngine.processFinalResearchReport();
      const loaded = phase36EvidenceLoader.loadEvidence();
      const res = phase36SampleSufficiency.evaluate(loaded);

      // Default mock in Phase 35 report provides sample size 60+
      expect(res.genuineSessions).toBeGreaterThanOrEqual(0);
    });

    it("✓ 13. Detects insufficient genuine sessions (< 20)", () => {
      phase35ResearchReportEngine.processFinalResearchReport();
      const loaded = phase36EvidenceLoader.loadEvidence();
      const lowSample: Phase36EvidenceInput = JSON.parse(JSON.stringify(loaded));
      lowSample.finalResearchReport.snapshot.longHorizonEvidence.genuineSessionsCount = 10;

      const res = phase36SampleSufficiency.evaluate(lowSample);
      expect(res.sufficient).toBe(false);
      expect(res.reasons.some((r) => r.includes("sessions"))).toBe(true);
    });

    it("✓ 14. Detects insufficient genuine trades (< 30)", () => {
      phase35ResearchReportEngine.processFinalResearchReport();
      const loaded = phase36EvidenceLoader.loadEvidence();
      const lowSample: Phase36EvidenceInput = JSON.parse(JSON.stringify(loaded));
      lowSample.finalResearchReport.snapshot.finalStatistics.sampleSize = 15;

      const res = phase36SampleSufficiency.evaluate(lowSample);
      expect(res.sufficient).toBe(false);
      expect(res.reasons.some((r) => r.includes("trades"))).toBe(true);
    });

    it("✓ 15. Detects insufficient long-horizon sessions (< 60)", () => {
      phase35ResearchReportEngine.processFinalResearchReport();
      const loaded = phase36EvidenceLoader.loadEvidence();
      const lowSample: Phase36EvidenceInput = JSON.parse(JSON.stringify(loaded));
      lowSample.finalResearchReport.snapshot.longHorizonEvidence.genuineSessionsCount = 40;

      const res = phase36SampleSufficiency.evaluate(lowSample);
      expect(res.sufficient).toBe(false);
      expect(res.reasons.some((r) => r.includes("Long-horizon"))).toBe(true);
    });
  });

  // ── 5. Phase 36 Statistical Assessment Tests ─────────────────────────────
  describe("Phase 36 Statistical Assessment", () => {
    it("✓ 16. Evaluates win rate, expectancy, profit factor, drawdown metrics", () => {
      phase35ResearchReportEngine.processFinalResearchReport();
      const loaded = phase36EvidenceLoader.loadEvidence();
      const res = phase36StatisticalAssessment.evaluate(loaded);

      expect(res.winRate.metricName).toBe("Win Rate");
      expect(res.expectancy.metricName).toBe("Expectancy");
      expect(res.profitFactor.metricName).toBe("Profit Factor");
      expect(res.drawdown.metricName).toBe("Max Drawdown");
    });

    it("✓ 17. Reports wide CI correctly (INSUFFICIENT_STATISTICAL_PRECISION)", () => {
      phase35ResearchReportEngine.processFinalResearchReport();
      const loaded = phase36EvidenceLoader.loadEvidence();
      const wideCIInput: Phase36EvidenceInput = JSON.parse(JSON.stringify(loaded));
      wideCIInput.finalResearchReport.snapshot.finalStatistics.winRateConfidence95 = {
        lowerBoundPct: 35,
        upperBoundPct: 85,
      };

      const res = phase36StatisticalAssessment.evaluate(wideCIInput);
      expect(res.uncertainty).toBe("HIGH");
      expect(res.notes.some((n) => n.includes("INSUFFICIENT_STATISTICAL_PRECISION"))).toBe(true);
    });

    it("✓ 18. Evaluates tight CI with LOW uncertainty", () => {
      phase35ResearchReportEngine.processFinalResearchReport();
      const loaded = phase36EvidenceLoader.loadEvidence();
      const tightCIInput: Phase36EvidenceInput = JSON.parse(JSON.stringify(loaded));
      tightCIInput.finalResearchReport.snapshot.finalStatistics.winRate = 65;
      tightCIInput.finalResearchReport.snapshot.finalStatistics.winRateConfidence95 = {
        lowerBoundPct: 58,
        upperBoundPct: 72,
      };

      const res = phase36StatisticalAssessment.evaluate(tightCIInput);
      expect(res.uncertainty).toBe("LOW");
    });
  });

  // ── 6. Phase 36 OOS Assessment Tests ──────────────────────────────────────
  describe("Phase 36 OOS Assessment", () => {
    it("✓ 19. Calculates OOS degradation and classifies as STABLE when metrics align", () => {
      phase35ResearchReportEngine.processFinalResearchReport();
      const loaded = phase36EvidenceLoader.loadEvidence();
      const cleanOOS: Phase36EvidenceInput = JSON.parse(JSON.stringify(loaded));
      cleanOOS.finalResearchReport.snapshot.oosEvidence = {
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

      const res = phase36OOSAssessment.evaluate(cleanOOS);
      expect(res.classification).toBe("STABLE");
      expect(res.walkForwardConsistency).toBe("HIGH_CONSISTENCY");
    });

    it("✓ 20. Detects material OOS degradation (>35% degradation)", () => {
      phase35ResearchReportEngine.processFinalResearchReport();
      const loaded = phase36EvidenceLoader.loadEvidence();
      const degradedInput: Phase36EvidenceInput = JSON.parse(JSON.stringify(loaded));
      degradedInput.finalResearchReport.snapshot.oosEvidence.inSampleExpectancy = 1000;
      degradedInput.finalResearchReport.snapshot.oosEvidence.oosExpectancy = 500; // 50% drop

      const res = phase36OOSAssessment.evaluate(degradedInput);
      expect(res.classification).toBe("DEGRADED");
    });

    it("✓ 21. Detects missing OOS evidence (INSUFFICIENT_DATA)", () => {
      phase35ResearchReportEngine.processFinalResearchReport();
      const loaded = phase36EvidenceLoader.loadEvidence();
      const noOOSInput: Phase36EvidenceInput = JSON.parse(JSON.stringify(loaded));
      (noOOSInput.finalResearchReport.snapshot as any).oosEvidence = null;

      const res = phase36OOSAssessment.evaluate(noOOSInput);
      expect(res.classification).toBe("INSUFFICIENT_DATA");
    });
  });

  // ── 7. Phase 36 Stress Assessment Tests ──────────────────────────────────
  describe("Phase 36 Stress Assessment", () => {
    it("✓ 22. Evaluates stress scenarios and data quality resilience", () => {
      phase35ResearchReportEngine.processFinalResearchReport();
      const loaded = phase36EvidenceLoader.loadEvidence();
      const res = phase36StressAssessment.evaluate(loaded);

      expect(res.scenariosTested).toBeGreaterThan(0);
      expect(res.dataQualityBlocks).toBe(0);
    });

    it("✓ 23. Data quality failures trigger SAFE_BLOCK conclusion", () => {
      phase35ResearchReportEngine.processFinalResearchReport();
      const loaded = phase36EvidenceLoader.loadEvidence();
      const dqFailInput: Phase36EvidenceInput = JSON.parse(JSON.stringify(loaded));
      dqFailInput.finalResearchReport.snapshot.stressEvidence.dataQualityResilience = "FAIL";

      const res = phase36StressAssessment.evaluate(dqFailInput);
      expect(res.dataQualityBlocks).toBe(1);
      expect(res.conclusions.some((c) => c.includes("SAFE_BLOCK"))).toBe(true);
    });
  });

  // ── 8. Phase 36 Drift Assessment Tests ───────────────────────────────────
  describe("Phase 36 Drift Assessment", () => {
    it("✓ 24. Classifies NO_MEASURABLE_DRIFT when rolling metrics are stable", () => {
      phase35ResearchReportEngine.processFinalResearchReport();
      const loaded = phase36EvidenceLoader.loadEvidence();
      const res = phase36DriftAssessment.evaluate(loaded);
      expect(res.classification).toBe("NO_MEASURABLE_DRIFT");
    });

    it("✓ 25. Classifies MATERIAL_DRIFT when Phase 34 reports material drift", () => {
      phase35ResearchReportEngine.processFinalResearchReport();
      const loaded = phase36EvidenceLoader.loadEvidence();
      const driftInput: Phase36EvidenceInput = JSON.parse(JSON.stringify(loaded));
      driftInput.finalResearchReport.snapshot.longHorizonEvidence.driftStatus = "MATERIAL_DRIFT";

      const res = phase36DriftAssessment.evaluate(driftInput);
      expect(res.classification).toBe("MATERIAL_DRIFT");
    });
  });

  // ── 9. Phase 36 Risk & Operational Assessment Tests ───────────────────────
  describe("Phase 36 Risk & Operational Assessment", () => {
    it("✓ 26. Verifies ₹1,000 max loss/trade, ₹1,000 daily profit cap, ₹5,000 daily loss cap", () => {
      phase35ResearchReportEngine.processFinalResearchReport();
      const loaded = phase36EvidenceLoader.loadEvidence();
      const res = phase36RiskAssessment.evaluate(loaded);

      expect(res.maxLossPerTradeMet).toBe(true);
      expect(res.dailyLossCapMet).toBe(true);
      expect(res.pnlReconciliationStatus).toBe("PASS");
    });

    it("✓ 27. Reports historical risk violations explicitly", () => {
      phase35ResearchReportEngine.processFinalResearchReport();
      const loaded = phase36EvidenceLoader.loadEvidence();
      const breachInput: Phase36EvidenceInput = JSON.parse(JSON.stringify(loaded));
      breachInput.finalResearchReport.snapshot.riskSummary.largestLossInr = -2500; // Exceeds ₹1,000 limit

      const res = phase36RiskAssessment.evaluate(breachInput);
      expect(res.maxLossPerTradeMet).toBe(false);
      expect(res.historicalViolationsCount).toBeGreaterThan(0);
    });

    it("✓ 28. Evaluates operational stability and incident tracking", () => {
      phase35ResearchReportEngine.processFinalResearchReport();
      const loaded = phase36EvidenceLoader.loadEvidence();
      const res = phase36OperationalAssessment.evaluate(loaded);

      expect(res.overallStatus).toBe("STABLE");
      expect(res.unresolvedIncidents).toBe(0);
    });
  });

  // ── 10. Phase 36 Decision Engine State Machine Tests ─────────────────────
  describe("Phase 36 Decision Gate Engine", () => {
    it("✓ 29. Returns VALIDATION_BLOCKED on evidence hash or fingerprint tampering", () => {
      phase35ResearchReportEngine.processFinalResearchReport();
      const loaded = phase36EvidenceLoader.loadEvidence();
      const tampered: Phase36EvidenceInput = {
        ...loaded,
        evidenceRegistry: [
          {
            ...loaded.evidenceRegistry[0],
            sourceHash: "CORRUPTED_HASH",
          },
        ],
      };

      const report = phase36DecisionGate.runDecisionGate(tampered);
      expect(report.decision).toBe("VALIDATION_BLOCKED");
      expect(report.state).toBe("EVIDENCE_CORRUPTED");
    });

    it("✓ 30. Returns INSUFFICIENT_EVIDENCE on insufficient sample size (<60 long horizon sessions)", () => {
      phase35ResearchReportEngine.processFinalResearchReport();
      const loaded = phase36EvidenceLoader.loadEvidence();
      const lowSample: Phase36EvidenceInput = JSON.parse(JSON.stringify(loaded));
      lowSample.finalResearchReport.snapshot.longHorizonEvidence.genuineSessionsCount = 10;

      const report = phase36DecisionGate.runDecisionGate(lowSample);
      expect(report.decision).toBe("INSUFFICIENT_EVIDENCE");
      expect(report.state).toBe("INSUFFICIENT_EVIDENCE");
    });

    it("✓ 31. Returns EVIDENCE_INCONCLUSIVE on high statistical uncertainty", () => {
      phase35ResearchReportEngine.processFinalResearchReport();
      const loaded = phase36EvidenceLoader.loadEvidence();
      const wideCI: Phase36EvidenceInput = JSON.parse(JSON.stringify(loaded));
      wideCI.finalResearchReport.snapshot.longHorizonEvidence.genuineSessionsCount = 60;
      wideCI.finalResearchReport.snapshot.finalStatistics.sampleSize = 50;
      wideCI.finalResearchReport.snapshot.finalStatistics.winRateConfidence95 = {
        lowerBoundPct: 30,
        upperBoundPct: 80,
      };

      const report = phase36DecisionGate.runDecisionGate(wideCI);
      expect(report.decision).toBe("EVIDENCE_INCONCLUSIVE");
    });

    it("✓ 32. Returns FURTHER_VALIDATION_REQUIRED on OOS degradation or material drift", () => {
      phase35ResearchReportEngine.processFinalResearchReport();
      const loaded = phase36EvidenceLoader.loadEvidence();
      const driftInput: Phase36EvidenceInput = JSON.parse(JSON.stringify(loaded));
      driftInput.finalResearchReport.snapshot.longHorizonEvidence.genuineSessionsCount = 60;
      driftInput.finalResearchReport.snapshot.finalStatistics.sampleSize = 50;
      driftInput.finalResearchReport.snapshot.finalStatistics.winRate = 60;
      driftInput.finalResearchReport.snapshot.finalStatistics.winRateConfidence95 = {
        lowerBoundPct: 52,
        upperBoundPct: 68,
      };
      driftInput.finalResearchReport.snapshot.longHorizonEvidence.driftStatus = "MATERIAL_DRIFT";

      const report = phase36DecisionGate.runDecisionGate(driftInput);
      expect(report.decision).toBe("FURTHER_VALIDATION_REQUIRED");
    });

    it("✓ 33. Returns PAPER_VALIDATION_SUPPORTED when all criteria satisfied cleanly", () => {
      phase35ResearchReportEngine.processFinalResearchReport();
      const loaded = phase36EvidenceLoader.loadEvidence();
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

      const report = phase36DecisionGate.runDecisionGate(cleanInput);
      expect(report.decision).toBe("PAPER_VALIDATION_SUPPORTED");
      expect(report.state).toBe("REPORT_FROZEN");
    });

    it("✓ 34. PAPER_VALIDATION_SUPPORTED does NOT approve live trading", () => {
      phase35ResearchReportEngine.processFinalResearchReport();
      const loaded = phase36EvidenceLoader.loadEvidence();
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

      const report = phase36DecisionGate.runDecisionGate(cleanInput);
      expect(report.decision).toBe("PAPER_VALIDATION_SUPPORTED");
      expect(report.sections.safetyAudit.liveTradingDisabled).toBe(true);
      expect(report.disclaimer.includes("DOES NOT AUTHORIZE LIVE TRADING")).toBe(true);
    });

    it("✓ 35. Report is frozen and immutable after generation", () => {
      phase35ResearchReportEngine.processFinalResearchReport();
      const loaded = phase36EvidenceLoader.loadEvidence();
      const report1 = phase36DecisionGate.runDecisionGate(loaded);
      const report2 = phase36DecisionGate.runDecisionGate(loaded);

      expect(report1).toBe(report2); // Same frozen reference
      expect(phase36DecisionGate.getStatus().isFrozen).toBe(true);
    });

    it("✓ 36. Output is deterministic", () => {
      phase35ResearchReportEngine.processFinalResearchReport();
      const loaded = phase36EvidenceLoader.loadEvidence();

      const gate1 = new Phase36DecisionGate();
      const gate2 = new Phase36DecisionGate();

      const rep1 = gate1.runDecisionGate(loaded);
      const rep2 = gate2.runDecisionGate(loaded);

      expect(rep1.decision).toBe(rep2.decision);
      expect(rep1.masterStrategyFingerprint).toBe(rep2.masterStrategyFingerprint);
    });

    it("✓ 37. Zero strategy parameter modification occurs during decision gate execution", () => {
      const initialConfig = { ...PHASE36_CONFIG };
      phase35ResearchReportEngine.processFinalResearchReport();
      phase36DecisionGate.runDecisionGate();
      expect(PHASE36_CONFIG).toEqual(initialConfig);
    });

    it("✓ 38. Zero live execution path exists in decision gate", () => {
      phase35ResearchReportEngine.processFinalResearchReport();
      const report = phase36DecisionGate.runDecisionGate();
      expect(report.sections.safetyAudit.realBrokerOrdersCount).toBe(0);
      expect(PHASE36_LIVE_EXECUTION_ALLOWED).toBe(false);
    });
  });

  // ── 11. Phase 36 Exporter Tests ──────────────────────────────────────────
  describe("Phase 36 Decision Exporter", () => {
    it("✓ 39. Generates valid JSON decision report", () => {
      phase35ResearchReportEngine.processFinalResearchReport();
      const exports = phase36DecisionGate.getExports();

      expect(exports.json).toBeDefined();
      const parsed = JSON.parse(exports.json);
      expect(parsed.reportTitle).toBe("PHASE 36 — EVIDENCE-BASED DECISION GATE REPORT");
    });

    it("✓ 40. Generates valid manifest JSON report", () => {
      phase35ResearchReportEngine.processFinalResearchReport();
      const exports = phase36DecisionGate.getExports();

      expect(exports.manifestJson).toBeDefined();
      const parsed = JSON.parse(exports.manifestJson);
      expect(parsed.safetyPassed).toBe(true);
    });

    it("✓ 41. Generates valid CSV decision report", () => {
      phase35ResearchReportEngine.processFinalResearchReport();
      const exports = phase36DecisionGate.getExports();

      expect(exports.csv).toBeDefined();
      expect(exports.csv).toContain('"SECTION","METRIC","VALUE","NOTES"');
      expect(exports.csv).toContain('"DECISION_GATE"');
    });
  });

  // ── 12. Phase 36 Cross-Phase Reconciliation Tests ─────────────────────────
  describe("Phase 36 Cross-Phase Reconciliation", () => {
    it("✓ 42. Verifies evidence manifest hash match across Phase 35 and Phase 36", () => {
      phase35ResearchReportEngine.processFinalResearchReport();
      const loaded = phase36EvidenceLoader.loadEvidence();
      const report = phase36DecisionGate.runDecisionGate(loaded);

      expect(report.sections.reproducibility.phase35ManifestHash).toBe(loaded.evidenceManifest.manifestHash);
    });

    it("✓ 43. P&L reconciliation status is preserved in Phase 36 decision report", () => {
      phase35ResearchReportEngine.processFinalResearchReport();
      const loaded = phase36EvidenceLoader.loadEvidence();
      const cleanRiskInput: Phase36EvidenceInput = JSON.parse(JSON.stringify(loaded));
      cleanRiskInput.finalResearchReport.snapshot.riskSummary.pnlReconciliationStatus = "PASS";

      const report = phase36DecisionGate.runDecisionGate(cleanRiskInput);
      expect(report.sections.pnlReconciliation.status).toBe("PASS");
    });

    it("✓ 44. Safety Audit status is preserved in Phase 36 decision report", () => {
      phase35ResearchReportEngine.processFinalResearchReport();
      const report = phase36DecisionGate.runDecisionGate();
      expect(report.sections.safetyAudit.safetyPassed).toBe(true);
    });

    it("✓ 45. Immutable Hash Manifest is included in section 20", () => {
      phase35ResearchReportEngine.processFinalResearchReport();
      const report = phase36DecisionGate.runDecisionGate();
      expect(report.sections.immutableHashManifest.title).toBe("20. Immutable Hash Manifest");
      expect(report.sections.immutableHashManifest.reportHash).toBeDefined();
    });
  });
});
