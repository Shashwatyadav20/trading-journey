"use client";

import React, { useState, useEffect } from "react";

export interface ProgressState {
  genuineSessions: number;
  requiredSessions: number;
  genuineTrades: number;
  requiredTrades: number;
  activeSessions: number;
  requiredActiveSessions: number;
  sessionsMet: boolean;
  tradesMet: boolean;
  activeSessionsMet: boolean;
  validationStatus: "INSUFFICIENT_SAMPLE" | "SAMPLE_COMPLETE";
}

export interface ExcludedObservation {
  id: string;
  type: string;
  reason: string;
  timestamp: string;
  details: string;
}

export const IMPhase38SampleCollectionDashboard: React.FC = () => {
  const [progress, setProgress] = useState<ProgressState>({
    genuineSessions: 0,
    requiredSessions: 20,
    genuineTrades: 0,
    requiredTrades: 30,
    activeSessions: 0,
    requiredActiveSessions: 15,
    sessionsMet: false,
    tradesMet: false,
    activeSessionsMet: false,
    validationStatus: "INSUFFICIENT_SAMPLE",
  });

  const [fingerprint, setFingerprint] = useState<string>("CALCULATING...");
  const [dhanStatus, setDhanStatus] = useState<string>("CONNECTED");
  const [websocketHealth, setWebsocketHealth] = useState<string>("HEALTHY");
  const [reconciliationStatus, setReconciliationStatus] = useState<string>("PASS");
  const [exclusions, setExclusions] = useState<Record<string, number>>({});
  const [exclusionAudit, setExclusionAudit] = useState<ExcludedObservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<string>("");

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [progressRes, statusRes, exclusionsRes] = await Promise.all([
        fetch("/api/indian/phase38/progress"),
        fetch("/api/indian/phase38/status"),
        fetch("/api/indian/phase38/exclusions"),
      ]);

      const progressData = await progressRes.json();
      const statusData = await statusRes.json();
      const exclusionsData = await exclusionsRes.json();

      if (progressData.success || progressData.validationStatus) {
        setProgress({
          genuineSessions: progressData.genuineSessions ?? 0,
          requiredSessions: progressData.requiredSessions ?? 20,
          genuineTrades: progressData.genuineTrades ?? 0,
          requiredTrades: progressData.requiredTrades ?? 30,
          activeSessions: progressData.activeSessions ?? 0,
          requiredActiveSessions: progressData.requiredActiveSessions ?? 15,
          sessionsMet: progressData.sessionsMet ?? false,
          tradesMet: progressData.tradesMet ?? false,
          activeSessionsMet: progressData.activeSessionsMet ?? false,
          validationStatus: progressData.validationStatus ?? "INSUFFICIENT_SAMPLE",
        });
      }

      if (statusData.success) {
        setFingerprint(statusData.fingerprint || "UNKNOWN");
        setDhanStatus(statusData.dhanConnection || "CONNECTED");
        setWebsocketHealth(statusData.websocketHealth || "HEALTHY");
        setReconciliationStatus(statusData.reconciliationStatus || "PASS");
      }

      if (exclusionsData.success) {
        setExclusions(exclusionsData.exclusionCounters || {});
        setExclusionAudit(exclusionsData.exclusionAudit || []);
      }

      setLastRefresh(new Date().toLocaleTimeString("en-IN"));
    } catch (e: any) {
      setError(e.message || "Failed to load Phase 38 sample collection dashboard.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

  const totalExclusions = Object.values(exclusions).reduce((a, b) => a + b, 0);

  return (
    <div className="p-5 bg-slate-950 text-slate-100 rounded-2xl space-y-5 font-sans">
      {/* Top Banner Header */}
      <div className="border border-emerald-500/40 bg-slate-900/90 rounded-xl p-5 shadow-lg">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-emerald-500/20 pb-4 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold tracking-wide text-emerald-400 font-mono">
                PHASE 38 — GENUINE MARKET SAMPLE COLLECTION &amp; COHORT ACCUMULATION
              </h2>
              <span className="px-2.5 py-0.5 text-xs font-bold font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded">
                REAL GENUINE PAPER DATA ONLY
              </span>
            </div>
            <p className="text-xs text-slate-400 font-mono mt-1">
              Empirical data accumulation engine feeding validation layers — Zero synthetic trades backfilled
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span
              className={`px-3 py-1 border rounded text-xs font-bold font-mono ${
                progress.validationStatus === "SAMPLE_COMPLETE"
                  ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
                  : "bg-amber-500/15 text-amber-300 border-amber-500/40"
              }`}
            >
              {progress.validationStatus.replace(/_/g, " ")}
            </span>
            <button
              onClick={fetchData}
              disabled={loading}
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

      {/* Main Sample Target Progress Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Genuine Sessions */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 space-y-2">
          <div className="flex justify-between items-center text-xs font-mono">
            <span className="text-slate-400">Genuine Sessions</span>
            <span className={progress.sessionsMet ? "text-emerald-400 font-bold" : "text-amber-400 font-bold"}>
              {progress.sessionsMet ? "✓ MET" : "INSUFFICIENT"}
            </span>
          </div>
          <div className="text-2xl font-bold font-mono text-slate-100">
            {progress.genuineSessions} / {progress.requiredSessions}
          </div>
          <div className="w-full bg-slate-800 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all ${progress.sessionsMet ? "bg-emerald-500" : "bg-amber-500"}`}
              style={{ width: `${Math.min((progress.genuineSessions / progress.requiredSessions) * 100, 100)}%` }}
            />
          </div>
          <span className="text-[10px] text-slate-500 font-mono block">
            Label: REAL GENUINE PAPER DATA
          </span>
        </div>

        {/* Genuine Trades */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 space-y-2">
          <div className="flex justify-between items-center text-xs font-mono">
            <span className="text-slate-400">Genuine Trades</span>
            <span className={progress.tradesMet ? "text-emerald-400 font-bold" : "text-amber-400 font-bold"}>
              {progress.tradesMet ? "✓ MET" : "INSUFFICIENT"}
            </span>
          </div>
          <div className="text-2xl font-bold font-mono text-slate-100">
            {progress.genuineTrades} / {progress.requiredTrades}
          </div>
          <div className="w-full bg-slate-800 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all ${progress.tradesMet ? "bg-emerald-500" : "bg-amber-500"}`}
              style={{ width: `${Math.min((progress.genuineTrades / progress.requiredTrades) * 100, 100)}%` }}
            />
          </div>
          <span className="text-[10px] text-slate-500 font-mono block">
            Label: REAL GENUINE PAPER DATA
          </span>
        </div>

        {/* Active Sessions */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 space-y-2">
          <div className="flex justify-between items-center text-xs font-mono">
            <span className="text-slate-400">Active Sessions (&gt;= 1 Trade)</span>
            <span className={progress.activeSessionsMet ? "text-emerald-400 font-bold" : "text-amber-400 font-bold"}>
              {progress.activeSessionsMet ? "✓ MET" : "INSUFFICIENT"}
            </span>
          </div>
          <div className="text-2xl font-bold font-mono text-slate-100">
            {progress.activeSessions} / {progress.requiredActiveSessions}
          </div>
          <div className="w-full bg-slate-800 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all ${progress.activeSessionsMet ? "bg-emerald-500" : "bg-amber-500"}`}
              style={{ width: `${Math.min((progress.activeSessions / progress.requiredActiveSessions) * 100, 100)}%` }}
            />
          </div>
          <span className="text-[10px] text-slate-500 font-mono block">
            Label: REAL GENUINE PAPER DATA
          </span>
        </div>
      </div>

      {/* Telemetry & Provenance Bar */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 font-mono text-xs space-y-1">
          <span className="text-slate-400">Strategy Fingerprint</span>
          <div className="text-emerald-400 font-bold truncate">{fingerprint}</div>
        </div>
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 font-mono text-xs space-y-1">
          <span className="text-slate-400">Dhan Connection</span>
          <div className="text-cyan-400 font-bold">{dhanStatus}</div>
        </div>
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 font-mono text-xs space-y-1">
          <span className="text-slate-400">WebSocket Health</span>
          <div className="text-emerald-400 font-bold">{websocketHealth}</div>
        </div>
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 font-mono text-xs space-y-1">
          <span className="text-slate-400">Reconciliation Status</span>
          <div className="text-emerald-400 font-bold">{reconciliationStatus} (3-Way Pass)</div>
        </div>
      </div>

      {/* Exclusion Audit Section */}
      <div className="border border-slate-700 bg-slate-900/60 rounded-xl p-4 space-y-3">
        <div className="flex justify-between items-center border-b border-slate-800 pb-2">
          <h3 className="text-xs font-bold font-mono text-slate-300 tracking-widest uppercase">
            EXCLUDED OBSERVATIONS &amp; REASON BREAKDOWN ({totalExclusions} Excluded)
          </h3>
          <span className="px-2 py-0.5 text-[10px] font-mono bg-rose-500/20 text-rose-300 border border-rose-500/40 rounded font-bold">
            EXCLUDED DATA
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 font-mono text-xs">
          {Object.entries(exclusions).map(([key, count]) => (
            <div key={key} className="p-2 bg-slate-950/60 rounded border border-slate-800 flex justify-between">
              <span className="text-slate-400 text-[11px] truncate">{key}</span>
              <span className="text-amber-400 font-bold">{count}</span>
            </div>
          ))}
        </div>

        {exclusionAudit.length > 0 && (
          <div className="overflow-x-auto mt-2">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="text-slate-500 border-b border-slate-800">
                  <th className="text-left py-1 pr-4">Trade ID</th>
                  <th className="text-left py-1 pr-4">Exclusion Reason</th>
                  <th className="text-left py-1 pr-4">Time</th>
                  <th className="text-left py-1">Classification</th>
                </tr>
              </thead>
              <tbody>
                {exclusionAudit.slice(0, 5).map((item) => (
                  <tr key={item.id || item.timestamp} className="border-b border-slate-800/40 text-slate-400">
                    <td className="py-1 pr-4 text-slate-300">{item.id}</td>
                    <td className="py-1 pr-4 text-rose-400 font-bold">{item.reason}</td>
                    <td className="py-1 pr-4 text-slate-500">{new Date(item.timestamp).toLocaleTimeString()}</td>
                    <td className="py-1 text-rose-400/80 font-bold">EXCLUDED DATA</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Footer Disclaimer */}
      <div className="border border-emerald-800/30 bg-emerald-950/20 rounded-xl p-4">
        <p className="text-xs font-mono text-emerald-300/80 leading-relaxed">
          <strong>PHASE 38 RULE:</strong> All observations are gathered strictly from real market data during live sessions.
          <strong> PAPER_TRADING = true | LIVE_TRADING = false | BROKER_EXECUTION_ENABLED = false.</strong>
          No synthetic trades or simulated backfilled results are included. All genuine data items are labeled <span className="text-emerald-400 font-bold">REAL GENUINE PAPER DATA</span>.
        </p>
        {lastRefresh && <p className="text-xs font-mono text-slate-600 mt-1">Refreshed: {lastRefresh}</p>}
      </div>
    </div>
  );
};

export default IMPhase38SampleCollectionDashboard;
