"use client";

import React from "react";
import { Trade } from "../../types/trade";
import { formatCurrency, getTradeNetPnL, formatStrategyName } from "../../lib/calculations";
import {
  X,
  Calendar,
  TrendingUp,
  TrendingDown,
  Tag,
  Clock,
  DollarSign,
  FileText,
} from "lucide-react";

interface CalendarDayModalProps {
  dateStr: string;
  trades: Trade[];
  isOpen: boolean;
  onClose: () => void;
}

export default function CalendarDayModal({
  dateStr,
  trades,
  isOpen,
  onClose,
}: CalendarDayModalProps) {
  if (!isOpen) return null;

  const totalDailyPnL = trades.reduce((acc, t) => acc + getTradeNetPnL(t), 0);
  const winCount = trades.filter((t) => getTradeNetPnL(t) > 0).length;
  const lossCount = trades.filter((t) => getTradeNetPnL(t) < 0).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-2xl bg-[#0d1322] border border-slate-800 rounded-2xl shadow-2xl overflow-hidden my-8">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800/80 bg-slate-900/60">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-100 font-mono tracking-tight">
                {dateStr}
              </h3>
              <p className="text-xs text-slate-400 font-mono">
                {trades.length} {trades.length === 1 ? "Trade" : "Trades"} Logged ({winCount}W / {lossCount}L)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 font-mono">
            <div className="text-right">
              <span className="text-[10px] text-slate-500 block">DAILY P/L</span>
              <span
                className={`text-base font-bold ${
                  totalDailyPnL >= 0 ? "text-emerald-400" : "text-rose-400"
                }`}
              >
                {formatCurrency(totalDailyPnL, true)}
              </span>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Trade List */}
        <div className="p-6 space-y-3 font-mono text-xs max-h-[60vh] overflow-y-auto">
          {trades.length > 0 ? (
            trades.map((t) => {
              const net = getTradeNetPnL(t);
              const isWin = net > 0;
              const isLoss = net < 0;

              return (
                <div
                  key={t.id}
                  className="p-4 rounded-xl bg-slate-950/80 border border-slate-800/80 space-y-3 hover:border-slate-700/80 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 ${
                          t.side === "LONG"
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                            : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                        }`}
                      >
                        {t.side === "LONG" ? (
                          <TrendingUp className="w-3 h-3" />
                        ) : (
                          <TrendingDown className="w-3 h-3" />
                        )}
                        {t.side}
                      </span>
                      <span className="font-bold text-slate-100 text-sm">
                        {t.symbol}
                      </span>
                      <span className="text-cyan-400 text-xs">({formatStrategyName(t.strategy)})</span>
                    </div>

                    <div className="text-right">
                      <span
                        className={`font-bold text-sm block ${
                          isWin
                            ? "text-emerald-400"
                            : isLoss
                            ? "text-rose-400"
                            : "text-slate-300"
                        }`}
                      >
                        {formatCurrency(net, true)}
                      </span>
                      <span className="text-[10px] text-cyan-400">
                        {t.rMultiple > 0
                          ? `+${t.rMultiple.toFixed(2)}R`
                          : `${t.rMultiple.toFixed(2)}R`}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-800/60 text-[11px] text-slate-400">
                    <div>
                      Entry: <span className="text-slate-200 font-bold">${t.entryPrice}</span>
                    </div>
                    <div>
                      Exit: <span className="text-slate-200 font-bold">${t.exitPrice}</span>
                    </div>
                    <div>
                      Qty: <span className="text-slate-200 font-bold">{t.quantity}</span>
                    </div>
                    <div>
                      Fees: <span className="text-slate-400">${t.fees}</span>
                    </div>
                  </div>

                  {t.mistakeTag && t.mistakeTag !== "No Mistake" && (
                    <div className="pt-1">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[10px] font-bold">
                        <Tag className="w-3 h-3" />
                        {t.mistakeTag}
                      </span>
                    </div>
                  )}

                  {t.notes && (
                    <p className="text-[11px] text-slate-400 bg-slate-900/60 p-2 rounded-lg border border-slate-800/60">
                      {t.notes}
                    </p>
                  )}
                </div>
              );
            })
          ) : (
            <div className="p-8 text-center text-slate-500">
              No trades logged for this date.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
