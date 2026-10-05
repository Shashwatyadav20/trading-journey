import { GenuineSampleStore, GenuineSessionRecord } from "../persistence/GenuineSampleStore";
import { strategyFingerprintManager } from "./StrategyFingerprintManager";

export type SessionStatus =
  | "PRE_SESSION"
  | "ACTIVE"
  | "BLOCKED"
  | "GENUINE"
  | "INVALID"
  | "FINALIZED";

export interface Phase29FinalizedSession {
  sessionId: string;
  sessionDateIST: string;
  status: SessionStatus;
  genuineSession: boolean;
  activeSession: boolean;           // true if at least one genuine trade opened
  finalizedAt: string;
  strategyFingerprintHash: string;
  dataGate: "PASSED" | "FAILED" | "BLOCKED";
  timestampValidation: "PASSED" | "TIMESTAMP_VALIDATION_FAILED";
  timezoneValidation: "PASSED" | "TIMEZONE_FAILED";
  provenanceValidation: "PASSED" | "PROVENANCE_FAILED";
  websocketValidation: "PASSED" | "WEBSOCKET_STALE";
  optionChainValidation: "PASSED" | "OPTION_CHAIN_INVALID";
  lotSizeValidation: "PASSED" | "LOT_SIZE_UNVERIFIED";
  reconciliationValidation: "PASSED" | "RECONCILIATION_FAILED";
  blockedReason: string | null;
  cohortId: string;
  /** Immutability protection — original GenuineSessionRecord snapshot */
  originalRecord: Readonly<GenuineSessionRecord>;
}

export interface Phase29SessionCorrectionEvent {
  correctionId: string;
  originalRecordId: string;
  reason: string;
  oldValue: unknown;
  newValue: unknown;
  timestamp: string;
  source: string;
}

export class Phase29SessionFinalizer {
  private finalizedSessions: Map<string, Phase29FinalizedSession> = new Map();
  private correctionEvents: Phase29SessionCorrectionEvent[] = [];
  private activeSessionIds: Set<string> = new Set();

  constructor(private store: GenuineSampleStore) {}

  /**
   * Validates and finalizes a market session.
   * Runs 9-step gate; only GENUINE+FINALIZED counts toward the 20-session requirement.
   */
  public finalizeSession(
    record: GenuineSessionRecord,
    tradeCount: number = 0
  ): Phase29FinalizedSession {
    // Prevent duplicate finalization
    if (this.finalizedSessions.has(record.sessionId)) {
      return this.finalizedSessions.get(record.sessionId)!;
    }

    const now = new Date().toISOString();
    const fp = strategyFingerprintManager.getCurrentFingerprint();
    const cohortId = strategyFingerprintManager.getActiveCohortId();

    // Step 1: Timestamp validation
    const istInfo = this.store.getIstTimestamp(record.createdAt || now);
    const timestampValidation =
      record.marketSession === "MARKET_OPEN" && !istInfo.isWithinMarketHours
        ? "TIMESTAMP_VALIDATION_FAILED"
        : "PASSED";

    // Step 2: Timezone validation
    const timezoneValidation =
      record.timezone === "Asia/Kolkata" ? "PASSED" : "TIMEZONE_FAILED";

    // Step 3: Data gate / genuine-data gate
    const dataGateOk = record.dataGate === "PASSED";

    // Step 4: Provider provenance
    const provenanceValidation =
      record.provider === "DHAN" &&
      record.spotSource === "DHAN" &&
      record.optionChainSource === "DHAN"
        ? "PASSED"
        : "PROVENANCE_FAILED";

    // Step 5: WebSocket freshness
    const websocketValidation =
      record.websocketStatus === "HEALTHY" ? "PASSED" : "WEBSOCKET_STALE";

    // Step 6: Option-chain provenance
    const optionChainValidation =
      record.optionChainSource === "DHAN" && record.optionPriceSource === "DHAN"
        ? "PASSED"
        : "OPTION_CHAIN_INVALID";

    // Step 7: Lot-size verification
    const lotSizeValidation =
      record.lotSizeSource === "DHAN_MASTER" ? "PASSED" : "LOT_SIZE_UNVERIFIED";

    // Step 8: Reconciliation
    const reconciliationValidation =
      record.reconciliationStatus === "PASS" ? "PASSED" : "RECONCILIATION_FAILED";

    const allGatesPass =
      timestampValidation === "PASSED" &&
      timezoneValidation === "PASSED" &&
      dataGateOk &&
      provenanceValidation === "PASSED" &&
      websocketValidation === "PASSED" &&
      optionChainValidation === "PASSED" &&
      lotSizeValidation === "PASSED" &&
      reconciliationValidation === "PASSED" &&
      record.genuineSession === true &&
      !(record as any).isSyntheticOptionData;

    // Determine block reason
    let blockedReason: string | null = null;
    if (!allGatesPass) {
      const reasons: string[] = [];
      if (timestampValidation !== "PASSED") reasons.push("TIMESTAMP_VALIDATION_FAILED");
      if (timezoneValidation !== "PASSED") reasons.push("TIMEZONE_FAILED");
      if (!dataGateOk) reasons.push("DATA_GATE_FAILED");
      if (provenanceValidation !== "PASSED") reasons.push("PROVENANCE_FAILED");
      if (websocketValidation !== "PASSED") reasons.push("WEBSOCKET_STALE");
      if (optionChainValidation !== "PASSED") reasons.push("OPTION_CHAIN_INVALID");
      if (lotSizeValidation !== "PASSED") reasons.push("LOT_SIZE_UNVERIFIED");
      if (reconciliationValidation !== "PASSED") reasons.push("RECONCILIATION_FAILED");
      if (!record.genuineSession) reasons.push("NOT_GENUINE_SESSION");
      if ((record as any).isSyntheticOptionData) reasons.push("SYNTHETIC_DATA");
      blockedReason = reasons.join(" | ");
    }

    // Step 9: Count active session
    const activeSession = allGatesPass && tradeCount > 0;
    if (activeSession) {
      this.activeSessionIds.add(record.sessionId);
    }

    const status: SessionStatus = allGatesPass ? "FINALIZED" : "BLOCKED";

    const finalized: Phase29FinalizedSession = {
      sessionId: record.sessionId,
      sessionDateIST: record.sessionDateIST,
      status,
      genuineSession: allGatesPass,
      activeSession,
      finalizedAt: now,
      strategyFingerprintHash: fp.masterFingerprintHash,
      dataGate: record.dataGate,
      timestampValidation,
      timezoneValidation,
      provenanceValidation,
      websocketValidation,
      optionChainValidation,
      lotSizeValidation,
      reconciliationValidation,
      blockedReason,
      cohortId,
      originalRecord: Object.freeze({ ...record }),
    };

    this.finalizedSessions.set(record.sessionId, finalized);
    return finalized;
  }

  /** Updates active-session flag after trades are recorded. Immutably creates a correction event if needed. */
  public markSessionAsActive(sessionId: string): void {
    const session = this.finalizedSessions.get(sessionId);
    if (!session || session.activeSession) return;
    this.correctionEvents.push({
      correctionId: `corr_active_${Date.now()}`,
      originalRecordId: sessionId,
      reason: "ACTIVE_SESSION_FLAG_SET: Genuine trade opened in this session",
      oldValue: false,
      newValue: true,
      timestamp: new Date().toISOString(),
      source: "Phase29SessionFinalizer",
    });
    (session as any).activeSession = true;
    this.activeSessionIds.add(sessionId);
  }

  public getFinalizedSessions(onlyGenuine = false): Phase29FinalizedSession[] {
    const all = Array.from(this.finalizedSessions.values());
    return onlyGenuine ? all.filter((s) => s.genuineSession && s.status === "FINALIZED") : all;
  }

  public getAllFinalized(): Phase29FinalizedSession[] {
    return Array.from(this.finalizedSessions.values());
  }

  public getActiveSessionCount(): number {
    return this.activeSessionIds.size;
  }

  public getCorrectionEvents(): Phase29SessionCorrectionEvent[] {
    return [...this.correctionEvents];
  }

  public reset(): void {
    this.finalizedSessions.clear();
    this.correctionEvents = [];
    this.activeSessionIds.clear();
  }
}
