"use client";

/**
 * PineLiquidityContext
 * ====================
 * Provides Pine Engine levels, P/D zone state, detected strategy signals,
 * and active chart timeframe to descendant chart components.
 *
 * Data flow:
 *   Backend PineLevelService & PineSignalEngine (REST poll every 3s)
 *     → PineLiquidityContext (React state)
 *       → PineChartOverlay & PineLiquidityChart
 *
 * Design constraints:
 *   - Frontend does NOT recalculate any Pine or Signal logic.
 *   - Backend engine is the single source of truth.
 *   - NO auto-trading. Signals are strictly for user manual execution.
 *   - Cleanup on unmount: clearInterval.
 */
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import { PineActiveLevel, PinePDZoneState, PineSignal } from "../types/pine";
import { fetchPineLevels, fetchPinePDZone, fetchPineSignals } from "../lib/pineApi";

const POLL_INTERVAL_MS = 3000;

interface PineLiquidityContextType {
  levels: PineActiveLevel[];
  signals: PineSignal[];
  pdZone: PinePDZoneState | null;
  instrument: string;
  chartTF: number;
  setChartTF: (tf: number) => void;
  lastFetched: Date | null;
  isLoading: boolean;
  error: string | null;
}

const PineLiquidityContext = createContext<PineLiquidityContextType | undefined>(undefined);

interface PineLiquidityProviderProps {
  children: React.ReactNode;
  instrument: string;
  initialChartTF?: number;
}

export function PineLiquidityProvider({
  children,
  instrument,
  initialChartTF = 15,
}: PineLiquidityProviderProps) {
  const [levels, setLevels] = useState<PineActiveLevel[]>([]);
  const [signals, setSignals] = useState<PineSignal[]>([]);
  const [pdZone, setPdZone] = useState<PinePDZoneState | null>(null);
  const [chartTF, setChartTF] = useState<number>(initialChartTF);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);

  const fetchAll = useCallback(async () => {
    try {
      const [newLevels, newZone, newSignals] = await Promise.all([
        fetchPineLevels(instrument, chartTF),
        fetchPinePDZone(instrument),
        fetchPineSignals(instrument),
      ]);

      if (!isMountedRef.current) return;

      setLevels(newLevels);
      setPdZone(newZone);
      setSignals(newSignals);
      setLastFetched(new Date());
      setError(null);
    } catch (err: any) {
      if (!isMountedRef.current) return;
      setError(err?.message ?? "Failed to fetch Pine levels & signals");
    } finally {
      if (isMountedRef.current) setIsLoading(false);
    }
  }, [instrument, chartTF]);

  useEffect(() => {
    isMountedRef.current = true;

    // Immediately fetch on mount / instrument / timeframe change
    setIsLoading(true);
    fetchAll();

    // Poll at POLL_INTERVAL_MS
    intervalRef.current = setInterval(fetchAll, POLL_INTERVAL_MS);

    return () => {
      isMountedRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [fetchAll, instrument, chartTF]);

  return (
    <PineLiquidityContext.Provider
      value={{
        levels,
        signals,
        pdZone,
        instrument,
        chartTF,
        setChartTF,
        lastFetched,
        isLoading,
        error,
      }}
    >
      {children}
    </PineLiquidityContext.Provider>
  );
}

export function usePineLiquidity(): PineLiquidityContextType {
  const ctx = useContext(PineLiquidityContext);
  if (!ctx) {
    throw new Error("usePineLiquidity must be used within a PineLiquidityProvider");
  }
  return ctx;
}
