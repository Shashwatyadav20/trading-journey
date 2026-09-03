"use client";

import React, { useState } from "react";
import { Trade } from "../../types/trade";
import { formatCurrency } from "../../lib/calculations";
import {
  Eye,
  Edit2,
  Trash2,
  Tag,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  FolderOpen,
} from "lucide-react";

interface TradeTableProps {
  trades: Trade[];
  onView: (trade: Trade) => void;
  onEdit: (trade: Trade) => void;
  onDelete: (id: string) => void;
}

export default function TradeTable({
  trades,
  onView,
  onEdit,
  onDelete,
}: TradeTableProps) {
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const hasTrades = trades.length > 0;

  return (
    <div className="rounded-2xl bg-slate-900/60 border border-slate-800/80 overflow-hidden shadow-xl">
      <div className="p-4 border-b border-slate-800/80 flex items-center justify-between font-mono text-xs">
        <div className="flex items-center gap-2">
          <span className="font-bold text-slate-200">Trade Entries Log</span>
          <span className="px-2 py-0.5 rounded-full bg-slate-800 text-cyan-400 font-semibold">
            {trades.length} {trades.length === 1 ? "record" : "records"}
          </span>
        </div>
      </div>

      {/* Responsive Table Container */}
      <div className="overflow-x-auto">
        <table className="w-full text-left font-mono text-xs">
          <thead className="bg-slate-950/80 text-slate-400 uppercase tracking-wider text-[11px] border-b border-slate-800/80">
            <tr>
              <th className="p-3.5">Date</th>
              <th className="p-3.5">Symbol</th>
              <th className="p-3.5">Direction</th>
              <th className="p-3.5">Strategy</th>
              <th className="p-3.5 text-right">Entry</th>
              <th className="p-3.5 text-right">Exit</th>
              <th className="p-3.5 text-center">Quantity</th>
              <th className="p-3.5 text-right">P/L</th>
              <th className="p-3.5 text-right">R</th>
              <th className="p-3.5 text-center">Actions</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-800/40 text-slate-200">
            {hasTrades ? (
              trades.map((t) => {
                const isWin = t.pnl > 0;
                const isLoss = t.pnl < 0;

                return (
                  <tr
                    key={t.id}
                    className="hover:bg-slate-800/30 transition-colors group"
                  >
                    {/* Date */}
                    <td className="p-3.5 text-slate-400 whitespace-nowrap">
                      {t.date}
                      {t.time && (
                        <span className="text-[10px] text-slate-500 block">
                          {t.time}
                        </span>
                      )}
                    </td>

                    {/* Symbol */}
                    <td className="p-3.5 font-bold text-slate-100 whitespace-nowrap">
                      {t.symbol}
                    </td>

                    {/* Direction */}
                    <td className="p-3.5 whitespace-nowrap">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold inline-flex items-center gap-1 ${
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
                    </td>

                    {/* Strategy */}
                    <td className="p-3.5 text-slate-300 whitespace-nowrap">
                      <span className="text-cyan-400">{t.strategy}</span>
                      {t.mistakeTag && t.mistakeTag !== "No Mistake" && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 ml-2 font-semibold">
                          {t.mistakeTag}
                        </span>
                      )}
                    </td>

                    {/* Entry Price */}
                    <td className="p-3.5 text-right font-semibold text-slate-300">
                      ${t.entryPrice.toLocaleString()}
                    </td>

                    {/* Exit Price */}
                    <td className="p-3.5 text-right font-semibold text-slate-300">
                      {t.status === "OPEN" ? (
                        <span className="text-cyan-400 font-normal">Active Position</span>
                      ) : (
                        `$${t.exitPrice.toLocaleString()}`
                      )}
                      {t.holdingTime && (
                        <span className="text-[10px] text-slate-500 block">
                          Held: {t.holdingTime}
                        </span>
                      )}
                    </td>

                    {/* Quantity */}
                    <td className="p-3.5 text-center text-slate-400">{t.quantity}</td>

                    {/* P/L */}
                    <td
                      className={`p-3.5 text-right font-bold whitespace-nowrap ${
                        t.status === "OPEN"
                          ? "text-cyan-400"
                          : isWin
                          ? "text-emerald-400"
                          : isLoss
                          ? "text-rose-400"
                          : "text-slate-300"
                      }`}
                    >
                      {t.status === "OPEN" ? (
                        <span className="px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 text-[10px]">
                          OPEN
                        </span>
                      ) : (
                        formatCurrency(t.pnl, true)
                      )}
                    </td>

                    {/* R-Multiple */}
                    <td className="p-3.5 text-right font-bold text-cyan-400 whitespace-nowrap">
                      {t.status === "OPEN" ? (
                        " — "
                      ) : t.rMultiple > 0 ? (
                        `+${t.rMultiple.toFixed(2)}R`
                      ) : (
                        `${t.rMultiple.toFixed(2)}R`
                      )}
                    </td>

                    {/* Actions: View, Edit, Delete */}
                    <td className="p-3.5 text-center whitespace-nowrap">
                      <div className="flex items-center justify-center gap-1.5">
                        {/* View Action */}
                        <button
                          onClick={() => onView(t)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-cyan-400 hover:bg-slate-800/80 transition-colors"
                          title="View Trade Details"
                        >
                          <Eye className="w-4 h-4" />
                        </button>

                        {/* Edit Action */}
                        <button
                          onClick={() => onEdit(t)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-400 hover:bg-slate-800/80 transition-colors"
                          title="Edit Trade Entry"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>

                        {/* Delete Action */}
                        {deleteConfirmId === t.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => {
                                onDelete(t.id);
                                setDeleteConfirmId(null);
                              }}
                              className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-400 border border-rose-500/40 text-[10px] font-bold hover:bg-rose-500/30"
                            >
                              Confirm
                            </button>
                            <button
                              onClick={() => setDeleteConfirmId(null)}
                              className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 text-[10px]"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setDeleteConfirmId(t.id)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800/80 transition-colors"
                            title="Delete Trade Entry"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td
                  colSpan={10}
                  className="p-12 text-center text-slate-500 font-mono text-xs"
                >
                  <div className="space-y-2 max-w-sm mx-auto">
                    <FolderOpen className="w-8 h-8 mx-auto text-slate-600 animate-pulse" />
                    <p className="font-bold text-slate-300">
                      No trades recorded in journal.
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Click "+ Add Trade" above to log your first execution into the journal.
                    </p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
