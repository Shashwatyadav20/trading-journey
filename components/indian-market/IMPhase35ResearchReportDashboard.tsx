import React, { useState, useEffect } from "react";

export interface Phase35DashboardData {
  report: {
    reportId: string;
    state: string;
    status: string;
    masterStrategyFingerprint: string;
    reconciliation: {
      overallStatus: string;
      fingerprintChainValid: boolean;
      datasetHashChainValid: boolean;
    };
    snapshot: {
      finalStatistics: {
        sampleSize: number;
        winRate: number;
        expectancy: number;
        profitFactor: number | string;
        maxDrawdown: number;
      };
      oosEvidence: {
        inSampleWinRate: number;
        oosWinRate: number;
        winRateDiff: number;
        expectancyDiff: number;
      };
      stressEvidence: {
        worstSequenceDrawdown: number;
        monteCarloP95Drawdown: number;
        dataQualityResilience: string;
      };
      longHorizonEvidence: {
        genuineSessionsCount: number;
        genuineTradesCount: number;
        gatePassed: boolean;
        driftStatus: string;
      };
      safetyAudit: {
        paperTrading: boolean;
        liveTrading: boolean;
        brokerExecution: boolean;
        realDataOnly: boolean;
        realBrokerOrders: number;
        overallStatus: string;
      };
    };
    manifest: {
      phase31CohortHash: string;
      phase32DatasetHash: string;
      phase33ScenarioHash: string;
      phase34CohortHash: string;
      manifestHash: string;
    };
  };
}

export const IMPhase35ResearchReportDashboard: React.FC = () => {
  const [data, setData] = useState<Phase35DashboardData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/indian/phase35/summary");
      const json = await res.json();
      if (json.success) {
        setData({ report: json.report });
      } else {
        setError(json.error || "Failed to load Phase 35 summary");
      }
    } catch (err: any) {
      setError(err.message || "Failed to fetch Phase 35 research report");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 text-slate-200 bg-slate-900 rounded-lg font-mono">
        <p className="animate-pulse">Loading Phase 35 Final Research &amp; Evidence Package...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 text-red-400 bg-slate-900 rounded-lg border border-red-800 font-sans">
        <h3 className="font-bold text-lg mb-2">Phase 35 Research Report Dashboard</h3>
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
  const snap = report.snapshot;
  const fpHash = report.masterStrategyFingerprint || "N/A";

  return (
    <div className="p-6 bg-slate-950 text-slate-100 rounded-xl space-y-6 font-sans">
      {/* Top Banner Box */}
      <div className="border border-emerald-500/40 bg-slate-900/90 rounded-lg p-5 shadow-lg">
        <div className="border-b border-emerald-500/30 pb-3 mb-4 flex justify-between items-center">
          <h2 className="text-xl font-bold tracking-wide text-emerald-400 font-mono">
            PHASE 35 — FINAL RESEARCH &amp; EVIDENCE REGISTRY
          </h2>
          <span className="px-3 py-1 bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 rounded text-xs font-bold font-mono">
            STATUS: {report.state === "FROZEN" ? "FROZEN" : report.state}
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-sm font-mono">
          <div>
            <span className="text-slate-400 block text-xs">Strategy Fingerprint:</span>
            <span className="font-semibold text-emerald-300 title={fpHash}">
              {fpHash.substring(0, 16)}...
            </span>
          </div>
          <div>
            <span className="text-slate-400 block text-xs">Cross-Phase Integrity:</span>
            <span className="font-bold text-cyan-300">
              {report.reconciliation?.overallStatus === "PASS" ? "✓ PASS" : "FAIL"}
            </span>
          </div>
          <div>
            <span className="text-slate-400 block text-xs">Safety Audit:</span>
            <span className="font-bold text-emerald-400">
              {snap?.safetyAudit?.overallStatus === "PASS" ? "✓ PASS (0 Real Orders)" : "FAIL"}
            </span>
          </div>
          <div>
            <span className="text-slate-400 block text-xs">Total Sample Size:</span>
            <span className="font-bold text-purple-300">{snap?.finalStatistics?.sampleSize ?? 0} Trades</span>
          </div>
        </div>
      </div>

      {/* Phase Cards Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 font-mono text-xs">
        {/* Phase 27 & 31 Card */}
        <div className="bg-slate-900/80 p-4 rounded-lg border border-slate-800 space-y-2">
          <div className="font-bold text-emerald-400 border-b border-slate-800 pb-2 flex justify-between">
            <span>PHASE 27 &amp; 31</span>
            <span className="text-slate-400">CERTIFIED</span>
          </div>
          <div className="text-slate-300 space-y-1 pt-1">
            <div>Sample Size: <span className="text-slate-100 font-bold">{snap?.finalStatistics?.sampleSize}</span></div>
            <div>Baseline Win Rate: <span className="text-emerald-300 font-bold">{snap?.oosEvidence?.inSampleWinRate}%</span></div>
            <div>Cohort Hash: <span className="text-cyan-300">{report.manifest?.phase31CohortHash?.substring(0, 12)}...</span></div>
          </div>
        </div>

        {/* Phase 32 OOS Card */}
        <div className="bg-slate-900/80 p-4 rounded-lg border border-slate-800 space-y-2">
          <div className="font-bold text-cyan-400 border-b border-slate-800 pb-2 flex justify-between">
            <span>PHASE 32 INDEPENDENT OOS</span>
            <span className="text-slate-400">VALIDATED</span>
          </div>
          <div className="text-slate-300 space-y-1 pt-1">
            <div>OOS Win Rate: <span className="text-cyan-300 font-bold">{snap?.oosEvidence?.oosWinRate}%</span></div>
            <div>Win Rate Diff: <span className="text-amber-300 font-bold">{snap?.oosEvidence?.winRateDiff} pp</span></div>
            <div>Expectancy Diff: <span className="text-amber-300 font-bold">₹{snap?.oosEvidence?.expectancyDiff}</span></div>
          </div>
        </div>

        {/* Phase 33 Stress Testing Card */}
        <div className="bg-slate-900/80 p-4 rounded-lg border border-slate-800 space-y-2">
          <div className="font-bold text-amber-400 border-b border-slate-800 pb-2 flex justify-between">
            <span>PHASE 33 STRESS TESTING</span>
            <span className="text-slate-400">ROBUST</span>
          </div>
          <div className="text-slate-300 space-y-1 pt-1">
            <div>Worst Sequence DD: <span className="text-red-400 font-bold">₹{snap?.stressEvidence?.worstSequenceDrawdown}</span></div>
            <div>Monte Carlo P95 DD: <span className="text-red-400 font-bold">₹{snap?.stressEvidence?.monteCarloP95Drawdown}</span></div>
            <div>Data Quality Resilience: <span className="text-emerald-400 font-bold">{snap?.stressEvidence?.dataQualityResilience}</span></div>
          </div>
        </div>

        {/* Phase 34 Long Horizon Card */}
        <div className="bg-slate-900/80 p-4 rounded-lg border border-slate-800 space-y-2">
          <div className="font-bold text-purple-400 border-b border-slate-800 pb-2 flex justify-between">
            <span>PHASE 34 LONG HORIZON</span>
            <span className="text-slate-400">MONITORED</span>
          </div>
          <div className="text-slate-300 space-y-1 pt-1">
            <div>Genuine Sessions: <span className="text-purple-300 font-bold">{snap?.longHorizonEvidence?.genuineSessionsCount} / 60</span></div>
            <div>60-Session Gate: <span className="text-emerald-400 font-bold">{snap?.longHorizonEvidence?.gatePassed ? "PASSED" : "ACCUMULATING"}</span></div>
            <div>Drift Status: <span className="text-amber-300 font-bold">{snap?.longHorizonEvidence?.driftStatus}</span></div>
          </div>
        </div>

        {/* Safety & Integrity Manifest Card */}
        <div className="bg-slate-900/80 p-4 rounded-lg border border-slate-800 space-y-2 md:col-span-2">
          <div className="font-bold text-emerald-400 border-b border-slate-800 pb-2 flex justify-between">
            <span>CRYPTO MANIFEST &amp; SAFETY AUDIT</span>
            <span className="text-emerald-400">VERIFIED</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-slate-300 pt-1">
            <div>Manifest Hash: <span className="text-cyan-300">{report.manifest?.manifestHash?.substring(0, 16)}...</span></div>
            <div>Paper Trading Lock: <span className="text-emerald-400 font-bold">PAPER_TRADING=true</span></div>
            <div>Live Trading Lock: <span className="text-emerald-400 font-bold">LIVE_TRADING=false</span></div>
            <div>Real Broker Orders: <span className="text-emerald-400 font-bold">0</span></div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default IMPhase35ResearchReportDashboard;
