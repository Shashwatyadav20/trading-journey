import React, { useState, useEffect } from "react";

export interface Phase33DashboardData {
  report: {
    reportId: string;
    state: string;
    status: string;
    masterStrategyFingerprint: string;
    slippageStress: Array<{
      scenarioId: string;
      name: string;
      severity: string;
      originalNetPnL: number;
      stressedNetPnL: number;
      netPnLDiff: number;
      originalExpectancy: number;
      stressedExpectancy: number;
      expectancyDiff: number;
      originalMaxDrawdown: number;
      stressedMaxDrawdown: number;
    }>;
    sequenceStress: Array<{
      scenarioId: string;
      name: string;
      order: string;
      maxDrawdown: number;
      longestLosingStreak: number;
      recoveryFactor: number | string;
    }>;
    tailLossStress: Array<{
      scenarioId: string;
      name: string;
      target: string;
      originalNetPnL: number;
      stressedNetPnL: number;
      originalMaxDrawdown: number;
      stressedMaxDrawdown: number;
    }>;
    dataQualityStress: Array<{
      scenarioId: string;
      name: string;
      condition: string;
      actualBehavior: string;
      passed: boolean;
      blockedReason: string;
    }>;
    monteCarloDiagnostic: {
      iterations: number;
      maxDrawdownDistribution: { mean: number; p95: number; worst: number };
      finalPnlDistribution: { mean: number; p5: number; worst: number };
      longestLosingStreakDistribution: { mean: number; max: number };
      probabilityOfNegativeEndingPnlPct: number;
    };
    scorecard: {
      slippageSensitivity: string;
      delaySensitivity: string;
      sequenceSensitivity: string;
      tailLossSensitivity: string;
      dataQualityResilience: string;
      overallRobustnessGrade: string;
    };
  };
}

export const IMPhase33RobustnessDashboard: React.FC = () => {
  const [data, setData] = useState<Phase33DashboardData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/indian/phase33/summary");
      const json = await res.json();
      if (json.success) {
        setData({ report: json.report });
      } else {
        setError(json.error || "Failed to load Phase 33 data");
      }
    } catch (err: any) {
      setError(err.message || "Failed to fetch Phase 33 status");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 text-slate-200 bg-slate-900 rounded-lg">
        <p className="animate-pulse font-mono">Loading Phase 33 Robustness &amp; Stress Testing Engine...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 text-red-400 bg-slate-900 rounded-lg border border-red-800 font-sans">
        <h3 className="font-bold text-lg mb-2">Phase 33 Robustness Dashboard</h3>
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
  const grade = report.scorecard?.overallRobustnessGrade || "MODERATE";
  const fpHash = report.masterStrategyFingerprint || "N/A";
  const status = report.status;

  return (
    <div className="p-6 bg-slate-950 text-slate-100 rounded-xl space-y-6 font-sans">
      {/* Top Banner Box */}
      <div className="border border-indigo-500/40 bg-slate-900/90 rounded-lg p-5 shadow-lg">
        <div className="border-b border-indigo-500/30 pb-3 mb-4 flex justify-between items-center">
          <h2 className="text-xl font-bold tracking-wide text-indigo-400 font-mono">
            PHASE 33 — ROBUSTNESS &amp; STRESS TESTING ENGINE
          </h2>
          <span className={`px-3 py-1 rounded text-xs font-bold font-mono ${
            grade === "ROBUST" ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40" :
            grade === "MODERATE" ? "bg-amber-500/20 text-amber-400 border border-amber-500/40" :
            "bg-red-500/20 text-red-400 border border-red-500/40"
          }`}>
            GRADE: {grade}
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-sm font-mono">
          <div>
            <span className="text-slate-400 block text-xs">Strategy Lock:</span>
            <span className="font-semibold text-emerald-300 title={fpHash}">
              {fpHash.substring(0, 16)}...
            </span>
          </div>
          <div>
            <span className="text-slate-400 block text-xs">Status:</span>
            <span className="font-bold text-cyan-300">{status}</span>
          </div>
          <div>
            <span className="text-slate-400 block text-xs">Monte Carlo Iterations:</span>
            <span className="font-semibold text-slate-200">{report.monteCarloDiagnostic?.iterations ?? 1000}</span>
          </div>
          <div>
            <span className="text-slate-400 block text-xs">Data Quality Gate:</span>
            <span className="font-bold text-emerald-400">
              {report.scorecard?.dataQualityResilience === "PASS" ? "✓ ALL SAFE_BLOCK" : "FAIL"}
            </span>
          </div>
        </div>
      </div>

      {/* Slippage & Execution Cost Stress Table */}
      <div className="bg-slate-900/80 rounded-lg p-5 border border-slate-800">
        <h3 className="text-lg font-semibold text-slate-200 mb-4">Slippage &amp; Execution Cost Stress</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm font-mono border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/50">
                <th className="p-3">Scenario</th>
                <th className="p-3">Severity</th>
                <th className="p-3">Original Net P&amp;L</th>
                <th className="p-3">Stressed Net P&amp;L</th>
                <th className="p-3">Net P&amp;L Diff</th>
                <th className="p-3">Stressed Expectancy</th>
                <th className="p-3">Stressed Max DD</th>
              </tr>
            </thead>
            <tbody>
              {report.slippageStress?.map((row) => (
                <tr key={row.scenarioId} className="border-b border-slate-800/60 hover:bg-slate-800/30">
                  <td className="p-3 font-medium text-slate-300">{row.name}</td>
                  <td className="p-3 text-xs">
                    <span className={`px-2 py-0.5 rounded ${
                      row.severity === "BASELINE" ? "bg-slate-800 text-slate-300" :
                      row.severity === "MODERATE" ? "bg-amber-500/20 text-amber-300" :
                      row.severity === "SEVERE" ? "bg-orange-500/20 text-orange-300" :
                      "bg-red-500/20 text-red-400"
                    }`}>
                      {row.severity}
                    </span>
                  </td>
                  <td className="p-3 text-slate-300">₹{row.originalNetPnL}</td>
                  <td className="p-3 text-cyan-300">₹{row.stressedNetPnL}</td>
                  <td className="p-3 text-amber-300">₹{row.netPnLDiff}</td>
                  <td className="p-3 text-emerald-400">₹{row.stressedExpectancy}</td>
                  <td className="p-3 text-red-400">₹{row.stressedMaxDrawdown}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Sequence Stress & Permutation Analysis */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-slate-900/80 rounded-lg p-5 border border-slate-800">
          <h3 className="text-lg font-semibold text-slate-200 mb-4">P&amp;L Sequence Stress</h3>
          <div className="space-y-3 font-mono text-sm">
            {report.sequenceStress?.map((seq) => (
              <div key={seq.scenarioId} className="bg-slate-950/60 p-3 rounded border border-slate-800 flex justify-between items-center">
                <div>
                  <div className="font-semibold text-slate-200">{seq.name}</div>
                  <div className="text-xs text-slate-400">Order: {seq.order}</div>
                </div>
                <div className="text-right text-xs">
                  <div className="text-red-400 font-bold">Max DD: ₹{seq.maxDrawdown}</div>
                  <div className="text-amber-300">Max Streak: {seq.longestLosingStreak} losses</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Tail-Loss Stress */}
        <div className="bg-slate-900/80 rounded-lg p-5 border border-slate-800">
          <h3 className="text-lg font-semibold text-slate-200 mb-4">Tail-Loss &amp; Loss Clustering</h3>
          <div className="space-y-3 font-mono text-sm">
            {report.tailLossStress?.map((tail) => (
              <div key={tail.scenarioId} className="bg-slate-950/60 p-3 rounded border border-slate-800 flex justify-between items-center">
                <div>
                  <div className="font-semibold text-slate-200">{tail.name}</div>
                  <div className="text-xs text-slate-400">Target: {tail.target}</div>
                </div>
                <div className="text-right text-xs">
                  <div className="text-cyan-300">Stressed P&amp;L: ₹{tail.stressedNetPnL}</div>
                  <div className="text-red-400">Stressed DD: ₹{tail.stressedMaxDrawdown}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Data Quality Stress Verification */}
      <div className="bg-slate-900/80 rounded-lg p-5 border border-slate-800">
        <h3 className="text-lg font-semibold text-slate-200 mb-4">Data Quality Stress Resilience</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 font-mono text-xs">
          {report.dataQualityStress?.map((dq) => (
            <div key={dq.scenarioId} className="p-3 bg-slate-950/60 rounded border border-slate-800 flex justify-between items-center">
              <div>
                <span className="font-bold text-slate-200">{dq.name}</span>
                <span className="block text-slate-400 text-[10px] mt-0.5">{dq.blockedReason}</span>
              </div>
              <span className="px-2 py-1 rounded bg-emerald-500/20 text-emerald-400 font-bold text-xs border border-emerald-500/30">
                ✓ {dq.actualBehavior}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default IMPhase33RobustnessDashboard;
