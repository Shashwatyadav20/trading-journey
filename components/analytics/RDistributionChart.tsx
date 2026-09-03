"use client";

import React from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  CartesianGrid,
} from "recharts";
import { RDistributionPoint } from "../../lib/analyticsAggregations";
import { Layers, BarChart2 } from "lucide-react";

interface RDistributionChartProps {
  data: RDistributionPoint[];
}

export default function RDistributionChart({ data }: RDistributionChartProps) {
  const totalCount = data.reduce((acc, d) => acc + d.count, 0);
  const hasData = totalCount > 0;

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const item: RDistributionPoint = payload[0].payload;
      const pct = totalCount > 0 ? (item.count / totalCount) * 100 : 0;
      return (
        <div className="p-3 rounded-xl bg-slate-950/95 border border-slate-800 shadow-xl font-mono text-xs space-y-1">
          <p className="font-bold text-slate-200">Bucket: {item.range}</p>
          <div className="flex items-center justify-between gap-4">
            <span className="text-slate-400">Trade Count:</span>
            <span className="font-bold text-cyan-400">{item.count}</span>
          </div>
          <p className="text-[10px] text-slate-500">
            {pct.toFixed(1)}% of total executions
          </p>
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
            <Layers className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-100 font-sans tracking-tight">
              5. R-Multiple Distribution
            </h3>
            <p className="text-[11px] text-slate-400 font-mono">
              Risk-to-Reward Histogram Buckets
            </p>
          </div>
        </div>
      </div>

      <div className="h-64 w-full relative">
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis
                dataKey="range"
                stroke="#64748b"
                tick={{ fontSize: 10, fontFamily: "monospace" }}
              />
              <YAxis
                stroke="#64748b"
                tick={{ fontSize: 10, fontFamily: "monospace" }}
                allowDecimals={false}
              />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/60 rounded-xl border border-slate-800/60 text-center font-mono text-xs text-slate-500">
            <BarChart2 className="w-8 h-8 text-slate-600 mb-1 animate-pulse" />
            <span>No trade R-multiples matching selected filters.</span>
          </div>
        )}
      </div>
    </div>
  );
}
