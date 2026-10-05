"use client";
import React, { useState, useEffect, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────
type AuditVerdict = "PASS" | "FAIL" | "NOT_VERIFIABLE" | "NOT_TESTABLE";
type EvidenceClass = "PROVEN" | "DERIVED" | "UNAVAILABLE" | "NOT_TESTABLE";
type Phase40State =
  | "FINAL_AUDIT_IN_PROGRESS"
  | "FINAL_AUDIT_FAILED"
  | "PAPER_PRODUCTION_READY"
  | "NOT_READY_FOR_LIVE";

interface SectionAudit {
  verdict: AuditVerdict;
  violations?: string[];
  notes?: string[];
}

interface Phase40Report {
  reportId: string;
  generatedAt: string;
  projectVersion: string;
  strategyFingerprint: string;
  phase39CohortId: string;
  phase39CohortHash: string;
  phase39EvidenceHash: string;
  safetyInvariant: {
    paperTrading: boolean;
    liveTrading: boolean;
    brokerExecution: boolean;
    realDataOnly: boolean;
    realDhanOrders: number;
    placeOrderBlocked: boolean;
    modifyOrderBlocked: boolean;
    cancelOrderBlocked: boolean;
    verdict: AuditVerdict;
    violations: string[];
  };
  phase39Cohort: {
    cohortExists: boolean;
    cohortId: string;
    hashValid: boolean;
    fingerprintValid: boolean;
    noDuplicateObservations: boolean;
    allTimestampsValid: boolean;
    reconciliationValid: boolean;
    evidenceHashReproducible: boolean;
    verdict: AuditVerdict;
    violations: string[];
  };
  strategyIntegrity: {
    fingerprintMatch: boolean;
    masterFingerprintHash: string;
    strategyVersion: string;
    componentsVerified: string[];
    verdict: AuditVerdict;
    violations: string[];
  };
  genuineData: {
    realOptionChain: EvidenceClass;
    realOptionPrices: EvidenceClass;
    realSpot: EvidenceClass;
    safetyLocksValid: EvidenceClass;
    syntheticDataDetected: boolean;
    verdict: AuditVerdict;
    notes: string[];
  };
  statisticalEvidence: {
    winRateCI: EvidenceClass;
    expectancy: EvidenceClass;
    profitFactor: EvidenceClass;
    drawdown: EvidenceClass;
    bootstrapResults: EvidenceClass;
    monteCarloLabel: string;
    oosStatus: EvidenceClass;
    walkForwardStatus: EvidenceClass;
    stressStatus: EvidenceClass;
    driftStatus: EvidenceClass;
    verdict: AuditVerdict;
    disclaimer: string;
  };
  pnlReconciliation: {
    tradeLevelPnL: EvidenceClass;
    sessionLevelPnL: EvidenceClass;
    cumulativePnL: EvidenceClass;
    maxDiscrepancy: number;
    tolerancePassed: boolean;
    verdict: AuditVerdict;
    violations: string[];
  };
  riskControl: {
    maxLossPerTrade: boolean;
    dailyProfitLock: boolean;
    dailyLossLock: boolean;
    maxTradesPerDay: boolean;
    maxConsecutiveLosses: boolean;
    hedgeFirstEnforced: boolean;
    noNakedShort: boolean;
    staleDataProtection: boolean;
    greekProtection: boolean;
    lotSizeVerification: boolean;
    expiryValidation: boolean;
    duplicatePrevention: boolean;
    killSwitch: boolean;
    verdict: AuditVerdict;
    violations: string[];
  };
  executionSafety: {
    paperAdapterOnly: boolean;
    dhanReadOnly: boolean;
    placeOrderBlocked: boolean;
    modifyOrderBlocked: boolean;
    cancelOrderBlocked: boolean;
    failClosedBeforeNetwork: boolean;
    verdict: AuditVerdict;
    violations: string[];
  };
  crashRestart: SectionAudit;
  dataFailure: { syntheticFallbackPrevented: boolean; verdict: AuditVerdict };
  security: SectionAudit;
  deployment: {
    frontendBuildPass: boolean;
    backendTypescriptPass: boolean;
    liveTrading_env: boolean;
    brokerExecution_env: boolean;
    verdict: AuditVerdict;
    violations: string[];
  };
  regression: {
    testFiles: number;
    totalTests: number;
    passed: number;
    failed: number;
    regressions: number;
    typescriptErrors: number;
    buildPass: boolean;
    verdict: AuditVerdict;
  };
  finalState: Phase40State;
  mandatoryAuditsFailed: string[];
  explicitLimitations: string[];
  immutableHash: string;
}

// ─── Colour helpers ───────────────────────────────────────────────────────────
const VERDICT_COLORS: Record<AuditVerdict, string> = {
  PASS: "text-emerald-400",
  FAIL: "text-red-400",
  NOT_VERIFIABLE: "text-amber-400",
  NOT_TESTABLE: "text-slate-400",
};
const EVIDENCE_COLORS: Record<EvidenceClass, string> = {
  PROVEN: "text-emerald-400",
  DERIVED: "text-blue-400",
  UNAVAILABLE: "text-slate-500",
  NOT_TESTABLE: "text-amber-400",
};
const BOOL_COLOR = (v: boolean) => (v ? "text-emerald-400" : "text-red-400");
const BOOL_LABEL = (v: boolean, trueLabel = "✓", falseLabel = "✗") =>
  v ? trueLabel : falseLabel;

// ─── Sub-components ───────────────────────────────────────────────────────────
function VerdictBadge({ verdict }: { verdict: AuditVerdict }) {
  const bg: Record<AuditVerdict, string> = {
    PASS: "bg-emerald-900/40 border-emerald-600/50 text-emerald-300",
    FAIL: "bg-red-900/40 border-red-600/50 text-red-300",
    NOT_VERIFIABLE: "bg-amber-900/40 border-amber-600/50 text-amber-300",
    NOT_TESTABLE: "bg-slate-800/50 border-slate-600/40 text-slate-400",
  };
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${bg[verdict]}`}
    >
      {verdict}
    </span>
  );
}

function SectionCard({
  title,
  icon,
  verdict,
  children,
}: {
  title: string;
  icon: string;
  verdict?: AuditVerdict;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-slate-900/60 border border-slate-700/50 rounded-xl p-5 backdrop-blur-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-xl">{icon}</span>
          <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
            {title}
          </h3>
        </div>
        {verdict && <VerdictBadge verdict={verdict} />}
      </div>
      {children}
    </div>
  );
}

function Row({
  label,
  value,
  className = "",
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-center justify-between py-1.5 border-b border-slate-800/50 last:border-0 ${className}`}>
      <span className="text-xs text-slate-400">{label}</span>
      <span className="text-xs font-mono">{value}</span>
    </div>
  );
}

function BoolRow({ label, value }: { label: string; value: boolean }) {
  return (
    <Row
      label={label}
      value={
        <span className={`font-semibold ${BOOL_COLOR(value)}`}>
          {BOOL_LABEL(value, "TRUE ✓", "FALSE ✗")}
        </span>
      }
    />
  );
}

function EvidRow({ label, value }: { label: string; value: EvidenceClass }) {
  return (
    <Row
      label={label}
      value={<span className={`font-semibold ${EVIDENCE_COLORS[value]}`}>{value}</span>}
    />
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export default function IMPhase40FinalReadinessDashboard() {
  const [report, setReport] = useState<Phase40Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchReport = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/indian/phase40/report");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.success && data.report) {
        setReport(data.report);
        setLastRefresh(new Date());
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load Phase 40 report");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReport();
    const interval = setInterval(fetchReport, 60000);
    return () => clearInterval(interval);
  }, [fetchReport]);

  const finalDecisionStyle = (state: Phase40State) => {
    if (state === "PAPER_PRODUCTION_READY")
      return "bg-emerald-950/70 border-emerald-500/60 text-emerald-200";
    if (state === "FINAL_AUDIT_FAILED")
      return "bg-red-950/70 border-red-500/60 text-red-200";
    return "bg-slate-900/70 border-slate-600/50 text-slate-300";
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-6">
      {/* Header */}
      <div className="max-w-7xl mx-auto mb-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-600 to-indigo-700 flex items-center justify-center text-sm font-bold">
                40
              </div>
              <h1 className="text-xl font-bold text-white tracking-tight">
                Phase 40 — Final Production Readiness Audit
              </h1>
            </div>
            <p className="text-xs text-slate-500 ml-11">
              Project completion audit · Paper-trading validation only ·{" "}
              {lastRefresh
                ? `Last refreshed: ${lastRefresh.toLocaleTimeString()}`
                : "Loading…"}
            </p>
          </div>
          <button
            onClick={fetchReport}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            {loading ? "⟳ Refreshing…" : "⟳ Refresh"}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="max-w-7xl mx-auto mb-4 p-3 bg-red-950/50 border border-red-700/50 rounded-lg text-red-300 text-sm">
          ⚠ {error}
        </div>
      )}

      {/* Skeleton */}
      {loading && !report && (
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 animate-pulse">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="h-48 bg-slate-900/60 rounded-xl border border-slate-800" />
          ))}
        </div>
      )}

      {report && (
        <div className="max-w-7xl mx-auto space-y-6">
          {/* ── Final Decision Banner ── */}
          <div
            className={`rounded-2xl border-2 p-6 ${finalDecisionStyle(report.finalState)}`}
          >
            <div className="flex flex-col md:flex-row md:items-center gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-2xl">
                    {report.finalState === "PAPER_PRODUCTION_READY" ? "🟢" : "🔴"}
                  </span>
                  <span className="text-2xl font-extrabold tracking-tight">
                    {report.finalState === "PAPER_PRODUCTION_READY"
                      ? "PAPER PRODUCTION READY"
                      : "FINAL AUDIT FAILED"}
                  </span>
                </div>
                <p className="text-xs opacity-70 mb-1">
                  Version: {report.projectVersion} · Generated: {report.generatedAt}
                </p>
                <div className="flex items-center gap-2 mt-3">
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-red-950/80 border border-red-700/60 text-red-300">
                    LIVE_TRADING = FALSE
                  </span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-red-950/80 border border-red-700/60 text-red-300">
                    BROKER_EXECUTION = FALSE
                  </span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-950/80 border border-emerald-700/60 text-emerald-300">
                    PAPER_TRADING = TRUE
                  </span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-slate-500 mb-1">Evidence Hash</div>
                <div className="font-mono text-[10px] text-slate-400 break-all max-w-[260px]">
                  {report.immutableHash}
                </div>
              </div>
            </div>
            {report.mandatoryAuditsFailed.length > 0 && (
              <div className="mt-4 pt-4 border-t border-red-700/30">
                <div className="text-xs font-semibold text-red-300 mb-2">
                  Mandatory Audits Failed:
                </div>
                <div className="flex flex-wrap gap-2">
                  {report.mandatoryAuditsFailed.map((f) => (
                    <span
                      key={f}
                      className="px-2 py-0.5 rounded text-[10px] bg-red-950 border border-red-700 text-red-300 font-mono"
                    >
                      {f}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── NEVER LIVE READY warning ── */}
          <div className="rounded-xl border border-amber-700/40 bg-amber-950/30 p-3 flex items-start gap-3">
            <span className="text-amber-400 text-lg mt-0.5">⚠</span>
            <div className="text-xs text-amber-300 leading-relaxed">
              <strong>This system cannot be LIVE_READY.</strong> Broker execution is
              permanently and architecturally disabled. The highest achievable state is{" "}
              <code className="text-amber-200">PAPER_PRODUCTION_READY</code>. This audit
              verifies process integrity only — it does NOT guarantee future profitability.
            </div>
          </div>

          {/* ── Sections grid ── */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {/* SAFETY */}
            <SectionCard title="Safety" icon="🔒" verdict={report.safetyInvariant.verdict}>
              <BoolRow label="PAPER_TRADING" value={report.safetyInvariant.paperTrading} />
              <BoolRow label="LIVE_TRADING (must be false)" value={!report.safetyInvariant.liveTrading} />
              <BoolRow label="BROKER_EXECUTION (must be false)" value={!report.safetyInvariant.brokerExecution} />
              <BoolRow label="REAL_DATA_ONLY" value={report.safetyInvariant.realDataOnly} />
              <Row
                label="Real Dhan Orders"
                value={
                  <span className={BOOL_COLOR(report.safetyInvariant.realDhanOrders === 0)}>
                    {report.safetyInvariant.realDhanOrders}
                  </span>
                }
              />
              <BoolRow label="placeOrder BLOCKED" value={report.safetyInvariant.placeOrderBlocked} />
              <BoolRow label="modifyOrder BLOCKED" value={report.safetyInvariant.modifyOrderBlocked} />
              <BoolRow label="cancelOrder BLOCKED" value={report.safetyInvariant.cancelOrderBlocked} />
            </SectionCard>

            {/* DATA */}
            <SectionCard title="Data" icon="📡" verdict={report.genuineData.verdict}>
              <EvidRow label="Real Option Chain" value={report.genuineData.realOptionChain} />
              <EvidRow label="Real Option Prices" value={report.genuineData.realOptionPrices} />
              <EvidRow label="Real Spot" value={report.genuineData.realSpot} />
              <EvidRow label="Safety Locks" value={report.genuineData.safetyLocksValid} />
              <BoolRow label="Synthetic Data Detected" value={!report.genuineData.syntheticDataDetected} />
              <div className="mt-2 pt-2 border-t border-slate-800/50">
                <div className="text-[10px] text-slate-500 italic">
                  Real-time data status is NOT_TESTABLE outside market hours (09:15–15:20 IST)
                </div>
              </div>
            </SectionCard>

            {/* STRATEGY */}
            <SectionCard title="Strategy" icon="🧬" verdict={report.strategyIntegrity.verdict}>
              <BoolRow label="Fingerprint Match" value={report.strategyIntegrity.fingerprintMatch} />
              <Row label="Strategy Version" value={<span className="text-slate-300">{report.strategyIntegrity.strategyVersion}</span>} />
              <Row
                label="Fingerprint Hash"
                value={
                  <span className="text-[9px] font-mono text-slate-400 break-all max-w-[160px] text-right block">
                    {report.strategyIntegrity.masterFingerprintHash.slice(0, 16)}…
                  </span>
                }
              />
              <div className="mt-2 pt-2 border-t border-slate-800/50">
                <div className="text-[10px] text-slate-500 mb-1">Components Verified</div>
                <div className="text-[10px] text-slate-400 space-y-0.5">
                  {report.strategyIntegrity.componentsVerified.slice(0, 6).map((c) => (
                    <div key={c}>✓ {c}</div>
                  ))}
                  {report.strategyIntegrity.componentsVerified.length > 6 && (
                    <div className="text-slate-500">
                      +{report.strategyIntegrity.componentsVerified.length - 6} more
                    </div>
                  )}
                </div>
              </div>
            </SectionCard>

            {/* VALIDATION */}
            <SectionCard title="Validation" icon="📊" verdict={report.statisticalEvidence.verdict}>
              <EvidRow label="Win-Rate 95% CI" value={report.statisticalEvidence.winRateCI} />
              <EvidRow label="Expectancy" value={report.statisticalEvidence.expectancy} />
              <EvidRow label="Profit Factor" value={report.statisticalEvidence.profitFactor} />
              <EvidRow label="Drawdown" value={report.statisticalEvidence.drawdown} />
              <EvidRow label="Bootstrap Results" value={report.statisticalEvidence.bootstrapResults} />
              <EvidRow label="OOS Status" value={report.statisticalEvidence.oosStatus} />
              <EvidRow label="Walk-Forward" value={report.statisticalEvidence.walkForwardStatus} />
              <EvidRow label="Stress" value={report.statisticalEvidence.stressStatus} />
              <EvidRow label="Drift" value={report.statisticalEvidence.driftStatus} />
              <Row
                label="Monte Carlo Label"
                value={
                  <span className="text-amber-300 text-[10px]">
                    {report.statisticalEvidence.monteCarloLabel}
                  </span>
                }
              />
            </SectionCard>

            {/* RISK */}
            <SectionCard title="Risk" icon="⚖️" verdict={report.riskControl.verdict}>
              <BoolRow label="Max Loss ≤ ₹1,000/trade" value={report.riskControl.maxLossPerTrade} />
              <BoolRow label="Daily Profit Lock ₹1,000" value={report.riskControl.dailyProfitLock} />
              <BoolRow label="Daily Loss Lock -₹5,000" value={report.riskControl.dailyLossLock} />
              <BoolRow label="Max Trades/Day = 3" value={report.riskControl.maxTradesPerDay} />
              <BoolRow label="Max Consec. Losses = 2" value={report.riskControl.maxConsecutiveLosses} />
              <BoolRow label="Hedge-First Enforced" value={report.riskControl.hedgeFirstEnforced} />
              <BoolRow label="No Naked Short" value={report.riskControl.noNakedShort} />
              <BoolRow label="Stale Data Protection" value={report.riskControl.staleDataProtection} />
              <BoolRow label="Greek Gate" value={report.riskControl.greekProtection} />
              <BoolRow label="Lot Size Verification" value={report.riskControl.lotSizeVerification} />
              <BoolRow label="Kill Switch" value={report.riskControl.killSwitch} />
            </SectionCard>

            {/* OPERATIONS */}
            <SectionCard title="Operations" icon="🛠" verdict={report.crashRestart.verdict}>
              <BoolRow label="Frontend Build" value={report.deployment.frontendBuildPass} />
              <BoolRow label="Backend TypeScript" value={report.deployment.backendTypescriptPass} />
              <BoolRow label="LIVE_TRADING env = false" value={!report.deployment.liveTrading_env} />
              <BoolRow label="BROKER_EXEC env = false" value={!report.deployment.brokerExecution_env} />
              <BoolRow label="Synthetic Fallback Prevented" value={report.dataFailure.syntheticFallbackPrevented} />
              <BoolRow label="Paper Adapter Only" value={report.executionSafety.paperAdapterOnly} />
              <BoolRow label="Dhan Read-Only" value={report.executionSafety.dhanReadOnly} />
              <BoolRow label="Security Audit" value={report.security.verdict === "PASS"} />
            </SectionCard>

            {/* COHORT */}
            <SectionCard title="Phase39 Cohort" icon="🔐" verdict={report.phase39Cohort.verdict}>
              <BoolRow label="Cohort Exists" value={report.phase39Cohort.cohortExists} />
              <BoolRow label="Hash Valid" value={report.phase39Cohort.hashValid} />
              <BoolRow label="Fingerprint Valid" value={report.phase39Cohort.fingerprintValid} />
              <BoolRow label="No Duplicates" value={report.phase39Cohort.noDuplicateObservations} />
              <BoolRow label="Timestamps Valid" value={report.phase39Cohort.allTimestampsValid} />
              <BoolRow label="PnL Reconciliation" value={report.phase39Cohort.reconciliationValid} />
              <BoolRow label="Hash Reproducible" value={report.phase39Cohort.evidenceHashReproducible} />
              {report.phase39Cohort.cohortExists && (
                <Row
                  label="Cohort ID"
                  value={
                    <span className="text-[9px] font-mono text-slate-400">
                      {report.phase39CohortId.slice(0, 20)}…
                    </span>
                  }
                />
              )}
            </SectionCard>

            {/* P&L */}
            <SectionCard title="P&L Reconciliation" icon="💰" verdict={report.pnlReconciliation.verdict}>
              <EvidRow label="Trade-Level PnL" value={report.pnlReconciliation.tradeLevelPnL} />
              <EvidRow label="Session-Level PnL" value={report.pnlReconciliation.sessionLevelPnL} />
              <EvidRow label="Cumulative PnL" value={report.pnlReconciliation.cumulativePnL} />
              <BoolRow label="Tolerance Passed" value={report.pnlReconciliation.tolerancePassed} />
              <Row
                label="Max Discrepancy"
                value={
                  <span className={BOOL_COLOR(report.pnlReconciliation.tolerancePassed)}>
                    {report.pnlReconciliation.maxDiscrepancy.toFixed(4)}
                  </span>
                }
              />
            </SectionCard>

            {/* REGRESSION */}
            <SectionCard title="Regression" icon="🧪" verdict={report.regression.verdict}>
              <Row label="Test Files" value={<span className="text-slate-300">{report.regression.testFiles}</span>} />
              <Row label="Total Tests" value={<span className="text-slate-300">{report.regression.totalTests}</span>} />
              <Row
                label="Passed"
                value={<span className="text-emerald-400 font-semibold">{report.regression.passed}</span>}
              />
              <Row
                label="Failed"
                value={
                  <span className={report.regression.failed === 0 ? "text-emerald-400" : "text-red-400"}>
                    {report.regression.failed}
                  </span>
                }
              />
              <Row
                label="Regressions"
                value={
                  <span className={report.regression.regressions === 0 ? "text-emerald-400" : "text-red-400"}>
                    {report.regression.regressions}
                  </span>
                }
              />
              <Row
                label="TypeScript Errors"
                value={
                  <span className={report.regression.typescriptErrors === 0 ? "text-emerald-400" : "text-red-400"}>
                    {report.regression.typescriptErrors}
                  </span>
                }
              />
              <BoolRow label="Build Pass" value={report.regression.buildPass} />
            </SectionCard>
          </div>

          {/* Explicit Limitations */}
          <div className="bg-slate-900/60 border border-slate-700/50 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-3">
              ⚠ Explicit Limitations
            </h3>
            <ul className="space-y-1.5">
              {report.explicitLimitations.map((l, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-slate-400">
                  <span className="text-amber-500 mt-0.5 shrink-0">•</span>
                  {l}
                </li>
              ))}
            </ul>
          </div>

          {/* Footer */}
          <div className="text-center text-[11px] text-slate-600 pb-4">
            Phase 40 is the FINAL planned phase of this Trading Journey project.
            No Phase 41+ exists unless a genuine defect is separately identified.
            <br />
            This dashboard verifies <strong className="text-slate-500">process integrity only</strong> —
            it does <strong className="text-slate-500">NOT</strong> guarantee future profitability.
          </div>
        </div>
      )}
    </div>
  );
}
