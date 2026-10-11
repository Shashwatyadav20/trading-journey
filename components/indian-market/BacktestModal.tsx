"use client";

import React, { useState, useEffect } from "react";
import {
  X,
  Play,
  TrendingUp,
  TrendingDown,
  ShieldCheck,
  Activity,
  BarChart2,
  Calendar,
  Layers,
  Sparkles,
  AlertTriangle,
} from "lucide-react";
import { StrategyId, BacktestResult } from "../../lib/indian/dailyStrategyScanner";

interface BacktestModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultSymbol?: string;
  defaultStrategy?: StrategyId;
}

const STRATEGIES: { id: StrategyId; name: string }[] = [
  { id: "STRATEGY_A_BREAKOUT", name: "Strategy A: Breakout Trading" },
  { id: "STRATEGY_B_PULLBACK", name: "Strategy B: Pullback in an Uptrend" },
  { id: "STRATEGY_C_SUPPORT_BOUNCE", name: "Strategy C: Support Bounce" },
  { id: "STRATEGY_D_MA_CROSSOVER", name: "Strategy D: Moving Average Crossover" },
  { id: "STRATEGY_E_MOMENTUM", name: "Strategy E: Momentum Trading" },
  { id: "STRATEGY_F_RANGE_BREAKOUT", name: "Strategy F: Range Breakout" },
  { id: "STRATEGY_G_TREND_CONTINUATION", name: "Strategy G: Trend Continuation" },
  { id: "STRATEGY_H_VOLUME_BREAKOUT", name: "Strategy H: Volume Breakout" },
];

export const BacktestModal: React.FC<BacktestModalProps> = ({
  isOpen,
  onClose,
  defaultSymbol = "TRENT",
  defaultStrategy = "STRATEGY_A_BREAKOUT",
}) => {
  const [symbol, setSymbol] = useState<string>(defaultSymbol);
  const [strategy, setStrategy] = useState<StrategyId>(defaultStrategy);
  const [loading, setLoading] = useState<boolean>(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runBacktest = async (sym: string, strat: StrategyId) => {
    setLoading(true);
    setError(null);
    try {
      const clean = sym.trim().toUpperCase().replace(/\.NS$/, "");
      const res = await fetch(
        `/api/indian/swing/backtest?symbol=${encodeURIComponent(clean)}&strategy=${encodeURIComponent(strat)}`,
        { cache: "no-store" }
      );
      const json = await res.json();
      if (json.success && json.data) {
        setResult(json.data);
      } else {
        setError(json.error || "Failed to execute backtest simulation.");
      }
    } catch (err: any) {
      setError(err.message || "Failed to connect to backtesting engine.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setSymbol(defaultSymbol);
      setStrategy(defaultStrategy);
      runBacktest(defaultSymbol, defaultStrategy);
    }
  }, [isOpen, defaultSymbol, defaultStrategy]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-[#0b101d] border border-cyan-500/30 rounded-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto shadow-2xl flex flex-col">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between sticky top-0 bg-[#0b101d]/95 backdrop-blur z-10">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
              <BarChart2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold font-mono text-slate-100 flex items-center gap-2">
                HISTORICAL STRATEGY BACKTESTING SIMULATOR
                <span className="text-[10px] px-2 py-0.5 rounded-full font-mono bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 font-semibold">
                  CASH SWING · REAL OHLCV
                </span>
              </h3>
              <p className="text-xs text-slate-400 font-mono">
                Walk-forward daily simulation with 0.1% STT/brokerage slippage & 1% risk model
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Controls Toolbar */}
        <div className="p-4 bg-slate-900/60 border-b border-slate-800 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-mono uppercase text-slate-400 font-bold">Stock:</label>
            <input
              type="text"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono font-bold text-slate-100 w-28 uppercase focus:outline-none focus:border-cyan-400"
            />
          </div>

          <div className="flex items-center gap-2 flex-1 min-w-[220px]">
            <label className="text-[11px] font-mono uppercase text-slate-400 font-bold">Strategy:</label>
            <select
              value={strategy}
              onChange={(e) => setStrategy(e.target.value as StrategyId)}
              className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono text-slate-200 focus:outline-none focus:border-cyan-400 cursor-pointer"
            >
              {STRATEGIES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={() => runBacktest(symbol, strategy)}
            disabled={loading || !symbol.trim()}
            className="px-4 py-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 text-xs font-mono font-bold transition flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
          >
            {loading ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                <span>Simulating...</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 text-cyan-400" />
                <span>Run Simulation</span>
              </>
            )}
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-6 space-y-5 flex-1">
          {error && (
            <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs font-mono text-rose-300 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {result && (
            <div className="space-y-5">
              {/* Performance Cards Matrix */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
                <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
                  <span className="text-[10px] text-slate-400 font-mono uppercase block">Win Rate</span>
                  <span className="text-lg font-bold font-mono text-emerald-400">
                    {result.winRatePercent}%
                  </span>
                  <span className="text-[9px] text-slate-500 font-mono block">
                    {result.winningTrades}W / {result.losingTrades}L
                  </span>
                </div>

                <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
                  <span className="text-[10px] text-slate-400 font-mono uppercase block">Profit Factor</span>
                  <span className="text-lg font-bold font-mono text-cyan-300">
                    {result.profitFactor.toFixed(2)}
                  </span>
                  <span className="text-[9px] text-slate-500 font-mono block">Gross Gains/Losses</span>
                </div>

                <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
                  <span className="text-[10px] text-slate-400 font-mono uppercase block">Total Trades</span>
                  <span className="text-lg font-bold font-mono text-slate-100">
                    {result.totalTrades}
                  </span>
                  <span className="text-[9px] text-slate-500 font-mono block">Over {result.periodDays} Days</span>
                </div>

                <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
                  <span className="text-[10px] text-slate-400 font-mono uppercase block">Avg P&L / Trade</span>
                  <span
                    className={`text-lg font-bold font-mono ${
                      result.avgProfitLossPercent >= 0 ? "text-emerald-400" : "text-rose-400"
                    }`}
                  >
                    {result.avgProfitLossPercent >= 0 ? "+" : ""}
                    {result.avgProfitLossPercent}%
                  </span>
                  <span className="text-[9px] text-slate-500 font-mono block">Net of slippage</span>
                </div>

                <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
                  <span className="text-[10px] text-slate-400 font-mono uppercase block">Max Drawdown</span>
                  <span className="text-lg font-bold font-mono text-rose-400">
                    -{result.maxDrawdownPercent}%
                  </span>
                  <span className="text-[9px] text-slate-500 font-mono block">Peak-to-trough</span>
                </div>

                <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
                  <span className="text-[10px] text-slate-400 font-mono uppercase block">Net Strategy Return</span>
                  <span
                    className={`text-lg font-bold font-mono ${
                      result.netReturnPercent >= 0 ? "text-emerald-400" : "text-rose-400"
                    }`}
                  >
                    {result.netReturnPercent >= 0 ? "+" : ""}
                    {result.netReturnPercent}%
                  </span>
                  <span className="text-[9px] text-slate-500 font-mono block">Simulated ₹1L</span>
                </div>
              </div>

              {/* Equity Curve Progression Preview */}
              <div className="p-4 rounded-xl bg-[#090e1a] border border-slate-800 space-y-2">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="font-bold text-slate-300 uppercase">Simulated Equity Curve Progression</span>
                  <span className="text-cyan-400">
                    Final Equity: ₹{result.equityCurve[result.equityCurve.length - 1]?.equity.toLocaleString("en-IN") || 100000}
                  </span>
                </div>
                <div className="h-16 flex items-end gap-1 pt-2">
                  {result.equityCurve.map((pt, idx) => {
                    const minEq = 90000;
                    const maxEq = Math.max(120000, ...result.equityCurve.map((e) => e.equity));
                    const heightPercent = Math.max(10, Math.min(100, ((pt.equity - minEq) / (maxEq - minEq)) * 100));
                    return (
                      <div
                        key={idx}
                        title={`${pt.date}: ₹${pt.equity}`}
                        className="flex-1 bg-cyan-500/30 hover:bg-cyan-400 transition-colors rounded-t"
                        style={{ height: `${heightPercent}%` }}
                      />
                    );
                  })}
                </div>
              </div>

              {/* Trade Log Table */}
              <div className="space-y-2">
                <h4 className="text-xs font-mono font-bold uppercase text-slate-400">
                  Simulated Trade Execution Log ({result.trades.length} Trades)
                </h4>
                {result.trades.length === 0 ? (
                  <div className="p-6 text-center text-xs font-mono text-slate-500 bg-slate-900/40 rounded-xl border border-slate-800">
                    No completed trades triggered in the current lookback window for this stock and strategy.
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-slate-800 bg-[#090e1a]">
                    <table className="w-full text-[11px] font-mono whitespace-nowrap">
                      <thead>
                        <tr className="bg-slate-900/90 text-slate-400 uppercase text-[10px] border-b border-slate-800">
                          <th className="py-2 px-3 text-left">Entry Date</th>
                          <th className="py-2 px-3 text-left">Exit Date</th>
                          <th className="py-2 px-3 text-left">Entry ₹</th>
                          <th className="py-2 px-3 text-left">Exit ₹</th>
                          <th className="py-2 px-3 text-left">SL ₹</th>
                          <th className="py-2 px-3 text-left">Exit Reason</th>
                          <th className="py-2 px-3 text-right">Net P&L %</th>
                          <th className="py-2 px-3 text-right">P&L Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/40">
                        {result.trades.map((t, idx) => (
                          <tr key={idx} className="hover:bg-slate-800/30">
                            <td className="py-2 px-3 text-slate-300">{t.entryDate}</td>
                            <td className="py-2 px-3 text-slate-400">{t.exitDate}</td>
                            <td className="py-2 px-3 text-cyan-300 font-bold">₹{t.entryPrice}</td>
                            <td className="py-2 px-3 text-slate-200 font-bold">₹{t.exitPrice}</td>
                            <td className="py-2 px-3 text-rose-400 font-bold">₹{t.stopLoss}</td>
                            <td className="py-2 px-3">
                              <span
                                className={`text-[9px] px-1.5 py-0.5 rounded font-bold border ${
                                  t.isWin
                                    ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
                                    : "bg-rose-500/10 text-rose-300 border-rose-500/30"
                                }`}
                              >
                                {t.exitReason.replace(/_/g, " ")}
                              </span>
                            </td>
                            <td
                              className={`py-2 px-3 text-right font-bold ${
                                t.isWin ? "text-emerald-400" : "text-rose-400"
                              }`}
                            >
                              {t.pnlPercent >= 0 ? "+" : ""}
                              {t.pnlPercent}%
                            </td>
                            <td
                              className={`py-2 px-3 text-right font-bold ${
                                t.isWin ? "text-emerald-400" : "text-rose-400"
                              }`}
                            >
                              {t.pnlAmount >= 0 ? "+₹" : "-₹"}
                              {Math.abs(t.pnlAmount).toLocaleString("en-IN")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 flex items-center justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-mono font-bold bg-slate-800 text-slate-300 hover:bg-slate-700 transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
