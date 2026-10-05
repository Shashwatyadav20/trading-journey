import { Phase35EvidenceArtifact } from "./Phase35EvidenceRegistry";
import { Phase35EvidenceManifest, Phase35ReconciliationResult } from "./Phase35CrossPhaseReconciler";
import { Phase35EvidenceSnapshot } from "./Phase35EvidenceSnapshot";

export interface Phase35ReproducibilityManifest {
  strategyFingerprint: string;
  phase27Hash: string;
  phase31Hash: string;
  phase32Hash: string;
  phase33Hash: string;
  phase34Hash: string;
  reportHash: string;
  softwareVersion: string;
  nodeVersion: string;
  typescriptVersion: string;
  generatedAt: string;
}

export class Phase35ReportExporter {
  public generateResearchReportJson(
    report: any,
    snapshot: Phase35EvidenceSnapshot,
    manifest: Phase35EvidenceManifest,
    reconciliation: Phase35ReconciliationResult
  ): string {
    const sanitized = this.sanitizeObject({
      report,
      snapshot,
      manifest,
      reconciliation,
    });
    return JSON.stringify(sanitized, null, 2);
  }

  public generateResearchReportCsv(snapshot: Phase35EvidenceSnapshot): string {
    const headers = ["section", "metric", "value", "classification"];
    const rows: string[][] = [
      ["Executive Summary", "Sample Size", String(snapshot.finalStatistics.sampleSize), "OBSERVED"],
      ["Executive Summary", "Win Rate (%)", `${snapshot.finalStatistics.winRate}%`, "CALCULATED"],
      ["Executive Summary", "Expectancy (₹)", `₹${snapshot.finalStatistics.expectancy}`, "CALCULATED"],
      ["Executive Summary", "Profit Factor", String(snapshot.finalStatistics.profitFactor), "CALCULATED"],
      ["Executive Summary", "Max Drawdown (₹)", `₹${snapshot.finalStatistics.maxDrawdown}`, "CALCULATED"],
      ["OOS Validation", "In-Sample Win Rate", `${snapshot.oosEvidence.inSampleWinRate}%`, "OBSERVED"],
      ["OOS Validation", "Out-of-Sample Win Rate", `${snapshot.oosEvidence.oosWinRate}%`, "OBSERVED"],
      ["OOS Validation", "Win Rate Diff", `${snapshot.oosEvidence.winRateDiff} pp`, "CALCULATED"],
      ["Stress Testing", "Worst Sequence Drawdown", `₹${snapshot.stressEvidence.worstSequenceDrawdown}`, "SCENARIO"],
      ["Stress Testing", "Monte Carlo P95 DD", `₹${snapshot.stressEvidence.monteCarloP95Drawdown}`, "SCENARIO"],
      ["Long-Horizon Validation", "Genuine Sessions", String(snapshot.longHorizonEvidence.genuineSessionsCount), "OBSERVED"],
      ["Long-Horizon Validation", "Drift Status", snapshot.longHorizonEvidence.driftStatus, "CALCULATED"],
      ["Safety Audit", "Live Trading Enabled", String(snapshot.safetyAudit.liveTrading), "ASSUMPTION"],
      ["Safety Audit", "Real Broker Orders", String(snapshot.safetyAudit.realBrokerOrders), "OBSERVED"],
    ];

    return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  }

  public generateEvidenceRegistryJson(artifacts: readonly Phase35EvidenceArtifact[]): string {
    return JSON.stringify(this.sanitizeObject(artifacts), null, 2);
  }

  public generateEvidenceManifestJson(manifest: Phase35EvidenceManifest): string {
    return JSON.stringify(this.sanitizeObject(manifest), null, 2);
  }

  public generateSafetyAuditJson(safetyAudit: any): string {
    return JSON.stringify(this.sanitizeObject(safetyAudit), null, 2);
  }

  public generateReproducibilityManifestJson(reproducibility: Phase35ReproducibilityManifest): string {
    return JSON.stringify(this.sanitizeObject(reproducibility), null, 2);
  }

  private sanitizeObject(obj: any): any {
    const jsonString = JSON.stringify(obj, (key, value) => {
      // Remove any sensitive keys if accidentally present
      if (
        key.toLowerCase().includes("secret") ||
        key.toLowerCase().includes("token") ||
        key.toLowerCase().includes("key") ||
        key.toLowerCase().includes("password")
      ) {
        return undefined;
      }
      return value;
    });
    return JSON.parse(jsonString);
  }
}

export const phase35ReportExporter = new Phase35ReportExporter();
