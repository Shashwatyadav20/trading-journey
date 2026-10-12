import { describe, it, expect } from "vitest";
import {
  calculateEMA,
  calculateRSI,
  calculateWilderRSI,
  calculateMACD,
  cleanAndValidateCandles,
  validateDailyCandles,
  isDailyCandleCompleted,
  getKolkataDateTime,
  isValidCandleOHLC,
  buildStockIndicatorProfile,
  evaluateStrategyA_Breakout,
  evaluateStrategyB_Pullback,
  evaluateStrategyG_TrendContinuation,
  evaluateAllStrategiesForStock,
  runHistoricalBacktest,
  DailyCandle,
} from "../swing/dailyStrategyScanner";

describe("Task 4 — Genuine EMA, Wilder RSI & Candle Validation Suite", () => {
  // ───────────────────────────────────────────────────────────────────────────
  // 1. GENUINE EMA CALCULATIONS WITH SMA SEED & RECURSIVE SMOOTHING
  // ───────────────────────────────────────────────────────────────────────────
  describe("1. Genuine EMA 20, 50, 200 Calculations against Known Formulas", () => {
    it("initializes EMA with exact SMA seed of the first 'period' observations", () => {
      // 5-period test array
      const values = [10, 20, 30, 40, 50, 60, 70];
      const period = 5;
      const ema = calculateEMA(values, period);

      // Indices 0..3 must be null (insufficient warm-up for seed)
      expect(ema[0]).toBeNull();
      expect(ema[1]).toBeNull();
      expect(ema[2]).toBeNull();
      expect(ema[3]).toBeNull();

      // Index 4 (period - 1) must be exactly SMA: (10+20+30+40+50)/5 = 30.0
      expect(ema[4]).toBeCloseTo(30.0, 5);

      // Index 5: alpha = 2/(5+1) = 1/3
      // EMA[5] = 60 * (1/3) + 30 * (2/3) = 20 + 20 = 40.0
      expect(ema[5]).toBeCloseTo(40.0, 5);

      // Index 6: EMA[6] = 70 * (1/3) + 40 * (2/3) = 23.3333 + 26.6667 = 50.0
      expect(ema[6]).toBeCloseTo(50.0, 5);
    });

    it("calculates genuine EMA 20 with 20-period SMA seed and alpha = 2/21", () => {
      // Constant sequence of 20 elements with price 100, then a jump to 110
      const values: number[] = new Array(20).fill(100);
      values.push(110); // index 20 (21st element)

      const ema = calculateEMA(values, 20);
      expect(ema.length).toBe(21);
      expect(ema[19]).toBeCloseTo(100.0, 5); // SMA seed of first 20 bars

      // alpha = 2 / 21 = ~0.095238
      // Expected EMA at index 20 = 110 * (2/21) + 100 * (19/21) = 100.95238
      const expected = 110 * (2 / 21) + 100 * (19 / 21);
      expect(ema[20]).toBeCloseTo(expected, 4);
    });

    it("calculates genuine EMA 50 with 50-period SMA seed and alpha = 2/51", () => {
      const values: number[] = new Array(50).fill(250);
      values.push(300);

      const ema = calculateEMA(values, 50);
      expect(ema[49]).toBeCloseTo(250.0, 5); // SMA seed

      const expected = 300 * (2 / 51) + 250 * (49 / 51);
      expect(ema[50]).toBeCloseTo(expected, 4);
    });

    it("calculates genuine EMA 200 with 200-period SMA seed and alpha = 2/201", () => {
      const values: number[] = new Array(200).fill(1500);
      values.push(1600); // 201st element

      const ema = calculateEMA(values, 200);
      expect(ema[199]).toBeCloseTo(1500.0, 5); // SMA seed

      const expected = 1600 * (2 / 201) + 1500 * (199 / 201);
      expect(ema[200]).toBeCloseTo(expected, 4);
    });

    it("returns array of nulls when values.length < period without fabricating values", () => {
      const values = [100, 102, 105, 107];
      const ema = calculateEMA(values, 20);
      expect(ema.length).toBe(4);
      expect(ema.every((v) => v === null)).toBe(true);

      const ema200 = calculateEMA(values, 200);
      expect(ema200.every((v) => v === null)).toBe(true);
    });

    it("never manufactures synthetic fallbacks (e.g. ema50 * 0.94 or ema50 * 0.92)", () => {
      // Stock with only 60 candles (cannot compute EMA 200)
      const candles: DailyCandle[] = [];
      for (let i = 0; i < 60; i++) {
        candles.push({
          date: `2026-01-${String(i + 1).padStart(2, "0")}`,
          open: 1000 + i,
          high: 1005 + i,
          low: 995 + i,
          close: 1002 + i,
          volume: 500000,
        });
      }

      const profile = buildStockIndicatorProfile("TEST", candles, { regularMarketPrice: 1062 });
      expect(profile.ema20).not.toBeNull();
      expect(profile.ema50).not.toBeNull();
      // EMA 200 must be explicitly null, NEVER synthetic fallback (like ema50 * 0.94)
      expect(profile.ema200).toBeNull();
      expect(profile.indicatorsAvailable.ema200).toBe(false);
      expect(profile.dataQuality?.has200EMA).toBe(false);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. WILDER'S SMOOTHED RSI & EDGE CASES
  // ───────────────────────────────────────────────────────────────────────────
  describe("2. Wilder's RSI Calculations & Edge Cases", () => {
    it("returns exactly 100.0 for strictly rising price sequences", () => {
      const closes: number[] = [];
      for (let i = 0; i < 20; i++) closes.push(100 + i * 5); // 100, 105, 110, ...
      const rsi = calculateRSI(closes, 14);
      expect(rsi).toBe(100.0);
    });

    it("returns exactly 0.0 for strictly falling price sequences", () => {
      const closes: number[] = [];
      for (let i = 0; i < 20; i++) closes.push(200 - i * 5); // 200, 195, 190, ...
      const rsi = calculateRSI(closes, 14);
      expect(rsi).toBe(0.0);
    });

    it("returns exactly 50.0 for completely flat price sequences (zero gains and zero losses)", () => {
      const closes: number[] = new Array(20).fill(500);
      const rsi = calculateRSI(closes, 14);
      expect(rsi).toBe(50.0);
    });

    it("returns null when closing prices count is less than period + 1", () => {
      const closes = [100, 102, 104, 101, 105]; // 5 closes < 15 needed for 14-period RSI
      expect(calculateRSI(closes, 14)).toBeNull();
    });

    it("matches independently verified Wilder's RSI smoothing on alternating sequences", () => {
      // 15 prices (14 changes): 7 gains of +2, 7 losses of -1
      // Initial avgGain = (7 * 2) / 14 = 1.0
      // Initial avgLoss = (7 * 1) / 14 = 0.5
      // RS = 1.0 / 0.5 = 2.0
      // Expected RSI = 100 - (100 / (1 + 2)) = 66.666... -> rounded to 66.7
      const closes = [
        100, 102, 101, 103, 102, 104, 103, 105, 104, 106, 105, 107, 106, 108, 107,
      ];
      expect(closes.length).toBe(15);
      const rsi = calculateWilderRSI(closes, 14);
      expect(rsi).toBe(66.7);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. CANDLE COMPLETION & ASIA/KOLKATA MARKET SESSION
  // ───────────────────────────────────────────────────────────────────────────
  describe("3. Daily Candle Completion & Asia/Kolkata Session Rules", () => {
    it("marks candles from past calendar dates as completed", () => {
      // Tuesday at 11:00 AM IST (market currently active)
      const simulatedNow = new Date("2026-10-13T05:30:00.000Z"); // 11:00 AM IST
      const kolkata = getKolkataDateTime(simulatedNow);
      expect(kolkata.dateStr).toBe("2026-10-13");
      expect(kolkata.hours).toBe(11);

      // Yesterday's candle is completed
      const checkPast = isDailyCandleCompleted("2026-10-12", simulatedNow);
      expect(checkPast.isCompleted).toBe(true);
    });

    it("marks today's daily candle as IN-PROGRESS when current IST time is before 15:30 on an open trading day", () => {
      // Tuesday at 12:45 PM IST (12:45 < 15:30)
      const simulatedNow = new Date("2026-10-13T07:15:00.000Z"); // 12:45 PM IST
      const checkToday = isDailyCandleCompleted("2026-10-13", simulatedNow);
      expect(checkToday.isCompleted).toBe(false);
      expect(checkToday.reason).toContain("In-progress intraday candle");
    });

    it("marks today's daily candle as COMPLETED when current IST time is after 15:30 on a trading day", () => {
      // Tuesday at 15:45 PM IST (scheduled run time, market closed at 15:30)
      const simulatedNow = new Date("2026-10-13T10:15:00.000Z"); // 15:45 PM IST
      const checkToday = isDailyCandleCompleted("2026-10-13", simulatedNow);
      expect(checkToday.isCompleted).toBe(true);
    });

    it("marks Friday's or weekend candles as COMPLETED on Saturday and Sunday", () => {
      // Saturday at 11:00 AM IST
      const simulatedSaturday = new Date("2026-10-17T05:30:00.000Z");
      const checkFriday = isDailyCandleCompleted("2026-10-16", simulatedSaturday);
      expect(checkFriday.isCompleted).toBe(true);
    });

    it("rejects future-dated candles as invalid clock skew", () => {
      const simulatedNow = new Date("2026-10-13T10:15:00.000Z");
      const checkFuture = isDailyCandleCompleted("2026-10-25", simulatedNow);
      expect(checkFuture.isCompleted).toBe(false);
      expect(checkFuture.reason).toContain("Future-dated");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. CANDLE NORMALIZATION, CLEANING, DEDUPLICATION & OHLC SANITY
  // ───────────────────────────────────────────────────────────────────────────
  describe("4. Candle Sanitization, Deduplication & OHLC Relationships", () => {
    it("sorts out-of-order candles into strict chronological order", () => {
      const unorderedCandles: DailyCandle[] = [
        { date: "2026-03-05", open: 100, high: 105, low: 98, close: 102, volume: 1000 },
        { date: "2026-03-01", open: 90, high: 95, low: 88, close: 92, volume: 1000 },
        { date: "2026-03-03", open: 95, high: 100, low: 93, close: 97, volume: 1000 },
      ];

      // Add dummy bars to satisfy min length
      for (let i = 6; i <= 20; i++) {
        unorderedCandles.push({
          date: `2026-03-${String(i).padStart(2, "0")}`,
          open: 100,
          high: 105,
          low: 95,
          close: 101,
          volume: 1000,
        });
      }

      const clean = cleanAndValidateCandles(unorderedCandles, { requireCompleted: false });
      expect(clean.valid).toBe(true);
      expect(clean.candles[0].date).toBe("2026-03-01");
      expect(clean.candles[1].date).toBe("2026-03-03");
      expect(clean.candles[2].date).toBe("2026-03-05");
    });

    it("deduplicates duplicate candles on the same date", () => {
      const duplicateCandles: DailyCandle[] = [
        { date: "2026-02-01", open: 100, high: 105, low: 95, close: 102, volume: 1000 },
        { date: "2026-02-01", open: 100, high: 107, low: 95, close: 106, volume: 1200 }, // duplicate
      ];
      for (let i = 2; i <= 16; i++) {
        duplicateCandles.push({
          date: `2026-02-${String(i).padStart(2, "0")}`,
          open: 100,
          high: 105,
          low: 95,
          close: 101,
          volume: 1000,
        });
      }

      const clean = cleanAndValidateCandles(duplicateCandles, { requireCompleted: false });
      expect(clean.discardedDuplicates).toBe(1);
      const feb1Bars = clean.candles.filter((c) => c.date === "2026-02-01");
      expect(feb1Bars.length).toBe(1);
      expect(feb1Bars[0].close).toBe(106); // kept the latest update
    });

    it("discards invalid OHLC relationships (High < Low, High < Close, Low > Close, non-positive)", () => {
      expect(
        isValidCandleOHLC({
          date: "2026-01-01",
          open: 100,
          high: 90,
          low: 110,
          close: 95,
          volume: 1000,
        }).valid
      ).toBe(false); // inverted High < Low

      expect(
        isValidCandleOHLC({
          date: "2026-01-01",
          open: 100,
          high: 102,
          low: 98,
          close: 105,
          volume: 1000,
        }).valid
      ).toBe(false); // High lower than Close

      expect(
        isValidCandleOHLC({
          date: "2026-01-01",
          open: 100,
          high: 105,
          low: 102,
          close: 98,
          volume: 1000,
        }).valid
      ).toBe(false); // Low higher than Close

      expect(
        isValidCandleOHLC({
          date: "2026-01-01",
          open: -10,
          high: 105,
          low: 98,
          close: 100,
          volume: 1000,
        }).valid
      ).toBe(false); // Non-positive price
    });

    it("excludes today's unconfirmed bar when requireCompleted is true and uses confirmed bar", () => {
      const simulatedNow = new Date("2026-10-13T06:30:00.000Z"); // 12:00 PM IST on Oct 13
      const candles: DailyCandle[] = [];
      for (let i = 1; i <= 20; i++) {
        candles.push({
          date: `2026-09-${String(i).padStart(2, "0")}`,
          open: 100,
          high: 105,
          low: 95,
          close: 101,
          volume: 1000,
        });
      }
      // Add in-progress bar for today Oct 13
      candles.push({
        date: "2026-10-13",
        open: 101,
        high: 115,
        low: 100,
        close: 114, // in-progress breakout
        volume: 5000,
      });

      const clean = cleanAndValidateCandles(candles, {
        requireCompleted: true,
        now: simulatedNow,
      });

      expect(clean.inProgressExcluded).toBe(true);
      expect(clean.candles[clean.candles.length - 1].date).not.toBe("2026-10-13");
      expect(clean.warnings.some((w) => w.includes("Excluded in-progress daily candle"))).toBe(true);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. SCANNER BEHAVIOR WHEN INDICATORS ARE UNAVAILABLE
  // ───────────────────────────────────────────────────────────────────────────
  describe("5. Scanner Diagnostics & Strategy Safety with Insufficient History", () => {
    it("explicitly marks Strategy B and Strategy G as unavailable when EMA 200 is unavailable (< 200 bars)", () => {
      // Stock with only 60 candles
      const shortCandles: DailyCandle[] = [];
      for (let i = 0; i < 60; i++) {
        shortCandles.push({
          date: `2026-01-${String((i % 25) + 1).padStart(2, "0")}`,
          open: 2000 + i * 5,
          high: 2010 + i * 5,
          low: 1990 + i * 5,
          close: 2005 + i * 5,
          volume: 100000,
        });
      }

      const profile = buildStockIndicatorProfile("SHORT_HISTORY", shortCandles);
      expect(profile.ema200).toBeNull();
      expect(profile.indicatorsAvailable.ema200).toBe(false);

      // Strategy B requires 200 EMA
      const resB = evaluateStrategyB_Pullback(profile);
      expect(resB.matched).toBe(false);
      expect(resB.warnings?.some((w) => w.includes("200 EMA"))).toBe(true);

      // Strategy G requires 200 EMA
      const resG = evaluateStrategyG_TrendContinuation(profile);
      expect(resG.matched).toBe(false);
      expect(resG.warnings?.some((w) => w.includes("200 EMA"))).toBe(true);
    });

    it("evaluates Strategy B and Strategy G normally when genuine 250+ candles exist", () => {
      // Stock with 260 candles in a healthy uptrend
      const longCandles: DailyCandle[] = [];
      let price = 500;
      for (let i = 0; i < 260; i++) {
        price += 1.5;
        longCandles.push({
          date: `2025-${String(Math.floor(i / 25) + 1).padStart(2, "0")}-${String((i % 25) + 1).padStart(2, "0")}`,
          open: price - 1,
          high: price + 4,
          low: price - 3,
          close: price,
          volume: 200000,
        });
      }

      const profile = buildStockIndicatorProfile("UPTREND_STOCK", longCandles);
      expect(profile.ema200).not.toBeNull();
      expect(profile.ema50).not.toBeNull();
      expect(profile.ema20).not.toBeNull();
      expect(profile.indicatorsAvailable.ema200).toBe(true);
      expect(profile.dataQuality?.has200EMA).toBe(true);
      expect(profile.dataQuality?.totalCandles).toBe(260);

      // Trend continuation alignment: Price > EMA20 > EMA50 > EMA200
      expect(profile.currentPrice).toBeGreaterThan(profile.ema20!);
      expect(profile.ema20!).toBeGreaterThan(profile.ema50!);
      expect(profile.ema50!).toBeGreaterThan(profile.ema200!);
    });

    it("does not fabricate any signal when no strategy criteria match", () => {
      // Stock in persistent downtrend with falling prices below all moving averages
      const downtrendCandles: DailyCandle[] = [];
      let p = 500;
      for (let i = 0; i < 220; i++) {
        p -= 1.0;
        downtrendCandles.push({
          date: `2025-${String(Math.floor(i / 25) + 1).padStart(2, "0")}-${String((i % 25) + 1).padStart(2, "0")}`,
          open: p + 1,
          high: p + 2,
          low: p - 1,
          close: p,
          volume: 20000,
        });
      }

      const profile = buildStockIndicatorProfile("DOWNTREND_STOCK", downtrendCandles);
      // Explicitly in downtrend below broken support
      profile.supportLevel = profile.currentPrice * 1.15; // broke support
      profile.resistanceLevel = profile.currentPrice * 1.30;
      profile.volumeMultiplier = 0.5; // low volume
      profile.relativeStrengthVsNifty = 35; // weak RS

      const opportunity = evaluateAllStrategiesForStock(profile);
      expect(opportunity).toBeNull();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6. BACKTEST LOOK-AHEAD BIAS AVOIDANCE
  // ───────────────────────────────────────────────────────────────────────────
  describe("6. Backtest Look-Ahead Bias & Temporal Walk-Forward Simulation", () => {
    it("ensures historical walk-forward simulation never uses future bars", () => {
      const candles: DailyCandle[] = [];
      let p = 1000;
      for (let i = 0; i < 80; i++) {
        p += 2;
        candles.push({
          date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
          open: p,
          high: p + 5,
          low: p - 5,
          close: p + 1,
          volume: 500000,
        });
      }

      const backtest = runHistoricalBacktest("HAL", "STRATEGY_A_BREAKOUT", candles);
      expect(backtest.symbol).toBe("HAL");
      expect(backtest.totalTrades).toBeGreaterThanOrEqual(0);

      // Verify that every recorded trade has entryDate <= exitDate
      for (const t of backtest.trades) {
        expect(new Date(t.entryDate).getTime()).toBeLessThanOrEqual(new Date(t.exitDate).getTime());
      }
    });
  });
});
