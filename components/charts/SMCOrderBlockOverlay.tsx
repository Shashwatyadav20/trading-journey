"use client";

/**
 * SMCOrderBlockOverlay
 * ====================
 * Visual rendering engine for Institutional Higher-Timeframe Order Blocks
 * matching TradingView's SMC PRO+ v6.6 box.new and box.set_right mechanics.
 *
 * Capabilities:
 * 1. Infinite / Extended Right Boundary:
 *    - Active unbroken Order Block boxes continuously stretch their right boundary
 *      to Math.max(currentBarIndex + 100, ob.originalRightBar + obExtend), ensuring
 *      they remain prominently visible across the chart viewport until mitigated/broken.
 * 2. Exact Displacement & Height Alignment:
 *    - Uses exact topPrice, bottomPrice, and 50% equilibrium midpoint calculated
 *      by smcDualHtfEngine.ts.
 * 3. Dual-Layer Visual Synchronization:
 *    - Layer A: Lightweight-Charts PriceLines (solid boundary lines + dotted equilibrium)
 *    - Layer B: High-performance SVG Rect overlay with translucent institutional tinting.
 */

import React, { useEffect, useRef, useState, useCallback } from "react";
import { IChartApi, ISeriesApi, LineStyle } from "lightweight-charts";
import {
  SMCOrderBlockBox,
  f_manageOB,
  f_createOB,
  DEFAULT_OB_EXTEND_BARS,
} from "../../lib/forex/smcDualHtfEngine";

export interface SMCOrderBlockOverlayProps {
  chart: IChartApi | null;
  series: ISeriesApi<"Candlestick"> | null;
  boxes: SMCOrderBlockBox[];
  containerRef?: React.RefObject<HTMLDivElement | null>;
  showMidpoint?: boolean;
  showPriceLines?: boolean;
}

export function SMCOrderBlockOverlay({
  chart,
  series,
  boxes,
  containerRef,
  showMidpoint = true,
  showPriceLines = true,
}: SMCOrderBlockOverlayProps) {
  // Store references to created PriceLines: map of key -> IPriceLine
  const priceLinesRef = useRef<Map<string, any>>(new Map());

  // SVG coordinate state for rendering box rectangles
  const [svgBoxes, setSvgBoxes] = useState<
    Array<{
      id: string;
      x: number;
      y: number;
      width: number;
      height: number;
      fillColor: string;
      borderColor: string;
      borderWidth: number;
      label: string;
      midpointY?: number;
    }>
  >([]);

  // ─── 1. PriceLine Rendering (Lightweight-Charts Native) ──────────────────────
  useEffect(() => {
    if (!series || !showPriceLines) return;

    const activeKeys = new Set<string>();

    for (const box of boxes) {
      if (box.isInvalidated) continue; // Do not draw price lines for invalidated/broken boxes

      const topKey = `${box.id}-TOP`;
      const bottomKey = `${box.id}-BOT`;
      const midKey = `${box.id}-MID`;

      activeKeys.add(topKey);
      activeKeys.add(bottomKey);
      if (showMidpoint) activeKeys.add(midKey);

      const isBullish = box.direction === "BULLISH";
      const color = isBullish ? "#10b981" : "#f43f5e";

      // Top line
      if (!priceLinesRef.current.has(topKey)) {
        try {
          const line = series.createPriceLine({
            price: box.topPrice,
            color,
            lineWidth: box.borderWidth as any,
            lineStyle: LineStyle.Solid,
            axisLabelVisible: true,
            title: `${box.timeframe} ${isBullish ? "Demand OB High" : "Supply OB High"}`,
          });
          priceLinesRef.current.set(topKey, line);
        } catch {}
      }

      // Bottom line
      if (!priceLinesRef.current.has(bottomKey)) {
        try {
          const line = series.createPriceLine({
            price: box.bottomPrice,
            color,
            lineWidth: box.borderWidth as any,
            lineStyle: LineStyle.Solid,
            axisLabelVisible: true,
            title: `${box.timeframe} ${isBullish ? "Demand OB Low" : "Supply OB Low"}`,
          });
          priceLinesRef.current.set(bottomKey, line);
        } catch {}
      }

      // 50% Equilibrium line
      if (showMidpoint && !priceLinesRef.current.has(midKey)) {
        try {
          const line = series.createPriceLine({
            price: box.midpoint,
            color: isBullish ? "#34d399" : "#fb7185",
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: false,
            title: "50% EQ",
          });
          priceLinesRef.current.set(midKey, line);
        } catch {}
      }
    }

    // Clean up stale lines
    for (const [key, line] of priceLinesRef.current.entries()) {
      if (!activeKeys.has(key)) {
        try {
          series.removePriceLine(line);
        } catch {}
        priceLinesRef.current.delete(key);
      }
    }
  }, [series, boxes, showPriceLines, showMidpoint]);

  // Clean up all price lines on unmount
  useEffect(() => {
    return () => {
      if (!series) return;
      for (const line of priceLinesRef.current.values()) {
        try {
          series.removePriceLine(line);
        } catch {}
      }
      priceLinesRef.current.clear();
    };
  }, [series]);

  // ─── 2. SVG Box Rectangle Computation (Sync with Chart Coordinates) ───────────
  const updateSvgCoordinates = useCallback(() => {
    if (!chart || !series || !containerRef?.current) {
      setSvgBoxes([]);
      return;
    }

    const containerWidth = containerRef.current.clientWidth;
    const computedSvgList: typeof svgBoxes = [];

    for (const box of boxes) {
      if (box.isInvalidated) continue;

      const rawYTop = series.priceToCoordinate(box.topPrice);
      const rawYBottom = series.priceToCoordinate(box.bottomPrice);
      const rawYMid = showMidpoint ? series.priceToCoordinate(box.midpoint) : null;

      if (rawYTop === null || rawYBottom === null) continue;

      const yTop = Number(rawYTop);
      const yBottom = Number(rawYBottom);
      const yMid = rawYMid !== null ? Number(rawYMid) : null;

      // Coordinate for left timestamp
      const leftTimeSec = Math.floor(box.leftTimestamp / 1000);
      const rawXLeft = chart.timeScale().timeToCoordinate(leftTimeSec as any);
      const xLeft = rawXLeft !== null ? Number(rawXLeft) : 0;

      // Coordinate for right edge:
      // Active boxes extend across viewport to Math.max(currentBar + 100) or container right edge
      const rightTimeSec = Math.floor(box.rightTimestamp / 1000);
      const rawXRight = chart.timeScale().timeToCoordinate(rightTimeSec as any);
      let xRight: number;

      if (rawXRight === null || Number(rawXRight) < xLeft) {
        // Stretch across the right viewport buffer into the future
        xRight = Math.max(xLeft + 120, containerWidth + 80);
      } else {
        // Ensure active boxes stay visibly extended
        xRight = Math.max(Number(rawXRight), xLeft + 60);
      }

      const rectY = Math.min(yTop, yBottom);
      const rectHeight = Math.max(2, Math.abs(yBottom - yTop));
      const rectWidth = Math.max(10, xRight - xLeft);

      computedSvgList.push({
        id: box.id,
        x: xLeft,
        y: rectY,
        width: rectWidth,
        height: rectHeight,
        fillColor: box.fillColor,
        borderColor: box.borderColor,
        borderWidth: box.borderWidth,
        label: box.label,
        midpointY: yMid !== null ? yMid : undefined,
      });
    }

    setSvgBoxes(computedSvgList);
  }, [chart, series, boxes, containerRef, showMidpoint]);

  // Re-compute on zoom, pan, or resize
  useEffect(() => {
    if (!chart) return;

    updateSvgCoordinates();

    const timeScale = chart.timeScale();
    timeScale.subscribeVisibleTimeRangeChange(updateSvgCoordinates);
    timeScale.subscribeVisibleLogicalRangeChange(updateSvgCoordinates);

    window.addEventListener("resize", updateSvgCoordinates);

    return () => {
      try {
        timeScale.unsubscribeVisibleTimeRangeChange(updateSvgCoordinates);
        timeScale.unsubscribeVisibleLogicalRangeChange(updateSvgCoordinates);
      } catch {}
      window.removeEventListener("resize", updateSvgCoordinates);
    };
  }, [chart, updateSvgCoordinates]);

  // If containerRef not provided or no active boxes, render nothing in SVG DOM
  if (!containerRef?.current || svgBoxes.length === 0) {
    return null;
  }

  return (
    <svg
      className="absolute inset-0 pointer-events-none z-10 w-full h-full overflow-hidden"
      style={{ width: "100%", height: "100%" }}
    >
      <defs>
        {svgBoxes.map((b) => (
          <linearGradient key={`grad-${b.id}`} id={`grad-${b.id}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={b.borderColor} stopOpacity="0.22" />
            <stop offset="70%" stopColor={b.borderColor} stopOpacity="0.10" />
            <stop offset="100%" stopColor={b.borderColor} stopOpacity="0.04" />
          </linearGradient>
        ))}
      </defs>

      {svgBoxes.map((b) => (
        <g key={b.id} className="transition-all duration-75">
          {/* Translucent Order Block Box Body */}
          <rect
            x={b.x}
            y={b.y}
            width={b.width}
            height={b.height}
            fill={`url(#grad-${b.id})`}
            stroke={b.borderColor}
            strokeWidth={b.borderWidth}
            strokeDasharray={b.width > 300 ? "none" : "none"}
            rx={3}
            ry={3}
          />

          {/* 50% Equilibrium Line */}
          {b.midpointY !== undefined && (
            <line
              x1={b.x}
              y1={b.midpointY}
              x2={b.x + b.width}
              y2={b.midpointY}
              stroke={b.borderColor}
              strokeWidth={1}
              strokeDasharray="3 3"
              strokeOpacity={0.6}
            />
          )}

          {/* Text Label on Left Edge */}
          <text
            x={b.x + 8}
            y={b.y + Math.min(14, b.height / 2 + 4)}
            fill={b.borderColor}
            fontSize="10px"
            fontFamily="monospace"
            fontWeight="bold"
            className="select-none"
          >
            {b.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

export default SMCOrderBlockOverlay;
