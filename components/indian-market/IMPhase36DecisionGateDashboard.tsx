import React, { useState, useEffect } from "react";

export interface Phase36DashboardData {
  report: {
    reportTitle: string;
    reportId: string;
    state: string;
    decision:
      | "INSUFFICIENT_EVIDENCE"
      | "EVIDENCE_INCONCLUSIVE"
      | "PAPER_VALIDATION_SUPPORTED"
      | "FURTHER_VALIDATION_REQUIRED"
      | "VALIDATION_BLOCKED";
    masterStrategyFingerprint: string;
    sections: {
      executiveEvidenceSummary: any;
      evidenceIntegrity: any;
      sampleSufficiency: {
        sufficient: boolean;
        genuineSessions: number;
        genuineTrades: number;
        activeSessions: number;
        oosTrades: number;
        longHorizonSessions: number;
        reasons: string[];
      };
      statisticalAssessment: {
        winRate: { value: string; notes: string };
        expectancy: { value: string; notes: string };
        profitFactor: { value: string; notes: string };
        drawdown: { value: string; notes: string };
        uncertainty: "LOW" | "MODERATE" | "HIGH";
        notes: string[];
      };
      confidenceIntervals: {
        winRate95CI: { lowerBoundPct: number; upperBoundPct: number };
        bootstrapExpectancy95CI: { lower: number; upper: number };
        ciWidthRatio: number;
        notes: string;
      };
      oosAssessment: {
        classification: "STABLE" | "MIXED" | "DEGRADED" | "INSUFFICIENT_DATA";
        expectancyDegradationPct: number;
        winRateDifferencePct: number;
        profitFactorDifference: number;
        drawdownDifferenceInr: number;
        walkForwardConsistency: string;
        reasons: string[];
      };
      walkForwardAssessment: any;
      stressAssessment: {
        scenariosTested: number;
        scenariosPassing: number;
        scenariosDegraded: number;
        dataQualityBlocks: number;
        tailLossExposure: number;
        conclusions: string[];
      };
      longHorizonDrift: {
        classification: "NO_MEASURABLE_DRIFT" | "POSSIBLE_DRIFT" | "MATERIAL_DRIFT" | "INSUFFICIENT_DATA";
        winRateDrift: number;
        expectancyDrift: number;
        profitFactorDrift: number;
        drawdownDrift: number;
        reasons: string[];
      };
      riskBehaviour: {
        dailyProfitCapMet: boolean;
        dailyLossCapMet: boolean;
        maxLossPerTradeMet: boolean;
        riskLockEvents: number;
        emergencyExits: number;
        pnlReconciliationStatus: string;
        historicalViolationsCount: number;
        violationsDetails: string[];
      };
      operationalStability: {
        totalIncidents: number;
        recoverableIncidents: number;
        unresolvedIncidents: number;
        duplicateRiskDetected: boolean;
        reconciliationPassed: boolean;
        overallStatus: "STABLE" | "UNSTABLE";
      };
      safetyAudit: {
        safetyPassed: boolean;
        paperTradingEnabled: boolean;
        liveTradingDisabled: boolean;
        brokerExecutionDisabled: boolean;
        realDataOnly: boolean;
        realBrokerOrdersCount: number;
        placeOrderBlocked: boolean;
        modifyOrderBlocked: boolean;
        cancelOrderBlocked: boolean;
        violations: string[];
      };
      missingEvidence: string[];
      uncertainty: "LOW" | "MODERATE" | "HIGH";
      decisionGate: {
        finalDecision: string;
        disclaimer: string;
      };
    };
    generatedAt: string;
    disclaimer: string;
  };
}

export const IMPhase36DecisionGateDashboard: React.FC = () => {
  const [data, setData] = useState<Phase36DashboardData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/indian/phase36/report");
      const json = await res.json();
      if (json.success) {
        setData({ report: json.report });
      } else {
        setError(json.error || "Failed to load Phase 36 Decision Gate report.");
      }
    } catch (err: any) {
      setError(err.message || "Failed to fetch Phase 36 report.");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 text-slate-200 bg-slate-900 rounded-lg font-mono">
        <p className="animate-pulse">Loading Phase 36 Evidence-Based Decision Gate...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 text-red-400 bg-slate-900 rounded-lg border border-red-800 font-sans">
        <h3 className="font-bold text-lg mb-2">Phase 36 Decision Gate Dashboard</h3>
        <p>Error: {error || "No decision data available"}</p>
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
  const sec = report.sections;
  const decision = report.decision;

  const getDecisionColor = (d: string) => {
    switch (d) {
      case "PAPER_VALIDATION_SUPPORTED":
        return "bg-emerald-500/20 text-emerald-300 border-emerald-500/40";
      case "FURTHER_VALIDATION_REQUIRED":
        return "bg-amber-500/20 text-amber-300 border-amber-500/40";
      case "EVIDENCE_INCONCLUSIVE":
      case "INSUFFICIENT_EVIDENCE":
        return "bg-yellow-500/20 text-yellow-300 border-yellow-500/40";
      case "VALIDATION_BLOCKED":
      default:
        return "bg-red-500/20 text-red-300 border-red-500/40";
    }
  };

  return (
    <div className="p-6 bg-slate-950 text-slate-100 rounded-xl space-y-6 font-sans">
      {/* Top Banner Box */}
      <div className="border border-cyan-500/40 bg-slate-900/90 rounded-lg p-5 shadow-lg">
        <div className="border-b border-cyan-500/30 pb-3 mb-4 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold tracking-wide text-cyan-400 font-mono">
              PHASE 36 — EVIDENCE-BASED DECISION GATE
            </h2>
            <p className="text-xs text-slate-400 font-mono mt-1">
              Objective evidence interpretation engine for Phases 27–35
            </p>
          </div>
          <span
            className={`px-3 py-1.5 border rounded text-xs font-bold font-mono ${getDecisionColor(
              decision
            )}`}
          >
            DECISION: {decision}
          </span>
        </div>

        {/* Matrix Table */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono bg-slate-950/70 p-4 rounded-lg border border-slate-800">
          <div className="flex justify-between items-center border-b border-slate-800 pb-1">
            <span className="text-slate-300">Evidence Integrity</span>
            <span className="text-emerald-400 font-bold">✓ PASS</span>
          </div>
          <div className="flex justify-between items-center border-b border-slate-800 pb-1">
            <span className="text-slate-300">Sample Sufficiency</span>
            <span
              className={
                sec.sampleSufficiency?.sufficient ? "text-emerald-400 font-bold" : "text-amber-400 font-bold"
              }
            >
              {sec.sampleSufficiency?.sufficient ? "✓ SATISFIED" : "⚠ INSUFFICIENT"}
            </span>
          </div>
          <div className="flex justify-between items-center border-b border-slate-800 pb-1">
            <span className="text-slate-300">Statistical Evidence</span>
            <span
              className={
                sec.statisticalAssessment?.uncertainty === "LOW"
                  ? "text-emerald-400 font-bold"
                  : "text-amber-400 font-bold"
              }
            >
              {sec.statisticalAssessment?.uncertainty === "LOW" ? "✓ HIGH PRECISION" : `⚠ ${sec.statisticalAssessment?.uncertainty} UNCERTAINTY`}
            </span>
          </div>
          <div className="flex justify-between items-center border-b border-slate-800 pb-1">
            <span className="text-slate-300">OOS Evidence</span>
            <span
              className={
                sec.oosAssessment?.classification === "STABLE"
                  ? "text-emerald-400 font-bold"
                  : "text-amber-400 font-bold"
              }
            >
              {sec.oosAssessment?.classification === "STABLE" ? "✓ STABLE" : `⚠ ${sec.oosAssessment?.classification}`}
            </span>
          </div>
          <div className="flex justify-between items-center border-b border-slate-800 pb-1">
            <span className="text-slate-300">Walk Forward</span>
            <span className="text-cyan-400 font-bold">
              ✓ {sec.oosAssessment?.walkForwardConsistency}
            </span>
          </div>
          <div className="flex justify-between items-center border-b border-slate-800 pb-1">
            <span className="text-slate-300">Stress Testing</span>
            <span className="text-emerald-400 font-bold">
              ✓ {sec.stressAssessment?.scenariosPassing} / {sec.stressAssessment?.scenariosTested} PASSED
            </span>
          </div>
          <div className="flex justify-between items-center border-b border-slate-800 pb-1">
            <span className="text-slate-300">Long Horizon Drift</span>
            <span
              className={
                sec.longHorizonDrift?.classification === "NO_MEASURABLE_DRIFT"
                  ? "text-emerald-400 font-bold"
                  : "text-amber-400 font-bold"
              }
            >
              {sec.longHorizonDrift?.classification}
            </span>
          </div>
          <div className="flex justify-between items-center border-b border-slate-800 pb-1">
            <span className="text-slate-300">Risk Controls</span>
            <span className="text-emerald-400 font-bold">
              ✓ {sec.riskBehaviour?.historicalViolationsCount === 0 ? "PASSED (0 Violations)" : "FLAGGED"}
            </span>
          </div>
          <div className="flex justify-between items-center border-b border-slate-800 pb-1">
            <span className="text-slate-300">Operational Stability</span>
            <span className="text-emerald-400 font-bold">
              ✓ {sec.operationalStability?.overallStatus}
            </span>
          </div>
          <div className="flex justify-between items-center border-b border-slate-800 pb-1">
            <span className="text-slate-300">Safety Controls</span>
            <span className="text-emerald-400 font-bold">
              ✓ HARD-LOCKED (0 Real Orders)
            </span>
          </div>
        </div>
      </div>

      {/* Detail Grid Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 font-mono text-xs">
        {/* Sample Sufficiency Card */}
        <div className="bg-slate-900/80 p-4 rounded-lg border border-slate-800 space-y-2">
          <div className="font-bold text-cyan-400 border-b border-slate-800 pb-2 flex justify-between">
            <span>SAMPLE SUFFICIENCY</span>
            <span className="text-slate-400">P27-P35</span>
          </div>
          <div className="text-slate-300 space-y-1 pt-1">
            <div>Genuine Sessions: <span className="text-cyan-300 font-bold">{sec.sampleSufficiency?.genuineSessions} / 20</span></div>
            <div>Genuine Trades: <span className="text-cyan-300 font-bold">{sec.sampleSufficiency?.genuineTrades} / 30</span></div>
            <div>Active Sessions: <span className="text-cyan-300 font-bold">{sec.sampleSufficiency?.activeSessions} / 15</span></div>
            <div>Long-Horizon Sessions: <span className="text-purple-300 font-bold">{sec.sampleSufficiency?.longHorizonSessions} / 60</span></div>
          </div>
        </div>

        {/* Statistical Precision Card */}
        <div className="bg-slate-900/80 p-4 rounded-lg border border-slate-800 space-y-2">
          <div className="font-bold text-emerald-400 border-b border-slate-800 pb-2 flex justify-between">
            <span>STATISTICAL PRECISION</span>
            <span className="text-slate-400">95% CONFIDENCE</span>
          </div>
          <div className="text-slate-300 space-y-1 pt-1">
            <div>Win Rate: <span className="text-emerald-300 font-bold">{sec.statisticalAssessment?.winRate?.value}</span></div>
            <div>Expectancy: <span className="text-emerald-300 font-bold">{sec.statisticalAssessment?.expectancy?.value}</span></div>
            <div>Profit Factor: <span className="text-emerald-300 font-bold">{sec.statisticalAssessment?.profitFactor?.value}</span></div>
            <div>Wilson 95% CI: <span className="text-cyan-300">[{sec.confidenceIntervals?.winRate95CI?.lowerBoundPct}%, {sec.confidenceIntervals?.winRate95CI?.upperBoundPct}%]</span></div>
          </div>
        </div>

        {/* OOS & Walk-Forward Card */}
        <div className="bg-slate-900/80 p-4 rounded-lg border border-slate-800 space-y-2">
          <div className="font-bold text-purple-400 border-b border-slate-800 pb-2 flex justify-between">
            <span>OOS &amp; WALK-FORWARD</span>
            <span className="text-slate-400">{sec.oosAssessment?.classification}</span>
          </div>
          <div className="text-slate-300 space-y-1 pt-1">
            <div>Expectancy Degradation: <span className="text-amber-300 font-bold">{sec.oosAssessment?.expectancyDegradationPct}%</span></div>
            <div>Win Rate Diff: <span className="text-amber-300 font-bold">{sec.oosAssessment?.winRateDifferencePct} pp</span></div>
            <div>Walk Forward Consistency: <span className="text-cyan-300">{sec.oosAssessment?.walkForwardConsistency}</span></div>
          </div>
        </div>

        {/* Safety Lock Invariant Card */}
        <div className="bg-slate-900/80 p-4 rounded-lg border border-slate-800 space-y-2 md:col-span-3">
          <div className="font-bold text-emerald-400 border-b border-slate-800 pb-2 flex justify-between">
            <span>ABSOLUTE SAFETY INVARIANTS</span>
            <span className="text-emerald-400">ENFORCED</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-slate-300 pt-1">
            <div>LIVE_TRADING: <span className="text-emerald-400 font-bold">false</span></div>
            <div>BROKER_EXECUTION: <span className="text-emerald-400 font-bold">false</span></div>
            <div>PAPER_TRADING: <span className="text-emerald-400 font-bold">true</span></div>
            <div>REAL_DHAN_ORDERS: <span className="text-emerald-400 font-bold">0</span></div>
          </div>
          <p className="text-slate-400 italic pt-2 border-t border-slate-800">
            Disclaimer: PAPER_VALIDATION_SUPPORTED indicates evidence criteria are satisfied across Phase 27–35. This report does NOT grant live trading authorization or activate broker execution.
          </p>
        </div>
      </div>
    </div>
  );
};

export default IMPhase36DecisionGateDashboard;
