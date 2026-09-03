export interface Candle {
  time: number; // Unix timestamp in seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface SweepMarker {
  time: number;
  position: "aboveBar" | "belowBar";
  color: string;
  shape: "arrowDown" | "arrowUp" | "circle" | "square";
  text: string;
  size: number;
}

export interface LiquidityLevel {
  id: string;
  price: number;
  time: number;
  type: "SWING_HIGH" | "SWING_LOW" | "EQH" | "EQL" | "PWH" | "PWL";
  swept: boolean;
}

export interface StrategySignal {
  id: string;
  type: "BUY" | "SELL";
  label: string;
  time: number;
  dateStr: string;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  riskReward: number;
  sweepPrice: number;
}

const FRACTAL_PERIOD = 5;

/**
 * Checks if candle B (current) body completely engulfs candle A (prev) body in a bullish direction.
 */
function isBullishEngulfing(current: Candle, prev: Candle): boolean {
  const isPrevBearish = prev.close < prev.open;
  const isCurrentBullish = current.close > current.open;

  if (!isPrevBearish || !isCurrentBullish) return false;

  // Current body engulfs previous body
  return current.open <= prev.close && current.close >= prev.open;
}

/**
 * Checks if candle B (current) body completely engulfs candle A (prev) body in a bearish direction.
 */
function isBearishEngulfing(current: Candle, prev: Candle): boolean {
  const isPrevBullish = prev.close > prev.open;
  const isCurrentBearish = current.close < current.open;

  if (!isPrevBullish || !isCurrentBearish) return false;

  // Current body engulfs previous body
  return current.open >= prev.close && current.close <= prev.open;
}

export function detectLiquiditySweeps(data: Candle[]): {
  markers: SweepMarker[];
  levels: LiquidityLevel[];
  signals: StrategySignal[];
} {
  const levels: LiquidityLevel[] = [];
  const markers: SweepMarker[] = [];
  const signals: StrategySignal[] = [];

  // 1. Identify Liquidity Levels (Swing Highs and Swing Lows)
  for (let i = FRACTAL_PERIOD; i < data.length - FRACTAL_PERIOD; i++) {
    const current = data[i];

    // Check Swing High
    let isSwingHigh = true;
    for (let j = 1; j <= FRACTAL_PERIOD; j++) {
      if (data[i - j].high >= current.high || data[i + j].high >= current.high) {
        isSwingHigh = false;
        break;
      }
    }

    if (isSwingHigh) {
      levels.push({
        id: `HIGH_${current.time}`,
        price: current.high,
        time: current.time,
        type: "SWING_HIGH",
        swept: false,
      });
    }

    // Check Swing Low
    let isSwingLow = true;
    for (let j = 1; j <= FRACTAL_PERIOD; j++) {
      if (data[i - j].low <= current.low || data[i + j].low <= current.low) {
        isSwingLow = false;
        break;
      }
    }

    if (isSwingLow) {
      levels.push({
        id: `LOW_${current.time}`,
        price: current.low,
        time: current.time,
        type: "SWING_LOW",
        swept: false,
      });
    }
  }

  // 2. Sequential Detection: Sweep -> Engulfing -> Entry Signal
  for (let i = 1; i < data.length; i++) {
    const candle = data[i];

    for (let level of levels) {
      if (level.swept || level.time >= candle.time) continue;

      // --- BULLISH SEQUENCE ---
      if (level.type === "SWING_LOW" || level.type === "EQL" || level.type === "PWL") {
        if (candle.low < level.price && candle.close > level.price) {
          // STEP 1: Liquidity Sweep Detected
          level.swept = true;

          markers.push({
            time: candle.time,
            position: "belowBar",
            color: "#38bdf8", // Sky 400
            shape: "arrowUp",
            text: "Sweep ↓",
            size: 1,
          });

          // STEP 2 & 3: Check for Engulfing confirmation on current candle or next 2 candles
          let engulfIndex = -1;
          for (let k = 0; k <= 2 && i + k < data.length; k++) {
            const cIndex = i + k;
            if (cIndex > 0) {
              const currC = data[cIndex];
              const prevC = data[cIndex - 1];
              if (isBullishEngulfing(currC, prevC)) {
                engulfIndex = cIndex;
                break;
              }
            }
          }

          if (engulfIndex !== -1) {
            const engCandle = data[engulfIndex];

            // Mark STEP 2: Engulfing Marker
            markers.push({
              time: engCandle.time,
              position: "belowBar",
              color: "#34d399", // Emerald 400
              shape: "circle",
              text: "Bullish Engulfing",
              size: 1,
            });

            // STEP 3: Complete Entry Signal
            const entryPrice = engCandle.close;
            // Stop loss at minimum wick of sweep structure
            const structLow = Math.min(candle.low, engCandle.low);
            const stopLoss = structLow * 0.999; // slightly below lowest wick
            const risk = Math.max(entryPrice - stopLoss, entryPrice * 0.002);
            const takeProfit = entryPrice + risk * 2.5; // 1:2.5 R/R
            const riskReward = (takeProfit - entryPrice) / (entryPrice - stopLoss);

            const signalId = `SIG_BUY_${engCandle.time}`;
            signals.push({
              id: signalId,
              type: "BUY",
              label: "BUY — SWEEP + ENGULF",
              time: engCandle.time,
              dateStr: new Date(engCandle.time * 1000).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              }),
              entryPrice,
              stopLoss,
              takeProfit,
              riskReward,
              sweepPrice: level.price,
            });

            // Entry Signal Marker on chart
            markers.push({
              time: engCandle.time,
              position: "belowBar",
              color: "#10b981", // Emerald 500
              shape: "arrowUp",
              text: "BUY — SWEEP + ENGULF",
              size: 2,
            });
          }
        }
      }

      // --- BEARISH SEQUENCE ---
      if (level.type === "SWING_HIGH" || level.type === "EQH" || level.type === "PWH") {
        if (candle.high > level.price && candle.close < level.price) {
          // STEP 1: Liquidity Sweep Detected
          level.swept = true;

          markers.push({
            time: candle.time,
            position: "aboveBar",
            color: "#fb7185", // Rose 400
            shape: "arrowDown",
            text: "Sweep ↑",
            size: 1,
          });

          // STEP 2 & 3: Check for Engulfing confirmation
          let engulfIndex = -1;
          for (let k = 0; k <= 2 && i + k < data.length; k++) {
            const cIndex = i + k;
            if (cIndex > 0) {
              const currC = data[cIndex];
              const prevC = data[cIndex - 1];
              if (isBearishEngulfing(currC, prevC)) {
                engulfIndex = cIndex;
                break;
              }
            }
          }

          if (engulfIndex !== -1) {
            const engCandle = data[engulfIndex];

            // Mark STEP 2: Engulfing Marker
            markers.push({
              time: engCandle.time,
              position: "aboveBar",
              color: "#f43f5e", // Rose 500
              shape: "circle",
              text: "Bearish Engulfing",
              size: 1,
            });

            // STEP 3: Complete Entry Signal
            const entryPrice = engCandle.close;
            // Stop loss at highest wick of sweep structure
            const structHigh = Math.max(candle.high, engCandle.high);
            const stopLoss = structHigh * 1.001; // slightly above highest wick
            const risk = Math.max(stopLoss - entryPrice, entryPrice * 0.002);
            const takeProfit = entryPrice - risk * 2.5; // 1:2.5 R/R
            const riskReward = (entryPrice - takeProfit) / (stopLoss - entryPrice);

            const signalId = `SIG_SELL_${engCandle.time}`;
            signals.push({
              id: signalId,
              type: "SELL",
              label: "SELL — SWEEP + ENGULF",
              time: engCandle.time,
              dateStr: new Date(engCandle.time * 1000).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              }),
              entryPrice,
              stopLoss,
              takeProfit,
              riskReward,
              sweepPrice: level.price,
            });

            // Entry Signal Marker on chart
            markers.push({
              time: engCandle.time,
              position: "aboveBar",
              color: "#e11d48", // Rose 600
              shape: "arrowDown",
              text: "SELL — SWEEP + ENGULF",
              size: 2,
            });
          }
        }
      }
    }
  }

  // Sort markers chronologically
  markers.sort((a, b) => a.time - b.time);

  return {
    markers,
    levels: levels.filter((l) => !l.swept),
    signals,
  };
}

/**
 * Resolves the strategy tag based on active chart setups and order direction.
 */
export function resolveAutoStrategyTag(
  side: "LONG" | "SHORT",
  activeSignal?: StrategySignal | null,
  activeLevel?: LiquidityLevel | null
): string {
  // 1. Check Sweep + Engulfing signal
  if (activeSignal) {
    if (side === "LONG" && activeSignal.type === "BUY") {
      return "Liquidity Sweep + Bullish Engulfing";
    }
    if (side === "SHORT" && activeSignal.type === "SELL") {
      return "Liquidity Sweep + Bearish Engulfing";
    }
  }

  // 2. Check Specific Level Sweeps / Setups
  if (activeLevel) {
    if (activeLevel.type === "EQH" || activeLevel.type === "EQL") {
      return "EQH/EQL Liquidity";
    }
    if (activeLevel.type === "PWH" || activeLevel.type === "PWL") {
      return "PWH/PWL Liquidity Sweep";
    }
  }

  // 3. Check Order Block Retest or default Liquidity Sweep
  if (activeSignal) {
    return "Liquidity Sweep";
  }

  // 4. Default fallback when no valid active setup exists on chart
  return "Manual Trade";
}
