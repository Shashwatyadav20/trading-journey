import type { OhlcvCandle } from "../entry/EntrySetupTypes.js";
import { detectDojiPattern, type DojiPatternType } from "./Strategy03DojiPatternDetector.js";

export interface ConsolidationDetectionResult {
  detected: boolean;
  windowCandles: 3 | 4 | 5 | 8;
  consolidationHigh: number | null;
  consolidationLow: number | null;
  rangePct: number | null;
  volumeContracting: boolean;
  dojiCount: number;
  latestDojiPattern: DojiPatternType;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function detectTightConsolidation(params: {
  candles: OhlcvCandle[]; // completed candles ONLY up to prior bar (before breakout candle)
  windowCandles: 3 | 4 | 5 | 8;
  maxRangePct?: number;
}): ConsolidationDetectionResult {
  const n = params.windowCandles;
  const maxRangePct = params.maxRangePct ?? (n <= 4 ? 3.5 : 5.0);
  if (params.candles.length < n + 10) {
    return {
      detected: false,
      windowCandles: n,
      consolidationHigh: null,
      consolidationLow: null,
      rangePct: null,
      volumeContracting: false,
      dojiCount: 0,
      latestDojiPattern: "NONE",
    };
  }

  const window = params.candles.slice(-n);
  const prior10 = params.candles.slice(-(n + 10), -n);
  const high = Math.max(...window.map((c) => c.high));
  const low = Math.min(...window.map((c) => c.low));
  const rangePct = low > 0 ? round2(((high - low) / low) * 100) : 99;

  const avgVolWindow = window.reduce((a, c) => a + c.volume, 0) / n;
  const avgVolPrior = prior10.reduce((a, c) => a + c.volume, 0) / prior10.length;
  const volumeContracting = avgVolPrior > 0 && avgVolWindow <= avgVolPrior * 1.05;

  const dojis = window.map((c) => detectDojiPattern(c));
  const dojiCount = dojis.filter((d) => d.isIndecisionOrSmallBody).length;
  const latestDojiPattern = dojis[dojis.length - 1]?.pattern ?? "NONE";

  const detected = rangePct <= maxRangePct && dojiCount >= 1;

  return {
    detected,
    windowCandles: n,
    consolidationHigh: round2(high),
    consolidationLow: round2(low),
    rangePct,
    volumeContracting,
    dojiCount,
    latestDojiPattern,
  };
}

