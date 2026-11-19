import type { OhlcvCandle } from "../entry/EntrySetupTypes.js";
import { detectDojiPattern, type DojiPatternType } from "./Strategy03DojiPatternDetector.js";
import { detectTightConsolidation } from "./Strategy03ConsolidationDetector.js";
import { evaluateMomentumDojiBreakout } from "./Strategy03MomentumBreakoutEntry.js";

export interface IntradayCandleWithMeta extends OhlcvCandle {
  isComplete?: boolean;
}

export interface DataIntegrityStats {
  totalCandles: number;
  validSessionCandles: number;
  duplicateTimestampsRemoved: number;
  outOfSessionCandles: number;
  incompleteCandlesSkipped: number;
  tradingDaysCovered: number;
}

export type IntradayRejectionReason =
  | "INSUFFICIENT_HISTORY"
  | "NO_CONSOLIDATION"
  | "NO_DOJI_IN_CONSOLIDATION"
  | "NO_BREAKOUT_CLOSE"
  | "WEAK_CANDLE_QUALITY"
  | "LOW_RVOL";

export interface IntradayBreakoutEvent {
  symbol: string;
  istDate: string;
  istTime: string;
  barIndexInFullSeries: number;
  breakoutTimestamp: string;
  breakoutClose: number;
  consolidationHigh: number;
  consolidationLowSl: number;
  target1to3: number;
  rvol: number;
  candleQuality: number;
  dojiPattern: DojiPatternType;
}

export interface IntradayDayEvaluation {
  istDate: string;
  barsEvaluated: number;
  consolidationPasses: number;
  dojiPasses: number;
  allConfirmedBreakouts: IntradayBreakoutEvent[];
  firstBreakout: IntradayBreakoutEvent | null;
  duplicatesPrevented: number;
  eodOnlyBreakout: IntradayBreakoutEvent | null;
  rejectionCounts: Record<IntradayRejectionReason, number>;
}

/** Convert UTC ISO timestamp to Asia/Kolkata YYYY-MM-DD and HH:MM */
export function toIstDateAndTime(utcIso: string): { istDate: string; istTime: string; minutesOfDay: number } {
  const ms = Date.parse(utcIso);
  if (!Number.isFinite(ms)) return { istDate: "", istTime: "", minutesOfDay: -1 };
  const istMs = ms + 330 * 60_000; // UTC+05:30 fixed offset (India has no DST)
  const d = new Date(istMs);
  const istDate = d.toISOString().slice(0, 10);
  const hh = d.getUTCHours();
  const mm = d.getUTCMinutes();
  const istTime = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  return { istDate, istTime, minutesOfDay: hh * 60 + mm };
}

/** Validate NSE cash market session boundaries (09:15 to 15:30 IST) and deduplicate timestamps */
export function sanitizeIntraday1hSeries(rawCandles: IntradayCandleWithMeta[]): {
  candles: IntradayCandleWithMeta[];
  integrity: DataIntegrityStats;
} {
  const seen = new Set<string>();
  const clean: IntradayCandleWithMeta[] = [];
  const days = new Set<string>();
  let duplicateTimestampsRemoved = 0;
  let outOfSessionCandles = 0;
  let incompleteCandlesSkipped = 0;

  const sorted = [...rawCandles].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  for (const c of sorted) {
    if (c.isComplete === false) {
      incompleteCandlesSkipped++;
      continue;
    }
    if (seen.has(c.timestamp)) {
      duplicateTimestampsRemoved++;
      continue;
    }
    seen.add(c.timestamp);
    const { istDate, minutesOfDay } = toIstDateAndTime(c.timestamp);
    // NSE 1H bars start at 09:15 IST and last bar starts at 15:15 IST (09:15..15:30)
    if (minutesOfDay < 555 || minutesOfDay > 930) {
      outOfSessionCandles++;
      continue;
    }
    days.add(istDate);
    clean.push(c);
  }

  return {
    candles: clean,
    integrity: {
      totalCandles: rawCandles.length,
      validSessionCandles: clean.length,
      duplicateTimestampsRemoved,
      outOfSessionCandles,
      incompleteCandlesSkipped,
      tradingDaysCovered: days.size,
    },
  };
}

/**
 * Evaluates every completed 1H candle on `istDate` using ONLY historical candles up to that bar.
 * Never looks ahead; preserves EOD-only evaluation for direct comparison.
 */
export function evaluateIntradayEventsForDay(params: {
  symbol: string;
  istDate: string;
  sanitizedCandles: IntradayCandleWithMeta[];
  windowCandles: 3 | 4 | 5 | 8;
  allowedPatterns?: DojiPatternType[] | "ANY_NO_DOJI_REQUIRED";
}): IntradayDayEvaluation {
  const rejectionCounts: Record<IntradayRejectionReason, number> = {
    INSUFFICIENT_HISTORY: 0,
    NO_CONSOLIDATION: 0,
    NO_DOJI_IN_CONSOLIDATION: 0,
    NO_BREAKOUT_CLOSE: 0,
    WEAK_CANDLE_QUALITY: 0,
    LOW_RVOL: 0,
  };

  const dayIndices: number[] = [];
  for (let i = 0; i < params.sanitizedCandles.length; i++) {
    const { istDate } = toIstDateAndTime(params.sanitizedCandles[i].timestamp);
    if (istDate === params.istDate) dayIndices.push(i);
    else if (istDate > params.istDate) break;
  }

  let barsEvaluated = 0;
  let consolidationPasses = 0;
  let dojiPasses = 0;
  const allConfirmedBreakouts: IntradayBreakoutEvent[] = [];
  let eodOnlyBreakout: IntradayBreakoutEvent | null = null;

  for (let k = 0; k < dayIndices.length; k++) {
    const idx = dayIndices[k];
    const isEodBar = k === dayIndices.length - 1;
    const subSeries = params.sanitizedCandles.slice(0, idx + 1);
    barsEvaluated++;

    if (subSeries.length < params.windowCandles + 15) {
      rejectionCounts.INSUFFICIENT_HISTORY++;
      continue;
    }

    const latest = subSeries[subSeries.length - 1];
    const prior = subSeries.slice(0, -1);
    const cons = detectTightConsolidation({ candles: prior, windowCandles: params.windowCandles });
    const win = prior.slice(-params.windowCandles);
    const consHigh = Math.max(...win.map((c) => c.high));
    const consLow = Math.min(...win.map((c) => c.low));

    if (cons.rangePct === null || cons.rangePct > (params.windowCandles <= 4 ? 3.5 : 5.0)) {
      rejectionCounts.NO_CONSOLIDATION++;
      continue;
    }
    consolidationPasses++;

    let patternOk = cons.detected;
    let matchedPattern: DojiPatternType = cons.latestDojiPattern;
    if (params.allowedPatterns === "ANY_NO_DOJI_REQUIRED") {
      patternOk = true;
    } else if (Array.isArray(params.allowedPatterns)) {
      const hit = [...win].reverse().find((c) => params.allowedPatterns!.includes(detectDojiPattern(c).pattern));
      patternOk = Boolean(hit);
      if (hit) matchedPattern = detectDojiPattern(hit).pattern;
    }

    if (!patternOk) {
      rejectionCounts.NO_DOJI_IN_CONSOLIDATION++;
      continue;
    }
    dojiPasses++;

    const avgVol10 = prior.slice(-10).reduce((a, c) => a + c.volume, 0) / 10;
    const rvol = avgVol10 > 0 ? Math.round((latest.volume / avgVol10) * 100) / 100 : 0;
    const rng = latest.high - latest.low;
    const quality = rng > 0 ? Math.round(((latest.close - latest.open) / rng) * 100) / 100 : 0;

    if (!(latest.close > consHigh * 1.001 && latest.close > latest.open)) {
      rejectionCounts.NO_BREAKOUT_CLOSE++;
      continue;
    }
    if (quality < 0.45) {
      rejectionCounts.WEAK_CANDLE_QUALITY++;
      continue;
    }
    if (rvol < 1.2) {
      rejectionCounts.LOW_RVOL++;
      continue;
    }

    // Double-check against baseline evaluator when using default user Doji rules
    if (!params.allowedPatterns) {
      const baseline = evaluateMomentumDojiBreakout({
        symbol: params.symbol,
        candles: subSeries,
        windowCandles: params.windowCandles,
      });
      if (baseline.status !== "DOJI_BREAKOUT_CONFIRMED") continue;
    }

    const { istTime } = toIstDateAndTime(latest.timestamp);
    const risk = latest.close - consLow;
    const ev: IntradayBreakoutEvent = {
      symbol: params.symbol,
      istDate: params.istDate,
      istTime,
      barIndexInFullSeries: idx,
      breakoutTimestamp: latest.timestamp,
      breakoutClose: latest.close,
      consolidationHigh: consHigh,
      consolidationLowSl: consLow,
      target1to3: risk > 0 ? Math.round((latest.close + risk * 3) * 100) / 100 : latest.close,
      rvol,
      candleQuality: quality,
      dojiPattern: matchedPattern,
    };
    allConfirmedBreakouts.push(ev);
    if (isEodBar) eodOnlyBreakout = ev;
  }

  return {
    istDate: params.istDate,
    barsEvaluated,
    consolidationPasses,
    dojiPasses,
    allConfirmedBreakouts,
    firstBreakout: allConfirmedBreakouts[0] ?? null,
    duplicatesPrevented: Math.max(0, allConfirmedBreakouts.length - 1),
    eodOnlyBreakout,
    rejectionCounts,
  };
}
