"use client";

import React, { useState } from "react";
import { useTrades } from "../../context/TradeContext";
import { Trade } from "../../types/trade";
import { getOpenTrades, formatCurrency } from "../../lib/calculations";
import {
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  XCircle,
  ShieldAlert,
  Target,
  DollarSign,
  Edit3,
  X,
  Check,
  TrendingUp,
  TrendingDown,
  Gauge,
  Timer,
} from "lucide-react";

interface OpenPositionsTableProps {
  onPositionClosed?: () => void;
}

export default function OpenPositionsTable({
  onPositionClosed,
}: OpenPositionsTableProps) {
  const { trades, closePosition, updateTradeStopLoss, updateTradeTargetPrice } = useTrades();
  const openPositions = getOpenTrades(trades);

  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);
  const [exitPrice, setExitPrice] = useState<number>(0);
  const [modifyTrade, setModifyTrade] = useState<Trade | null>(null);
  const [modifySL, setModifySL] = useState<number>(0);
  const [modifyTP, setModifyTP] = useState<number>(0);

  const handleOpenCloseModal = (trade: Trade) => {
    setSelectedTrade(trade);
    setExitPrice(trade.entryPrice); // user overrides in modal
  };

  const handleConfirmClose = () => {
    if (selectedTrade) {
      closePosition(selectedTrade.id, exitPrice);
      setSelectedTrade(null);
      if (onPositionClosed) onPositionClosed();
    }
  };

  const handleOpenModify = (trade: Trade) => {
    setModifyTrade(trade);
    setModifySL(trade.stopLoss || 0);
    setModifyTP(trade.targetPrice || 0);
  };

  const handleConfirmModify = () => {
    if (modifyTrade) {
      updateTradeStopLoss(modifyTrade.id, modifySL);
      updateTradeTargetPrice(modifyTrade.id, modifyTP);
      setModifyTrade(null);
    }
  };

  // Calculate unrealized P/L for a position
  const getUnrealizedPnL = (pos: Trade) => {
    const mp = pos.entryPrice; // no live feed in this component
    if (pos.side === "LONG") {
      return (mp - pos.entryPrice) * pos.quantity;
    }
    return (pos.entryPrice - mp) * pos.quantity;
  };

  const getRiskReward = (pos: Trade) => {
    const sl = pos.stopLoss || 0;
    const tp = pos.targetPrice || 0;
    const risk = Math.abs(pos.entryPrice - sl);
    const reward = Math.abs(tp - pos.entryPrice);
    return risk > 0 ? reward / risk : 0;
  };

  if (openPositions.length === 0) {
    return (
      <div className="p-5 rounded-2xl bg-[#0d1322] border border-slate-800/80 text-center text-xs text-slate-500 font-mono space-y-2">
        <Clock className="w-5 h-5 text-slate-600 mx-auto" />
        <p>No active open positions</p>
        <p className="text-[10px] text-slate-600">Place a trade to see positions here</p>
      </div>
    );
  }

  return (
    <div className="p-4 rounded-2xl bg-[#0d1322] border border-slate-800/80 shadow-xl space-y-3 font-mono text-xs">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
            <Clock className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <h3 className="text-sm font-bold text-slate-100 font-sans tracking-tight">
            Open Positions
          </h3>
          <span className="px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 text-[10px] font-bold">
            {openPositions.length}
          </span>
        </div>
      </div>

      {/* Positions Cards */}
      <div className="space-y-2">
        {openPositions.map((pos) => {
          const unrealizedPnL = getUnrealizedPnL(pos);
          const rr = getRiskReward(pos);
          const isProfit = unrealizedPnL >= 0;

          return (
            <div
              key={pos.id}
              className={`p-3 rounded-xl border transition-all ${
                isProfit
                  ? "bg-emerald-500/[0.03] border-emerald-500/15"
                  : "bg-rose-500/[0.03] border-rose-500/15"
              }`}
            >
              {/* Top Row: Symbol + Direction + P/L */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-200 text-[12px]">{pos.symbol}</span>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold inline-flex items-center gap-1 ${
                      pos.side === "LONG"
                        ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                        : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                    }`}
                  >
                    {pos.side === "LONG" ? (
                      <ArrowUpRight className="w-3 h-3" />
                    ) : (
                      <ArrowDownRight className="w-3 h-3" />
                    )}
                    {pos.side === "LONG" ? "BUY" : "SELL"}
                  </span>
                  <span className="text-[10px] text-slate-500">Qty: {pos.quantity}</span>
                </div>

                <div className="flex items-center gap-2">
                  <div className={`px-2 py-0.5 rounded-lg text-[11px] font-bold ${
                    isProfit ? "text-emerald-400" : "text-rose-400"
                  }`}>
                    {isProfit ? <TrendingUp className="w-3 h-3 inline mr-1" /> : <TrendingDown className="w-3 h-3 inline mr-1" />}
                    {formatCurrency(unrealizedPnL, true)}
                  </div>
                </div>
              </div>

              {/* Price Details Row */}
              <div className="grid grid-cols-4 gap-2 mb-2">
                <div className="space-y-0.5">
                  <span className="text-[9px] text-slate-500 block">Entry</span>
                  <span className="text-[11px] font-bold text-slate-300">${pos.entryPrice.toFixed(2)}</span>
                </div>
                <div className="space-y-0.5">
                  <span className="text-[9px] text-slate-500 block flex items-center gap-0.5">
                    <ShieldAlert className="w-2.5 h-2.5 text-rose-400" /> SL
                  </span>
                  <span className="text-[11px] font-bold text-rose-400">
                    ${pos.stopLoss ? pos.stopLoss.toFixed(2) : "—"}
                  </span>
                </div>
                <div className="space-y-0.5">
                  <span className="text-[9px] text-slate-500 block flex items-center gap-0.5">
                    <Target className="w-2.5 h-2.5 text-emerald-400" /> TP
                  </span>
                  <span className="text-[11px] font-bold text-emerald-400">
                    ${pos.targetPrice ? pos.targetPrice.toFixed(2) : "—"}
                  </span>
                </div>
                <div className="space-y-0.5">
                  <span className="text-[9px] text-slate-500 block flex items-center gap-0.5">
                    <Gauge className="w-2.5 h-2.5 text-cyan-400" /> R:R
                  </span>
                  <span className="text-[11px] font-bold text-cyan-300">
                    1:{rr.toFixed(1)}
                  </span>
                </div>
              </div>

              {/* Strategy + Actions */}
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-500 truncate max-w-[200px]">
                  {pos.strategy}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleOpenModify(pos)}
                    className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700 flex items-center gap-1 transition-colors"
                  >
                    <Edit3 className="w-3 h-3" />
                    Modify
                  </button>
                  <button
                    onClick={() => handleOpenCloseModal(pos)}
                    className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border border-amber-500/20 flex items-center gap-1 transition-colors"
                  >
                    <XCircle className="w-3 h-3" />
                    Close
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Close Position Modal */}
      {selectedTrade && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="w-full max-w-md p-5 rounded-2xl bg-[#0d1322] border border-slate-800 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <span className="font-bold text-slate-100 text-sm font-sans flex items-center gap-2">
                <XCircle className="w-4 h-4 text-amber-400" />
                Close Position — {selectedTrade.symbol}
              </span>
              <button
                onClick={() => setSelectedTrade(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-3 gap-2 p-3 rounded-xl bg-slate-900/60 border border-slate-800/60">
                <div>
                  <span className="text-slate-500 block text-[10px]">Direction</span>
                  <span className={`font-bold ${selectedTrade.side === "LONG" ? "text-emerald-400" : "text-rose-400"}`}>
                    {selectedTrade.side}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">Entry Price</span>
                  <span className="font-bold text-slate-200">${selectedTrade.entryPrice.toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">Quantity</span>
                  <span className="font-bold text-slate-200">{selectedTrade.quantity}</span>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-slate-500 block text-[10px] flex items-center gap-1">
                  <DollarSign className="w-3.5 h-3.5 text-cyan-400" />
                  Exit Price ($)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={exitPrice}
                  onChange={(e) => setExitPrice(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950/60 border border-slate-800 text-slate-100 font-bold"
                />
              </div>

              {/* PnL Preview */}
              {(() => {
                const fees = selectedTrade.fees || 5;
                const grossPnl =
                  selectedTrade.side === "LONG"
                    ? (exitPrice - selectedTrade.entryPrice) * selectedTrade.quantity
                    : (selectedTrade.entryPrice - exitPrice) * selectedTrade.quantity;
                const netPnl = grossPnl - fees;
                const riskPerUnit = selectedTrade.stopLoss
                  ? Math.abs(selectedTrade.entryPrice - selectedTrade.stopLoss)
                  : 0;
                const rMultiple =
                  riskPerUnit > 0
                    ? (selectedTrade.side === "LONG"
                        ? exitPrice - selectedTrade.entryPrice
                        : selectedTrade.entryPrice - exitPrice) / riskPerUnit
                    : 0;

                return (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800/80">
                      <span className="text-slate-500 text-[10px] block">Gross P/L</span>
                      <span className={`font-bold text-sm ${grossPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {formatCurrency(grossPnl, true)}
                      </span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800/80">
                      <span className="text-slate-500 text-[10px] block">Net P/L (−$5 fee)</span>
                      <span className={`font-bold text-sm ${netPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {formatCurrency(netPnl, true)}
                      </span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800/80">
                      <span className="text-slate-500 text-[10px] block">R-Multiple</span>
                      <span className={`font-bold text-sm ${rMultiple >= 0 ? "text-cyan-300" : "text-rose-400"}`}>
                        {rMultiple >= 0 ? "+" : ""}{rMultiple.toFixed(2)}R
                      </span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800/80">
                      <span className="text-slate-500 text-[10px] block">Result</span>
                      <span className={`font-bold text-sm ${netPnl > 0 ? "text-emerald-400" : netPnl < 0 ? "text-rose-400" : "text-slate-400"}`}>
                        {netPnl > 0 ? "WIN ✓" : netPnl < 0 ? "LOSS ✗" : "BREAKEVEN"}
                      </span>
                    </div>
                  </div>
                );
              })()}
            </div>

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-800/80">
              <button
                onClick={() => setSelectedTrade(null)}
                className="px-4 py-2 rounded-xl text-xs font-medium text-slate-300 hover:bg-slate-800 border border-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmClose}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-amber-500 text-slate-950 hover:bg-amber-400 shadow-lg shadow-amber-500/20 flex items-center gap-1"
              >
                <Check className="w-3.5 h-3.5" />
                Close & Realize P/L
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modify SL/TP Modal */}
      {modifyTrade && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="w-full max-w-sm p-5 rounded-2xl bg-[#0d1322] border border-slate-800 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <span className="font-bold text-slate-100 text-xs font-sans flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-cyan-400" />
                Modify — {modifyTrade.symbol} ({modifyTrade.side})
              </span>
              <button
                onClick={() => setModifyTrade(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-slate-500 block text-[10px] flex items-center gap-1">
                  <ShieldAlert className="w-3 h-3 text-rose-400" />
                  Stop Loss ($)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={modifySL}
                  onChange={(e) => setModifySL(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950/60 border border-rose-500/30 text-rose-400 font-bold"
                />
              </div>

              <div className="space-y-1">
                <label className="text-slate-500 block text-[10px] flex items-center gap-1">
                  <Target className="w-3 h-3 text-emerald-400" />
                  Take Profit ($)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={modifyTP}
                  onChange={(e) => setModifyTP(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950/60 border border-emerald-500/30 text-emerald-400 font-bold"
                />
              </div>

              {/* Preview updated R:R */}
              {(() => {
                const risk = Math.abs(modifyTrade.entryPrice - modifySL);
                const reward = Math.abs(modifyTP - modifyTrade.entryPrice);
                const rr = risk > 0 ? reward / risk : 0;
                return (
                  <div className="p-2 rounded-lg bg-slate-950/40 border border-slate-800/40 text-center">
                    <span className="text-[9px] text-slate-500">Updated R:R → </span>
                    <span className="text-[11px] font-bold text-cyan-300">1 : {rr.toFixed(2)}</span>
                  </div>
                );
              })()}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                onClick={() => setModifyTrade(null)}
                className="px-3 py-1.5 rounded-xl text-slate-400 hover:bg-slate-800 border border-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmModify}
                className="px-3 py-1.5 rounded-xl bg-cyan-500 text-slate-950 font-bold hover:bg-cyan-400 shadow-md shadow-cyan-500/20 flex items-center gap-1"
              >
                <Check className="w-3.5 h-3.5" />
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
