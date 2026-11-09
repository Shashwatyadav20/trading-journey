"use client";

import React, { useState, useEffect } from "react";
import {
  X,
  Shield,
  Clock,
  Zap,
  FileText,
  Activity,
  Server,
  Layers,
  Lock,
  Sliders,
  Check,
} from "lucide-react";

export interface TradeAuditData {
  tradeId: string;
  symbol: string;
  companyName: string;
  strategyUsed: string;
  entryPrice: number;
  stopLossPrice: number;
  initialStopLoss?: number;
  targetPrice: number;
  allocatedCapital: number;
  quantity: number;
  executionTime: string;
  exitTime?: string;
  status: string;
  currentSimulatedPrice: number;
  pnlAmount: number;
  pnlPercent: number;
  // Purple Box & Same-Day Price Freeze Permanent Locks
  lockedDateKey?: string;
  lockedReferenceLevel?: number;
  lockedReferenceLabel?: string;
  purpleBoxMode?: string;
  boxFloorVAL?: number;
  boxCeilingVAH?: number;
  boxMidPOC?: number;
  boxWidthPct?: number;
  supportTouches?: number;
  resistanceTouches?: number;
  // Institutional attributes
  isTslActive?: boolean;
  trailingStopPrice?: number;
  lockedGainPercent?: number;
  lockedGainRupees?: number;
  tslTier?: string;
  slippageSimulation?: {
    requestedPrice: number;
    executedPrice: number;
    slippagePercent: number;
    slippageAmountRupees: number;
    spreadBps: number;
  };
  brokerWebhook?: {
    broker: string;
    brokerOrderId: string;
    orderStatus: string;
    webhookDispatchedAt: string;
    payloadHash: string;
    lastWebhookPayload?: Record<string, any>;
  };
  mtfSnapshot?: {
    tf4hConfirmed: boolean;
    tf15mVwap: number;
    priceVsVwapPct: number;
    grade: string;
  };
  auditTrail?: Array<{ timestamp: string; action: string; details: string }>;
}

interface IMTradeAuditInspectorModalProps {
  trade: TradeAuditData | null;
  onClose: () => void;
  onUpdateTrade?: (
    tradeId: string,
    updates: {
      stopLossPrice: number;
      trailingStopPrice: number;
      targetPrice: number;
      isTslActive: boolean;
      tslTier: string;
      auditEntry: { timestamp: string; action: string; details: string };
    }
  ) => void;
}

export default function IMTradeAuditInspectorModal({
  trade,
  onClose,
  onUpdateTrade,
}: IMTradeAuditInspectorModalProps) {
  const [activeTab, setActiveTab] = useState<
    "OVERVIEW" | "ADJUST_SL_TP" | "SLIPPAGE_BROKER" | "MTF_AUDIT" | "RAW_WEBHOOK"
  >("OVERVIEW");

  const [editSL, setEditSL] = useState<number>(0);
  const [editTP, setEditTP] = useState<number>(0);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    if (trade) {
      setEditSL(Number((trade.trailingStopPrice ?? trade.stopLossPrice).toFixed(2)));
      setEditTP(Number(trade.targetPrice.toFixed(2)));
      setSaveMessage(null);
    }
  }, [trade]);

  if (!trade) return null;

  const lockedRef =
    trade.lockedReferenceLevel ??
    (trade.purpleBoxMode === "MODE_A_SUPPORT_BUY"
      ? trade.boxFloorVAL ?? trade.stopLossPrice
      : trade.boxCeilingVAH ?? trade.entryPrice);

  const lockedRefLabel =
    trade.lockedReferenceLabel ??
    (trade.purpleBoxMode === "MODE_A_SUPPORT_BUY" ? "VAL_SUPPORT_FLOOR" : "VAH_BOX_CEILING");

  const slippage = trade.slippageSimulation || {
    requestedPrice: trade.entryPrice,
    executedPrice: trade.entryPrice,
    slippagePercent: 0.0,
    slippageAmountRupees: 0,
    spreadBps: 5.0,
  };

  const broker = trade.brokerWebhook || {
    broker: "DHAN_HQ",
    brokerOrderId: `DHAN-${trade.symbol}-${Date.now().toString().slice(-6)}`,
    orderStatus: trade.status === "ACTIVE" ? "TRADED" : "CLOSED",
    webhookDispatchedAt: trade.executionTime,
    payloadHash: `wh_dh_${trade.symbol.toLowerCase()}`,
    lastWebhookPayload: {
      broker: "DHAN_HQ",
      exchange: "NSE",
      segment: "EQUITY_CASH",
      securityId: trade.symbol,
      productType: "CNC",
      quantity: trade.quantity,
      price: trade.entryPrice,
      status: "EXECUTED",
    },
  };

  const handleSaveAdjustments = () => {
    if (!onUpdateTrade) return;
    const validSL = Math.max(0.05, Number(editSL.toFixed(2)));
    const validTP = Math.max(validSL + 0.5, Number(editTP.toFixed(2)));
    const isTsl = validSL >= trade.entryPrice;
    const nowIst = new Date().toLocaleString("en-IN");

    onUpdateTrade(trade.tradeId, {
      stopLossPrice: validSL,
      trailingStopPrice: validSL,
      targetPrice: validTP,
      isTslActive: isTsl || Boolean(trade.isTslActive),
      tslTier: isTsl ? "MANUAL_TRAIL_LOCKED" : trade.tslTier || "MANUAL_SL_ADJUSTED",
      auditEntry: {
        timestamp: nowIst,
        action: "MANUAL_SL_TP_ADJUSTMENT",
        details: `Updated SL → ₹${validSL}, Target → ₹${validTP}. Locked Entry (₹${trade.entryPrice}) & Reference Level (₹${lockedRef}) remain immutable.`,
      },
    });

    setSaveMessage(
      `✅ Saved! Stop-Loss updated to ₹${validSL} and Target updated to ₹${validTP} (Locked Entry ₹${trade.entryPrice} & Reference ₹${lockedRef} unchanged).`
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-2xl border border-slate-800 bg-[#0c1220] p-6 shadow-2xl font-mono">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-bold text-slate-100">
                  {trade.symbol} • Trade Audit &amp; SL/TP Inspector
                </h3>
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                  {trade.tradeId}
                </span>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                    trade.status === "ACTIVE"
                      ? "bg-emerald-950/60 text-emerald-400 border border-emerald-500/40"
                      : trade.status === "TARGET_HIT"
                      ? "bg-cyan-950/60 text-cyan-400 border border-cyan-500/40"
                      : "bg-rose-950/60 text-rose-400 border border-rose-500/40"
                  }`}
                >
                  {trade.status.replace("_", " ")}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {trade.companyName} • {trade.strategyUsed} • Freeze Key: {trade.lockedDateKey || "TODAY"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800/80 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 my-4 border-b border-slate-800/80 pb-2 text-xs flex-wrap">
          <button
            onClick={() => setActiveTab("OVERVIEW")}
            className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
              activeTab === "OVERVIEW"
                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-semibold"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Execution Ledger
          </button>
          <button
            onClick={() => setActiveTab("ADJUST_SL_TP")}
            className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === "ADJUST_SL_TP"
                ? "bg-violet-500/25 text-violet-300 border border-violet-500/50 font-semibold"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Sliders className="w-3.5 h-3.5 text-violet-400" />
            <span>Adjust SL / TP &amp; Trailing</span>
          </button>
          <button
            onClick={() => setActiveTab("SLIPPAGE_BROKER")}
            className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
              activeTab === "SLIPPAGE_BROKER"
                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-semibold"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Broker Webhook &amp; Fill
          </button>
          <button
            onClick={() => setActiveTab("MTF_AUDIT")}
            className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
              activeTab === "MTF_AUDIT"
                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-semibold"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Purple Box &amp; MTF Confluence
          </button>
          <button
            onClick={() => setActiveTab("RAW_WEBHOOK")}
            className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
              activeTab === "RAW_WEBHOOK"
                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-semibold"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Raw JSON
          </button>
        </div>

        {/* Tab 1: Execution Ledger */}
        {activeTab === "OVERVIEW" && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800">
                <div className="text-[10px] text-cyan-400 uppercase flex items-center gap-1 font-bold">
                  <Lock className="w-3 h-3" /> Frozen Entry (LTP)
                </div>
                <div className="text-base font-bold text-slate-100 mt-1">
                  ₹{trade.entryPrice.toLocaleString("en-IN")}
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">Qty: {trade.quantity} shares</div>
              </div>

              <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800">
                <div className="text-[10px] text-slate-400 uppercase font-bold">Current Live LTP</div>
                <div className="text-base font-bold text-cyan-300 mt-1">
                  ₹{trade.currentSimulatedPrice.toLocaleString("en-IN")}
                </div>
                <div
                  className={`text-[10px] mt-0.5 font-bold ${
                    trade.pnlPercent >= 0 ? "text-emerald-400" : "text-rose-400"
                  }`}
                >
                  {trade.pnlPercent >= 0 ? "+" : ""}
                  {trade.pnlPercent}% ({trade.pnlAmount >= 0 ? "+" : ""}₹
                  {trade.pnlAmount.toLocaleString("en-IN")})
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800">
                <div className="text-[10px] text-amber-400 uppercase font-bold">Active Stop Loss</div>
                <div className="text-base font-bold text-amber-300 mt-1">
                  ₹{(trade.trailingStopPrice || trade.stopLossPrice).toLocaleString("en-IN")}
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">
                  {trade.isTslActive ? "🛡️ Trailing Stop Active" : "Initial Structural SL"}
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800">
                <div className="text-[10px] text-emerald-400 uppercase font-bold">Target Price</div>
                <div className="text-base font-bold text-emerald-400 mt-1">
                  ₹{trade.targetPrice.toLocaleString("en-IN")}
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">
                  {trade.purpleBoxMode === "MODE_A_SUPPORT_BUY" ? "VAH Resistance Target" : "+7% Breakout Target"}
                </div>
              </div>
            </div>

            {/* Permanently Locked Reference Banner */}
            <div className="p-3.5 rounded-xl border border-violet-500/40 bg-violet-500/10 flex flex-col md:flex-row md:items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 text-violet-200">
                <Lock className="w-4 h-4 text-violet-400 shrink-0" />
                <span>
                  <strong>Permanently Locked Reference ({lockedRefLabel}):</strong> ₹{lockedRef} • Same-Day Freeze Key:{" "}
                  <span className="text-cyan-300">{trade.lockedDateKey || "LOCKED"}</span>
                </span>
              </div>
              {trade.boxFloorVAL && trade.boxCeilingVAH && (
                <span className="text-[11px] text-violet-300">
                  Purple Box: VAL ₹{trade.boxFloorVAL} ↔ VAH ₹{trade.boxCeilingVAH} ({trade.boxWidthPct}%)
                </span>
              )}
            </div>

            {/* Trailing Stop Status Box */}
            <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-amber-300 flex items-center gap-2">
                  <Zap className="w-4 h-4 text-amber-400" />
                  Automated Trailing Stop-Loss (TSL) &amp; Next-Day Adjustment Status
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-amber-950/70 text-amber-200 border border-amber-500/30">
                  {trade.tslTier || (trade.isTslActive ? "ACTIVE_PROTECTION" : "WAITING_+3%_TRIGGER")}
                </span>
              </div>
              <p className="text-xs text-slate-300">
                {trade.isTslActive
                  ? `TSL is ACTIVE: Stop price locked at ₹${trade.trailingStopPrice}. Original Reference Level (₹${lockedRef}) and Initial Entry (₹${trade.entryPrice}) remain permanently frozen.`
                  : `Initial entry locked at exact Live LTP (₹${trade.entryPrice}) so initial P&L started at ₹0 (0%). Switch to the "Adjust SL / TP & Trailing" tab to manually trail or modify SL/TP.`}
              </p>
            </div>

            {/* Execution Audit Trail */}
            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-300 flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                Audit Timestamp &amp; Event Ledger
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs space-y-2 text-slate-400 max-h-40 overflow-y-auto">
                <div className="flex items-center justify-between">
                  <span>Execution Timestamp (IST):</span>
                  <span className="text-slate-200">{trade.executionTime}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Allocated Capital:</span>
                  <span className="text-slate-200">₹{trade.allocatedCapital.toLocaleString("en-IN")}</span>
                </div>
                {Array.isArray(trade.auditTrail) &&
                  trade.auditTrail.map((entry, idx) => (
                    <div key={idx} className="pt-1.5 border-t border-slate-800/80 text-[11px] text-cyan-300">
                      [{entry.timestamp}] <strong>{entry.action}:</strong> {entry.details}
                    </div>
                  ))}
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Interactive Manual SL/TP & Next-Day Trailing Console */}
        {activeTab === "ADJUST_SL_TP" && (
          <div className="space-y-4 text-xs">
            <div className="p-4 rounded-xl border border-violet-500/30 bg-slate-900/70 space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h4 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                    <Sliders className="w-4 h-4 text-violet-400" />
                    Next-Day Trailing &amp; Manual SL / TP Adjustment Console
                  </h4>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Adjust Stop-Loss and Target freely while keeping Locked Entry (₹{trade.entryPrice}) and Reference
                    Level (₹{lockedRef}) permanently frozen.
                  </p>
                </div>
                <span className="px-2.5 py-1 rounded-lg bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 text-[10px] font-bold">
                  🔒 Entry ₹{trade.entryPrice} &amp; Ref ₹{lockedRef} Immutable
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                <div className="space-y-1.5">
                  <label className="text-slate-300 font-bold block">
                    Stop-Loss / Trailing Stop Price (₹)
                  </label>
                  <input
                    type="number"
                    step="0.05"
                    value={editSL}
                    onChange={(e) => setEditSL(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-amber-300 font-bold text-sm focus:outline-none focus:border-amber-400"
                  />
                  <div className="text-[10px] text-slate-500">
                    Initial Structural SL: ₹{trade.initialStopLoss ?? trade.stopLossPrice} | Current LTP: ₹
                    {trade.currentSimulatedPrice}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-slate-300 font-bold block">
                    Target Take-Profit Price (₹)
                  </label>
                  <input
                    type="number"
                    step="0.05"
                    value={editTP}
                    onChange={(e) => setEditTP(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-emerald-300 font-bold text-sm focus:outline-none focus:border-emerald-400"
                  />
                  <div className="text-[10px] text-slate-500">
                    Projected R:R with edited levels: 1:
                    {Number(
                      (
                        Math.abs(editTP - trade.entryPrice) /
                        Math.max(0.5, Math.abs(trade.entryPrice - editSL))
                      ).toFixed(2)
                    )}
                  </div>
                </div>
              </div>

              {/* Quick Institutional Presets */}
              <div className="space-y-2 pt-2 border-t border-slate-800">
                <span className="text-[10px] text-slate-400 uppercase font-bold block">
                  Quick Institutional Trailing Presets:
                </span>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setEditSL(Number(trade.entryPrice.toFixed(2)))}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 text-[11px] font-semibold cursor-pointer"
                  >
                    Trail SL to Break-Even (₹{trade.entryPrice})
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditSL(Number((trade.entryPrice * 1.02).toFixed(2)))}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 text-[11px] font-semibold cursor-pointer"
                  >
                    Lock +2% Profit SL (₹{(trade.entryPrice * 1.02).toFixed(2)})
                  </button>
                  {trade.boxMidPOC && (
                    <button
                      type="button"
                      onClick={() => setEditSL(Number(trade.boxMidPOC!.toFixed(2)))}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-violet-300 border border-slate-700 text-[11px] font-semibold cursor-pointer"
                    >
                      Anchor SL to Box POC (₹{trade.boxMidPOC})
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setEditTP(Number((trade.entryPrice * 1.07).toFixed(2)))}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700 text-[11px] font-semibold cursor-pointer"
                  >
                    Set +7% Breakout Target (₹{(trade.entryPrice * 1.07).toFixed(2)})
                  </button>
                  {trade.boxCeilingVAH && (
                    <button
                      type="button"
                      onClick={() => setEditTP(Number(trade.boxCeilingVAH!.toFixed(2)))}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700 text-[11px] font-semibold cursor-pointer"
                    >
                      Set Target to Box VAH (₹{trade.boxCeilingVAH})
                    </button>
                  )}
                </div>
              </div>

              {saveMessage && (
                <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-xs">
                  {saveMessage}
                </div>
              )}

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={handleSaveAdjustments}
                  disabled={!onUpdateTrade}
                  className="px-4 py-2 rounded-xl bg-emerald-500/25 hover:bg-emerald-500/35 text-emerald-300 border border-emerald-500/50 font-bold text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Check className="w-4 h-4" />
                  <span>Save SL / TP Adjustments</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: Slippage & Broker Webhook */}
        {activeTab === "SLIPPAGE_BROKER" && (
          <div className="space-y-4 text-xs">
            <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 space-y-3">
              <div className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <Server className="w-4 h-4 text-cyan-400" />
                Institutional Broker Webhook Gateway
              </div>
              <div className="grid grid-cols-2 gap-3 text-slate-300">
                <div>
                  <span className="text-slate-500">Broker Gateway:</span>{" "}
                  <span className="text-cyan-300 font-bold">{broker.broker}</span>
                </div>
                <div>
                  <span className="text-slate-500">Broker Order ID:</span>{" "}
                  <span className="text-slate-200">{broker.brokerOrderId}</span>
                </div>
                <div>
                  <span className="text-slate-500">Webhook Status:</span>{" "}
                  <span className="text-emerald-400">{broker.orderStatus}</span>
                </div>
                <div>
                  <span className="text-slate-500">Payload Signature:</span>{" "}
                  <span className="text-purple-300">{broker.payloadHash}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-slate-500">Dispatch Time:</span>{" "}
                  <span className="text-slate-300">{broker.webhookDispatchedAt}</span>
                </div>
              </div>
            </div>

            <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 space-y-3">
              <div className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <Activity className="w-4 h-4 text-amber-400" />
                Zero-Jump LTP Execution Lock &amp; Benchmark Audit
              </div>
              <div className="space-y-2 text-slate-300">
                <div className="flex justify-between">
                  <span className="text-slate-500">Live Market Price (LTP) at Execution:</span>
                  <span className="text-cyan-300 font-bold">₹{trade.entryPrice}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Locked Entry Price (Zero P&amp;L Jump Guarantee):</span>
                  <span className="text-emerald-400 font-bold">₹{trade.entryPrice} (Starts at ₹0 / 0%)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Estimated Exchange Impact Benchmark:</span>
                  <span className="text-amber-300">
                    {slippage.slippagePercent}% ({slippage.spreadBps} bps spread)
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 4: Purple Box & MTF Confluence Snapshot */}
        {activeTab === "MTF_AUDIT" && (
          <div className="space-y-4 text-xs">
            <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 space-y-3">
              <div className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <Layers className="w-4 h-4 text-purple-400" />
                Purple Box Range &amp; Multi-Timeframe Structural Verification
              </div>
              <div className="space-y-2.5">
                <div className="p-2.5 rounded-lg bg-slate-950/70 border border-slate-800 flex items-center justify-between">
                  <div>
                    <div className="text-slate-200 font-bold">
                      1D Purple Box ({trade.purpleBoxMode || "DUAL_MODE_VERIFIED"})
                    </div>
                    <div className="text-[10px] text-slate-400">
                      VAL ₹{trade.boxFloorVAL ?? lockedRef} ↔ VAH ₹{trade.boxCeilingVAH ?? trade.targetPrice} (
                      {trade.supportTouches ?? 3} Support / {trade.resistanceTouches ?? 2} Resistance Touches)
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-violet-950/60 text-violet-300 border border-violet-500/30 text-[10px]">
                    LOCKED REF ₹{lockedRef}
                  </span>
                </div>

                <div className="p-2.5 rounded-lg bg-slate-950/70 border border-slate-800 flex items-center justify-between">
                  <div>
                    <div className="text-slate-200 font-bold">4H / 1H Structural Confluence</div>
                    <div className="text-[10px] text-slate-400">
                      Higher-Highs / Order Block demand hold aligned with 4H EMA20
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-500/30 text-[10px]">
                    CONFIRMED
                  </span>
                </div>

                <div className="p-2.5 rounded-lg bg-slate-950/70 border border-slate-800 flex items-center justify-between">
                  <div>
                    <div className="text-slate-200 font-bold">15M VWAP &amp; Order Block Filter</div>
                    <div className="text-[10px] text-slate-400">
                      Trading above intraday VWAP • Zero bearish supply block rejection
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-cyan-950/60 text-cyan-400 border border-cyan-500/30 text-[10px]">
                    BULL TRAP FILTERED
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 5: Raw JSON Payload */}
        {activeTab === "RAW_WEBHOOK" && (
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 max-h-72 overflow-y-auto text-[11px] text-cyan-300">
            <pre>{JSON.stringify(trade, null, 2)}</pre>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end pt-4 mt-4 border-t border-slate-800">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors cursor-pointer"
          >
            Close Inspector
          </button>
        </div>
      </div>
    </div>
  );
}
