import type { DailyCandleBar } from "../HistoricalValidationEngine.js";

export interface VolumeMomentumMetrics {
  relativeVolume20d: number | null;
  recent5dVolContractionRatio: number | null;
  avgDailyTurnoverCr: number;
  liquidEnough: boolean;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function analyzeVolumeMomentum(
  candles: DailyCandleBar[],
  minTurnoverCr = 2.0
): VolumeMomentumMetrics {
  if (candles.length < 22) {
    return {
      relativeVolume20d: null,
      recent5dVolContractionRatio: null,
      avgDailyTurnoverCr: 0,
      liquidEnough: false,
    };
  }
  const last = candles[candles.length - 1];
  const prev20 = candles.slice(-21, -1);
  const avgVol20 = prev20.reduce((a, c) => a + c.volume, 0) / 20;
  const recent5Avg = candles.slice(-5).reduce((a, c) => a + c.volume, 0) / 5;
  const avgTurnoverCr = round2(
    prev20.reduce((a, c) => a + (c.close * c.volume) / 1e7, 0) / 20
  );

  return {
    relativeVolume20d: avgVol20 > 0 ? round2(last.volume / avgVol20) : null,
    recent5dVolContractionRatio: avgVol20 > 0 ? round2(recent5Avg / avgVol20) : null,
    avgDailyTurnoverCr: avgTurnoverCr,
    liquidEnough: avgTurnoverCr >= minTurnoverCr,
  };
}

