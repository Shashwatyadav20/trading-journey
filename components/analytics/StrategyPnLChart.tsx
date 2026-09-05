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
  ReferenceLine,
} from "recharts";
import { StrategyPnLPoint } from "../../lib/analyticsAggregations";
import { formatCurrency, formatStrategyName } from "../../lib/calculations";
import { Zap, BarChart2 } from "lucide-react";

interface StrategyPnLChartProps {
  data: StrategyPnLPoint[];
}

export default function StrategyPnLChart({ data }: StrategyPnLChartProps) {
  const filteredData = data
    .filter((d) => d.strategy !== "ORDER_BLOCK")
    .map((d) => ({
      ...d,
      formattedStrategy: formatStrategyName(d.strategy),
    }));

  const hasData = filteredData.length > 0;

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const item: StrategyPnLPoint & { formattedStrategy?: string } = payload[0].payload;
      return (
        <div className="p-3 rounded-xl bg-slate-950/95 border border-slate-800 shadow-xl font-mono text-xs space-y-1">
          <p className="font-bold text-slate-200">{item.formattedStrategy || formatStrategyName(item.strategy)}</p>
          <div className="flex items-center justify-between gap-4">
            <span className="text-slate-400">Net PnL:</span>
            <span
              className={`font-bold ${
                item.pnl >= 0 ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              {formatCurrency(item.pnl, true)}
            </span>
          </div>
          <p className="text-[10px] text-slate-500">
            {item.tradesCount} {item.tradesCount === 1 ? "trade" : "trades"} logged
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
            <Zap className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-100 font-sans tracking-tight">
              3. Strategy-wise P/L
            </h3>
            <p className="text-[11px] text-slate-400 font-mono">
              Net Performance Comparison Across Strategy Models
            </p>
          </div>
        </div>
      </div>

      <div className="h-64 w-full relative">
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={filteredData}
              layout="vertical"
              margin={{ top: 10, right: 30, left: 40, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis
                type="number"
                stroke="#64748b"
                tick={{ fontSize: 10, fontFamily: "monospace" }}
                tickFormatter={(val) => `$${val}`}
              />
              <YAxis
                type="category"
                dataKey="formattedStrategy"
                stroke="#64748b"
                tick={{ fontSize: 10, fontFamily: "monospace" }}
                width={120}
              />
              <Tooltip content={<CustomTooltip />} />
              <ReferenceLine x={0} stroke="#475569" strokeWidth={1.5} />
              <Bar dataKey="pnl" radius={[0, 4, 4, 0]}>
                {filteredData.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={entry.pnl >= 0 ? "#06b6d4" : "#f43f5e"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/60 rounded-xl border border-slate-800/60 text-center font-mono text-xs text-slate-500">
            <BarChart2 className="w-8 h-8 text-slate-600 mb-1 animate-pulse" />
            <span>No strategy data matching selected filters.</span>
          </div>
        )}
      </div>
    </div>
  );
}
