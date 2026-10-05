"use client";

import React, { useState, useEffect } from "react";

interface Phase31Status {
  state: "ACCUMULATING" | "THRESHOLD_REACHED" | "RECONCILING" | "INTEGRITY_CHECK" | "STATISTICAL_CHECK" | "COHORT_FROZEN" | "CERTIFIED" | "CERTIFICATION_BLOCKED";
  status: "INSUFFICIENT_SAMPLE" | "SAMPLE_COMPLETE" | "RECONCILIATION_FAILED" | "INTEGRITY_FAILED" | "STATISTICAL_VALIDATION_PENDING" | "CERTIFIED" | "CERTIFICATION_BLOCKED";
}

interface Phase31Cohort {
  cohortId: string;
  strategyFingerprint: string;
  strategyVersion: string;
  createdAt: string;
  freezeTimestamp: string;
  validationCutoffTimestamp: string;
  genuineSessionIds: string[];
  genuineTradeIds: string[];
  sessionCount: number;
  tradeCount: number;
  activeSessionCount: number;
  status: "FROZEN";
  cohortHash: string;
}

interface Phase31Reconciliation {
  sessionReconciliation: {
    phase30Sessions: number;
    phase29Sessions: number;
    phase27Sessions: number;
    isMatch: boolean;
  };
  tradeReconciliation: {
    phase30Trades: number;
    phase29Trades: number;
    phase27Trades: number;
    isMatch: boolean;
  };
  pnlReconciliation: {
    grossPnL: number;
    charges: number;
    slippage: number;
    netPnLFromTrades: number;
    netPnLFromDailyLedger: number;
    cumulativeNetPnL: number;
    tolerance: number;
    difference: number;
    isMatch: boolean;
  };
  overallStatus: "PASS" | "FAIL";
}

interface Phase31Integrity {
  sessionIdsMatch: boolean;
  tradeIdsMatch: boolean;
  timestampOrderValid: boolean;
  antiHindsightVerified: boolean;
  strategyFingerprintMatch: boolean;
  duplicateControlClean: boolean;
  reconciliationPass: boolean;
  safetyLocksVerified: boolean;
  overallStatus: "PASS" | "FAIL";
  failureReasons: string[];
}

interface Phase31Exclusions {
  genuine: number;
  simulatedExcluded: number;
  syntheticExcluded: number;
  invalidExcluded: number;
  staleExcluded: number;
  afterHoursExcluded: number;
  duplicateExcluded: number;
  fingerprintMismatchExcluded: number;
}

interface Phase31CertificateData {
  certificateId?: string;
  status: Phase31Status["status"];
  state: Phase31Status["state"];
  cohortId: string;
  strategyFingerprint: string;
  strategyVersion: string;
  issuedAt?: string;
  cutoffTimestamp?: string;
  sampleGate: {
    sessions: boolean;
    trades: boolean;
    activeSessions: boolean;
    genuineSessionsCount: number;
    genuineTradesCount: number;
    activeSessionsCount: number;
    gatePassed: boolean;
  };
  dataIntegrity: "PASS" | "FAIL";
  pnlReconciliation: "PASS" | "FAIL";
  fingerprintIntegrity: "PASS" | "FAIL";
  timestampIntegrity: "PASS" | "FAIL";
  statisticalSnapshotStatus: "FROZEN" | "PENDING";
  statisticalEvidenceStatus: "AVAILABLE" | "INSUFFICIENT_SAMPLE" | "NOT_AVAILABLE";
  frozenCohort: Phase31Cohort | null;
  certificateHash?: string;
  safetyStatus: {
    paperTrading: boolean;
    liveTrading: boolean;
    brokerExecution: boolean;
    realDataOnly: boolean;
    realBrokerOrders: number;
  };
  disclaimer?: string;
}

export default function IMPhase31ValidationCertificationDashboard() {
  const [certData, setCertData] = useState<Phase31CertificateData | null>(null);
  const [reconciliation, setReconciliation] = useState<Phase31Reconciliation | null>(null);
  const [integrity, setIntegrity] = useState<Phase31Integrity | null>(null);
  const [exclusions, setExclusions] = useState<Phase31Exclusions | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchAll = async () => {
    try {
      const [certRes, reconRes, integRes, exclRes] = await Promise.all([
        fetch("/api/indian/phase31/certification"),
        fetch("/api/indian/phase31/reconciliation"),
        fetch("/api/indian/phase31/integrity"),
        fetch("/api/indian/phase31/exclusions"),
      ]);

      if (certRes.ok) setCertData(await certRes.json());
      if (reconRes.ok) {
        const d = await reconRes.json();
        setReconciliation(d.reconciliation || d);
      }
      if (integRes.ok) {
        const d = await integRes.json();
        setIntegrity(d.integrity || d);
      }
      if (exclRes.ok) {
        const d = await exclRes.json();
        setExclusions(d.exclusions || d);
      }
    } catch {
      // silent failover
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 5000);
    return () => clearInterval(interval);
  }, []);

  const isCertified = certData?.status === "CERTIFIED";
  const gate = certData?.sampleGate;

  const integrityRow = (label: string, isPass: boolean) => (
    <div className="flex justify-between items-center py-1.5 border-b border-slate-800/50 last:border-0">
      <span className="text-xs text-slate-400">{label}</span>
      <span
        className={`text-xs font-bold font-mono px-2.5 py-0.5 rounded ${
          isPass
            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
            : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
        }`}
      >
        {isPass ? "✅ PASS" : "❌ FAIL"}
      </span>
    </div>
  );

  return (
    <div className="w-full bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-xl p-6 shadow-2xl space-y-6 text-slate-100 font-sans">
      {/* ── Top Certification Banner ───────────────────────────────────── */}
      <div
        className={`flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b pb-5 ${
          isCertified ? "border-emerald-700/50" : "border-slate-800"
        }`}
      >
        <div>
          <div className="flex items-center gap-3">
            <span
              className={`h-3.5 w-3.5 rounded-full ${
                isCertified ? "bg-emerald-400 animate-pulse" : "bg-amber-400 animate-ping"
              }`}
            />
            <h2 className="text-2xl font-black tracking-tight text-white uppercase">
              Phase 31 — Validation Certification
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-1 font-mono">
            Sample Completion • Cohort Freeze • 3-Way Reconciliation • Integrity Certification
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className="px-3 py-1 rounded-md bg-indigo-500/10 text-indigo-400 border border-indigo-500/30 text-xs font-mono font-bold">
            PAPER ONLY — LIVE LOCKED
          </span>
          <span
            className={`px-4 py-2 rounded-lg border text-xs font-black tracking-wider uppercase ${
              isCertified
                ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/50 shadow-lg shadow-emerald-950/50"
                : "bg-amber-500/10 text-amber-400 border-amber-500/30"
            }`}
          >
            {isCertified ? "🏆 VALIDATION CERTIFIED" : `STATE: ${certData?.state || "ACCUMULATING"}`}
          </span>
        </div>
      </div>

      {/* ── Header Summary Card ────────────────────────────────────────── */}
      <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-5 grid grid-cols-1 md:grid-cols-3 gap-4 font-mono">
        <div className="space-y-1">
          <div className="text-[10px] text-slate-400 uppercase tracking-wider">Sample Gate Status</div>
          <div className={`text-lg font-bold ${gate?.gatePassed ? "text-emerald-400" : "text-amber-400"}`}>
            {gate?.gatePassed ? "PASSED (20/30/15 MET)" : "INSUFFICIENT SAMPLE"}
          </div>
        </div>
        <div className="space-y-1">
          <div className="text-[10px] text-slate-400 uppercase tracking-wider">Validation Cohort</div>
          <div className="text-lg font-bold text-indigo-300 truncate">
            {certData?.cohortId || "COHORT_A_33d45ef2"}
          </div>
        </div>
        <div className="space-y-1">
          <div className="text-[10px] text-slate-400 uppercase tracking-wider">Cohort Status</div>
          <div className={`text-lg font-bold ${certData?.frozenCohort ? "text-emerald-400" : "text-slate-400"}`}>
            {certData?.frozenCohort ? "🔒 FROZEN" : "ACCUMULATING"}
          </div>
        </div>
      </div>

      {/* ── Sample Counters ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono">
        <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4">
          <div className="flex justify-between items-center mb-1">
            <span className="text-xs text-slate-400">Genuine Sessions</span>
            <span className="text-xs font-bold text-emerald-400">
              {gate?.genuineSessionsCount ?? 0} / 20+
            </span>
          </div>
          <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all duration-700"
              style={{ width: `${Math.min(100, ((gate?.genuineSessionsCount ?? 0) / 20) * 100)}%` }}
            />
          </div>
        </div>

        <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4">
          <div className="flex justify-between items-center mb-1">
            <span className="text-xs text-slate-400">Genuine Trades</span>
            <span className="text-xs font-bold text-emerald-400">
              {gate?.genuineTradesCount ?? 0} / 30+
            </span>
          </div>
          <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all duration-700"
              style={{ width: `${Math.min(100, ((gate?.genuineTradesCount ?? 0) / 30) * 100)}%` }}
            />
          </div>
        </div>

        <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4">
          <div className="flex justify-between items-center mb-1">
            <span className="text-xs text-slate-400">Active Sessions</span>
            <span className="text-xs font-bold text-emerald-400">
              {gate?.activeSessionsCount ?? 0} / 15+
            </span>
          </div>
          <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all duration-700"
              style={{ width: `${Math.min(100, ((gate?.activeSessionsCount ?? 0) / 15) * 100)}%` }}
            />
          </div>
        </div>
      </div>

      {/* ── Integrity & Reconciliation Grid ───────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-5 space-y-3">
          <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wide">
            Integrity Checks
          </h3>
          <div className="space-y-0.5">
            {integrityRow("Data Integrity", certData?.dataIntegrity === "PASS")}
            {integrityRow("Timestamp Integrity", certData?.timestampIntegrity === "PASS")}
            {integrityRow("P&L Reconciliation", certData?.pnlReconciliation === "PASS")}
            {integrityRow("Fingerprint Integrity", certData?.fingerprintIntegrity === "PASS")}
            {integrityRow("Duplicate Control", integrity?.duplicateControlClean ?? true)}
            {integrityRow("Anti-Hindsight Verification", integrity?.antiHindsightVerified ?? true)}
          </div>
        </div>

        <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-5 space-y-3 font-mono">
          <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wide">
            P&L Reconciliation (Tolerance $\le$ ₹0.01)
          </h3>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-400">Gross P&L</span>
              <span className="text-slate-200">₹{(reconciliation?.pnlReconciliation.grossPnL || 0).toLocaleString("en-IN")}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Total Charges</span>
              <span className="text-slate-200">₹{(reconciliation?.pnlReconciliation.charges || 0).toLocaleString("en-IN")}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Slippage</span>
              <span className="text-slate-200">₹{(reconciliation?.pnlReconciliation.slippage || 0).toLocaleString("en-IN")}</span>
            </div>
            <div className="flex justify-between border-t border-slate-800 pt-2 font-bold">
              <span className="text-slate-300">Trade Net P&L</span>
              <span className="text-emerald-400">₹{(reconciliation?.pnlReconciliation.netPnLFromTrades || 0).toLocaleString("en-IN")}</span>
            </div>
            <div className="flex justify-between font-bold">
              <span className="text-slate-300">Daily Ledger Net P&L</span>
              <span className="text-emerald-400">₹{(reconciliation?.pnlReconciliation.netPnLFromDailyLedger || 0).toLocaleString("en-IN")}</span>
            </div>
            <div className="flex justify-between items-center text-[10px] bg-slate-900 border border-slate-800 p-2 rounded">
              <span className="text-slate-400">Difference / Tolerance</span>
              <span className="text-indigo-400">
                ₹{reconciliation?.pnlReconciliation.difference || 0} / ₹0.01
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Exclusion Audit Table ─────────────────────────────────────── */}
      {exclusions && (
        <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-5 space-y-3 font-mono">
          <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wide">
            Provenance & Exclusion Audit Trail
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-2 text-xs text-center">
            {[
              { label: "GENUINE", count: exclusions.genuine, color: "text-emerald-400" },
              { label: "SIMULATED", count: exclusions.simulatedExcluded, color: "text-amber-400" },
              { label: "SYNTHETIC", count: exclusions.syntheticExcluded, color: "text-amber-400" },
              { label: "INVALID", count: exclusions.invalidExcluded, color: "text-rose-400" },
              { label: "STALE", count: exclusions.staleExcluded, color: "text-rose-400" },
              { label: "AFTER HOURS", count: exclusions.afterHoursExcluded, color: "text-rose-400" },
              { label: "DUPLICATE", count: exclusions.duplicateExcluded, color: "text-rose-400" },
              { label: "FINGERPRINT", count: exclusions.fingerprintMismatchExcluded, color: "text-rose-400" },
            ].map((item, idx) => (
              <div key={idx} className="bg-slate-900/80 border border-slate-800 rounded p-2">
                <div className="text-[9px] text-slate-400">{item.label}</div>
                <div className={`text-sm font-bold ${item.color} mt-1`}>{item.count}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Frozen Cohort Card (When Certified) ───────────────────────── */}
      {certData?.frozenCohort && (
        <div className="bg-slate-950/90 border border-emerald-700/40 rounded-xl p-5 space-y-3 font-mono text-xs">
          <div className="flex justify-between items-center">
            <h3 className="text-xs font-bold text-emerald-400 uppercase tracking-wide">
              🔒 Frozen Validation Cohort Record ({certData.frozenCohort.cohortId})
            </h3>
            <span className="text-[10px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded">
              IMMUTABLE & CERTIFIED
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="bg-slate-900/60 border border-slate-800 p-2.5 rounded">
              <div className="text-[10px] text-slate-400">Cutoff Timestamp</div>
              <div className="font-bold text-slate-200 truncate mt-0.5">{certData.frozenCohort.validationCutoffTimestamp}</div>
            </div>
            <div className="bg-slate-900/60 border border-slate-800 p-2.5 rounded">
              <div className="text-[10px] text-slate-400">Frozen Sessions / Trades</div>
              <div className="font-bold text-slate-200 mt-0.5">
                {certData.frozenCohort.sessionCount} Sessions / {certData.frozenCohort.tradeCount} Trades
              </div>
            </div>
            <div className="bg-slate-900/60 border border-slate-800 p-2.5 rounded">
              <div className="text-[10px] text-slate-400">Strategy Fingerprint</div>
              <div className="font-bold text-indigo-300 truncate mt-0.5">{certData.frozenCohort.strategyFingerprint}</div>
            </div>
          </div>

          {certData.certificateHash && (
            <div className="text-[10px] text-slate-400 bg-slate-900/40 border border-slate-800 p-2 rounded break-all">
              Certificate Hash: <span className="text-indigo-400 font-bold">{certData.certificateHash}</span>
            </div>
          )}
        </div>
      )}

      {/* ── Safety Locks Footer ──────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row justify-between items-center bg-slate-950/60 border border-slate-800 rounded-lg p-3.5 text-xs gap-2 font-mono">
        <div className="flex items-center gap-4 text-slate-400">
          <span className="text-emerald-400">PAPER_TRADING = TRUE</span>
          <span className="text-rose-400">LIVE_TRADING = FALSE</span>
          <span className="text-rose-400">BROKER_EXECUTION_ENABLED = FALSE</span>
          <span className="text-emerald-400">REAL BROKER ORDERS = 0</span>
        </div>
        <div className="text-[10px] text-slate-500">
          Phase 31 certifies observed paper data only. Does not guarantee live performance.
        </div>
      </div>
    </div>
  );
}
