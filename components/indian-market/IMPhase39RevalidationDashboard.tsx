"use client";

import React, { useState, useEffect } from "react";

export interface Phase39DashboardData {
  report: {
    reportId: string;
    generatedAt: string;
    state: "WAITING_FOR_SAMPLE" | "REVALIDATION_RUNNING" | "REVALIDATION_FAILED" | "EVIDENCE_INCONCLUSIVE" | "EVIDENCE_VALIDATED" | "COHORT_FROZEN";
    sampleGate: {
      genuineSessions: number;
      requiredSessions: number;
      sessionsMet: boolean;
      genuineTrades: number;
      requiredTrades: number;
      tradesMet: boolean;
      activeSessions: number;
      requiredActiveSessions: number;
      activeSessionsMet: boolean;
      gatePassed: boolean;
    };
    cohortSnapshot: {
      cohortId: string;
      createdAt: string;
      sessionCount: number;
      tradeCount: number;
      activeSessionCount: number;
      strategyFingerprint: string;
      sourceEvidenceHash: string;
      frozen: boolean;
      frozenAt?: string;
    } | null;
    timestampAudit: {
      passed: boolean;
      verifiedCount: number;
      violations: string[];
    };
    leakageAudit: {
      passed: boolean;
      contaminationDetected: boolean;
      violations: string[];
    };
    pnlAudit: {
      passed: boolean;
      sumTradeNetPnL: number;
      sumDailyNetPnL: number;
      cumulativeNetPnL: number;
      maxDiscrepancy: number;
      status: "PASS" | "FAIL" | "DATA_UNAVAILABLE";
    };
    statisticalAudit: {
      passed: boolean;
      metrics: {
        winRate: number;
        expectancy: number;
        profitFactor: number;
        maxDrawdown: number;
        netPnL: number;
      };
      wilson95CI: { lower: number; upper: number };
      bootstrapCI: { lower: number; upper: number; mean: number };
    };
    oosAudit: {
      passed: boolean;
      isExpectancy: number;
      oosExpectancy: number;
      degradationPct: number;
      status: "STABLE" | "DEGRADED" | "INSUFFICIENT_DATA";
    };
    walkForwardAudit: {
      passed: boolean;
      overallStatus: "PASS" | "DEGRADED" | "INSUFFICIENT_DATA";
    };
    stressAudit: {
      passed: boolean;
      dataQualityResilience: "PASS" | "SAFE_BLOCK";
    };
    driftAudit: {
      status: "NO_MEASURABLE_DRIFT" | "MATERIAL_DRIFT" | "INSUFFICIENT_DATA";
      winRateDriftPct: number;
      expectancyDriftPct: number;
    };
    safetyAudit: {
      passed: boolean;
      paperTrading: boolean;
      liveTrading: boolean;
      brokerExecution: boolean;
      realDataOnly: boolean;
      realDhanOrders: number;
    };
    strategyFingerprintMatch: boolean;
    manifest: {
      cohortId: string;
      strategyFingerprint: string;
      statisticalSnapshotHash: string;
      safetyAuditHash: string;
      generatedAt: string;
      frozen: boolean;
    } | null;
    immutableHash: string;
  };
}

export const IMPhase39RevalidationDashboard: React.FC = () => {
  const [data, setData] = useState<Phase39DashboardData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/indian/phase39/report");
      const json = await res.json();
      if (json.success) {
        setData({ report: json.report });
      } else {
        setError(json.error || "Failed to load Phase 39 data");
      }
    } catch (err: any) {
      setError(err.message || "Failed to fetch Phase 39 status");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 text-slate-200 bg-slate-900 rounded-lg">
        <p className="animate-pulse font-mono">Loading Phase 39 Post-Sample Revalidation Engine...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 text-red-400 bg-slate-900 rounded-lg border border-red-800 font-sans">
        <h3 className="font-bold text-lg mb-2">Phase 39 Revalidation Dashboard</h3>
        <p>Error: {error || "No data available"}</p>
        <button
          onClick={fetchData}
          className="mt-4 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-100 rounded text-sm font-semibold"
        >
          Retry
        </button>
      </div>
    );
  }

  const { report } = data;
  const { sampleGate, cohortSnapshot, safetyAudit } = report;

  const stateColors: Record<string, string> = {
    WAITING_FOR_SAMPLE: "bg-amber-500/20 text-amber-300 border-amber-500/40",
    REVALIDATION_RUNNING: "bg-blue-500/20 text-blue-300 border-blue-500/40",
    REVALIDATION_FAILED: "bg-red-500/20 text-red-400 border-red-500/40",
    EVIDENCE_INCONCLUSIVE: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
    EVIDENCE_VALIDATED: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
    COHORT_FROZEN: "bg-purple-500/20 text-purple-300 border-purple-500/40 font-bold",
  };

  return (
    <div className="p-6 bg-slate-950 text-slate-100 rounded-xl space-y-6 font-sans">
      {/* Top Banner Box */}
      <div className="border border-purple-500/40 bg-slate-900/90 rounded-lg p-5 shadow-lg">
        <div className="border-b border-purple-500/30 pb-3 mb-4 flex justify-between items-center flex-wrap gap-2">
          <div>
            <h2 className="text-xl font-bold tracking-wide text-purple-400 font-mono">
              PHASE 39 — POST-SAMPLE REVALIDATION &amp; EVIDENCE FREEZE
            </h2>
            <p className="text-xs text-slate-400 mt-1 font-mono">
              Independent audit and freeze layer for genuine paper trading evidence
            </p>
          </div>
          <div className="flex items-center space-x-2">
            <span className={`px-3 py-1 rounded text-xs font-mono border ${stateColors[report.state] || "bg-slate-800 text-slate-300"}`}>
              STATE: {report.state}
            </span>
          </div>
        </div>

        {/* Safety Lock Invariant Bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-slate-950/80 p-3 rounded border border-slate-800 text-xs font-mono">
          <div>
            <span className="text-slate-400 block">PAPER_TRADING:</span>
            <span className="text-emerald-400 font-bold">{safetyAudit.paperTrading ? "✓ TRUE" : "FAIL"}</span>
          </div>
          <div>
            <span className="text-slate-400 block">LIVE_TRADING:</span>
            <span className="text-emerald-400 font-bold">{!safetyAudit.liveTrading ? "✓ FALSE (LOCKED)" : "FAIL"}</span>
          </div>
          <div>
            <span className="text-slate-400 block">BROKER_EXECUTION:</span>
            <span className="text-emerald-400 font-bold">{!safetyAudit.brokerExecution ? "✓ FALSE (LOCKED)" : "FAIL"}</span>
          </div>
          <div>
            <span className="text-slate-400 block">REAL_DHAN_ORDERS:</span>
            <span className="text-emerald-400 font-bold">{safetyAudit.realDhanOrders === 0 ? "✓ 0 ORDERS" : "FAIL"}</span>
          </div>
        </div>
      </div>

      {/* Genuine Sample Progress Gate */}
      <div className="bg-slate-900/80 rounded-lg p-5 border border-slate-800">
        <h3 className="text-lg font-semibold text-slate-200 mb-4 font-mono">1. Genuine Sample Gate</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono text-sm">
          <div className="bg-slate-950 p-4 rounded border border-slate-800 flex justify-between items-center">
            <div>
              <span className="text-slate-400 text-xs block">Genuine Sessions</span>
              <span className="text-lg font-bold text-slate-100">
                {sampleGate.genuineSessions} / {sampleGate.requiredSessions}
              </span>
            </div>
            <span className={`px-2 py-1 text-xs rounded font-bold ${sampleGate.sessionsMet ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-300"}`}>
              {sampleGate.sessionsMet ? "✓ MET" : "WAITING"}
            </span>
          </div>

          <div className="bg-slate-950 p-4 rounded border border-slate-800 flex justify-between items-center">
            <div>
              <span className="text-slate-400 text-xs block">Genuine Trades</span>
              <span className="text-lg font-bold text-slate-100">
                {sampleGate.genuineTrades} / {sampleGate.requiredTrades}
              </span>
            </div>
            <span className={`px-2 py-1 text-xs rounded font-bold ${sampleGate.tradesMet ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-300"}`}>
              {sampleGate.tradesMet ? "✓ MET" : "WAITING"}
            </span>
          </div>

          <div className="bg-slate-950 p-4 rounded border border-slate-800 flex justify-between items-center">
            <div>
              <span className="text-slate-400 text-xs block">Active Sessions</span>
              <span className="text-lg font-bold text-slate-100">
                {sampleGate.activeSessions} / {sampleGate.requiredActiveSessions}
              </span>
            </div>
            <span className={`px-2 py-1 text-xs rounded font-bold ${sampleGate.activeSessionsMet ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-300"}`}>
              {sampleGate.activeSessionsMet ? "✓ MET" : "WAITING"}
            </span>
          </div>
        </div>
      </div>

      {/* Audit Matrix & Verification */}
      <div className="bg-slate-900/80 rounded-lg p-5 border border-slate-800">
        <h3 className="text-lg font-semibold text-slate-200 mb-4 font-mono">2. Independent Revalidation Audit Matrix</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 font-mono text-xs">
          <div className="bg-slate-950 p-3 rounded border border-slate-800 flex justify-between items-center">
            <span>Timestamp Sequence &amp; Look-ahead Audit:</span>
            <span className={`font-bold px-2 py-0.5 rounded ${report.timestampAudit.passed ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
              {report.timestampAudit.passed ? "✓ PASS" : "FAIL"}
            </span>
          </div>

          <div className="bg-slate-950 p-3 rounded border border-slate-800 flex justify-between items-center">
            <span>Leakage &amp; Data Contamination Audit:</span>
            <span className={`font-bold px-2 py-0.5 rounded ${report.leakageAudit.passed ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
              {report.leakageAudit.passed ? "✓ PASS" : "FAIL"}
            </span>
          </div>

          <div className="bg-slate-950 p-3 rounded border border-slate-800 flex justify-between items-center">
            <span>P&amp;L Multi-level Reconciliation:</span>
            <span className={`font-bold px-2 py-0.5 rounded ${report.pnlAudit.status === "PASS" ? "bg-emerald-500/20 text-emerald-400" : report.pnlAudit.status === "DATA_UNAVAILABLE" ? "bg-slate-800 text-slate-400" : "bg-red-500/20 text-red-400"}`}>
              {report.pnlAudit.status}
            </span>
          </div>

          <div className="bg-slate-950 p-3 rounded border border-slate-800 flex justify-between items-center">
            <span>Strategy Fingerprint Stability:</span>
            <span className={`font-bold px-2 py-0.5 rounded ${report.strategyFingerprintMatch ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
              {report.strategyFingerprintMatch ? "✓ MATCHED" : "INVALIDATED"}
            </span>
          </div>

          <div className="bg-slate-950 p-3 rounded border border-slate-800 flex justify-between items-center">
            <span>Out-Of-Sample (OOS) Revalidation:</span>
            <span className="font-bold px-2 py-0.5 rounded bg-slate-800 text-cyan-300">
              {report.oosAudit.status}
            </span>
          </div>

          <div className="bg-slate-950 p-3 rounded border border-slate-800 flex justify-between items-center">
            <span>Walk-Forward Window Audit:</span>
            <span className="font-bold px-2 py-0.5 rounded bg-slate-800 text-cyan-300">
              {report.walkForwardAudit.overallStatus}
            </span>
          </div>

          <div className="bg-slate-950 p-3 rounded border border-slate-800 flex justify-between items-center">
            <span>Stress Testing Resilience:</span>
            <span className="font-bold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400">
              ✓ {report.stressAudit.dataQualityResilience}
            </span>
          </div>

          <div className="bg-slate-950 p-3 rounded border border-slate-800 flex justify-between items-center">
            <span>Long-Horizon Drift Analysis:</span>
            <span className="font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-300">
              {report.driftAudit.status}
            </span>
          </div>
        </div>
      </div>

      {/* Cohort Snapshot & Reproducible Manifest */}
      <div className="bg-slate-900/80 rounded-lg p-5 border border-slate-800">
        <h3 className="text-lg font-semibold text-slate-200 mb-4 font-mono">3. Cohort Snapshot &amp; Immutable Manifest</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
          <div className="bg-slate-950 p-4 rounded border border-slate-800 space-y-2">
            <div className="text-purple-400 font-bold">COHORT SNAPSHOT DETAILS</div>
            <div><span className="text-slate-400">Cohort ID:</span> {cohortSnapshot?.cohortId || "WAITING_FOR_FREEZE"}</div>
            <div><span className="text-slate-400">Frozen:</span> {cohortSnapshot?.frozen ? `✓ YES (${cohortSnapshot.frozenAt})` : "NO"}</div>
            <div><span className="text-slate-400">Sessions Captured:</span> {cohortSnapshot?.sessionCount || 0}</div>
            <div><span className="text-slate-400">Trades Captured:</span> {cohortSnapshot?.tradeCount || 0}</div>
          </div>

          <div className="bg-slate-950 p-4 rounded border border-slate-800 space-y-2">
            <div className="text-purple-400 font-bold">IMMUTABLE REPRODUCIBILITY HASH</div>
            <div>
              <span className="text-slate-400 block text-[10px]">Report SHA-256 Hash:</span>
              <span className="text-emerald-400 break-all">{report.immutableHash || "N/A"}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px]">Strategy Fingerprint:</span>
              <span className="text-slate-200 break-all">{cohortSnapshot?.strategyFingerprint || "N/A"}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default IMPhase39RevalidationDashboard;
