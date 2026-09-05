"use client";

/**
 * PineLiquidityChart
 * ==================
 * A self-contained lightweight-charts candlestick chart that renders:
 *   - Historical seed candles from backend bootstrap / market API
 *   - Pine Engine liquidity levels via PineChartOverlay
 *   - TradingView-style Premium/Discount Zone canvas overlay
 *   - Timeframe switcher (15M, 30M, 1H, 4H, 1D)
 *   - P/D Zone status sidebar & canvas lines
 *
 * Drawing layer separation:
 *   1. Candlestick layer  — chart series data
 *   2. Pine liquidity     — PineChartOverlay & PinePDZoneCanvasOverlay (separate references)
 *   3. Manual drawings    — NOT included (Pine-only chart)
 *   4. Trade drawings     — NOT included
 */
import React, {
  useEffect,
  useRef,
  useState,
  useMemo,
  memo,
} from "react";
import {
  createChart,
  IChartApi,
  ISeriesApi,
  CandlestickData,
  Time,
  LineStyle,
} from "lightweight-charts";
import { Loader2, Activity, AlertCircle, Clock, Zap } from "lucide-react";
import { useMarketData } from "../../context/MarketDataContext";
import { usePineLiquidity } from "../../context/PineLiquidityContext";
import { useTrades } from "../../context/TradeContext";
import { PineChartOverlay } from "./PineChartOverlay";
import { PinePDZoneState } from "../../types/pine";

interface PineLiquidityChartProps {
  instrument: string; // "XAU/USD" or "BTC/USD"
}

// Timeframes available in the UI
const TF_OPTIONS = [
  { label: "15M", minutes: 15 },
  { label: "30M", minutes: 30 },
  { label: "1H",  minutes: 60 },
  { label: "4H",  minutes: 240 },
  { label: "1D",  minutes: 1440 },
] as const;

function getBackendUrl() {
  return (
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://localhost:4000"
  );
}

/**
 * Premium / Discount Zone Overlay Component
 * Renders TradingView-style translucent shaded Premium (Red) and Discount (Green)
 * background regions with Equilibrium line using exact backend Pine coordinates.
 * No frontend calculation or alteration of backend Pine values.
 */
function PinePDZoneCanvasOverlay({
  series,
  pdZone,
}: {
  series: ISeriesApi<"Candlestick"> | null;
  pdZone: PinePDZoneState | null;
}) {
  const [coords, setCoords] = useState<{ topY: number; eqY: number; botY: number } | null>(null);

  useEffect(() => {
    if (
      !series ||
      !pdZone ||
      !pdZone.active ||
      pdZone.top === null ||
      pdZone.bottom === null ||
      pdZone.equilibrium === null
    ) {
      setCoords(null);
      return;
    }

    const updateCoords = () => {
      try {
        const tY = series.priceToCoordinate(pdZone.top!);
        const eY = series.priceToCoordinate(pdZone.equilibrium!);
        const bY = series.priceToCoordinate(pdZone.bottom!);

        if (tY !== null && eY !== null && bY !== null && !isNaN(tY) && !isNaN(eY) && !isNaN(bY)) {
          setCoords({ topY: tY, eqY: eY, botY: bY });
        } else {
          setCoords(null);
        }
      } catch {
        setCoords(null);
      }
    };

    updateCoords();

    // Subscribe to chart timeScale / priceScale changes so Y coordinates update on scroll/zoom
    const chart = (series as any)._chart || (series as any).chart;
    if (chart) {
      try {
        const timeScale = chart.timeScale();
        timeScale.subscribeVisibleLogicalRangeChange(updateCoords);
        timeScale.subscribeVisibleTimeRangeChange(updateCoords);
      } catch { /* ignore */ }
    }

    window.addEventListener("resize", updateCoords);

    return () => {
      window.removeEventListener("resize", updateCoords);
      if (chart) {
        try {
          const timeScale = chart.timeScale();
          timeScale.unsubscribeVisibleLogicalRangeChange(updateCoords);
          timeScale.unsubscribeVisibleTimeRangeChange(updateCoords);
        } catch { /* ignore */ }
      }
    };
  }, [series, pdZone]);

  if (
    !coords ||
    !pdZone ||
    !pdZone.active ||
    pdZone.top === null ||
    pdZone.bottom === null ||
    pdZone.equilibrium === null
  ) {
    return null;
  }

  const { topY, eqY, botY } = coords;
  const premHeight = Math.max(1, eqY - topY);
  const discHeight = Math.max(1, botY - eqY);

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden z-[5]">
      {/* Premium Zone Region (Above Equilibrium) */}
      <div
        className="absolute left-0 right-0 border-t border-rose-500/40 bg-gradient-to-b from-rose-500/15 to-rose-500/05 transition-all duration-75 flex items-start justify-end pr-4 pt-1"
        style={{ top: `${topY}px`, height: `${premHeight}px` }}
      >
        <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 text-[10px] font-mono font-bold uppercase shadow-sm">
          PREMIUM ZONE ({pdZone.top.toFixed(2)})
        </span>
      </div>

      {/* Equilibrium Midpoint Line */}
      <div
        className="absolute left-0 right-0 border-t-2 border-slate-400/80 transition-all duration-75 flex items-center justify-end pr-4 z-10"
        style={{ top: `${eqY}px` }}
      >
        <span className="px-2 py-0.5 rounded bg-slate-800/90 text-slate-200 border border-slate-600 text-[10px] font-mono font-bold uppercase shadow-sm -translate-y-1/2">
          EQUILIBRIUM 50% ({pdZone.equilibrium.toFixed(2)})
        </span>
      </div>

      {/* Discount Zone Region (Below Equilibrium) */}
      <div
        className="absolute left-0 right-0 border-b border-emerald-500/40 bg-gradient-to-b from-emerald-500/05 to-emerald-500/15 transition-all duration-75 flex items-end justify-end pr-4 pb-1"
        style={{ top: `${eqY}px`, height: `${discHeight}px` }}
      >
        <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-mono font-bold uppercase shadow-sm">
          DISCOUNT ZONE ({pdZone.bottom.toFixed(2)})
        </span>
      </div>
    </div>
  );
}

function PineLiquidityChartComponent({ instrument }: PineLiquidityChartProps) {
  const { getPrice } = useMarketData();
  const { addTrade } = useTrades();
  const {
    levels,
    signals,
    pdZone,
    chartTF,
    setChartTF,
    isLoading: levelsLoading,
    error: levelsError,
    lastFetched,
  } = usePineLiquidity();

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  const [chartReady, setChartReady] = useState(false);
  const [candlesLoading, setCandlesLoading] = useState(true);
  const [executedMessage, setExecutedMessage] = useState<string | null>(null);

  // Current price line reference
  const currentPriceLineRef = useRef<any>(null);

  // ─── Initialize chart ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: "#090d16" },
        textColor: "#94a3b8",
      },
      grid: {
        vertLines: { color: "#1e293b" },
        horzLines: { color: "#1e293b" },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: "#1e293b",
      },
      rightPriceScale: {
        borderColor: "#1e293b",
      },
      crosshair: {
        mode: 1,
      },
    });

    chartRef.current = chart;

    const candleSeries = chart.addCandlestickSeries({
      upColor: "#10b981",
      downColor: "#f43f5e",
      borderVisible: false,
      wickUpColor: "#10b981",
      wickDownColor: "#f43f5e",
    });

    seriesRef.current = candleSeries as any;

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };

    window.addEventListener("resize", handleResize);
    handleResize();

    setChartReady(true);

    return () => {
      setChartReady(false);
      window.removeEventListener("resize", handleResize);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      currentPriceLineRef.current = null;
    };
  }, []);

  // ─── Fetch historical candles (Coinbase for BTC / Binance PAXG for XAU) ──────
  useEffect(() => {
    if (!seriesRef.current) return;

    setCandlesLoading(true);

    const loadCandles = async () => {
      try {
        let chartData: CandlestickData[] = [];
        const encoded = encodeURIComponent(instrument);

        // 1. Fetch backend historical bootstrap candles
        try {
          const backendRes = await fetch(`${getBackendUrl()}/pine/candles/${encoded}`);
          if (backendRes.ok) {
            const data = await backendRes.json();
            if (Array.isArray(data.candles) && data.candles.length > 0) {
              chartData = data.candles.map((c: any) => ({
                time: Math.floor(new Date(c.timestamp).getTime() / 1000) as Time,
                open: c.open,
                high: c.high,
                low: c.low,
                close: c.close,
              }));
            }
          }
        } catch { /* ignore fallback */ }

        // 2. Fallback to public endpoints if backend candles empty
        if (chartData.length === 0) {
          if (instrument === "BTC/USD") {
            const resp = await fetch(
              "https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=900",
              { headers: { "User-Agent": "TradingApp/1.0" } }
            );
            if (resp.ok) {
              const raw = await resp.json();
              chartData = raw.map((d: any) => ({
                time: d[0] as Time,
                open: parseFloat(d[3]),
                high: parseFloat(d[2]),
                low: parseFloat(d[1]),
                close: parseFloat(d[4]),
              }));
            }
          } else {
            const resp = await fetch(
              "https://api.binance.com/api/v3/klines?symbol=PAXGUSDT&interval=15m&limit=500"
            );
            if (resp.ok) {
              const raw = await resp.json();
              chartData = raw.map((d: any) => ({
                time: Math.floor(d[0] / 1000) as Time,
                open: parseFloat(d[1]),
                high: parseFloat(d[2]),
                low: parseFloat(d[3]),
                close: parseFloat(d[4]),
              }));
            }
          }
        }

        const timeMap = new Map<number, CandlestickData>();
        chartData.forEach((cd) => timeMap.set(cd.time as number, cd));
        chartData = Array.from(timeMap.values()).sort((a, b) => (a.time as number) - (b.time as number));

        if (seriesRef.current && chartData.length > 0) {
          seriesRef.current.setData(chartData);
          chartRef.current?.timeScale().fitContent();
        }
      } catch (err) {
        console.error("[PineLiquidityChart] Failed to load candles:", err);
      } finally {
        setCandlesLoading(false);
      }
    };

    loadCandles();
  }, [instrument, chartTF]);

  // ─── Update current price line on live tick ────────────────────────────────
  useEffect(() => {
    const livePrice = getPrice(instrument);
    if (!livePrice || !seriesRef.current) return;

    if (currentPriceLineRef.current) {
      try {
        seriesRef.current.removePriceLine(currentPriceLineRef.current);
      } catch { /* ignore */ }
    }

    try {
      currentPriceLineRef.current = seriesRef.current.createPriceLine({
        price: livePrice.price,
        color: "#e2e8f0",
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: `${instrument} ${livePrice.price.toFixed(2)}`,
      });
    } catch { /* ignore */ }

    const now = Math.floor(Date.now() / 1000) as Time;
    try {
      seriesRef.current.update({
        time: now,
        open: livePrice.price,
        high: livePrice.price,
        low: livePrice.price,
        close: livePrice.price,
      });
    } catch { /* ignore */ }
  }, [getPrice, instrument]);

  const horizontalLevels = useMemo(
    () => levels.filter((l) => !["PREMIUM", "DISCOUNT", "EQUILIBRIUM"].includes(l.type)),
    [levels]
  );

  const livePrice = getPrice(instrument);
  const isLoading = candlesLoading;

  return (
    <div className="flex flex-col w-full h-full bg-[#090d16] rounded-2xl overflow-hidden border border-slate-800/80">
      {/* Timeframe Bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#0d1322] border-b border-slate-800/80 font-mono text-xs">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-violet-400" />
          <span className="text-slate-300 font-sans font-bold">Timeframe:</span>
          <div className="flex bg-slate-900 p-0.5 rounded-lg border border-slate-800">
            {TF_OPTIONS.map((tf) => (
              <button
                key={tf.minutes}
                onClick={() => setChartTF(tf.minutes)}
                className={`px-2.5 py-1 rounded text-[11px] font-bold transition-all ${
                  chartTF === tf.minutes
                    ? "bg-violet-500/20 text-violet-300 border border-violet-500/40 shadow-sm"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {tf.label}
              </button>
            ))}
          </div>
        </div>

        <div className="text-[10px] text-slate-400 font-sans flex items-center gap-3">
          <span>
            Source:{" "}
            <span className="text-slate-200 font-mono">
              {instrument === "BTC/USD" ? "Coinbase (Exact)" : "Xaus Spot / PAXG (Partial)"}
            </span>
          </span>
          <span>
            Pine TF: <span className="text-violet-400 font-mono font-bold">{chartTF < 15 ? 15 : chartTF}M</span>
          </span>
        </div>
      </div>

      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center z-20 bg-[#090d16]/80 backdrop-blur-sm rounded-2xl">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-8 h-8 text-violet-400 animate-spin" />
            <span className="text-sm font-mono text-violet-400 animate-pulse">
              Bootstrapping Pine Historical Engine...
            </span>
          </div>
        </div>
      )}

      <div className="flex flex-col lg:flex-row flex-1 min-h-0 relative">
        {/* Chart canvas container */}
        <div ref={containerRef} className="flex-1 min-h-[380px] relative">
          {/* TradingView-style Premium / Discount Shaded Canvas Overlay */}
          {chartReady && (
            <PinePDZoneCanvasOverlay series={seriesRef.current} pdZone={pdZone} />
          )}
        </div>

        {/* Pine Level Overlay (horizontal PriceLines) */}
        {chartReady && seriesRef.current && (
          <PineChartOverlay series={seriesRef.current} levels={levels} pdZone={pdZone} />
        )}

        {/* Sidebar */}
        <div className="w-full lg:w-72 bg-[#0d1322]/90 border-t lg:border-t-0 lg:border-l border-slate-800/80 p-4 flex flex-col space-y-4 overflow-y-auto font-mono text-xs shrink-0">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
            <span className="font-sans font-bold text-sm text-slate-200 uppercase tracking-wider flex items-center gap-2">
              <Activity className="w-4 h-4 text-violet-400" />
              Pine Levels
            </span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] border ${
                levelsLoading
                  ? "bg-slate-500/10 text-slate-400 border-slate-500/20"
                  : levelsError
                  ? "bg-rose-500/10 text-rose-400 border-rose-500/20"
                  : "bg-violet-500/10 text-violet-400 border-violet-500/20"
              }`}
            >
              {levelsLoading
                ? "Loading..."
                : levelsError
                ? "Error"
                : `${levels.length} active`}
            </span>
          </div>

          {/* Error notice */}
          {levelsError && (
            <div className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-[10px] flex items-center gap-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>{levelsError}</span>
            </div>
          )}

          {/* Live price */}
          {livePrice && (
            <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800/60 space-y-1">
              <span className="text-[10px] text-slate-400 uppercase tracking-wider font-sans font-semibold">
                Current Market Price
              </span>
              <div className="flex items-baseline gap-2">
                <span className="text-base font-bold text-slate-100 font-sans">
                  {livePrice.price.toFixed(2)}
                </span>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                    livePrice.status === "LIVE"
                      ? "bg-emerald-500/20 text-emerald-400"
                      : livePrice.status === "MARKET_CLOSED"
                      ? "bg-amber-500/20 text-amber-400"
                      : "bg-rose-500/20 text-rose-400"
                  }`}
                >
                  {livePrice.status}
                </span>
              </div>
            </div>
          )}

          {/* Strategy Signals Panel */}
          {signals.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider font-sans font-semibold flex items-center gap-1">
                  <Zap className="w-3.5 h-3.5 text-amber-400" />
                  Strategy Signals ({signals.length})
                </span>
              </div>

              <div className="space-y-2 max-h-48 overflow-y-auto">
                {signals.map((sig) => (
                  <div
                    key={sig.signalId}
                    className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800/80 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${
                          sig.direction === "BUY"
                            ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                            : "bg-rose-500/15 text-rose-400 border-rose-500/30"
                        }`}
                      >
                        {sig.direction} SETUP ({sig.strategy.replace("_", " ")})
                      </span>
                      <span className="text-[9px] text-slate-400">{sig.timeframe}</span>
                    </div>

                    <div className="text-[10px] text-slate-300">
                      Ref: <span className="font-bold text-slate-100">{sig.referenceLevel}</span>
                    </div>

                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-slate-400">Trigger Price:</span>
                      <span className="font-mono font-bold text-slate-100">${sig.triggerPrice.toFixed(2)}</span>
                    </div>

                    {/* Manual Execution Button */}
                    <button
                      onClick={() => {
                        const side = sig.direction === "BUY" ? "LONG" : "SHORT";
                        const liveData = getPrice(instrument);
                        const execPrice = liveData && liveData.status === "LIVE" && liveData.price > 0 ? liveData.price : sig.triggerPrice;
                        const sl = sig.direction === "BUY" ? parseFloat((execPrice - 20).toFixed(2)) : parseFloat((execPrice + 20).toFixed(2));
                        const tp = sig.direction === "BUY" ? parseFloat((execPrice + 40).toFixed(2)) : parseFloat((execPrice - 40).toFixed(2));

                        const todayStr = new Date().toISOString().split("T")[0];
                        const timeStr = new Date().toTimeString().split(" ")[0].substring(0, 5);

                        addTrade({
                          date: todayStr,
                          time: timeStr,
                          symbol: instrument,
                          side,
                          strategy: sig.strategy,
                          signalId: sig.signalId,
                          entryPrice: execPrice,
                          stopLoss: sl,
                          targetPrice: tp,
                          quantity: instrument.includes("BTC") ? 0.001 : 0.01,
                          fees: 0,
                          status: "OPEN",
                          orderType: "MARKET",
                          notes: `Manual Paper Order from ${sig.strategy} Signal on ${sig.referenceLevel}`,
                        });
                        setExecutedMessage(`✓ Manual ${sig.direction} Paper Order executed for strategy: ${sig.strategy}`);
                        setTimeout(() => setExecutedMessage(null), 4000);
                      }}
                      className={`w-full py-1.5 rounded-lg text-[10px] font-sans font-bold flex items-center justify-center gap-1 shadow transition-all active:scale-[0.98] ${
                        sig.direction === "BUY"
                          ? "bg-emerald-600 hover:bg-emerald-500 text-white"
                          : "bg-rose-600 hover:bg-rose-500 text-white"
                      }`}
                    >
                      <span>EXECUTE {sig.direction} SIGNAL (PAPER ORDER)</span>
                    </button>
                  </div>
                ))}
              </div>

              {executedMessage && (
                <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] text-center font-bold animate-pulse">
                  {executedMessage}
                </div>
              )}
            </div>
          )}

          {/* P/D Zone Sidebar Summary */}
          {pdZone && pdZone.active && pdZone.top != null && pdZone.bottom != null && pdZone.equilibrium != null && (
            <div className="space-y-1.5">
              <span className="text-[10px] text-slate-400 uppercase tracking-wider font-sans font-semibold block">
                Premium / Discount Zone
              </span>

              <div className="rounded-xl overflow-hidden border border-slate-800/60">
                {/* Premium */}
                <div className="p-2 bg-rose-500/15 flex justify-between items-center border-b border-slate-800/60">
                  <span className="text-rose-300 font-bold text-[11px]">PREMIUM</span>
                  <span className="text-rose-300 font-mono text-[11px]">
                    {pdZone.top.toFixed(2)}
                  </span>
                </div>

                {/* Equilibrium */}
                <div className="p-2 bg-slate-800/60 flex justify-between items-center border-b border-slate-800/60">
                  <span className="text-slate-300 font-bold text-[11px]">Equilibrium</span>
                  <span className="text-slate-200 font-mono text-[11px]">
                    {pdZone.equilibrium.toFixed(2)}
                  </span>
                </div>

                {/* Discount */}
                <div className="p-2 bg-emerald-500/15 flex justify-between items-center">
                  <span className="text-emerald-300 font-bold text-[11px]">DISCOUNT</span>
                  <span className="text-emerald-300 font-mono text-[11px]">
                    {pdZone.bottom.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Horizontal Levels List */}
          <div className="space-y-1.5 flex-1 overflow-y-auto">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider font-sans font-semibold block">
              Active Levels ({horizontalLevels.length})
            </span>

            {horizontalLevels.length === 0 && !levelsLoading && (
              <div className="p-3 rounded-xl bg-slate-900/40 border border-slate-800/40 text-center text-slate-400 text-[10px]">
                No active levels.
              </div>
            )}

            {horizontalLevels.map((level) => (
              <div
                key={level.id}
                className="flex items-center justify-between p-2 rounded-lg bg-slate-900/40 border border-slate-800/40 gap-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className="w-2.5 h-2.5 rounded-sm shrink-0"
                    style={{ backgroundColor: level.color }}
                  />
                  <span className="text-slate-300 text-[10px] truncate leading-tight">
                    {level.label.split("  ")[0]}
                  </span>
                </div>
                <span className="text-slate-100 font-bold text-[11px] shrink-0 font-mono">
                  {level.price.toFixed(2)}
                </span>
              </div>
            ))}
          </div>

          {/* Sync time */}
          {lastFetched && (
            <div className="text-[9px] text-slate-600 pt-2 border-t border-slate-800/60">
              Engine sync: {lastFetched.toLocaleTimeString()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export const PineLiquidityChart = memo(PineLiquidityChartComponent);
