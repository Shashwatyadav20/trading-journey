import { describe, it, expect } from "vitest";
import {
  findConfirmedPivots,
  calculatePreviousWeekLevels,
  detectEqualHighsAndLows,
  detectLiquiditySweeps,
  detectChoch,
  analyzeMarketStructure,
  getAsiaKolkataMonday,
  StructuralPivot,
} from "../swing/marketStructure";
import {
  DailyCandle,
  buildStockIndicatorProfile,
  evaluateAllStrategiesForStock,
  evaluateStrategyA_Breakout,
  evaluateStrategyB_Pullback,
  evaluateStrategyG_TrendContinuation,
} from "../swing/dailyStrategyScanner";
import { SwingTradingEngine } from "../swing/SwingTradingEngine";
import { DailyScanPersistenceService } from "../../db/DailyScanPersistenceService";

describe("TASK 5: Market Structure, Liquidity Sweeps, and CHOCH for Indian Cash Stocks", () => {
  // Helper to generate synthetic deterministic candles
  function makeCandles(
    bars: { date: string; open: number; high: number; low: number; close: number; volume?: number }[]
  ): DailyCandle[] {
    return bars.map((b) => ({
      date: b.date,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume ?? 100000,
    }));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 1. FIVE-BAR FRACTAL SWING HIGHS AND SWING LOWS
  // ───────────────────────────────────────────────────────────────────────────
  describe("1. Five-Bar Fractal Swing Highs and Lows", () => {
    it("correctly identifies confirmed 5-bar pivot high and pivot low", () => {
      // Bar 2 is peak (high 110 > 100, 102, 105, 101)
      // Bar 5 is trough (low 85 < 98, 92, 90, 95)
      const candles = makeCandles([
        { date: "2026-10-01", open: 100, high: 100, low: 95, close: 98 },
        { date: "2026-10-02", open: 98, high: 102, low: 96, close: 101 },
        { date: "2026-10-05", open: 102, high: 110, low: 100, close: 108 }, // Pivot High at idx 2
        { date: "2026-10-06", open: 107, high: 105, low: 98, close: 100 },
        { date: "2026-10-07", open: 100, high: 101, low: 92, close: 93 }, // Confirms bar 2 as Pivot High
        { date: "2026-10-08", open: 93, high: 96, low: 85, close: 88 }, // Pivot Low at idx 5
        { date: "2026-10-09", open: 88, high: 93, low: 90, close: 92 },
        { date: "2026-10-12", open: 92, high: 97, low: 95, close: 96 }, // Confirms bar 5 as Pivot Low
      ]);

      const result = findConfirmedPivots(candles);
      expect(result.isAvailable).toBe(true);
      expect(result.highs.length).toBe(1);
      expect(result.highs[0].price).toBe(110);
      expect(result.highs[0].barIndex).toBe(2);
      expect(result.highs[0].date).toBe("2026-10-05");
      expect(result.highs[0].confirmedIndex).toBe(4);
      expect(result.highs[0].confirmedDate).toBe("2026-10-07");

      expect(result.lows.length).toBe(1);
      expect(result.lows[0].price).toBe(85);
      expect(result.lows[0].barIndex).toBe(5);
      expect(result.lows[0].date).toBe("2026-10-08");
      expect(result.lows[0].confirmedIndex).toBe(7);
      expect(result.lows[0].confirmedDate).toBe("2026-10-12");
    });

    it("strictly handles equal highs by rejecting non-apex equal bars", () => {
      // Bar 2 has high 110, Bar 3 also has high 110 -> neither is strictly greater than neighbors
      const candles = makeCandles([
        { date: "2026-10-01", open: 100, high: 100, low: 95, close: 98 },
        { date: "2026-10-02", open: 98, high: 102, low: 96, close: 101 },
        { date: "2026-10-05", open: 102, high: 110, low: 100, close: 108 },
        { date: "2026-10-06", open: 107, high: 110, low: 98, close: 100 },
        { date: "2026-10-07", open: 100, high: 101, low: 92, close: 93 },
        { date: "2026-10-08", open: 93, high: 96, low: 90, close: 92 },
      ]);

      const result = findConfirmedPivots(candles);
      expect(result.highs.length).toBe(0); // Equal highs do not form a strict 5-bar apex
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. EQUAL-HIGH AND EQUAL-LOW TOLERANCE BOUNDARIES
  // ───────────────────────────────────────────────────────────────────────────
  describe("2. Equal Highs (EQH) and Equal Lows (EQL)", () => {
    it("detects EQH when two confirmed pivots are within 0.15% tolerance", () => {
      const p1: StructuralPivot = {
        type: "SWING_HIGH",
        price: 1000.0,
        barIndex: 2,
        date: "2026-09-10",
        confirmedIndex: 4,
        confirmedDate: "2026-09-12",
      };
      const p2: StructuralPivot = {
        type: "SWING_HIGH",
        price: 1001.2, // diff = 1.2 / 1001.2 = 0.119% <= 0.15%
        barIndex: 8,
        date: "2026-09-22",
        confirmedIndex: 10,
        confirmedDate: "2026-09-24",
      };

      const result = detectEqualHighsAndLows([p1, p2], []);
      expect(result.equalHighs.length).toBe(1);
      expect(result.equalHighs[0].type).toBe("EQH");
      expect(result.equalHighs[0].price).toBe(1000.6); // Average
      expect(result.equalHighs[0].differencePercent).toBeLessThanOrEqual(0.15);
    });

    it("rejects pairs that exceed the 0.15% tolerance threshold", () => {
      const p1: StructuralPivot = {
        type: "SWING_HIGH",
        price: 1000.0,
        barIndex: 2,
        date: "2026-09-10",
        confirmedIndex: 4,
        confirmedDate: "2026-09-12",
      };
      const p2: StructuralPivot = {
        type: "SWING_HIGH",
        price: 1002.5, // diff = 2.5 / 1002.5 = 0.249% > 0.15%
        barIndex: 8,
        date: "2026-09-22",
        confirmedIndex: 10,
        confirmedDate: "2026-09-24",
      };

      const result = detectEqualHighsAndLows([p1, p2], [], { tolerancePercent: 0.0015 });
      expect(result.equalHighs.length).toBe(0);
    });

    it("rejects adjacent bars from being counted as independent pivots", () => {
      const p1: StructuralPivot = {
        type: "SWING_LOW",
        price: 500.0,
        barIndex: 5,
        date: "2026-09-15",
        confirmedIndex: 7,
        confirmedDate: "2026-09-17",
      };
      const p2: StructuralPivot = {
        type: "SWING_LOW",
        price: 500.5,
        barIndex: 6, // adjacent bar (|6 - 5| < 2)
        date: "2026-09-16",
        confirmedIndex: 8,
        confirmedDate: "2026-09-18",
      };

      const result = detectEqualHighsAndLows([], [p1, p2]);
      expect(result.equalLows.length).toBe(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. PREVIOUS-WEEK HIGH AND LOW (PWH / PWL)
  // ───────────────────────────────────────────────────────────────────────────
  describe("3. Previous Week High (PWH) and Previous Week Low (PWL)", () => {
    it("calculates PWH and PWL from completed prior week and excludes current week", () => {
      // Prior week: Monday 2026-09-28 to Friday 2026-10-02
      // High was 2500 on 2026-09-30; Low was 2400 on 2026-10-01
      // Current week: Monday 2026-10-05 to Wednesday 2026-10-07 (high 2550, low 2350)
      const candles = makeCandles([
        // Prior week
        { date: "2026-09-28", open: 2420, high: 2450, low: 2410, close: 2440 },
        { date: "2026-09-29", open: 2440, high: 2480, low: 2430, close: 2470 },
        { date: "2026-09-30", open: 2470, high: 2500, low: 2450, close: 2490 }, // PWH = 2500
        { date: "2026-10-01", open: 2490, high: 2495, low: 2400, close: 2415 }, // PWL = 2400
        { date: "2026-10-02", open: 2415, high: 2460, low: 2405, close: 2450 },
        // Current week (in-progress)
        { date: "2026-10-05", open: 2450, high: 2550, low: 2440, close: 2520 }, // 2550 > PWH, but in current week!
        { date: "2026-10-06", open: 2520, high: 2530, low: 2350, close: 2400 }, // 2350 < PWL, but in current week!
      ]);

      const pwLevels = calculatePreviousWeekLevels(candles, candles.length - 1);
      expect(pwLevels).not.toBeNull();
      expect(pwLevels!.pwh).toBe(2500); // from prior week
      expect(pwLevels!.pwl).toBe(2400); // from prior week
      expect(pwLevels!.weekStartDate).toBe("2026-09-28");
    });

    it("returns null when no completed prior week exists", () => {
      // Only candles from the current week
      const candles = makeCandles([
        { date: "2026-10-05", open: 100, high: 105, low: 98, close: 102 },
        { date: "2026-10-06", open: 102, high: 104, low: 99, close: 101 },
      ]);

      const pwLevels = calculatePreviousWeekLevels(candles);
      expect(pwLevels).toBeNull();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. BULLISH AND BEARISH LIQUIDITY SWEEPS
  // ───────────────────────────────────────────────────────────────────────────
  describe("4. Bullish and Bearish Liquidity Sweeps", () => {
    it("detects a confirmed bullish liquidity sweep of an established swing low", () => {
      const swl: StructuralPivot = {
        type: "SWING_LOW",
        price: 2400.0,
        barIndex: 2,
        date: "2026-09-10",
        confirmedIndex: 4,
        confirmedDate: "2026-09-12",
      };

      // Current evaluation candle (idx 7): low dips to 2380 (15 pts penetration), but closes at 2420 > 2400
      const candles = makeCandles([
        { date: "2026-09-08", open: 2450, high: 2460, low: 2440, close: 2450 },
        { date: "2026-09-09", open: 2450, high: 2455, low: 2420, close: 2430 },
        { date: "2026-09-10", open: 2430, high: 2435, low: 2400, close: 2410 }, // Pivot low at 2400
        { date: "2026-09-11", open: 2410, high: 2440, low: 2415, close: 2435 },
        { date: "2026-09-12", open: 2435, high: 2450, low: 2420, close: 2445 }, // Confirmed at idx 4
        { date: "2026-09-15", open: 2445, high: 2460, low: 2430, close: 2450 },
        { date: "2026-09-16", open: 2450, high: 2455, low: 2420, close: 2425 },
        { date: "2026-09-17", open: 2425, high: 2430, low: 2385, close: 2415 }, // Sweep candle at idx 7
      ]);

      const sweeps = detectLiquiditySweeps(candles, 7, {
        swingHighs: [],
        swingLows: [swl],
        pwh: null,
        pwl: null,
        equalHighs: [],
        equalLows: [],
      });

      expect(sweeps.length).toBe(1);
      expect(sweeps[0].direction).toBe("BULLISH");
      expect(sweeps[0].sweptLevel).toBe(2400);
      expect(sweeps[0].levelType).toBe("SWING_LOW");
      expect(sweeps[0].wickPenetration).toBe(15.0); // 2400 - 2385 = 15
      expect(sweeps[0].closeConfirmation).toBe(true);
      expect(sweeps[0].closingPrice).toBe(2415);
    });

    it("detects a confirmed bearish liquidity sweep of an established PWH", () => {
      const candles = makeCandles([
        { date: "2026-10-09", open: 3000, high: 3050, low: 2980, close: 2990 }, // idx 0
      ]);

      // Candle spiked to 3050 > PWH (3020), but closed at 2990 < PWH
      const sweeps = detectLiquiditySweeps(candles, 0, {
        swingHighs: [],
        swingLows: [],
        pwh: 3020.0,
        pwl: 2900.0,
        equalHighs: [],
        equalLows: [],
      });

      expect(sweeps.length).toBe(1);
      expect(sweeps[0].direction).toBe("BEARISH");
      expect(sweeps[0].sweptLevel).toBe(3020.0);
      expect(sweeps[0].levelType).toBe("PWH");
      expect(sweeps[0].wickPenetration).toBe(30.0); // 3050 - 3020
      expect(sweeps[0].closeConfirmation).toBe(true);
      expect(sweeps[0].closingPrice).toBe(2990);
    });

    it("does not classify a genuine breakout close as a liquidity sweep", () => {
      const swh: StructuralPivot = {
        type: "SWING_HIGH",
        price: 2500.0,
        barIndex: 2,
        date: "2026-09-10",
        confirmedIndex: 4,
        confirmedDate: "2026-09-12",
      };

      // Candle spiked to 2520 and CLOSED at 2515 > 2500 (Breakout close, NOT a sweep back below!)
      const candles = makeCandles([
        { date: "2026-09-15", open: 2480, high: 2520, low: 2470, close: 2515 },
      ]);

      const sweeps = detectLiquiditySweeps(candles, 0, {
        swingHighs: [swh],
        swingLows: [],
        pwh: null,
        pwl: null,
        equalHighs: [],
        equalLows: [],
      });

      expect(sweeps.length).toBe(0); // Breakout close is NOT a liquidity sweep
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. BULLISH AND BEARISH CHANGE OF CHARACTER (CHOCH)
  // ───────────────────────────────────────────────────────────────────────────
  describe("5. Change of Character (CHOCH) vs Break of Structure (BOS)", () => {
    it("confirms a Bullish CHOCH when price closes above a prior structural lower high in a downtrend", () => {
      const h1: StructuralPivot = {
        type: "SWING_HIGH",
        price: 1500.0,
        barIndex: 2,
        date: "2026-09-10",
        confirmedIndex: 4,
        confirmedDate: "2026-09-12",
      };
      const h2: StructuralPivot = {
        type: "SWING_HIGH",
        price: 1450.0, // Lower High
        barIndex: 6,
        date: "2026-09-16",
        confirmedIndex: 8,
        confirmedDate: "2026-09-18",
      };
      const l1: StructuralPivot = {
        type: "SWING_LOW",
        price: 1380.0,
        barIndex: 4,
        date: "2026-09-12",
        confirmedIndex: 6,
        confirmedDate: "2026-09-14",
      };

      // Candle at bar 10 closes at 1465 > 1450 (breaks above last lower high)
      const candles = makeCandles([
        { date: "2026-09-08", open: 1480, high: 1490, low: 1470, close: 1485 }, // 0
        { date: "2026-09-09", open: 1485, high: 1495, low: 1475, close: 1490 }, // 1
        { date: "2026-09-10", open: 1490, high: 1500, low: 1480, close: 1495 }, // 2 (H1)
        { date: "2026-09-11", open: 1480, high: 1485, low: 1450, close: 1455 }, // 3
        { date: "2026-09-12", open: 1455, high: 1460, low: 1380, close: 1390 }, // 4 (L1, conf H1)
        { date: "2026-09-15", open: 1390, high: 1430, low: 1385, close: 1420 }, // 5
        { date: "2026-09-16", open: 1420, high: 1450, low: 1410, close: 1440 }, // 6 (H2, conf L1)
        { date: "2026-09-17", open: 1430, high: 1435, low: 1390, close: 1400 }, // 7
        { date: "2026-09-18", open: 1400, high: 1410, low: 1370, close: 1375 }, // 8 (conf H2)
        { date: "2026-09-19", open: 1375, high: 1430, low: 1370, close: 1425 }, // 9
        { date: "2026-09-22", open: 1425, high: 1470, low: 1420, close: 1465 }, // 10 (breaks H2!)
      ]);

      const result = detectChoch(candles, [h1, h2], [l1], 10);
      expect(result.recentChoch).not.toBeNull();
      expect(result.recentChoch!.direction).toBe("BULLISH");
      expect(result.recentChoch!.brokenLevel).toBe(1450.0);
      expect(result.recentChoch!.confirmationPrice).toBe(1465);
      expect(result.currentMarketState).toBe("BULLISH");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6. UNCONFIRMED PIVOTS AND INSUFFICIENT HISTORY
  // ───────────────────────────────────────────────────────────────────────────
  describe("6. Unconfirmed Pivots and Insufficient History", () => {
    it("returns explicit unavailable status when candles < 5", () => {
      const candles = makeCandles([
        { date: "2026-10-01", open: 100, high: 105, low: 98, close: 102 },
        { date: "2026-10-02", open: 102, high: 104, low: 99, close: 101 },
      ]);

      const result = analyzeMarketStructure(candles);
      expect(result.isAvailable).toBe(false);
      expect(result.pivots.length).toBe(0);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it("does not reveal unconfirmed future pivots before required bars close", () => {
      // 5 bars total (indexes 0 to 4). Bar 2 can be confirmed at index 4 (2 + 2 = 4).
      // Bar 3 could only be confirmed at index 5, which doesn't exist yet!
      const candles = makeCandles([
        { date: "2026-10-01", open: 100, high: 101, low: 98, close: 100 },
        { date: "2026-10-02", open: 100, high: 102, low: 99, close: 101 },
        { date: "2026-10-05", open: 101, high: 110, low: 100, close: 108 }, // Pivot at idx 2
        { date: "2026-10-06", open: 108, high: 109, low: 102, close: 105 }, // Higher high than bar 4, but cannot confirm bar 3
        { date: "2026-10-07", open: 105, high: 104, low: 100, close: 102 }, // Confirms idx 2 only
      ]);

      const result = findConfirmedPivots(candles);
      expect(result.highs.length).toBe(1);
      expect(result.highs[0].barIndex).toBe(2);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 7. EXCHANGE HOLIDAYS AND WEEK BOUNDARIES
  // ───────────────────────────────────────────────────────────────────────────
  describe("7. Exchange Holidays and Week Boundaries", () => {
    it("maps trading days around holidays to identical Monday anchor in Asia/Kolkata", () => {
      // Gandhi Jayanti week: Friday 2026-10-02 holiday. Mon 2026-09-28 to Thu 2026-10-01
      expect(getAsiaKolkataMonday("2026-09-28")).toBe("2026-09-28");
      expect(getAsiaKolkataMonday("2026-09-29")).toBe("2026-09-28");
      expect(getAsiaKolkataMonday("2026-09-30")).toBe("2026-09-28");
      expect(getAsiaKolkataMonday("2026-10-01")).toBe("2026-09-28");
      expect(getAsiaKolkataMonday("2026-10-02")).toBe("2026-09-28");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 8. HISTORICAL LOOK-AHEAD BIAS AVOIDANCE
  // ───────────────────────────────────────────────────────────────────────────
  describe("8. Historical Look-Ahead Bias Avoidance", () => {
    it("ensures backtest evaluation at bar T only accesses levels confirmed at or before T-1", () => {
      const candles = makeCandles([
        { date: "2026-10-01", open: 100, high: 100, low: 95, close: 98 }, // 0
        { date: "2026-10-02", open: 98, high: 102, low: 96, close: 101 }, // 1
        { date: "2026-10-05", open: 102, high: 115, low: 100, close: 108 }, // 2 (Pivot high)
        { date: "2026-10-06", open: 108, high: 105, low: 98, close: 100 }, // 3
        { date: "2026-10-07", open: 100, high: 101, low: 92, close: 93 }, // 4 (Confirmation bar for idx 2)
        { date: "2026-10-08", open: 93, high: 120, low: 92, close: 110 }, // 5 (Evaluated candle)
      ]);

      // At bar 3, pivot 2 is NOT confirmed yet
      const pivotsAt3 = findConfirmedPivots(candles, 3);
      expect(pivotsAt3.highs.length).toBe(0);

      // At bar 4, pivot 2 is confirmed
      const pivotsAt4 = findConfirmedPivots(candles, 4);
      expect(pivotsAt4.highs.length).toBe(1);
      expect(pivotsAt4.highs[0].confirmedIndex).toBe(4);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 9. NULL EMA HANDLING
  // ───────────────────────────────────────────────────────────────────────────
  describe("9. Null EMA Handling", () => {
    it("preserves genuine unavailability of EMA 200 without substituting zero or synthetic", () => {
      // 45 candles: sufficient for EMA 20, but not EMA 50 or 200
      const candles: DailyCandle[] = [];
      for (let i = 0; i < 45; i++) {
        const d = new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().split("T")[0];
        candles.push({ date: d, open: 1000 + i, high: 1010 + i, low: 995 + i, close: 1005 + i, volume: 100000 });
      }

      const profile = buildStockIndicatorProfile("PERSISTENT", candles);
      expect(profile.ema20).not.toBeNull();
      expect(profile.ema50).toBeNull();
      expect(profile.ema200).toBeNull();

      // Strategy B requires EMA 50 and EMA 200
      const stratB = evaluateStrategyB_Pullback(profile);
      expect(stratB.matched).toBe(false);
      expect(stratB.warnings?.[0]).toContain("requires genuine 50 and 200 EMA");

      // Strategy G requires EMA 20, 50, and 200
      const stratG = evaluateStrategyG_TrendContinuation(profile);
      expect(stratG.matched).toBe(false);
      expect(stratG.warnings?.[0]).toContain("requires genuine 20/50/200 EMA");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 10. PERSISTENCE AND API COMPATIBILITY
  // ───────────────────────────────────────────────────────────────────────────
  describe("10. Persistence and API Compatibility", () => {
    it("persists market structure, liquidity sweeps, and CHOCH in indicator_snapshot", async () => {
      const persistence = new DailyScanPersistenceService();
      const run = await persistence.createScanRun({
        scanDate: "2026-10-12",
        scanType: "scheduled",
        universeSize: 1,
      });

      const mockSignal: any = {
        id: "SIG-TRENT-001",
        symbol: "TRENT.NS",
        companyName: "Trent Ltd",
        sector: "Retail",
        setupId: "STRATEGY_A_BREAKOUT",
        setupTitle: "Breakout Trading",
        setupBadge: "Breakout",
        status: "ACTIVE",
        timestamp: "2026-10-12T15:45:00Z",
        currentPrice: 2950.0,
        entryPrice: 2960.0,
        stopLossPrice: 2880.0,
        target1Price: 3120.0,
        target2Price: 3200.0,
        riskPerShare: 80.0,
        rewardRiskRatio: 2.0,
        confluenceScore: 92,
        relativeStrengthVsNifty: 85,
        volumeMultiplier: 2.1,
        ema20: 2900,
        ema50: 2820,
        ema200: 2600,
        pwh: 2980.0,
        pwl: 2850.0,
        liquiditySweep: {
          direction: "BULLISH",
          sweptLevel: 2850.0,
          levelType: "PWL",
          sweepCandleDate: "2026-10-12",
          sweepCandleIndex: 100,
          wickPenetration: 12.5,
          wickPenetrationPercent: 0.438,
          closeConfirmation: true,
          closingPrice: 2950.0,
          dataQuality: "HIGH_CONFIDENCE",
          description: "Bullish liquidity sweep of PWL",
        },
        choch: {
          direction: "BULLISH",
          brokenLevel: 2900.0,
          brokenPivot: { type: "SWING_HIGH", price: 2900, barIndex: 80, date: "2026-09-20", confirmedIndex: 82, confirmedDate: "2026-09-22" },
          priorTrend: "BEARISH",
          breakCandleDate: "2026-10-12",
          breakCandleIndex: 100,
          confirmationPrice: 2950.0,
          description: "Bullish CHOCH confirmed",
        },
        marketStructure: {
          pwh: 2980.0,
          pwl: 2850.0,
          equalHighs: [],
          equalLows: [],
          recentLiquiditySweep: null,
          recentChoch: null,
          currentMarketState: "BULLISH",
        },
        fivePillarChecklist: {
          pillar1MarketRegime: { passed: true, niftyAlignment: "BULLISH_TREND", details: "NIFTY strong" },
          pillar2Fundamentals: { passed: true, qualityScore: 95, details: "Zero debt" },
          pillar3LiquidityLevels: { passed: true, keyLevel: 2850.0, details: "PWL swept" },
          pillar4PriceActionVolume: { passed: true, setupName: "Breakout", volumeMultiplier: 2.1, details: "2.1x vol" },
          pillar5RiskManagement: { passed: true, rewardRiskRatio: 2.0, riskPercent: 1.0, details: "1:2 R:R" },
        },
        tradeRationale: ["High confluence setup"],
        invalidationTrigger: "Close below 2880",
        trailingStopPlan: "Trail below 20 EMA",
      };

      const saved = await persistence.saveOpportunities(run.id, "2026-10-12", [mockSignal]);
      expect(saved.length).toBe(1);

      const snap = saved[0].indicator_snapshot as any;
      expect(snap.pwh).toBe(2980.0);
      expect(snap.pwl).toBe(2850.0);
      expect(snap.liquiditySweep.direction).toBe("BULLISH");
      expect(snap.choch.direction).toBe("BULLISH");
      expect(snap.marketStructure.currentMarketState).toBe("BULLISH");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 11. EIGHT-STRATEGY REGRESSION TESTS
  // ───────────────────────────────────────────────────────────────────────────
  describe("11. Eight-Strategy Regression Verification", () => {
    it("preserves evaluation of all 8 strategies without forced signals", () => {
      // 250 candles of steady trend
      const candles: DailyCandle[] = [];
      for (let i = 0; i < 250; i++) {
        const d = new Date(Date.UTC(2025, 0, 1) + i * 86400000).toISOString().split("T")[0];
        const base = 1000 + i * 4;
        candles.push({
          date: d,
          open: base,
          high: base + 8,
          low: base - 4,
          close: base + 6,
          volume: 200000,
        });
      }

      const profile = buildStockIndicatorProfile("HAL", candles);
      expect(profile.marketStructure).toBeDefined();
      expect(profile.marketStructure!.isAvailable).toBe(true);

      const opp = evaluateAllStrategiesForStock(profile);
      // If stock qualifies, result contains marketStructure metadata
      if (opp) {
        expect(opp.marketStructure).toBeDefined();
        expect(opp.confluenceScore).toBeGreaterThanOrEqual(65);
      }
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 12. SCHEDULER & LIVE-TRADING SAFETY INVARIANTS
  // ───────────────────────────────────────────────────────────────────────────
  describe("12. Safety Invariants", () => {
    it("keeps live broker order execution strictly disabled", () => {
      const engine = new SwingTradingEngine();
      expect((engine as any).BROKER_EXECUTION_ENABLED).toBe(false);
    });
  });
});
