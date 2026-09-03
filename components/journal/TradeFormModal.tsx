"use client";

import React, { useState, useEffect } from "react";
import { Trade, TradeSide, MistakeTag, MISTAKE_OPTIONS } from "../../types/trade";
import { CreateTradeInput, computeTradeMetrics } from "../../context/TradeContext";
import { formatCurrency } from "../../lib/calculations";
import {
  X,
  Plus,
  Edit2,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  Image as ImageIcon,
  DollarSign,
  Tag,
  Clock,
  Calendar,
} from "lucide-react";

interface TradeFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: CreateTradeInput) => void;
  initialData?: Trade | null;
}

const PRESET_STRATEGIES = [
  "Liquidity Sweep",
  "swing high and swing low",
  "EQH AND EQL",
  "PWL AND PWH",
  "OB CREATE AND RETEST THEN ENTRY",
];

export default function TradeFormModal({
  isOpen,
  onClose,
  onSubmit,
  initialData,
}: TradeFormModalProps) {
  const [date, setDate] = useState<string>(
    new Date().toISOString().split("T")[0]
  );
  const [time, setTime] = useState<string>("09:30");
  const [symbol, setSymbol] = useState<string>("");
  const [side, setSide] = useState<TradeSide>("LONG");
  const [strategy, setStrategy] = useState<string>("Liquidity Sweep");
  const [entryPrice, setEntryPrice] = useState<string>("");
  const [stopLoss, setStopLoss] = useState<string>("");
  const [targetPrice, setTargetPrice] = useState<string>("");
  const [exitPrice, setExitPrice] = useState<string>("");
  const [quantity, setQuantity] = useState<string>("1");
  const [fees, setFees] = useState<string>("5.00");
  const [notes, setNotes] = useState<string>("");
  const [mistakeTag, setMistakeTag] = useState<MistakeTag>("No Mistake");
  const [screenshotUrl, setScreenshotUrl] = useState<string>("");

  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (initialData) {
      setDate(initialData.date || new Date().toISOString().split("T")[0]);
      setTime(initialData.time || "09:30");
      setSymbol(initialData.symbol || "");
      setSide(initialData.side || "LONG");
      setStrategy(initialData.strategy || "Liquidity Sweep");
      setEntryPrice(initialData.entryPrice ? initialData.entryPrice.toString() : "");
      setStopLoss(initialData.stopLoss ? initialData.stopLoss.toString() : "");
      setTargetPrice(initialData.targetPrice ? initialData.targetPrice.toString() : "");
      setExitPrice(initialData.exitPrice ? initialData.exitPrice.toString() : "");
      setQuantity(initialData.quantity ? initialData.quantity.toString() : "1");
      setFees(initialData.fees !== undefined ? initialData.fees.toString() : "5.00");
      setNotes(initialData.notes || "");
      setMistakeTag(initialData.mistakeTag || "No Mistake");
      setScreenshotUrl(initialData.screenshotUrl || "");
    } else {
      // Reset form
      setDate(new Date().toISOString().split("T")[0]);
      setTime("09:30");
      setSymbol("");
      setSide("LONG");
      setStrategy("Liquidity Sweep");
      setEntryPrice("");
      setStopLoss("");
      setTargetPrice("");
      setExitPrice("");
      setQuantity("1");
      setFees("5.00");
      setNotes("");
      setMistakeTag("No Mistake");
      setScreenshotUrl("");
    }
    setErrors({});
  }, [initialData, isOpen]);

  if (!isOpen) return null;

  // Real-time calculation preview
  const numEntry = parseFloat(entryPrice) || 0;
  const numExit = parseFloat(exitPrice) || 0;
  const numQty = parseFloat(quantity) || 0;
  const numFees = parseFloat(fees) || 0;
  const numSL = parseFloat(stopLoss) || 0;

  const liveMetrics =
    numEntry > 0 && numExit > 0 && numQty > 0
      ? computeTradeMetrics({
          date,
          symbol: symbol || "SAMPLE",
          side,
          strategy,
          entryPrice: numEntry,
          exitPrice: numExit,
          quantity: numQty,
          fees: numFees,
          stopLoss: numSL,
        })
      : null;

  const validate = (): boolean => {
    const errs: Record<string, string> = {};

    if (!date) errs.date = "Date is required";
    if (!symbol.trim()) errs.symbol = "Symbol is required (e.g. NQ1!, BTC/USD)";
    if (!entryPrice || isNaN(numEntry) || numEntry <= 0)
      errs.entryPrice = "Valid Entry Price > 0 is required";
    if (!exitPrice || isNaN(numExit) || numExit <= 0)
      errs.exitPrice = "Valid Exit Price > 0 is required";
    if (!quantity || isNaN(numQty) || numQty <= 0)
      errs.quantity = "Quantity > 0 is required";

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    onSubmit({
      date,
      time,
      symbol: symbol.trim().toUpperCase(),
      side,
      strategy: strategy.trim() || "Uncategorized",
      entryPrice: numEntry,
      stopLoss: numSL > 0 ? numSL : undefined,
      targetPrice: parseFloat(targetPrice) || undefined,
      exitPrice: numExit,
      quantity: numQty,
      fees: numFees,
      notes: notes.trim(),
      mistakeTag,
      screenshotUrl: screenshotUrl.trim() || undefined,
    });

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-2xl bg-[#0d1322] border border-slate-800 rounded-2xl shadow-2xl overflow-hidden my-8">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800/80 bg-slate-900/60">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              {initialData ? <Edit2 className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-100 font-sans tracking-tight">
                {initialData ? "Edit Trade Entry" : "Log New Trade Entry"}
              </h3>
              <p className="text-xs text-slate-400 font-mono">
                Fill in execution parameters and tags
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Live Metrics Summary Bar if prices filled */}
        {liveMetrics && (
          <div className="px-6 py-2.5 bg-slate-950/80 border-b border-slate-800/60 flex items-center justify-between font-mono text-xs">
            <span className="text-slate-400">Live Calculation Preview:</span>
            <div className="flex items-center gap-4">
              <span className="text-slate-400">
                PnL:{" "}
                <span
                  className={`font-bold ${
                    liveMetrics.pnl >= 0 ? "text-emerald-400" : "text-rose-400"
                  }`}
                >
                  {formatCurrency(liveMetrics.pnl, true)}
                </span>
              </span>
              <span className="text-slate-400">
                R-Multiple:{" "}
                <span className="font-bold text-cyan-400">
                  {liveMetrics.rMultiple > 0
                    ? `+${liveMetrics.rMultiple.toFixed(2)}R`
                    : `${liveMetrics.rMultiple.toFixed(2)}R`}
                </span>
              </span>
            </div>
          </div>
        )}

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 text-xs font-mono">
          {/* Row 1: Date, Time, Symbol */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="text-slate-300 font-semibold flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-cyan-400" />
                Date *
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={`w-full px-3 py-2 rounded-xl bg-slate-950 border ${
                  errors.date ? "border-rose-500" : "border-slate-800"
                } text-slate-100 outline-none focus:border-cyan-500`}
              />
              {errors.date && (
                <span className="text-[10px] text-rose-400 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> {errors.date}
                </span>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-slate-300 font-semibold flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                Time
              </label>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 outline-none focus:border-cyan-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-slate-300 font-semibold">Symbol *</label>
              <input
                type="text"
                placeholder="e.g. NQ1!, BTC/USD, AAPL"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                className={`w-full px-3 py-2 rounded-xl bg-slate-950 border ${
                  errors.symbol ? "border-rose-500" : "border-slate-800"
                } text-slate-100 placeholder:text-slate-600 outline-none focus:border-cyan-500 uppercase`}
              />
              {errors.symbol && (
                <span className="text-[10px] text-rose-400 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> {errors.symbol}
                </span>
              )}
            </div>
          </div>

          {/* Row 2: Direction & Strategy */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-slate-300 font-semibold">Direction *</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setSide("LONG")}
                  className={`py-2 rounded-xl font-bold flex items-center justify-center gap-1.5 border transition-all ${
                    side === "LONG"
                      ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/40 shadow-sm"
                      : "bg-slate-950 text-slate-500 border-slate-800 hover:text-slate-300"
                  }`}
                >
                  <TrendingUp className="w-4 h-4" /> LONG
                </button>

                <button
                  type="button"
                  onClick={() => setSide("SHORT")}
                  className={`py-2 rounded-xl font-bold flex items-center justify-center gap-1.5 border transition-all ${
                    side === "SHORT"
                      ? "bg-rose-500/20 text-rose-400 border-rose-500/40 shadow-sm"
                      : "bg-slate-950 text-slate-500 border-slate-800 hover:text-slate-300"
                  }`}
                >
                  <TrendingDown className="w-4 h-4" /> SHORT
                </button>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-slate-300 font-semibold">Strategy</label>
              <select
                value={strategy}
                onChange={(e) => setStrategy(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 outline-none focus:border-cyan-500"
              >
                {PRESET_STRATEGIES.map((strat) => (
                  <option key={strat} value={strat}>
                    {strat}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Row 3: Prices & Quantity */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="space-y-1">
              <label className="text-slate-300 font-semibold">Entry Price *</label>
              <input
                type="number"
                step="any"
                placeholder="0.00"
                value={entryPrice}
                onChange={(e) => setEntryPrice(e.target.value)}
                className={`w-full px-3 py-2 rounded-xl bg-slate-950 border ${
                  errors.entryPrice ? "border-rose-500" : "border-slate-800"
                } text-slate-100 outline-none focus:border-cyan-500`}
              />
              {errors.entryPrice && (
                <span className="text-[9px] text-rose-400">{errors.entryPrice}</span>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-slate-300 font-semibold">Stop Loss</label>
              <input
                type="number"
                step="any"
                placeholder="0.00"
                value={stopLoss}
                onChange={(e) => setStopLoss(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 outline-none focus:border-cyan-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-slate-300 font-semibold">Target Price</label>
              <input
                type="number"
                step="any"
                placeholder="0.00"
                value={targetPrice}
                onChange={(e) => setTargetPrice(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 outline-none focus:border-cyan-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-slate-300 font-semibold">Exit Price *</label>
              <input
                type="number"
                step="any"
                placeholder="0.00"
                value={exitPrice}
                onChange={(e) => setExitPrice(e.target.value)}
                className={`w-full px-3 py-2 rounded-xl bg-slate-950 border ${
                  errors.exitPrice ? "border-rose-500" : "border-slate-800"
                } text-slate-100 outline-none focus:border-cyan-500`}
              />
              {errors.exitPrice && (
                <span className="text-[9px] text-rose-400">{errors.exitPrice}</span>
              )}
            </div>
          </div>

          {/* Row 4: Quantity & Fees & Mistake Tag */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="text-slate-300 font-semibold">Quantity *</label>
              <input
                type="number"
                step="any"
                placeholder="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className={`w-full px-3 py-2 rounded-xl bg-slate-950 border ${
                  errors.quantity ? "border-rose-500" : "border-slate-800"
                } text-slate-100 outline-none focus:border-cyan-500`}
              />
            </div>

            <div className="space-y-1">
              <label className="text-slate-300 font-semibold">Fees ($)</label>
              <input
                type="number"
                step="any"
                placeholder="5.00"
                value={fees}
                onChange={(e) => setFees(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 outline-none focus:border-cyan-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-slate-300 font-semibold flex items-center gap-1">
                <Tag className="w-3.5 h-3.5 text-amber-400" />
                Mistake Tag
              </label>
              <select
                value={mistakeTag}
                onChange={(e) => setMistakeTag(e.target.value as MistakeTag)}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 outline-none focus:border-cyan-500"
              >
                {MISTAKE_OPTIONS.map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Row 5: Screenshot URL & Notes */}
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-slate-300 font-semibold flex items-center gap-1">
                <ImageIcon className="w-3.5 h-3.5 text-cyan-400" />
                Screenshot URL (optional)
              </label>
              <input
                type="url"
                placeholder="https://..."
                value={screenshotUrl}
                onChange={(e) => setScreenshotUrl(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder:text-slate-600 outline-none focus:border-cyan-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-slate-300 font-semibold">Trade Notes & Execution Thoughts</label>
              <textarea
                rows={3}
                placeholder="Describe setup confluence, market session conditions, or psychological state..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder:text-slate-600 outline-none focus:border-cyan-500 resize-none"
              />
            </div>
          </div>

          {/* Footer Submit Buttons */}
          <div className="pt-2 flex items-center justify-end gap-3 border-t border-slate-800/80">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
            >
              Cancel
            </button>

            <button
              type="submit"
              className="px-5 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-slate-950 font-bold shadow-lg shadow-cyan-500/20 transition-all"
            >
              {initialData ? "Save Changes" : "Submit Trade Entry"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
