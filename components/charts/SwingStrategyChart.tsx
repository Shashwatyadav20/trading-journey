"use client";

import React, { useState, useEffect, useRef, memo } from "react";
import {
  createChart,
  IChartApi,
  ISeriesApi,
  CandlestickData,
  Time,
} from "lightweight-charts";
import { TradingViewChart } from "./TradingViewChart";
import {
  Activity,
  Layers,
  Crosshair,
  TrendingUp,
  TrendingDown,
  ShieldAlert,
  Target,
  Zap,
  Maximize2,
  RefreshCw,
  Calculator,
} from "lucide-react";

export interface SwingStrategyChartProps {
  symbol: string;
  companyName?: string;
  currentPrice: number;
  change?: number;
  changePercent?: number;
  setupBadge?: string;
  setupTitle?: string;
  entryPrice: number;
  stopLossPrice: number;
  target1Price: number;
  target2Price?: number;
  riskPerShare?: number;
  rewardRiskRatio?: number;
  ema20?: number;
  ema50?: number;
  candles?: {
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }[];
  onLoadIntoCalculator?: () => void;
}

function SwingStrategyChartComponent({
  symbol,
  companyName,
  currentPrice,
  change = 0,
  changePercent = 0,
  setupBadge = "Swing Setup",
  setupTitle,
  entryPrice,
  stopLossPrice,
  target1Price,
  target2Price,
  riskPerShare,
  rewardRiskRatio = 2.0,
  ema20,
  ema50,
  candles,
  onLoadIntoCalculator,
}: SwingStrategyChartProps) {
  const [chartMode, setChartMode] = useState<"TRADING_VIEW" | "PILLAR_OVERLAY">("TRADING_VIEW");
  const [timeframe, setTimeframe] = useState<"D" | "240" | "60">("D");
  const [localCandles, setLocalCandles] = useState<any[]>(candles || []);
  const [loadingCandles, setLoadingCandles] = useState<boolean>(false);

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<IChartApi | null>(null);

  const cleanSymbol = symbol.replace(/\.NS$/, "").replace(/\.BO$/, "");
  const nseSymbol = `NSE:${cleanSymbol}`;

  // Fetch candles if not provided and in PILLAR_OVERLAY mode
  useEffect(() => {
    if (candles && candles.length > 0) {
      setLocalCandles(candles);
      return;
    }

    if (chartMode === "PILLAR_OVERLAY") {
      let active = true;
      setLoadingCandles(true);
      fetch(`/api/indian/swing/quote?symbol=${encodeURIComponent(cleanSymbol)}`)
        .then((r) => r.json())
        .then((data) => {
          if (active && data.success && data.data?.candleHistory) {
            setLocalCandles(data.data.candleHistory);
          }
        })
        .catch(() => {})
        .finally(() => {
          if (active) setLoadingCandles(false);
        });

      return () => {
        active = false;
      };
    }
  }, [cleanSymbol, chartMode, candles]);

  // Lightweight-charts initialization for 5-Pillar Price Action Overlay
  useEffect(() => {
    if (chartMode !== "PILLAR_OVERLAY" || !chartContainerRef.current) return;

    if (chartInstanceRef.current) {
      chartInstanceRef.current.remove();
      chartInstanceRef.current = null;
    }

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: "#090d16" },
        textColor: "#94a3b8",
      },
      grid: {
        vertLines: { color: "#1e293b55" },
        horzLines: { color: "#1e293b55" },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        mode: 0,
      },
    });

    chartInstanceRef.current = chart;

    const candlestickSeries = chart.addCandlestickSeries({
      upColor: "#10b981",
      downColor: "#f43f5e",
      borderVisible: false,
      wickUpColor: "#10b981",
      wickDownColor: "#f43f5e",
    });

    if (localCandles && localCandles.length > 0) {
      const formatted: CandlestickData[] = localCandles.map((c) => ({
        time: c.date as Time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));
      candlestickSeries.setData(formatted);

      // S/R & Trade Strategy Price Lines
      if (entryPrice > 0) {
        candlestickSeries.createPriceLine({
          price: entryPrice,
          color: "#22d3ee", // cyan-400
          lineWidth: 2,
          lineStyle: 0, // Solid
          axisLabelVisible: true,
          title: `ENTRY (₹${entryPrice})`,
        });
      }

      if (stopLossPrice > 0) {
        candlestickSeries.createPriceLine({
          price: stopLossPrice,
          color: "#f43f5e", // rose-500
          lineWidth: 2,
          lineStyle: 2, // Dashed
          axisLabelVisible: true,
          title: `SL (₹${stopLossPrice})`,
        });
      }

      if (target1Price > 0) {
        candlestickSeries.createPriceLine({
          price: target1Price,
          color: "#10b981", // emerald-500
          lineWidth: 2,
          lineStyle: 2, // Dashed
          axisLabelVisible: true,
          title: `TARGET 1 (₹${target1Price})`,
        });
      }

      if (target2Price && target2Price > 0) {
        candlestickSeries.createPriceLine({
          price: target2Price,
          color: "#fbbf24", // amber-400
          lineWidth: 1,
          lineStyle: 3, // Dotted
          axisLabelVisible: true,
          title: `TARGET 2 (₹${target2Price})`,
        });
      }

      if (ema20 && ema20 > 0) {
        candlestickSeries.createPriceLine({
          price: ema20,
          color: "#38bdf8",
          lineWidth: 1,
          lineStyle: 3,
          axisLabelVisible: false,
          title: `20 EMA (₹${ema20})`,
        });
      }

      if (ema50 && ema50 > 0) {
        candlestickSeries.createPriceLine({
          price: ema50,
          color: "#a78bfa",
          lineWidth: 1,
          lineStyle: 3,
          axisLabelVisible: false,
          title: `50 EMA (₹${ema50})`,
        });
      }

      chart.timeScale().fitContent();
    }

    const handleResize = () => {
      if (chartContainerRef.current && chartInstanceRef.current) {
        chartInstanceRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    };

    window.addEventListener("resize", handleResize);
    handleResize();

    return () => {
      window.removeEventListener("resize", handleResize);
      if (chartInstanceRef.current) {
        chartInstanceRef.current.remove();
        chartInstanceRef.current = null;
      }
    };
  }, [chartMode, localCandles, entryPrice, stopLossPrice, target1Price, target2Price, ema20, ema50]);

  const calculatedRisk = riskPerShare || Math.abs(entryPrice - stopLossPrice);

  return (
    <div className="p-4 sm:p-5 rounded-2xl bg-[#0a0f1d] border border-slate-800/90 shadow-2xl flex flex-col space-y-4">
      {/* ── Top Header Controls ────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold font-mono text-slate-100 tracking-tight">
                {nseSymbol}
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded font-mono font-bold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                {setupBadge}
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-mono bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                LIVE
              </span>
            </div>
            {companyName && (
              <div className="text-xs text-slate-400 font-mono mt-0.5">
                {companyName} {setupTitle ? `· ${setupTitle}` : ""}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Price & Change badge */}
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-bold font-mono text-slate-100">
              ₹{currentPrice.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span
              className={`text-xs font-mono font-bold flex items-center gap-0.5 ${
                change >= 0 ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              {change >= 0 ? "+" : ""}₹{change.toFixed(2)} ({changePercent >= 0 ? "+" : ""}
              {changePercent.toFixed(2)}%)
            </span>
          </div>

          {/* Timeframe Switcher (TradingView mode) */}
          {chartMode === "TRADING_VIEW" && (
            <div className="flex items-center bg-slate-900 border border-slate-800 p-0.5 rounded-lg text-xs font-mono">
              <button
                onClick={() => setTimeframe("D")}
                className={`px-2.5 py-1 rounded transition ${
                  timeframe === "D"
                    ? "bg-cyan-500/20 text-cyan-300 font-bold"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                1D
              </button>
              <button
                onClick={() => setTimeframe("240")}
                className={`px-2.5 py-1 rounded transition ${
                  timeframe === "240"
                    ? "bg-cyan-500/20 text-cyan-300 font-bold"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                4H
              </button>
              <button
                onClick={() => setTimeframe("60")}
                className={`px-2.5 py-1 rounded transition ${
                  timeframe === "60"
                    ? "bg-cyan-500/20 text-cyan-300 font-bold"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                1H
              </button>
            </div>
          )}

          {/* Mode Switcher */}
          <div className="flex items-center bg-slate-900 border border-slate-800 p-0.5 rounded-xl text-xs font-mono">
            <button
              onClick={() => setChartMode("TRADING_VIEW")}
              className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 ${
                chartMode === "TRADING_VIEW"
                  ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-bold"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Activity className="w-3.5 h-3.5 text-cyan-400" />
              <span>TradingView Chart</span>
            </button>
            <button
              onClick={() => setChartMode("PILLAR_OVERLAY")}
              className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 ${
                chartMode === "PILLAR_OVERLAY"
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Crosshair className="w-3.5 h-3.5 text-emerald-400" />
              <span>5-Pillar S/R Levels</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── Chart Display Area ────────────────────────────────────────── */}
      <div className="w-full relative h-[480px] rounded-xl overflow-hidden border border-slate-800 bg-[#090d16]">
        {chartMode === "TRADING_VIEW" ? (
          <TradingViewChart symbol={cleanSymbol} interval={timeframe} />
        ) : (
          <div className="w-full h-full relative">
            {loadingCandles && (
              <div className="absolute inset-0 bg-[#090d16]/80 flex items-center justify-center z-10 font-mono text-xs text-cyan-400">
                <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                Loading S/R candle series...
              </div>
            )}
            <div ref={chartContainerRef} className="w-full h-full" />
          </div>
        )}
      </div>

      {/* ── Bottom Strategy Execution Strip ───────────────────────────── */}
      <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-mono">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 flex-1">
          <div>
            <span className="text-[10px] text-slate-500 uppercase block">Entry Trigger</span>
            <span className="text-sm font-bold text-cyan-300">
              ₹{entryPrice.toLocaleString("en-IN")}
            </span>
          </div>

          <div>
            <span className="text-[10px] text-rose-400 uppercase block">Stop Loss (SL)</span>
            <span className="text-sm font-bold text-rose-400">
              ₹{stopLossPrice.toLocaleString("en-IN")}
            </span>
            <span className="text-[10px] text-slate-500 block">
              Risk: ₹{calculatedRisk.toFixed(1)}/sh
            </span>
          </div>

          <div>
            <span className="text-[10px] text-emerald-400 uppercase block">Target 1 (2R)</span>
            <span className="text-sm font-bold text-emerald-400">
              ₹{target1Price.toLocaleString("en-IN")}
            </span>
            <span className="text-[10px] text-slate-500 block">
              Min 1:{rewardRiskRatio.toFixed(1)} R:R
            </span>
          </div>

          {target2Price && target2Price > 0 ? (
            <div>
              <span className="text-[10px] text-amber-300 uppercase block">Target 2 (3R)</span>
              <span className="text-sm font-bold text-amber-300">
                ₹{target2Price.toLocaleString("en-IN")}
              </span>
              <span className="text-[10px] text-slate-500 block">Runner</span>
            </div>
          ) : (
            <div>
              <span className="text-[10px] text-slate-500 uppercase block">EMA Trend</span>
              <span className="text-xs font-bold text-emerald-400 block mt-0.5">
                {currentPrice >= (ema20 || 0) ? "Above 20 EMA" : "Consolidating"}
              </span>
            </div>
          )}
        </div>

        {onLoadIntoCalculator && (
          <button
            onClick={onLoadIntoCalculator}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500/20 to-emerald-500/20 hover:from-cyan-500/30 hover:to-emerald-500/30 text-cyan-300 border border-cyan-500/40 font-bold transition flex items-center justify-center gap-2 shrink-0 cursor-pointer shadow-md"
          >
            <Calculator className="w-4 h-4 text-cyan-400" />
            <span>⚡ LOAD INTO 1% RISK CALCULATOR</span>
          </button>
        )}
      </div>
    </div>
  );
}

export const SwingStrategyChart = memo(SwingStrategyChartComponent);
