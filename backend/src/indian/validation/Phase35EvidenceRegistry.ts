import crypto from "crypto";

export type EvidenceClassification = "OBSERVED" | "CALCULATED" | "SCENARIO" | "ASSUMPTION" | "NOT_AVAILABLE";

export interface Phase35EvidenceArtifact {
  artifactId: string;
  phase: number;
  artifactType: string;
  sourceId: string;
  sourceHash: string;
  strategyFingerprint: string;
  classification: EvidenceClassification;
  createdAt: string;
  status: "FROZEN" | "INVALID" | "MISSING";
  contentSummary?: Record<string, any>;
}

export class Phase35EvidenceRegistry {
  private artifacts: Map<string, Phase35EvidenceArtifact> = new Map();
  private isFrozen: boolean = false;

  /**
   * Registers an artifact in the central evidence registry.
   * Generates a SHA-256 hash of the artifact content for cryptographic verification.
   */
  public registerArtifact(
    phase: number,
    artifactType: string,
    sourceId: string,
    strategyFingerprint: string,
    classification: EvidenceClassification,
    contentSummary: Record<string, any> = {}
  ): Phase35EvidenceArtifact {
    if (this.isFrozen) {
      throw new Error("REGISTRY_FROZEN: Cannot register new artifacts in a frozen Phase 35 Evidence Registry.");
    }

    const artifactId = `ART_P${phase}_${artifactType}_${sourceId.substring(0, 12)}`;
    const now = new Date().toISOString();

    const canonicalContent = JSON.stringify({
      artifactId,
      phase,
      artifactType,
      sourceId,
      strategyFingerprint,
      classification,
      contentSummary,
    });

    const sourceHash = crypto.createHash("sha256").update(canonicalContent).digest("hex");

    const artifact: Phase35EvidenceArtifact = Object.freeze({
      artifactId,
      phase,
      artifactType,
      sourceId,
      sourceHash,
      strategyFingerprint,
      classification,
      createdAt: now,
      status: "FROZEN",
      contentSummary: Object.freeze(JSON.parse(JSON.stringify(contentSummary))),
    });

    this.artifacts.set(artifactId, artifact);
    return artifact;
  }

  public getArtifact(artifactId: string): Phase35EvidenceArtifact | undefined {
    return this.artifacts.get(artifactId);
  }

  public getAllArtifacts(): readonly Phase35EvidenceArtifact[] {
    return Array.from(this.artifacts.values());
  }

  public getArtifactsByPhase(phase: number): readonly Phase35EvidenceArtifact[] {
    return this.getAllArtifacts().filter((a) => a.phase === phase);
  }

  public freezeRegistry(): void {
    this.isFrozen = true;
  }

  public clearAllForTesting(): void {
    this.artifacts.clear();
    this.isFrozen = false;
  }
}

export const phase35EvidenceRegistry = new Phase35EvidenceRegistry();
