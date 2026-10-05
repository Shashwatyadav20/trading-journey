import { Phase36EvidenceInput, OperationalAssessmentResult } from "./Phase36Types";

export class Phase36OperationalAssessment {
  public evaluate(input: Phase36EvidenceInput): OperationalAssessmentResult {
    const ops = input.finalResearchReport?.snapshot?.operationalStability;
    const risk = input.finalResearchReport?.snapshot?.riskSummary;

    if (!ops) {
      return {
        totalIncidents: 0,
        recoverableIncidents: 0,
        unresolvedIncidents: 0,
        duplicateRiskDetected: false,
        reconciliationPassed: true,
        overallStatus: "STABLE",
      };
    }

    const dhanAuthFailures = ops.dhanConnectionFailures || 0;
    const wsDisconnects = ops.webSocketFailures || 0;
    const optionChainFailures = ops.optionChainFailures || 0;
    const staleQuotes = ops.staleDataEvents || 0;
    const spotOptionMismatch = ops.priceMismatchEvents || 0;
    const backendRestart = ops.backendRestartEvents || 0;
    const duplicateSuppression = ops.duplicateSuppressionEvents || 0;
    const unresolvedIncidents = ops.unresolvedIncidents || 0;

    const totalIncidents =
      dhanAuthFailures +
      wsDisconnects +
      optionChainFailures +
      staleQuotes +
      spotOptionMismatch +
      backendRestart;

    const recoverableIncidents = Math.max(0, totalIncidents - unresolvedIncidents);
    const duplicateRiskDetected = duplicateSuppression > 0;
    const reconciliationPassed = (risk?.pnlReconciliationStatus || "PASS") === "PASS";

    const overallStatus =
      unresolvedIncidents === 0 && reconciliationPassed
        ? "STABLE"
        : "UNSTABLE";

    return {
      totalIncidents,
      recoverableIncidents,
      unresolvedIncidents,
      duplicateRiskDetected,
      reconciliationPassed,
      overallStatus,
    };
  }
}

export const phase36OperationalAssessment = new Phase36OperationalAssessment();
