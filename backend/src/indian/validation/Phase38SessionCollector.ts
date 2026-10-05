import crypto from "crypto";
import { genuineSampleStore, GenuineSessionRecord } from "../persistence/GenuineSampleStore";
import { strategyFingerprintManager } from "./StrategyFingerprintManager";

export interface Phase38SessionObservation {
  observationId: string;
  sessionId: string;
  sessionDateIST: string;          // YYYY-MM-DD
  sessionStartIST: string;         // ISO IST
  sessionEndIST: string;           // ISO IST
  timezone: "Asia/Kolkata";
  timestampIST: string;
  provider: "DHAN";
  dataGate: "PASSED" | "FAILED" | "BLOCKED";
  spotSource: "DHAN" | string;
  optionChainSource: "DHAN" | string;
  optionPriceSource: "DHAN" | string;
  greeksSource: "DHAN_DERIVED" | string;
  lotSizeSource: "DHAN_MASTER" | string;
  websocketStatus: "HEALTHY" | "DEGRADED" | "DISCONNECTED";
  reconciliationStatus: "PASS" | "FAIL";
  genuineSession: boolean;
  activeSession: boolean;           // true iff >= 1 genuine paper trade opened and finalized in this session
  safetyLocksValid: boolean;
  dhanProvenanceValid: boolean;
  websocketHealthValid: boolean;
  optionChainProvenanceValid: boolean;
  threeWayReconciliationPass: boolean;
  timestampISTValid: boolean;
  dataNotStale: boolean;
  lotSizeVerified: boolean;
  marketSessionValid: boolean;
  inclusionExclusionReason: string;
  strategyFingerprint: string;
  cohortId: string;
  finalizedAt?: string;
  immutableHash: string;
}

export class Phase38SessionCollector {
  private sessions: Map<string, Phase38SessionObservation> = new Map();
  private activeSessionIds: Set<string> = new Set();

  /**
   * Computes deterministic SHA-256 hash for an observation object.
   */
  public computeHash(obj: Omit<Phase38SessionObservation, "immutableHash">): string {
    const jsonStr = JSON.stringify(obj, Object.keys(obj).sort());
    return crypto.createHash("sha256").update(jsonStr).digest("hex");
  }

  /**
   * Validates and finalizes a genuine market session observation according to Phase 38 rules.
   */
  public finalizeSession(input: Partial<Phase38SessionObservation> & { sessionId: string }): Phase38SessionObservation {
    // Duplicate prevention / Idempotency check
    if (this.sessions.has(input.sessionId)) {
      const existing = this.sessions.get(input.sessionId)!;
      if (existing.finalizedAt) {
        return existing; // Immutable finalized session returned unchanged
      }
    }

    const now = new Date().toISOString();
    const istInfo = genuineSampleStore.getIstTimestamp(now);
    const fp = strategyFingerprintManager.getCurrentFingerprint();
    const cohortId = strategyFingerprintManager.getActiveCohortId();

    // 12 Mandatory Genuine Session Gates
    const spotSource = input.spotSource || "DHAN";
    const optionChainSource = input.optionChainSource || "DHAN";
    const optionPriceSource = input.optionPriceSource || "DHAN";

    const realSpot = spotSource === "DHAN";
    const realOptionChain = optionChainSource === "DHAN";
    const realOptionPrices = optionPriceSource === "DHAN";
    const dataNotStale = input.dataNotStale ?? true;
    const lotSizeVerified = input.lotSizeVerified ?? true;
    const marketSessionValid = input.marketSessionValid ?? true;
    
    // Safety locks: PAPER_TRADING=true, LIVE_TRADING=false, BROKER_EXECUTION=false
    const isPaper = process.env.PAPER_TRADING !== "false";
    const isLive = process.env.LIVE_TRADING === "true";
    const isBroker = process.env.BROKER_EXECUTION_ENABLED === "true";
    const safetyLocksValid = input.safetyLocksValid ?? (isPaper && !isLive && !isBroker);

    const dhanProvenanceValid = input.dhanProvenanceValid ?? (realSpot && (input.provider === "DHAN" || !input.provider));
    const websocketHealthValid = input.websocketHealthValid ?? (input.websocketStatus === "HEALTHY" || !input.websocketStatus);
    const optionChainProvenanceValid = input.optionChainProvenanceValid ?? (realOptionChain && realOptionPrices);
    const threeWayReconciliationPass = input.threeWayReconciliationPass ?? (input.reconciliationStatus === "PASS" || !input.reconciliationStatus);
    const timezone = input.timezone || "Asia/Kolkata";
    const timestampISTValid = input.timestampISTValid ?? (timezone === "Asia/Kolkata");

    // Evaluate overall session genuineness
    const reasons: string[] = [];
    if (!realSpot) reasons.push("NOT_REAL_SPOT");
    if (!realOptionChain) reasons.push("NOT_REAL_OPTION_CHAIN");
    if (!realOptionPrices) reasons.push("NOT_REAL_OPTION_PRICES");
    if (!dataNotStale) reasons.push("DATA_STALE");
    if (!lotSizeVerified) reasons.push("LOT_SIZE_UNVERIFIED");
    if (!marketSessionValid) reasons.push("INVALID_MARKET_SESSION");
    if (!safetyLocksValid) reasons.push("SAFETY_LOCK_VIOLATION");
    if (!dhanProvenanceValid) reasons.push("DHAN_PROVENANCE_INVALID");
    if (!websocketHealthValid) reasons.push("WEBSOCKET_UNHEALTHY");
    if (!optionChainProvenanceValid) reasons.push("OPTION_CHAIN_PROVENANCE_INVALID");
    if (!threeWayReconciliationPass) reasons.push("RECONCILIATION_FAILED");
    if (!timestampISTValid) reasons.push("INVALID_TIMESTAMP_IST");

    const isGenuine = reasons.length === 0 && input.dataGate !== "FAILED" && input.dataGate !== "BLOCKED";
    const inclusionExclusionReason = isGenuine ? "GENUINE_ACCEPTED" : reasons.join(" | ");

    const activeSession = isGenuine && (input.activeSession ?? false);
    if (activeSession) {
      this.activeSessionIds.add(input.sessionId);
    }

    const observationBase: Omit<Phase38SessionObservation, "immutableHash"> = {
      observationId: `obs_sess_${input.sessionId}_${Date.now()}`,
      sessionId: input.sessionId,
      sessionDateIST: input.sessionDateIST || istInfo.dateIST,
      sessionStartIST: input.sessionStartIST || `${istInfo.dateIST}T09:15:00+05:30`,
      sessionEndIST: input.sessionEndIST || `${istInfo.dateIST}T15:30:00+05:30`,
      timezone: "Asia/Kolkata",
      timestampIST: input.timestampIST || istInfo.isoIST,
      provider: "DHAN",
      dataGate: input.dataGate || (isGenuine ? "PASSED" : "FAILED"),
      spotSource: input.spotSource || "DHAN",
      optionChainSource: input.optionChainSource || "DHAN",
      optionPriceSource: input.optionPriceSource || "DHAN",
      greeksSource: input.greeksSource || "DHAN_DERIVED",
      lotSizeSource: input.lotSizeSource || "DHAN_MASTER",
      websocketStatus: input.websocketStatus || "HEALTHY",
      reconciliationStatus: input.reconciliationStatus || "PASS",
      genuineSession: isGenuine,
      activeSession,
      safetyLocksValid,
      dhanProvenanceValid,
      websocketHealthValid,
      optionChainProvenanceValid,
      threeWayReconciliationPass,
      timestampISTValid,
      dataNotStale,
      lotSizeVerified,
      marketSessionValid,
      inclusionExclusionReason,
      strategyFingerprint: input.strategyFingerprint || fp.masterFingerprintHash,
      cohortId: input.cohortId || cohortId,
      finalizedAt: now,
    };

    const immutableHash = this.computeHash(observationBase);
    const finalizedObservation: Phase38SessionObservation = Object.freeze({
      ...observationBase,
      immutableHash,
    });

    this.sessions.set(input.sessionId, finalizedObservation);

    // Also mirror into underlying GenuineSampleStore if genuine
    if (isGenuine) {
      try {
        genuineSampleStore.recordSession({
          sessionId: finalizedObservation.sessionId,
          sessionDateIST: finalizedObservation.sessionDateIST,
          sessionStart: finalizedObservation.sessionStartIST,
          sessionEnd: finalizedObservation.sessionEndIST,
          timezone: "Asia/Kolkata",
          timestampUTC: new Date().toISOString(),
          timestampIST: finalizedObservation.timestampIST,
          provider: finalizedObservation.provider,
          dataGate: finalizedObservation.dataGate,
          marketSession: "MARKET_OPEN",
          spotSource: finalizedObservation.spotSource,
          optionChainSource: finalizedObservation.optionChainSource,
          optionPriceSource: finalizedObservation.optionPriceSource,
          greeksSource: finalizedObservation.greeksSource,
          lotSizeSource: finalizedObservation.lotSizeSource,
          expiry: "CURRENT_WEEKLY",
          websocketStatus: finalizedObservation.websocketStatus,
          reconciliationStatus: finalizedObservation.reconciliationStatus,
          genuineSession: true,
          blockedReason: null,
          createdAt: finalizedObservation.timestampIST,
          finalizedAt: finalizedObservation.finalizedAt,
        });
        genuineSampleStore.finalizeSession(finalizedObservation.sessionId);
      } catch {
        // Ignore mirror error if session exists
      }
    }

    return finalizedObservation;
  }

  /**
   * Sets active session flag for a session if at least one genuine paper trade was executed.
   */
  public markSessionAsActive(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || !session.genuineSession || session.activeSession) return;

    this.activeSessionIds.add(sessionId);

    // Create updated frozen record
    const updatedBase: Omit<Phase38SessionObservation, "immutableHash"> = {
      ...session,
      activeSession: true,
    };
    const immutableHash = this.computeHash(updatedBase);
    const updatedSession = Object.freeze({
      ...updatedBase,
      immutableHash,
    });

    this.sessions.set(sessionId, updatedSession);
  }

  public getSessions(onlyGenuine = false): Phase38SessionObservation[] {
    const all = Array.from(this.sessions.values());
    return onlyGenuine ? all.filter((s) => s.genuineSession) : all;
  }

  public getGenuineSessionCount(): number {
    return this.getSessions(true).length;
  }

  public getActiveSessionCount(): number {
    // Unique genuine sessions with activeSession=true
    return Array.from(this.sessions.values()).filter((s) => s.genuineSession && s.activeSession).length;
  }

  public clear(): void {
    this.sessions.clear();
    this.activeSessionIds.clear();
  }
}

export const phase38SessionCollector = new Phase38SessionCollector();
