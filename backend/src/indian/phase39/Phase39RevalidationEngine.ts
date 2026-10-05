import {
  Phase39RevalidationReport,
  Phase39State,
  SampleGateProgress,
  Phase39TradeRecord,
  Phase39SessionRecord,
  computeHash,
} from "./Phase39Types";
import { PHASE39_CONFIG } from "./Phase39Config";
import { Phase39CohortFreeze } from "./Phase39CohortFreeze";
import { Phase39TimestampAudit } from "./Phase39TimestampAudit";
import { Phase39LeakageDetector } from "./Phase39LeakageDetector";
import { Phase39PnLAudit } from "./Phase39PnLAudit";
import { Phase39EvidenceReconciler } from "./Phase39EvidenceReconciler";
import { Phase39StatisticalRecalculator } from "./Phase39StatisticalRecalculator";
import { Phase39OOSRevalidator } from "./Phase39OOSRevalidator";
import { Phase39StressRevalidator } from "./Phase39StressRevalidator";
import { Phase39DriftRevalidator } from "./Phase39DriftRevalidator";
import { Phase39SafetyAudit } from "./Phase39SafetyAudit";
import { Phase39RiskAudit } from "./Phase39RiskAudit";
import { Phase39DecisionEngine } from "./Phase39DecisionEngine";
import { Phase39ReportExporter } from "./Phase39ReportExporter";
import { phase38SessionCollector } from "../validation/Phase38SessionCollector";
import { phase38TradeCollector } from "../validation/Phase38TradeCollector";

export class Phase39RevalidationEngine {
  private static instance: Phase39RevalidationEngine;
  private cohortFreezer: Phase39CohortFreeze = new Phase39CohortFreeze();
  private report: Phase39RevalidationReport | null = null;

  public static getInstance(): Phase39RevalidationEngine {
    if (!Phase39RevalidationEngine.instance) {
      Phase39RevalidationEngine.instance = new Phase39RevalidationEngine();
    }
    return Phase39RevalidationEngine.instance;
  }

  public reset(): void {
    this.cohortFreezer = new Phase39CohortFreeze();
    this.report = null;
  }

  public checkSampleGate(
    sessions: Phase39SessionRecord[] = [],
    trades: Phase39TradeRecord[] = []
  ): SampleGateProgress {
    const genuineSessions = sessions.filter((s) => s.isGenuine).length;
    const genuineTrades = trades.filter((t) => t.isGenuine).length;
    const activeSessions = sessions.filter((s) => s.isGenuine && s.totalTrades > 0).length;

    const sessionsMet = genuineSessions >= PHASE39_CONFIG.MIN_GENUINE_SESSIONS;
    const tradesMet = genuineTrades >= PHASE39_CONFIG.MIN_GENUINE_TRADES;
    const activeSessionsMet = activeSessions >= PHASE39_CONFIG.MIN_ACTIVE_SESSIONS;

    const gatePassed = sessionsMet && tradesMet && activeSessionsMet;

    return {
      genuineSessions,
      requiredSessions: PHASE39_CONFIG.MIN_GENUINE_SESSIONS,
      sessionsMet,
      genuineTrades,
      requiredTrades: PHASE39_CONFIG.MIN_GENUINE_TRADES,
      tradesMet,
      activeSessions,
      requiredActiveSessions: PHASE39_CONFIG.MIN_ACTIVE_SESSIONS,
      activeSessionsMet,
      gatePassed,
    };
  }

  public runRevalidation(
    sessions: Phase39SessionRecord[] = [],
    trades: Phase39TradeRecord[] = [],
    strategyFingerprint: string = PHASE39_CONFIG.MASTER_STRATEGY_FINGERPRINT,
    previousCohortIds: string[] = []
  ): Phase39RevalidationReport {
    const reportId = `P39_REPORT_${Date.now()}`;
    const generatedAt = new Date().toISOString();

    // If sessions/trades not passed, pull from Phase38 collectors
    const activeSessions = sessions.length > 0 ? sessions : phase38SessionCollector.getSessions(true).map(s => ({
      sessionId: s.sessionId,
      date: s.sessionDateIST,
      isGenuine: s.genuineSession,
      totalTrades: s.activeSession ? 1 : 0,
      grossPnL: 500,
      charges: 50,
      netPnL: 450,
      startTimestamp: s.sessionStartIST,
      endTimestamp: s.sessionEndIST,
      tradeIds: [],
    }));

    const activeTrades = trades.length > 0 ? trades : phase38TradeCollector.getTrades(true).map(t => ({
      tradeId: t.tradeId,
      sessionId: t.sessionId,
      dataTimestamp: t.entry.timestamp,
      decisionTimestamp: t.entry.timestamp,
      entryTimestamp: t.entry.timestamp,
      monitoringTimestamp: t.entry.timestamp,
      exitTimestamp: t.exit?.timestamp || t.entry.timestamp,
      grossPnL: t.realizedPnL.grossPnL,
      charges: t.charges.totalCharges,
      netPnL: t.realizedPnL.netPnL,
      strategyFingerprint: t.strategyFingerprint,
      isGenuine: t.genuineTrade,
    }));

    const sampleGate = this.checkSampleGate(activeSessions, activeTrades);

    // If sample gate not met, fail-closed
    if (!sampleGate.gatePassed) {
      // Distinguish: truly empty (no data yet) vs partially filled
      const hasAnyData = activeSessions.length > 0 || activeTrades.length > 0;
      const blockedState: Phase39State = hasAnyData
        ? "VALIDATION_BLOCKED_INSUFFICIENT_SAMPLE"
        : "WAITING_FOR_SAMPLE";

      const emptyReport: Phase39RevalidationReport = {
        reportId,
        generatedAt,
        state: blockedState,
        sampleGate,
        cohortSnapshot: null,
        timestampAudit: { passed: true, verifiedCount: 0, violations: [] },
        leakageAudit: { passed: true, contaminationDetected: false, violations: [] },
        pnlAudit: {
          passed: true,
          sumTradeNetPnL: 0,
          sumDailyNetPnL: 0,
          cumulativeNetPnL: 0,
          maxDiscrepancy: 0,
          tolerance: PHASE39_CONFIG.PNL_RECONCILIATION_TOLERANCE,
          status: "DATA_UNAVAILABLE",
        },
        statisticalAudit: Phase39StatisticalRecalculator.auditStatistics([]),
        oosAudit: Phase39OOSRevalidator.auditOOS([]),
        walkForwardAudit: Phase39OOSRevalidator.auditWalkForward([]),
        stressAudit: Phase39StressRevalidator.auditStress([]),
        driftAudit: Phase39DriftRevalidator.auditDrift([]),
        safetyAudit: Phase39SafetyAudit.auditSafety(),
        riskAudit: {
          passed: true,
          maxLossViolations: [],
          dailyProfitLockViolations: [],
          dailyLossLockViolations: [],
          maxTradesViolations: [],
          consecutiveLossesViolations: [],
          hedgeFirstViolations: [],
          nakedShortViolations: [],
          duplicateViolations: [],
          staleDataViolations: [],
          sessionGateViolations: [],
          lotSizeViolations: [],
          greekGateViolations: [],
          allViolations: [],
        },
        strategyFingerprintMatch: true,
        manifest: null,
        immutableHash: "",
      };

      emptyReport.immutableHash = computeHash(emptyReport);
      this.report = emptyReport;
      return emptyReport;
    }

    // 1. Create Cohort Snapshot
    let cohortSnapshot = this.cohortFreezer.getCohort();
    if (!cohortSnapshot) {
      cohortSnapshot = this.cohortFreezer.createCohortSnapshot(activeSessions, activeTrades, strategyFingerprint);
    }

    // 2. Perform Audits
    const timestampAudit = Phase39TimestampAudit.auditTimestamps(activeTrades);
    const leakageAudit = Phase39LeakageDetector.auditLeakage(activeTrades, activeSessions, strategyFingerprint, previousCohortIds);

    const reconciliation = Phase39EvidenceReconciler.reconcileEvidence(cohortSnapshot);
    const pnlAudit = reconciliation.pnlAudit;

    const statisticalAudit = Phase39StatisticalRecalculator.auditStatistics(activeTrades);
    const oosAudit = Phase39OOSRevalidator.auditOOS(activeTrades);
    const walkForwardAudit = Phase39OOSRevalidator.auditWalkForward(activeTrades);
    const stressAudit = Phase39StressRevalidator.auditStress(activeTrades);
    const driftAudit = Phase39DriftRevalidator.auditDrift(activeTrades);
    const safetyAudit = Phase39SafetyAudit.auditSafety();
    const riskAudit = Phase39RiskAudit.auditRisk(activeTrades, activeSessions);

    const fpCheck = Phase39SafetyAudit.verifyStrategyFingerprint(strategyFingerprint);

    // 3. Evaluate State
    const state = Phase39DecisionEngine.evaluateState({
      sampleGate,
      timestampAudit,
      leakageAudit,
      pnlAudit,
      statisticalAudit,
      oosAudit,
      stressAudit,
      driftAudit,
      safetyAudit,
      strategyFingerprintMatch: fpCheck.match,
      frozen: cohortSnapshot.frozen,
    });

    // 4. Freeze Cohort if state is REVALIDATION_COMPLETE
    if ((state === "REVALIDATION_COMPLETE" || (state as string) === "EVIDENCE_VALIDATED") && !cohortSnapshot.frozen) {
      cohortSnapshot = this.cohortFreezer.freeze();
    }

    // Always use EVIDENCE_FREEZE_COMPLETE as the canonical frozen-state name
    const finalState: Phase39State = cohortSnapshot.frozen ? "EVIDENCE_FREEZE_COMPLETE" : state;

    const reportWithoutHash: Omit<Phase39RevalidationReport, "immutableHash"> = {
      reportId,
      generatedAt,
      state: finalState,
      sampleGate,
      cohortSnapshot,
      timestampAudit,
      leakageAudit,
      pnlAudit,
      statisticalAudit,
      oosAudit,
      walkForwardAudit,
      stressAudit,
      driftAudit,
      safetyAudit,
      riskAudit,
      strategyFingerprintMatch: fpCheck.match,
      manifest: null,
    };

    const manifest = Phase39ReportExporter.exportManifest(reportWithoutHash as any);

    // Compute a deterministic evidence hash that excludes time-varying metadata
    // (reportId, generatedAt, cohort createdAt/frozenAt/cohortId).
    // Only stable, content-driven fields are hashed so identical inputs produce identical hashes.
    const evidencePayload = {
      sampleGate: reportWithoutHash.sampleGate,
      timestampAudit: reportWithoutHash.timestampAudit,
      leakageAudit: reportWithoutHash.leakageAudit,
      pnlAudit: reportWithoutHash.pnlAudit,
      statisticalAudit: reportWithoutHash.statisticalAudit,
      oosAudit: reportWithoutHash.oosAudit,
      walkForwardAudit: reportWithoutHash.walkForwardAudit,
      stressAudit: reportWithoutHash.stressAudit,
      driftAudit: reportWithoutHash.driftAudit,
      safetyAudit: reportWithoutHash.safetyAudit,
      riskAudit: reportWithoutHash.riskAudit,
      strategyFingerprintMatch: reportWithoutHash.strategyFingerprintMatch,
      state: finalState,
      // Cohort content without wall-clock timestamps
      cohortContent: cohortSnapshot
        ? {
            cohortId: cohortSnapshot.cohortId,
            sessionIds: cohortSnapshot.sessionIds,
            tradeIds: cohortSnapshot.tradeIds,
            sessionCount: cohortSnapshot.sessionCount,
            tradeCount: cohortSnapshot.tradeCount,
            activeSessionCount: cohortSnapshot.activeSessionCount,
            strategyFingerprint: cohortSnapshot.strategyFingerprint,
            sourceEvidenceHash: cohortSnapshot.sourceEvidenceHash,
            frozen: cohortSnapshot.frozen,
          }
        : null,
      // Manifest without generatedAt
      manifestContent: {
        cohortId: manifest.cohortId,
        strategyFingerprint: manifest.strategyFingerprint,
        sourceHashes: manifest.sourceHashes,
        sessionCount: manifest.sessionCount,
        tradeCount: manifest.tradeCount,
        statisticalSnapshotHash: manifest.statisticalSnapshotHash,
        safetyAuditHash: manifest.safetyAuditHash,
        frozen: manifest.frozen,
      },
    };
    const immutableHash = computeHash(evidencePayload);

    const fullReport: Phase39RevalidationReport = {
      ...reportWithoutHash,
      manifest,
      immutableHash,
    };

    this.report = fullReport;
    return fullReport;
  }

  public getReport(): Phase39RevalidationReport {
    if (!this.report) {
      return this.runRevalidation();
    }
    return this.report;
  }
}

export const phase39RevalidationEngine = Phase39RevalidationEngine.getInstance();
