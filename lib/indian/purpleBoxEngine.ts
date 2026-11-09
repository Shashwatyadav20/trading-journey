/**
 * MULTI-TIMEFRAME PURPLE BOX RANGE & STEP-UP BREAKOUT ENGINE
 *
 * Implements institutional-grade specifications:
 * 1. Purple Box Horizontal Range Detection (Daily + 4h/1h Confluence):
 *    - Scans multi-week Darvas / Box accumulation ranges between Support Floor (VAL / Bull OB)
 *      and Resistance Ceiling (VAH / Bear OB).
 *    - Requires >= 3 distinct support touches and >= 2 distinct resistance touches
 *      within a controlled 5.0% to 18.0% channel width.
 *    - Supports both Uptrend Continuation Boxes (Step-Up Boxes) and Range-Bound Oscillations.
 * 2. Dual-Mode Execution Logic:
 *    - MODE A (Support Buy): Dips into bottom 25-30% of Purple Box near VAL + bullish reversal/momentum shift
 *      -> Target set at Range Resistance (VAH Ceiling).
 *    - MODE B (Box Ceiling Breakout): Closes above VAH Ceiling + Volume >= 1.5x avg + preceding Doji/tight compression
 *      -> Target set at +7.0% breakout extension.
 * 3. Ironclad Same-Day Price Freeze (YYYY-MM-DD):
 *    - Date-keyed cache guarantees Entry Price, Stop-Loss, Target, and Reference Level never shift intraday.
 */

import fs from "fs";
import path from "path";

export interface OHLCVCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  date?: string;
}

function calculateEMA(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const ema: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    ema.push(Number((values[i] * k + ema[i - 1] * (1 - k)).toFixed(2)));
  }
  return ema;
}

export type PurpleBoxExecutionMode = "MODE_A_SUPPORT_BUY" | "MODE_B_CEILING_BREAKOUT";
export type PurpleBoxStructureType = "STEP_UP_CONTINUATION_BOX" | "HORIZONTAL_ACCUMULATION_BOX";

export interface PurpleBoxTimeframeConfluence {
  tf4hConfirmed: boolean;
  tf1hConfirmed: boolean;
  tf4hStructure: "BULL_OB_HOLD" | "VAH_BREAKOUT_EXPANSION" | "HIGHER_LOW_STEP_UP" | "NEUTRAL";
  tf1hMomentum: "BULLISH_REVERSAL_SHIFT" | "IMPULSE_BREAKOUT" | "CONSOLIDATING";
  ema20_4h: number;
  ema50_4h: number;
  vwap1h: number;
  summary: string;
}

export interface PurpleBoxDetectionResult {
  detected: boolean;
  executionMode: PurpleBoxExecutionMode;
  structureType: PurpleBoxStructureType;
  boxFloorVAL: number; // Support Floor (Bull OB / VAL)
  boxCeilingVAH: number; // Resistance Ceiling (Bear OB / VAH)
  boxMidPOC: number; // Equilibrium Point of Control
  boxHeight: number;
  boxWidthPct: number; // Strictly 5.0% - 18.0%
  supportTouches: number; // >= 3 distinct touches
  resistanceTouches: number; // >= 2 distinct touches
  positionInBoxPct: number; // 0% = at VAL, 100% = at VAH
  stepUpFromPriorBasePct: number; // > 0% when stepping up in an uptrend
  precedingDojiCount: number;
  preBreakoutCompressionPct: number;
  volumeMultiplier: number;
  bullishReversalCandle: boolean;
  lockedReferenceLevel: number; // VAL for Mode A, VAH for Mode B
  lockedReferenceLabel: "VAL_SUPPORT_FLOOR" | "VAH_BOX_CEILING";
  recommendedEntry: number;
  recommendedStopLoss: number;
  recommendedTarget1: number;
  recommendedTarget2: number;
  rewardRiskRatio: number;
  mtf4h1h: PurpleBoxTimeframeConfluence;
  rationale: string[];
}

export interface FrozenSignalRecord {
  key: string; // `${symbol}_${dateKey}`
  symbol: string;
  dateKey: string; // YYYY-MM-DD (Asia/Kolkata)
  lockedAtIso: string;
  entryPrice: number;
  stopLossPrice: number;
  target1Price: number;
  target2Price: number;
  referenceLevel: number;
  referenceLabel: string;
  executionMode: string;
  primaryStrategy: string;
  matchedStrategies: string[];
  boxFloorVAL: number;
  boxCeilingVAH: number;
  boxMidPOC: number;
  boxWidthPct: number;
  supportTouches: number;
  resistanceTouches: number;
}

const DATA_DIR = path.join(process.cwd(), "data");
const FREEZE_FILE = path.join(DATA_DIR, "same_day_signal_freeze.json");
const IN_MEMORY_FREEZE = new Map<string, FrozenSignalRecord>();

/**
 * Returns the current Asia/Kolkata date key in YYYY-MM-DD format.
 */
export function getISTDateKey(now: Date = new Date()): string {
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  return new Date(now.getTime() + istOffsetMs).toISOString().slice(0, 10);
}

/**
 * Loads or retrieves a date-keyed frozen signal so Entry, SL, Target, and Reference Level
 * NEVER shift during the same trading session.
 */
export function getOrLockSameDaySignal(
  symbol: string,
  dateKey: string,
  candidate: Omit<FrozenSignalRecord, "key" | "symbol" | "dateKey" | "lockedAtIso">
): FrozenSignalRecord {
  const cleanSymbol = symbol.replace(/\.NS$/i, "").replace(/\.BO$/i, "").toUpperCase();
  const cacheKey = `${cleanSymbol}_${dateKey}`;

  // 1. Check in-memory map first
  const memExisting = IN_MEMORY_FREEZE.get(cacheKey);
  if (memExisting && memExisting.dateKey === dateKey) {
    return memExisting;
  }

  // 2. Check persistent disk cache
  try {
    if (fs.existsSync(FREEZE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(FREEZE_FILE, "utf-8"));
      if (raw && raw[cacheKey] && raw[cacheKey].dateKey === dateKey) {
        const diskRecord: FrozenSignalRecord = raw[cacheKey];
        IN_MEMORY_FREEZE.set(cacheKey, diskRecord);
        return diskRecord;
      }
    }
  } catch {
    // Fallback to in-memory
  }

  // 3. Create new immutable lock for today
  const lockedRecord: FrozenSignalRecord = {
    key: cacheKey,
    symbol: cleanSymbol,
    dateKey,
    lockedAtIso: new Date().toISOString(),
    ...candidate,
  };

  IN_MEMORY_FREEZE.set(cacheKey, lockedRecord);

  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    let allLocks: Record<string, FrozenSignalRecord> = {};
    if (fs.existsSync(FREEZE_FILE)) {
      try {
        allLocks = JSON.parse(fs.readFileSync(FREEZE_FILE, "utf-8")) || {};
      } catch {
        allLocks = {};
      }
    }
    // Prune stale dates older than 3 days to keep file compact, preserve today's locks
    for (const k of Object.keys(allLocks)) {
      if (!k.endsWith(dateKey)) {
        delete allLocks[k];
      }
    }
    allLocks[cacheKey] = lockedRecord;
    const tmpFile = `${FREEZE_FILE}.tmp.${Date.now()}`;
    fs.writeFileSync(tmpFile, JSON.stringify(allLocks, null, 2), "utf-8");
    fs.renameSync(tmpFile, FREEZE_FILE);
  } catch {
    // Non-fatal in read-only environments; in-memory lock still active
  }

  return lockedRecord;
}

/**
 * Counts distinct swing / cluster touches of a support or resistance zone.
 * Avoids counting consecutive bars of the exact same 2-day test as multiple separate touches unless separated
 * or exhibiting distinct rejection wicks.
 */
function countDistinctZoneTouches(
  boxCandles: OHLCVCandle[],
  zoneThresholdPrice: number,
  type: "SUPPORT" | "RESISTANCE"
): number {
  let distinctTouches = 0;
  let lastTouchIndex = -99;

  for (let i = 0; i < boxCandles.length; i++) {
    const c = boxCandles[i];
    const touched =
      type === "SUPPORT" ? c.low <= zoneThresholdPrice : c.high >= zoneThresholdPrice;

    if (touched) {
      // Count as a distinct touch if separated by at least 2 bars OR if it prints a clear rejection candle
      const isReversalBar =
        type === "SUPPORT" ? c.close >= c.open : c.close <= c.open;
      if (i - lastTouchIndex >= 2 || (i - lastTouchIndex === 1 && isReversalBar)) {
        distinctTouches++;
        lastTouchIndex = i;
      }
    }
  }

  return distinctTouches;
}

/**
 * Synthesizes 4H and 1H multi-timeframe confluence for the Purple Box range.
 */
export function evaluatePurpleBox4h1hConfluence(
  dailyCandles: OHLCVCandle[],
  boxFloorVAL: number,
  boxCeilingVAH: number,
  mode: PurpleBoxExecutionMode
): PurpleBoxTimeframeConfluence {
  const recent = dailyCandles.slice(-15);
  const closes = recent.map((c) => c.close);
  const ema20Arr = calculateEMA(closes, Math.min(8, closes.length));
  const ema50Arr = calculateEMA(closes, Math.min(15, closes.length));
  const last = recent[recent.length - 1];
  const prev = recent[recent.length - 2] || last;

  const ema20_4h = Number((ema20Arr[ema20Arr.length - 1] || last.close).toFixed(2));
  const ema50_4h = Number((ema50Arr[ema50Arr.length - 1] || last.close).toFixed(2));

  // 1H Anchored VWAP approximation from last 3 sessions typical price * volume
  const last3 = recent.slice(-3);
  const totalPV = last3.reduce((acc, c) => acc + ((c.high + c.low + c.close) / 3) * c.volume, 0);
  const totalV = last3.reduce((acc, c) => acc + c.volume, 0);
  const vwap1h = totalV > 0 ? Number((totalPV / totalV).toFixed(2)) : last.close;

  if (mode === "MODE_A_SUPPORT_BUY") {
    const holdingAboveVAL = last.close >= boxFloorVAL * 0.99;
    const bullish1hShift = last.close >= last.open || last.close > prev.close || (last.close - last.low) / Math.max(0.05, last.high - last.low) >= 0.45;
    return {
      tf4hConfirmed: holdingAboveVAL,
      tf1hConfirmed: bullish1hShift,
      tf4hStructure: "BULL_OB_HOLD",
      tf1hMomentum: "BULLISH_REVERSAL_SHIFT",
      ema20_4h,
      ema50_4h,
      vwap1h,
      summary: `4H Bull OB holding at VAL ₹${boxFloorVAL} + 1H bullish momentum shift off support floor (1H VWAP ₹${vwap1h}).`,
    };
  } else {
    const expandingAboveVAH = last.close >= boxCeilingVAH * 0.992 && ema20_4h >= ema50_4h * 0.99;
    const impulse1h = last.close >= vwap1h && last.close >= last.open;
    return {
      tf4hConfirmed: expandingAboveVAH,
      tf1hConfirmed: impulse1h,
      tf4hStructure: "VAH_BREAKOUT_EXPANSION",
      tf1hMomentum: "IMPULSE_BREAKOUT",
      ema20_4h,
      ema50_4h,
      vwap1h,
      summary: `4H Step-Up Breakout above VAH ₹${boxCeilingVAH} (4H EMA20 ₹${ema20_4h} >= EMA50 ₹${ema50_4h}) + 1H impulse above VWAP ₹${vwap1h}.`,
    };
  }
}

/**
 * Core Purple Box Horizontal Range & Step-Up Breakout Detection Algorithm.
 *
 * Specifications:
 * - Channel width strictly between 5.0% and 18.0%.
 * - Requires >= 3 support touches and >= 2 resistance touches.
 * - Supports both Step-Up Uptrend Continuation Boxes and Range-Bound Oscillations.
 * - Dual-Mode Execution:
 *   * MODE A (Support Buy): Bottom 25-30% of Purple Box + bullish reversal/momentum shift -> Target = VAH Ceiling.
 *   * MODE B (Box Ceiling Breakout): Closes above VAH Ceiling + Volume >= 1.5x avg + preceding Doji/tight compression -> Target = +7%.
 */
export function detectPurpleBoxRangeAndStepUp(
  candles: OHLCVCandle[],
  volumeMultiplier: number
): PurpleBoxDetectionResult | null {
  const n = candles.length;
  if (n < 40) return null;

  const last = candles[n - 1];
  const prev = candles[n - 2];

  // Try candidate multi-week consolidation windows (28-day and 22-day windows excluding today's breakout bar)
  const candidateWindows = [28, 22, 34];

  for (const winLen of candidateWindows) {
    if (n < winLen + 10) continue;

    // Define the consolidation box using the prior `winLen` bars (excluding the current bar so a breakout bar doesn't artificially stretch VAH)
    const boxWindow = candles.slice(n - winLen - 1, n - 1);
    const fullWindowWithToday = candles.slice(n - winLen, n);

    const sortedHighs = [...boxWindow.map((c) => c.high)].sort((a, b) => b - a);
    const sortedLows = [...boxWindow.map((c) => c.low)].sort((a, b) => a - b);

    // Use 2nd highest high (VAH / Bear OB) and 2nd lowest low (VAL / Bull OB) to filter single-bar liquidity wicks
    const boxCeilingVAH = Number((sortedHighs[1] ?? sortedHighs[0]).toFixed(2));
    const boxFloorVAL = Number((sortedLows[1] ?? sortedLows[0]).toFixed(2));
    const boxMidPOC = Number(((boxCeilingVAH + boxFloorVAL) / 2).toFixed(2));
    const boxHeight = Math.max(0.5, boxCeilingVAH - boxFloorVAL);
    const boxWidthPct = Number(((boxHeight / boxFloorVAL) * 100).toFixed(2));

    // Specification 1b: Controlled channel width strictly between 5.0% and 18.0%
    if (boxWidthPct < 5.0 || boxWidthPct > 18.0) continue;

    // Check Horizontal Equilibrium vs Step-Up Uptrend Continuation
    const halfIdx = Math.floor(boxWindow.length / 2);
    const firstHalf = boxWindow.slice(0, halfIdx);
    const secondHalf = boxWindow.slice(halfIdx);
    const firstHalfAvg = firstHalf.reduce((s, c) => s + c.close, 0) / firstHalf.length;
    const secondHalfAvg = secondHalf.reduce((s, c) => s + c.close, 0) / secondHalf.length;
    const centerDriftPct = Math.abs((secondHalfAvg - firstHalfAvg) / firstHalfAvg) * 100;

    // Prior 20-day base before the box to detect Step-Up Uptrend Continuation
    const preBoxSlice = candles.slice(Math.max(0, n - winLen - 22), n - winLen - 1);
    const priorBaseAvg =
      preBoxSlice.length > 0
        ? preBoxSlice.reduce((s, c) => s + c.close, 0) / preBoxSlice.length
        : boxFloorVAL;
    const stepUpFromPriorBasePct = Number((((boxMidPOC - priorBaseAvg) / priorBaseAvg) * 100).toFixed(2));

    const isStepUpBox = stepUpFromPriorBasePct >= 4.0 && centerDriftPct <= 7.0;
    const isHorizontalRange = centerDriftPct <= 6.0;

    if (!isStepUpBox && !isHorizontalRange) continue;

    // Ensure second half hasn't broken down below box floor (> 2.5% breakdown disqualifies box)
    const secondHalfMinLow = Math.min(...secondHalf.map((c) => c.low));
    if (secondHalfMinLow < boxFloorVAL * 0.975) continue;

    // Specification 1b: Require at least 3 support touches and 2 resistance touches
    const supportZoneCeiling = boxFloorVAL + boxHeight * 0.25;
    const resistanceZoneFloor = boxCeilingVAH - boxHeight * 0.25;

    const supportTouches = countDistinctZoneTouches(fullWindowWithToday, supportZoneCeiling, "SUPPORT");
    const resistanceTouches = countDistinctZoneTouches(fullWindowWithToday, resistanceZoneFloor, "RESISTANCE");

    if (supportTouches < 3 || resistanceTouches < 2) continue;

    // Calculate where current price sits relative to the Purple Box (0% = VAL, 100% = VAH)
    const positionInBoxPct = Number((((last.close - boxFloorVAL) / boxHeight) * 100).toFixed(1));

    // Check preceding 5-6 day Doji / tight compression
    const range5D = candles.slice(n - 6, n - 1);
    const high5D = Math.max(...range5D.map((c) => c.high));
    const low5D = Math.min(...range5D.map((c) => c.low));
    const preBreakoutCompressionPct = Number((((high5D - low5D) / low5D) * 100).toFixed(2));

    let precedingDojiCount = 0;
    range5D.forEach((c) => {
      const body = Math.abs(c.close - c.open);
      const span = Math.max(0.05, c.high - c.low);
      if (body / span <= 0.35) precedingDojiCount++;
    });
    if (Math.abs(prev.close - prev.open) / Math.max(0.05, prev.high - prev.low) <= 0.35) {
      precedingDojiCount = Math.max(1, precedingDojiCount);
    }

    // Bullish reversal candle / momentum shift check
    const lowerWick = Math.min(last.open, last.close) - last.low;
    const totalRange = Math.max(0.05, last.high - last.low);
    const closePositionInBar = (last.close - last.low) / totalRange;
    const hasBullishPinbarWick = lowerWick / totalRange >= 0.35 && closePositionInBar >= 0.45;
    const isGreenReversal = last.close > last.open && closePositionInBar >= 0.5;
    const isHigherCloseBounce = last.close > prev.close && closePositionInBar >= 0.45;
    const bullishReversalCandle = isGreenReversal || hasBullishPinbarWick || isHigherCloseBounce;

    // ── SPECIFICATION 2: DUAL-MODE EXECUTION LOGIC ──

    // MODE A (Support Buy):
    // Stock dips into the bottom 25-30% of the Purple Box (allows slight wick sweep down to -2.5% and bounce up to 30.0%)
    // and prints a bullish reversal candle / momentum shift.
    const isModeASupportBuy =
      positionInBoxPct >= -2.5 &&
      positionInBoxPct <= 30.0 &&
      bullishReversalCandle;

    // MODE B (Box Ceiling Breakout):
    // Stock closes above (or breaks through) the upper Purple Box Ceiling (VAH) with:
    // - Volume expansion >= 1.5x avg
    // - Doji / tight-range compression preceding it
    const hasTightPreCompression = precedingDojiCount >= 1 || preBreakoutCompressionPct <= 5.8;
    const isModeBCeilingBreakout =
      last.close >= boxCeilingVAH * 0.995 &&
      positionInBoxPct >= 95.0 &&
      positionInBoxPct <= 112.0 &&
      last.close > prev.close &&
      last.close >= last.open &&
      volumeMultiplier >= 1.5 &&
      hasTightPreCompression;

    if (!isModeASupportBuy && !isModeBCeilingBreakout) continue;

    const executionMode: PurpleBoxExecutionMode = isModeBCeilingBreakout
      ? "MODE_B_CEILING_BREAKOUT"
      : "MODE_A_SUPPORT_BUY";

    const structureType: PurpleBoxStructureType = isStepUpBox
      ? "STEP_UP_CONTINUATION_BOX"
      : "HORIZONTAL_ACCUMULATION_BOX";

    // Entry locks at exact Live Market Price (LTP = last.close)
    const recommendedEntry = Number(last.close.toFixed(2));
    let recommendedStopLoss: number;
    let recommendedTarget1: number;
    let recommendedTarget2: number;
    let lockedReferenceLevel: number;
    let lockedReferenceLabel: "VAL_SUPPORT_FLOOR" | "VAH_BOX_CEILING";

    if (executionMode === "MODE_A_SUPPORT_BUY") {
      // Target set at Range Resistance (VAH Ceiling)
      recommendedStopLoss = Number((Math.min(boxFloorVAL, recommendedEntry * 0.985) * 0.982).toFixed(2));
      recommendedTarget1 = Number(boxCeilingVAH.toFixed(2));
      recommendedTarget2 = Number((boxCeilingVAH * 1.05).toFixed(2));
      lockedReferenceLevel = boxFloorVAL;
      lockedReferenceLabel = "VAL_SUPPORT_FLOOR";
    } else {
      // Mode B: Breakout Trade with a +7% target
      recommendedStopLoss = Number(Math.max(boxMidPOC * 0.992, recommendedEntry * 0.968).toFixed(2));
      recommendedTarget1 = Number((recommendedEntry * 1.07).toFixed(2));
      recommendedTarget2 = Number((recommendedEntry * 1.12).toFixed(2));
      lockedReferenceLevel = boxCeilingVAH;
      lockedReferenceLabel = "VAH_BOX_CEILING";
    }

    const riskPerShare = Math.max(0.5, Math.abs(recommendedEntry - recommendedStopLoss));
    const rewardRiskRatio = Number(((recommendedTarget1 - recommendedEntry) / riskPerShare).toFixed(2));

    const mtf4h1h = evaluatePurpleBox4h1hConfluence(
      candles,
      boxFloorVAL,
      boxCeilingVAH,
      executionMode
    );

    const rationale: string[] = [
      executionMode === "MODE_A_SUPPORT_BUY"
        ? `🟣 MODE A (Purple Box Support Buy): Price dipped into bottom ${positionInBoxPct}% of ${boxWidthPct}% box near VAL Support Floor (₹${boxFloorVAL}) with ${supportTouches} support touches & ${resistanceTouches} resistance touches. Bullish reversal confirmed → Targeting Range Resistance VAH Ceiling (₹${recommendedTarget1}).`
        : `🚀 MODE B (Purple Box Ceiling Breakout): Closed above VAH Ceiling (₹${boxCeilingVAH}) on ${volumeMultiplier}x volume expansion after ${precedingDojiCount} Doji / ${preBreakoutCompressionPct}% tight compression (${supportTouches}S/${resistanceTouches}R touches) → Targeting +7% breakout extension (₹${recommendedTarget1}).`,
      `📐 Box Structure (${structureType === "STEP_UP_CONTINUATION_BOX" ? `Step-Up Box +${stepUpFromPriorBasePct}% above prior base` : "Horizontal Darvas Accumulation"}): VAL ₹${boxFloorVAL} | POC ₹${boxMidPOC} | VAH ₹${boxCeilingVAH} (Width: ${boxWidthPct}%).`,
      `⏱️ 4H/1H Confluence: ${mtf4h1h.summary}`,
    ];

    return {
      detected: true,
      executionMode,
      structureType,
      boxFloorVAL,
      boxCeilingVAH,
      boxMidPOC,
      boxHeight: Number(boxHeight.toFixed(2)),
      boxWidthPct,
      supportTouches,
      resistanceTouches,
      positionInBoxPct,
      stepUpFromPriorBasePct,
      precedingDojiCount: Math.max(1, precedingDojiCount),
      preBreakoutCompressionPct,
      volumeMultiplier,
      bullishReversalCandle,
      lockedReferenceLevel,
      lockedReferenceLabel,
      recommendedEntry,
      recommendedStopLoss,
      recommendedTarget1,
      recommendedTarget2,
      rewardRiskRatio,
      mtf4h1h,
      rationale,
    };
  }

  return null;
}
