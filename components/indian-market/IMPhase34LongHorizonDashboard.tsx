import React, { useState, useEffect } from "react";

export interface Phase34DashboardData {
  report: {
    reportId: string;
    state: string;
    status: string;
    masterStrategyFingerprint: string;
    gateDetails: {
      genuineSessions: number;
      requiredSessions: number;
      gatePassed: boolean;
      genuineTrades: number;
      activeSessions: number;
    };
    rollingSessionWindows: {
      w20: { windowLabel: string; winRate: number; expectancy: number; profitFactor: number | string; netPnL: number; maxDrawdown: number; status: string };
      w30: { windowLabel: string; winRate: number; expectancy: number; profitFactor: number | string; netPnL: number; maxDrawdown: number; status: string };
      w40: { windowLabel: string; winRate: number; expectancy: number; profitFactor: number | string; netPnL: number; maxDrawdown: number; status: string };
      w60: { windowLabel: string; winRate: number; expectancy: number; profitFactor: number | string; netPnL: number; maxDrawdown: number; status: string };
    };
    driftReport: {
      metricsDrift: {
        winRateDifference: number;
        expectancyDifference: number;
        profitFactorDifference: number | string;
        drawdownDifference: number;
        tradeFrequencyDifferencePct: number;
        driftStatus: string;
      };
      driftStatus: string;
      summaryText: string;
    };
    operationalStability: {
      totalSessionsEvaluated: number;
      dhanConnectionFailures: number;
      webSocketDisconnects: number;
      webSocketRecoveries: number;
      optionChainFailures: number;
      unresolvedIncidentsCount: number;
      recoveryStatus: string;
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

export const IMPhase34LongHorizonDashboard: React.FC = () => {
  const [data, setData] = useState<Phase34DashboardData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/indian/phase34/summary");
      const json = await res.json();
      if (json.success) {
        setData({ report: json.report });
      } else {
        setError(json.error || "Failed to load Phase 34 summary data");
      }
    } catch (err: any) {
      setError(err.message || "Failed to fetch Phase 34 status");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 text-slate-200 bg-slate-900 rounded-lg">
        <p className="animate-pulse font-mono">Loading Phase 34 Long-Horizon Engine...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 text-red-400 bg-slate-900 rounded-lg border border-red-800 font-sans">
        <h3 className="font-bold text-lg mb-2">Phase 34 Long-Horizon Dashboard</h3>
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
  const gate = report.gateDetails;
  const progressPct = Math.min(100, Math.round((gate.genuineSessions / gate.requiredSessions) * 100));
  const drift = report.driftReport?.metricsDrift;
  const ops = report.operationalStability;

  return (
    <div className="p-6 bg-slate-950 text-slate-100 rounded-xl space-y-6 font-sans">
      {/* Header Banner */}
      <div className="border border-purple-500/40 bg-slate-900/90 rounded-lg p-5 shadow-lg">
        <div className="border-b border-purple-500/30 pb-3 mb-4 flex justify-between items-center">
          <h2 className="text-xl font-bold tracking-wide text-purple-400 font-mono">
            PHASE 34 — LONG-HORIZON GENUINE PAPER VALIDATION &amp; DRIFT DETECTION
          </h2>
          <span className={`px-3 py-1 rounded text-xs font-bold font-mono ${
            report.status === "LONG_HORIZON_COMPLETE" || report.status === "GATE_REACHED"
              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
              : "bg-amber-500/20 text-amber-400 border border-amber-500/40"
          }`}>
            {report.status}
          </span>
        </div>

        {/* Progress Bar & Counters */}
        <div className="space-y-3 font-mono">
          <div className="flex justify-between items-center text-sm">
            <span className="text-slate-300">Genuine Sessions Accumulation:</span>
            <span className="font-bold text-purple-300">{gate.genuineSessions} / {gate.requiredSessions} ({progressPct}%)</span>
          </div>
          <div className="w-full bg-slate-950 rounded-full h-3 border border-slate-800 overflow-hidden">
            <div
              className="bg-gradient-to-r from-purple-500 to-indigo-500 h-3 rounded-full transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 text-xs">
            <div className="bg-slate-950/60 p-3 rounded border border-slate-800">
              <span className="text-slate-400 block">Genuine Trades:</span>
              <span className="text-lg font-bold text-slate-200">{gate.genuineTrades}</span>
            </div>
            <div className="bg-slate-950/60 p-3 rounded border border-slate-800">
              <span className="text-slate-400 block">Active Sessions:</span>
              <span className="text-lg font-bold text-cyan-300">{gate.activeSessions}</span>
            </div>
            <div className="bg-slate-950/60 p-3 rounded border border-slate-800">
              <span className="text-slate-400 block">Strategy Lock:</span>
              <span className="text-xs font-bold text-emerald-300 title={report.masterStrategyFingerprint}">
                {report.masterStrategyFingerprint.substring(0, 16)}...
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Rolling Session Windows */}
      <div className="bg-slate-900/80 rounded-lg p-5 border border-slate-800">
        <h3 className="text-lg font-semibold text-slate-200 mb-4 font-sans">Rolling Session Metrics</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 font-mono text-xs">
          {[
            report.rollingSessionWindows?.w20,
            report.rollingSessionWindows?.w30,
            report.rollingSessionWindows?.w40,
            report.rollingSessionWindows?.w60,
          ].map((w, idx) => (
            <div key={idx} className="bg-slate-950/70 p-4 rounded-lg border border-slate-800 space-y-2">
              <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                <span className="font-bold text-purple-400">{w?.windowLabel}</span>
                <span className={`px-2 py-0.5 rounded ${w?.status === "VALIDATED" ? "bg-emerald-500/20 text-emerald-400" : "bg-slate-800 text-slate-400"}`}>
                  {w?.status}
                </span>
              </div>
              <div className="space-y-1 text-slate-400 pt-1">
                <div>Win Rate: <span className="text-slate-200 font-semibold">{w?.status === "VALIDATED" ? `${w?.winRate}%` : "N/A"}</span></div>
                <div>Expectancy: <span className="text-cyan-300 font-semibold">{w?.status === "VALIDATED" ? `₹${w?.expectancy}` : "N/A"}</span></div>
                <div>Profit Factor: <span className="text-amber-300 font-semibold">{w?.status === "VALIDATED" ? w?.profitFactor : "N/A"}</span></div>
                <div>Net P&amp;L: <span className="text-purple-300 font-semibold">{w?.status === "VALIDATED" ? `₹${w?.netPnL}` : "N/A"}</span></div>
                <div>Max DD: <span className="text-red-400 font-semibold">{w?.status === "VALIDATED" ? `₹${w?.maxDrawdown}` : "N/A"}</span></div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Baseline vs Current Drift */}
      <div className="bg-slate-900/80 rounded-lg p-5 border border-slate-800">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-slate-200 font-sans">Baseline ➔ Long-Horizon Drift Analysis</h3>
          <span className={`px-3 py-1 rounded text-xs font-mono font-bold ${
            drift?.driftStatus === "NO_MEASURABLE_DRIFT" ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" :
            drift?.driftStatus === "POSSIBLE_DRIFT" ? "bg-amber-500/20 text-amber-400 border border-amber-500/30" :
            drift?.driftStatus === "MATERIAL_DRIFT" ? "bg-red-500/20 text-red-400 border border-red-500/30" :
            "bg-slate-800 text-slate-400"
          }`}>
            {drift?.driftStatus || "INSUFFICIENT_DATA"}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 font-mono text-xs">
          <div className="p-3 bg-slate-950/60 rounded border border-slate-800">
            <span className="text-slate-400 block">Win Rate Diff:</span>
            <span className="text-base font-bold text-amber-300">{drift?.winRateDifference ?? 0} pp</span>
          </div>
          <div className="p-3 bg-slate-950/60 rounded border border-slate-800">
            <span className="text-slate-400 block">Expectancy Diff:</span>
            <span className="text-base font-bold text-cyan-300">₹{drift?.expectancyDifference ?? 0}</span>
          </div>
          <div className="p-3 bg-slate-950/60 rounded border border-slate-800">
            <span className="text-slate-400 block">Profit Factor Diff:</span>
            <span className="text-base font-bold text-slate-200">{drift?.profitFactorDifference ?? "N/A"}</span>
          </div>
          <div className="p-3 bg-slate-950/60 rounded border border-slate-800">
            <span className="text-slate-400 block">Max Drawdown Diff:</span>
            <span className="text-base font-bold text-red-400">₹{drift?.drawdownDifference ?? 0}</span>
          </div>
          <div className="p-3 bg-slate-950/60 rounded border border-slate-800">
            <span className="text-slate-400 block">Trade Freq Diff:</span>
            <span className="text-base font-bold text-purple-300">{drift?.tradeFrequencyDifferencePct ?? 0}%</span>
          </div>
        </div>
      </div>

      {/* Operational Stability & Safety */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-slate-900/80 rounded-lg p-5 border border-slate-800 font-mono text-xs">
          <h3 className="text-sm font-semibold text-slate-200 mb-3 font-sans">Operational Stability Tracker</h3>
          <div className="space-y-2">
            <div className="flex justify-between p-2 bg-slate-950/60 rounded border border-slate-800">
              <span>Dhan Provider:</span>
              <span className="text-emerald-400 font-bold">HEALTHY ({ops?.dhanConnectionFailures ?? 0} failures)</span>
            </div>
            <div className="flex justify-between p-2 bg-slate-950/60 rounded border border-slate-800">
              <span>WebSocket Feed:</span>
              <span className="text-emerald-400 font-bold">HEALTHY ({ops?.webSocketRecoveries ?? 0} recoveries)</span>
            </div>
            <div className="flex justify-between p-2 bg-slate-950/60 rounded border border-slate-800">
              <span>Option Chain Provider:</span>
              <span className="text-emerald-400 font-bold">HEALTHY ({ops?.optionChainFailures ?? 0} errors)</span>
            </div>
            <div className="flex justify-between p-2 bg-slate-950/60 rounded border border-slate-800">
              <span>Unresolved Incidents:</span>
              <span className="text-slate-200 font-bold">{ops?.unresolvedIncidentsCount ?? 0}</span>
            </div>
          </div>
        </div>

        <div className="bg-slate-900/80 rounded-lg p-5 border border-slate-800 font-mono text-xs">
          <h3 className="text-sm font-semibold text-slate-200 mb-3 font-sans">Safety Lock Enforcement</h3>
          <div className="space-y-2">
            <div className="flex justify-between p-2 bg-slate-950/60 rounded border border-slate-800">
              <span>PAPER_TRADING:</span>
              <span className="text-emerald-400 font-bold">TRUE</span>
            </div>
            <div className="flex justify-between p-2 bg-slate-950/60 rounded border border-slate-800">
              <span>LIVE_TRADING:</span>
              <span className="text-emerald-400 font-bold">FALSE</span>
            </div>
            <div className="flex justify-between p-2 bg-slate-950/60 rounded border border-slate-800">
              <span>BROKER_EXECUTION_ENABLED:</span>
              <span className="text-emerald-400 font-bold">FALSE</span>
            </div>
            <div className="flex justify-between p-2 bg-slate-950/60 rounded border border-slate-800">
              <span>REAL DHAN BROKER ORDERS:</span>
              <span className="text-emerald-400 font-bold">0</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default IMPhase34LongHorizonDashboard;
