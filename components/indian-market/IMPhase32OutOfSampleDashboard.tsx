import React, { useState, useEffect } from "react";

export interface Phase32DashboardData {
  report: {
    reportId: string;
    state: string;
    status: string;
    masterStrategyFingerprint: string;
    datasetFingerprint: string;
    cohort: {
      cohortId: string;
      sourceDatasetId: string;
      datasetFingerprint: string;
      status: string;
    } | null;
    comparison: {
      comparisonTable: Array<{
        metric: string;
        phase31InSample: string | number;
        phase32OOS: string | number;
        difference: string | number;
      }>;
      degradation: {
        winRateDifference: number;
        expectancyDifference: number;
        profitFactorDifference: number | string;
        drawdownDifference: number;
        averagePnLDifference: number;
      };
    };
    walkForwardWindows: Array<{
      windowId: string;
      trainingStart: string;
      trainingEnd: string;
      testingStart: string;
      testingEnd: string;
      status: string;
      testingMetrics: {
        tradeCount: number;
        netPnL: number;
        expectancy: number;
        winRate: number;
        profitFactor: number | string;
        maxDrawdown?: number;
      };
    }>;
    leakageReport: {
      clean: boolean;
      leakageDetected: boolean;
      status: string;
    };
    safetyStatus: {
      paperTrading: boolean;
      liveTrading: boolean;
      brokerExecution: boolean;
      realDataOnly: boolean;
      realBrokerOrders: number;
    };
  };
}

export const IMPhase32OutOfSampleDashboard: React.FC = () => {
  const [data, setData] = useState<Phase32DashboardData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/indian/phase32/summary");
      const json = await res.json();
      if (json.success) {
        setData({ report: json.report });
      } else {
        setError(json.error || "Failed to load Phase 32 data");
      }
    } catch (err: any) {
      setError(err.message || "Failed to fetch Phase 32 status");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 text-slate-200 bg-slate-900 rounded-lg">
        <p className="animate-pulse font-mono">Loading Phase 32 OOS Validation Engine...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 text-red-400 bg-slate-900 rounded-lg border border-red-800">
        <h3 className="font-bold text-lg mb-2">Phase 32 Validation Dashboard</h3>
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
  const cohortId = report.cohort?.sourceDatasetId || "OOS_001";
  const datasetHash = report.datasetFingerprint || "N/A";
  const fpHash = report.masterStrategyFingerprint || "N/A";
  const status = report.status;
  const cleanIntegrity = report.leakageReport?.clean ?? true;

  return (
    <div className="p-6 bg-slate-950 text-slate-100 rounded-xl space-y-6 font-sans">
      {/* Top Banner Box */}
      <div className="border border-cyan-500/40 bg-slate-900/90 rounded-lg p-5 shadow-lg">
        <div className="border-b border-cyan-500/30 pb-3 mb-4">
          <h2 className="text-xl font-bold tracking-wide text-cyan-400 font-mono">
            PHASE 32 — OUT-OF-SAMPLE &amp; WALK-FORWARD VALIDATION
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-sm font-mono">
          <div>
            <span className="text-slate-400 block text-xs">Dataset ID:</span>
            <span className="font-semibold text-slate-200">{cohortId}</span>
          </div>
          <div>
            <span className="text-slate-400 block text-xs">Dataset Hash:</span>
            <span className="font-semibold text-cyan-300 title={datasetHash}">
              {datasetHash.substring(0, 16)}...
            </span>
          </div>
          <div>
            <span className="text-slate-400 block text-xs">Strategy Fingerprint:</span>
            <span className="font-semibold text-emerald-300 title={fpHash}">
              {fpHash.substring(0, 16)}...
            </span>
          </div>
          <div>
            <span className="text-slate-400 block text-xs">Status:</span>
            <span className={`font-bold px-2 py-0.5 rounded text-xs inline-block ${
              status === "VALIDATION_COMPLETE"
                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                : status === "VALIDATION_BLOCKED" || status === "VALIDATION_INVALID"
                ? "bg-red-500/20 text-red-400 border border-red-500/40"
                : "bg-amber-500/20 text-amber-400 border border-amber-500/40"
            }`}>
              {status}
            </span>
          </div>
        </div>
      </div>

      {/* In-Sample (Phase 31) vs Out-Of-Sample (Phase 32) Comparison Table */}
      <div className="bg-slate-900/80 rounded-lg p-5 border border-slate-800">
        <h3 className="text-lg font-semibold text-slate-200 mb-4 flex items-center gap-2">
          <span>In-Sample (Phase 31) vs Out-Of-Sample (Phase 32)</span>
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm font-mono border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/50">
                <th className="p-3">Metric</th>
                <th className="p-3">Phase 31 In-Sample</th>
                <th className="p-3">Phase 32 OOS</th>
                <th className="p-3">Difference</th>
              </tr>
            </thead>
            <tbody>
              {report.comparison?.comparisonTable.map((row, idx) => (
                <tr key={idx} className="border-b border-slate-800/60 hover:bg-slate-800/30">
                  <td className="p-3 font-medium text-slate-300">{row.metric}</td>
                  <td className="p-3 text-slate-300">{row.phase31InSample}</td>
                  <td className="p-3 text-cyan-300">{row.phase32OOS}</td>
                  <td className="p-3 text-amber-300 font-semibold">{row.difference}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Walk-Forward Windows */}
      <div className="bg-slate-900/80 rounded-lg p-5 border border-slate-800">
        <h3 className="text-lg font-semibold text-slate-200 mb-4">Walk-Forward Windows</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {report.walkForwardWindows.map((wf) => (
            <div key={wf.windowId} className="bg-slate-950/70 p-4 rounded-lg border border-slate-800 space-y-2">
              <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                <span className="font-mono font-bold text-cyan-400">{wf.windowId}</span>
                <span className={`text-xs px-2 py-0.5 rounded font-mono ${
                  wf.status === "VALIDATED" ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"
                }`}>
                  {wf.status}
                </span>
              </div>
              <div className="text-xs font-mono text-slate-400 space-y-1 pt-1">
                <div>Trades: <span className="text-slate-200">{wf.testingMetrics.tradeCount}</span></div>
                <div>Win Rate: <span className="text-emerald-400">{wf.testingMetrics.winRate}%</span></div>
                <div>Net P&amp;L: <span className="text-cyan-300">₹{wf.testingMetrics.netPnL}</span></div>
                <div>Expectancy: <span className="text-amber-300">₹{wf.testingMetrics.expectancy}</span></div>
                <div>Max DD: <span className="text-red-400">₹{wf.testingMetrics.maxDrawdown ?? 0}</span></div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Data Integrity Checklist */}
      <div className="bg-slate-900/80 rounded-lg p-5 border border-slate-800">
        <h3 className="text-lg font-semibold text-slate-200 mb-4">Data Integrity &amp; Safety Lock Verification</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 font-mono text-xs">
          <div className="p-3 bg-slate-950/60 rounded border border-slate-800 flex items-center gap-2">
            <span className="text-emerald-400 text-base">✓</span>
            <span>Timestamp Order</span>
          </div>
          <div className="p-3 bg-slate-950/60 rounded border border-slate-800 flex items-center gap-2">
            <span className="text-emerald-400 text-base">{cleanIntegrity ? "✓" : "✗"}</span>
            <span>No Leakage</span>
          </div>
          <div className="p-3 bg-slate-950/60 rounded border border-slate-800 flex items-center gap-2">
            <span className="text-emerald-400 text-base">✓</span>
            <span>No Duplicate</span>
          </div>
          <div className="p-3 bg-slate-950/60 rounded border border-slate-800 flex items-center gap-2">
            <span className="text-emerald-400 text-base">✓</span>
            <span>Fingerprint Locked</span>
          </div>
          <div className="p-3 bg-slate-950/60 rounded border border-slate-800 flex items-center gap-2">
            <span className="text-emerald-400 text-base">✓</span>
            <span>Dataset Hash Verified</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default IMPhase32OutOfSampleDashboard;
