import { Phase39RevalidationReport, Phase39Manifest, computeHash } from "./Phase39Types";

export class Phase39ReportExporter {
  public static exportManifest(report: Phase39RevalidationReport): Phase39Manifest {
    const statisticalSnapshotHash = computeHash(report.statisticalAudit);
    const safetyAuditHash = computeHash(report.safetyAudit);

    const sourceHashes: Record<string, string> = {
      timestampAuditHash: computeHash(report.timestampAudit),
      leakageAuditHash: computeHash(report.leakageAudit),
      pnlAuditHash: computeHash(report.pnlAudit),
      oosAuditHash: computeHash(report.oosAudit),
      stressAuditHash: computeHash(report.stressAudit),
      driftAuditHash: computeHash(report.driftAudit),
    };

    return {
      cohortId: report.cohortSnapshot?.cohortId || "COHORT_NOT_CREATED",
      strategyFingerprint: report.cohortSnapshot?.strategyFingerprint || "N/A",
      sourceHashes,
      sessionCount: report.cohortSnapshot?.sessionCount || 0,
      tradeCount: report.cohortSnapshot?.tradeCount || 0,
      statisticalSnapshotHash,
      safetyAuditHash,
      generatedAt: report.generatedAt,
      frozen: report.cohortSnapshot?.frozen || false,
    };
  }

  public static exportJSON(report: Phase39RevalidationReport): {
    frozenCohortJson: string;
    revalidationReportJson: string;
    evidenceManifestJson: string;
    statisticalSnapshotJson: string;
    safetyAuditJson: string;
    reproducibilityManifestJson: string;
  } {
    const manifest = this.exportManifest(report);

    return {
      frozenCohortJson: JSON.stringify(report.cohortSnapshot, null, 2),
      revalidationReportJson: JSON.stringify(report, null, 2),
      evidenceManifestJson: JSON.stringify(manifest, null, 2),
      statisticalSnapshotJson: JSON.stringify(report.statisticalAudit, null, 2),
      safetyAuditJson: JSON.stringify(report.safetyAudit, null, 2),
      reproducibilityManifestJson: JSON.stringify(
        {
          reportId: report.reportId,
          generatedAt: report.generatedAt,
          immutableHash: report.immutableHash,
          manifest,
        },
        null,
        2
      ),
    };
  }
}
