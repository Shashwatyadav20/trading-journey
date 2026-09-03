"use client";

import React, { useState, useRef } from "react";
import { useTrades } from "../../context/TradeContext";
import { validateTradesJson } from "../../lib/storage";
import {
  Download,
  Upload,
  CheckCircle2,
  AlertCircle,
  FileText,
  Database,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";

export default function DataBackupCard() {
  const { trades, exportTrades, importTrades } = useTrades();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [statusMessage, setStatusMessage] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);

  const handleExport = () => {
    if (trades.length === 0) {
      setStatusMessage({
        type: "info",
        text: "Your journal is currently empty. Add trades before exporting.",
      });
      return;
    }
    exportTrades();
    setStatusMessage({
      type: "success",
      text: `Exported ${trades.length} ${
        trades.length === 1 ? "trade" : "trades"
      } to JSON backup file!`,
    });
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const parsed = JSON.parse(content);

        const validation = validateTradesJson(parsed);
        if (!validation.valid || !validation.trades) {
          setStatusMessage({
            type: "error",
            text: validation.error || "Failed to validate imported JSON file.",
          });
          return;
        }

        // Successfully validated: Update localStorage & React state
        importTrades(validation.trades);
        setStatusMessage({
          type: "success",
          text: `Successfully imported and synced ${validation.trades.length} ${
            validation.trades.length === 1 ? "trade" : "trades"
          } across all pages!`,
        });
      } catch (err) {
        setStatusMessage({
          type: "error",
          text: "Invalid JSON syntax. Please select a valid backup .json file.",
        });
      }
    };

    reader.readAsText(file);

    // Reset input value so same file can be re-selected if needed
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div className="p-6 rounded-2xl bg-slate-900/70 border border-slate-800/80 space-y-5 font-mono text-xs shadow-xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
            <Database className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-100 tracking-tight font-sans">
              Frontend Data Backup & Recovery
            </h3>
            <p className="text-xs text-slate-400 font-mono">
              100% Client-Side JSON Export & Import (No Server Uploads)
            </p>
          </div>
        </div>

        <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono">
          {trades.length} {trades.length === 1 ? "trade" : "trades"} in storage
        </span>
      </div>

      {/* Description */}
      <p className="text-slate-400 text-xs leading-relaxed font-mono">
        Export your complete trade history to a downloadable <code>.json</code> backup file. You can restore your data at any time. Importing a backup file will validate all trade entries, update <code>localStorage</code>, and instantly refresh the Dashboard, Analytics, Strategies, Calendar, and Monthly Review.
      </p>

      {/* Feedback Status Alert */}
      {statusMessage && (
        <div
          className={`p-3.5 rounded-xl border flex items-center gap-2.5 text-xs font-mono transition-all ${
            statusMessage.type === "success"
              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
              : statusMessage.type === "error"
              ? "bg-rose-500/10 text-rose-400 border-rose-500/20"
              : "bg-cyan-500/10 text-cyan-400 border-cyan-500/20"
          }`}
        >
          {statusMessage.type === "success" && (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          )}
          {statusMessage.type === "error" && (
            <AlertCircle className="w-4 h-4 shrink-0" />
          )}
          {statusMessage.type === "info" && (
            <ShieldCheck className="w-4 h-4 shrink-0" />
          )}
          <span>{statusMessage.text}</span>
        </div>
      )}

      {/* Action Buttons Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
        {/* Export Button */}
        <button
          onClick={handleExport}
          className="p-4 rounded-xl bg-slate-950/80 hover:bg-slate-900 border border-slate-800 hover:border-cyan-500/40 transition-all text-left space-y-2 group"
        >
          <div className="flex items-center justify-between">
            <span className="font-bold text-slate-100 text-sm font-sans flex items-center gap-2 group-hover:text-cyan-400 transition-colors">
              <Download className="w-4 h-4 text-cyan-400" />
              Export Trades (JSON)
            </span>
            <span className="text-[10px] text-slate-500 font-mono">
              .json download
            </span>
          </div>
          <p className="text-[11px] text-slate-400">
            Download your current {trades.length} trade logs into a JSON backup file.
          </p>
        </button>

        {/* Import Button */}
        <div className="relative">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleFileSelect}
            className="hidden"
            id="import-json-input"
          />

          <label
            htmlFor="import-json-input"
            className="p-4 rounded-xl bg-slate-950/80 hover:bg-slate-900 border border-slate-800 hover:border-emerald-500/40 transition-all text-left space-y-2 group cursor-pointer block h-full"
          >
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-100 text-sm font-sans flex items-center gap-2 group-hover:text-emerald-400 transition-colors">
                <Upload className="w-4 h-4 text-emerald-400" />
                Import Trades (JSON)
              </span>
              <span className="text-[10px] text-slate-500 font-mono">
                Select file
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Select a JSON backup file from your disk to validate and restore your journal.
            </p>
          </label>
        </div>
      </div>
    </div>
  );
}
