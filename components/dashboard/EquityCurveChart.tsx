"use client";

import React, { useState } from "react";
import { EquityPoint } from "../../types/trade";
import { formatCurrency, formatPercent } from "../../lib/calculations";
import { TrendingUp, Activity, BarChart2, Info } from "lucide-react";

interface EquityCurveChartProps {
  points: EquityPoint[];
  startingCapital: number;
}

export default function EquityCurveChart({
  points,
  startingCapital,
}: EquityCurveChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const hasTrades = points.length > 1;

  // Chart Dimensions
  const width = 800;
  const height = 260;
  const padding = { top: 25, right: 30, bottom: 35, left: 65 };

  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Min / Max Capital calculation
  const capitalValues = points.map((p) => p.capital);
  const minCapRaw = Math.min(...capitalValues, startingCapital);
  const maxCapRaw = Math.max(...capitalValues, startingCapital);

  // Add buffer to min and max for clean padding
  const range = maxCapRaw - minCapRaw || 1000;
  const minCap = Math.floor((minCapRaw - range * 0.1) / 100) * 100;
  const maxCap = Math.ceil((maxCapRaw + range * 0.1) / 100) * 100;

  // Convert data points to SVG coordinates
  const svgPoints = points.map((p, index) => {
    const x =
      points.length === 1
        ? padding.left + chartWidth / 2
        : padding.left + (index / (points.length - 1)) * chartWidth;
    const y =
      padding.top +
      chartHeight -
      ((p.capital - minCap) / (maxCap - minCap)) * chartHeight;
    return { x, y, point: p, index };
  });

  // Construct SVG Path strings
  const linePathD =
    svgPoints.length > 0
      ? svgPoints.reduce((acc, pt, i) => {
          return i === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`;
        }, "")
      : "";

  const areaPathD =
    svgPoints.length > 0
      ? `${linePathD} L ${svgPoints[svgPoints.length - 1].x} ${
          height - padding.bottom
        } L ${svgPoints[0].x} ${height - padding.bottom} Z`
      : "";

  // Baseline Y coordinate for starting capital line
  const baselineY =
    padding.top +
    chartHeight -
    ((startingCapital - minCap) / (maxCap - minCap)) * chartHeight;

  // Y-axis tick steps (4 steps)
  const yTicksCount = 4;
  const yTicks = Array.from({ length: yTicksCount + 1 }).map((_, i) => {
    const val = minCap + (i / yTicksCount) * (maxCap - minCap);
    const y = padding.top + chartHeight - (i / yTicksCount) * chartHeight;
    return { val, y };
  });

  const activePoint = hoverIndex !== null ? svgPoints[hoverIndex] : svgPoints[svgPoints.length - 1];

  return (
    <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 space-y-4 shadow-xl">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
            <TrendingUp className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-100 tracking-tight">
              Equity Curve
            </h3>
            <p className="text-[11px] text-slate-400 font-mono">
              Cumulative Account Capital & PnL Trajectory
            </p>
          </div>
        </div>

        {/* Legend & Stats */}
        <div className="flex items-center gap-4 text-xs font-mono">
          {hasTrades && activePoint && (
            <div className="flex items-center gap-2">
              <span className="text-slate-400">Selected Capital:</span>
              <span className="font-bold text-cyan-400">
                {formatCurrency(activePoint.point.capital)}
              </span>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                  activePoint.point.cumulativePnL >= 0
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                    : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                }`}
              >
                {formatCurrency(activePoint.point.cumulativePnL, true)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* SVG Chart Area */}
      <div className="relative w-full overflow-hidden rounded-xl bg-slate-950/60 border border-slate-800/60 p-2">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto overflow-visible select-none"
        >
          <defs>
            <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Horizontal Grid Lines & Y-Axis Labels */}
          {yTicks.map((tick, idx) => (
            <g key={idx}>
              <line
                x1={padding.left}
                y1={tick.y}
                x2={width - padding.right}
                y2={tick.y}
                stroke="#1e293b"
                strokeWidth="1"
                strokeDasharray="4 4"
              />
              <text
                x={padding.left - 10}
                y={tick.y + 4}
                textAnchor="end"
                className="text-[10px] fill-slate-500 font-mono"
              >
                {formatCurrency(tick.val)}
              </text>
            </g>
          ))}

          {/* Starting Capital Baseline */}
          <line
            x1={padding.left}
            y1={baselineY}
            x2={width - padding.right}
            y2={baselineY}
            stroke="#334155"
            strokeWidth="1.5"
            strokeDasharray="6 6"
          />

          {hasTrades ? (
            <>
              {/* Gradient Area Fill */}
              <path d={areaPathD} fill="url(#equityGradient)" />

              {/* Glowing Stroke Line */}
              <path
                d={linePathD}
                fill="none"
                stroke="#06b6d4"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {/* Data Points */}
              {svgPoints.map((pt, i) => (
                <circle
                  key={i}
                  cx={pt.x}
                  cy={pt.y}
                  r={hoverIndex === i ? "5" : "3.5"}
                  className={`transition-all duration-150 cursor-pointer ${
                    hoverIndex === i
                      ? "fill-cyan-300 stroke-cyan-500 stroke-2"
                      : "fill-slate-900 stroke-cyan-400 stroke-2"
                  }`}
                  onMouseEnter={() => setHoverIndex(i)}
                  onMouseLeave={() => setHoverIndex(null)}
                />
              ))}

              {/* Active Hover Guide Line */}
              {hoverIndex !== null && (
                <line
                  x1={svgPoints[hoverIndex].x}
                  y1={padding.top}
                  x2={svgPoints[hoverIndex].x}
                  y2={height - padding.bottom}
                  stroke="#06b6d4"
                  strokeWidth="1"
                  strokeDasharray="2 2"
                />
              )}
            </>
          ) : (
            /* Empty State Chart Overlay */
            <g>
              <line
                x1={padding.left}
                y1={baselineY}
                x2={width - padding.right}
                y2={baselineY}
                stroke="#06b6d4"
                strokeWidth="2"
              />
            </g>
          )}
        </svg>

        {/* Empty State Banner Overlay if 0 trades */}
        {!hasTrades && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/75 backdrop-blur-[2px] p-4 text-center">
            <BarChart2 className="w-8 h-8 text-slate-600 mb-1 animate-pulse" />
            <span className="text-xs font-bold text-slate-300 font-mono">
              No trades recorded yet.
            </span>
            <span className="text-[11px] text-slate-500 font-mono mt-0.5">
              Equity curve will generate automatically once trades are logged.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
