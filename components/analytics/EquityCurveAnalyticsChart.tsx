"use client";

import React from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { EquityPoint } from "../../types/trade";
import { formatCurrency } from "../../lib/calculations";
import { TrendingUp, BarChart2 } from "lucide-react";

interface EquityCurveAnalyticsChartProps {
  points: EquityPoint[];
}

export default function EquityCurveAnalyticsChart({
  points,
}: EquityCurveAnalyticsChartProps) {
  const hasData = points.length > 1;

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data: EquityPoint = payload[0].payload;
      return (
        <div className="p-3 rounded-xl bg-slate-950/95 border border-slate-800 shadow-xl font-mono text-xs space-y-1">
          <p className="font-bold text-slate-200">{data.date}</p>
          <p className="text-slate-400 text-[11px]">{data.label}</p>
          <div className="border-t border-slate-800 pt-1 flex items-center justify-between gap-4">
            <span className="text-slate-400">Capital:</span>
            <span className="font-bold text-cyan-400">
              {formatCurrency(data.capital)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-slate-400">Cum. PnL:</span>
            <span
              className={`font-bold ${
                data.cumulativePnL >= 0 ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              {formatCurrency(data.cumulativePnL, true)}
            </span>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="p-5 rounded-2xl bg-slate-900/70 border border-slate-800/80 space-y-4 shadow-xl">
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
            <TrendingUp className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-100 font-sans tracking-tight">
              1. Equity Curve Trajectory
            </h3>
            <p className="text-[11px] text-slate-400 font-mono">
              Cumulative Account Growth Over Time
            </p>
          </div>
        </div>
      </div>

      <div className="h-64 w-full relative">
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
              <defs>
                <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis
                dataKey="date"
                stroke="#64748b"
                tick={{ fontSize: 10, fontFamily: "monospace" }}
              />
              <YAxis
                stroke="#64748b"
                tick={{ fontSize: 10, fontFamily: "monospace" }}
                tickFormatter={(val) => `$${(val / 1000).toFixed(0)}k`}
                domain={["auto", "auto"]}
              />
              <Tooltip content={<CustomTooltip />} />
              <Area
                type="monotone"
                dataKey="capital"
                stroke="#06b6d4"
                strokeWidth={2.5}
                fillOpacity={1}
                fill="url(#areaGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/60 rounded-xl border border-slate-800/60 text-center font-mono text-xs text-slate-500">
            <BarChart2 className="w-8 h-8 text-slate-600 mb-1 animate-pulse" />
            <span>No trades matching selected filters.</span>
          </div>
        )}
      </div>
    </div>
  );
}
