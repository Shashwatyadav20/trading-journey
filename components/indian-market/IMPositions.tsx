"use client";

import React, { useState, useEffect } from "react";
import IMHeader from "./IMHeader";
import IMStatusBadge from "./IMStatusBadge";
import { RefreshCw, XSquare, Loader2 } from "lucide-react";

export default function IMPositions() {
  const [openPositions, setOpenPositions] = useState<any[]>([]);
  const [closedPositions, setClosedPositions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [closingId, setClosingId] = useState<string | null>(null);

  const [performance, setPerformance] = useState<any>(null);

  const fetchPositions = async () => {
    try {
      setLoading(true);
      const [posRes, perfRes] = await Promise.all([
        fetch("http://localhost:4000/api/indian/positions").catch(() => null),
        fetch("http://localhost:4000/api/indian/performance").catch(() => null),
      ]);

      if (posRes && posRes.ok) {
        const data = await posRes.json();
        if (data.success) {
          setOpenPositions(data.openPositions || []);
          setClosedPositions(data.closedPositions || []);
        }
      }
      if (perfRes && perfRes.ok) {
        const perfData = await perfRes.json();
        if (perfData.success) {
          setPerformance(perfData.performance);
        }
      }
    } catch {
      // API fallback
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPositions();
    const interval = setInterval(fetchPositions, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleClosePosition = async (id: string) => {
    try {
      setClosingId(id);
      const res = await fetch("http://localhost:4000/api/indian/trade/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        fetchPositions();
      }
    } catch {
      // error handling
    } finally {
      setClosingId(null);
    }
  };

  const totalNetPnl = openPositions.reduce(
    (acc, p) => acc + (p.unrealizedNetPnl || 0),
    0
  );
  const totalCharges = openPositions.reduce(
    (acc, p) => acc + (p.totalCharges || 0),
    0
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <h2 className="text-xl font-bold text-slate-100 tracking-tight">
              POSITIONS & SPREADS
            </h2>
            <p className="text-xs text-slate-400 font-mono">
              Live Paper Spread Positions & Real-Time Mark-to-Market
            </p>
          </div>
          <IMStatusBadge status="PAPER MODE" size="sm" />
        </div>

        <button
          onClick={fetchPositions}
          className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-100 transition-colors"
          title="Refresh Positions"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin text-cyan-400" : ""}`} />
        </button>
      </div>

      <IMHeader />

      {/* Paper Performance Dashboard */}
      {performance && (
        <div className="p-4 rounded-2xl bg-[#11192e]/90 border border-slate-800/80 space-y-3 font-mono">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
            <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">
              PAPER PERFORMANCE & RISK STATS
            </span>
            <div className="flex items-center gap-2">
              <IMStatusBadge
                status={performance.isTradeLocked ? "RISK LOCKED" : "TRADING ACTIVE"}
                size="sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800">
              <div className="text-[9px] text-slate-500 uppercase font-semibold">Win Rate</div>
              <div className="text-sm font-bold text-cyan-400 mt-0.5">{performance.winRatePct}%</div>
              <div className="text-[9px] text-slate-500">{performance.winningTradesCount}W / {performance.losingTradesCount}L</div>
            </div>

            <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800">
              <div className="text-[9px] text-slate-500 uppercase font-semibold">Avg Winner</div>
              <div className="text-sm font-bold text-emerald-400 mt-0.5">₹{performance.avgWinnerInr}</div>
            </div>

            <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800">
              <div className="text-[9px] text-slate-500 uppercase font-semibold">Avg Loser</div>
              <div className="text-sm font-bold text-rose-400 mt-0.5">₹{performance.avgLoserInr}</div>
            </div>

            <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800">
              <div className="text-[9px] text-slate-500 uppercase font-semibold">Largest Loss</div>
              <div className="text-sm font-bold text-rose-400 mt-0.5">₹{performance.largestLossInr}</div>
            </div>

            <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800">
              <div className="text-[9px] text-slate-500 uppercase font-semibold">Consec. Losses</div>
              <div className="text-sm font-bold text-amber-400 mt-0.5">{performance.consecutiveLosses}</div>
            </div>

            <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800">
              <div className="text-[9px] text-slate-500 uppercase font-semibold">Lock Status</div>
              <div className="text-[11px] font-bold mt-0.5 text-slate-300">
                {performance.isLossLocked ? (
                  <span className="text-rose-400">MAX LOSS LOCK</span>
                ) : performance.isProfitLocked ? (
                  <span className="text-emerald-400 font-bold">PROFIT TARGET LOCK</span>
                ) : (
                  <span className="text-emerald-400">OPEN</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-4 rounded-xl bg-[#11192e]/80 border border-slate-800/80">
          <div className="text-[9px] font-mono text-slate-500 uppercase tracking-wider mb-1">
            Open Spreads
          </div>
          <div className="text-base font-bold font-mono text-cyan-400">
            {openPositions.length}
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#11192e]/80 border border-slate-800/80">
          <div className="text-[9px] font-mono text-slate-500 uppercase tracking-wider mb-1">
            Unrealized Net P&L
          </div>
          <div
            className={`text-base font-bold font-mono ${
              totalNetPnl >= 0 ? "text-emerald-400" : "text-rose-400"
            }`}
          >
            {totalNetPnl >= 0 ? "+" : ""}₹{totalNetPnl.toLocaleString("en-IN")}
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#11192e]/80 border border-slate-800/80">
          <div className="text-[9px] font-mono text-slate-500 uppercase tracking-wider mb-1">
            Total Charges / Taxes
          </div>
          <div className="text-base font-bold font-mono text-amber-400">
            ₹{totalCharges.toLocaleString("en-IN")}
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#11192e]/80 border border-slate-800/80">
          <div className="text-[9px] font-mono text-slate-500 uppercase tracking-wider mb-1">
            Closed Spreads
          </div>
          <div className="text-base font-bold font-mono text-slate-200">
            {closedPositions.length}
          </div>
        </div>
      </div>

      {/* Active Open Positions */}
      <div className="space-y-3">
        <h3 className="text-xs font-mono uppercase text-slate-400 tracking-wider">
          Active Defined-Risk Open Spreads ({openPositions.length})
        </h3>

        {openPositions.length > 0 ? (
          <div className="grid grid-cols-1 gap-4">
            {openPositions.map((pos) => (
              <div
                key={pos.id}
                className="p-5 rounded-2xl bg-[#11192e]/90 border border-slate-800 space-y-3 font-mono"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-base font-bold text-slate-100">
                        {pos.symbol} {pos.strategy.replace(/_/g, " ")}
                      </span>
                      <IMStatusBadge status={pos.status} size="sm" />
                    </div>
                    <span className="text-[11px] text-slate-400">
                      Expiry: {pos.expiry} · {pos.quantityLots} Lot(s) ({pos.totalQuantity} Qty)
                    </span>
                  </div>

                  <button
                    onClick={() => handleClosePosition(pos.id)}
                    disabled={closingId === pos.id}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs font-bold hover:bg-rose-500/20 transition-all disabled:opacity-50"
                  >
                    {closingId === pos.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-rose-400" />
                    ) : (
                      <XSquare className="w-3.5 h-3.5" />
                    )}
                    <span>CLOSE SPREAD</span>
                  </button>
                </div>

                {/* Leg Details */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                    <div className="text-[10px] text-rose-400 font-bold uppercase">
                      SHORT SELL LEG
                    </div>
                    <div className="font-bold text-slate-200 mt-1">
                      {pos.sellLeg.strike} {pos.sellLeg.optionType} @ Entry ₹{pos.sellLeg.entryPrice}
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      Current LTP: ₹{pos.sellLeg.currentPrice}
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                    <div className="text-[10px] text-emerald-400 font-bold uppercase">
                      LONG BUY HEDGE LEG
                    </div>
                    <div className="font-bold text-slate-200 mt-1">
                      {pos.buyLeg.strike} {pos.buyLeg.optionType} @ Entry ₹{pos.buyLeg.entryPrice}
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      Current LTP: ₹{pos.buyLeg.currentPrice}
                    </div>
                  </div>
                </div>

                {/* Financials & PnL */}
                <div className="flex flex-wrap items-center justify-between text-xs pt-2 border-t border-slate-800/60">
                  <span className="text-slate-400">
                    Initial Credit: <strong className="text-slate-200">₹{pos.netCredit}</strong>
                  </span>
                  <span className="text-slate-400">
                    Buyback Spread: <strong className="text-slate-200">₹{pos.currentSpreadPrice}</strong>
                  </span>
                  <span className="text-slate-400">
                    Taxes & Fees: <strong className="text-amber-400">₹{pos.totalCharges}</strong>
                  </span>
                  <span className="font-bold">
                    Net P&L:{" "}
                    <span className={pos.unrealizedNetPnl >= 0 ? "text-emerald-400" : "text-rose-400"}>
                      {pos.unrealizedNetPnl >= 0 ? "+" : ""}₹{pos.unrealizedNetPnl}
                    </span>
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-8 rounded-2xl bg-slate-900/40 border border-slate-800 text-center text-xs font-mono text-slate-500">
            No active open paper spread positions.
          </div>
        )}
      </div>

      {/* Closed Positions History */}
      {closedPositions.length > 0 && (
        <div className="space-y-3 pt-4">
          <h3 className="text-xs font-mono uppercase text-slate-400 tracking-wider">
            Closed Spread History ({closedPositions.length})
          </h3>
          <div className="overflow-x-auto rounded-xl border border-slate-800/80">
            <table className="w-full text-[10px] font-mono whitespace-nowrap">
              <thead>
                <tr className="bg-slate-900/80 text-slate-500 uppercase tracking-wider text-[9px]">
                  {["Strategy", "Sell Leg", "Buy Hedge", "Lots", "Credit", "Charges", "Net P&L", "Exit Reason"].map((h) => (
                    <th key={h} className="py-2.5 px-3 text-left border-b border-slate-800 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {closedPositions.map((p, i) => (
                  <tr key={i} className="border-b border-slate-800/40 hover:bg-slate-800/20">
                    <td className="py-2 px-3 text-slate-200">{p.strategy.replace(/_/g, " ")}</td>
                    <td className="py-2 px-3 text-rose-400">{p.sellLeg.strike} {p.sellLeg.optionType}</td>
                    <td className="py-2 px-3 text-emerald-400">{p.buyLeg.strike} {p.buyLeg.optionType}</td>
                    <td className="py-2 px-3 text-slate-300">{p.quantityLots}</td>
                    <td className="py-2 px-3 text-slate-300">₹{p.netCredit}</td>
                    <td className="py-2 px-3 text-amber-400">₹{p.totalCharges}</td>
                    <td className={`py-2 px-3 font-bold ${p.realizedNetPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {p.realizedNetPnl >= 0 ? "+" : ""}₹{p.realizedNetPnl}
                    </td>
                    <td className="py-2 px-3 text-slate-400">{p.exitReason || "CLOSED"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
