"use client";

import React from "react";
import { useTrades } from "../../context/TradeContext";
import {
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  X,
  ShieldAlert,
  Target,
  DollarSign,
  AlertCircle,
} from "lucide-react";

export default function PendingOrdersPanel() {
  const { pendingOrders, cancelPendingOrder } = useTrades();

  const activePending = pendingOrders.filter((o) => o.status === "PENDING");

  if (activePending.length === 0) {
    return null; // Don't render if no pending orders
  }

  return (
    <div className="p-4 rounded-2xl bg-[#0d1322] border border-amber-500/15 shadow-xl space-y-3 font-mono text-xs">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <h3 className="text-sm font-bold text-slate-100 font-sans tracking-tight">
            Pending Orders
          </h3>
          <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[10px] font-bold">
            {activePending.length}
          </span>
        </div>
        <span className="text-[10px] text-slate-500 font-sans">
          Not active until triggered
        </span>
      </div>

      {/* Orders List */}
      <div className="space-y-2">
        {activePending.map((order) => {
          const riskPerUnit = Math.abs(order.limitPrice - order.stopLoss);
          const rewardPerUnit = Math.abs(order.takeProfit - order.limitPrice);
          const rr = riskPerUnit > 0 ? rewardPerUnit / riskPerUnit : 0;

          return (
            <div
              key={order.id}
              className="p-3 rounded-xl bg-amber-500/[0.03] border border-amber-500/15 flex flex-col gap-2"
            >
              {/* Top Row */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-200 text-[12px]">{order.instrument}</span>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold inline-flex items-center gap-1 ${
                      order.side === "LONG"
                        ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                        : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                    }`}
                  >
                    {order.side === "LONG" ? (
                      <ArrowUpRight className="w-3 h-3" />
                    ) : (
                      <ArrowDownRight className="w-3 h-3" />
                    )}
                    {order.side === "LONG" ? "BUY" : "SELL"} LIMIT
                  </span>
                  <span className="text-[10px] text-slate-500">Qty: {order.quantity}</span>
                </div>

                <button
                  onClick={() => cancelPendingOrder(order.id)}
                  className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 border border-rose-500/20 flex items-center gap-1 transition-colors"
                >
                  <X className="w-3 h-3" />
                  Cancel
                </button>
              </div>

              {/* Details Grid */}
              <div className="grid grid-cols-5 gap-2">
                <div className="space-y-0.5">
                  <span className="text-[9px] text-slate-500 block flex items-center gap-0.5">
                    <DollarSign className="w-2.5 h-2.5 text-amber-400" /> Limit
                  </span>
                  <span className="text-[11px] font-bold text-amber-400">
                    ${order.limitPrice.toFixed(2)}
                  </span>
                </div>
                <div className="space-y-0.5">
                  <span className="text-[9px] text-slate-500 block flex items-center gap-0.5">
                    <ShieldAlert className="w-2.5 h-2.5 text-rose-400" /> SL
                  </span>
                  <span className="text-[11px] font-bold text-rose-400">
                    ${order.stopLoss.toFixed(2)}
                  </span>
                </div>
                <div className="space-y-0.5">
                  <span className="text-[9px] text-slate-500 block flex items-center gap-0.5">
                    <Target className="w-2.5 h-2.5 text-emerald-400" /> TP
                  </span>
                  <span className="text-[11px] font-bold text-emerald-400">
                    ${order.takeProfit.toFixed(2)}
                  </span>
                </div>
                <div className="space-y-0.5">
                  <span className="text-[9px] text-slate-500 block">R:R</span>
                  <span className="text-[11px] font-bold text-cyan-300">1:{rr.toFixed(1)}</span>
                </div>
                <div className="space-y-0.5">
                  <span className="text-[9px] text-slate-500 block">Strategy</span>
                  <span className="text-[10px] text-slate-400 truncate block">
                    {order.strategy}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
