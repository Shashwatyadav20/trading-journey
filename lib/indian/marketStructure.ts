/**
 * Market Structure and Liquidity Detection for Indian Equities (Frontend/Shared)
 * 
 * Provides deterministic, look-ahead-free detection of:
 * 1. Confirmed 5-Bar Fractal Pivots (Swing Highs and Swing Lows)
 * 2. Previous Week High (PWH) and Previous Week Low (PWL) under Asia/Kolkata exchange sessions
 * 3. Equal Highs (EQH) and Equal Lows (EQL) with configurable tolerance
 * 4. Bullish & Bearish Liquidity Sweeps
 * 5. Change of Character (CHOCH) vs Break of Structure (BOS)
 */

import { DailyCandle } from "./dailyStrategyScanner";

export interface StructuralPivot {
  type: "SWING_HIGH" | "SWING_LOW";
  price: number;
  barIndex: number;
  date: string; // Date of the pivot candle (Asia/Kolkata YYYY-MM-DD)
  confirmedIndex: number; // Bar index when confirmed (barIndex + 2)
  confirmedDate: string; // Date of the bar when confirmed
}

export interface EqualLevel {
  type: "EQH" | "EQL";
  price: number; // Average of the two pivot prices
  pivot1: StructuralPivot;
  pivot2: StructuralPivot;
  tolerancePercent: number;
  differencePercent: number;
}

export interface WeeklyLevel {
  weekKey: string; // E.g. "2026-W40"
  weekStartDate: string; // Monday YYYY-MM-DD
  weekEndDate: string; // Friday YYYY-MM-DD
  pwh: number;
  pwl: number;
  candleDates: string[];
}

export interface LiquiditySweepEvent {
  direction: "BULLISH" | "BEARISH";
  sweptLevel: number;
  levelType: "SWING_LOW" | "PWL" | "EQL" | "SWING_HIGH" | "PWH" | "EQH";
  sweepCandleDate: string;
  sweepCandleIndex: number;
  wickPenetration: number;
  wickPenetrationPercent: number;
  closeConfirmation: boolean;
  closingPrice: number;
  dataQuality: "HIGH_CONFIDENCE" | "VALID" | "INSUFFICIENT_DATA";
  description: string;
}

export interface ChochEvent {
  direction: "BULLISH" | "BEARISH";
  brokenLevel: number;
  brokenPivot: StructuralPivot;
  priorTrend: "BEARISH" | "BULLISH";
  breakCandleDate: string;
  breakCandleIndex: number;
  confirmationPrice: number;
  description: string;
}

export interface MarketStructureResult {
  pivots: StructuralPivot[];
  confirmedHighs: StructuralPivot[];
  confirmedLows: StructuralPivot[];
  pwh: number | null;
  pwl: number | null;
  previousWeekDetails: WeeklyLevel | null;
  equalHighs: EqualLevel[];
  equalLows: EqualLevel[];
  recentLiquiditySweep: LiquiditySweepEvent | null;
  allLiquiditySweeps: LiquiditySweepEvent[];
  recentChoch: ChochEvent | null;
  allChochs: ChochEvent[];
  currentMarketState: "BULLISH" | "BEARISH" | "NEUTRAL";
  isAvailable: boolean;
  warnings: string[];
}

export interface MarketStructureOptions {
  currentIndex?: number;
  tolerancePercent?: number; // Default 0.15% (0.0015)
  atr?: number;
  minWickPenetrationPercent?: number;
}

/**
 * Returns Monday of the week for a given Asia/Kolkata date string YYYY-MM-DD.
 */
export function getAsiaKolkataMonday(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const dayOfWeek = d.getUTCDay(); // 0 is Sunday, 1 is Monday, ..., 6 is Saturday
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(d.getTime() + diffToMonday * 86400000);
  const mYear = monday.getUTCFullYear();
  const mMonth = String(monday.getUTCMonth() + 1).padStart(2, "0");
  const mDay = String(monday.getUTCDate()).padStart(2, "0");
  return `${mYear}-${mMonth}-${mDay}`;
}

/**
 * STEP 2: Implement Confirmed Swing Highs and Swing Lows (5-bar fractal pivots).
 */
export function findConfirmedPivots(
  candles: DailyCandle[],
  maxIndex?: number
): {
  highs: StructuralPivot[];
  lows: StructuralPivot[];
  all: StructuralPivot[];
  isAvailable: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];
  const endIdx = maxIndex !== undefined ? Math.min(maxIndex, candles.length - 1) : candles.length - 1;

  if (candles.length < 5 || endIdx < 4) {
    warnings.push(`Insufficient candles (${candles.length}) for 5-bar fractal pivot analysis (minimum 5 required).`);
    return { highs: [], lows: [], all: [], isAvailable: false, warnings };
  }

  const highs: StructuralPivot[] = [];
  const lows: StructuralPivot[] = [];
  const all: StructuralPivot[] = [];

  for (let i = 2; i <= endIdx - 2; i++) {
    const bar = candles[i];
    const prev1 = candles[i - 1];
    const prev2 = candles[i - 2];
    const next1 = candles[i + 1];
    const next2 = candles[i + 2];

    const isSwingHigh =
      bar.high > prev1.high &&
      bar.high > prev2.high &&
      bar.high > next1.high &&
      bar.high > next2.high;

    const isSwingLow =
      bar.low < prev1.low &&
      bar.low < prev2.low &&
      bar.low < next1.low &&
      bar.low < next2.low;

    if (isSwingHigh) {
      const pivot: StructuralPivot = {
        type: "SWING_HIGH",
        price: Number(bar.high.toFixed(2)),
        barIndex: i,
        date: bar.date,
        confirmedIndex: i + 2,
        confirmedDate: candles[i + 2].date,
      };
      highs.push(pivot);
      all.push(pivot);
    }

    if (isSwingLow) {
      const pivot: StructuralPivot = {
        type: "SWING_LOW",
        price: Number(bar.low.toFixed(2)),
        barIndex: i,
        date: bar.date,
        confirmedIndex: i + 2,
        confirmedDate: candles[i + 2].date,
      };
      lows.push(pivot);
      all.push(pivot);
    }
  }

  all.sort((a, b) => a.barIndex - b.barIndex);

  return { highs, lows, all, isAvailable: true, warnings };
}

/**
 * STEP 3: Implement PWH (Previous Week High) and PWL (Previous Week Low).
 */
export function calculatePreviousWeekLevels(
  candles: DailyCandle[],
  currentCandleIndex?: number
): WeeklyLevel | null {
  const evalIdx = currentCandleIndex !== undefined ? Math.min(currentCandleIndex, candles.length - 1) : candles.length - 1;
  if (evalIdx < 0 || candles.length === 0) return null;

  const currentCandle = candles[evalIdx];
  const currentWeekMonday = getAsiaKolkataMonday(currentCandle.date);

  const pastCandles = candles.slice(0, evalIdx + 1).filter((c) => {
    return getAsiaKolkataMonday(c.date) < currentWeekMonday;
  });

  if (pastCandles.length === 0) return null;

  let latestPriorMonday = "";
  for (const c of pastCandles) {
    const monday = getAsiaKolkataMonday(c.date);
    if (!latestPriorMonday || monday > latestPriorMonday) {
      latestPriorMonday = monday;
    }
  }

  const prevWeekCandles = pastCandles.filter((c) => getAsiaKolkataMonday(c.date) === latestPriorMonday);
  if (prevWeekCandles.length === 0) return null;

  const pwh = Math.max(...prevWeekCandles.map((c) => c.high));
  const pwl = Math.min(...prevWeekCandles.map((c) => c.low));

  const [y, m, d] = latestPriorMonday.split("-").map(Number);
  const monDate = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const friDate = new Date(monDate.getTime() + 4 * 86400000);
  const friStr = `${friDate.getUTCFullYear()}-${String(friDate.getUTCMonth() + 1).padStart(2, "0")}-${String(friDate.getUTCDate()).padStart(2, "0")}`;

  return {
    weekKey: `${latestPriorMonday}_WEEK`,
    weekStartDate: latestPriorMonday,
    weekEndDate: friStr,
    pwh: Number(pwh.toFixed(2)),
    pwl: Number(pwl.toFixed(2)),
    candleDates: prevWeekCandles.map((c) => c.date),
  };
}

/**
 * STEP 4: Implement EQH and EQL.
 */
export function detectEqualHighsAndLows(
  confirmedHighs: StructuralPivot[],
  confirmedLows: StructuralPivot[],
  options?: { tolerancePercent?: number; atr?: number }
): {
  equalHighs: EqualLevel[];
  equalLows: EqualLevel[];
} {
  // Normalize tolerancePercent:
  // If passed as 0.15 (meaning 0.15%), tolPercent = 0.15
  // If passed as 0.0015 (fractional 0.15%), tolPercent = 0.15
  // Default is 0.15%
  const rawTol = options?.tolerancePercent ?? 0.15;
  const tolPercent = rawTol > 0.01 ? rawTol : rawTol * 100;

  const equalHighs: EqualLevel[] = [];
  const equalLows: EqualLevel[] = [];

  for (let i = 0; i < confirmedHighs.length; i++) {
    for (let j = i + 1; j < confirmedHighs.length; j++) {
      const p1 = confirmedHighs[i];
      const p2 = confirmedHighs[j];

      if (Math.abs(p1.barIndex - p2.barIndex) < 2) continue;

      const higherPrice = Math.max(p1.price, p2.price);
      if (higherPrice <= 0) continue;
      const diff = Math.abs(p1.price - p2.price);
      const diffPct = Number(((diff / higherPrice) * 100).toFixed(4));

      if (diffPct <= tolPercent) {
        equalHighs.push({
          type: "EQH",
          price: Number(((p1.price + p2.price) / 2).toFixed(2)),
          pivot1: p1,
          pivot2: p2,
          tolerancePercent: Number(tolPercent.toFixed(3)),
          differencePercent: diffPct,
        });
      }
    }
  }

  for (let i = 0; i < confirmedLows.length; i++) {
    for (let j = i + 1; j < confirmedLows.length; j++) {
      const p1 = confirmedLows[i];
      const p2 = confirmedLows[j];

      if (Math.abs(p1.barIndex - p2.barIndex) < 2) continue;

      const basePrice = Math.max(p1.price, p2.price);
      if (basePrice <= 0) continue;
      const diff = Math.abs(p1.price - p2.price);
      const diffPct = Number(((diff / basePrice) * 100).toFixed(4));

      if (diffPct <= tolPercent) {
        equalLows.push({
          type: "EQL",
          price: Number(((p1.price + p2.price) / 2).toFixed(2)),
          pivot1: p1,
          pivot2: p2,
          tolerancePercent: Number(tolPercent.toFixed(3)),
          differencePercent: diffPct,
        });
      }
    }
  }

  return { equalHighs, equalLows };
}

/**
 * STEP 5: Implement Liquidity Sweeps.
 */
export function detectLiquiditySweeps(
  candles: DailyCandle[],
  evalIndex: number,
  levels: {
    swingHighs: StructuralPivot[];
    swingLows: StructuralPivot[];
    pwh: number | null;
    pwl: number | null;
    equalHighs: EqualLevel[];
    equalLows: EqualLevel[];
  },
  options?: { minWickPenetrationPercent?: number }
): LiquiditySweepEvent[] {
  const currentCandle = candles[evalIndex];
  if (!currentCandle) return [];

  const minPenetrationPct = options?.minWickPenetrationPercent ?? 0.0;
  const sweeps: LiquiditySweepEvent[] = [];

  for (const swl of levels.swingLows) {
    if (swl.confirmedIndex >= evalIndex) continue;

    if (currentCandle.low < swl.price && currentCandle.close > swl.price) {
      const penetration = swl.price - currentCandle.low;
      const penetrationPct = (penetration / swl.price) * 100;

      if (penetrationPct >= minPenetrationPct) {
        sweeps.push({
          direction: "BULLISH",
          sweptLevel: swl.price,
          levelType: "SWING_LOW",
          sweepCandleDate: currentCandle.date,
          sweepCandleIndex: evalIndex,
          wickPenetration: Number(penetration.toFixed(2)),
          wickPenetrationPercent: Number(penetrationPct.toFixed(3)),
          closeConfirmation: true,
          closingPrice: currentCandle.close,
          dataQuality: "HIGH_CONFIDENCE",
          description: `Bullish liquidity sweep: Pierced swing low ₹${swl.price} by ₹${penetration.toFixed(2)} (${penetrationPct.toFixed(2)}%) and closed back above at ₹${currentCandle.close}.`,
        });
      }
    }
  }

  if (levels.pwl !== null) {
    if (currentCandle.low < levels.pwl && currentCandle.close > levels.pwl) {
      const penetration = levels.pwl - currentCandle.low;
      const penetrationPct = (penetration / levels.pwl) * 100;

      if (penetrationPct >= minPenetrationPct) {
        sweeps.push({
          direction: "BULLISH",
          sweptLevel: levels.pwl,
          levelType: "PWL",
          sweepCandleDate: currentCandle.date,
          sweepCandleIndex: evalIndex,
          wickPenetration: Number(penetration.toFixed(2)),
          wickPenetrationPercent: Number(penetrationPct.toFixed(3)),
          closeConfirmation: true,
          closingPrice: currentCandle.close,
          dataQuality: "HIGH_CONFIDENCE",
          description: `Bullish liquidity sweep: Pierced Previous Week Low ₹${levels.pwl} by ₹${penetration.toFixed(2)} (${penetrationPct.toFixed(2)}%) and closed back above at ₹${currentCandle.close}.`,
        });
      }
    }
  }

  for (const eql of levels.equalLows) {
    const maxConfirmedIdx = Math.max(eql.pivot1.confirmedIndex, eql.pivot2.confirmedIndex);
    if (maxConfirmedIdx >= evalIndex) continue;

    if (currentCandle.low < eql.price && currentCandle.close > eql.price) {
      const penetration = eql.price - currentCandle.low;
      const penetrationPct = (penetration / eql.price) * 100;

      if (penetrationPct >= minPenetrationPct) {
        sweeps.push({
          direction: "BULLISH",
          sweptLevel: eql.price,
          levelType: "EQL",
          sweepCandleDate: currentCandle.date,
          sweepCandleIndex: evalIndex,
          wickPenetration: Number(penetration.toFixed(2)),
          wickPenetrationPercent: Number(penetrationPct.toFixed(3)),
          closeConfirmation: true,
          closingPrice: currentCandle.close,
          dataQuality: "HIGH_CONFIDENCE",
          description: `Bullish liquidity sweep: Pierced Equal Lows ₹${eql.price} by ₹${penetration.toFixed(2)} (${penetrationPct.toFixed(2)}%) and closed back above at ₹${currentCandle.close}.`,
        });
      }
    }
  }

  for (const swh of levels.swingHighs) {
    if (swh.confirmedIndex >= evalIndex) continue;

    if (currentCandle.high > swh.price && currentCandle.close < swh.price) {
      const penetration = currentCandle.high - swh.price;
      const penetrationPct = (penetration / swh.price) * 100;

      if (penetrationPct >= minPenetrationPct) {
        sweeps.push({
          direction: "BEARISH",
          sweptLevel: swh.price,
          levelType: "SWING_HIGH",
          sweepCandleDate: currentCandle.date,
          sweepCandleIndex: evalIndex,
          wickPenetration: Number(penetration.toFixed(2)),
          wickPenetrationPercent: Number(penetrationPct.toFixed(3)),
          closeConfirmation: true,
          closingPrice: currentCandle.close,
          dataQuality: "HIGH_CONFIDENCE",
          description: `Bearish liquidity sweep: Pierced swing high ₹${swh.price} by ₹${penetration.toFixed(2)} (${penetrationPct.toFixed(2)}%) and closed back below at ₹${currentCandle.close}.`,
        });
      }
    }
  }

  if (levels.pwh !== null) {
    if (currentCandle.high > levels.pwh && currentCandle.close < levels.pwh) {
      const penetration = currentCandle.high - levels.pwh;
      const penetrationPct = (penetration / levels.pwh) * 100;

      if (penetrationPct >= minPenetrationPct) {
        sweeps.push({
          direction: "BEARISH",
          sweptLevel: levels.pwh,
          levelType: "PWH",
          sweepCandleDate: currentCandle.date,
          sweepCandleIndex: evalIndex,
          wickPenetration: Number(penetration.toFixed(2)),
          wickPenetrationPercent: Number(penetrationPct.toFixed(3)),
          closeConfirmation: true,
          closingPrice: currentCandle.close,
          dataQuality: "HIGH_CONFIDENCE",
          description: `Bearish liquidity sweep: Pierced Previous Week High ₹${levels.pwh} by ₹${penetration.toFixed(2)} (${penetrationPct.toFixed(2)}%) and closed back below at ₹${currentCandle.close}.`,
        });
      }
    }
  }

  for (const eqh of levels.equalHighs) {
    const maxConfirmedIdx = Math.max(eqh.pivot1.confirmedIndex, eqh.pivot2.confirmedIndex);
    if (maxConfirmedIdx >= evalIndex) continue;

    if (currentCandle.high > eqh.price && currentCandle.close < eqh.price) {
      const penetration = currentCandle.high - eqh.price;
      const penetrationPct = (penetration / eqh.price) * 100;

      if (penetrationPct >= minPenetrationPct) {
        sweeps.push({
          direction: "BEARISH",
          sweptLevel: eqh.price,
          levelType: "EQH",
          sweepCandleDate: currentCandle.date,
          sweepCandleIndex: evalIndex,
          wickPenetration: Number(penetration.toFixed(2)),
          wickPenetrationPercent: Number(penetrationPct.toFixed(3)),
          closeConfirmation: true,
          closingPrice: currentCandle.close,
          dataQuality: "HIGH_CONFIDENCE",
          description: `Bearish liquidity sweep: Pierced Equal Highs ₹${eqh.price} by ₹${penetration.toFixed(2)} (${penetrationPct.toFixed(2)}%) and closed back below at ₹${currentCandle.close}.`,
        });
      }
    }
  }

  return sweeps;
}

/**
 * STEP 6: Implement CHOCH vs BOS.
 */
export function detectChoch(
  candles: DailyCandle[],
  confirmedHighs: StructuralPivot[],
  confirmedLows: StructuralPivot[],
  maxIndex?: number
): {
  recentChoch: ChochEvent | null;
  allChochs: ChochEvent[];
  currentMarketState: "BULLISH" | "BEARISH" | "NEUTRAL";
} {
  const evalIdx = maxIndex !== undefined ? Math.min(maxIndex, candles.length - 1) : candles.length - 1;
  const allChochs: ChochEvent[] = [];

  const activeHighs = confirmedHighs.filter((h) => h.confirmedIndex <= evalIdx);
  const activeLows = confirmedLows.filter((l) => l.confirmedIndex <= evalIdx);

  if (activeHighs.length === 0 || activeLows.length === 0) {
    return { recentChoch: null, allChochs: [], currentMarketState: "NEUTRAL" };
  }

  let currentTrend: "BULLISH" | "BEARISH" | "NEUTRAL" = "NEUTRAL";
  let lastStructuralHigh: StructuralPivot | null = null;
  let lastStructuralLow: StructuralPivot | null = null;

  for (let bar = 0; bar <= evalIdx; bar++) {
    const currentCandle = candles[bar];

    const newlyConfirmedHighs = activeHighs.filter((h) => h.confirmedIndex === bar);
    for (const h of newlyConfirmedHighs) {
      if (!lastStructuralHigh) {
        lastStructuralHigh = h;
      } else {
        if (h.price > lastStructuralHigh.price && currentTrend !== "BEARISH") {
          currentTrend = "BULLISH";
        } else if (h.price < lastStructuralHigh.price && currentTrend !== "BULLISH") {
          currentTrend = "BEARISH";
        }
        lastStructuralHigh = h;
      }
    }

    const newlyConfirmedLows = activeLows.filter((l) => l.confirmedIndex === bar);
    for (const l of newlyConfirmedLows) {
      if (!lastStructuralLow) {
        lastStructuralLow = l;
      } else {
        if (l.price > lastStructuralLow.price && currentTrend !== "BEARISH") {
          currentTrend = "BULLISH";
        } else if (l.price < lastStructuralLow.price && currentTrend !== "BULLISH") {
          currentTrend = "BEARISH";
        }
        lastStructuralLow = l;
      }
    }

    if (currentTrend === "BEARISH" && lastStructuralHigh) {
      if (currentCandle.close > lastStructuralHigh.price) {
        const choch: ChochEvent = {
          direction: "BULLISH",
          brokenLevel: lastStructuralHigh.price,
          brokenPivot: lastStructuralHigh,
          priorTrend: "BEARISH",
          breakCandleDate: currentCandle.date,
          breakCandleIndex: bar,
          confirmationPrice: currentCandle.close,
          description: `Bullish CHOCH confirmed: Candle closed at ₹${currentCandle.close} breaking above prior structural lower high ₹${lastStructuralHigh.price} (${lastStructuralHigh.date}). Trend transitioned from BEARISH to BULLISH.`,
        };
        allChochs.push(choch);
        currentTrend = "BULLISH";
      }
    } else if (currentTrend === "BULLISH" && lastStructuralLow) {
      if (currentCandle.close < lastStructuralLow.price) {
        const choch: ChochEvent = {
          direction: "BEARISH",
          brokenLevel: lastStructuralLow.price,
          brokenPivot: lastStructuralLow,
          priorTrend: "BULLISH",
          breakCandleDate: currentCandle.date,
          breakCandleIndex: bar,
          confirmationPrice: currentCandle.close,
          description: `Bearish CHOCH confirmed: Candle closed at ₹${currentCandle.close} breaking below prior structural higher low ₹${lastStructuralLow.price} (${lastStructuralLow.date}). Trend transitioned from BULLISH to BEARISH.`,
        };
        allChochs.push(choch);
        currentTrend = "BEARISH";
      }
    }
  }

  const recentChoch = allChochs.length > 0 ? allChochs[allChochs.length - 1] : null;

  return {
    recentChoch,
    allChochs,
    currentMarketState: currentTrend,
  };
}

/**
 * STEP 7: Comprehensive Market Structure & Liquidity Analysis.
 */
export function analyzeMarketStructure(
  candles: DailyCandle[],
  options?: MarketStructureOptions
): MarketStructureResult {
  const evalIdx = options?.currentIndex !== undefined
    ? Math.min(options.currentIndex, candles.length - 1)
    : candles.length - 1;

  if (candles.length < 5 || evalIdx < 4) {
    return {
      pivots: [],
      confirmedHighs: [],
      confirmedLows: [],
      pwh: null,
      pwl: null,
      previousWeekDetails: null,
      equalHighs: [],
      equalLows: [],
      recentLiquiditySweep: null,
      allLiquiditySweeps: [],
      recentChoch: null,
      allChochs: [],
      currentMarketState: "NEUTRAL",
      isAvailable: false,
      warnings: [`Insufficient history (${candles.length} candles). Minimum 5 candles required for market structure.`],
    };
  }

  const pivotResult = findConfirmedPivots(candles, evalIdx);
  const prevWeek = calculatePreviousWeekLevels(candles, evalIdx);
  const pwh = prevWeek ? prevWeek.pwh : null;
  const pwl = prevWeek ? prevWeek.pwl : null;

  const { equalHighs, equalLows } = detectEqualHighsAndLows(
    pivotResult.highs,
    pivotResult.lows,
    {
      tolerancePercent: options?.tolerancePercent,
      atr: options?.atr,
    }
  );

  const sweeps = detectLiquiditySweeps(
    candles,
    evalIdx,
    {
      swingHighs: pivotResult.highs,
      swingLows: pivotResult.lows,
      pwh,
      pwl,
      equalHighs,
      equalLows,
    },
    { minWickPenetrationPercent: options?.minWickPenetrationPercent }
  );

  const chochResult = detectChoch(
    candles,
    pivotResult.highs,
    pivotResult.lows,
    evalIdx
  );

  return {
    pivots: pivotResult.all,
    confirmedHighs: pivotResult.highs,
    confirmedLows: pivotResult.lows,
    pwh,
    pwl,
    previousWeekDetails: prevWeek,
    equalHighs,
    equalLows,
    recentLiquiditySweep: sweeps.length > 0 ? sweeps[sweeps.length - 1] : null,
    allLiquiditySweeps: sweeps,
    recentChoch: chochResult.recentChoch,
    allChochs: chochResult.allChochs,
    currentMarketState: chochResult.currentMarketState,
    isAvailable: true,
    warnings: pivotResult.warnings,
  };
}
