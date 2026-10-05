import { Phase36DecisionReport } from "./Phase36Types";

export class Phase36DecisionExporter {
  public exportJson(report: Phase36DecisionReport): string {
    return JSON.stringify(report, null, 2);
  }

  public exportManifestJson(report: Phase36DecisionReport): string {
    const manifest = {
      reportId: report.reportId,
      decision: report.decision,
      masterStrategyFingerprint: report.masterStrategyFingerprint,
      state: report.state,
      generatedAt: report.generatedAt,
      sectionsCount: Object.keys(report.sections).length,
      safetyPassed: report.sections.safetyAudit?.safetyPassed ?? false,
      reproducibility: report.sections.reproducibility,
      immutableHashManifest: report.sections.immutableHashManifest,
    };
    return JSON.stringify(manifest, null, 2);
  }

  public exportCsv(report: Phase36DecisionReport): string {
    const rows = [
      ["SECTION", "METRIC", "VALUE", "NOTES"],
      ["DECISION_GATE", "Final Decision", report.decision, report.disclaimer],
      ["DECISION_GATE", "State", report.state, ""],
      ["DECISION_GATE", "Master Fingerprint", report.masterStrategyFingerprint, ""],
      ["SAMPLE_SUFFICIENCY", "Sufficient", String(report.sections.sampleSufficiency.sufficient), ""],
      ["SAMPLE_SUFFICIENCY", "Genuine Sessions", String(report.sections.sampleSufficiency.genuineSessions), ""],
      ["SAMPLE_SUFFICIENCY", "Genuine Trades", String(report.sections.sampleSufficiency.genuineTrades), ""],
      ["SAMPLE_SUFFICIENCY", "Active Sessions", String(report.sections.sampleSufficiency.activeSessions), ""],
      ["SAMPLE_SUFFICIENCY", "Long Horizon Sessions", String(report.sections.sampleSufficiency.longHorizonSessions), ""],
      ["STATISTICS", "Win Rate", String(report.sections.statisticalAssessment.winRate.value), ""],
      ["STATISTICS", "Expectancy", String(report.sections.statisticalAssessment.expectancy.value), ""],
      ["STATISTICS", "Profit Factor", String(report.sections.statisticalAssessment.profitFactor.value), ""],
      ["STATISTICS", "Max Drawdown", String(report.sections.statisticalAssessment.drawdown.value), ""],
      ["STATISTICS", "Uncertainty", report.sections.statisticalAssessment.uncertainty, ""],
      ["OOS", "Classification", report.sections.oosAssessment.classification, ""],
      ["STRESS", "Scenarios Tested", String(report.sections.stressAssessment.scenariosTested), ""],
      ["STRESS", "Scenarios Passing", String(report.sections.stressAssessment.scenariosPassing), ""],
      ["DRIFT", "Classification", report.sections.longHorizonDrift.classification, ""],
      ["RISK", "Violations Count", String(report.sections.riskBehaviour.historicalViolationsCount), ""],
      ["OPERATIONAL", "Status", report.sections.operationalStability.overallStatus, ""],
      ["SAFETY", "Safety Passed", String(report.sections.safetyAudit.safetyPassed), ""],
    ];

    return rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
  }
}

export const phase36DecisionExporter = new Phase36DecisionExporter();
