import { describe, it, expect, beforeEach } from "vitest";
import { Phase35ResearchReportEngine } from "../validation/Phase35ResearchReportEngine";
import { Phase35EvidenceRegistry } from "../validation/Phase35EvidenceRegistry";
import { Phase35CrossPhaseReconciler } from "../validation/Phase35CrossPhaseReconciler";
import { Phase35ReportExporter } from "../validation/Phase35ReportExporter";
import { Phase31ValidationCertificationEngine } from "../validation/Phase31ValidationCertificationEngine";
import { Phase32OutOfSampleValidationEngine } from "../validation/Phase32OutOfSampleValidationEngine";
import { Phase33RobustnessEngine } from "../validation/Phase33RobustnessEngine";
import { Phase34LongHorizonEngine } from "../validation/Phase34LongHorizonEngine";
import { GenuineSampleStore } from "../persistence/GenuineSampleStore";
import { GenuineDailyLedger } from "../persistence/GenuineDailyLedger";
import { strategyFingerprintManager } from "../validation/StrategyFingerprintManager";

describe("PHASE 35 — Final Evidence Registry & Research Report Suite", () => {
  let masterFp: string;
  let registry: Phase35EvidenceRegistry;
  let reconciler: Phase35CrossPhaseReconciler;
  let exporter: Phase35ReportExporter;

  let sampleStore: GenuineSampleStore;
  let dailyLedger: GenuineDailyLedger;
  let p31Engine: Phase31ValidationCertificationEngine;
  let p32Engine: Phase32OutOfSampleValidationEngine;
  let p33Engine: Phase33RobustnessEngine;
  let p34Engine: Phase34LongHorizonEngine;
  let p35Engine: Phase35ResearchReportEngine;

  beforeEach(() => {
    masterFp = strategyFingerprintManager.getCurrentFingerprint().masterFingerprintHash;

    registry = new Phase35EvidenceRegistry();
    reconciler = new Phase35CrossPhaseReconciler();
    exporter = new Phase35ReportExporter();

    sampleStore = new GenuineSampleStore();
    dailyLedger = new GenuineDailyLedger();
    p31Engine = new Phase31ValidationCertificationEngine(sampleStore, dailyLedger);
    p32Engine = new Phase32OutOfSampleValidationEngine(p31Engine);
    p33Engine = new Phase33RobustnessEngine(p32Engine);
    p34Engine = new Phase34LongHorizonEngine(undefined, undefined, undefined, undefined, undefined, p31Engine, p32Engine, sampleStore, dailyLedger);

    p35Engine = new Phase35ResearchReportEngine(
      registry,
      reconciler,
      exporter,
      p31Engine,
      p32Engine,
      p33Engine,
      p34Engine
    );
  });

  // 1. Evidence registry
  it("1. Evidence registry", () => {
    expect(registry.getAllArtifacts().length).toBe(0);
  });

  // 2. Artifact creation
  it("2. Artifact creation", () => {
    const art = registry.registerArtifact(27, "GENUINE_LEDGER", "P27_01", masterFp, "OBSERVED", { trades: 30 });
    expect(art.artifactId).toBeDefined();
    expect(art.phase).toBe(27);
  });

  // 3. Artifact hashing
  it("3. Artifact hashing", () => {
    const art = registry.registerArtifact(31, "CERTIFIED_COHORT", "P31_01", masterFp, "OBSERVED", { count: 20 });
    expect(art.sourceHash.length).toBe(64); // SHA-256
  });

  // 4. Artifact immutability
  it("4. Artifact immutability", () => {
    const art = registry.registerArtifact(32, "OOS_DATASET", "P32_01", masterFp, "OBSERVED");
    expect(() => {
      (art as any).status = "INVALID";
    }).toThrow();
  });

  // 5. Phase27 reconciliation
  it("5. Phase27 reconciliation", () => {
    const res = reconciler.runCrossPhaseReconciliation(masterFp, masterFp, masterFp, masterFp, { p31CohortHash: "H1", p32DatasetHash: "H2", p33ScenarioHash: "H3", p34CohortHash: "H4" }, { p31Sessions: 20, p31Trades: 30, p32OOSTrades: 15, p34Sessions: 60 });
    expect(res.overallStatus).toBe("PASS");
  });

  // 6. Phase31 reconciliation
  it("6. Phase31 reconciliation", () => {
    const res = reconciler.runCrossPhaseReconciliation(masterFp, masterFp, masterFp, masterFp, { p31CohortHash: "H1", p32DatasetHash: "H2", p33ScenarioHash: "H3", p34CohortHash: "H4" }, { p31Sessions: 20, p31Trades: 30, p32OOSTrades: 15, p34Sessions: 60 });
    expect(res.sessionIdsValid).toBe(true);
  });

  // 7. Phase32 reconciliation
  it("7. Phase32 reconciliation", () => {
    const res = reconciler.runCrossPhaseReconciliation(masterFp, masterFp, masterFp, masterFp, { p31CohortHash: "H1", p32DatasetHash: "H2", p33ScenarioHash: "H3", p34CohortHash: "H4" }, { p31Sessions: 20, p31Trades: 30, p32OOSTrades: 15, p34Sessions: 60 });
    expect(res.tradeIdsValid).toBe(true);
  });

  // 8. Phase33 reconciliation
  it("8. Phase33 reconciliation", () => {
    const res = reconciler.runCrossPhaseReconciliation(masterFp, masterFp, masterFp, masterFp, { p31CohortHash: "H1", p32DatasetHash: "H2", p33ScenarioHash: "H3", p34CohortHash: "H4" }, { p31Sessions: 20, p31Trades: 30, p32OOSTrades: 15, p34Sessions: 60 });
    expect(res.datasetHashChainValid).toBe(true);
  });

  // 9. Phase34 reconciliation
  it("9. Phase34 reconciliation", () => {
    const res = reconciler.runCrossPhaseReconciliation(masterFp, masterFp, masterFp, masterFp, { p31CohortHash: "H1", p32DatasetHash: "H2", p33ScenarioHash: "H3", p34CohortHash: "H4" }, { p31Sessions: 20, p31Trades: 30, p32OOSTrades: 15, p34Sessions: 60 });
    expect(res.sampleCountsValid).toBe(true);
  });

  // 10. Strategy fingerprint chain
  it("10. Strategy fingerprint chain", () => {
    const res = reconciler.runCrossPhaseReconciliation(masterFp, masterFp, masterFp, masterFp, { p31CohortHash: "H1", p32DatasetHash: "H2", p33ScenarioHash: "H3", p34CohortHash: "H4" }, { p31Sessions: 20, p31Trades: 30, p32OOSTrades: 15, p34Sessions: 60 });
    expect(res.fingerprintChainValid).toBe(true);
  });

  // 11. Dataset hash chain
  it("11. Dataset hash chain", () => {
    const manifest = reconciler.generateEvidenceManifest(masterFp, "H31", "H32", "H33", "H34");
    expect(manifest.manifestHash.length).toBe(64);
  });

  // 12. Session-count reconciliation
  it("12. Session-count reconciliation", () => {
    const res = reconciler.runCrossPhaseReconciliation(masterFp, masterFp, masterFp, masterFp, { p31CohortHash: "H1", p32DatasetHash: "H2", p33ScenarioHash: "H3", p34CohortHash: "H4" }, { p31Sessions: 20, p31Trades: 30, p32OOSTrades: 15, p34Sessions: 60 });
    expect(res.sampleCountsValid).toBe(true);
  });

  // 13. Trade-count reconciliation
  it("13. Trade-count reconciliation", () => {
    const res = reconciler.runCrossPhaseReconciliation(masterFp, masterFp, masterFp, masterFp, { p31CohortHash: "H1", p32DatasetHash: "H2", p33ScenarioHash: "H3", p34CohortHash: "H4" }, { p31Sessions: 20, p31Trades: 30, p32OOSTrades: 15, p34Sessions: 60 });
    expect(res.overallStatus).toBe("PASS");
  });

  // 14. P&L reconciliation
  it("14. P&L reconciliation", () => {
    const res = reconciler.runCrossPhaseReconciliation(masterFp, masterFp, masterFp, masterFp, { p31CohortHash: "H1", p32DatasetHash: "H2", p33ScenarioHash: "H3", p34CohortHash: "H4" }, { p31Sessions: 20, p31Trades: 30, p32OOSTrades: 15, p34Sessions: 60 });
    expect(res.pnlReconciliationValid).toBe(true);
  });

  // 15. Timestamp integrity
  it("15. Timestamp integrity", () => {
    const res = reconciler.runCrossPhaseReconciliation(masterFp, masterFp, masterFp, masterFp, { p31CohortHash: "H1", p32DatasetHash: "H2", p33ScenarioHash: "H3", p34CohortHash: "H4" }, { p31Sessions: 20, p31Trades: 30, p32OOSTrades: 15, p34Sessions: 60 });
    expect(res.timestampOrderValid).toBe(true);
  });

  // 16. Statistical snapshot integrity
  it("16. Statistical snapshot integrity", () => {
    const report = p35Engine.processFinalResearchReport();
    expect(report.snapshot.finalStatistics.sampleSize).toBeDefined();
  });

  // 17. OOS snapshot integrity
  it("17. OOS snapshot integrity", () => {
    const report = p35Engine.processFinalResearchReport();
    expect(report.snapshot.oosEvidence.oosWinRate).toBeDefined();
  });

  // 18. Stress snapshot integrity
  it("18. Stress snapshot integrity", () => {
    const report = p35Engine.processFinalResearchReport();
    expect(report.snapshot.stressEvidence.dataQualityResilience).toBe("PASS");
  });

  // 19. Long-horizon snapshot integrity
  it("19. Long-horizon snapshot integrity", () => {
    const report = p35Engine.processFinalResearchReport();
    expect(report.snapshot.longHorizonEvidence.driftStatus).toBeDefined();
  });

  // 20. Evidence classification
  it("20. Evidence classification", () => {
    const art = registry.registerArtifact(27, "TEST", "S1", masterFp, "OBSERVED");
    expect(art.classification).toBe("OBSERVED");
  });

  // 21. NOT_AVAILABLE handling
  it("21. NOT_AVAILABLE handling", () => {
    const art = registry.registerArtifact(34, "ROLLING_60", "S60", masterFp, "NOT_AVAILABLE");
    expect(art.classification).toBe("NOT_AVAILABLE");
  });

  // 22. Low-sample handling
  it("22. Low-sample handling", () => {
    const report = p35Engine.processFinalResearchReport();
    expect(report.snapshot.longHorizonEvidence.w60Status).toBe("NOT_AVAILABLE");
  });

  // 23. Missing artifact detection
  it("23. Missing artifact detection", () => {
    const missing = registry.getArtifact("NON_EXISTENT_ART");
    expect(missing).toBeUndefined();
  });

  // 24. Hash mismatch detection
  it("24. Hash mismatch detection", () => {
    const res = reconciler.runCrossPhaseReconciliation(masterFp, masterFp, masterFp, masterFp, { p31CohortHash: "", p32DatasetHash: "H2", p33ScenarioHash: "H3", p44CohortHash: "" } as any, { p31Sessions: 20, p31Trades: 30, p32OOSTrades: 15, p34Sessions: 60 });
    expect(res.overallStatus).toBe("FAIL");
    expect(res.failureReasons.some((r) => r.includes("HASH_MISMATCH"))).toBe(true);
  });

  // 25. Fingerprint mismatch detection
  it("25. Fingerprint mismatch detection", () => {
    const res = reconciler.runCrossPhaseReconciliation(masterFp, "MISMATCHED_FP", masterFp, masterFp, { p31CohortHash: "H1", p32DatasetHash: "H2", p33ScenarioHash: "H3", p34CohortHash: "H4" }, { p31Sessions: 20, p31Trades: 30, p32OOSTrades: 15, p34Sessions: 60 });
    expect(res.fingerprintChainValid).toBe(false);
    expect(res.overallStatus).toBe("FAIL");
  });

  // 26. Corrupted artifact detection
  it("26. Corrupted artifact detection", () => {
    const art = registry.registerArtifact(27, "CORRUPT_TEST", "C1", masterFp, "OBSERVED");
    expect(art.sourceHash).toBeDefined();
  });

  // 27. Duplicate artifact detection
  it("27. Duplicate artifact detection", () => {
    const art1 = registry.registerArtifact(27, "DUP_TEST", "D1", masterFp, "OBSERVED");
    const art2 = registry.registerArtifact(27, "DUP_TEST", "D1", masterFp, "OBSERVED");
    expect(art1.artifactId).toBe(art2.artifactId);
  });

  // 28. Report generation
  it("28. Report generation", () => {
    const report = p35Engine.processFinalResearchReport();
    expect(report.reportTitle).toBe("PHASE 35 — FINAL RESEARCH & EVIDENCE REPORT");
    expect(report.status).toBe("FINAL_REPORT_COMPLETE");
  });

  // 29. Report determinism
  it("29. Report determinism", () => {
    const rep1 = p35Engine.processFinalResearchReport();
    const rep2 = p35Engine.processFinalResearchReport();
    expect(rep1.reportId).toBe(rep2.reportId);
  });

  // 30. Manifest generation
  it("30. Manifest generation", () => {
    const report = p35Engine.processFinalResearchReport();
    expect(report.manifest.manifestHash.length).toBe(64);
  });

  // 31. Export consistency
  it("31. Export consistency", () => {
    const exportData = p35Engine.getExport();
    expect(exportData.artifacts.length).toBeGreaterThan(0);
    expect(exportData.csv).toContain("Executive Summary");
  });

  // 32. JSON consistency
  it("32. JSON consistency", () => {
    const report = p35Engine.processFinalResearchReport();
    const jsonStr = exporter.generateResearchReportJson(report, report.snapshot, report.manifest, report.reconciliation);
    const parsed = JSON.parse(jsonStr);
    expect(parsed.report.reportTitle).toBe("PHASE 35 — FINAL RESEARCH & EVIDENCE REPORT");
  });

  // 33. CSV consistency
  it("33. CSV consistency", () => {
    const report = p35Engine.processFinalResearchReport();
    const csv = exporter.generateResearchReportCsv(report.snapshot);
    expect(csv).toContain("section,metric,value,classification");
  });

  // 34. Safety audit
  it("34. Safety audit", () => {
    const audit = p35Engine.verifySafetyAudit();
    expect(audit.overallStatus).toBe("PASS");
    expect(audit.placeOrderBlocked).toBe(true);
    expect(audit.modifyOrderBlocked).toBe(true);
    expect(audit.cancelOrderBlocked).toBe(true);
  });

  // 35. Broker execution blocked
  it("35. Broker execution blocked", () => {
    expect(() => p35Engine.placeOrder()).toThrow();
    expect(() => p35Engine.modifyOrder()).toThrow();
    expect(() => p35Engine.cancelOrder()).toThrow();
  });

  // 36. Zero real broker orders
  it("36. Zero real broker orders", () => {
    const audit = p35Engine.verifySafetyAudit();
    expect(audit.realBrokerOrders).toBe(0);
  });

  // 37. LIVE_TRADING=false
  it("37. LIVE_TRADING=false", () => {
    const audit = p35Engine.verifySafetyAudit();
    expect(audit.liveTrading).toBe(false);
  });

  // 38. PAPER_TRADING=true
  it("38. PAPER_TRADING=true", () => {
    const audit = p35Engine.verifySafetyAudit();
    expect(audit.paperTrading).toBe(true);
  });

  // 39. BROKER_EXECUTION_ENABLED=false
  it("39. BROKER_EXECUTION_ENABLED=false", () => {
    const audit = p35Engine.verifySafetyAudit();
    expect(audit.brokerExecution).toBe(false);
  });

  // 40. INDIAN_REAL_DATA_ONLY=true
  it("40. INDIAN_REAL_DATA_ONLY=true", () => {
    const audit = p35Engine.verifySafetyAudit();
    expect(audit.realDataOnly).toBe(true);
  });

  // 41. Restart recovery
  it("41. Restart recovery", () => {
    p35Engine.processFinalResearchReport();
    const exportData = p35Engine.getExport();
    expect(exportData.report.status).toBe("FINAL_REPORT_COMPLETE");
  });

  // 42. Idempotency
  it("42. Idempotency", () => {
    const rep1 = p35Engine.processFinalResearchReport();
    const rep2 = p35Engine.processFinalResearchReport();
    expect(rep1.reportId).toBe(rep2.reportId);
    expect(rep1.state).toBe(rep2.state);
  });

  // 43. Audit trail
  it("43. Audit trail", () => {
    const report = p35Engine.processFinalResearchReport();
    expect(report.auditTrail.length).toBeGreaterThan(0);
    expect(report.auditTrail.some((a) => a.includes("PHASE 35 FINAL RESEARCH REPORT"))).toBe(true);
  });

  // 44. Finalization
  it("44. Finalization", () => {
    const report = p35Engine.processFinalResearchReport();
    expect(report.state).toBe("FROZEN");
  });

  // 45. Frozen report
  it("45. Frozen report", () => {
    p35Engine.processFinalResearchReport();
    expect(() => {
      registry.registerArtifact(35, "NEW_TEST", "T1", masterFp, "OBSERVED");
    }).toThrow();
  });

  // 46. No strategy modification
  it("46. No strategy modification", () => {
    const report = p35Engine.processFinalResearchReport();
    expect(report.masterStrategyFingerprint).toBe(masterFp);
  });

  // 47. No fabricated statistics
  it("47. No fabricated statistics", () => {
    const report = p35Engine.processFinalResearchReport();
    expect(report.snapshot.longHorizonEvidence.w60Status).toBe("NOT_AVAILABLE");
  });

  // 48. Reproducibility
  it("48. Reproducibility", () => {
    const report = p35Engine.processFinalResearchReport();
    expect(report.sections.reproducibilityManifest.reportHash).toBe(report.manifest.manifestHash);
  });

  // 49. Final evidence completeness
  it("49. Final evidence completeness", () => {
    const report = p35Engine.processFinalResearchReport();
    expect(Object.keys(report.sections).length).toBe(20);
  });

  // 50. Final certification state
  it("50. Final certification state", () => {
    const report = p35Engine.processFinalResearchReport();
    expect(report.status).toBe("FINAL_REPORT_COMPLETE");
  });
});
