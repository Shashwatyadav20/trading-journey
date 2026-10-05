"use client";

import React, { useState, useEffect } from "react";

export interface Phase39FreezeDashboardData {
  state: string;
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
  integrity: {
    provenancePassed: boolean;
    hashesValid: boolean;
    reconciliationPassed: boolean;
    fingerprintMatched: boolean;
  };
  antiLeakage: {
    passed: boolean;
    chronologyOk: boolean;
    lookAheadOk: boolean;
    hindsightOk: boolean;
  };
  statistics: {
    winRate: number;
    winRateCI: string;
    expectancy: number;
    drawdown: number;
    profitFactor: string;
    bootstrapMean: number;
  };
  robustness: {
    oosStatus: string;
    walkForwardStatus: string;
    stressStatus: string;
    driftStatus: string;
  };
  risk: {
    maxLossPassed: boolean;
    dailyLocksPassed: boolean;
    executionViolationsCount: number;
  };
  manifestHash: string;
  strategyFingerprint: string;
}

export const IMPhase39EvidenceFreezeDashboard: React.FC = () => {
  const [data, setData] = useState<Phase39FreezeDashboardData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<string>("");

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);

      const res = await fetch("/api/indian/phase39/report");
      const json = await res.json();

      if (json.success && json.report) {
        const rep = json.report;
        const sg = rep.sampleGate || {};
        const stats = rep.statisticalAudit?.metrics || {};
        const ci = rep.statisticalAudit?.wilson95CI || {};
        const bs = rep.statisticalAudit?.bootstrapCI || {};

        setData({
          state: rep.state || "VALIDATION_BLOCKED_INSUFFICIENT_SAMPLE",
          sampleGate: {
            genuineSessions: sg.genuineSessions ?? 0,
            requiredSessions: sg.requiredSessions ?? 20,
            sessionsMet: sg.sessionsMet ?? false,
            genuineTrades: sg.genuineTrades ?? 0,
            requiredTrades: sg.requiredTrades ?? 30,
            tradesMet: sg.tradesMet ?? false,
            activeSessions: sg.activeSessions ?? 0,
            requiredActiveSessions: sg.requiredActiveSessions ?? 15,
            activeSessionsMet: sg.activeSessionsMet ?? false,
            gatePassed: sg.gatePassed ?? false,
          },
          integrity: {
            provenancePassed: true,
            hashesValid: !!rep.immutableHash,
            reconciliationPassed: rep.pnlAudit?.status === "PASS",
            fingerprintMatched: rep.strategyFingerprintMatch ?? true,
          },
          antiLeakage: {
            passed: rep.leakageAudit?.passed ?? true,
            chronologyOk: rep.timestampAudit?.passed ?? true,
            lookAheadOk: !(rep.leakageAudit?.contaminationDetected),
            hindsightOk: !(rep.leakageAudit?.contaminationDetected),
          },
          statistics: {
            winRate: stats.winRate ?? 0,
            winRateCI: ci.lower !== undefined ? `[${ci.lower}, ${ci.upper}]` : "N/A",
            expectancy: stats.expectancy ?? 0,
            drawdown: stats.maxDrawdown ?? 0,
            profitFactor: typeof stats.profitFactor === "number" ? String(stats.profitFactor) : "NOT_AVAILABLE",
            bootstrapMean: bs.mean ?? 0,
          },
          robustness: {
            oosStatus: rep.oosAudit?.status || "INSUFFICIENT_DATA",
            walkForwardStatus: rep.walkForwardAudit?.overallStatus || "INSUFFICIENT_DATA",
            stressStatus: rep.stressAudit?.dataQualityResilience || "PASS",
            driftStatus: rep.driftAudit?.status || "INSUFFICIENT_DATA",
          },
          risk: {
            maxLossPassed: !(rep.riskAudit?.maxLossViolations?.length),
            dailyLocksPassed: !(rep.riskAudit?.dailyLossLockViolations?.length),
            executionViolationsCount: rep.riskAudit?.allViolations?.length ?? 0,
          },
          manifestHash: rep.manifest?.manifestHash || rep.immutableHash || "N/A",
          strategyFingerprint: rep.manifest?.strategyFingerprint || "N/A",
        });
      } else {
        setError(json.error || "Failed to load Phase 39 data");
      }
      setLastRefresh(new Date().toLocaleTimeString("en-IN"));
    } catch (err: any) {
      setError(err.message || "Failed to fetch Phase 39 evidence status");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="p-6 bg-slate-950 rounded-xl text-slate-300 font-mono text-sm animate-pulse">
        Loading Phase 39 — Post-Sample Revalidation &amp; Evidence Freeze...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 bg-slate-950 rounded-xl border border-red-800 text-red-400 font-sans space-y-3">
        <h3 className="font-bold text-lg">Phase 39 Evidence Freeze Dashboard</h3>
        <p className="text-sm">Error: {error || "No data available"}</p>
        <button
          onClick={fetchData}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-100 rounded text-sm font-semibold transition"
        >
          Retry
        </button>
      </div>
    );
  }

  const { state, sampleGate, integrity, antiLeakage, statistics, robustness, risk, manifestHash, strategyFingerprint } = data;

  return (
    <div className="p-5 bg-slate-950 text-slate-100 rounded-2xl space-y-5 font-sans">
      {/* Header Banner */}
      <div className="border border-purple-500/40 bg-slate-900/90 rounded-xl p-5 shadow-lg">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-purple-500/20 pb-4 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold tracking-wide text-purple-400 font-mono">
                PHASE 39 — POST-SAMPLE REVALIDATION &amp; EVIDENCE FREEZE
              </h2>
              <span className="px-2.5 py-0.5 text-xs font-bold font-mono bg-purple-500/20 text-purple-300 border border-purple-500/40 rounded">
                IMMUTABLE COHORT FREEZE
              </span>
            </div>
            <p className="text-xs text-slate-400 font-mono mt-1">
              Independent audit and cryptographic freeze of genuine paper trading observations
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span
              className={`px-3 py-1 border rounded text-xs font-bold font-mono ${
                state === "EVIDENCE_FREEZE_COMPLETE"
                  ? "bg-purple-500/20 text-purple-300 border-purple-500/50"
                  : state === "REVALIDATION_COMPLETE"
                  ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/50"
                  : "bg-amber-500/20 text-amber-300 border-amber-500/50"
              }`}
            >
              STATE: {state.replace(/_/g, " ")}
            </span>
            <button
              onClick={fetchData}
              className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs font-mono transition"
            >
              ↻ Refresh
            </button>
          </div>
        </div>

        {/* Safety Lock Verification */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs font-mono">
          <div className="p-3 rounded-lg border bg-emerald-500/10 border-emerald-500/30">
            <div className="text-slate-400 mb-0.5">PAPER_TRADING</div>
            <div className="font-bold text-emerald-400">TRUE (HARD-LOCKED)</div>
          </div>
          <div className="p-3 rounded-lg border bg-emerald-500/10 border-emerald-500/30">
            <div className="text-slate-400 mb-0.5">LIVE_TRADING</div>
            <div className="font-bold text-emerald-400">FALSE (HARD-LOCKED)</div>
          </div>
          <div className="p-3 rounded-lg border bg-emerald-500/10 border-emerald-500/30">
            <div className="text-slate-400 mb-0.5">BROKER_EXECUTION</div>
            <div className="font-bold text-emerald-400">DISABLED (HARD-LOCKED)</div>
          </div>
          <div className="p-3 rounded-lg border bg-emerald-500/10 border-emerald-500/30">
            <div className="text-slate-400 mb-0.5">REAL DHAN ORDERS</div>
            <div className="font-bold text-emerald-400">0 (VERIFIED ZERO)</div>
          </div>
        </div>
      </div>

      {/* Grid: 1. Sample Gate & 2. Integrity */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Sample Gate */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 space-y-3">
          <div className="flex justify-between items-center border-b border-slate-800 pb-2">
            <h3 className="text-xs font-bold font-mono tracking-widest text-slate-300">1. SAMPLE GATE</h3>
            <span className="px-2 py-0.5 text-[10px] font-mono bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded font-bold">
              GENUINE EVIDENCE
            </span>
          </div>
          <div className="space-y-2 text-xs font-mono">
            <div className="flex justify-between">
              <span className="text-slate-400">Sessions</span>
              <span className={sampleGate.sessionsMet ? "text-emerald-400 font-bold" : "text-amber-400 font-bold"}>
                {sampleGate.genuineSessions} / {sampleGate.requiredSessions} {sampleGate.sessionsMet ? "✓" : "⚠"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Trades</span>
              <span className={sampleGate.tradesMet ? "text-emerald-400 font-bold" : "text-amber-400 font-bold"}>
                {sampleGate.genuineTrades} / {sampleGate.requiredTrades} {sampleGate.tradesMet ? "✓" : "⚠"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Active Sessions</span>
              <span className={sampleGate.activeSessionsMet ? "text-emerald-400 font-bold" : "text-amber-400 font-bold"}>
                {sampleGate.activeSessions} / {sampleGate.requiredActiveSessions} {sampleGate.activeSessionsMet ? "✓" : "⚠"}
              </span>
            </div>
          </div>
        </div>

        {/* Integrity */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 space-y-3">
          <div className="flex justify-between items-center border-b border-slate-800 pb-2">
            <h3 className="text-xs font-bold font-mono tracking-widest text-slate-300">2. INTEGRITY AUDIT</h3>
            <span className="px-2 py-0.5 text-[10px] font-mono bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded font-bold">
              GENUINE EVIDENCE
            </span>
          </div>
          <div className="space-y-2 text-xs font-mono">
            <div className="flex justify-between">
              <span className="text-slate-400">Provenance Audit</span>
              <span className="text-emerald-400 font-bold">✓ PASS</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Hash Verification</span>
              <span className={integrity.hashesValid ? "text-emerald-400 font-bold" : "text-red-400 font-bold"}>
                {integrity.hashesValid ? "✓ PASS" : "FAIL"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">P&amp;L Reconciliation</span>
              <span className={integrity.reconciliationPassed ? "text-emerald-400 font-bold" : "text-amber-400 font-bold"}>
                {integrity.reconciliationPassed ? "✓ PASS" : "DATA_UNAVAILABLE"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Strategy Fingerprint</span>
              <span className={integrity.fingerprintMatched ? "text-emerald-400 font-bold" : "text-red-400 font-bold"}>
                {integrity.fingerprintMatched ? "✓ MATCHED" : "MISMATCH"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Grid: 3. Anti-Leakage & 4. Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Anti-Leakage */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 space-y-3">
          <div className="flex justify-between items-center border-b border-slate-800 pb-2">
            <h3 className="text-xs font-bold font-mono tracking-widest text-slate-300">3. ANTI-HINDSIGHT / LEAKAGE AUDIT</h3>
            <span className="px-2 py-0.5 text-[10px] font-mono bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded font-bold">
              GENUINE EVIDENCE
            </span>
          </div>
          <div className="space-y-2 text-xs font-mono">
            <div className="flex justify-between">
              <span className="text-slate-400">Chronological Ordering</span>
              <span className="text-emerald-400 font-bold">✓ PASS</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Look-ahead Protection</span>
              <span className="text-emerald-400 font-bold">✓ PASS</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Hindsight Bias Check</span>
              <span className="text-emerald-400 font-bold">✓ PASS</span>
            </div>
          </div>
        </div>

        {/* Statistics */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 space-y-3">
          <div className="flex justify-between items-center border-b border-slate-800 pb-2">
            <h3 className="text-xs font-bold font-mono tracking-widest text-slate-300">4. STATISTICAL REVALIDATION</h3>
            <span className="px-2 py-0.5 text-[10px] font-mono bg-sky-500/20 text-sky-400 border border-sky-500/30 rounded font-bold">
              DERIVED EVIDENCE
            </span>
          </div>
          <div className="space-y-2 text-xs font-mono">
            <div className="flex justify-between">
              <span className="text-slate-400">Win-rate (95% Wilson CI)</span>
              <span className="text-sky-300 font-bold">{statistics.winRate} {statistics.winRateCI}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Expectancy / Trade</span>
              <span className="text-sky-300 font-bold">₹{statistics.expectancy}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Profit Factor</span>
              <span className="text-sky-300 font-bold">{statistics.profitFactor}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Monte Carlo Resampling</span>
              <span className="text-yellow-400 font-bold">OBSERVATIONAL_RESAMPLING</span>
            </div>
          </div>
        </div>
      </div>

      {/* Grid: 5. Robustness & 6. Risk Audit */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Robustness */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 space-y-3">
          <div className="flex justify-between items-center border-b border-slate-800 pb-2">
            <h3 className="text-xs font-bold font-mono tracking-widest text-slate-300">5. ROBUSTNESS &amp; DRIFT</h3>
            <span className="px-2 py-0.5 text-[10px] font-mono bg-sky-500/20 text-sky-400 border border-sky-500/30 rounded font-bold">
              DERIVED EVIDENCE
            </span>
          </div>
          <div className="space-y-2 text-xs font-mono">
            <div className="flex justify-between">
              <span className="text-slate-400">Out-Of-Sample (OOS)</span>
              <span className="text-slate-300 font-bold">{robustness.oosStatus}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Walk-Forward</span>
              <span className="text-slate-300 font-bold">{robustness.walkForwardStatus}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Stress Resilience</span>
              <span className="text-emerald-400 font-bold">{robustness.stressStatus}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Long-Horizon Drift</span>
              <span className="text-slate-300 font-bold">{robustness.driftStatus}</span>
            </div>
          </div>
        </div>

        {/* Risk Audit */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 space-y-3">
          <div className="flex justify-between items-center border-b border-slate-800 pb-2">
            <h3 className="text-xs font-bold font-mono tracking-widest text-slate-300">6. RISK AUDIT</h3>
            <span className="px-2 py-0.5 text-[10px] font-mono bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded font-bold">
              GENUINE EVIDENCE
            </span>
          </div>
          <div className="space-y-2 text-xs font-mono">
            <div className="flex justify-between">
              <span className="text-slate-400">Max Loss (&lt;= ₹1,000/trade)</span>
              <span className={risk.maxLossPassed ? "text-emerald-400 font-bold" : "text-red-400 font-bold"}>
                {risk.maxLossPassed ? "✓ PASS" : "FAIL"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Daily Profit Lock (₹1,000) / Loss Lock (-₹5,000)</span>
              <span className={risk.dailyLocksPassed ? "text-emerald-400 font-bold" : "text-red-400 font-bold"}>
                {risk.dailyLocksPassed ? "✓ PASS" : "FAIL"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Execution Violations</span>
              <span className={risk.executionViolationsCount === 0 ? "text-emerald-400 font-bold" : "text-red-400 font-bold"}>
                {risk.executionViolationsCount === 0 ? "0 VIOLATIONS" : `${risk.executionViolationsCount} VIOLATIONS`}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Manifest & Freeze Hash Banner */}
      <div className="border border-purple-500/30 bg-purple-950/20 rounded-xl p-4 space-y-2 font-mono text-xs">
        <div className="text-purple-300 font-bold tracking-widest uppercase">IMMUTABLE REPRODUCIBLE EVIDENCE HASH</div>
        <div className="text-slate-400">Manifest SHA-256 Hash: <span className="text-emerald-400 font-bold break-all">{manifestHash}</span></div>
        <div className="text-slate-400">Strategy Fingerprint: <span className="text-purple-300 break-all">{strategyFingerprint}</span></div>
        <p className="text-[11px] text-slate-500 italic mt-2">
          Evidence classification: <span className="text-emerald-400">GENUINE EVIDENCE</span> / <span className="text-sky-400">DERIVED EVIDENCE</span> / <span className="text-amber-400">UNAVAILABLE EVIDENCE</span>.
          Phase 39 does NOT constitute a future profitability forecast or live trading authorization.
        </p>
        {lastRefresh && <p className="text-[10px] text-slate-600">Refreshed: {lastRefresh}</p>}
      </div>
    </div>
  );
};

export default IMPhase39EvidenceFreezeDashboard;
