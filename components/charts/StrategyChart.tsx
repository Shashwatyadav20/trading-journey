"use client";

import React, { useEffect, useRef, useState, memo } from "react";
import {
  createChart,
  IChartApi,
  ISeriesApi,
  CandlestickData,
  Time,
  SeriesMarker,
} from "lightweight-charts";
import { detectLiquiditySweeps, Candle, StrategySignal } from "../../lib/strategyEngine";
import { Loader2, ArrowUpRight, ArrowDownRight, Target, ShieldAlert, DollarSign, Zap, CheckCircle2 } from "lucide-react";
import ChartDrawingToolbar from "./ChartDrawingToolbar";
import { ChartDrawing } from "../../types/chart";
import { useAuth } from "../../context/AuthContext";
import { useTrades } from "../../context/TradeContext";
import {
  fetchDrawingsCloud,
  upsertDrawingCloud,
  deleteDrawingCloud,
} from "../../lib/cloudSync";
import {
  loadDrawingsFromStorage,
  saveDrawingsToStorage,
  clearDrawingsStorage,
} from "../../lib/drawingStorage";

function StrategyChartComponent() {
  const { user } = useAuth();
  const { addTrade } = useTrades();

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [signals, setSignals] = useState<StrategySignal[]>([]);
  const [selectedSignal, setSelectedSignal] = useState<StrategySignal | null>(null);
  const [drawings, setDrawings] = useState<ChartDrawing[]>([]);
  const [executedMessage, setExecutedMessage] = useState<string | null>(null);

  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const drawingLinesRef = useRef<Map<string, any>>(new Map());

  const handleExecuteSignalTrade = (sig: StrategySignal) => {
    const todayStr = new Date().toISOString().split("T")[0];
    const timeStr = new Date().toTimeString().split(" ")[0].substring(0, 5);

    const side = sig.type === "BUY" ? "LONG" : "SHORT";
    const autoStrategy =
      sig.type === "BUY"
        ? "Liquidity Sweep + Bullish Engulfing"
        : "Liquidity Sweep + Bearish Engulfing";

    addTrade({
      date: todayStr,
      time: timeStr,
      symbol: "BTC/USD",
      side,
      strategy: autoStrategy,
      entryPrice: sig.entryPrice,
      stopLoss: sig.stopLoss,
      targetPrice: sig.takeProfit,
      quantity: 1,
      fees: 5,
      status: "OPEN",
      notes: `Executed from Signal Engine: ${sig.label} @ $${sig.entryPrice.toFixed(1)}`,
    });

    setExecutedMessage(`Simulated ${side} position executed & saved to Trade Journal!`);
    setTimeout(() => setExecutedMessage(null), 4000);
  };

  // Helper to paint drawings onto candlestick series
  const renderDrawingsOnChart = (
    series: ISeriesApi<"Candlestick">,
    drawingList: ChartDrawing[]
  ) => {
    // Remove old lines
    drawingLinesRef.current.forEach((line) => {
      try {
        series.removePriceLine(line);
      } catch (e) {
        // ignore removal errors
      }
    });
    drawingLinesRef.current.clear();

    // Paint current lines
    drawingList.forEach((dr) => {
      const priceLine = series.createPriceLine({
        price: dr.price,
        color: dr.color,
        lineWidth: 2,
        lineStyle: dr.lineStyle || 0,
        axisLabelVisible: true,
        title: dr.label,
      });
      drawingLinesRef.current.set(dr.id, priceLine);
    });
  };

  useEffect(() => {
    // Load drawings from localStorage
    const saved = loadDrawingsFromStorage();
    setDrawings(saved);
  }, []);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // 1. Initialize Chart
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: "#090d16" },
        textColor: "#94a3b8", // slate-400
      },
      grid: {
        vertLines: { color: "#1e293b" },
        horzLines: { color: "#1e293b" },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        mode: 0,
      },
    });

    chartRef.current = chart;

    const candlestickSeries = chart.addCandlestickSeries({
      upColor: "#10b981", // emerald-500
      downColor: "#f43f5e", // rose-500
      borderVisible: false,
      wickUpColor: "#10b981",
      wickDownColor: "#f43f5e",
    });

    seriesRef.current = candlestickSeries as any;

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    };

    window.addEventListener("resize", handleResize);
    handleResize();

    // 2. Fetch Data and Run Strategy Engine
    const fetchData = async () => {
      try {
        const response = await fetch(
          "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=1000"
        );
        const data = await response.json();

        const formattedData: Candle[] = data.map((d: any) => ({
          time: Math.floor(d[0] / 1000),
          open: parseFloat(d[1]),
          high: parseFloat(d[2]),
          low: parseFloat(d[3]),
          close: parseFloat(d[4]),
          volume: parseFloat(d[5]),
        }));

        formattedData.sort((a, b) => a.time - b.time);

        // Run Strategy Engine
        const { markers, signals: detectedSignals } = detectLiquiditySweeps(formattedData);

        setSignals(detectedSignals);
        if (detectedSignals.length > 0) {
          setSelectedSignal(detectedSignals[detectedSignals.length - 1]);
        }

        // Format data for lightweight-charts
        const chartData: CandlestickData[] = formattedData.map((c) => ({
          time: c.time as Time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }));

        candlestickSeries.setData(chartData);

        // Set Markers
        const chartMarkers: SeriesMarker<Time>[] = markers.map((m) => ({
          time: m.time as Time,
          position: m.position,
          color: m.color,
          shape: m.shape,
          text: m.text,
          size: m.size,
        }));

        candlestickSeries.setMarkers(chartMarkers);

        // Add Price Lines for the latest signal if available
        if (detectedSignals.length > 0) {
          const latest = detectedSignals[detectedSignals.length - 1];

          // Entry Price Line
          candlestickSeries.createPriceLine({
            price: latest.entryPrice,
            color: latest.type === "BUY" ? "#10b981" : "#f43f5e",
            lineWidth: 2,
            lineStyle: 0, // Solid
            axisLabelVisible: true,
            title: `${latest.type} ENTRY`,
          });

          // Stop Loss Line
          candlestickSeries.createPriceLine({
            price: latest.stopLoss,
            color: "#ef4444",
            lineWidth: 1,
            lineStyle: 2, // Dashed
            axisLabelVisible: true,
            title: `SL (${latest.stopLoss.toFixed(1)})`,
          });

          // Take Profit Line
          candlestickSeries.createPriceLine({
            price: latest.takeProfit,
            color: "#10b981",
            lineWidth: 1,
            lineStyle: 2, // Dashed
            axisLabelVisible: true,
            title: `TP (${latest.takeProfit.toFixed(1)})`,
          });
        }

        // Paint user drawings from localStorage
        const savedDrawings = loadDrawingsFromStorage();
        renderDrawingsOnChart(candlestickSeries as any, savedDrawings);

        chart.timeScale().fitContent();
        setLoading(false);
      } catch (error) {
        console.error("Failed to load strategy data:", error);
        setLoading(false);
      }
    };

    fetchData();

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
    };
  }, []);

  // Sync drawings with Cloud / Storage
  useEffect(() => {
    async function loadDrawings() {
      if (user) {
        try {
          const cloudDr = await fetchDrawingsCloud(user.id);
          setDrawings(cloudDr);
        } catch (e) {
          console.error("Failed to load drawings from cloud:", e);
          setDrawings(loadDrawingsFromStorage());
        }
      } else {
        const saved = loadDrawingsFromStorage();
        setDrawings(saved);
      }
    }
    loadDrawings();
  }, [user]);

  // Drawing Handlers
  const handleAddDrawing = (drawingInput: Omit<ChartDrawing, "id">) => {
    const newDrawing: ChartDrawing = {
      ...drawingInput,
      id: `dr_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
    };

    const nextDrawings = [...drawings, newDrawing];
    setDrawings(nextDrawings);

    if (user) {
      upsertDrawingCloud(newDrawing, user.id);
    } else {
      saveDrawingsToStorage(nextDrawings);
    }

    if (seriesRef.current) {
      renderDrawingsOnChart(seriesRef.current as any, nextDrawings);
    }
  };

  const handleDeleteDrawing = (id: string) => {
    const nextDrawings = drawings.filter((d) => d.id !== id);
    setDrawings(nextDrawings);

    if (user) {
      deleteDrawingCloud(id, user.id);
    } else {
      saveDrawingsToStorage(nextDrawings);
    }

    if (seriesRef.current) {
      renderDrawingsOnChart(seriesRef.current as any, nextDrawings);
    }
  };

  const handleClearAllDrawings = () => {
    if (user) {
      drawings.forEach((dr) => deleteDrawingCloud(dr.id, user.id));
    } else {
      clearDrawingsStorage();
    }
    setDrawings([]);

    if (seriesRef.current) {
      renderDrawingsOnChart(seriesRef.current as any, []);
    }
  };

  return (
    <div className="space-y-3 flex flex-col w-full h-full">
      {/* Chart Drawing Toolbar */}
      <ChartDrawingToolbar
        drawings={drawings}
        onAddDrawing={handleAddDrawing}
        onDeleteDrawing={handleDeleteDrawing}
        onClearAllDrawings={handleClearAllDrawings}
        currentMarketPrice={selectedSignal ? selectedSignal.entryPrice : 0}
      />

      <div className="relative w-full flex-1 border border-slate-800/80 rounded-2xl overflow-hidden bg-[#090d16] flex flex-col lg:flex-row min-h-[400px]">
        {/* Loading Overlay */}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center z-20 bg-[#090d16]/80 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
              <span className="text-sm font-mono text-cyan-400 animate-pulse">
                Running Sweep + Engulfing Engine...
              </span>
            </div>
          </div>
        )}

        {/* Chart Render Area */}
        <div ref={chartContainerRef} className="flex-1 h-full min-h-[380px] relative" />

        {/* Sidebar Overlay Panel: Signal Log & Details */}
        <div className="w-full lg:w-80 bg-[#0d1322]/90 border-t lg:border-t-0 lg:border-l border-slate-800/80 p-4 flex flex-col space-y-4 overflow-y-auto font-mono text-xs z-10 shrink-0">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
            <span className="font-sans font-bold text-sm text-slate-200 uppercase tracking-wider flex items-center gap-2">
              <Target className="w-4 h-4 text-cyan-400" />
              Signal Engine
            </span>
            <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px]">
              {signals.length} Signals
            </span>
          </div>

          {/* Selected Signal Summary Card */}
          {selectedSignal ? (
            <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800/80 space-y-3 shadow-md">
              {/* Setup Readiness Banner */}
              <div
                className={`p-2 rounded-lg text-center font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 border animate-pulse ${
                  selectedSignal.type === "BUY"
                    ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-sm shadow-emerald-950"
                    : "bg-rose-500/20 text-rose-300 border-rose-500/40 shadow-sm shadow-rose-950"
                }`}
              >
                <Zap className="w-4 h-4" />
                <span>{selectedSignal.type === "BUY" ? "BUY SETUP READY" : "SELL SETUP READY"}</span>
              </div>

              <div className="flex items-center justify-between">
                <span
                  className={`px-2 py-0.5 rounded font-bold text-[11px] flex items-center gap-1 ${
                    selectedSignal.type === "BUY"
                      ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                      : "bg-rose-500/15 text-rose-400 border border-rose-500/30"
                  }`}
                >
                  {selectedSignal.type === "BUY" ? (
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  ) : (
                    <ArrowDownRight className="w-3.5 h-3.5" />
                  )}
                  {selectedSignal.label}
                </span>
                <span className="text-[10px] text-slate-400">{selectedSignal.dateStr}</span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px] pt-1">
                <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800/60">
                  <span className="text-slate-400 block text-[10px] flex items-center gap-1">
                    <DollarSign className="w-3 h-3 text-cyan-400" />
                    Entry Price
                  </span>
                  <span className="font-bold text-slate-100">${selectedSignal.entryPrice.toFixed(2)}</span>
                </div>

                <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800/60">
                  <span className="text-slate-400 block text-[10px] flex items-center gap-1">
                    <ShieldAlert className="w-3 h-3 text-rose-400" />
                    Stop Loss
                  </span>
                  <span className="font-bold text-rose-400">${selectedSignal.stopLoss.toFixed(2)}</span>
                </div>

                <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800/60">
                  <span className="text-slate-400 block text-[10px] flex items-center gap-1">
                    <Target className="w-3 h-3 text-emerald-400" />
                    Take Profit
                  </span>
                  <span className="font-bold text-emerald-400">${selectedSignal.takeProfit.toFixed(2)}</span>
                </div>

                <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800/60">
                  <span className="text-slate-400 block text-[10px]">Risk / Reward</span>
                  <span className="font-bold text-cyan-300">1 : {selectedSignal.riskReward.toFixed(1)}</span>
                </div>
              </div>

              {/* Execution Button */}
              <button
                onClick={() => handleExecuteSignalTrade(selectedSignal)}
                className={`w-full py-2 rounded-xl text-xs font-sans font-bold flex items-center justify-center gap-2 shadow-lg transition-all duration-150 active:scale-[0.99] ${
                  selectedSignal.type === "BUY"
                    ? "bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-emerald-950/50"
                    : "bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white shadow-rose-950/50"
                }`}
              >
                {selectedSignal.type === "BUY" ? (
                  <ArrowUpRight className="w-4 h-4" />
                ) : (
                  <ArrowDownRight className="w-4 h-4" />
                )}
                <span>EXECUTE {selectedSignal.type} SIGNAL (PAPER ORDER)</span>
              </button>

              {/* Executed Confirmation Toast */}
              {executedMessage && (
                <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] text-center font-bold flex items-center justify-center gap-1 animate-pulse">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>{executedMessage}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800/40 text-center text-slate-400">
              No completed signal sequences yet.
            </div>
          )}

          {/* Signals History List */}
          <div className="space-y-2 flex-1 overflow-y-auto">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-sans font-semibold">
              Signal Log ({signals.length})
            </span>
            {signals.map((sig) => (
              <button
                key={sig.id}
                onClick={() => setSelectedSignal(sig)}
                className={`w-full text-left p-2.5 rounded-xl border transition-all duration-150 flex items-center justify-between ${
                  selectedSignal?.id === sig.id
                    ? "bg-slate-800/80 border-cyan-500/40 shadow-sm text-slate-100"
                    : "bg-slate-900/40 border-slate-800/60 hover:bg-slate-800/40 text-slate-400"
                }`}
              >
                <div className="space-y-0.5">
                  <div className="font-bold text-[11px] flex items-center gap-1">
                    <span
                      className={sig.type === "BUY" ? "text-emerald-400" : "text-rose-400"}
                    >
                      {sig.type}
                    </span>
                    <span>@ ${sig.entryPrice.toFixed(1)}</span>
                  </div>
                  <div className="text-[10px] text-slate-400">{sig.dateStr}</div>
                </div>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-300 font-mono">
                  1:{sig.riskReward.toFixed(1)}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export const StrategyChart = memo(StrategyChartComponent);
