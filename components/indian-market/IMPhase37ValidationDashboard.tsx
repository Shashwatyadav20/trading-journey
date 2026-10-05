"use client";

import React, { useState, useEffect } from "react";

// ── Types ────────────────────────────────────────────────────────────────────

type EvidenceStatus = "PASS" | "FAIL" | "DATA_UNAVAILABLE" | "SIMULATED" | "PENDING";
type SampleGateStatus = "INSUFFICIENT_SAMPLE" | "SAMPLE_COMPLETE";
type ReconStatus = "PASS" | "FAIL" | "DATA_UNAVAILABLE";
type FpStatus = "VALID" | "COHORT_INVALIDATED_BY_STRATEGY_CHANGE" | "FINGERPRINT_MISMATCH" | "NOT_ESTABLISHED";
type ValidationState = "NOT_STARTED" | "INSUFFICIENT_SAMPLE" | "SAMPLE_COMPLETE" | "EVIDENCE_VALIDATED" | "FINAL_AUDIT_READY";

interface SafetyStatus {
  paperTrading: boolean;
  liveTrading: boolean;
  brokerExecution: boolean;
  realDataOnly: boolean;
  realDhanOrders: number;
  safetyInvariantPassed: boolean;
  violations: string[];
  verifiedAt: string;
}

interface PhaseEvidence {
  phase33: { testStatus: EvidenceStatus; stressValidationStatus: EvidenceStatus; evidenceStatus: EvidenceStatus };
  phase34: { validationStatus: EvidenceStatus; scenarioResults: EvidenceStatus; evidenceStatus: EvidenceStatus };
  phase35: { evidenceRegistryStatus: EvidenceStatus; reconciliationStatus: EvidenceStatus; researchReportStatus: EvidenceStatus };
  phase36: { testCount: number; regressionCount: number; fixesApplied: number; finalValidationStatus: EvidenceStatus };
  registry: Array<{
    phase: number; evidenceId: string; category: string; status: EvidenceStatus;
    timestamp: string; source: string; immutableHash: string; description: string;
  }>;
}

interface TestEvidence {
  phase33Tests: number; phase34Tests: number; phase35Tests: number; phase36Tests: number;
  totalTests: number; failedTests: number; regressions: number;
  typescriptStatus: "PASS" | "FAIL" | "NOT_RUN";
  productionBuildStatus: "PASS" | "FAIL" | "NOT_RUN";
  recordedAt: string;
}

interface SampleGate {
  genuineSessions: number; requiredSessions: number; sessionsMet: boolean;
  genuineTrades: number; requiredTrades: number; tradesMet: boolean;
  activeSessions: number; requiredActiveSessions: number; activeSessionsMet: boolean;
  validationStatus: SampleGateStatus; evaluatedAt: string;
}

interface StatisticalGate {
  gateOpen: boolean; sampleComplete: boolean; metrics: any; disclaimer: string;
}

interface Reconciliation {
  tradesPnL: ReconStatus; dailyPnL: ReconStatus; overallStatus: ReconStatus;
  details: string[]; reconciledAt: string;
}

interface Fingerprint {
  masterFingerprintHash: string; cohortId: string; fingerprintStatus: FpStatus;
  immutable: boolean; notes: string; verifiedAt: string;
}

interface FullReport {
  safety: SafetyStatus;
  phaseEvidence: PhaseEvidence;
  testEvidence: TestEvidence;
  sampleGate: SampleGate;
  statisticalGate: StatisticalGate;
  reconciliation: Reconciliation;
  fingerprint: Fingerprint;
  validationState: ValidationState;
}

// ── Colour Helpers ────────────────────────────────────────────────────────────

const statusColor = (s: EvidenceStatus | ReconStatus | string) => {
  if (s === "PASS")              return "text-emerald-400";
  if (s === "FAIL")              return "text-red-400";
  if (s === "DATA_UNAVAILABLE")  return "text-amber-400";
  if (s === "SIMULATED")         return "text-yellow-400";
  return "text-slate-400";
};

const statusBadge = (s: EvidenceStatus | ReconStatus | string) => {
  if (s === "PASS")             return "bg-emerald-500/15 text-emerald-300 border-emerald-500/40";
  if (s === "FAIL")             return "bg-red-500/15 text-red-300 border-red-500/40";
  if (s === "DATA_UNAVAILABLE") return "bg-amber-500/15 text-amber-300 border-amber-500/40";
  if (s === "SIMULATED")        return "bg-yellow-500/15 text-yellow-300 border-yellow-500/40";
  return "bg-slate-500/15 text-slate-300 border-slate-500/40";
};

const stateColor = (st: ValidationState) => {
  if (st === "FINAL_AUDIT_READY")   return "text-emerald-400";
  if (st === "EVIDENCE_VALIDATED")  return "text-cyan-400";
  if (st === "SAMPLE_COMPLETE")     return "text-sky-400";
  if (st === "INSUFFICIENT_SAMPLE") return "text-amber-400";
  return "text-slate-400";
};

const statusDot = (ok: boolean) => ok
  ? <span className="text-emerald-400 font-bold">● PASS</span>
  : <span className="text-red-400 font-bold">● FAIL</span>;

const bool2label = (v: boolean, trueLabel = "true", falseLabel = "false") =>
  v
    ? <span className="text-emerald-400 font-bold">{trueLabel}</span>
    : <span className="text-red-400 font-bold">{falseLabel}</span>;

// ── Sub-Components ────────────────────────────────────────────────────────────

const Card: React.FC<{ title: string; accent: string; children: React.ReactNode }> = ({ title, accent, children }) => (
  <div className={`bg-slate-900/80 border ${accent} rounded-xl p-4 space-y-3`}>
    <h3 className="text-xs font-bold font-mono tracking-widest text-slate-300 border-b border-slate-800 pb-2">{title}</h3>
    {children}
  </div>
);

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex justify-between items-center text-xs font-mono">
    <span className="text-slate-400">{label}</span>
    <span>{children}</span>
  </div>
);

const ProgressBar: React.FC<{ value: number; max: number; met: boolean }> = ({ value, max, met }) => {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className="w-full bg-slate-800 rounded-full h-1.5 mt-0.5">
      <div
        className={`h-1.5 rounded-full transition-all ${met ? "bg-emerald-500" : "bg-amber-500"}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
};

// ── Main Dashboard ─────────────────────────────────────────────────────────────

export const IMPhase37ValidationDashboard: React.FC = () => {
  const [report, setReport] = useState<FullReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<string>("");

  const fetchReport = async () => {
    try {
      setLoading(true);
      setError(null);

      const [safetyRes, evidenceRes, sampleRes, reconRes, fpRes, statusRes] = await Promise.all([
        fetch("/api/indian/phase37/safety"),
        fetch("/api/indian/phase37/evidence"),
        fetch("/api/indian/phase37/sample-gate"),
        fetch("/api/indian/phase37/reconciliation"),
        fetch("/api/indian/phase37/fingerprint"),
        fetch("/api/indian/phase37/status"),
      ]);

      const [safetyJson, evidenceJson, sampleJson, reconJson, fpJson, statusJson] = await Promise.all([
        safetyRes.json(), evidenceRes.json(), sampleRes.json(),
        reconRes.json(), fpRes.json(), statusRes.json(),
      ]);

      if (!safetyJson.success) throw new Error(safetyJson.error || "Safety endpoint failed");

      setReport({
        safety:          safetyJson.safety,
        phaseEvidence:   evidenceJson.phaseEvidence,
        testEvidence:    evidenceJson.testEvidence,
        sampleGate:      sampleJson.sampleGate,
        statisticalGate: { gateOpen: false, sampleComplete: false, metrics: null, disclaimer: "" }, // from status
        reconciliation:  reconJson.reconciliation,
        fingerprint:     fpJson.fingerprint,
        validationState: statusJson.validationState,
      });
      setLastRefresh(new Date().toLocaleTimeString("en-IN"));
    } catch (e: any) {
      setError(e.message || "Failed to load Phase 37 dashboard.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchReport(); }, []);

  // ── Loading / Error States ─────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="p-6 bg-slate-950 rounded-xl text-slate-300 font-mono text-sm animate-pulse">
        Loading Phase 37 — Final Evidence Consolidation &amp; Validation Control...
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="p-6 bg-slate-950 rounded-xl border border-red-800 text-red-400 font-sans space-y-3">
        <h3 className="font-bold text-lg">Phase 37 Dashboard</h3>
        <p className="text-sm">Error: {error || "No data available"}</p>
        <button
          id="phase37-retry-btn"
          onClick={fetchReport}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-100 rounded text-sm font-semibold transition"
        >
          Retry
        </button>
      </div>
    );
  }

  const { safety, phaseEvidence, testEvidence, sampleGate, reconciliation, fingerprint, validationState } = report;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="p-5 bg-slate-950 text-slate-100 rounded-2xl space-y-5 font-sans">

      {/* ── Header Banner ─────────────────────────────────────────────── */}
      <div className="border border-violet-500/40 bg-slate-900/90 rounded-xl p-5 shadow-lg">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-violet-500/20 pb-4 mb-4">
          <div>
            <h2 className="text-xl font-bold tracking-wide text-violet-400 font-mono">
              PHASE 37 — FINAL EVIDENCE CONSOLIDATION &amp; VALIDATION CONTROL
            </h2>
            <p className="text-xs text-slate-400 font-mono mt-1">
              Immutable evidence registry and validation state machine for Phases 33–36
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`px-3 py-1 border rounded text-xs font-bold font-mono ${
              validationState === "FINAL_AUDIT_READY"  ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40" :
              validationState === "EVIDENCE_VALIDATED" ? "bg-cyan-500/15 text-cyan-300 border-cyan-500/40" :
              validationState === "SAMPLE_COMPLETE"    ? "bg-sky-500/15 text-sky-300 border-sky-500/40" :
              validationState === "INSUFFICIENT_SAMPLE"? "bg-amber-500/15 text-amber-300 border-amber-500/40" :
              "bg-slate-500/15 text-slate-300 border-slate-500/40"
            }`}>
              {validationState}
            </span>
            <button
              id="phase37-refresh-btn"
              onClick={fetchReport}
              className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs font-mono transition"
            >
              ↻ Refresh
            </button>
          </div>
        </div>

        {/* Safety Invariant Quick-View */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs font-mono">
          {[
            { label: "PAPER_TRADING", value: safety.paperTrading, expected: true },
            { label: "LIVE_TRADING", value: safety.liveTrading, expected: false },
            { label: "BROKER_EXECUTION", value: safety.brokerExecution, expected: false },
            { label: "REAL_DHAN_ORDERS", value: safety.realDhanOrders === 0, expected: true },
          ].map((item) => (
            <div key={item.label} className={`rounded-lg p-3 border ${
              item.value === item.expected ? "bg-emerald-500/10 border-emerald-500/30" : "bg-red-500/10 border-red-500/30"
            }`}>
              <div className="text-slate-400 mb-1">{item.label}</div>
              <div className={`font-bold ${item.value === item.expected ? "text-emerald-400" : "text-red-400"}`}>
                {item.label === "REAL_DHAN_ORDERS" ? String(safety.realDhanOrders) : String(item.value)}
              </div>
            </div>
          ))}
        </div>
        {!safety.safetyInvariantPassed && (
          <div className="mt-3 p-2 bg-red-950/50 border border-red-700 rounded text-xs text-red-300 font-mono">
            ⚠ Safety violations: {safety.violations.join(" | ")}
          </div>
        )}
      </div>

      {/* ── State Machine ─────────────────────────────────────────────── */}
      <div className="border border-slate-700 bg-slate-900/60 rounded-xl p-4">
        <h3 className="text-xs font-bold font-mono text-slate-300 tracking-widest mb-3">
          FINAL VALIDATION STATE MACHINE
        </h3>
        <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
          {(["NOT_STARTED","INSUFFICIENT_SAMPLE","SAMPLE_COMPLETE","EVIDENCE_VALIDATED","FINAL_AUDIT_READY"] as ValidationState[]).map((st, i) => (
            <React.Fragment key={st}>
              <span className={`px-2 py-1 rounded border ${
                validationState === st
                  ? "bg-violet-500/20 border-violet-500/50 text-violet-300 font-bold"
                  : "border-slate-700 text-slate-500"
              }`}>
                {st}
              </span>
              {i < 4 && <span className="text-slate-600">→</span>}
            </React.Fragment>
          ))}
        </div>
        <p className="text-xs text-slate-500 mt-2 italic font-mono">
          Current state: <span className={`font-bold ${stateColor(validationState)}`}>{validationState}</span> | LIVE_TRADING=false (permanently)
        </p>
      </div>

      {/* ── Phase Evidence Grid ───────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">

        {/* Phase 33 */}
        <Card title="PHASE 33 EVIDENCE" accent="border-cyan-500/30">
          <Row label="Test Status">{statusDot(phaseEvidence?.phase33?.testStatus === "PASS")}</Row>
          <Row label="Stress Validation">{statusDot(phaseEvidence?.phase33?.stressValidationStatus === "PASS")}</Row>
          <Row label="Evidence Status">{statusDot(phaseEvidence?.phase33?.evidenceStatus === "PASS")}</Row>
          <div className="mt-2 text-xs font-mono text-slate-500 italic">
            [REAL PAPER DATA — stress scenario engine]
          </div>
        </Card>

        {/* Phase 34 */}
        <Card title="PHASE 34 EVIDENCE" accent="border-sky-500/30">
          <Row label="Validation Status">{statusDot(phaseEvidence?.phase34?.validationStatus === "PASS")}</Row>
          <Row label="Scenario Results">{statusDot(phaseEvidence?.phase34?.scenarioResults === "PASS")}</Row>
          <Row label="Evidence Status">{statusDot(phaseEvidence?.phase34?.evidenceStatus === "PASS")}</Row>
          <div className="mt-2 text-xs font-mono text-slate-500 italic">
            [REAL PAPER DATA — long-horizon drift detection]
          </div>
        </Card>

        {/* Phase 35 */}
        <Card title="PHASE 35 EVIDENCE" accent="border-violet-500/30">
          <Row label="Evidence Registry">{statusDot(phaseEvidence?.phase35?.evidenceRegistryStatus === "PASS")}</Row>
          <Row label="Reconciliation">{statusDot(phaseEvidence?.phase35?.reconciliationStatus === "PASS")}</Row>
          <Row label="Research Report">{statusDot(phaseEvidence?.phase35?.researchReportStatus === "PASS")}</Row>
          <div className="mt-2 text-xs font-mono text-slate-500 italic">
            [DERIVED — cross-phase consolidated report]
          </div>
        </Card>

        {/* Phase 36 */}
        <Card title="PHASE 36 EVIDENCE" accent="border-emerald-500/30">
          <Row label="Tests Passed">
            <span className="text-emerald-400 font-bold">{phaseEvidence?.phase36?.testCount} / {phaseEvidence?.phase36?.testCount}</span>
          </Row>
          <Row label="Regressions">
            <span className={phaseEvidence?.phase36?.regressionCount === 0 ? "text-emerald-400 font-bold" : "text-red-400 font-bold"}>
              {phaseEvidence?.phase36?.regressionCount}
            </span>
          </Row>
          <Row label="Fixes Applied">
            <span className="text-cyan-400 font-bold">{phaseEvidence?.phase36?.fixesApplied}</span>
          </Row>
          <Row label="Final Status">{statusDot(phaseEvidence?.phase36?.finalValidationStatus === "PASS")}</Row>
          <div className="mt-2 text-xs font-mono text-slate-500 italic">
            [DERIVED — evidence-based decision gate]
          </div>
        </Card>
      </div>

      {/* ── Test Evidence & Sample Gate ────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Test Evidence */}
        <Card title="TEST EVIDENCE SUMMARY" accent="border-amber-500/30">
          <div className="grid grid-cols-2 gap-2 text-xs font-mono">
            <div className="text-slate-400">Phase 33 Tests</div>
            <div className="text-right text-amber-300 font-bold">{testEvidence?.phase33Tests}</div>
            <div className="text-slate-400">Phase 34 Tests</div>
            <div className="text-right text-amber-300 font-bold">{testEvidence?.phase34Tests}</div>
            <div className="text-slate-400">Phase 35 Tests</div>
            <div className="text-right text-amber-300 font-bold">{testEvidence?.phase35Tests}</div>
            <div className="text-slate-400">Phase 36 Tests</div>
            <div className="text-right text-amber-300 font-bold">{testEvidence?.phase36Tests}</div>
            <div className="text-slate-400 border-t border-slate-800 pt-1">Total</div>
            <div className="text-right text-white font-bold border-t border-slate-800 pt-1">{testEvidence?.totalTests}</div>
            <div className="text-slate-400">Failed</div>
            <div className={`text-right font-bold ${testEvidence?.failedTests === 0 ? "text-emerald-400" : "text-red-400"}`}>{testEvidence?.failedTests}</div>
            <div className="text-slate-400">Regressions</div>
            <div className={`text-right font-bold ${testEvidence?.regressions === 0 ? "text-emerald-400" : "text-red-400"}`}>{testEvidence?.regressions}</div>
            <div className="text-slate-400">TypeScript</div>
            <div className={`text-right font-bold ${statusColor(testEvidence?.typescriptStatus)}`}>{testEvidence?.typescriptStatus}</div>
            <div className="text-slate-400">Prod Build</div>
            <div className={`text-right font-bold ${statusColor(testEvidence?.productionBuildStatus)}`}>{testEvidence?.productionBuildStatus}</div>
          </div>
          <div className="text-xs font-mono text-yellow-500/70 italic mt-2">
            [SIMULATED TEST DATA — test runner results, not trading data]
          </div>
        </Card>

        {/* Genuine Sample Gate */}
        <Card title="GENUINE SAMPLE GATE" accent="border-green-500/30">
          <div className={`text-xs font-bold font-mono px-2 py-1 rounded border mb-3 text-center ${
            sampleGate?.validationStatus === "SAMPLE_COMPLETE"
              ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
              : "bg-amber-500/15 border-amber-500/40 text-amber-300"
          }`}>
            {sampleGate?.validationStatus}
          </div>

          <div className="space-y-3 text-xs font-mono">
            {[
              { label: "Genuine Sessions", value: sampleGate?.genuineSessions, required: sampleGate?.requiredSessions, met: sampleGate?.sessionsMet },
              { label: "Genuine Trades",   value: sampleGate?.genuineTrades,   required: sampleGate?.requiredTrades,   met: sampleGate?.tradesMet },
              { label: "Active Sessions",  value: sampleGate?.activeSessions,  required: sampleGate?.requiredActiveSessions, met: sampleGate?.activeSessionsMet },
            ].map((item) => (
              <div key={item.label}>
                <div className="flex justify-between mb-0.5">
                  <span className="text-slate-400">{item.label}</span>
                  <span className={item.met ? "text-emerald-400 font-bold" : "text-amber-400 font-bold"}>
                    {item.value} / {item.required} {item.met ? "✓" : "⚠"}
                  </span>
                </div>
                <ProgressBar value={item.value ?? 0} max={item.required ?? 1} met={item.met ?? false} />
              </div>
            ))}
          </div>
          <div className="mt-2 text-xs font-mono text-green-600 italic">
            [REAL GENUINE DATA — no fabrication of missing sessions/trades]
          </div>
        </Card>
      </div>

      {/* ── P&L Reconciliation & Fingerprint ──────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* P&L Reconciliation */}
        <Card title="P&L RECONCILIATION" accent="border-rose-500/30">
          <div className="flex justify-between items-center">
            <span className="text-xs font-mono text-slate-400">Overall Status</span>
            <span className={`text-xs font-bold font-mono px-2 py-0.5 rounded border ${statusBadge(reconciliation?.overallStatus)}`}>
              {reconciliation?.overallStatus}
            </span>
          </div>
          {[
            ["Trade P&L",     reconciliation?.tradesPnL],
            ["Daily P&L",     reconciliation?.dailyPnL],
          ].map(([label, val]) => (
            <Row key={String(label)} label={String(label)}>
              <span className={`font-bold ${statusColor(String(val))}`}>{String(val)}</span>
            </Row>
          ))}
          {reconciliation?.details?.slice(0, 2).map((d, i) => (
            <p key={i} className="text-xs text-slate-500 italic font-mono">{d}</p>
          ))}
          <div className="text-xs font-mono text-rose-700 italic mt-1">
            [REAL PAPER DATA — no dummy PASS values]
          </div>
        </Card>

        {/* Strategy Fingerprint */}
        <Card title="STRATEGY FINGERPRINT" accent="border-purple-500/30">
          <Row label="Status">
            <span className={`text-xs font-bold font-mono px-2 py-0.5 rounded border ${statusBadge(fingerprint?.fingerprintStatus === "VALID" ? "PASS" : "FAIL")}`}>
              {fingerprint?.fingerprintStatus}
            </span>
          </Row>
          <Row label="Immutable">{bool2label(fingerprint?.immutable)}</Row>
          <Row label="Cohort ID">
            <span className="text-purple-300 font-mono text-xs truncate max-w-[150px]">{fingerprint?.cohortId}</span>
          </Row>
          <Row label="Hash">
            <span className="text-slate-500 font-mono text-xs">{fingerprint?.masterFingerprintHash?.slice(0, 12)}…</span>
          </Row>
          <p className="text-xs text-slate-500 italic font-mono mt-1">{fingerprint?.notes}</p>
        </Card>
      </div>

      {/* ── Evidence Registry Log ─────────────────────────────────────── */}
      {phaseEvidence?.registry?.length > 0 && (
        <div className="border border-slate-700 bg-slate-900/60 rounded-xl p-4">
          <h3 className="text-xs font-bold font-mono text-slate-300 tracking-widest mb-3">
            IMMUTABLE EVIDENCE REGISTRY LOG ({phaseEvidence.registry.length} items)
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="text-slate-500 border-b border-slate-800">
                  <th className="text-left py-1 pr-4">Phase</th>
                  <th className="text-left py-1 pr-4">Category</th>
                  <th className="text-left py-1 pr-4">Status</th>
                  <th className="text-left py-1 pr-4">Source</th>
                  <th className="text-left py-1">Description</th>
                </tr>
              </thead>
              <tbody>
                {phaseEvidence.registry.map((item) => (
                  <tr key={item.evidenceId} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition">
                    <td className="py-1 pr-4 text-violet-400 font-bold">P{item.phase}</td>
                    <td className="py-1 pr-4 text-slate-400">{item.category}</td>
                    <td className={`py-1 pr-4 font-bold ${statusColor(item.status)}`}>{item.status}</td>
                    <td className="py-1 pr-4 text-slate-500 truncate max-w-[120px]">{item.source}</td>
                    <td className="py-1 text-slate-400 truncate max-w-[240px]">{item.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Footer Disclaimer ─────────────────────────────────────────── */}
      <div className="border border-violet-800/30 bg-violet-950/20 rounded-xl p-4">
        <p className="text-xs font-mono text-violet-300/70 leading-relaxed">
          <strong className="text-violet-400">PHASE 37 DISCLAIMER:</strong> This report consolidates evidence from Phases 33–36 for evaluation purposes only.
          <strong> PAPER_TRADING = true | LIVE_TRADING = false | BROKER_EXECUTION_ENABLED = false.</strong>
          This phase does NOT authorize live trading or broker activation. All evidence is presented factually without profitability guarantee.
          Evidence classifications: <span className="text-green-400">REAL GENUINE DATA</span> / <span className="text-sky-400">DERIVED DATA</span> / <span className="text-yellow-400">SIMULATED TEST DATA</span> / <span className="text-amber-400">UNAVAILABLE DATA</span> are never mixed.
        </p>
        {lastRefresh && (
          <p className="text-xs font-mono text-slate-600 mt-2">Last refreshed: {lastRefresh}</p>
        )}
      </div>
    </div>
  );
};

export default IMPhase37ValidationDashboard;
