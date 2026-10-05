import { phase35ResearchReportEngine } from "../validation/Phase35ResearchReportEngine";
import { phase35EvidenceRegistry } from "../validation/Phase35EvidenceRegistry";
import { Phase36EvidenceInput } from "./Phase36Types";

export class Phase36EvidenceLoader {
  /**
   * Reads Phase 35 frozen evidence exclusively.
   * Does NOT allow arbitrary external trade injection directly into Phase 36.
   */
  public loadEvidence(): Phase36EvidenceInput {
    const status = phase35ResearchReportEngine.getStatus();
    if (status.state !== "FROZEN") {
      throw new Error(
        "PHASE35_EVIDENCE_NOT_FROZEN: Cannot load evidence for Phase 36 because Phase 35 report is not complete and frozen."
      );
    }

    const report = phase35ResearchReportEngine.getReport();
    if (!report || report.status === "FINAL_REPORT_BLOCKED" || report.state !== "FROZEN") {
      throw new Error(
        "PHASE35_EVIDENCE_NOT_FROZEN: Cannot load evidence for Phase 36 because Phase 35 report is not complete and frozen."
      );
    }

    const registryArtifacts = phase35EvidenceRegistry.getAllArtifacts();
    if (registryArtifacts.length === 0) {
      throw new Error(
        "PHASE35_EVIDENCE_REGISTRY_EMPTY: Phase 35 Evidence Registry contains no frozen artifacts."
      );
    }

    const evidenceManifest = report.manifest;
    if (!evidenceManifest) {
      throw new Error("PHASE35_EVIDENCE_MANIFEST_MISSING: Phase 35 report contains no evidence manifest.");
    }

    const safetyAudit = report.snapshot?.safetyAudit || report.sections?.safetyAudit;
    if (!safetyAudit) {
      throw new Error("PHASE35_SAFETY_AUDIT_MISSING: Phase 35 snapshot contains no safety audit.");
    }

    const reproducibilityManifest = report.sections?.reproducibilityManifest;

    return Object.freeze({
      finalResearchReport: report,
      evidenceRegistry: Object.freeze([...registryArtifacts]),
      evidenceManifest: Object.freeze({ ...evidenceManifest }),
      safetyAudit: Object.freeze({ ...safetyAudit }),
      reproducibilityManifest: Object.freeze({ ...reproducibilityManifest }),
    });
  }
}

export const phase36EvidenceLoader = new Phase36EvidenceLoader();
