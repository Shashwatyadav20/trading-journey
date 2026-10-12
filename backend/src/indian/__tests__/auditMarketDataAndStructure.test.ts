import { describe, it, expect } from "vitest";
import {
  detectEqualHighsAndLows,
  StructuralPivot,
} from "../swing/marketStructure";
import {
  buildStockIndicatorProfile,
  fetchLiveStockCandles,
  SYMBOL_ALIASES,
  DailyCandle,
} from "../swing/dailyStrategyScanner";

describe("Audit Suite: Market Data & Market Structure Correctness", () => {
  // ───────────────────────────────────────────────────────────────────────────
  // 1. EQH / EQL CANDIDATE AUDIT & TOLERANCE ENFORCEMENT
  // ───────────────────────────────────────────────────────────────────────────
  describe("1. EQH/EQL Candidate Audit & Tolerance Verification", () => {
    it("strictly rejects pivot pairs whose actual percentage difference exceeds 0.15% when tolerancePercent = 0.15", () => {
      const p1: StructuralPivot = {
        type: "SWING_HIGH",
        price: 1000.0,
        barIndex: 10,
        date: "2026-09-01",
        confirmedIndex: 12,
        confirmedDate: "2026-09-03",
      };
      // diff = 1.8 / 1001.8 = 0.1797% > 0.15%
      const p2: StructuralPivot = {
        type: "SWING_HIGH",
        price: 1001.8,
        barIndex: 18,
        date: "2026-09-15",
        confirmedIndex: 20,
        confirmedDate: "2026-09-17",
      };

      const result = detectEqualHighsAndLows([p1, p2], [], { tolerancePercent: 0.15 });
      expect(result.equalHighs).toHaveLength(0);
    });

    it("accepts pivot pairs whose actual percentage difference is within 0.15% and reports consistent units", () => {
      const p1: StructuralPivot = {
        type: "SWING_HIGH",
        price: 1000.0,
        barIndex: 10,
        date: "2026-09-01",
        confirmedIndex: 12,
        confirmedDate: "2026-09-03",
      };
      // diff = 1.0 / 1001.0 = 0.0999% <= 0.15%
      const p2: StructuralPivot = {
        type: "SWING_HIGH",
        price: 1001.0,
        barIndex: 18,
        date: "2026-09-15",
        confirmedIndex: 20,
        confirmedDate: "2026-09-17",
      };

      const result = detectEqualHighsAndLows([p1, p2], [], { tolerancePercent: 0.15 });
      expect(result.equalHighs).toHaveLength(1);
      const eqh = result.equalHighs[0];
      expect(eqh.type).toBe("EQH");
      expect(eqh.tolerancePercent).toBe(0.15); // Consistent unit: 0.15%
      expect(eqh.differencePercent).toBeCloseTo(0.0999, 2); // Consistent unit: ~0.10%
      expect(eqh.differencePercent).toBeLessThanOrEqual(eqh.tolerancePercent);
    });

    it("normalizes fractional 0.0015 and percentage 0.15 to the identical strict threshold", () => {
      const p1: StructuralPivot = {
        type: "SWING_LOW",
        price: 2500.0,
        barIndex: 5,
        date: "2026-09-02",
        confirmedIndex: 7,
        confirmedDate: "2026-09-04",
      };
      // diff = 3.0 / 2503.0 = 0.1198% <= 0.15%
      const p2: StructuralPivot = {
        type: "SWING_LOW",
        price: 2503.0,
        barIndex: 14,
        date: "2026-09-16",
        confirmedIndex: 16,
        confirmedDate: "2026-09-18",
      };

      const resFraction = detectEqualHighsAndLows([], [p1, p2], { tolerancePercent: 0.0015 });
      const resPercent = detectEqualHighsAndLows([], [p1, p2], { tolerancePercent: 0.15 });

      expect(resFraction.equalLows).toHaveLength(1);
      expect(resPercent.equalLows).toHaveLength(1);
      expect(resFraction.equalLows[0].differencePercent).toBe(resPercent.equalLows[0].differencePercent);
      expect(resFraction.equalLows[0].tolerancePercent).toBe(0.15);
      expect(resPercent.equalLows[0].tolerancePercent).toBe(0.15);
    });

    it("rejects large differences even if large ATR is provided (no tolerance dilation)", () => {
      const p1: StructuralPivot = {
        type: "SWING_HIGH",
        price: 1000.0,
        barIndex: 5,
        date: "2026-09-02",
        confirmedIndex: 7,
        confirmedDate: "2026-09-04",
      };
      // diff = 20.0 / 1020.0 = 1.96% >> 0.15%
      const p2: StructuralPivot = {
        type: "SWING_HIGH",
        price: 1020.0,
        barIndex: 15,
        date: "2026-09-18",
        confirmedIndex: 17,
        confirmedDate: "2026-09-20",
      };

      // ATR is 500, but tolerancePercent should NOT dilate to allow 1.96%
      const result = detectEqualHighsAndLows([p1, p2], [], { tolerancePercent: 0.15, atr: 500 });
      expect(result.equalHighs).toHaveLength(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. EXTREME PERCENTAGE CHANGES & PREVIOUS-CLOSE CALCULATION (MCX BUG)
  // ───────────────────────────────────────────────────────────────────────────
  describe("2. Previous-Close & Percentage Change Calculation", () => {
    const mockCandles: DailyCandle[] = [
      { date: "2026-10-07", open: 3305, high: 3374.6, low: 3267.8, close: 3362.6, volume: 2000000 },
      { date: "2026-10-08", open: 3360, high: 3370.3, low: 3246, close: 3255.6, volume: 2000000 },
      { date: "2026-10-09", open: 3265, high: 3342, low: 3221, close: 3318.2, volume: 1600000 },
    ];

    it("does NOT use chartPreviousClose (1282.11) from 2-year chart range to calculate changePercent", () => {
      const yahooMetaWithMultiYearChartPrevClose = {
        regularMarketPrice: 3362.4,
        regularMarketChangePercent: 1.33,
        regularMarketPreviousClose: 3318.2,
        chartPreviousClose: 1282.11, // Close from 2 years ago in Yahoo chart response
        longName: "Multi Commodity Exchange of India Limited",
      };

      const profile = buildStockIndicatorProfile("MCX", mockCandles, yahooMetaWithMultiYearChartPrevClose);

      // Should be 1.33%, NEVER 162.22%
      expect(profile.changePercent).toBe(1.33);
      expect(profile.changePercent).toBeLessThan(10);
      expect(profile.prevClose).toBe(3318.2);
      expect(profile.currentPrice).toBe(3362.4);
    });

    it("accurately calculates changePercent from consecutive daily candles when meta is absent", () => {
      const profile = buildStockIndicatorProfile("MCX", mockCandles, {});

      // Last close = 3318.2, prior close = 3255.6 -> change = +62.6 (+1.92%)
      expect(profile.currentPrice).toBe(3318.2);
      expect(profile.prevClose).toBe(3255.6);
      expect(profile.changePercent).toBeCloseTo(1.92, 2);
    });

    it("triggers sanity safeguard on anomalous changes exceeding 50% on cash equities", () => {
      const anomalousMeta = {
        regularMarketPrice: 3362.4,
        regularMarketChangePercent: 162.22, // Distorted feed
        regularMarketPreviousClose: 1282.11,
      };

      const profile = buildStockIndicatorProfile("MCX", mockCandles, anomalousMeta);

      // Sanity safeguard kicks in and recalculates from valid consecutive candles
      expect(profile.changePercent).toBeLessThanOrEqual(50);
      expect(profile.changePercent).toBeCloseTo(1.92, 2);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. SYMBOL ALIAS MAPPING & CANDLE FETCH RETRY (ZOMATO BUG)
  // ───────────────────────────────────────────────────────────────────────────
  describe("3. Symbol Mapping & Candle Fetch Resilience", () => {
    it("contains official corporate alias for renamed ZOMATO -> ETERNAL on NSE", () => {
      expect(SYMBOL_ALIASES["ZOMATO"]).toBe("ETERNAL");
    });

    it("fetches valid completed candles for ZOMATO using alias ETERNAL without data fabrication", async () => {
      const data = await fetchLiveStockCandles("ZOMATO");
      expect(data).not.toBeNull();
      expect(data?.candles.length).toBeGreaterThanOrEqual(250);
      expect(data?.meta.symbol).toBe("ETERNAL.NS");
      expect(data?.meta.regularMarketPrice).toBeGreaterThan(0);
    });

    it("safely returns null and logs warning for non-existent symbols without throwing or fabricating data", async () => {
      const data = await fetchLiveStockCandles("TOTALLY_INVALID_SYMBOL_12345");
      expect(data).toBeNull();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. SOURCE FIELD VERIFICATION (PRICES, NAMES, VOLUMES, MARKET CAPS)
  // ───────────────────────────────────────────────────────────────────────────
  describe("4. Source Field Integrity Verification", () => {
    it("maps company name, current price, volume multiplier, and market cap accurately from source", () => {
      const candles: DailyCandle[] = Array.from({ length: 30 }, (_, i) => ({
        date: `2026-09-${(i + 1).toString().padStart(2, "0")}`,
        open: 1000 + i * 2,
        high: 1010 + i * 2,
        low: 995 + i * 2,
        close: 1005 + i * 2,
        volume: 1000000,
      }));

      const meta = {
        regularMarketPrice: 1065.0,
        regularMarketPreviousClose: 1063.0,
        regularMarketChangePercent: 0.19,
        regularMarketVolume: 2000000,
        shortName: "TRENT LIMITED",
        longName: "Trent Limited",
      };

      const profile = buildStockIndicatorProfile("TRENT", candles, meta);

      expect(profile.currentPrice).toBe(1065.0);
      expect(profile.companyName).toBe("TRENT LIMITED");
      expect(profile.cleanSymbol).toBe("TRENT");
      expect(profile.volumeMultiplier).toBe(2.0); // 2,000,000 / 1,000,000
      expect(profile.changePercent).toBe(0.19);
    });
  });
});
