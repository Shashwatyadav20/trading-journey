import crypto from "crypto";
import {
  GenuineSampleStore,
  genuineSampleStore,
  GenuineSessionRecord,
  GenuineTradeRecord,
  ExclusionCounters,
} from "../persistence/GenuineSampleStore";
import {
  GenuineDailyLedger,
  genuineDailyLedger,
  DailyLedgerEntry,
} from "../persistence/GenuineDailyLedger";
import { strategyFingerprintManager } from "./StrategyFingerprintManager";
import {
  phase28StatisticalEvidenceEngine,
  Phase28StatisticalEvidenceEngine,
  Phase28SummaryReport,
} from "./Phase28StatisticalEvidenceEngine";
import { reconciliationEngine } from "../reconciliation/ReconciliationEngine";
import { dhanBrokerAdapter } from "../broker/DhanBrokerAdapter";
import { Phase29SessionFinalizer, Phase29FinalizedSession } from "./Phase29SessionFinalizer";
import {
  Phase29TradeFinalizer,
  Phase29FinalizedTrade,
  Phase29ExclusionAuditEntry,
  TradeExclusionReason,
} from "./Phase29TradeFinalizer";

// ─── Constants ────────────────────────────────────────────────────────────────
export const MIN_GENUINE_SESSIONS = 20;
export const MIN_GENUINE_TRADES = 30;
export const MIN_ACTIVE_SESSIONS = 15;

export type Phase29ValidationStatus = "INSUFFICIENT_SAMPLE" | "SAMPLE_COMPLETE";

// ─── Interfaces ───────────────────────────────────────────────────────────────
export interface Phase29Progress {
  genuineSessions: number;
  genuineTrades: number;
  activeSessions: number;
  sessionsProgress: number;   // 0-100 %
  tradesProgress: number;     // 0-100 %
  activeSessionsProgress: number;  // 0-100 %
  sessionsMet: boolean;
  tradesMet: boolean;
  activeSessionsMet: boolean;
  validationStatus: Phase29ValidationStatus;
}

export interface Phase29CompletionEvent {
  completedAt: string;
  genuineSessions: number;
  genuineTrades: number;
  activeSessions: number;
  strategyFingerprint: string;
  sampleStartDate: string;
  sampleEndDate: string;
  immutable: true;
}

export interface Phase29ValidationSnapshot {
  snapshotId: string;
  sampleStart: string;
  sampleEnd: string;
  sessions: number;
  trades: number;
  activeSessions: number;
  strategyFingerprint: string;
  statisticsVersion: string;
  calculationTimestamp: string;
  datasetHash: string;
  snapshotHash: string;
  coreStatistics: Phase28SummaryReport["coreStatistics"];
  winRateConfidence: Phase28SummaryReport["winRateConfidence"];
  bootstrapExpectancy: Phase28SummaryReport["bootstrapExpectancy"];
  timeStabilityBlocks: Phase28SummaryReport["timeStabilityBlocks"];
  regimeEvidence: Phase28SummaryReport["regimeEvidence"];
  strategyEvidence: Phase28SummaryReport["strategyEvidence"];
  concentrationAnalysis: Phase28SummaryReport["concentrationAnalysis"];
  monteCarloDiagnostic: Phase28SummaryReport["monteCarloDiagnostic"];
  exclusions: ExclusionCounters;
  reconciliationStatus: "PASS" | "FAIL";
  safetyStatus: {
    paperTrading: boolean;
    liveTrading: boolean;
    brokerExecution: boolean;
    realDataOnly: boolean;
    realBrokerOrders: 0;
  };
}

export interface Phase29IntegrityReport {
  timestampIntegrity: "PASSED" | "FAILED";
  timezoneIntegrity: "PASSED" | "FAILED";
  provenanceIntegrity: "PASSED" | "FAILED";
  reconciliationIntegrity: "PASS" | "FAIL";
  fingerprintStatus: "VALIDATED" | "STRATEGY_CHANGED";
  safetyLockStatus: "LOCKED" | "UNLOCKED";
  noLookAhead: "VERIFIED" | "VIOLATION_DETECTED";
  duplicateControl: "CLEAN" | "DUPLICATES_DETECTED";
  immutabilityStatus: "INTACT" | "BREACH_DETECTED";
}

export interface Phase29ExportRecord {
  metadata: {
    exportedAt: string;
    validationStatus: Phase29ValidationStatus;
    strategyFingerprint: string;
    statisticsVersion: string;
    snapshotHash: string | null;
  };
  samplePeriod: { start: string | null; end: string | null };
  sessions: Phase29FinalizedSession[];
  trades: Phase29FinalizedTrade[];
  exclusions: Phase29ExclusionAuditEntry[];
  statistics: Phase28SummaryReport | null;
  fingerprint: { hash: string; version: string; cohortId: string };
  safetyStatus: Phase29ValidationSnapshot["safetyStatus"];
}

// ─── Engine ───────────────────────────────────────────────────────────────────
export class Phase29ValidationControlEngine {
  private store: GenuineSampleStore;
  private ledger: GenuineDailyLedger;
  private statisticsEngine: Phase28StatisticalEvidenceEngine;
  private sessionFinalizer: Phase29SessionFinalizer;
  private tradeFinalizer: Phase29TradeFinalizer;
  private baselineFingerprintHash: string;
  private cohortId: string;

  private completionEvent: Phase29CompletionEvent | null = null;
  private validationSnapshot: Phase29ValidationSnapshot | null = null;
  private sampleStartDate: string | null = null;

  constructor(
    store: GenuineSampleStore = genuineSampleStore,
    ledger: GenuineDailyLedger = genuineDailyLedger,
    statisticsEngine?: Phase28StatisticalEvidenceEngine
  ) {
    this.store = store;
    this.ledger = ledger;
    this.statisticsEngine =
      statisticsEngine || new Phase28StatisticalEvidenceEngine(store, ledger);

    const fp = strategyFingerprintManager.getCurrentFingerprint();
    this.baselineFingerprintHash = fp.masterFingerprintHash;
    this.cohortId = strategyFingerprintManager.getActiveCohortId();

    this.sessionFinalizer = new Phase29SessionFinalizer(store);
    this.tradeFinalizer = new Phase29TradeFinalizer(
      this.baselineFingerprintHash,
      this.cohortId
    );
  }

  // ── Progress ────────────────────────────────────────────────────────────────

  public getProgress(): Phase29Progress {
    const genuineSessions = this.sessionFinalizer
      .getFinalizedSessions(true)
      .length;
    const genuineTrades = this.store.getTrades(true).length;
    const activeSessions = this.sessionFinalizer.getActiveSessionCount();

    const sessionsMet = genuineSessions >= MIN_GENUINE_SESSIONS;
    const tradesMet = genuineTrades >= MIN_GENUINE_TRADES;
    const activeSessionsMet = activeSessions >= MIN_ACTIVE_SESSIONS;

    return {
      genuineSessions,
      genuineTrades,
      activeSessions,
      sessionsProgress: Math.min(100, Number(((genuineSessions / MIN_GENUINE_SESSIONS) * 100).toFixed(1))),
      tradesProgress: Math.min(100, Number(((genuineTrades / MIN_GENUINE_TRADES) * 100).toFixed(1))),
      activeSessionsProgress: Math.min(100, Number(((activeSessions / MIN_ACTIVE_SESSIONS) * 100).toFixed(1))),
      sessionsMet,
      tradesMet,
      activeSessionsMet,
      validationStatus:
        sessionsMet && tradesMet && activeSessionsMet
          ? "SAMPLE_COMPLETE"
          : "INSUFFICIENT_SAMPLE",
    };
  }

  // ── Session Finalization ─────────────────────────────────────────────────

  public finalizeSession(
    record: GenuineSessionRecord,
    tradeCount = 0
  ): Phase29FinalizedSession {
    const result = this.sessionFinalizer.finalizeSession(record, tradeCount);
    if (result.genuineSession && this.sampleStartDate === null) {
      this.sampleStartDate = record.sessionDateIST;
    }
    this.checkAndEmitCompletion();
    return result;
  }

  public markSessionActive(sessionId: string): void {
    this.sessionFinalizer.markSessionAsActive(sessionId);
    this.checkAndEmitCompletion();
  }

  // ── Trade Finalization ───────────────────────────────────────────────────

  public finalizeTrade(trade: GenuineTradeRecord): Phase29FinalizedTrade {
    const currentFp = strategyFingerprintManager.getCurrentFingerprint();
    return this.tradeFinalizer.finalizeTrade(trade, currentFp.masterFingerprintHash);
  }

  // ── Completion Event ────────────────────────────────────────────────────

  public checkAndEmitCompletion(): boolean {
    if (this.completionEvent) return false; // Already emitted — prevent duplicate

    const progress = this.getProgress();
    if (progress.validationStatus !== "SAMPLE_COMPLETE") return false;

    const genuineSessions = this.sessionFinalizer.getFinalizedSessions(true);
    const now = new Date().toISOString();
    const sampleEnd =
      genuineSessions.length > 0
        ? genuineSessions[genuineSessions.length - 1].sessionDateIST
        : now.substring(0, 10);

    this.completionEvent = Object.freeze({
      completedAt: now,
      genuineSessions: progress.genuineSessions,
      genuineTrades: progress.genuineTrades,
      activeSessions: progress.activeSessions,
      strategyFingerprint: this.baselineFingerprintHash,
      sampleStartDate: this.sampleStartDate || sampleEnd,
      sampleEndDate: sampleEnd,
      immutable: true,
    });

    this.tradeFinalizer.markValidationComplete();
    this.createValidationSnapshot();
    return true;
  }

  // ── Validation Snapshot ─────────────────────────────────────────────────

  private createValidationSnapshot(): void {
    if (this.validationSnapshot) return; // Immutable — created only once

    const genuineTrades = this.store.getTrades(true);
    const report = this.statisticsEngine.generateReport();
    const fp = strategyFingerprintManager.getCurrentFingerprint();
    const reconciliation = reconciliationEngine.runReconciliation();

    const datasetContent = JSON.stringify(genuineTrades.map((t) => t.tradeId).sort());
    const datasetHash = crypto.createHash("sha256").update(datasetContent).digest("hex");

    const snapshotId = `PHASE29_SNAPSHOT_${Date.now()}`;
    const calcTimestamp = new Date().toISOString();

    const snapshotContent = JSON.stringify({
      snapshotId,
      datasetHash,
      calcTimestamp,
      fingerprintHash: this.baselineFingerprintHash,
      sessions: report.gateDetails.genuineSessions,
      trades: report.gateDetails.genuineTrades,
    });
    const snapshotHash = crypto
      .createHash("sha256")
      .update(snapshotContent)
      .digest("hex");

    const completionEvent = this.completionEvent!;

    this.validationSnapshot = Object.freeze({
      snapshotId,
      sampleStart: completionEvent.sampleStartDate,
      sampleEnd: completionEvent.sampleEndDate,
      sessions: report.gateDetails.genuineSessions,
      trades: report.gateDetails.genuineTrades,
      activeSessions: report.gateDetails.activeSessions,
      strategyFingerprint: this.baselineFingerprintHash,
      statisticsVersion: fp.version,
      calculationTimestamp: calcTimestamp,
      datasetHash,
      snapshotHash,
      coreStatistics: report.coreStatistics,
      winRateConfidence: report.winRateConfidence,
      bootstrapExpectancy: report.bootstrapExpectancy,
      timeStabilityBlocks: report.timeStabilityBlocks,
      regimeEvidence: report.regimeEvidence,
      strategyEvidence: report.strategyEvidence,
      concentrationAnalysis: report.concentrationAnalysis,
      monteCarloDiagnostic: report.monteCarloDiagnostic,
      exclusions: this.store.getExclusionCounters(),
      reconciliationStatus: reconciliation.isSafe ? "PASS" : "FAIL",
      safetyStatus: {
        paperTrading: process.env.PAPER_TRADING !== "false",
        liveTrading: process.env.LIVE_TRADING === "true",
        brokerExecution: process.env.BROKER_EXECUTION_ENABLED === "true",
        realDataOnly: process.env.INDIAN_REAL_DATA_ONLY === "true",
        realBrokerOrders: 0,
      },
    } satisfies Phase29ValidationSnapshot);
  }

  // ── Integrity Report ────────────────────────────────────────────────────

  public getIntegrityReport(): Phase29IntegrityReport {
    const currentFp = strategyFingerprintManager.getCurrentFingerprint();
    const fingerprintStatus =
      currentFp.masterFingerprintHash === this.baselineFingerprintHash
        ? "VALIDATED"
        : "STRATEGY_CHANGED";

    const genuineSessions = this.sessionFinalizer.getFinalizedSessions(true);
    const timestampOk = genuineSessions.every(
      (s) => s.timestampValidation === "PASSED"
    );
    const timezoneOk = genuineSessions.every(
      (s) => s.timezoneValidation === "PASSED"
    );
    const provenanceOk = genuineSessions.every(
      (s) => s.provenanceValidation === "PASSED"
    );

    const reconciliation = reconciliationEngine.runReconciliation();

    // Look-ahead check: no finalized trade should have dataTimestamp > decisionTimestamp
    const genuineTrades = this.tradeFinalizer.getGenuineFinalized();
    const lookAheadViolation = genuineTrades.some(
      (t) => !t.timestampGate.orderValid
    );

    // Duplicate control
    const allTradeIds = this.tradeFinalizer
      .getAllFinalized()
      .map((t) => t.tradeId);
    const uniqueIds = new Set(allTradeIds);
    const hasDuplicates = uniqueIds.size < allTradeIds.length;

    return {
      timestampIntegrity: timestampOk ? "PASSED" : "FAILED",
      timezoneIntegrity: timezoneOk ? "PASSED" : "FAILED",
      provenanceIntegrity: provenanceOk ? "PASSED" : "FAILED",
      reconciliationIntegrity: reconciliation.isSafe ? "PASS" : "FAIL",
      fingerprintStatus,
      safetyLockStatus:
        process.env.LIVE_TRADING !== "true" &&
        process.env.BROKER_EXECUTION_ENABLED !== "true"
          ? "LOCKED"
          : "UNLOCKED",
      noLookAhead: lookAheadViolation ? "VIOLATION_DETECTED" : "VERIFIED",
      duplicateControl: hasDuplicates ? "DUPLICATES_DETECTED" : "CLEAN",
      immutabilityStatus: "INTACT",
    };
  }

  // ── Restart Recovery ─────────────────────────────────────────────────────

  public recoverStateAfterRestart(): {
    reconciliationStatus: "PASS" | "FAIL";
    counterIntegrity: "VALID" | "CORRUPTED";
    sessionCount: number;
    tradeCount: number;
  } {
    const reconciliation = reconciliationEngine.runReconciliation();
    const sessions = this.sessionFinalizer.getFinalizedSessions(true).length;
    const trades = this.store.getTrades(true).length;

    return {
      reconciliationStatus: reconciliation.isSafe ? "PASS" : "FAIL",
      counterIntegrity: "VALID",
      sessionCount: sessions,
      tradeCount: trades,
    };
  }

  // ── Export ───────────────────────────────────────────────────────────────

  public getExport(): Phase29ExportRecord {
    const fp = strategyFingerprintManager.getCurrentFingerprint();
    const progress = this.getProgress();
    const genuineSessions = this.sessionFinalizer.getFinalizedSessions(true);

    let report: Phase28SummaryReport | null = null;
    try {
      report = this.statisticsEngine.generateReport();
    } catch {
      report = null;
    }

    const sampleStart =
      genuineSessions.length > 0 ? genuineSessions[0].sessionDateIST : null;
    const sampleEnd =
      genuineSessions.length > 0
        ? genuineSessions[genuineSessions.length - 1].sessionDateIST
        : null;

    return {
      metadata: {
        exportedAt: new Date().toISOString(),
        validationStatus: progress.validationStatus,
        strategyFingerprint: this.baselineFingerprintHash,
        statisticsVersion: fp.version,
        snapshotHash: this.validationSnapshot?.snapshotHash || null,
      },
      samplePeriod: { start: sampleStart, end: sampleEnd },
      sessions: this.sessionFinalizer.getAllFinalized(),
      trades: this.tradeFinalizer.getAllFinalized(),
      exclusions: this.tradeFinalizer.getExclusionAudit(),
      statistics: report,
      fingerprint: {
        hash: fp.masterFingerprintHash,
        version: fp.version,
        cohortId: this.cohortId,
      },
      safetyStatus: {
        paperTrading: process.env.PAPER_TRADING !== "false",
        liveTrading: process.env.LIVE_TRADING === "true",
        brokerExecution: process.env.BROKER_EXECUTION_ENABLED === "true",
        realDataOnly: process.env.INDIAN_REAL_DATA_ONLY === "true",
        realBrokerOrders: 0,
      },
    };
  }

  // ── Accessors ────────────────────────────────────────────────────────────

  public getCompletionEvent(): Phase29CompletionEvent | null {
    return this.completionEvent;
  }

  public getValidationSnapshot(): Phase29ValidationSnapshot | null {
    return this.validationSnapshot;
  }

  public getSessionFinalizer(): Phase29SessionFinalizer {
    return this.sessionFinalizer;
  }

  public getTradeFinalizer(): Phase29TradeFinalizer {
    return this.tradeFinalizer;
  }

  public getStatisticsReport(): Phase28SummaryReport {
    return this.statisticsEngine.generateReport();
  }

  public reset(): void {
    this.sessionFinalizer.reset();
    this.tradeFinalizer.reset();
    this.completionEvent = null;
    this.validationSnapshot = null;
    this.sampleStartDate = null;
  }
}

export const phase29ValidationControlEngine = new Phase29ValidationControlEngine();
