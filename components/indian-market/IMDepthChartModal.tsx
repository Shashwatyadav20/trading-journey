"use client";

import React, { useMemo } from "react";
import { X, Layers, TrendingUp, TrendingDown, DollarSign } from "lucide-react";

interface DepthLevel {
  price: number;
  quantity: number;
  totalQuantity: number;
  type: "BID" | "ASK";
}

interface IMDepthChartModalProps {
  symbol: string;
  currentPrice: number;
  breakoutLevel?: number;
  stopLossPrice?: number;
  onClose: () => void;
}

export default function IMDepthChartModal({
  symbol,
  currentPrice,
  breakoutLevel,
  stopLossPrice,
  onClose,
}: IMDepthChartModalProps) {
  // Generate realistic simulated order book depth (10 levels of Bids, 10 levels of Asks)
  const { bids, asks, spreadRupees, spreadBps } = useMemo(() => {
    const p = Math.max(1, currentPrice);
    const tick = Number(Math.max(0.05, p * 0.0005).toFixed(2));
    const rawBids: DepthLevel[] = [];
    const rawAsks: DepthLevel[] = [];

    let cumBid = 0;
    for (let i = 1; i <= 10; i++) {
      const price = Number((p - i * tick).toFixed(2));
      // Higher liquidity near support/stop loss
      const isSupportCluster = stopLossPrice && Math.abs(price - stopLossPrice) / p < 0.01;
      const baseQty = Math.floor(800 + (10 - i) * 250 + (isSupportCluster ? 3500 : 0));
      cumBid += baseQty;
      rawBids.push({ price, quantity: baseQty, totalQuantity: cumBid, type: "BID" });
    }

    let cumAsk = 0;
    for (let i = 1; i <= 10; i++) {
      const price = Number((p + i * tick).toFixed(2));
      // Higher liquidity resistance near breakout/OB ceiling
      const isBreakoutCluster = breakoutLevel && Math.abs(price - breakoutLevel) / p < 0.01;
      const baseQty = Math.floor(750 + (10 - i) * 220 + (isBreakoutCluster ? 4200 : 0));
      cumAsk += baseQty;
      rawAsks.push({ price, quantity: baseQty, totalQuantity: cumAsk, type: "ASK" });
    }

    const spreadRupees = Number((rawAsks[0].price - rawBids[0].price).toFixed(2));
    const spreadBps = Number(((spreadRupees / p) * 10000).toFixed(1));

    return { bids: rawBids, asks: rawAsks, spreadRupees, spreadBps };
  }, [currentPrice, breakoutLevel, stopLossPrice]);

  const maxTotal = Math.max(
    bids[bids.length - 1]?.totalQuantity || 1,
    asks[asks.length - 1]?.totalQuantity || 1
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl rounded-2xl border border-slate-800 bg-[#0c1220] p-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-400">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-100 font-mono">
                  {symbol} • Institutional Market Depth Chart
                </h3>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-purple-950/60 text-purple-300 border border-purple-500/30">
                  L2 Order Book
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Market microstructure liquidity & institutional order block wall visualizer
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800/80 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Spread Info Bar */}
        <div className="flex items-center justify-between p-3 my-4 rounded-xl border border-slate-800 bg-slate-900/60 font-mono text-xs">
          <div className="flex items-center gap-2">
            <span className="text-slate-400">Current Price:</span>
            <span className="text-base font-bold text-slate-100">₹{currentPrice.toFixed(2)}</span>
          </div>
          <div className="flex items-center gap-4 text-[11px]">
            <div>
              <span className="text-slate-400">Bid-Ask Spread:</span>{" "}
              <span className="text-cyan-300 font-semibold">₹{spreadRupees}</span>
            </div>
            <div>
              <span className="text-slate-400">Spread:</span>{" "}
              <span className="text-amber-300 font-semibold">{spreadBps} bps</span>
            </div>
          </div>
        </div>

        {/* Visual Depth Chart Columns */}
        <div className="grid grid-cols-2 gap-4 text-xs font-mono">
          {/* Bids (Demand / Green) */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-[11px] text-emerald-400 font-semibold pb-1 border-b border-emerald-500/20">
              <span>BUY (Bids)</span>
              <span>Total Vol</span>
            </div>
            <div className="space-y-1">
              {bids.map((b) => {
                const widthPct = Math.round((b.totalQuantity / maxTotal) * 100);
                return (
                  <div key={b.price} className="relative flex items-center justify-between py-1 px-2 rounded overflow-hidden">
                    <div
                      className="absolute right-0 top-0 bottom-0 bg-emerald-500/15 transition-all duration-300"
                      style={{ width: `${widthPct}%` }}
                    />
                    <span className="relative z-10 text-emerald-300 font-semibold">₹{b.price}</span>
                    <span className="relative z-10 text-slate-400">{b.totalQuantity.toLocaleString("en-IN")}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Asks (Supply / Red) */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-[11px] text-rose-400 font-semibold pb-1 border-b border-rose-500/20">
              <span>SELL (Asks)</span>
              <span>Total Vol</span>
            </div>
            <div className="space-y-1">
              {asks.map((a) => {
                const widthPct = Math.round((a.totalQuantity / maxTotal) * 100);
                return (
                  <div key={a.price} className="relative flex items-center justify-between py-1 px-2 rounded overflow-hidden">
                    <div
                      className="absolute left-0 top-0 bottom-0 bg-rose-500/15 transition-all duration-300"
                      style={{ width: `${widthPct}%` }}
                    />
                    <span className="relative z-10 text-rose-300 font-semibold">₹{a.price}</span>
                    <span className="relative z-10 text-slate-400">{a.totalQuantity.toLocaleString("en-IN")}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Microstructure Key Levels */}
        <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs font-mono text-slate-400">
          <div>
            Support / Stop Zone:{" "}
            <span className="text-emerald-400">₹{stopLossPrice ? stopLossPrice.toFixed(2) : "N/A"}</span>
          </div>
          <div>
            Breakout / VAH Ceiling:{" "}
            <span className="text-cyan-400">₹{breakoutLevel ? breakoutLevel.toFixed(2) : "N/A"}</span>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end pt-4 mt-4 border-t border-slate-800">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-mono font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
          >
            Close Depth Chart
          </button>
        </div>
      </div>
    </div>
  );
}

