"use client";

import React, { useState, useRef } from "react";
import { Trade } from "../../types/trade";
import { useTrades, CreateTradeInput } from "../../context/TradeContext";
import { validateTradesJson } from "../../lib/storage";
import { formatStrategyName } from "../../lib/calculations";
import TradeTable from "../journal/TradeTable";
import TradeFormModal from "../journal/TradeFormModal";
import TradeDetailModal from "../journal/TradeDetailModal";
import {
  BookOpen,
  Plus,
  Search,
  Filter,
  Sparkles,
  Download,
  Upload,
  FolderOpen,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

export default function JournalView() {
  const {
    trades,
    addTrade,
    updateTrade,
    deleteTrade,
    loadSampleTrades,
    clearTrades,
    exportTrades,
    importTrades,
  } = useTrades();

  // File Input Ref for Import
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [filterStrategy, setFilterStrategy] = useState<string>("ALL");
  const [filterSide, setFilterSide] = useState<string>("ALL");

  // Status Toast
  const [toastMessage, setToastMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Modal States
  const [isFormOpen, setIsFormOpen] = useState<boolean>(false);
  const [editingTrade, setEditingTrade] = useState<Trade | null>(null);

  const [isDetailOpen, setIsDetailOpen] = useState<boolean>(false);
  const [viewingTrade, setViewingTrade] = useState<Trade | null>(null);

  // Filter Trades
  const filteredTrades = trades.filter((t) => {
    const matchesSearch =
      t.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.strategy.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (t.notes && t.notes.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (t.mistakeTag && t.mistakeTag.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesStrategy =
      filterStrategy === "ALL" || t.strategy === filterStrategy;

    const matchesSide = filterSide === "ALL" || t.side === filterSide;

    return matchesSearch && matchesStrategy && matchesSide;
  });

  const handleOpenCreateForm = () => {
    setEditingTrade(null);
    setIsFormOpen(true);
  };

  const handleOpenEditForm = (trade: Trade) => {
    setEditingTrade(trade);
    setIsFormOpen(true);
  };

  const handleOpenDetailModal = (trade: Trade) => {
    setViewingTrade(trade);
    setIsDetailOpen(true);
  };

  const handleFormSubmit = (data: CreateTradeInput) => {
    if (editingTrade) {
      updateTrade(editingTrade.id, data);
    } else {
      addTrade(data);
    }
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const parsed = JSON.parse(content);
        const validation = validateTradesJson(parsed);

        if (!validation.valid || !validation.trades) {
          setToastMessage({
            type: "error",
            text: validation.error || "Invalid backup JSON file format.",
          });
          return;
        }

        importTrades(validation.trades);
        setToastMessage({
          type: "success",
          text: `Successfully imported ${validation.trades.length} trades!`,
        });
      } catch (err) {
        setToastMessage({
          type: "error",
          text: "Failed to parse JSON file.",
        });
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Get unique strategies for filter dropdown
  const uniqueStrategies = Array.from(
    new Set(trades.map((t) => t.strategy).filter(Boolean))
  );

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-gradient-to-r from-slate-900/95 via-slate-900/70 to-cyan-950/40 border border-slate-800/80 shadow-xl">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <BookOpen className="w-5 h-5 text-cyan-400" />
            <h2 className="text-xl font-bold text-slate-100 tracking-tight">
              Trade Journal
            </h2>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 font-mono border border-cyan-500/20 font-medium">
              {trades.length} Executions Logged
            </span>
          </div>
          <p className="text-xs text-slate-400 font-mono">
            Log trade parameters, monitor risk-to-reward, and backup/export journal data.
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Add Trade Main Button */}
          <button
            onClick={handleOpenCreateForm}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-slate-950 font-bold text-xs shadow-lg shadow-cyan-500/20 transition-all active:scale-95 font-mono"
          >
            <Plus className="w-4 h-4 stroke-[3]" />
            <span>Add Trade</span>
          </button>

          {/* Export Button */}
          <button
            onClick={exportTrades}
            disabled={trades.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 text-xs font-mono border border-slate-700 transition-colors"
            title="Export trades to JSON backup file"
          >
            <Download className="w-3.5 h-3.5 text-cyan-400" />
            <span className="hidden sm:inline">Export</span>
          </button>

          {/* Import Button */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleImportFile}
            className="hidden"
            id="journal-import-input"
          />
          <label
            htmlFor="journal-import-input"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono border border-slate-700 transition-colors cursor-pointer"
            title="Import trades from JSON backup file"
          >
            <Upload className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden sm:inline">Import</span>
          </label>

          {/* Quick Demo Sample Data Button */}
          <button
            onClick={trades.length > 0 ? clearTrades : loadSampleTrades}
            className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-mono border border-slate-700 transition-colors"
            title={trades.length > 0 ? "Clear all trades" : "Load sample trade data for testing"}
          >
            {trades.length > 0 ? "Clear" : "Sample Data"}
          </button>
        </div>
      </div>

      {/* Toast Alert */}
      {toastMessage && (
        <div
          className={`p-3 rounded-xl border flex items-center justify-between text-xs font-mono ${
            toastMessage.type === "success"
              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
              : "bg-rose-500/10 text-rose-400 border-rose-500/20"
          }`}
        >
          <div className="flex items-center gap-2">
            {toastMessage.type === "success" ? (
              <CheckCircle2 className="w-4 h-4" />
            ) : (
              <AlertCircle className="w-4 h-4" />
            )}
            <span>{toastMessage.text}</span>
          </div>
          <button
            onClick={() => setToastMessage(null)}
            className="text-slate-400 hover:text-slate-200"
          >
            ✕
          </button>
        </div>
      )}

      {/* Filter & Search Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl bg-slate-900/60 border border-slate-800/80 text-xs font-mono">
        {/* Search Input */}
        <div className="flex items-center gap-2 flex-1 min-w-[220px] px-3 py-2 rounded-xl bg-slate-950/80 border border-slate-800 text-slate-300">
          <Search className="w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder="Search by symbol, strategy, mistake tag..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-transparent border-none outline-none w-full text-slate-100 placeholder:text-slate-500"
          />
        </div>

        {/* Strategy Filter */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-950/80 border border-slate-800 text-slate-300">
            <Filter className="w-3.5 h-3.5 text-cyan-400" />
            <select
              value={filterStrategy}
              onChange={(e) => setFilterStrategy(e.target.value)}
              className="bg-transparent border-none outline-none text-slate-200 cursor-pointer"
            >
              <option value="ALL">All Strategies</option>
              {uniqueStrategies.map((s) => (
                <option key={s} value={s}>
                  {formatStrategyName(s)}
                </option>
              ))}
            </select>
          </div>

          {/* Direction Filter */}
          <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-950/80 border border-slate-800 text-slate-300">
            <select
              value={filterSide}
              onChange={(e) => setFilterSide(e.target.value)}
              className="bg-transparent border-none outline-none text-slate-200 cursor-pointer"
            >
              <option value="ALL">All Sides</option>
              <option value="LONG">LONG</option>
              <option value="SHORT">SHORT</option>
            </select>
          </div>
        </div>
      </div>

      {/* Main Trade Table */}
      <TradeTable
        trades={filteredTrades}
        onView={handleOpenDetailModal}
        onEdit={handleOpenEditForm}
        onDelete={deleteTrade}
      />

      {/* Trade Form Modal (Create & Edit) */}
      <TradeFormModal
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        onSubmit={handleFormSubmit}
        initialData={editingTrade}
      />

      {/* Trade Detail Modal (View) */}
      <TradeDetailModal
        trade={viewingTrade}
        isOpen={isDetailOpen}
        onClose={() => setIsDetailOpen(false)}
        onEdit={handleOpenEditForm}
      />
    </div>
  );
}
