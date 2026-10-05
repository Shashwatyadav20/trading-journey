import crypto from "crypto";
import { GenuineTradeRecord, GenuineSessionRecord } from "../persistence/GenuineSampleStore";
import { Phase31Certificate } from "./Phase31ValidationCertificationEngine";

export type Phase32DatasetType = "IN_SAMPLE" | "OUT_OF_SAMPLE" | "WALK_FORWARD";

export interface Phase32OOSValidationFlags {
  realMarketData: boolean;
  validTimestamp: boolean;
  validTradingSession: boolean;
  noHindsight: boolean;
  noDuplicate: boolean;
  validOptionData: boolean;
  validSpotPrice: boolean;
  validOptionPrice: boolean;
  validLotSize: boolean;
  freshData: boolean;
  correctTimezone: boolean; // Asia/Kolkata
}

export interface Phase32OOSObservation {
  tradeId: string;
  sessionId: string;
  strategy: "BULL_PUT_SPREAD" | "BEAR_CALL_SPREAD" | "IRON_CONDOR";
  regime: "BULLISH" | "BEARISH" | "RANGE" | "NO_TRADE";
  entryTimestamp: string;
  exitTimestamp: string;
  dataTimestamp: string;
  decisionTimestamp: string;
  monitoringTimestamp: string;
  netPnL: number;
  grossPnL: number;
  brokerage: number;
  STT: number;
  exchangeCharges: number;
  GST: number;
  SEBICharges: number;
  stampDuty: number;
  slippage: number;
  lotSize: number;
  genuineStatus: boolean;
  validationFlags: Phase32OOSValidationFlags;
  strategyFingerprint: string;
  createdAt: string;
}

export interface Phase32ValidationCohort {
  cohortId: string;
  sourceDatasetId: string;
  datasetFingerprint: string;
  strategyFingerprint: string;
  createdAt: string;
  freezeTimestamp: string;
  observationCount: number;
  tradeCount: number;
  sessionCount: number;
  windowCount: number;
  status: "FROZEN" | "UNFROZEN" | "INVALID";
}

export class Phase32DatasetManager {
  private inSampleTrades: GenuineTradeRecord[] = [];
  private inSampleSessions: GenuineSessionRecord[] = [];
  private oosObservations: Phase32OOSObservation[] = [];
  private inSampleCohort: any = null;
  private frozenCohort: Phase32ValidationCohort | null = null;
  private isFrozen: boolean = false;

  /**
   * Load frozen Phase 31 cohort as IN_SAMPLE dataset.
   * Phase 31 cohort must never be modified.
   */
  public loadInSampleCohort(cohort: any, trades: GenuineTradeRecord[], sessions: GenuineSessionRecord[]): void {
    // Deep clone and freeze each element to guarantee Phase 31 immutability
    this.inSampleCohort = Object.freeze(JSON.parse(JSON.stringify(cohort)));
    const clonedTrades = JSON.parse(JSON.stringify(trades)).map((t: any) => Object.freeze(t));
    const clonedSessions = JSON.parse(JSON.stringify(sessions)).map((s: any) => Object.freeze(s));
    this.inSampleTrades = Object.freeze(clonedTrades) as any;
    this.inSampleSessions = Object.freeze(clonedSessions) as any;
  }

  public getInSampleTrades(): readonly GenuineTradeRecord[] {
    return this.inSampleTrades;
  }

  public getInSampleSessions(): readonly GenuineSessionRecord[] {
    return this.inSampleSessions;
  }

  public getInSampleCohort(): any {
    return this.inSampleCohort;
  }

  /**
   * Add Out-Of-Sample observation.
   * If dataset is frozen, modifications are rejected.
   */
  public addOOSObservation(obs: Phase32OOSObservation): { success: boolean; reason?: string } {
    if (this.isFrozen) {
      return { success: false, reason: "DATASET_FROZEN: OOS cohort is frozen and immutable." };
    }

    // Check timezone (must be Asia/Kolkata or verified)
    if (!obs.validationFlags.correctTimezone) {
      return { success: false, reason: "INVALID_TIMEZONE: Must use Asia/Kolkata for market session validation." };
    }

    this.oosObservations.push({ ...obs });
    return { success: true };
  }

  public getOOSObservations(): readonly Phase32OOSObservation[] {
    return this.oosObservations;
  }

  public clearOOSObservations(): void {
    if (this.isFrozen) {
      throw new Error("CANNOT_CLEAR_FROZEN_DATASET: OOS cohort is frozen.");
    }
    this.oosObservations = [];
  }

  /**
   * Generates immutable dataset SHA-256 fingerprint hash based on canonical JSON serialization.
   */
  public generateDatasetFingerprint(datasetId: string = "OOS_001"): string {
    const canonical = JSON.stringify({
      datasetId,
      observations: this.oosObservations.map((o) => ({
        tradeId: o.tradeId,
        sessionId: o.sessionId,
        strategy: o.strategy,
        regime: o.regime,
        entryTimestamp: o.entryTimestamp,
        exitTimestamp: o.exitTimestamp,
        dataTimestamp: o.dataTimestamp,
        decisionTimestamp: o.decisionTimestamp,
        monitoringTimestamp: o.monitoringTimestamp,
        netPnL: o.netPnL,
        grossPnL: o.grossPnL,
        strategyFingerprint: o.strategyFingerprint,
      })),
    });

    return crypto.createHash("sha256").update(canonical).digest("hex");
  }

  /**
   * Freeze the OOS Validation Cohort. Once frozen, NO MODIFY, NO DELETE, NO REWRITE.
   */
  public freezeCohort(strategyFingerprint: string, datasetId: string = "OOS_001", windowCount: number = 0): Phase32ValidationCohort {
    if (this.isFrozen && this.frozenCohort) {
      return this.frozenCohort;
    }

    const now = new Date().toISOString();
    const datasetFingerprint = this.generateDatasetFingerprint(datasetId);
    const cohortId = `VAL_COHORT_P32_${datasetFingerprint.substring(0, 8)}`;
    const uniqueSessions = new Set(this.oosObservations.map((o) => o.sessionId)).size;

    const cohort: Phase32ValidationCohort = Object.freeze({
      cohortId,
      sourceDatasetId: datasetId,
      datasetFingerprint,
      strategyFingerprint,
      createdAt: this.oosObservations.length > 0 ? this.oosObservations[0].createdAt || now : now,
      freezeTimestamp: now,
      observationCount: this.oosObservations.length,
      tradeCount: this.oosObservations.length,
      sessionCount: uniqueSessions,
      windowCount,
      status: "FROZEN",
    });

    this.frozenCohort = cohort;
    this.isFrozen = true;
    return cohort;
  }

  public getFrozenCohort(): Phase32ValidationCohort | null {
    return this.frozenCohort;
  }

  public reset(): void {
    this.inSampleTrades = [];
    this.inSampleSessions = [];
    this.oosObservations = [];
    this.inSampleCohort = null;
    this.frozenCohort = null;
    this.isFrozen = false;
  }
}

export const phase32DatasetManager = new Phase32DatasetManager();
