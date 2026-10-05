"use client";

import React, { useState, useEffect } from "react";

interface Phase29Progress {
  genuineSessions: number;
  genuineTrades: number;
  activeSessions: number;
  sessionsProgress: number;
  tradesProgress: number;
  activeSessionsProgress: number;
  sessionsMet: boolean;
  tradesMet: boolean;
  activeSessionsMet: boolean;
  validationStatus: "INSUFFICIENT_SAMPLE" | "SAMPLE_COMPLETE";
}

interface Phase29IntegrityReport {
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

interface Phase29StatusData {
  success: boolean;
  progress: Phase29Progress;
  integrity: Phase29IntegrityReport;
}

interface Phase29SnapshotData {
  success: boolean;
  snapshot: {
    snapshotId: string;
    sampleStart: string;
    sampleEnd: string;
    sessions: number;
    trades: number;
    snapshotHash: string;
    strategyFingerprint: string;
    statisticsVersion: string;
    coreStatistics: {
      totalNetPnL: number;
      winRate: number;
      profitFactor: number | "NOT_AVAILABLE";
      expectancy: number;
      maxDrawdown: number;
    };
  } | null;
  message?: string;
}

interface Phase29ExclusionCounters {
  SYNTHETIC_DATA: number;
  SIMULATED_DATA: number;
  AFTER_HOURS: number;
  TIMESTAMP_VIOLATION: number;
  TIMEZONE_MISMATCH: number;
  PROVENANCE_FAILED: number;
  STALE_DATA: number;
  INVALID_EXPIRY: number;
  LOT_SIZE_UNVERIFIED: number;
  RECONCILIATION_FAILED: number;
  HINDSIGHT_VIOLATION: number;
  DUPLICATE_TRADE: number;
  NOT_GENUINE_SESSION: number;
  STRATEGY_CHANGED: number;
  MANUAL_EXCLUSION: number;
}

interface Phase29ExclusionsData {
  success: boolean;
  counters: Phase29ExclusionCounters;
}

export default function IMPhase29ValidationControl() {
  const [statusData, setStatusData] = useState<Phase29StatusData | null>(null);
  const [snapshotData, setSnapshotData] = useState<Phase29SnapshotData | null>(null);
  const [exclusionsData, setExclusionsData] = useState<Phase29ExclusionsData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchAll = async () => {
    try {
      const [statusRes, snapshotRes, exclusionsRes] = await Promise.all([
        fetch("/api/indian/phase29/status"),
        fetch("/api/indian/phase29/snapshot"),
        fetch("/api/indian/phase29/exclusions"),
      ]);
      if (statusRes.ok) setStatusData(await statusRes.json());
      if (snapshotRes.ok) setSnapshotData(await snapshotRes.json());
      if (exclusionsRes.ok) setExclusionsData(await exclusionsRes.json());
    } catch {
      // silent — continue
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 5000);
    return () => clearInterval(interval);
  }, []);

  const progress = statusData?.progress;
  const integrity = statusData?.integrity;
  const isComplete = progress?.validationStatus === "SAMPLE_COMPLETE";

  const integrityRow = (
    label: string,
    value: string,
    pass: string,
    fail?: string
  ) => {
    const isOk = value === pass;
    return (
      <div className="flex justify-between items-center py-1.5 border-b border-slate-800/50 last:border-0">
        <span className="text-xs text-slate-400">{label}</span>
        <span
          className={`text-xs font-bold font-mono px-2 py-0.5 rounded ${
            isOk
              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
              : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
          }`}
        >
          {value}
        </span>
      </div>
    );
  };

  const progressCard = (
    label: string,
    value: number,
    max: number,
    progress: number,
    met: boolean
  ) => (
    <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-5">
      <div className="flex justify-between items-center mb-2">
        <span className="text-xs text-slate-400 font-medium">{label}</span>
        <span className="text-xs font-mono font-bold text-emerald-400">
          {value} / {max}
        </span>
      </div>
      <div className="w-full bg-slate-800 rounded-full h-2.5 overflow-hidden mb-2">
        <div
          className={`h-full rounded-full transition-all duration-700 ${met ? "bg-emerald-500" : "bg-indigo-500"}`}
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="text-[10px] text-right font-mono text-slate-500">
        {progress}% {met ? "✓ MET" : "⏳"}
      </div>
    </div>
  );

  return (
    <div className="w-full bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-xl p-6 shadow-2xl space-y-6 text-slate-100">
      {/* ── Top Completion Banner ───────────────────────────────────── */}
      <div
        className={`flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b pb-4 ${
          isComplete ? "border-emerald-700/40" : "border-slate-800"
        }`}
      >
        <div>
          <div className="flex items-center gap-3">
            <span
              className={`h-3 w-3 rounded-full ${
                isComplete ? "bg-emerald-400 animate-pulse" : "bg-amber-500 animate-ping"
              }`}
            />
            <h2 className="text-xl font-bold tracking-tight text-white uppercase">
              Phase 29 — Genuine Sample Validation Control
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-1 font-mono">
            Session & Trade Finalizer • Immutable Snapshot • Fingerprint Guard • Integrity Audit
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span className="px-2.5 py-1 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/30 text-xs font-mono font-semibold">
            PAPER ONLY — LIVE LOCKED
          </span>
          <span
            className={`px-3 py-1.5 rounded-lg border text-xs font-bold tracking-wider uppercase ${
              isComplete
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                : "bg-amber-500/10 text-amber-400 border-amber-500/30"
            }`}
          >
            {isComplete ? "MINIMUM GENUINE SAMPLE COMPLETE" : "VALIDATION SAMPLE INCOMPLETE"}
          </span>
        </div>
      </div>

      {/* ── Progress Cards ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {progressCard(
          "Genuine Sessions",
          progress?.genuineSessions ?? 0,
          20,
          progress?.sessionsProgress ?? 0,
          progress?.sessionsMet ?? false
        )}
        {progressCard(
          "Genuine Trades",
          progress?.genuineTrades ?? 0,
          30,
          progress?.tradesProgress ?? 0,
          progress?.tradesMet ?? false
        )}
        {progressCard(
          "Active Sessions",
          progress?.activeSessions ?? 0,
          15,
          progress?.activeSessionsProgress ?? 0,
          progress?.activeSessionsMet ?? false
        )}
      </div>

      {/* ── Snapshot Panel (visible only after SAMPLE_COMPLETE) ─────── */}
      {snapshotData?.snapshot ? (
        <div className="bg-slate-950/80 border border-emerald-700/30 rounded-xl p-5 space-y-4">
          <h3 className="text-xs font-semibold text-emerald-400 uppercase tracking-wide">
            📦 Immutable Validation Snapshot
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 font-mono text-xs">
            <div className="bg-slate-900/60 border border-slate-800 rounded p-3">
              <div className="text-[10px] text-slate-400">Sample Start</div>
              <div className="font-bold text-slate-100 mt-1">{snapshotData.snapshot.sampleStart}</div>
            </div>
            <div className="bg-slate-900/60 border border-slate-800 rounded p-3">
              <div className="text-[10px] text-slate-400">Sample End</div>
              <div className="font-bold text-slate-100 mt-1">{snapshotData.snapshot.sampleEnd}</div>
            </div>
            <div className="bg-slate-900/60 border border-slate-800 rounded p-3">
              <div className="text-[10px] text-slate-400">Sessions / Trades</div>
              <div className="font-bold text-slate-100 mt-1">
                {snapshotData.snapshot.sessions} / {snapshotData.snapshot.trades}
              </div>
            </div>
            <div className="bg-slate-900/60 border border-slate-800 rounded p-3">
              <div className="text-[10px] text-slate-400">Strategy Version</div>
              <div className="font-bold text-slate-100 mt-1 truncate">{snapshotData.snapshot.statisticsVersion}</div>
            </div>
          </div>

          <div className="text-[10px] font-mono text-slate-400 bg-slate-900/40 border border-slate-800 rounded p-2.5 break-all">
            Snapshot Hash: <span className="text-indigo-400">{snapshotData.snapshot.snapshotHash}</span>
          </div>

          {/* Snapshot Core Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { label: "Net P&L", value: `₹${(snapshotData.snapshot.coreStatistics?.totalNetPnL || 0).toLocaleString("en-IN")}` },
              { label: "Win Rate", value: `${snapshotData.snapshot.coreStatistics?.winRate || 0}%` },
              { label: "Profit Factor", value: snapshotData.snapshot.coreStatistics?.profitFactor ?? "N/A" },
              { label: "Expectancy", value: `₹${snapshotData.snapshot.coreStatistics?.expectancy || 0}` },
              { label: "Max Drawdown", value: `₹${snapshotData.snapshot.coreStatistics?.maxDrawdown || 0}` },
            ].map((item, i) => (
              <div key={i} className="bg-slate-900/60 border border-slate-800 rounded p-3 font-mono">
                <div className="text-[10px] text-slate-400 uppercase">{item.label}</div>
                <div className="text-sm font-bold text-slate-100 mt-1">{item.value}</div>
              </div>
            ))}
          </div>

          <p className="text-[10px] text-amber-400 italic">
            ⚠ These are observational statistics from a genuine paper-trading sample.
            They do not constitute proof of profitability, strategy optimality, or readiness for live trading.
          </p>
        </div>
      ) : (
        <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 text-xs text-slate-400 font-mono">
          📁 Validation Snapshot: Not yet created — minimum sample gate not yet met.
        </div>
      )}

      {/* ── Integrity Report ────────────────────────────────────────── */}
      {integrity && (
        <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-5 space-y-3">
          <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">
            Integrity & Safety Audit
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
            <div className="space-y-0.5">
              {integrityRow("Timestamp Integrity", integrity.timestampIntegrity, "PASSED")}
              {integrityRow("Timezone Integrity", integrity.timezoneIntegrity, "PASSED")}
              {integrityRow("Provenance Integrity", integrity.provenanceIntegrity, "PASSED")}
              {integrityRow("Reconciliation", integrity.reconciliationIntegrity, "PASS")}
              {integrityRow("No Look-Ahead", integrity.noLookAhead, "VERIFIED")}
            </div>
            <div className="space-y-0.5">
              {integrityRow("Fingerprint Status", integrity.fingerprintStatus, "VALIDATED")}
              {integrityRow("Safety Locks", integrity.safetyLockStatus, "LOCKED")}
              {integrityRow("Duplicate Control", integrity.duplicateControl, "CLEAN")}
              {integrityRow("Immutability", integrity.immutabilityStatus, "INTACT")}
            </div>
          </div>
        </div>
      )}

      {/* ── Exclusion Counters ─────────────────────────────────────── */}
      {exclusionsData && (
        <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-5 space-y-3">
          <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide flex items-center gap-2">
            <span>🛡 Exclusion Audit Counters</span>
            <span className="text-[10px] text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20">
              STRICT ISOLATION ACTIVE
            </span>
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 font-mono text-xs">
            {Object.entries(exclusionsData.counters).map(([key, val]) => (
              <div key={key} className="bg-slate-900/60 border border-slate-800 rounded p-2.5">
                <div className="text-[9px] text-slate-400 uppercase leading-tight">{key.replace(/_/g, " ")}</div>
                <div className="font-bold text-rose-400 text-sm mt-1">{val}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Safety Footer ────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row justify-between items-center bg-slate-950/60 border border-slate-800 rounded-lg p-3 text-xs gap-2 font-mono">
        <div className="flex items-center gap-4 text-slate-400">
          <span className="text-emerald-400">PAPER_TRADING=true</span>
          <span className="text-red-400">LIVE_TRADING=false</span>
          <span className="text-red-400">BROKER_EXECUTION_ENABLED=false</span>
          <span className="text-emerald-400">REAL_ORDERS=0</span>
        </div>
        <div className="text-[10px] text-slate-500">
          DO NOT modify strategy or force trades during Phase 29 sample accumulation.
        </div>
      </div>
    </div>
  );
}
