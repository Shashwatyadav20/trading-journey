"use client";

import React, { useState, useEffect, useRef } from "react";
import { useTrades } from "../../context/TradeContext";
import { useMarketData } from "../../context/MarketDataContext";
import { Trade } from "../../types/trade";
import {
  ArrowUpRight,
  ArrowDownRight,
  DollarSign,
  ShieldAlert,
  Target,
  Zap,
  Gauge,
  TrendingUp,
  AlertTriangle,
  Wallet,
  Loader2,
  RefreshCw,
  WifiOff,
} from "lucide-react";

interface PaperTradingPanelProps {
  currentSymbol?: string;
  activeSetupTag?: string | null;
  onTradeOpened?: (trade: Trade) => void;
}

export default function PaperTradingPanel({
  currentSymbol = "XAU/USD",
  activeSetupTag = null,
  onTradeOpened,
}: PaperTradingPanelProps) {
  const { addTrade, addPendingOrder, startingCapital, trades } = useTrades();
  const { getPrice, connectionStatus } = useMarketData();

  // ── Price state (captured on demand by LIVE PRICE button) ───────────────────
  const [livePrice, setLivePrice] = useState<number>(0);
  const [priceSource, setPriceSource] = useState<string>("");
  const [fetchError, setFetchError] = useState<string>("");
  const [lastFetchedStatus, setLastFetchedStatus] = useState<string>("");

  // ── Order form state ───────────────────────────────────────────────────────
  const [orderType, setOrderType] = useState<"MARKET" | "LIMIT">("MARKET");
  const [activeSide, setActiveSide] = useState<"LONG" | "SHORT">("LONG");
  const [limitPrice, setLimitPrice] = useState<number>(0);
  const [quantity, setQuantity] = useState<number>(0.01);
  const [stopLoss, setStopLoss] = useState<number>(0);
  const [targetPrice, setTargetPrice] = useState<number>(0);
  const [executedMessage, setExecutedMessage] = useState<string | null>(null);

  const prevSymbolRef = useRef(currentSymbol);

  // Reset price & form when instrument changes
  useEffect(() => {
    if (prevSymbolRef.current !== currentSymbol) {
      prevSymbolRef.current = currentSymbol;
      setLivePrice(0);
      setFetchError("");
      setPriceSource("");
      setLastFetchedStatus("");
      setLimitPrice(0);
      setStopLoss(0);
      setTargetPrice(0);
      setQuantity(currentSymbol.includes("BTC") ? 0.001 : 0.01);
    }
  }, [currentSymbol]);

  // Auto-fill SL/TP when a live price first arrives
  const initSlTp = (price: number, sym: string) => {
    if (sym.includes("BTC")) {
      setStopLoss(parseFloat((price * 0.99).toFixed(2)));
      setTargetPrice(parseFloat((price * 1.025).toFixed(2)));
      setLimitPrice(parseFloat((price * 0.995).toFixed(2)));
    } else {
      // XAU/USD — 20pt SL, 40pt TP by default
      setStopLoss(parseFloat((price - 20).toFixed(2)));
      setTargetPrice(parseFloat((price + 40).toFixed(2)));
      setLimitPrice(parseFloat((price - 10).toFixed(2)));
    }
  };

  // ── LIVE PRICE button handler (Fetches from centralized context) ───────────
  const handleFetchPrice = () => {
    setFetchError("");
    setPriceSource("");

    if (connectionStatus === "CONNECTING") {
      setFetchError("Connecting to backend...");
      setLivePrice(0);
      return;
    }

    if (connectionStatus === "RECONNECTING") {
      setFetchError("Reconnecting to backend...");
      setLivePrice(0);
      return;
    }

    if (connectionStatus !== "CONNECTED") {
      setFetchError("Backend disconnected");
      setLivePrice(0);
      return;
    }

    const marketData = getPrice(currentSymbol);

    if (marketData && marketData.status === "LIVE" && marketData.price > 0) {
      setLivePrice(marketData.price);
      setPriceSource(marketData.isProxy ? `${marketData.sourceSymbol} (PROXY)` : marketData.sourceSymbol);
      setLastFetchedStatus(marketData.status);
      
      // Only auto-fill SL/TP if they're still at default (0)
      if (stopLoss === 0 && targetPrice === 0) {
        initSlTp(marketData.price, currentSymbol);
      }
    } else if (marketData && marketData.status === "STALE") {
      setFetchError("Price is currently STALE");
      setLivePrice(0);
    } else {
      setFetchError("Price OFFLINE or unavailable");
      setLivePrice(0);
    }
  };

  // ── Derived calculations ───────────────────────────────────────────────────
  const isMarket = orderType === "MARKET";
  const priceReady = livePrice > 0;
  const effectiveEntry = isMarket ? livePrice : limitPrice;

  const riskPerUnit = effectiveEntry > 0 ? Math.abs(effectiveEntry - stopLoss) : 0;
  const rewardPerUnit = effectiveEntry > 0 ? Math.abs(targetPrice - effectiveEntry) : 0;
  const totalRisk = riskPerUnit * quantity;
  const totalReward = rewardPerUnit * quantity;
  const riskRewardRatio = riskPerUnit > 0 ? rewardPerUnit / riskPerUnit : 0;
  const potentialPnL =
    activeSide === "LONG"
      ? (targetPrice - effectiveEntry) * quantity
      : (effectiveEntry - targetPrice) * quantity;

  const closedPnl = trades
    .filter((t) => t.status !== "OPEN")
    .reduce((sum, t) => sum + t.pnl, 0);
  const accountBalance = startingCapital + closedPnl;
  const riskPercent = accountBalance > 0 ? (totalRisk / accountBalance) * 100 : 0;

  // ── Execute trade / pending order ──────────────────────────────────────────
  const handleExecuteTrade = (side: "LONG" | "SHORT") => {
    const execPrice = isMarket ? livePrice : limitPrice;

    if (execPrice <= 0) {
      setExecutedMessage("⚠ Fetch live price first — click LIVE PRICE");
      setTimeout(() => setExecutedMessage(null), 3000);
      return;
    }

    const todayStr = new Date().toISOString().split("T")[0];
    const timeStr = new Date().toTimeString().split(" ")[0].substring(0, 5);
    const assignedStrategy = activeSetupTag || "Manual Trade";

    if (orderType === "LIMIT") {
      addPendingOrder({
        instrument: currentSymbol,
        side,
        orderType: "LIMIT",
        limitPrice,
        quantity,
        stopLoss,
        takeProfit: targetPrice,
        strategy: assignedStrategy,
        createdAt: new Date().toISOString(),
      });
      setExecutedMessage(`LIMIT ${side} placed @ $${limitPrice.toFixed(2)}`);
      setTimeout(() => setExecutedMessage(null), 4000);
      return;
    }

    // MARKET — use livePrice captured at click moment
    const newTrade = addTrade({
      date: todayStr,
      time: timeStr,
      symbol: currentSymbol,
      side,
      strategy: assignedStrategy,
      entryPrice: execPrice,
      stopLoss,
      targetPrice,
      quantity,
      fees: 0,
      status: "OPEN",
      orderType: "MARKET",
      notes: `Paper ${side} @ $${execPrice.toFixed(2)} via Backend Stream — ${assignedStrategy}`,
    });

    if (onTradeOpened) onTradeOpened(newTrade);
    setExecutedMessage(`✓ ${side} opened @ $${execPrice.toFixed(2)}`);
    setTimeout(() => setExecutedMessage(null), 4000);
  };

  return (
    <div className="p-4 rounded-2xl bg-[#0d1322] border border-slate-800/80 shadow-xl space-y-4 font-mono text-xs">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500/20 to-emerald-500/20 border border-cyan-500/30">
            <Zap className="w-4 h-4 text-cyan-400" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-100 font-sans tracking-tight">Place Order</h3>
            <span className="text-[10px] text-slate-500">Paper Trading · {currentSymbol}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Account balance */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900/80 border border-slate-800/60">
            <Wallet className="w-3 h-3 text-cyan-400" />
            <span className="text-[10px] text-slate-400">Bal:</span>
            <span className={`text-[10px] font-bold ${accountBalance >= startingCapital ? "text-emerald-400" : "text-rose-400"}`}>
              ${accountBalance.toFixed(2)}
            </span>
          </div>

          {/* Strategy tag */}
          <span className={`text-[10px] px-2.5 py-1 rounded-lg font-bold border ${
            activeSetupTag
              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30 animate-pulse"
              : "bg-slate-800 text-slate-400 border-slate-700"
          }`}>
            {activeSetupTag || "Manual Trade"}
          </span>
        </div>
      </div>

      {/* ── LIVE PRICE fetch button ─────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleFetchPrice}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl font-sans font-bold text-[12px] border transition-all duration-150 active:scale-[0.97] shadow-md ${
            connectionStatus === "CONNECTING" || connectionStatus === "RECONNECTING"
              ? "bg-slate-800 border-slate-700 text-slate-400 cursor-wait"
              : priceReady
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20"
              : fetchError
              ? "bg-rose-500/10 border-rose-500/30 text-rose-400 hover:bg-rose-500/20"
              : "bg-cyan-500/10 border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/20 shadow-cyan-950/30"
          }`}
        >
          {connectionStatus === "CONNECTING" || connectionStatus === "RECONNECTING" ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : fetchError ? (
            <WifiOff className="w-3.5 h-3.5" />
          ) : (
            <RefreshCw className={`w-3.5 h-3.5 ${priceReady ? "text-emerald-400" : "text-cyan-400"}`} />
          )}
          {connectionStatus === "CONNECTING"
            ? "Connecting…"
            : connectionStatus === "RECONNECTING"
            ? "Reconnecting…"
            : priceReady
            ? "Refresh Price"
            : fetchError
            ? "Retry"
            : "LIVE PRICE"}
        </button>

        {/* Price display — shown after successful fetch */}
        {priceReady && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[13px] font-bold text-emerald-300 font-mono">
              ${livePrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="text-[9px] text-slate-500">{priceSource}</span>
          </div>
        )}

        {/* Error message */}
        {fetchError && (
          <div className="flex items-center gap-1.5 text-[10px] text-rose-400">
            <WifiOff className="w-3 h-3" />
            <span>{fetchError}</span>
          </div>
        )}
      </div>

      {/* ── Order Type + Side ───────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="space-y-1">
          <label className="text-[10px] text-slate-500 block font-sans">Order Type</label>
          <div className="flex bg-slate-950/60 p-0.5 rounded-lg border border-slate-800/60">
            <button
              onClick={() => setOrderType("MARKET")}
              className={`px-3 py-1.5 rounded-md text-[11px] font-bold transition-all ${
                orderType === "MARKET"
                  ? "bg-cyan-500/15 text-cyan-400 border border-cyan-500/30"
                  : "text-slate-400 hover:text-slate-200 border border-transparent"
              }`}
            >
              Market
            </button>
            <button
              onClick={() => setOrderType("LIMIT")}
              className={`px-3 py-1.5 rounded-md text-[11px] font-bold transition-all ${
                orderType === "LIMIT"
                  ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                  : "text-slate-400 hover:text-slate-200 border border-transparent"
              }`}
            >
              Limit
            </button>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-[10px] text-slate-500 block font-sans">Side</label>
          <div className="flex bg-slate-950/60 p-0.5 rounded-lg border border-slate-800/60">
            <button
              onClick={() => setActiveSide("LONG")}
              className={`px-3 py-1.5 rounded-md text-[11px] font-bold transition-all flex items-center gap-1 ${
                activeSide === "LONG"
                  ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                  : "text-slate-400 hover:text-slate-200 border border-transparent"
              }`}
            >
              <ArrowUpRight className="w-3 h-3" /> BUY
            </button>
            <button
              onClick={() => setActiveSide("SHORT")}
              className={`px-3 py-1.5 rounded-md text-[11px] font-bold transition-all flex items-center gap-1 ${
                activeSide === "SHORT"
                  ? "bg-rose-500/15 text-rose-400 border border-rose-500/30"
                  : "text-slate-400 hover:text-slate-200 border border-transparent"
              }`}
            >
              <ArrowDownRight className="w-3 h-3" /> SELL
            </button>
          </div>
        </div>
      </div>

      {/* ── Price Inputs ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Entry / Limit Price */}
        <div className="space-y-1">
          <label className="text-slate-500 block text-[10px] flex items-center gap-1 font-sans">
            <DollarSign className="w-3 h-3 text-cyan-400" />
            {isMarket ? "Entry Price" : "Limit Price"}
          </label>
          {isMarket ? (
            <div className={`px-3 py-1.5 rounded-lg border text-[11px] font-bold min-h-[30px] flex items-center gap-1 ${
              priceReady
                ? "bg-emerald-500/5 border-emerald-500/20 text-emerald-300"
                : "bg-slate-950/40 border-slate-800/40 text-slate-500"
            }`}>
              {priceReady ? (
                <>
                  ${livePrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  <span className="text-[9px] text-slate-500 ml-1">AUTO</span>
                </>
              ) : (
                <span className="text-[10px] text-slate-600 italic">Click LIVE PRICE ↑</span>
              )}
            </div>
          ) : (
            <input
              type="number"
              step="0.01"
              value={limitPrice || ""}
              onChange={(e) => setLimitPrice(parseFloat(e.target.value) || 0)}
              placeholder={priceReady ? livePrice.toFixed(2) : "Limit price"}
              className="w-full px-3 py-1.5 rounded-lg bg-slate-950/60 border border-amber-500/30 text-amber-400 font-bold text-[11px]"
            />
          )}
        </div>

        {/* Quantity */}
        <div className="space-y-1">
          <label className="text-slate-500 block text-[10px] font-sans">Quantity</label>
          <input
            type="number"
            step="0.001"
            value={quantity}
            onChange={(e) => setQuantity(parseFloat(e.target.value) || 0.01)}
            className="w-full px-3 py-1.5 rounded-lg bg-slate-950/60 border border-slate-800/60 text-slate-200 font-bold text-[11px]"
          />
        </div>

        {/* Stop Loss */}
        <div className="space-y-1">
          <label className="text-slate-500 block text-[10px] flex items-center gap-1 font-sans">
            <ShieldAlert className="w-3 h-3 text-rose-400" /> Stop Loss
          </label>
          <input
            type="number"
            step="0.01"
            value={stopLoss || ""}
            onChange={(e) => setStopLoss(parseFloat(e.target.value) || 0)}
            placeholder="SL price"
            className="w-full px-3 py-1.5 rounded-lg bg-slate-950/60 border border-rose-500/20 text-rose-400 font-bold text-[11px]"
          />
        </div>

        {/* Take Profit */}
        <div className="space-y-1">
          <label className="text-slate-500 block text-[10px] flex items-center gap-1 font-sans">
            <Target className="w-3 h-3 text-emerald-400" /> Take Profit
          </label>
          <input
            type="number"
            step="0.01"
            value={targetPrice || ""}
            onChange={(e) => setTargetPrice(parseFloat(e.target.value) || 0)}
            placeholder="TP price"
            className="w-full px-3 py-1.5 rounded-lg bg-slate-950/60 border border-emerald-500/20 text-emerald-400 font-bold text-[11px]"
          />
        </div>
      </div>

      {/* ── Calculated Metrics ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="p-2 rounded-lg bg-slate-950/40 border border-slate-800/40 space-y-0.5">
          <span className="text-[9px] text-slate-500 block font-sans flex items-center gap-1">
            <AlertTriangle className="w-2.5 h-2.5 text-rose-400" /> Risk
          </span>
          <span className="font-bold text-rose-400 text-[11px]">${totalRisk.toFixed(2)}</span>
          {riskPercent > 0 && (
            <span className={`text-[9px] block ${riskPercent > 2 ? "text-rose-400" : "text-slate-500"}`}>
              {riskPercent.toFixed(1)}% of acct
            </span>
          )}
        </div>

        <div className="p-2 rounded-lg bg-slate-950/40 border border-slate-800/40 space-y-0.5">
          <span className="text-[9px] text-slate-500 block font-sans flex items-center gap-1">
            <TrendingUp className="w-2.5 h-2.5 text-emerald-400" /> Reward
          </span>
          <span className="font-bold text-emerald-400 text-[11px]">${totalReward.toFixed(2)}</span>
        </div>

        <div className="p-2 rounded-lg bg-slate-950/40 border border-slate-800/40 space-y-0.5">
          <span className="text-[9px] text-slate-500 block font-sans flex items-center gap-1">
            <Gauge className="w-2.5 h-2.5 text-cyan-400" /> R:R
          </span>
          <span className={`font-bold text-[11px] ${
            riskRewardRatio >= 2 ? "text-emerald-400" : riskRewardRatio >= 1 ? "text-cyan-300" : "text-amber-400"
          }`}>
            1 : {riskRewardRatio.toFixed(2)}
          </span>
        </div>

        <div className="p-2 rounded-lg bg-slate-950/40 border border-slate-800/40 space-y-0.5">
          <span className="text-[9px] text-slate-500 block font-sans">Potential P/L</span>
          <span className={`font-bold text-[11px] ${potentialPnL >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
            {potentialPnL >= 0 ? "+" : ""}${potentialPnL.toFixed(2)}
          </span>
        </div>
      </div>

      {/* ── Execute Buttons ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 pt-1">
        <button
          onClick={() => handleExecuteTrade("LONG")}
          disabled={isMarket && !priceReady}
          className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-sans font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/50 transition-all duration-150 active:scale-[0.98] border border-emerald-500/30"
        >
          <ArrowUpRight className="w-5 h-5" />
          BUY{orderType === "LIMIT" ? " LIMIT" : ""}
        </button>

        <button
          onClick={() => handleExecuteTrade("SHORT")}
          disabled={isMarket && !priceReady}
          className="w-full py-3 rounded-xl bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-sans font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-rose-950/50 transition-all duration-150 active:scale-[0.98] border border-rose-500/30"
        >
          <ArrowDownRight className="w-5 h-5" />
          SELL{orderType === "LIMIT" ? " LIMIT" : ""}
        </button>
      </div>

      {/* Feedback toast */}
      {executedMessage && (
        <div className={`p-2.5 rounded-xl border text-[11px] text-center font-bold flex items-center justify-center gap-2 ${
          executedMessage.startsWith("⚠")
            ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
            : "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 animate-pulse"
        }`}>
          <Zap className="w-3.5 h-3.5" />
          {executedMessage}
        </div>
      )}
    </div>
  );
}
