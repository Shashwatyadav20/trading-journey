"use client";

import React from "react";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
} from "recharts";
import { WinLossPiePoint } from "../../lib/analyticsAggregations";
import { Award, PieChart as PieIcon } from "lucide-react";

interface WinLossPieChartProps {
  data: WinLossPiePoint[];
}

export default function WinLossPieChart({ data }: WinLossPieChartProps) {
  const totalTrades = data.reduce((acc, d) => acc + d.value, 0);
  const hasData = totalTrades > 0;

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const item: WinLossPiePoint = payload[0].payload;
      return (
        <div className="p-3 rounded-xl bg-slate-950/95 border border-slate-800 shadow-xl font-mono text-xs space-y-1">
          <p className="font-bold text-slate-200">{item.name}</p>
          <div className="flex items-center justify-between gap-4">
            <span className="text-slate-400">Count:</span>
            <span className="font-bold text-slate-100">{item.value}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-slate-400">Ratio:</span>
            <span className="font-bold text-cyan-400">
              {item.percentage.toFixed(1)}%
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
            <PieIcon className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-100 font-sans tracking-tight">
              4. Winning vs Losing Trades
            </h3>
            <p className="text-[11px] text-slate-400 font-mono">
              Execution Outcome Distribution
            </p>
          </div>
        </div>
      </div>

      <div className="h-64 w-full relative flex flex-col sm:flex-row items-center justify-center">
        {hasData ? (
          <>
            <div className="w-full sm:w-1/2 h-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Tooltip content={<CustomTooltip />} />
                  <Pie
                    data={data}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={4}
                    dataKey="value"
                  >
                    {data.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} stroke="#090d16" strokeWidth={2} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Custom Legend */}
            <div className="w-full sm:w-1/2 space-y-3 font-mono text-xs p-2">
              {data.map((item) => (
                <div
                  key={item.name}
                  className="flex items-center justify-between p-2 rounded-xl bg-slate-950/60 border border-slate-800/60"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="text-slate-300 font-medium">{item.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-100">{item.value}</span>
                    <span className="text-[10px] text-slate-500">
                      ({item.percentage.toFixed(1)}%)
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/60 rounded-xl border border-slate-800/60 text-center font-mono text-xs text-slate-500">
            <PieIcon className="w-8 h-8 text-slate-600 mb-1 animate-pulse" />
            <span>No trades matching selected filters.</span>
          </div>
        )}
      </div>
    </div>
  );
}
