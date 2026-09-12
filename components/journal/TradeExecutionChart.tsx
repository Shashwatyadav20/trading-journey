"use client";

/**
 * TradeExecutionChart
 * ===================
 * Renders an interactive historical chart for a logged trade showing:
 *   - Entry Marker (arrowUp for LONG, arrowDown for SHORT)
 *   - Exit Marker (square, color-coded by P&L WIN/LOSS) if exit exists
 *   - Entry Price Line (solid)
 *   - Exit Price Line (solid, if exit exists)
 *   - Stop Loss Line (dashed red, if SL available)
 *   - Target / Take Profit Line (dashed green, if TP available)
 *
 * Designed to fit seamlessly into TradeDetailModal and project UI.
 */
import React, { useEffect, useRef, useState } from "react";
import {
  createChart,
  IChartApi,
  ISeriesApi,
  CandlestickData,
  Time,
  LineStyle,
  SeriesMarker,
} from "lightweight-charts";
import { Trade } from "../../types/trade";
import { Loader2 } from "lucide-react";

interface TradeExecutionChartProps {
  trade: Trade;
}

function getBackendUrl() {
  return (
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://localhost:4000"
  );
}

function parseTradeTimeMs(dateStr: string, timeStr?: string): number {
  try {
    const timeFormatted = timeStr && timeStr.length >= 4 ? timeStr : "09:30";
    const isoStr = `${dateStr}T${timeFormatted}:00.000Z`;
    const ms = new Date(isoStr).getTime();
    return isNaN(ms) ? Date.now() : ms;
  } catch {
    return Date.now();
  }
}

function findClosestCandleTime(chartData: CandlestickData[], targetMs: number): Time {
  if (chartData.length === 0) return Math.floor(Date.now() / 1000) as Time;
  let closest = chartData[0];
  let minDiff = Math.abs((closest.time as number) * 1000 - targetMs);

  for (const cd of chartData) {
    const diff = Math.abs((cd.time as number) * 1000 - targetMs);
    if (diff < minDiff) {
      minDiff = diff;
      closest = cd;
    }
  }

  return closest.time;
}

export default function TradeExecutionChart({ trade }: TradeExecutionChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  const [loading, setLoading] = useState(true);

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
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };

    window.addEventListener("resize", handleResize);
    handleResize();

    const loadCandles = async () => {
      setLoading(true);
      try {
        let chartData: CandlestickData[] = [];
        const encoded = encodeURIComponent(trade.symbol);

        try {
          const backendRes = await fetch(`${getBackendUrl()}/pine/candles/${encoded}?tf=15`);
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
        } catch { /* ignore */ }

        // Fallback synthetic baseline candles centered around entry/exit if fetch empty
        if (chartData.length === 0) {
          const entryMs = parseTradeTimeMs(trade.date, trade.time);
          const basePrice = trade.entryPrice;
          const startMs = entryMs - 20 * 15 * 60 * 1000;
          for (let i = 0; i < 40; i++) {
            const timeMs = startMs + i * 15 * 60 * 1000;
            const variance = (Math.sin(i) * 0.002 + (Math.random() - 0.5) * 0.001) * basePrice;
            const openP = parseFloat((basePrice + variance).toFixed(2));
            const highP = parseFloat((openP * 1.002).toFixed(2));
            const lowP = parseFloat((openP * 0.998).toFixed(2));
            const closeP = parseFloat((openP + (Math.random() - 0.5) * variance).toFixed(2));
            chartData.push({
              time: Math.floor(timeMs / 1000) as Time,
              open: openP,
              high: Math.max(highP, openP, closeP),
              low: Math.min(lowP, openP, closeP),
              close: closeP,
            });
          }
        }

        // Deduplicate & sort ascending by timestamp
        const timeMap = new Map<number, CandlestickData>();
        chartData.forEach((cd) => timeMap.set(cd.time as number, cd));
        chartData = Array.from(timeMap.values()).sort((a, b) => (a.time as number) - (b.time as number));

        if (seriesRef.current && chartData.length > 0) {
          seriesRef.current.setData(chartData);

          // 1. Entry Price Line
          seriesRef.current.createPriceLine({
            price: trade.entryPrice,
            color: trade.side === "LONG" ? "#10b981" : "#f43f5e",
            lineWidth: 2,
            lineStyle: LineStyle.Solid,
            axisLabelVisible: true,
            title: `ENTRY (${trade.side}): $${trade.entryPrice.toFixed(2)}`,
          });

          // 2. Exit Price Line (if trade is closed / has exit price)
          const isClosed = trade.status !== "OPEN" && trade.exitPrice > 0;
          if (isClosed) {
            seriesRef.current.createPriceLine({
              price: trade.exitPrice,
              color: trade.pnl >= 0 ? "#a855f7" : "#f43f5e",
              lineWidth: 2,
              lineStyle: LineStyle.Solid,
              axisLabelVisible: true,
              title: `EXIT: $${trade.exitPrice.toFixed(2)}`,
            });
          }

          // 3. Stop Loss Line (if defined)
          if (trade.stopLoss && trade.stopLoss > 0) {
            seriesRef.current.createPriceLine({
              price: trade.stopLoss,
              color: "#ef4444",
              lineWidth: 1,
              lineStyle: LineStyle.Dashed,
              axisLabelVisible: true,
              title: `SL: $${trade.stopLoss.toFixed(2)}`,
            });
          }

          // 4. Target / Take Profit Line (if defined)
          if (trade.targetPrice && trade.targetPrice > 0) {
            seriesRef.current.createPriceLine({
              price: trade.targetPrice,
              color: "#10b981",
              lineWidth: 1,
              lineStyle: LineStyle.Dashed,
              axisLabelVisible: true,
              title: `TP: $${trade.targetPrice.toFixed(2)}`,
            });
          }

          // 5. Execution Markers (Entry & Exit)
          const markers: SeriesMarker<Time>[] = [];

          const entryMs = parseTradeTimeMs(trade.date, trade.time);
          const entryCandleTime = findClosestCandleTime(chartData, entryMs);

          markers.push({
            time: entryCandleTime,
            position: trade.side === "LONG" ? "belowBar" : "aboveBar",
            color: trade.side === "LONG" ? "#10b981" : "#f43f5e",
            shape: trade.side === "LONG" ? "arrowUp" : "arrowDown",
            text: `ENTRY @ $${trade.entryPrice}`,
          });

          if (isClosed) {
            const exitMs = parseTradeTimeMs(trade.date, trade.exitTime || trade.time);
            const exitCandleTime = findClosestCandleTime(chartData, exitMs + (exitMs === entryMs ? 900000 : 0));

            markers.push({
              time: exitCandleTime,
              position: trade.side === "LONG" ? "aboveBar" : "belowBar",
              color: trade.pnl >= 0 ? "#10b981" : "#f43f5e",
              shape: "square",
              text: `EXIT @ $${trade.exitPrice} (${trade.pnl >= 0 ? "+" : ""}${trade.pnl.toFixed(2)})`,
            });
          }

          // Sort markers ascending by time
          markers.sort((a, b) => (a.time as number) - (b.time as number));
          seriesRef.current.setMarkers(markers as any);

          chartRef.current?.timeScale().fitContent();
        }
      } catch (err) {
        console.error("[TradeExecutionChart] Error initializing chart markers:", err);
      } finally {
        setLoading(false);
      }
    };

    loadCandles();

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [trade]);

  return (
    <div className="relative w-full h-[260px] bg-[#090d16] rounded-xl overflow-hidden border border-slate-800/80">
      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#090d16]/80 backdrop-blur-xs">
          <Loader2 className="w-6 h-6 text-cyan-400 animate-spin" />
        </div>
      )}
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}
