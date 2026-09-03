"use client";

import React from "react";
import { AnalyticsFilterState } from "../../lib/analyticsAggregations";
import { Filter, Calendar, Zap, DollarSign, RefreshCw, X } from "lucide-react";

interface AnalyticsFilterBarProps {
  filters: AnalyticsFilterState;
  onChange: (newFilters: AnalyticsFilterState) => void;
  onReset: () => void;
  availableStrategies: string[];
  availableSymbols: string[];
  filteredCount: number;
  totalCount: number;
}

export default function AnalyticsFilterBar({
  filters,
  onChange,
  onReset,
  availableStrategies,
  availableSymbols,
  filteredCount,
  totalCount,
}: AnalyticsFilterBarProps) {
  const isFiltered =
    filters.datePreset !== "ALL" ||
    filters.startDate !== "" ||
    filters.endDate !== "" ||
    filters.strategy !== "ALL" ||
    filters.symbol !== "ALL" ||
    filters.direction !== "ALL";

  return (
    <div className="p-4 rounded-2xl bg-slate-900/70 border border-slate-800/80 space-y-3 font-mono text-xs shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-cyan-400" />
          <span className="font-bold text-slate-100 font-sans">
            Analytics Interactive Filters
          </span>
          <span className="px-2 py-0.5 rounded-full bg-slate-800 text-cyan-400 text-[11px]">
            Showing {filteredCount} of {totalCount} trades
          </span>
        </div>

        {isFiltered && (
          <button
            onClick={onReset}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/20 hover:bg-rose-500/20 transition-colors text-[11px]"
          >
            <X className="w-3.5 h-3.5" />
            <span>Reset Filters</span>
          </button>
        )}
      </div>

      {/* Filter Controls Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* 1. Date Range Preset & Custom Picker */}
        <div className="space-y-1">
          <label className="text-slate-400 text-[10px] uppercase font-bold flex items-center gap-1">
            <Calendar className="w-3 h-3 text-cyan-400" />
            Date Range
          </label>
          <div className="space-y-1.5">
            <select
              value={filters.datePreset}
              onChange={(e) =>
                onChange({
                  ...filters,
                  datePreset: e.target.value as AnalyticsFilterState["datePreset"],
                })
              }
              className="w-full px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 outline-none focus:border-cyan-500"
            >
              <option value="ALL">All Time</option>
              <option value="THIS_MONTH">This Month</option>
              <option value="LAST_30_DAYS">Last 30 Days</option>
              <option value="CUSTOM">Custom Date Range</option>
            </select>

            {filters.datePreset === "CUSTOM" && (
              <div className="grid grid-cols-2 gap-1.5 pt-1">
                <input
                  type="date"
                  value={filters.startDate}
                  onChange={(e) =>
                    onChange({ ...filters, startDate: e.target.value })
                  }
                  className="w-full px-2 py-1 rounded-lg bg-slate-950 border border-slate-800 text-[10px] text-slate-200"
                  placeholder="Start"
                />
                <input
                  type="date"
                  value={filters.endDate}
                  onChange={(e) =>
                    onChange({ ...filters, endDate: e.target.value })
                  }
                  className="w-full px-2 py-1 rounded-lg bg-slate-950 border border-slate-800 text-[10px] text-slate-200"
                  placeholder="End"
                />
              </div>
            )}
          </div>
        </div>

        {/* 2. Strategy Filter */}
        <div className="space-y-1">
          <label className="text-slate-400 text-[10px] uppercase font-bold flex items-center gap-1">
            <Zap className="w-3 h-3 text-cyan-400" />
            Strategy
          </label>
          <select
            value={filters.strategy}
            onChange={(e) => onChange({ ...filters, strategy: e.target.value })}
            className="w-full px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 outline-none focus:border-cyan-500"
          >
            <option value="ALL">All Strategies</option>
            {availableStrategies.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {/* 3. Symbol Filter */}
        <div className="space-y-1">
          <label className="text-slate-400 text-[10px] uppercase font-bold flex items-center gap-1">
            <DollarSign className="w-3 h-3 text-cyan-400" />
            Symbol
          </label>
          <select
            value={filters.symbol}
            onChange={(e) => onChange({ ...filters, symbol: e.target.value })}
            className="w-full px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 outline-none focus:border-cyan-500 uppercase"
          >
            <option value="ALL">All Symbols</option>
            {availableSymbols.map((sym) => (
              <option key={sym} value={sym}>
                {sym}
              </option>
            ))}
          </select>
        </div>

        {/* 4. Direction Filter */}
        <div className="space-y-1">
          <label className="text-slate-400 text-[10px] uppercase font-bold">
            Direction
          </label>
          <div className="grid grid-cols-3 gap-1">
            {(["ALL", "LONG", "SHORT"] as const).map((dir) => (
              <button
                key={dir}
                onClick={() => onChange({ ...filters, direction: dir })}
                className={`py-1.5 rounded-xl text-[11px] font-bold border transition-colors ${
                  filters.direction === dir
                    ? "bg-cyan-500/20 text-cyan-400 border-cyan-500/40 shadow-sm"
                    : "bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200"
                }`}
              >
                {dir}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
