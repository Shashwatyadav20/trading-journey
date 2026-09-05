"use client";

/**
 * PineChartOverlay
 * ================
 * Renders Pine Engine levels onto an existing lightweight-charts ISeriesApi
 * as PriceLines.
 *
 * Design constraints:
 *   - Uses ISeriesApi.createPriceLine / removePriceLine (lightweight-charts v4 API).
 *   - Maintains a stable Map<levelId, IPriceLine> ref — never recreates all lines
 *     on every tick; only adds/removes changed levels.
 *   - Pine levels are NEVER mixed with manual drawing refs (drawingLinesRef).
 *   - Cannot be edited/deleted by the drawing toolbar.
 *   - P/D zone boundary and Equilibrium are rendered as distinct price lines.
 *   - lineStyle mapping: solid=0, dashed=2, dotted=1 (lightweight-charts LineStyle enum).
 *
 * Props:
 *   series    — the candlestick series to attach price lines to
 *   levels    — ActiveLevel[] from PineLiquidityContext (backend source of truth)
 */

import { useEffect, useRef } from "react";
import { ISeriesApi, LineStyle } from "lightweight-charts";
import { PineActiveLevel, PinePDZoneState } from "../../types/pine";

interface PineChartOverlayProps {
  series: ISeriesApi<"Candlestick"> | null;
  levels: PineActiveLevel[];
  pdZone?: PinePDZoneState | null;
}

function mapLineStyle(style: "solid" | "dashed" | "dotted"): LineStyle {
  switch (style) {
    case "dotted":  return LineStyle.Dotted;      // 1
    case "dashed":  return LineStyle.Dashed;      // 2
    case "solid":
    default:        return LineStyle.Solid;       // 0
  }
}

export function PineChartOverlay({ series, levels, pdZone }: PineChartOverlayProps) {
  // Map from Pine level ID → IPriceLine reference
  const pineLinesRef = useRef<Map<string, any>>(new Map());

  useEffect(() => {
    if (!series) return;

    // Collect all level IDs from active levels + pdZone synthetic IDs
    const activeIds = new Set<string>();

    levels.forEach((l) => activeIds.add(l.id));

    if (pdZone && pdZone.active && pdZone.top !== null && pdZone.bottom !== null && pdZone.equilibrium !== null) {
      activeIds.add("pd-zone-top");
      activeIds.add("pd-zone-eq");
      activeIds.add("pd-zone-bot");
    }

    // 1. Remove stale lines (backend removed them or pdZone deactivated)
    for (const [id, priceLine] of pineLinesRef.current.entries()) {
      if (!activeIds.has(id)) {
        try {
          series.removePriceLine(priceLine);
        } catch {
          // Ignore removal errors
        }
        pineLinesRef.current.delete(id);
      }
    }

    // 2. Add horizontal Pine levels
    for (const level of levels) {
      if (pineLinesRef.current.has(level.id)) {
        continue;
      }

      try {
        const priceLine = series.createPriceLine({
          price: level.price,
          color: level.color,
          lineWidth: level.lineWidth as any,
          lineStyle: mapLineStyle(level.lineStyle),
          axisLabelVisible: true,
          title: level.label,
        });
        pineLinesRef.current.set(level.id, priceLine);
      } catch {
        // Ignore creation errors
      }
    }

    // 3. Add Premium / Discount Zone & Equilibrium lines if active
    if (pdZone && pdZone.active && pdZone.top !== null && pdZone.bottom !== null && pdZone.equilibrium !== null) {
      if (!pineLinesRef.current.has("pd-zone-top")) {
        try {
          const topLine = series.createPriceLine({
            price: pdZone.top,
            color: "#ef4444", // Red for Premium top
            lineWidth: 2,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: `PREMIUM Top [${pdZone.top.toFixed(2)}]`,
          });
          pineLinesRef.current.set("pd-zone-top", topLine);
        } catch { /* ignore */ }
      }

      if (!pineLinesRef.current.has("pd-zone-eq")) {
        try {
          const eqLine = series.createPriceLine({
            price: pdZone.equilibrium,
            color: "#94a3b8", // Slate for Equilibrium
            lineWidth: 2,
            lineStyle: LineStyle.Solid,
            axisLabelVisible: true,
            title: `Equilibrium [${pdZone.equilibrium.toFixed(2)}]`,
          });
          pineLinesRef.current.set("pd-zone-eq", eqLine);
        } catch { /* ignore */ }
      }

      if (!pineLinesRef.current.has("pd-zone-bot")) {
        try {
          const botLine = series.createPriceLine({
            price: pdZone.bottom,
            color: "#22c55e", // Green for Discount bottom
            lineWidth: 2,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: `DISCOUNT Bottom [${pdZone.bottom.toFixed(2)}]`,
          });
          pineLinesRef.current.set("pd-zone-bot", botLine);
        } catch { /* ignore */ }
      }
    }
  }, [series, levels, pdZone]);

  // Cleanup all Pine price lines when component unmounts
  useEffect(() => {
    return () => {
      if (!series) return;
      for (const priceLine of pineLinesRef.current.values()) {
        try {
          series.removePriceLine(priceLine);
        } catch {
          // Ignore
        }
      }
      pineLinesRef.current.clear();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series]);

  // This component renders nothing visible — all output goes through ISeriesApi
  return null;
}
