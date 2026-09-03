"use client";

import React from "react";
import { Trade } from "../../types/trade";
import { formatCurrency, formatPercent } from "../../lib/calculations";
import {
  X,
  TrendingUp,
  TrendingDown,
  Tag,
  Edit2,
  Calendar,
  Clock,
  Shield,
  Target,
  DollarSign,
  FileText,
  Image as ImageIcon,
  ExternalLink,
} from "lucide-react";

interface TradeDetailModalProps {
  trade: Trade | null;
  isOpen: boolean;
  onClose: () => void;
  onEdit: (trade: Trade) => void;
}

export default function TradeDetailModal({
  trade,
  isOpen,
  onClose,
  onEdit,
}: TradeDetailModalProps) {
  if (!isOpen || !trade) return null;

  const isWin = trade.pnl > 0;
  const isLoss = trade.pnl < 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-2xl bg-[#0d1322] border border-slate-800 rounded-2xl shadow-2xl overflow-hidden my-8 space-y-0">
        {/* Top Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800/80 bg-slate-900/60">
          <div className="flex items-center gap-3">
            <span
              className={`px-2.5 py-1 rounded-lg text-xs font-bold font-mono ${
                trade.side === "LONG"
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                  : "bg-rose-500/20 text-rose-400 border border-rose-500/30"
              }`}
            >
              {trade.side}
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-slate-100 font-mono">
                  {trade.symbol}
                </h3>
                <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-cyan-400 font-mono">
                  {trade.strategy}
                </span>
              </div>
              <p className="text-xs text-slate-400 font-mono flex items-center gap-2">
                <span>{trade.date}</span>
                {trade.time && <span>• {trade.time}</span>}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                onClose();
                onEdit(trade);
              }}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 font-mono flex items-center gap-1.5 transition-colors"
            >
              <Edit2 className="w-3.5 h-3.5 text-cyan-400" />
              <span>Edit</span>
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-6 text-xs font-mono">
          {/* Key Outcome Banner */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 rounded-xl bg-slate-950/80 border border-slate-800/80">
            <div>
              <span className="text-slate-500 text-[10px] block">NET P/L</span>
              <span
                className={`text-base font-bold ${
                  isWin
                    ? "text-emerald-400"
                    : isLoss
                    ? "text-rose-400"
                    : "text-slate-300"
                }`}
              >
                {formatCurrency(trade.pnl, true)}
              </span>
            </div>

            <div>
              <span className="text-slate-500 text-[10px] block">R-MULTIPLE</span>
              <span className="text-base font-bold text-cyan-400">
                {trade.rMultiple > 0
                  ? `+${trade.rMultiple.toFixed(2)}R`
                  : `${trade.rMultiple.toFixed(2)}R`}
              </span>
            </div>

            <div>
              <span className="text-slate-500 text-[10px] block">QUANTITY</span>
              <span className="text-base font-bold text-slate-200">
                {trade.quantity}
              </span>
            </div>

            <div>
              <span className="text-slate-500 text-[10px] block">FEES</span>
              <span className="text-base font-bold text-slate-400">
                {formatCurrency(trade.fees)}
              </span>
            </div>
          </div>

          {/* Execution Prices Matrix */}
          <div className="space-y-2">
            <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              Execution Prices & Risk Parameters
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 rounded-xl bg-slate-900/60 border border-slate-800/60">
              <div>
                <span className="text-slate-500 text-[10px] block">ENTRY</span>
                <span className="font-bold text-slate-100">${trade.entryPrice}</span>
              </div>
              <div>
                <span className="text-slate-500 text-[10px] block">EXIT</span>
                <span className="font-bold text-slate-100">${trade.exitPrice}</span>
              </div>
              <div>
                <span className="text-slate-500 text-[10px] block">STOP LOSS</span>
                <span className="font-bold text-rose-400">
                  {trade.stopLoss ? `$${trade.stopLoss}` : "N/A"}
                </span>
              </div>
              <div>
                <span className="text-slate-500 text-[10px] block">TARGET</span>
                <span className="font-bold text-emerald-400">
                  {trade.targetPrice ? `$${trade.targetPrice}` : "N/A"}
                </span>
              </div>
            </div>
          </div>

          {/* Mistake Tag */}
          <div className="space-y-1.5">
            <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              Mistake Audit Tag
            </h4>
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-bold border ${
                  trade.mistakeTag === "No Mistake"
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                    : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                }`}
              >
                <Tag className="w-3.5 h-3.5" />
                {trade.mistakeTag || "No Mistake"}
              </span>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              Execution Notes & Confluence
            </h4>
            <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/60 text-slate-300 leading-relaxed min-h-[60px]">
              {trade.notes ? trade.notes : "No notes recorded for this trade entry."}
            </div>
          </div>

          {/* Screenshot Preview */}
          {trade.screenshotUrl && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  Chart Screenshot
                </h4>
                <a
                  href={trade.screenshotUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan-400 hover:underline flex items-center gap-1 text-[11px]"
                >
                  <span>Open link</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <div className="rounded-xl overflow-hidden border border-slate-800 bg-slate-950 max-h-56 flex items-center justify-center">
                <img
                  src={trade.screenshotUrl}
                  alt="Trade Chart Screenshot"
                  className="max-h-56 w-full object-contain"
                  onError={(e) => {
                    // Fallback on broken image link
                    (e.target as HTMLElement).style.display = "none";
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
