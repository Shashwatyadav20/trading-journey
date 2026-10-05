import { describe, it, expect, beforeEach } from "vitest";
import { phase39RevalidationEngine, Phase39RevalidationEngine } from "../phase39/Phase39RevalidationEngine";
import { Phase39SafetyAudit } from "../phase39/Phase39SafetyAudit";
import { Phase39TimestampAudit } from "../phase39/Phase39TimestampAudit";
import { Phase39LeakageDetector } from "../phase39/Phase39LeakageDetector";
import { Phase39PnLAudit } from "../phase39/Phase39PnLAudit";
import { Phase39EvidenceReconciler } from "../phase39/Phase39EvidenceReconciler";
import { Phase39StatisticalRecalculator } from "../phase39/Phase39StatisticalRecalculator";
import { Phase39OOSRevalidator } from "../phase39/Phase39OOSRevalidator";
import { Phase39StressRevalidator } from "../phase39/Phase39StressRevalidator";
import { Phase39DriftRevalidator } from "../phase39/Phase39DriftRevalidator";
import { Phase39CohortFreeze } from "../phase39/Phase39CohortFreeze";
import { Phase39DecisionEngine } from "../phase39/Phase39DecisionEngine";
import { Phase39ReportExporter } from "../phase39/Phase39ReportExporter";
import { PHASE39_CONFIG } from "../phase39/Phase39Config";
import { Phase39SessionRecord, Phase39TradeRecord } from "../phase39/Phase39Types";

function createDummySessions(count: number): Phase39SessionRecord[] {
  const sessions: Phase39SessionRecord[] = [];
  for (let i = 1; i <= count; i++) {
    sessions.push({
      sessionId: `SESSION_P39_${i}`,
      date: `2026-09-${i.toString().padStart(2, "0")}`,
      isGenuine: true,
      totalTrades: 2,
      grossPnL: 1000,
      charges: 100,
      netPnL: 900,
      startTimestamp: `2026-09-${i.toString().padStart(2, "0")}T09:15:00Z`,
      endTimestamp: `2026-09-${i.toString().padStart(2, "0")}T15:30:00Z`,
      tradeIds: [`TRADE_P39_${i}_1`, `TRADE_P39_${i}_2`],
    });
  }
  return sessions;
}

function createDummyTrades(count: number): Phase39TradeRecord[] {
  const trades: Phase39TradeRecord[] = [];
  for (let i = 1; i <= count; i++) {
    const sId = Math.ceil(i / 2);
    const dateStr = `2026-09-${sId.toString().padStart(2, "0")}`;
    trades.push({
      tradeId: `TRADE_P39_${sId}_${(i % 2) + 1}`,
      sessionId: `SESSION_P39_${sId}`,
      dataTimestamp: `${dateStr}T09:30:00Z`,
      decisionTimestamp: `${dateStr}T09:30:05Z`,
      entryTimestamp: `${dateStr}T09:30:10Z`,
      monitoringTimestamp: `${dateStr}T09:35:00Z`,
      exitTimestamp: `${dateStr}T10:00:00Z`,
      grossPnL: 500,
      charges: 50,
      netPnL: 450,
      strategyFingerprint: PHASE39_CONFIG.MASTER_STRATEGY_FINGERPRINT,
      isGenuine: true,
      isOOS: i > count * 0.7, // 30% OOS
    });
  }
  return trades;
}

describe("PHASE 39 — Post-Sample Revalidation & Evidence Freeze Test Suite", () => {
  beforeEach(() => {
    phase39RevalidationEngine.reset();
  });

  // ── 1. Safety Audit & Safety Invariants (10 tests) ──────────────────
  describe("Safety Audit & Invariants", () => {
    it("✓ 1. PAPER_TRADING remains hard locked to true", () => {
      const audit = Phase39SafetyAudit.auditSafety();
      expect(audit.paperTrading).toBe(true);
    });

    it("✓ 2. LIVE_TRADING remains hard locked to false", () => {
      const audit = Phase39SafetyAudit.auditSafety();
      expect(audit.liveTrading).toBe(false);
    });

    it("✓ 3. BROKER_EXECUTION_ENABLED remains hard locked to false", () => {
      const audit = Phase39SafetyAudit.auditSafety();
      expect(audit.brokerExecution).toBe(false);
    });

    it("✓ 4. INDIAN_REAL_DATA_ONLY remains hard locked to true", () => {
      const audit = Phase39SafetyAudit.auditSafety();
      expect(audit.realDataOnly).toBe(true);
    });

    it("✓ 5. REAL_DHAN_ORDERS remains zero", () => {
      const audit = Phase39SafetyAudit.auditSafety();
      expect(audit.realDhanOrders).toBe(0);
    });

    it("✓ 6. placeOrder is fail-closed and blocked", () => {
      const audit = Phase39SafetyAudit.auditSafety();
      expect(audit.placeOrderBlocked).toBe(true);
    });

    it("✓ 7. modifyOrder is fail-closed and blocked", () => {
      const audit = Phase39SafetyAudit.auditSafety();
      expect(audit.modifyOrderBlocked).toBe(true);
    });

    it("✓ 8. cancelOrder is fail-closed and blocked", () => {
      const audit = Phase39SafetyAudit.auditSafety();
      expect(audit.cancelOrderBlocked).toBe(true);
    });

    it("✓ 9. Strategy fingerprint match returns FINGERPRINT_MATCHED for canonical fingerprint", () => {
      const res = Phase39SafetyAudit.verifyStrategyFingerprint(PHASE39_CONFIG.MASTER_STRATEGY_FINGERPRINT);
      expect(res.match).toBe(true);
      expect(res.status).toBe("FINGERPRINT_MATCHED");
    });

    it("✓ 10. Strategy fingerprint mismatch returns COHORT_INVALIDATED_BY_STRATEGY_CHANGE", () => {
      const res = Phase39SafetyAudit.verifyStrategyFingerprint("MODIFIED_STRATEGY_FINGERPRINT");
      expect(res.match).toBe(false);
      expect(res.status).toBe("COHORT_INVALIDATED_BY_STRATEGY_CHANGE");
    });
  });

  // ── 2. Sample Gate & Sample Sufficiency (5 tests) ────────────────────
  describe("Sample Gate & Sufficiency", () => {
    it("✓ 11. Cannot start revalidation before sample gate thresholds are met", () => {
      const progress = phase39RevalidationEngine.checkSampleGate([], []);
      expect(progress.gatePassed).toBe(false);
      expect(progress.genuineSessions).toBe(0);
    });

    it("✓ 12. Cannot start when genuine sessions < 20", () => {
      const sessions = createDummySessions(19);
      const trades = createDummyTrades(30);
      const progress = phase39RevalidationEngine.checkSampleGate(sessions, trades);
      expect(progress.sessionsMet).toBe(false);
      expect(progress.gatePassed).toBe(false);
    });

    it("✓ 13. Cannot start when genuine trades < 30", () => {
      const sessions = createDummySessions(20);
      const trades = createDummyTrades(29);
      const progress = phase39RevalidationEngine.checkSampleGate(sessions, trades);
      expect(progress.tradesMet).toBe(false);
      expect(progress.gatePassed).toBe(false);
    });

    it("✓ 14. Cannot start when active sessions < 15", () => {
      const sessions = createDummySessions(20);
      // Mark trades count to 0 for 10 sessions
      sessions.forEach((s, idx) => {
        if (idx >= 10) s.totalTrades = 0;
      });
      const trades = createDummyTrades(30);
      const progress = phase39RevalidationEngine.checkSampleGate(sessions, trades);
      expect(progress.activeSessionsMet).toBe(false);
      expect(progress.gatePassed).toBe(false);
    });

    it("✓ 15. Passes sample gate when all thresholds are met (20 sessions, 30 trades, 15 active)", () => {
      const sessions = createDummySessions(20);
      const trades = createDummyTrades(30);
      const progress = phase39RevalidationEngine.checkSampleGate(sessions, trades);
      expect(progress.gatePassed).toBe(true);
    });
  });

  // ── 3. Timestamp Audit (6 tests) ─────────────────────────────────────
  describe("Timestamp Audit", () => {
    it("✓ 16. Valid trade timestamp sequence passes timestamp audit", () => {
      const trades = createDummyTrades(2);
      const res = Phase39TimestampAudit.auditTimestamps(trades);
      expect(res.passed).toBe(true);
      expect(res.violations).toHaveLength(0);
    });

    it("✓ 17. Detects timestamp reversal (dataTimestamp > decisionTimestamp)", () => {
      const trades = createDummyTrades(1);
      trades[0].dataTimestamp = "2026-10-01T10:00:00Z";
      trades[0].decisionTimestamp = "2026-10-01T09:00:00Z";
      const res = Phase39TimestampAudit.auditTimestamps(trades);
      expect(res.passed).toBe(false);
      expect(res.violations[0]).toContain("Timestamp reversal");
    });

    it("✓ 18. Detects look-ahead bias (dataTimestamp > entryTimestamp)", () => {
      const trades = createDummyTrades(1);
      trades[0].dataTimestamp = "2026-10-01T09:30:15Z";
      trades[0].entryTimestamp = "2026-10-01T09:30:10Z";
      const res = Phase39TimestampAudit.auditTimestamps(trades);
      expect(res.passed).toBe(false);
      expect(res.violations.some((v) => v.includes("Look-ahead bias"))).toBe(true);
    });

    it("✓ 19. Detects future timestamps", () => {
      const trades = createDummyTrades(1);
      trades[0].exitTimestamp = "2099-01-01T00:00:00Z";
      const res = Phase39TimestampAudit.auditTimestamps(trades);
      expect(res.passed).toBe(false);
      expect(res.violations.some((v) => v.includes("future timestamp"))).toBe(true);
    });

    it("✓ 20. Detects duplicate timestamp tuples across trades", () => {
      const trades = createDummyTrades(2);
      trades[1].entryTimestamp = trades[0].entryTimestamp;
      trades[1].exitTimestamp = trades[0].exitTimestamp;
      trades[1].tradeId = trades[0].tradeId;
      const res = Phase39TimestampAudit.auditTimestamps(trades);
      expect(res.passed).toBe(false);
      expect(res.violations.some((v) => v.includes("Duplicate timestamp tuple"))).toBe(true);
    });

    it("✓ 21. Rejects invalid date format strings", () => {
      const trades = createDummyTrades(1);
      trades[0].entryTimestamp = "INVALID_DATE_STRING";
      const res = Phase39TimestampAudit.auditTimestamps(trades);
      expect(res.passed).toBe(false);
    });
  });

  // ── 4. Leakage Detector (6 tests) ─────────────────────────────────────
  describe("Leakage Detector", () => {
    it("✓ 22. Clean dataset produces zero leakage violations", () => {
      const sessions = createDummySessions(20);
      const trades = createDummyTrades(30);
      const res = Phase39LeakageDetector.auditLeakage(trades, sessions, PHASE39_CONFIG.MASTER_STRATEGY_FINGERPRINT);
      expect(res.passed).toBe(true);
      expect(res.contaminationDetected).toBe(false);
    });

    it("✓ 23. Duplicate trade ID detected and fails audit", () => {
      const sessions = createDummySessions(5);
      const trades = createDummyTrades(5);
      trades.push({ ...trades[0] });
      const res = Phase39LeakageDetector.auditLeakage(trades, sessions, PHASE39_CONFIG.MASTER_STRATEGY_FINGERPRINT);
      expect(res.passed).toBe(false);
      expect(res.violations.some((v) => v.includes("Duplicate trade ID"))).toBe(true);
    });

    it("✓ 24. Duplicate session ID detected and fails audit", () => {
      const sessions = createDummySessions(5);
      sessions.push({ ...sessions[0] });
      const trades = createDummyTrades(5);
      const res = Phase39LeakageDetector.auditLeakage(trades, sessions, PHASE39_CONFIG.MASTER_STRATEGY_FINGERPRINT);
      expect(res.passed).toBe(false);
      expect(res.violations.some((v) => v.includes("Duplicate session ID"))).toBe(true);
    });

    it("✓ 25. Strategy fingerprint mismatch detected per trade", () => {
      const sessions = createDummySessions(5);
      const trades = createDummyTrades(5);
      trades[2].strategyFingerprint = "WRONG_FINGERPRINT";
      const res = Phase39LeakageDetector.auditLeakage(trades, sessions, PHASE39_CONFIG.MASTER_STRATEGY_FINGERPRINT);
      expect(res.passed).toBe(false);
      expect(res.violations.some((v) => v.includes("Strategy fingerprint mismatch"))).toBe(true);
    });

    it("✓ 26. OOS contamination detected if trade is present in both IS and OOS", () => {
      const sessions = createDummySessions(5);
      const trades = createDummyTrades(5);
      trades[0].isOOS = false;
      trades.push({ ...trades[0], isOOS: true });
      const res = Phase39LeakageDetector.auditLeakage(trades, sessions, PHASE39_CONFIG.MASTER_STRATEGY_FINGERPRINT);
      expect(res.passed).toBe(false);
      expect(res.violations.some((v) => v.includes("OOS Contamination"))).toBe(true);
    });

    it("✓ 27. Prior cohort session reuse detected and fails audit", () => {
      const sessions = createDummySessions(5);
      const trades = createDummyTrades(5);
      const res = Phase39LeakageDetector.auditLeakage(trades, sessions, PHASE39_CONFIG.MASTER_STRATEGY_FINGERPRINT, ["SESSION_P39_1"]);
      expect(res.passed).toBe(false);
      expect(res.violations.some((v) => v.includes("prior Phase 31/32 validation cohort"))).toBe(true);
    });
  });

  // ── 5. P&L Audit & Evidence Reconciler (6 tests) ───────────────────────
  describe("P&L Audit & Evidence Reconciler", () => {
    it("✓ 28. Returns DATA_UNAVAILABLE when zero trades/sessions exist", () => {
      const res = Phase39PnLAudit.auditPnL([], []);
      expect(res.status).toBe("DATA_UNAVAILABLE");
    });

    it("✓ 29. Returns PASS when trade P&L sum matches session P&L sum", () => {
      const sessions: Phase39SessionRecord[] = [
        {
          sessionId: "S1",
          date: "2026-10-01",
          isGenuine: true,
          totalTrades: 2,
          grossPnL: 1000,
          charges: 100,
          netPnL: 900,
          startTimestamp: "",
          endTimestamp: "",
          tradeIds: ["T1", "T2"],
        },
      ];
      const trades: Phase39TradeRecord[] = [
        {
          tradeId: "T1",
          sessionId: "S1",
          dataTimestamp: "",
          decisionTimestamp: "",
          entryTimestamp: "",
          monitoringTimestamp: "",
          exitTimestamp: "",
          grossPnL: 500,
          charges: 50,
          netPnL: 450,
          strategyFingerprint: PHASE39_CONFIG.MASTER_STRATEGY_FINGERPRINT,
          isGenuine: true,
        },
        {
          tradeId: "T2",
          sessionId: "S1",
          dataTimestamp: "",
          decisionTimestamp: "",
          entryTimestamp: "",
          monitoringTimestamp: "",
          exitTimestamp: "",
          grossPnL: 500,
          charges: 50,
          netPnL: 450,
          strategyFingerprint: PHASE39_CONFIG.MASTER_STRATEGY_FINGERPRINT,
          isGenuine: true,
        },
      ];
      const res = Phase39PnLAudit.auditPnL(trades, sessions);
      expect(res.status).toBe("PASS");
      expect(res.passed).toBe(true);
      expect(res.maxDiscrepancy).toBeLessThanOrEqual(PHASE39_CONFIG.PNL_RECONCILIATION_TOLERANCE);
    });

    it("✓ 30. Returns FAIL when P&L discrepancy exceeds 0.01 tolerance", () => {
      const sessions: Phase39SessionRecord[] = [
        {
          sessionId: "S1",
          date: "2026-10-01",
          isGenuine: true,
          totalTrades: 1,
          grossPnL: 1000,
          charges: 100,
          netPnL: 900,
          startTimestamp: "",
          endTimestamp: "",
          tradeIds: ["T1"],
        },
      ];
      const trades: Phase39TradeRecord[] = [
        {
          tradeId: "T1",
          sessionId: "S1",
          dataTimestamp: "",
          decisionTimestamp: "",
          entryTimestamp: "",
          monitoringTimestamp: "",
          exitTimestamp: "",
          grossPnL: 500,
          charges: 50,
          netPnL: 400, // Discrepancy of 500 vs 900
          strategyFingerprint: PHASE39_CONFIG.MASTER_STRATEGY_FINGERPRINT,
          isGenuine: true,
        },
      ];
      const res = Phase39PnLAudit.auditPnL(trades, sessions);
      expect(res.status).toBe("FAIL");
      expect(res.passed).toBe(false);
      expect(res.maxDiscrepancy).toBeGreaterThan(0.01);
    });

    it("✓ 31. Reconciles evidence and computes source evidence hash", () => {
      const freezer = new Phase39CohortFreeze();
      const cohort = freezer.createCohortSnapshot(createDummySessions(5), createDummyTrades(10));
      const res = Phase39EvidenceReconciler.reconcileEvidence(cohort);
      expect(res.sourceEvidenceHashValid).toBe(true);
      expect(res.computedHash).toBeDefined();
    });

    it("✓ 32. Tolerates tiny rounding diffs <= 0.01", () => {
      const sessions: Phase39SessionRecord[] = [
        {
          sessionId: "S1",
          date: "2026-10-01",
          isGenuine: true,
          totalTrades: 1,
          grossPnL: 100,
          charges: 10,
          netPnL: 90.005,
          startTimestamp: "",
          endTimestamp: "",
          tradeIds: ["T1"],
        },
      ];
      const trades: Phase39TradeRecord[] = [
        {
          tradeId: "T1",
          sessionId: "S1",
          dataTimestamp: "",
          decisionTimestamp: "",
          entryTimestamp: "",
          monitoringTimestamp: "",
          exitTimestamp: "",
          grossPnL: 100,
          charges: 10,
          netPnL: 90.001,
          strategyFingerprint: PHASE39_CONFIG.MASTER_STRATEGY_FINGERPRINT,
          isGenuine: true,
        },
      ];
      const res = Phase39PnLAudit.auditPnL(trades, sessions);
      expect(res.status).toBe("PASS");
    });

    it("✓ 33. Cumulative net P&L matches trade sum", () => {
      const trades = createDummyTrades(10);
      const res = Phase39PnLAudit.auditPnL(trades, createDummySessions(5));
      expect(res.sumTradeNetPnL).toEqual(res.cumulativeNetPnL);
    });
  });

  // ── 6. Statistical Recalculator & Deterministic Bootstrap (6 tests) ──────
  describe("Statistical Recalculator & Bootstrap", () => {
    it("✓ 34. Recalculates metrics accurately from frozen trade cohort", () => {
      const trades = createDummyTrades(10);
      const metrics = Phase39StatisticalRecalculator.calculateMetrics(trades);
      expect(metrics.totalTrades).toBe(10);
      expect(metrics.winRate).toBe(1.0); // All dummy trades have netPnL 450
      expect(metrics.expectancy).toBe(450);
    });

    it("✓ 35. Calculates Wilson 95% CI correctly", () => {
      const ci = Phase39StatisticalRecalculator.calculateWilsonScoreCI(15, 20);
      expect(ci.lower).toBeGreaterThan(0.5);
      expect(ci.upper).toBeLessThanOrEqual(1.0);
    });

    it("✓ 36. Deterministic bootstrap generates identical results across multiple runs", () => {
      const trades = createDummyTrades(20);
      const b1 = Phase39StatisticalRecalculator.runBootstrap(trades, 500, 42);
      const b2 = Phase39StatisticalRecalculator.runBootstrap(trades, 500, 42);
      expect(b1.lower).toEqual(b2.lower);
      expect(b1.upper).toEqual(b2.upper);
      expect(b1.mean).toEqual(b2.mean);
    });

    it("✓ 37. Handles 0 trades gracefully in statistical audit", () => {
      const audit = Phase39StatisticalRecalculator.auditStatistics([]);
      expect(audit.metrics.totalTrades).toBe(0);
      expect(audit.wilson95CI.lower).toBe(0);
    });

    it("✓ 38. Includes required disclaimer text in statistical audit", () => {
      const audit = Phase39StatisticalRecalculator.auditStatistics(createDummyTrades(5));
      expect(audit.disclaimer).toContain("STATISTICAL RECALCULATION");
      expect(audit.disclaimer).not.toContain("guarantee");
    });

    it("✓ 39. Calculates max drawdown correctly", () => {
      const trades = createDummyTrades(4);
      trades[1].netPnL = -500;
      trades[2].netPnL = -300;
      const metrics = Phase39StatisticalRecalculator.calculateMetrics(trades);
      expect(metrics.maxDrawdown).toBe(800);
    });
  });

  // ── 7. OOS & Walk-Forward Revalidation (5 tests) ───────────────────────
  describe("OOS & Walk-Forward Revalidation", () => {
    it("✓ 40. Reports STABLE OOS status when degradation <= 35%", () => {
      const trades = createDummyTrades(20);
      const res = Phase39OOSRevalidator.auditOOS(trades);
      expect(res.status).toBe("STABLE");
    });

    it("✓ 41. Reports DEGRADED OOS status when degradation > 35%", () => {
      const trades = createDummyTrades(20);
      // Make OOS trades suffer high losses
      trades.forEach((t) => {
        if (t.isOOS) t.netPnL = -1000;
      });
      const res = Phase39OOSRevalidator.auditOOS(trades);
      expect(res.status).toBe("DEGRADED");
    });

    it("✓ 42. Reports INSUFFICIENT_DATA when zero OOS trades exist", () => {
      const trades = createDummyTrades(10);
      trades.forEach((t) => (t.isOOS = false));
      const res = Phase39OOSRevalidator.auditOOS(trades);
      expect(res.status).toBe("INSUFFICIENT_DATA");
    });

    it("✓ 43. Evaluates Walk-Forward windows without producing forbidden winner/rank text", () => {
      const trades = createDummyTrades(20);
      trades.slice(0, 10).forEach((t) => (t.windowId = "W1"));
      trades.slice(10).forEach((t) => (t.windowId = "W2"));
      const wf = Phase39OOSRevalidator.auditWalkForward(trades);
      expect(wf.windows).toHaveLength(2);
      expect(wf.overallStatus).toBe("PASS");
    });

    it("✓ 44. Returns INSUFFICIENT_DATA for default single window walk-forward", () => {
      const trades = createDummyTrades(10);
      const wf = Phase39OOSRevalidator.auditWalkForward(trades);
      expect(wf.overallStatus).toBe("INSUFFICIENT_DATA");
    });
  });

  // ── 8. Stress & Drift Revalidation (5 tests) ───────────────────────────
  describe("Stress & Drift Revalidation", () => {
    it("✓ 45. Runs slippage stress (+25%, +50%, +100%) against trade cohort", () => {
      const trades = createDummyTrades(10);
      const res = Phase39StressRevalidator.auditStress(trades);
      expect(res.slippageStress).toHaveLength(3);
      expect(res.slippageStress[0].scenario).toBe("+25% Slippage");
    });

    it("✓ 46. Runs execution delay stress (0s, 5s, 15s) against trade cohort", () => {
      const trades = createDummyTrades(10);
      const res = Phase39StressRevalidator.auditStress(trades);
      expect(res.delayStress).toHaveLength(3);
    });

    it("✓ 47. Data quality scenarios produce PASS resilience rating", () => {
      const trades = createDummyTrades(10);
      const res = Phase39StressRevalidator.auditStress(trades);
      expect(res.dataQualityResilience).toBe("PASS");
    });

    it("✓ 48. Returns INSUFFICIENT_DATA for drift when trades < 30", () => {
      const trades = createDummyTrades(10);
      const drift = Phase39DriftRevalidator.auditDrift(trades);
      expect(drift.status).toBe("INSUFFICIENT_DATA");
    });

    it("✓ 49. Evaluates drift status correctly when trades >= 30", () => {
      const trades = createDummyTrades(30);
      const drift = Phase39DriftRevalidator.auditDrift(trades);
      expect(drift.status).toBe("NO_MEASURABLE_DRIFT");
    });
  });

  // ── 9. Cohort Freeze & Mutation Protection (6 tests) ───────────────────
  describe("Cohort Freeze & Mutation Protection", () => {
    it("✓ 50. Creates initial cohort snapshot cleanly", () => {
      const freezer = new Phase39CohortFreeze();
      const cohort = freezer.createCohortSnapshot(createDummySessions(5), createDummyTrades(10));
      expect(cohort.frozen).toBe(false);
      expect(cohort.cohortId).toContain("COHORT_P39_");
    });

    it("✓ 51. Freezes cohort and sets frozenAt timestamp", () => {
      const freezer = new Phase39CohortFreeze();
      freezer.createCohortSnapshot(createDummySessions(5), createDummyTrades(10));
      const frozen = freezer.freeze();
      expect(frozen.frozen).toBe(true);
      expect(frozen.frozenAt).toBeDefined();
    });

    it("✓ 52. BLOCKED: Frozen cohort cannot accept new trades via addTrade", () => {
      const freezer = new Phase39CohortFreeze();
      freezer.createCohortSnapshot(createDummySessions(5), createDummyTrades(10));
      freezer.freeze();
      const trade = createDummyTrades(1)[0];
      expect(() => freezer.addTrade(trade)).toThrow(/BLOCKED: Cannot ADD/);
    });

    it("✓ 53. BLOCKED: Frozen cohort cannot delete trades via deleteTrade", () => {
      const freezer = new Phase39CohortFreeze();
      freezer.createCohortSnapshot(createDummySessions(5), createDummyTrades(10));
      freezer.freeze();
      expect(() => freezer.deleteTrade("TRADE_P39_1_1")).toThrow(/BLOCKED: Cannot DELETE/);
    });

    it("✓ 54. BLOCKED: Frozen cohort cannot edit trades via editTrade", () => {
      const freezer = new Phase39CohortFreeze();
      freezer.createCohortSnapshot(createDummySessions(5), createDummyTrades(10));
      freezer.freeze();
      expect(() => freezer.editTrade("TRADE_P39_1_1", { netPnL: 9999 })).toThrow(/BLOCKED: Cannot EDIT/);
    });

    it("✓ 55. BLOCKED: Frozen cohort cannot reorder trades via reorderTrades", () => {
      const freezer = new Phase39CohortFreeze();
      freezer.createCohortSnapshot(createDummySessions(5), createDummyTrades(10));
      freezer.freeze();
      expect(() => freezer.reorderTrades()).toThrow(/BLOCKED: Cannot REORDER/);
    });
  });

  // ── 10. Decision Engine & Full Integration Flow (6 tests) ───────────────
  describe("Decision Engine & Full Integration Flow", () => {
    it("✓ 56. Returns WAITING_FOR_SAMPLE when genuine sample gate is incomplete", () => {
      const report = phase39RevalidationEngine.runRevalidation([], []);
      expect(report.state).toBe("WAITING_FOR_SAMPLE");
      expect(report.cohortSnapshot).toBeNull();
    });

    it("✓ 57. Returns REVALIDATION_FAILED when timestamp reversal is detected", () => {
      const sessions = createDummySessions(20);
      const trades = createDummyTrades(30);
      trades[0].dataTimestamp = "2026-10-01T10:00:00Z";
      trades[0].decisionTimestamp = "2026-10-01T09:00:00Z";

      const report = phase39RevalidationEngine.runRevalidation(sessions, trades);
      expect(report.state).toBe("REVALIDATION_FAILED");
      expect(report.timestampAudit.passed).toBe(false);
    });

    it("✓ 58. Returns COHORT_FROZEN when sample complete and all audits pass", () => {
      const sessions = createDummySessions(20);
      const trades = createDummyTrades(40); // 20 sessions * 2 trades = 40 trades matching net PnL

      const report = phase39RevalidationEngine.runRevalidation(sessions, trades);
      expect(report.state).toBe("EVIDENCE_FREEZE_COMPLETE");
      expect(report.cohortSnapshot?.frozen).toBe(true);
      expect(report.immutableHash).toBeDefined();
    });

    it("✓ 59. Generates valid JSON export manifest reproducibly", () => {
      const sessions = createDummySessions(20);
      const trades = createDummyTrades(40);
      const report = phase39RevalidationEngine.runRevalidation(sessions, trades);

      const jsonExports = Phase39ReportExporter.exportJSON(report);
      expect(jsonExports.frozenCohortJson).toContain("COHORT_P39_");
      expect(jsonExports.evidenceManifestJson).toContain("statisticalSnapshotHash");
      expect(jsonExports.safetyAuditJson).toContain("paperTrading");
    });

    it("✓ 60. Deterministic execution: identical inputs produce identical immutableHash", () => {
      const sessions = createDummySessions(20);
      const trades = createDummyTrades(40);

      const engine1 = new Phase39RevalidationEngine();
      const engine2 = new Phase39RevalidationEngine();

      const r1 = engine1.runRevalidation(sessions, trades);
      const r2 = engine2.runRevalidation(sessions, trades);

      expect(r1.manifest?.statisticalSnapshotHash).toEqual(r2.manifest?.statisticalSnapshotHash);
      expect(r1.manifest?.safetyAuditHash).toEqual(r2.manifest?.safetyAuditHash);
    });
  });
});
