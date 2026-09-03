"use client";

import React, { useState } from "react";
import { useTrades } from "../../context/TradeContext";
import { Trade } from "../../types/trade";
import {
  getTradeNetPnL,
  formatCurrency,
  formatPercent,
} from "../../lib/calculations";
import CalendarDayModal from "../calendar/CalendarDayModal";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Award,
  Sparkles,
  FolderOpen,
} from "lucide-react";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function CalendarView() {
  const { trades, loadSampleTrades, clearTrades } = useTrades();

  // Calendar Month & Year State (Default to current date or September 2026)
  const [currentDate, setCurrentDate] = useState<Date>(new Date(2026, 8, 1)); // September 2026

  // Selected Date Modal State
  const [selectedDateStr, setSelectedDateStr] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const handlePrevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  // Group trades by date YYYY-MM-DD
  const tradesByDate: Record<string, Trade[]> = {};
  trades.forEach((t) => {
    if (t.status !== "OPEN") {
      const dateKey = t.date;
      if (!tradesByDate[dateKey]) {
        tradesByDate[dateKey] = [];
      }
      tradesByDate[dateKey].push(t);
    }
  });

  // Calculate Calendar Days in Month
  const firstDayOfMonth = new Date(year, month, 1).getDay(); // 0 = Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Monthly aggregated statistics for the current selected month
  const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  const monthTrades = trades.filter(
    (t) => t.status !== "OPEN" && t.date.startsWith(monthPrefix)
  );

  const monthPnL = monthTrades.reduce((acc, t) => acc + getTradeNetPnL(t), 0);
  const monthWinCount = monthTrades.filter((t) => getTradeNetPnL(t) > 0).length;
  const monthLossCount = monthTrades.filter((t) => getTradeNetPnL(t) < 0).length;
  const monthWinRate =
    monthTrades.length > 0 ? (monthWinCount / monthTrades.length) * 100 : 0;

  const hasTrades = trades.length > 0;

  const handleDayClick = (dateStr: string, dayTrades: Trade[]) => {
    if (dayTrades.length > 0) {
      setSelectedDateStr(dateStr);
      setIsModalOpen(true);
    }
  };

  return (
    <div className="space-y-8">
      {/* Top Banner Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-gradient-to-r from-slate-900/95 via-slate-900/70 to-cyan-950/40 border border-slate-800/80 shadow-xl">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <CalendarIcon className="w-5 h-5 text-cyan-400" />
            <h2 className="text-xl font-bold text-slate-100 tracking-tight">
              Trading Calendar & Daily P/L
            </h2>
            <span
              className={`text-[11px] px-2.5 py-0.5 rounded-full font-mono border font-medium ${
                hasTrades
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                  : "bg-cyan-500/10 text-cyan-400 border-cyan-500/20"
              }`}
            >
              {hasTrades
                ? `${monthTrades.length} Trades in ${MONTH_NAMES[month]}`
                : "Clean Empty State"}
            </span>
          </div>
          <p className="text-xs text-slate-400 font-mono">
            Daily profit & loss overview mapped from <code className="text-cyan-400">localStorage</code> trades.
          </p>
        </div>

        {/* Month Navigation Controls & Sample Data Toggle */}
        <div className="flex items-center gap-2 font-mono">
          <button
            onClick={hasTrades ? clearTrades : loadSampleTrades}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs border border-slate-700 transition-colors shadow-sm mr-2"
          >
            {hasTrades ? (
              <>
                <FolderOpen className="w-3.5 h-3.5 text-cyan-400" />
                <span>Show Empty State</span>
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                <span>Preview Sample Trades</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* MONTHLY SUMMARY STATS STRIP */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 font-mono">
        <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-1">
          <span className="text-[10px] text-slate-400 uppercase font-bold block">
            {MONTH_NAMES[month]} Net P/L
          </span>
          <div
            className={`text-xl font-bold ${
              monthPnL >= 0 ? "text-emerald-400" : "text-rose-400"
            }`}
          >
            {formatCurrency(monthPnL, true)}
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-1">
          <span className="text-[10px] text-slate-400 uppercase font-bold block">
            {MONTH_NAMES[month]} Executions
          </span>
          <div className="text-xl font-bold text-slate-100">
            {monthTrades.length} <span className="text-xs text-slate-500 font-normal">trades</span>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-1">
          <span className="text-[10px] text-slate-400 uppercase font-bold block">
            Monthly Win Rate
          </span>
          <div
            className={`text-xl font-bold ${
              monthWinRate >= 50 ? "text-emerald-400" : "text-amber-400"
            }`}
          >
            {formatPercent(monthWinRate)}
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-1">
          <span className="text-[10px] text-slate-400 uppercase font-bold block">
            Profitable vs Loss Days
          </span>
          <div className="text-xl font-bold text-slate-100">
            <span className="text-emerald-400">{monthWinCount}W</span>{" "}
            <span className="text-slate-600">/</span>{" "}
            <span className="text-rose-400">{monthLossCount}L</span>
          </div>
        </div>
      </section>

      {/* MONTHLY CALENDAR GRID SECTION */}
      <section className="p-6 rounded-2xl bg-slate-900/70 border border-slate-800/80 space-y-5 shadow-xl">
        {/* Calendar Month Header & Navigation */}
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-4">
          <div className="flex items-center gap-3 font-mono">
            <h3 className="text-lg font-bold text-slate-100 font-sans tracking-tight">
              {MONTH_NAMES[month]} {year}
            </h3>
            <button
              onClick={handleToday}
              className="text-[11px] px-2.5 py-0.5 rounded-lg bg-slate-800 text-cyan-400 hover:bg-slate-700 transition-colors"
            >
              Today
            </button>
          </div>

          <div className="flex items-center gap-1.5 font-mono text-xs">
            <button
              onClick={handlePrevMonth}
              className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors flex items-center gap-1"
            >
              <ChevronLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Prev</span>
            </button>
            <button
              onClick={handleNextMonth}
              className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors flex items-center gap-1"
            >
              <span className="hidden sm:inline">Next</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Days of Week Header */}
        <div className="grid grid-cols-7 gap-2 text-center text-xs font-mono font-bold text-slate-500 uppercase tracking-wider">
          {WEEKDAYS.map((d) => (
            <div key={d} className="py-1">
              {d}
            </div>
          ))}
        </div>

        {/* Calendar Day Cells Grid */}
        <div className="grid grid-cols-7 gap-2">
          {/* Padding empty cells before 1st day of month */}
          {Array.from({ length: firstDayOfMonth }).map((_, i) => (
            <div
              key={`empty-${i}`}
              className="h-24 sm:h-28 rounded-xl bg-slate-950/20 border border-slate-900/40 opacity-30"
            />
          ))}

          {/* Days of the Month */}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const dayNum = i + 1;
            const dateStr = `${year}-${String(month + 1).padStart(
              2,
              "0"
            )}-${String(dayNum).padStart(2, "0")}`;

            const dayTrades = tradesByDate[dateStr] || [];
            const tradesCount = dayTrades.length;
            const dailyPnL = dayTrades.reduce(
              (acc, t) => acc + getTradeNetPnL(t),
              0
            );

            const isWin = dailyPnL > 0;
            const isLoss = dailyPnL < 0;
            const isToday =
              new Date().toISOString().split("T")[0] === dateStr;

            return (
              <div
                key={dateStr}
                onClick={() => handleDayClick(dateStr, dayTrades)}
                className={`
                  h-24 sm:h-28 p-2.5 rounded-xl border flex flex-col justify-between text-xs font-mono transition-all duration-200 relative overflow-hidden select-none
                  ${
                    tradesCount > 0
                      ? isWin
                        ? "bg-emerald-950/30 border-emerald-500/40 hover:border-emerald-400 hover:bg-emerald-950/50 cursor-pointer shadow-md shadow-emerald-950/40"
                        : isLoss
                        ? "bg-rose-950/30 border-rose-500/40 hover:border-rose-400 hover:bg-rose-950/50 cursor-pointer shadow-md shadow-rose-950/40"
                        : "bg-slate-900/60 border-slate-700 hover:border-slate-500 cursor-pointer"
                      : "bg-slate-950/40 border-slate-800/60 hover:bg-slate-900/40"
                  }
                  ${isToday ? "ring-2 ring-cyan-500/80" : ""}
                `}
              >
                {/* Date Number & Today Indicator */}
                <div className="flex items-center justify-between">
                  <span
                    className={`font-bold text-sm ${
                      isToday ? "text-cyan-400 font-extrabold" : "text-slate-300"
                    }`}
                  >
                    {dayNum}
                  </span>

                  {isToday && (
                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-cyan-500/20 text-cyan-400 font-bold border border-cyan-500/30">
                      Today
                    </span>
                  )}
                </div>

                {/* Day Trade Summary if trades exist */}
                {tradesCount > 0 ? (
                  <div className="space-y-0.5 text-right">
                    <span className="text-[10px] text-slate-400 font-semibold block">
                      {tradesCount} {tradesCount === 1 ? "Trade" : "Trades"}
                    </span>
                    <span
                      className={`text-xs sm:text-sm font-bold block ${
                        isWin
                          ? "text-emerald-400"
                          : isLoss
                          ? "text-rose-400"
                          : "text-slate-300"
                      }`}
                    >
                      {formatCurrency(dailyPnL, true)}
                    </span>
                  </div>
                ) : (
                  /* Clean Empty State for No-Trade Days */
                  <div className="text-right text-[10px] text-slate-700">
                    —
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Date Trades Detail Modal Drilldown */}
      {selectedDateStr && (
        <CalendarDayModal
          dateStr={selectedDateStr}
          trades={tradesByDate[selectedDateStr] || []}
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
        />
      )}
    </div>
  );
}
