"use client";

import React from "react";
import { Shield, PieChart, AlertCircle, TrendingUp, Layers, DollarSign } from "lucide-react";

export interface ExposureItem {
  sector: string;
  capital: number;
  tradeCount: number;
  percentage: number;
}

interface IMRiskExposureMatrixProps {
  totalCapital: number;
  activeTrades: Array<{
    symbol: string;
    companyName: string;
    allocatedCapital: number;
    entryPrice: number;
    stopLossPrice: number;
    quantity: number;
    pnlAmount: number;
    pnlPercent: number;
    sector?: string;
  }>;
}

export default function IMRiskExposureMatrix({
  totalCapital,
  activeTrades,
}: IMRiskExposureMatrixProps) {
  const deployedCapital = activeTrades.reduce((sum, t) => sum + (t.allocatedCapital || t.entryPrice * t.quantity), 0);
  const cashReserve = Math.max(0, totalCapital - deployedCapital);
  const portfolioUtilizationPct = Number(((deployedCapital / totalCapital) * 100).toFixed(1));

  // Total Capital at Risk (Sum of (Entry - StopLoss) * Quantity for each trade)
  const totalCapitalAtRisk = activeTrades.reduce((sum, t) => {
    const riskPerShare = Math.max(0, t.entryPrice - t.stopLossPrice);
    return sum + riskPerShare * t.quantity;
  }, 0);
  const riskOfTotalCapitalPct = Number(((totalCapitalAtRisk / totalCapital) * 100).toFixed(2));

  // Sector Exposure aggregation
  const sectorMap = new Map<string, { capital: number; count: number }>();
  activeTrades.forEach((t) => {
    const sector = t.sector || "General Equities";
    const current = sectorMap.get(sector) || { capital: 0, count: 0 };
    current.capital += t.allocatedCapital || t.entryPrice * t.quantity;
    current.count += 1;
    sectorMap.set(sector, current);
  });

  const sectorList: ExposureItem[] = Array.from(sectorMap.entries())
    .map(([sector, data]) => ({
      sector,
      capital: data.capital,
      tradeCount: data.count,
      percentage: Number(((data.capital / Math.max(1, deployedCapital)) * 100).toFixed(1)),
    }))
    .sort((a, b) => b.capital - a.capital);

  // Maximum single position concentration
  const maxPositionTrade = activeTrades.reduce(
    (max, t) => ((t.allocatedCapital || 0) > (max?.allocatedCapital || 0) ? t : max),
    activeTrades[0] || null
  );
  const maxPositionPct = maxPositionTrade
    ? Number((((maxPositionTrade.allocatedCapital || 0) / totalCapital) * 100).toFixed(1))
    : 0;

  return (
    <div className="rounded-2xl border border-slate-800 bg-[#0a0f1d] p-5 shadow-2xl backdrop-blur-md">
      <div className="flex items-center justify-between pb-4 border-b border-slate-800/80">
        <div className="flex items-center space-x-3">
          <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              Institutional Risk Exposure Matrix
              <span className="text-[10px] px-2 py-0.5 rounded-full font-mono font-medium bg-cyan-950/60 text-cyan-300 border border-cyan-500/30">
                Live VaR Engine
              </span>
            </h3>
            <p className="text-xs text-slate-400">Dynamic capital allocation & sector concentration parity</p>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-400">Portfolio Capital</div>
          <div className="text-base font-bold font-mono text-slate-100">
            ₹{totalCapital.toLocaleString("en-IN")}
          </div>
        </div>
      </div>

      {/* KPI Matrix Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 my-4">
        <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800">
          <div className="text-[11px] font-medium text-slate-400 flex items-center justify-between">
            <span>Deployed Capital</span>
            <DollarSign className="w-3.5 h-3.5 text-slate-500" />
          </div>
          <div className="text-lg font-bold font-mono text-emerald-400 mt-1">
            ₹{deployedCapital.toLocaleString("en-IN")}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">
            {portfolioUtilizationPct}% portfolio allocated
          </div>
        </div>

        <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800">
          <div className="text-[11px] font-medium text-slate-400 flex items-center justify-between">
            <span>Cash Reserve</span>
            <Layers className="w-3.5 h-3.5 text-slate-500" />
          </div>
          <div className="text-lg font-bold font-mono text-cyan-300 mt-1">
            ₹{cashReserve.toLocaleString("en-IN")}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">
            {(100 - portfolioUtilizationPct).toFixed(1)}% dry powder available
          </div>
        </div>

        <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800">
          <div className="text-[11px] font-medium text-slate-400 flex items-center justify-between">
            <span>Total Value at Risk</span>
            <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
          </div>
          <div className="text-lg font-bold font-mono text-rose-400 mt-1">
            ₹{totalCapitalAtRisk.toLocaleString("en-IN")}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">
            {riskOfTotalCapitalPct}% max structural loss
          </div>
        </div>

        <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800">
          <div className="text-[11px] font-medium text-slate-400 flex items-center justify-between">
            <span>Max Single Exposure</span>
            <PieChart className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div className="text-lg font-bold font-mono text-amber-300 mt-1">
            {maxPositionPct}%
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5 truncate">
            {maxPositionTrade ? `${maxPositionTrade.symbol} (Capped < 20%)` : "None"}
          </div>
        </div>
      </div>

      {/* Sector Exposure Breakdown */}
      <div className="mt-4 pt-3 border-t border-slate-800/80">
        <h4 className="text-xs font-semibold text-slate-300 mb-3 flex items-center justify-between">
          <span>Sector Distribution Matrix ({sectorList.length} Sectors Active)</span>
          <span className="text-[10px] text-slate-500 font-mono">Equal-Risk Parity</span>
        </h4>

        {sectorList.length === 0 ? (
          <div className="py-6 text-center text-xs text-slate-500 font-mono">
            No active positions deployed. Deploy positions to view sector concentration.
          </div>
        ) : (
          <div className="space-y-2.5">
            {sectorList.map((sec) => (
              <div key={sec.sector} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-300 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                    {sec.sector} ({sec.tradeCount} {sec.tradeCount === 1 ? "stock" : "stocks"})
                  </span>
                  <span className="font-mono text-slate-400">
                    ₹{sec.capital.toLocaleString("en-IN")} ({sec.percentage}%)
                  </span>
                </div>
                <div className="h-1.5 w-full bg-slate-800/80 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-cyan-500 to-emerald-400 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(100, sec.percentage)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

