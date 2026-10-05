"use client";

import React, { useState, useEffect } from "react";

export interface Phase28ReportData {
  validationStatus: "INSUFFICIENT_SAMPLE" | "SAMPLE_COMPLETE";
  gateDetails: {
    genuineSessions: number;
    requiredSessions: number;
    sessionsMet: boolean;
    genuineTrades: number;
    requiredTrades: number;
    tradesMet: boolean;
    activeSessions: number;
    requiredActiveSessions: number;
    activeSessionsMet: boolean;
  };
  coreStatistics: {
    totalGrossPnL: number;
    totalCharges: number;
    totalSlippage: number;
    totalNetPnL: number;
    averageNetPnL: number;
    medianNetPnL: number;
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    breakevenTrades: number;
    winRate: number;
    lossRate: number;
    averageWinner: number;
    averageLoser: number;
    winLossRatio: number | "NOT_AVAILABLE";
    profitFactor: number | "NOT_AVAILABLE";
    expectancy: number;
    maxDrawdown: number;
    maxDrawdownPercent: number;
    largestWin: number;
    largestLoss: number;
    maxConsecutiveWins: number;
    maxConsecutiveLosses: number;
    recoveryFactor: number | "NOT_AVAILABLE";
  };
  winRateConfidence: {
    observedWinRatePct: number;
    sampleSize: number;
    confidenceLevel: number;
    lowerBoundPct: number;
    upperBoundPct: number;
  };
  bootstrapExpectancy: {
    observedExpectancy: number;
    bootstrapMean: number;
    confidenceInterval95: {
      lower: number;
      upper: number;
    };
    iterations: number;
  };
  timeStabilityBlocks: Array<{
    blockName: string;
    tradeRange: string;
    tradeCount: number;
    netPnL: number;
    expectancy: number;
    winRate: number;
    profitFactor: number | "NOT_AVAILABLE";
    maxDrawdown: number;
  }>;
  rollingWindows: Array<{
    windowSize: number;
    windowLabel: string;
    winRate: number;
    expectancy: number;
    profitFactor: number | "NOT_AVAILABLE";
    netPnL: number;
    drawdown: number;
  }>;
  regimeEvidence: Array<{
    regime: string;
    tradeCount: number;
    winRate: number;
    netPnL: number;
    averagePnL: number;
    expectancy: number;
    profitFactor: number | "NOT_AVAILABLE";
    maxDrawdown: number;
    lowSampleWarning: boolean;
  }>;
  strategyEvidence: Array<{
    strategy: string;
    tradeCount: number;
    winRate: number;
    netPnL: number;
    averagePnL: number;
    expectancy: number;
    profitFactor: number | "NOT_AVAILABLE";
    maxDrawdown: number;
  }>;
  concentrationAnalysis: {
    grossProfitTotal: number;
    grossLossTotal: number;
    winnersConcentration: {
      top1ContributionInr: number;
      top1ContributionPct: number;
      top3ContributionInr: number;
      top3ContributionPct: number;
      top5ContributionInr: number;
      top5ContributionPct: number;
    };
    losersConcentration: {
      top1ContributionInr: number;
      top1ContributionPct: number;
      top3ContributionInr: number;
      top3ContributionPct: number;
      top5ContributionInr: number;
      top5ContributionPct: number;
    };
  };
  monteCarloDiagnostic: {
    iterations: number;
    maxDrawdownDistribution: { mean: number; p95: number; worst: number };
    finalPnlDistribution: { mean: number; p5: number; worst: number };
    longestLosingStreakDistribution: { mean: number; max: number };
    probabilityOfNegativeEndingPnlPct: number;
    disclaimer: string;
  };
  dailyTargetAnalysis: {
    daysAtOrAbove1000: number;
    daysBelow1000: number;
    lossDays: number;
    noTradeDays: number;
    averageDailyNetPnL: number;
    medianDailyNetPnL: number;
    targetAchievementRatePct: number;
  };
  fingerprintStatus: {
    baselineFingerprint: string;
    currentFingerprint: string;
    fingerprintStatus: "VALIDATED" | "STRATEGY_CHANGED";
  };
  exclusions: {
    simulatedExcluded: number;
    syntheticExcluded: number;
    invalidExcluded: number;
    staleExcluded: number;
    afterHoursExcluded: number;
    duplicateExcluded: number;
  };
  generatedAt: string;
}

export default function IMPhase28StatisticalEvidenceDashboard() {
  const [report, setReport] = useState<Phase28ReportData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSummary = async () => {
    try {
      const res = await fetch("/api/indian/phase28/summary");
      if (res.ok) {
        const json = await res.json();
        setReport(json);
        setError(null);
      } else {
        setError(`HTTP ${res.status}`);
      }
    } catch (err: any) {
      setError(err.message || "Failed to fetch evidence summary");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSummary();
    const interval = setInterval(fetchSummary, 5000);
    return () => clearInterval(interval);
  }, []);

  const getStatusBadgeClass = (status: string) => {
    if (status === "SAMPLE_COMPLETE" || status === "VALIDATED") {
      return "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
    }
    return "bg-amber-500/10 text-amber-400 border-amber-500/30";
  };

  return (
    <div className="w-full bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-xl p-6 shadow-2xl space-y-6 text-slate-100">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-slate-800 pb-4 gap-4">
        <div>
          <div className="flex items-center gap-3">
            <span
              className={`h-3 w-3 rounded-full ${
                report?.validationStatus === "SAMPLE_COMPLETE"
                  ? "bg-emerald-500 animate-pulse"
                  : "bg-amber-500 animate-ping"
              }`}
            />
            <h2 className="text-xl font-bold tracking-tight text-white uppercase">
              Phase 28 — Statistical Evidence & Robustness Validation
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-1 font-mono">
            Read-Only Audit Layer • Wilson Score CI • 10,000 Bootstrap Resampling • Monte Carlo Risk Diagnostic
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span className="px-2.5 py-1 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/30 text-xs font-mono font-semibold">
            READ-ONLY EVIDENCE LAYER
          </span>
          <span
            className={`px-3 py-1.5 rounded-lg border text-xs font-bold tracking-wider uppercase ${getStatusBadgeClass(
              report?.validationStatus || "INSUFFICIENT_SAMPLE"
            )}`}
          >
            STATUS: {report?.validationStatus || "INSUFFICIENT_SAMPLE"}
          </span>
        </div>
      </div>

      {/* Validation Gate Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono">
        <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-400">Genuine Sessions</div>
          <div className="text-xl font-bold text-emerald-400 mt-1">
            {report?.gateDetails?.genuineSessions || 0} / 20
          </div>
          <div className="text-[10px] text-slate-500 mt-1">
            Gate: {report?.gateDetails?.sessionsMet ? "MET ✓" : "INSUFFICIENT ⏳"}
          </div>
        </div>

        <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-400">Genuine Trades</div>
          <div className="text-xl font-bold text-emerald-400 mt-1">
            {report?.gateDetails?.genuineTrades || 0} / 30
          </div>
          <div className="text-[10px] text-slate-500 mt-1">
            Gate: {report?.gateDetails?.tradesMet ? "MET ✓" : "INSUFFICIENT ⏳"}
          </div>
        </div>

        <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-400">Active Sessions</div>
          <div className="text-xl font-bold text-emerald-400 mt-1">
            {report?.gateDetails?.activeSessions || 0} / 15
          </div>
          <div className="text-[10px] text-slate-500 mt-1">
            Gate: {report?.gateDetails?.activeSessionsMet ? "MET ✓" : "INSUFFICIENT ⏳"}
          </div>
        </div>
      </div>

      {/* Core Statistics Cards */}
      <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-5 space-y-3">
        <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">
          Core Performance & Risk Metrics
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 font-mono">
          <div className="bg-slate-900/60 border border-slate-800 rounded p-3">
            <div className="text-[10px] text-slate-400 uppercase">Net P&L</div>
            <div className={`text-base font-bold mt-1 ${(report?.coreStatistics?.totalNetPnL || 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
              ₹{(report?.coreStatistics?.totalNetPnL || 0).toLocaleString("en-IN")}
            </div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 rounded p-3">
            <div className="text-[10px] text-slate-400 uppercase">Expectancy</div>
            <div className="text-base font-bold text-slate-100 mt-1">
              ₹{report?.coreStatistics?.expectancy || 0}
            </div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 rounded p-3">
            <div className="text-[10px] text-slate-400 uppercase">Profit Factor</div>
            <div className="text-base font-bold text-slate-100 mt-1">
              {report?.coreStatistics?.profitFactor ?? "NOT_AVAILABLE"}
            </div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 rounded p-3">
            <div className="text-[10px] text-slate-400 uppercase">Win Rate</div>
            <div className="text-base font-bold text-slate-100 mt-1">
              {report?.coreStatistics?.winRate || 0}%
            </div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 rounded p-3">
            <div className="text-[10px] text-slate-400 uppercase">Max Drawdown</div>
            <div className="text-base font-bold text-rose-400 mt-1">
              ₹{report?.coreStatistics?.maxDrawdown || 0} ({report?.coreStatistics?.maxDrawdownPercent || 0}%)
            </div>
          </div>
        </div>
      </div>

      {/* Confidence Intervals & Bootstrap Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Wilson Win Rate CI */}
        <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-5 space-y-3 font-mono">
          <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">
            Wilson Score 95% Confidence Interval (Win Rate)
          </h3>
          <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-4 space-y-2">
            <div className="flex justify-between text-xs text-slate-300">
              <span>Observed Win Rate:</span>
              <span className="font-bold text-emerald-400">{report?.winRateConfidence?.observedWinRatePct || 0}%</span>
            </div>
            <div className="flex justify-between text-xs text-slate-300">
              <span>95% Wilson Interval:</span>
              <span className="font-bold text-indigo-400">
                [{report?.winRateConfidence?.lowerBoundPct || 0}%, {report?.winRateConfidence?.upperBoundPct || 0}%]
              </span>
            </div>
            <div className="text-[10px] text-slate-500 mt-1">
              Binomial Wilson score adjustment prevents small sample distortion.
            </div>
          </div>
        </div>

        {/* Bootstrap Expectancy CI */}
        <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-5 space-y-3 font-mono">
          <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">
            10,000 Bootstrap Expectancy Resampling
          </h3>
          <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-4 space-y-2">
            <div className="flex justify-between text-xs text-slate-300">
              <span>Observed Expectancy:</span>
              <span className="font-bold text-emerald-400">₹{report?.bootstrapExpectancy?.observedExpectancy || 0}</span>
            </div>
            <div className="flex justify-between text-xs text-slate-300">
              <span>95% Bootstrap CI:</span>
              <span className="font-bold text-indigo-400">
                [₹{report?.bootstrapExpectancy?.confidenceInterval95?.lower || 0}, ₹
                {report?.bootstrapExpectancy?.confidenceInterval95?.upper || 0}]
              </span>
            </div>
            <div className="text-[10px] text-slate-500 mt-1">
              Deterministic resampled mean: ₹{report?.bootstrapExpectancy?.bootstrapMean || 0} ({report?.bootstrapExpectancy?.iterations || 10000} runs)
            </div>
          </div>
        </div>
      </div>

      {/* Time Block Stability */}
      <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-5 space-y-4 font-mono">
        <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">
          Chronological Time Block Stability Analysis
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {(report?.timeStabilityBlocks || []).map((b, idx) => (
            <div key={idx} className="bg-slate-900/60 border border-slate-800 rounded-lg p-3 space-y-1.5">
              <div className="flex justify-between text-xs font-bold text-indigo-400">
                <span>{b.blockName}</span>
                <span className="text-slate-400 font-normal">{b.tradeRange}</span>
              </div>
              <div className="text-xs text-slate-300 flex justify-between">
                <span>Net P&L:</span>
                <span className={b.netPnL >= 0 ? "text-emerald-400 font-bold" : "text-rose-400 font-bold"}>
                  ₹{b.netPnL.toLocaleString("en-IN")}
                </span>
              </div>
              <div className="text-xs text-slate-300 flex justify-between">
                <span>Win Rate:</span>
                <span>{b.winRate}%</span>
              </div>
              <div className="text-xs text-slate-300 flex justify-between">
                <span>Expectancy:</span>
                <span>₹{b.expectancy}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Regime Breakdown */}
      <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-5 space-y-4">
        <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">
          Market Regime Breakdown
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400">
                <th className="pb-2">Regime</th>
                <th className="pb-2 text-right">Trades</th>
                <th className="pb-2 text-right">Win Rate</th>
                <th className="pb-2 text-right">Net P&L</th>
                <th className="pb-2 text-right">Expectancy</th>
                <th className="pb-2 text-right">Warning</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {(report?.regimeEvidence || []).map((r, idx) => (
                <tr key={idx} className="hover:bg-slate-900/50">
                  <td className="py-2.5 font-bold text-slate-200">{r.regime}</td>
                  <td className="py-2.5 text-right text-slate-300">{r.tradeCount}</td>
                  <td className="py-2.5 text-right text-slate-200">{r.winRate}%</td>
                  <td className={`py-2.5 text-right font-bold ${r.netPnL >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                    ₹{r.netPnL.toLocaleString("en-IN")}
                  </td>
                  <td className="py-2.5 text-right text-slate-300">₹{r.expectancy}</td>
                  <td className="py-2.5 text-right">
                    {r.lowSampleWarning ? (
                      <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 text-[10px] font-bold">
                        ⚠️ LOW SAMPLE
                      </span>
                    ) : (
                      <span className="text-emerald-400 text-[10px]">SUFFICIENT</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Strategy Breakdown */}
      <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-5 space-y-4">
        <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">
          Independent Strategy Analysis (Non-Ranking)
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400">
                <th className="pb-2">Strategy</th>
                <th className="pb-2 text-right">Trades</th>
                <th className="pb-2 text-right">Win Rate</th>
                <th className="pb-2 text-right">Net P&L</th>
                <th className="pb-2 text-right">Expectancy</th>
                <th className="pb-2 text-right">Profit Factor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {(report?.strategyEvidence || []).map((s, idx) => (
                <tr key={idx} className="hover:bg-slate-900/50">
                  <td className="py-2.5 font-bold text-slate-200">{s.strategy}</td>
                  <td className="py-2.5 text-right text-slate-300">{s.tradeCount}</td>
                  <td className="py-2.5 text-right text-slate-200">{s.winRate}%</td>
                  <td className={`py-2.5 text-right font-bold ${s.netPnL >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                    ₹{s.netPnL.toLocaleString("en-IN")}
                  </td>
                  <td className="py-2.5 text-right text-slate-300">₹{s.expectancy}</td>
                  <td className="py-2.5 text-right text-slate-300">{s.profitFactor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* P&L & Loss Concentration Analysis */}
      <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-5 space-y-4 font-mono">
        <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">
          P&L & Loss Concentration Analysis
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Winner Concentration */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-4 space-y-2">
            <div className="text-xs font-bold text-emerald-400 uppercase">Top Winner Concentration</div>
            <div className="text-xs text-slate-300 flex justify-between">
              <span>Top 1 Trade Contribution:</span>
              <span>₹{report?.concentrationAnalysis?.winnersConcentration?.top1ContributionInr || 0} ({report?.concentrationAnalysis?.winnersConcentration?.top1ContributionPct || 0}%)</span>
            </div>
            <div className="text-xs text-slate-300 flex justify-between">
              <span>Top 3 Trades Contribution:</span>
              <span>₹{report?.concentrationAnalysis?.winnersConcentration?.top3ContributionInr || 0} ({report?.concentrationAnalysis?.winnersConcentration?.top3ContributionPct || 0}%)</span>
            </div>
            <div className="text-xs text-slate-300 flex justify-between">
              <span>Top 5 Trades Contribution:</span>
              <span>₹{report?.concentrationAnalysis?.winnersConcentration?.top5ContributionInr || 0} ({report?.concentrationAnalysis?.winnersConcentration?.top5ContributionPct || 0}%)</span>
            </div>
          </div>

          {/* Loser Concentration */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-4 space-y-2">
            <div className="text-xs font-bold text-rose-400 uppercase">Top Loss Concentration</div>
            <div className="text-xs text-slate-300 flex justify-between">
              <span>Top 1 Loss Contribution:</span>
              <span>₹{report?.concentrationAnalysis?.losersConcentration?.top1ContributionInr || 0} ({report?.concentrationAnalysis?.losersConcentration?.top1ContributionPct || 0}%)</span>
            </div>
            <div className="text-xs text-slate-300 flex justify-between">
              <span>Top 3 Losses Contribution:</span>
              <span>₹{report?.concentrationAnalysis?.losersConcentration?.top3ContributionInr || 0} ({report?.concentrationAnalysis?.losersConcentration?.top3ContributionPct || 0}%)</span>
            </div>
            <div className="text-xs text-slate-300 flex justify-between">
              <span>Top 5 Losses Contribution:</span>
              <span>₹{report?.concentrationAnalysis?.losersConcentration?.top5ContributionInr || 0} ({report?.concentrationAnalysis?.losersConcentration?.top5ContributionPct || 0}%)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Diagnostic Monte Carlo Resampling */}
      <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-5 space-y-3 font-mono">
        <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide flex justify-between">
          <span>Diagnostic Monte Carlo Resampling (10,000 Scenarios)</span>
          <span className="text-[10px] text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
            RESAMPLING DIAGNOSTIC
          </span>
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-slate-900/60 border border-slate-800 rounded p-3">
            <div className="text-[10px] text-slate-400 uppercase">Mean Max Drawdown</div>
            <div className="text-sm font-bold text-rose-400 mt-1">
              ₹{report?.monteCarloDiagnostic?.maxDrawdownDistribution?.mean || 0}
            </div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 rounded p-3">
            <div className="text-[10px] text-slate-400 uppercase">95th Percentile Drawdown</div>
            <div className="text-sm font-bold text-rose-400 mt-1">
              ₹{report?.monteCarloDiagnostic?.maxDrawdownDistribution?.p95 || 0}
            </div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 rounded p-3">
            <div className="text-[10px] text-slate-400 uppercase">Mean Losing Streak</div>
            <div className="text-sm font-bold text-slate-100 mt-1">
              {report?.monteCarloDiagnostic?.longestLosingStreakDistribution?.mean || 0} trades
            </div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 rounded p-3">
            <div className="text-[10px] text-slate-400 uppercase">Prob. Negative Ending P&L</div>
            <div className="text-sm font-bold text-amber-400 mt-1">
              {report?.monteCarloDiagnostic?.probabilityOfNegativeEndingPnlPct || 0}%
            </div>
          </div>
        </div>

        <div className="text-[10px] text-slate-400 italic bg-slate-900/40 border border-slate-800/80 rounded p-2.5">
          📢 {report?.monteCarloDiagnostic?.disclaimer || "OBSERVATIONAL / RESAMPLING ANALYSIS - NOT A FUTURE PERFORMANCE FORECAST"}
        </div>
      </div>

      {/* Safety Invariants Footer */}
      <div className="flex flex-col sm:flex-row justify-between items-center bg-slate-950/60 border border-slate-800 rounded-lg p-3 text-xs gap-2 font-mono">
        <div className="flex items-center gap-4 text-slate-400">
          <span>PAPER_TRADING=true</span>
          <span>LIVE_TRADING=false</span>
          <span>BROKER_EXECUTION_ENABLED=false</span>
          <span>REAL BROKER ORDERS=0</span>
        </div>
        <div className="text-slate-400 text-[11px]">
          Fingerprint: <span className="text-indigo-400">{report?.fingerprintStatus?.fingerprintStatus || "VALIDATED"}</span>
        </div>
      </div>
    </div>
  );
}
