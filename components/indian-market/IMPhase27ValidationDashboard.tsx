"use client";

import React, { useState, useEffect } from "react";

export interface Phase27ReportData {
  validationStatus: "INSUFFICIENT_SAMPLE" | "SAMPLE_COMPLETE";
  isValidationReady: boolean;
  scorecard: {
    validationStatus: string;
    sampleProgress: {
      genuineSessionsCount: number;
      requiredSessions: number;
      sessionsMet: boolean;
      genuineTradesCount: number;
      requiredTrades: number;
      tradesMet: boolean;
      activeSessionsCount: number;
      requiredActiveSessions: number;
      activeSessionsMet: boolean;
      progressPercentage: number;
    };
    exclusions: {
      simulatedExcluded: number;
      syntheticExcluded: number;
      invalidExcluded: number;
      staleExcluded: number;
      afterHoursExcluded: number;
      duplicateExcluded: number;
    };
    dataReliabilityPct: number;
    timestampIntegrity: string;
    provenanceIntegrity: string;
    reconciliationIntegrity: string;
    safetyIntegrity: {
      paperTrading: boolean;
      liveTrading: boolean;
      brokerExecution: boolean;
      realDataOnly: boolean;
      realBrokerOrders: number;
    };
    fingerprintHash: string;
    strategyVersion: string;
    strategyMatch: boolean;
  };
  coreStatistics: {
    tradeCount: number;
    winCount: number;
    lossCount: number;
    breakevenCount: number;
    winRate: number;
    grossProfit: number;
    grossLoss: number;
    netPnL: number;
    charges: number;
    slippage: number;
    averageNetPnL: number;
    medianNetPnL: number;
    profitFactor: number | "NOT_AVAILABLE";
    expectancy: number;
    largestWin: number;
    largestLoss: number;
    averageWin: number;
    averageLoss: number;
    winLossRatio: number | "NOT_AVAILABLE";
    maxDrawdown: number;
    maxDrawdownPercent: number;
  };
  dailyStatistics: {
    genuineTradingDays: number;
    activeDays: number;
    noTradeDays: number;
    positiveDays: number;
    negativeDays: number;
    zeroDays: number;
    averageNetPnL: number;
    medianNetPnL: number;
    bestDay: number;
    worstDay: number;
    dailyStandardDeviation: number;
    dailyMaxDrawdown: number;
  };
  target1000Analysis: {
    daysAtOrAbove1000: number;
    daysBetween0And999: number;
    negativeDays: number;
    noTradeDays: number;
    percentageOfActiveDaysAtOrAbove1000: number;
  };
  equityCurve: {
    peakEquity: number;
    currentEquity: number;
    drawdown: number;
    maxDrawdown: number;
    maxDrawdownPercent: number;
  };
  strategyBreakdowns: Array<{
    strategy: string;
    tradeCount: number;
    wins: number;
    losses: number;
    winRate: number;
    netPnL: number;
    averageNetPnL: number;
    profitFactor: number | "NOT_AVAILABLE";
  }>;
  regimeBreakdowns: Array<{
    regime: string;
    tradeCount: number;
    winRate: number;
    netPnL: number;
    averagePnL: number;
  }>;
  exitBreakdowns: Array<{
    exitReason: string;
    count: number;
    netPnL: number;
    percentageOfTrades: number;
  }>;
  rollingMetrics: Array<{
    windowSize: number;
    status: string;
    tradeCount: number;
    winRate?: number;
    averagePnL?: number;
    profitFactor?: number | "NOT_AVAILABLE";
  }>;
  historicalVsGenuine: {
    historicalBacktest: { winRatePct: number; netPnl: number; maxDrawdownPct: number };
    genuineLivePaper: { winRatePct: number; netPnl: number; maxDrawdownPct: number };
  };
  generatedAt: string;
}

export default function IMPhase27ValidationDashboard() {
  const [report, setReport] = useState<Phase27ReportData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSummary = async () => {
    try {
      const res = await fetch("/api/indian/phase27/summary");
      if (res.ok) {
        const json = await res.json();
        setReport(json);
        setError(null);
      } else {
        setError(`HTTP ${res.status}`);
      }
    } catch (err: any) {
      setError(err.message || "Failed to fetch validation summary");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSummary();
    const interval = setInterval(fetchSummary, 5000);
    return () => clearInterval(interval);
  }, []);

  const getBadgeStyle = (status: string) => {
    const s = (status || "").toUpperCase();
    if (s === "SAMPLE_COMPLETE" || s === "PASSED" || s === "PASS" || s === "GENUINE" || s === "NORMAL") {
      return "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
    }
    if (s === "INSUFFICIENT_SAMPLE" || s === "INSUFFICIENT_DATA" || s === "CALCULATED") {
      return "bg-amber-500/10 text-amber-400 border-amber-500/30";
    }
    return "bg-rose-500/10 text-rose-400 border-rose-500/30";
  };

  return (
    <div className="w-full bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-xl p-6 shadow-2xl space-y-6 text-slate-100">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-slate-800 pb-4 gap-4">
        <div>
          <div className="flex items-center gap-3">
            <span className={`h-3 w-3 rounded-full ${report?.isValidationReady ? "bg-emerald-500 animate-pulse" : "bg-amber-500 animate-ping"}`}></span>
            <h2 className="text-xl font-bold tracking-tight text-white uppercase">
              Phase 27 — Genuine Sample Collection & Statistical Validation
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Real Dhan HQ Market Feed • Anti-Hindsight Verified • Immutable Provenance Ledger
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span className="px-2.5 py-1 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-xs font-mono font-semibold">
            GENUINE REAL-MARKET PAPER DATA
          </span>
          <span className={`px-3 py-1.5 rounded-lg border text-xs font-bold tracking-wider uppercase ${getBadgeStyle(report?.validationStatus || "INSUFFICIENT_SAMPLE")}`}>
            Status: {report?.validationStatus || "INSUFFICIENT_SAMPLE"}
          </span>
        </div>
      </div>

      {/* Progress Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-slate-400 font-medium">Genuine Sessions</span>
            <span className="font-mono text-emerald-400 font-bold">
              {report?.scorecard?.sampleProgress?.genuineSessionsCount || 0} / 20
            </span>
          </div>
          <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
            <div
              className="bg-emerald-500 h-full transition-all duration-500"
              style={{
                width: `${Math.min(100, ((report?.scorecard?.sampleProgress?.genuineSessionsCount || 0) / 20) * 100)}%`,
              }}
            />
          </div>
        </div>

        <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-slate-400 font-medium">Genuine Trades</span>
            <span className="font-mono text-emerald-400 font-bold">
              {report?.scorecard?.sampleProgress?.genuineTradesCount || 0} / 30
            </span>
          </div>
          <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
            <div
              className="bg-emerald-500 h-full transition-all duration-500"
              style={{
                width: `${Math.min(100, ((report?.scorecard?.sampleProgress?.genuineTradesCount || 0) / 30) * 100)}%`,
              }}
            />
          </div>
        </div>

        <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-slate-400 font-medium">Active Sessions</span>
            <span className="font-mono text-emerald-400 font-bold">
              {report?.scorecard?.sampleProgress?.activeSessionsCount || 0} / 15
            </span>
          </div>
          <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
            <div
              className="bg-emerald-500 h-full transition-all duration-500"
              style={{
                width: `${Math.min(100, ((report?.scorecard?.sampleProgress?.activeSessionsCount || 0) / 15) * 100)}%`,
              }}
            />
          </div>
        </div>

        <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-slate-400 font-medium">Sample Threshold Progress</span>
            <span className="font-mono text-indigo-400 font-bold">
              {report?.scorecard?.sampleProgress?.progressPercentage || 0}%
            </span>
          </div>
          <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
            <div
              className="bg-indigo-500 h-full transition-all duration-500"
              style={{ width: `${report?.scorecard?.sampleProgress?.progressPercentage || 0}%` }}
            />
          </div>
        </div>
      </div>

      {/* Core Statistics & Equity Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {[
          { label: "Net P&L", value: `₹${(report?.coreStatistics?.netPnL || 0).toLocaleString("en-IN")}` },
          { label: "Win Rate", value: `${report?.coreStatistics?.winRate || 0}%` },
          { label: "Profit Factor", value: report?.coreStatistics?.profitFactor ?? "NOT_AVAILABLE" },
          { label: "Expectancy", value: `₹${report?.coreStatistics?.expectancy || 0}` },
          { label: "Max Drawdown", value: `₹${report?.equityCurve?.maxDrawdown || 0} (${report?.equityCurve?.maxDrawdownPercent || 0}%)` },
          { label: "Total Charges", value: `₹${report?.coreStatistics?.charges || 0}` },
        ].map((item, idx) => (
          <div key={idx} className="bg-slate-950/60 border border-slate-800 rounded-lg p-3 flex flex-col justify-between">
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{item.label}</span>
            <span className="mt-2 text-sm font-bold font-mono text-slate-100">{item.value}</span>
          </div>
        ))}
      </div>

      {/* Data Exclusion Audit Counters */}
      <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 space-y-3">
        <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide flex items-center gap-2">
          <span>🛡️ Data Exclusion & Integrity Audit</span>
          <span className="text-[10px] text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20">
            STRICT ISOLATION ACTIVE
          </span>
        </h3>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 text-xs">
          {[
            { label: "Simulated Excluded", value: report?.scorecard?.exclusions?.simulatedExcluded || 0 },
            { label: "Synthetic Excluded", value: report?.scorecard?.exclusions?.syntheticExcluded || 0 },
            { label: "Invalid Excluded", value: report?.scorecard?.exclusions?.invalidExcluded || 0 },
            { label: "Stale Excluded", value: report?.scorecard?.exclusions?.staleExcluded || 0 },
            { label: "After-Hours Excluded", value: report?.scorecard?.exclusions?.afterHoursExcluded || 0 },
            { label: "Duplicate Excluded", value: report?.scorecard?.exclusions?.duplicateExcluded || 0 },
          ].map((item, idx) => (
            <div key={idx} className="bg-slate-900/60 border border-slate-800 rounded p-2.5 flex flex-col">
              <span className="text-[10px] text-slate-400 font-medium">{item.label}</span>
              <span className="text-xs font-bold font-mono text-rose-400 mt-1">{item.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Strategy Breakdown Table */}
      <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wide">
          Independent Strategy Breakdown
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 font-mono">
                <th className="pb-2">Strategy</th>
                <th className="pb-2 text-right">Trades</th>
                <th className="pb-2 text-right">Wins</th>
                <th className="pb-2 text-right">Losses</th>
                <th className="pb-2 text-right">Win Rate</th>
                <th className="pb-2 text-right">Net P&L</th>
                <th className="pb-2 text-right">Profit Factor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50 font-mono">
              {(report?.strategyBreakdowns || []).map((s, idx) => (
                <tr key={idx} className="hover:bg-slate-900/50">
                  <td className="py-2.5 font-bold text-slate-200">{s.strategy}</td>
                  <td className="py-2.5 text-right text-slate-300">{s.tradeCount}</td>
                  <td className="py-2.5 text-right text-emerald-400">{s.wins}</td>
                  <td className="py-2.5 text-right text-rose-400">{s.losses}</td>
                  <td className="py-2.5 text-right text-slate-200">{s.winRate}%</td>
                  <td className={`py-2.5 text-right font-bold ${s.netPnL >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                    ₹{s.netPnL.toLocaleString("en-IN")}
                  </td>
                  <td className="py-2.5 text-right text-slate-300">{s.profitFactor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Side-by-Side Historical vs Genuine Comparison */}
      <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wide flex justify-between">
          <span>Historical Backtest vs Genuine Live Paper Comparison</span>
          <span className="text-xs text-slate-400 font-mono font-normal">Independent Population Analysis</span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
          <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-4 space-y-2">
            <span className="text-indigo-400 font-bold uppercase text-[11px]">HISTORICAL BACKTEST (PHASE 11)</span>
            <p className="text-slate-300">Win Rate: {report?.historicalVsGenuine?.historicalBacktest?.winRatePct || 0}%</p>
            <p className="text-slate-300">Net P&L: ₹{(report?.historicalVsGenuine?.historicalBacktest?.netPnl || 0).toLocaleString("en-IN")}</p>
            <p className="text-slate-300">Max Drawdown: {report?.historicalVsGenuine?.historicalBacktest?.maxDrawdownPct || 0}%</p>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-4 space-y-2">
            <span className="text-emerald-400 font-bold uppercase text-[11px]">GENUINE LIVE PAPER (PHASE 27)</span>
            <p className="text-slate-300">Win Rate: {report?.historicalVsGenuine?.genuineLivePaper?.winRatePct || 0}%</p>
            <p className="text-slate-300">Net P&L: ₹{(report?.historicalVsGenuine?.genuineLivePaper?.netPnl || 0).toLocaleString("en-IN")}</p>
            <p className="text-slate-300">Max Drawdown: {report?.historicalVsGenuine?.genuineLivePaper?.maxDrawdownPct || 0}%</p>
          </div>
        </div>
      </div>

      {/* Safety Invariant Footer */}
      <div className="flex flex-col sm:flex-row justify-between items-center bg-slate-950/60 border border-slate-800 rounded-lg p-3 text-xs gap-2">
        <div className="flex items-center gap-4 text-slate-400 font-mono">
          <span>PAPER_TRADING=true</span>
          <span>LIVE_TRADING=false</span>
          <span>BROKER_EXECUTION_ENABLED=false</span>
          <span>REAL BROKER ORDERS=0</span>
        </div>
        <div className="text-slate-400 text-[11px]">
          Report Generated: <span className="text-slate-200 font-mono">{report?.generatedAt || "N/A"}</span>
        </div>
      </div>
    </div>
  );
}
