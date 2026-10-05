import crypto from "crypto";
import { Phase36EvidenceInput } from "./Phase36Types";

export interface EvidenceValidationResult {
  valid: boolean;
  reason?: "HASH_MISMATCH" | "FINGERPRINT_MISMATCH" | "MISSING_ARTIFACT" | "EVIDENCE_CORRUPTED";
  details: string[];
}

export class Phase36EvidenceValidator {
  /**
   * Cryptographically validates Phase 35 evidence artifacts and fingerprint chain consistency.
   */
  public validateEvidence(input: Phase36EvidenceInput): EvidenceValidationResult {
    const details: string[] = [];

    // 1. Verify Report Presence and Master Fingerprint
    if (!input.finalResearchReport || !input.finalResearchReport.masterStrategyFingerprint) {
      return {
        valid: false,
        reason: "MISSING_ARTIFACT",
        details: ["Phase 35 final research report or master strategy fingerprint is missing."],
      };
    }

    const masterFingerprint = input.finalResearchReport.masterStrategyFingerprint;

    // 2. Verify Artifact Registry
    if (!input.evidenceRegistry || input.evidenceRegistry.length === 0) {
      return {
        valid: false,
        reason: "MISSING_ARTIFACT",
        details: ["Evidence registry contains no artifacts."],
      };
    }

    for (const artifact of input.evidenceRegistry) {
      if (artifact.status !== "FROZEN") {
        details.push(`Artifact ${artifact.artifactId} status is ${artifact.status}, expected FROZEN.`);
      }

      if (artifact.strategyFingerprint !== masterFingerprint) {
        return {
          valid: false,
          reason: "FINGERPRINT_MISMATCH",
          details: [`Artifact ${artifact.artifactId} fingerprint (${artifact.strategyFingerprint}) does not match master (${masterFingerprint}).`],
        };
      }

      // Re-verify SHA-256 canonical hash
      const canonicalContent = JSON.stringify({
        artifactId: artifact.artifactId,
        phase: artifact.phase,
        artifactType: artifact.artifactType,
        sourceId: artifact.sourceId,
        strategyFingerprint: artifact.strategyFingerprint,
        classification: artifact.classification,
        contentSummary: artifact.contentSummary,
      });

      const calculatedHash = crypto.createHash("sha256").update(canonicalContent).digest("hex");
      if (calculatedHash !== artifact.sourceHash) {
        return {
          valid: false,
          reason: "HASH_MISMATCH",
          details: [`Artifact ${artifact.artifactId} source hash (${artifact.sourceHash}) does not match recomputed hash (${calculatedHash}).`],
        };
      }
    }

    // 3. Check Evidence Manifest Hash & Fingerprint
    const manifest = input.evidenceManifest;
    if (!manifest || manifest.strategyFingerprint !== masterFingerprint) {
      return {
        valid: false,
        reason: "FINGERPRINT_MISMATCH",
        details: ["Evidence manifest strategy fingerprint mismatch."],
      };
    }

    if (details.length > 0) {
      return {
        valid: false,
        reason: "EVIDENCE_CORRUPTED",
        details,
      };
    }

    return {
      valid: true,
      details: ["All Phase 35 evidence artifacts, SHA-256 hashes, and strategy fingerprint chain successfully verified."],
    };
  }
}

export const phase36EvidenceValidator = new Phase36EvidenceValidator();
