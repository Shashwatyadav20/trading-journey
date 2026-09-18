import {
  PineInputs,
  DEFAULT_PINE_INPUTS,
  Candle,
  ActiveLevel,
  PremiumDiscountZoneState,
} from "./PineTypes";

/**
 * KNOWN LIMITATION — PWH/PWL Weekly Timeframe ("W") Semantics
 * =============================================================
 * Pine Script uses:
 *   request.security(syminfo.tickerid, "W", [high[1], low[1]], lookahead=barmerge.lookahead_off)
 *
 * TradingView's "W" timeframe boundary is determined per-symbol by the exchange/session calendar:
 *   - BTC/USD (24/7, e.g. Coinbase): week starts Sunday 00:00 UTC (matching ISO week ending Saturday 23:59 UTC).
 *   - XAU/USD (forex/CFD, e.g. XAUUSD on TradingView): week starts Sunday 17:00 New York time (i.e. Sunday
 *     21:00 UTC in winter, Sunday 20:00 UTC in summer), matching FX Sunday open.
 *
 * The backend cannot reliably replicate symbol-specific TradingView session calendars from raw OHLC data alone.
 * Our market data providers (Coinbase for BTC, Twelve Data for XAU) deliver UTC-timestamped candles with no
 * embedded exchange-session metadata.
 *
 * APPROXIMATION USED:
 *   We aggregate weekly candles using Monday 00:00:00 UTC as the week boundary (ISO-8601 week).
 *   This is the most widely used international week definition and aligns most closely with crypto
 *   market convention (BTC/USD is a 24/7 market with no exchange-mandated weekly session).
 *
 *   For XAU/USD, the exact Sunday 17:00 ET FX session start is NOT reproduced. The PWH/PWL values
 *   will be computed from the Monday-anchored UTC week, which may differ from TradingView's "W"
 *   result by up to 1 calendar day at the boundary.
 *
 * VERDICT: PARTIAL REPRODUCTION — not a silent "Difference: None."
 *   BTC/USD: Close approximation (24/7, no session gap).
 *   XAU/USD: Approximate — week boundary differs from Pine by ~1 day at the Sunday open.
 *
 * A future improvement would accept an explicit weekStartDayOfWeek parameter (0=Sunday, 1=Monday)
 * per instrument, and apply DST-aware session rules for FX symbols.
 */

export class PineLiquidityEngine {
  private inputs: PineInputs;

  // Active analytical level storage arrays (prices + label texts)
  private eqhPrices: number[] = [];
  private eqhTexts: string[] = [];

  private eqlPrices: number[] = [];
  private eqlTexts: string[] = [];

  private swhPrices: number[] = [];
  private swhTexts: string[] = [];

  private swlPrices: number[] = [];
  private swlTexts: string[] = [];

  // PWH / PWL state
  private pwhPrice: number | null = null;
  private pwlPrice: number | null = null;
  private pwhTimestampMs: number | null = null;
  private pwlTimestampMs: number | null = null;

  // PDH / PDL state (Previous Day High / Low)
  private pdhPrice: number | null = null;
  private pdlPrice: number | null = null;
  private pdhTimestampMs: number | null = null;
  private pdlTimestampMs: number | null = null;

  // PMH / PML state (Previous Month High / Low)
  private pmhPrice: number | null = null;
  private pmlPrice: number | null = null;
  private pmhTimestampMs: number | null = null;
  private pmlTimestampMs: number | null = null;

  // Session High / Low state (Asia, London, New York)
  private asiaHPrice: number | null = null;
  private asiaLPrice: number | null = null;
  private asiaHTimestampMs: number | null = null;
  private asiaLTimestampMs: number | null = null;

  private londonHPrice: number | null = null;
  private londonLPrice: number | null = null;
  private londonHTimestampMs: number | null = null;
  private londonLTimestampMs: number | null = null;

  private nyHPrice: number | null = null;
  private nyLPrice: number | null = null;
  private nyHTimestampMs: number | null = null;
  private nyLTimestampMs: number | null = null;

  // Active session tracking buffers
  private currentAsiaHigh: number | null = null;
  private currentAsiaLow: number | null = null;
  private currentLondonHigh: number | null = null;
  private currentLondonLow: number | null = null;
  private currentNYHigh: number | null = null;
  private currentNYLow: number | null = null;

  // Track previous pivots for equality checks per timeframe
  private prevPH15: number | null = null;
  private prevPL15: number | null = null;

  private prevPH1H: number | null = null;
  private prevPL1H: number | null = null;

  private prevPH4H: number | null = null;
  private prevPL4H: number | null = null;

  private prevPHD: number | null = null;
  private prevPLD: number | null = null;

  // Consumed level stable keys (e.g. "PWL-4368.53" or "XAU/USD-PWL-4368.53")
  private consumedLevelKeys: Set<string> = new Set();

  // Bar history per timeframe
  private baseCandles: Candle[] = [];   // 1M base candles from provider
  private tf15Candles: Candle[] = [];
  private tf60Candles: Candle[] = [];
  private tf240Candles: Candle[] = [];
  private tfDailyCandles: Candle[] = [];
  private tfWeeklyCandles: Candle[] = [];
  private tfMonthlyCandles: Candle[] = [];
  private tfChartCandles: Candle[] = [];

  private chartTFinMinutes: number = 15;
  private barIndex: number = 0;

  constructor(inputs: Partial<PineInputs> = {}, chartTFinMinutes: number = 15) {
    this.inputs = { ...DEFAULT_PINE_INPUTS, ...inputs };
    this.chartTFinMinutes = chartTFinMinutes;
  }

  public getInputs(): PineInputs {
    return { ...this.inputs };
  }

  public getChartTF(): number {
    return this.chartTFinMinutes;
  }

  public setChartTF(tfMinutes: number): void {
    const targetTF = tfMinutes < 15 ? 15 : tfMinutes;
    if (this.chartTFinMinutes !== targetTF) {
      this.chartTFinMinutes = targetTF;
      const swingCandles = this.getSwingCandles();
      if (swingCandles.length >= this.inputs.swingPivotLen * 2 + 1) {
        this.evaluateMajorSwings(swingCandles);
      }
    }
  }

  // ─── LEVEL CONSUMPTION ENGINE ─────────────────────────────────────────────

  public consumeLevel(levelOrKey: ActiveLevel | string, instrument?: string): void {
    if (typeof levelOrKey === "string") {
      const cleanKey = levelOrKey.trim();
      this.consumedLevelKeys.add(cleanKey);
      const parts = cleanKey.split("-");
      if (parts.length >= 2) {
        const typeStr = parts[parts.length - 2] || parts[0];
        const priceNum = parseFloat(parts[parts.length - 1]);
        if (!isNaN(priceNum)) {
          this.consumedLevelKeys.add(`${typeStr.toUpperCase()}-${priceNum.toFixed(2)}`);
        }
      }
    } else {
      const type = levelOrKey.type;
      const priceStr = levelOrKey.price.toFixed(2);
      this.consumedLevelKeys.add(`${type}-${priceStr}`);
      this.consumedLevelKeys.add(`${levelOrKey.id}`);
      if (instrument) {
        this.consumedLevelKeys.add(`${instrument}-${type}-${priceStr}`);
      }
    }
  }

  public unconsumeLevel(levelOrKey: ActiveLevel | string, instrument?: string): void {
    if (typeof levelOrKey === "string") {
      const cleanKey = levelOrKey.trim();
      this.consumedLevelKeys.delete(cleanKey);
      const parts = cleanKey.split("-");
      if (parts.length >= 2) {
        const typeStr = parts[parts.length - 2] || parts[0];
        const priceNum = parseFloat(parts[parts.length - 1]);
        if (!isNaN(priceNum)) {
          this.consumedLevelKeys.delete(`${typeStr.toUpperCase()}-${priceNum.toFixed(2)}`);
        }
      }
    } else {
      const type = levelOrKey.type;
      const priceStr = levelOrKey.price.toFixed(2);
      this.consumedLevelKeys.delete(`${type}-${priceStr}`);
      this.consumedLevelKeys.delete(`${levelOrKey.id}`);
      if (instrument) {
        this.consumedLevelKeys.delete(`${instrument}-${type}-${priceStr}`);
      }
    }
  }

  public isConsumed(level: ActiveLevel, instrument?: string): boolean {
    const priceStr = level.price.toFixed(2);
    const key1 = `${level.type}-${priceStr}`;
    const key2 = level.id;
    const key3 = instrument ? `${instrument}-${level.type}-${priceStr}` : "";

    return (
      this.consumedLevelKeys.has(key1) ||
      this.consumedLevelKeys.has(key2) ||
      (key3 !== "" && this.consumedLevelKeys.has(key3))
    );
  }

  public getConsumedLevels(): string[] {
    return Array.from(this.consumedLevelKeys);
  }

  public resetConsumedLevels(): void {
    this.consumedLevelKeys.clear();
  }

  public clearConsumedKeysForType(levelType: string): void {
    const target = levelType.toUpperCase();
    for (const key of Array.from(this.consumedLevelKeys)) {
      const keyUpper = key.toUpperCase();
      if (
        keyUpper.startsWith(`${target}-`) ||
        keyUpper.includes(`-${target}-`) ||
        keyUpper.startsWith(`${target.toLowerCase()}-`)
      ) {
        this.consumedLevelKeys.delete(key);
      }
    }
  }

  // ─── PINE HELPER FUNCTIONS ────────────────────────────────────────────────

  public static f_pivotHigh(highs: number[], len: number): number | null {
    const idx = highs.length - 1 - len;
    if (idx < len) return null;
    const targetPrice = highs[idx];

    for (let k = idx - len; k < idx; k++) {
      if (highs[k] >= targetPrice) return null;
    }
    for (let k = idx + 1; k <= highs.length - 1; k++) {
      if (highs[k] >= targetPrice) return null;
    }

    return targetPrice;
  }

  public static f_pivotLow(lows: number[], len: number): number | null {
    const idx = lows.length - 1 - len;
    if (idx < len) return null;
    const targetPrice = lows[idx];

    for (let k = idx - len; k < idx; k++) {
      if (lows[k] <= targetPrice) return null;
    }
    for (let k = idx + 1; k <= lows.length - 1; k++) {
      if (lows[k] <= targetPrice) return null;
    }

    return targetPrice;
  }

  public static f_isEqual(p1: number | null, p2: number | null, tolPct: number): boolean {
    if (p1 === null || p2 === null || isNaN(p1) || isNaN(p2)) return false;
    const maxVal = Math.max(p1, p2);
    if (maxVal === 0) return false;
    return (Math.abs(p1 - p2) / maxVal) * 100 <= tolPct;
  }

  public static f_isNear(price: number, arr: number[], tolPct: number): boolean {
    if (arr.length === 0) return false;
    for (const p of arr) {
      if (p !== null && !isNaN(p)) {
        const maxVal = Math.max(price, p);
        if (maxVal > 0 && (Math.abs(price - p) / maxVal) * 100 <= tolPct) {
          return true;
        }
      }
    }
    return false;
  }

  private f_pushLevelUnique(
    priceArr: number[],
    textArr: string[],
    crossArr: number[],
    maxN: number,
    lvlPrice: number,
    txt: string,
    tolPct: number
  ): void {
    const isDup =
      PineLiquidityEngine.f_isNear(lvlPrice, priceArr, tolPct) ||
      PineLiquidityEngine.f_isNear(lvlPrice, crossArr, tolPct);

    if (!isDup) {
      priceArr.push(lvlPrice);
      textArr.push(txt);
      if (priceArr.length > maxN) {
        priceArr.shift();
        textArr.shift();
      }
    }
  }

  private f_removeBroken(
    priceArr: number[],
    textArr: string[],
    isHighType: boolean,
    currentHigh: number,
    currentLow: number,
    levelType: import("./PineTypes").LiquidityLevelType
  ): void {
    if (priceArr.length === 0) return;

    for (let i = priceArr.length - 1; i >= 0; i--) {
      const p = priceArr[i];
      const broken = isHighType ? currentHigh >= p : currentLow <= p;
      if (broken) {
        this.consumeLevel(`${levelType}-${p.toFixed(2)}`);
        priceArr.splice(i, 1);
        textArr.splice(i, 1);
      }
    }
  }

  // ─── CANDLE PROCESSOR ───────────────────────────────────────────────────────

  public processCandle(candle: Candle): void {
    this.barIndex++;
    this.baseCandles.push(candle);

    // 1. Aggregations & Pivots on Timeframes
    this.aggregateTimeframes(candle);

    // 2. Session High / Low Tracking
    this.evaluateSessions(candle);

    // 3. Wick-Based Invalidation for array levels
    this.f_removeBroken(this.eqhPrices, this.eqhTexts, true, candle.high, candle.low, "EQH");
    this.f_removeBroken(this.eqlPrices, this.eqlTexts, false, candle.high, candle.low, "EQL");
    this.f_removeBroken(this.swhPrices, this.swhTexts, true, candle.high, candle.low, "SWH");
    this.f_removeBroken(this.swlPrices, this.swlTexts, false, candle.high, candle.low, "SWL");
  }

  // ─── TIMEFRAME AGGREGATION & HTF PROCESSING ────────────────────────────────

  private aggregateTimeframes(candle: Candle): void {
    // 15M Aggregation
    const isNew15M = this.updateTfBuffer(this.tf15Candles, candle, 15);
    if (isNew15M && this.tf15Candles.length >= this.inputs.eqPivotLen * 2 + 1) {
      this.evaluateEQH_EQL_15M();
    }

    // 1H (60M) Aggregation
    const isNew60M = this.updateTfBuffer(this.tf60Candles, candle, 60);
    if (isNew60M && this.tf60Candles.length >= this.inputs.eqPivotLen * 2 + 1) {
      this.evaluateEQH_EQL_1H();
    }

    // 4H (240M) Aggregation
    const isNew240M = this.updateTfBuffer(this.tf240Candles, candle, 240);
    if (isNew240M && this.tf240Candles.length >= this.inputs.eqPivotLen * 2 + 1) {
      this.evaluateEQH_EQL_4H();
    }

    // Daily Aggregation (PDH / PDL)
    const isNewDaily = this.updateTfBuffer(this.tfDailyCandles, candle, 1440);
    if (isNewDaily && this.tfDailyCandles.length >= 2) {
      this.evaluatePreviousDay();
      if (this.tfDailyCandles.length >= this.inputs.eqPivotLen * 2 + 1) {
        this.evaluateEQH_EQL_Daily();
      }
    }

    // Weekly Aggregation (PWH / PWL)
    const isNewWeekly = this.updateWeeklyBuffer(candle);
    if (isNewWeekly && this.tfWeeklyCandles.length >= 2) {
      this.evaluatePreviousWeek();
    }

    // Monthly Aggregation (PMH / PML)
    const isNewMonthly = this.updateMonthlyBuffer(candle);
    if (isNewMonthly && this.tfMonthlyCandles.length >= 2) {
      this.evaluatePreviousMonth();
    }

    // Chart TF Aggregation
    if (this.chartTFinMinutes >= 15 &&
        this.chartTFinMinutes !== 15 &&
        this.chartTFinMinutes !== 60 &&
        this.chartTFinMinutes !== 240 &&
        this.chartTFinMinutes !== 1440) {
      this.updateTfBuffer(this.tfChartCandles, candle, this.chartTFinMinutes);
    }

    // Major Swings
    const swingCandles = this.getSwingCandles();
    if (swingCandles.length >= this.inputs.swingPivotLen * 2 + 1) {
      this.evaluateMajorSwings(swingCandles);
    }
  }

  public getSwingCandles(): Candle[] {
    if (this.chartTFinMinutes <= 15) {
      return this.tf15Candles;
    }
    if (this.chartTFinMinutes === 60) {
      return this.tf60Candles;
    }
    if (this.chartTFinMinutes === 240) {
      return this.tf240Candles;
    }
    if (this.chartTFinMinutes === 1440) {
      return this.tfDailyCandles;
    }
    return this.tfChartCandles;
  }

  private updateTfBuffer(buffer: Candle[], candle: Candle, tfMinutes: number): boolean {
    const candleTime = new Date(candle.timestamp).getTime();
    const periodMs = tfMinutes * 60 * 1000;
    const bucketStart = Math.floor(candleTime / periodMs) * periodMs;

    if (buffer.length === 0) {
      buffer.push({ ...candle, timestamp: new Date(bucketStart).toISOString() });
      return true;
    }

    const currentBucket = new Date(buffer[buffer.length - 1].timestamp).getTime();
    if (bucketStart === currentBucket) {
      const last = buffer[buffer.length - 1];
      last.high = Math.max(last.high, candle.high);
      last.low = Math.min(last.low, candle.low);
      last.close = candle.close;
      last.volume += candle.volume;
      return false;
    } else {
      buffer.push({ ...candle, timestamp: new Date(bucketStart).toISOString() });
      return true;
    }
  }

  private updateWeeklyBuffer(candle: Candle): boolean {
    const d = new Date(candle.timestamp);
    const day = d.getUTCDay();            // 0=Sun, 1=Mon, ... 6=Sat
    const diffToMon = (day + 6) % 7;
    const mon = new Date(d);
    mon.setUTCDate(d.getUTCDate() - diffToMon);
    mon.setUTCHours(0, 0, 0, 0);
    const weekStartMs = mon.getTime();

    if (this.tfWeeklyCandles.length === 0) {
      this.tfWeeklyCandles.push({ ...candle, timestamp: new Date(weekStartMs).toISOString() });
      return true;
    }

    const currentWeekStart = new Date(
      this.tfWeeklyCandles[this.tfWeeklyCandles.length - 1].timestamp
    ).getTime();

    if (weekStartMs === currentWeekStart) {
      const last = this.tfWeeklyCandles[this.tfWeeklyCandles.length - 1];
      last.high = Math.max(last.high, candle.high);
      last.low = Math.min(last.low, candle.low);
      last.close = candle.close;
      last.volume += candle.volume;
      return false;
    } else {
      this.tfWeeklyCandles.push({ ...candle, timestamp: new Date(weekStartMs).toISOString() });
      return true;
    }
  }

  private updateMonthlyBuffer(candle: Candle): boolean {
    const d = new Date(candle.timestamp);
    const monthStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
    const monthStartMs = monthStart.getTime();

    if (this.tfMonthlyCandles.length === 0) {
      this.tfMonthlyCandles.push({ ...candle, timestamp: monthStart.toISOString() });
      return true;
    }

    const currentMonthStart = new Date(
      this.tfMonthlyCandles[this.tfMonthlyCandles.length - 1].timestamp
    ).getTime();

    if (monthStartMs === currentMonthStart) {
      const last = this.tfMonthlyCandles[this.tfMonthlyCandles.length - 1];
      last.high = Math.max(last.high, candle.high);
      last.low = Math.min(last.low, candle.low);
      last.close = candle.close;
      last.volume += candle.volume;
      return false;
    } else {
      this.tfMonthlyCandles.push({ ...candle, timestamp: monthStart.toISOString() });
      return true;
    }
  }

  // ─── HTF EQH / EQL EVALUATIONS ──────────────────────────────────────────

  private evaluateEQH_EQL_15M(): void {
    if (!this.inputs.showEQ_15) return;
    const highs = this.tf15Candles.map((c) => c.high);
    const lows = this.tf15Candles.map((c) => c.low);

    const ph15 = PineLiquidityEngine.f_pivotHigh(highs, this.inputs.eqPivotLen);
    const pl15 = PineLiquidityEngine.f_pivotLow(lows, this.inputs.eqPivotLen);

    if (ph15 !== null) {
      if (PineLiquidityEngine.f_isEqual(ph15, this.prevPH15, this.inputs.eqTolPct)) {
        const lvl = (ph15 + this.prevPH15!) / 2;
        this.f_pushLevelUnique(
          this.eqhPrices,
          this.eqhTexts,
          this.swhPrices,
          this.inputs.maxEQLevels,
          lvl,
          "HTF EQH (15M)",
          this.inputs.overlapTolPct
        );
      }
      this.prevPH15 = ph15;
    }

    if (pl15 !== null) {
      if (PineLiquidityEngine.f_isEqual(pl15, this.prevPL15, this.inputs.eqTolPct)) {
        const lvl = (pl15 + this.prevPL15!) / 2;
        this.f_pushLevelUnique(
          this.eqlPrices,
          this.eqlTexts,
          this.swlPrices,
          this.inputs.maxEQLevels,
          lvl,
          "HTF EQL (15M)",
          this.inputs.overlapTolPct
        );
      }
      this.prevPL15 = pl15;
    }
  }

  private evaluateEQH_EQL_1H(): void {
    if (!this.inputs.showEQ_1H) return;
    const highs = this.tf60Candles.map((c) => c.high);
    const lows = this.tf60Candles.map((c) => c.low);

    const ph1h = PineLiquidityEngine.f_pivotHigh(highs, this.inputs.eqPivotLen);
    const pl1h = PineLiquidityEngine.f_pivotLow(lows, this.inputs.eqPivotLen);

    if (ph1h !== null) {
      if (PineLiquidityEngine.f_isEqual(ph1h, this.prevPH1H, this.inputs.eqTolPct)) {
        const lvl = (ph1h + this.prevPH1H!) / 2;
        this.f_pushLevelUnique(
          this.eqhPrices,
          this.eqhTexts,
          this.swhPrices,
          this.inputs.maxEQLevels,
          lvl,
          "HTF EQH (1H)",
          this.inputs.overlapTolPct
        );
      }
      this.prevPH1H = ph1h;
    }

    if (pl1h !== null) {
      if (PineLiquidityEngine.f_isEqual(pl1h, this.prevPL1H, this.inputs.eqTolPct)) {
        const lvl = (pl1h + this.prevPL1H!) / 2;
        this.f_pushLevelUnique(
          this.eqlPrices,
          this.eqlTexts,
          this.swlPrices,
          this.inputs.maxEQLevels,
          lvl,
          "HTF EQL (1H)",
          this.inputs.overlapTolPct
        );
      }
      this.prevPL1H = pl1h;
    }
  }

  private evaluateEQH_EQL_4H(): void {
    if (!this.inputs.showEQ_4H) return;
    const highs = this.tf240Candles.map((c) => c.high);
    const lows = this.tf240Candles.map((c) => c.low);

    const ph4h = PineLiquidityEngine.f_pivotHigh(highs, this.inputs.eqPivotLen);
    const pl4h = PineLiquidityEngine.f_pivotLow(lows, this.inputs.eqPivotLen);

    if (ph4h !== null) {
      if (PineLiquidityEngine.f_isEqual(ph4h, this.prevPH4H, this.inputs.eqTolPct)) {
        const lvl = (ph4h + this.prevPH4H!) / 2;
        this.f_pushLevelUnique(
          this.eqhPrices,
          this.eqhTexts,
          this.swhPrices,
          this.inputs.maxEQLevels,
          lvl,
          "HTF EQH (4H)",
          this.inputs.overlapTolPct
        );
      }
      this.prevPH4H = ph4h;
    }

    if (pl4h !== null) {
      if (PineLiquidityEngine.f_isEqual(pl4h, this.prevPL4H, this.inputs.eqTolPct)) {
        const lvl = (pl4h + this.prevPL4H!) / 2;
        this.f_pushLevelUnique(
          this.eqlPrices,
          this.eqlTexts,
          this.swlPrices,
          this.inputs.maxEQLevels,
          lvl,
          "HTF EQL (4H)",
          this.inputs.overlapTolPct
        );
      }
      this.prevPL4H = pl4h;
    }
  }

  private evaluateEQH_EQL_Daily(): void {
    if (!this.inputs.showEQ_D) return;
    const highs = this.tfDailyCandles.map((c) => c.high);
    const lows = this.tfDailyCandles.map((c) => c.low);

    const phD = PineLiquidityEngine.f_pivotHigh(highs, this.inputs.eqPivotLen);
    const plD = PineLiquidityEngine.f_pivotLow(lows, this.inputs.eqPivotLen);

    if (phD !== null) {
      if (PineLiquidityEngine.f_isEqual(phD, this.prevPHD, this.inputs.eqTolPct)) {
        const lvl = (phD + this.prevPHD!) / 2;
        this.f_pushLevelUnique(
          this.eqhPrices,
          this.eqhTexts,
          this.swhPrices,
          this.inputs.maxEQLevels,
          lvl,
          "HTF EQH (D)",
          this.inputs.overlapTolPct
        );
      }
      this.prevPHD = phD;
    }

    if (plD !== null) {
      if (PineLiquidityEngine.f_isEqual(plD, this.prevPLD, this.inputs.eqTolPct)) {
        const lvl = (plD + this.prevPLD!) / 2;
        this.f_pushLevelUnique(
          this.eqlPrices,
          this.eqlTexts,
          this.swlPrices,
          this.inputs.maxEQLevels,
          lvl,
          "HTF EQL (D)",
          this.inputs.overlapTolPct
        );
      }
      this.prevPLD = plD;
    }
  }

  // ─── PREVIOUS WEEK / DAY / MONTH HIGH & LOW ──────────────────────────────

  private evaluatePreviousWeek(): void {
    if (!this.inputs.showPW) return;
    const prevWeekCandle = this.tfWeeklyCandles[this.tfWeeklyCandles.length - 2];
    if (prevWeekCandle) {
      const prevWeekMs = new Date(prevWeekCandle.timestamp).getTime();
      if (this.pwhPrice !== prevWeekCandle.high) {
        this.pwhPrice = prevWeekCandle.high;
        this.pwhTimestampMs = prevWeekMs;
        this.clearConsumedKeysForType("PWH");
      }
      if (this.pwlPrice !== prevWeekCandle.low) {
        this.pwlPrice = prevWeekCandle.low;
        this.pwlTimestampMs = prevWeekMs;
        this.clearConsumedKeysForType("PWL");
      }
    }
  }

  private evaluatePreviousDay(): void {
    if (!this.inputs.showPD) return;
    const prevDayCandle = this.tfDailyCandles[this.tfDailyCandles.length - 2];
    if (prevDayCandle) {
      const prevDayMs = new Date(prevDayCandle.timestamp).getTime();
      if (this.pdhPrice !== prevDayCandle.high) {
        this.pdhPrice = prevDayCandle.high;
        this.pdhTimestampMs = prevDayMs;
        this.clearConsumedKeysForType("PDH");
      }
      if (this.pdlPrice !== prevDayCandle.low) {
        this.pdlPrice = prevDayCandle.low;
        this.pdlTimestampMs = prevDayMs;
        this.clearConsumedKeysForType("PDL");
      }
    }
  }

  private evaluatePreviousMonth(): void {
    if (!this.inputs.showPM) return;
    const prevMonthCandle = this.tfMonthlyCandles[this.tfMonthlyCandles.length - 2];
    if (prevMonthCandle) {
      const prevMonthMs = new Date(prevMonthCandle.timestamp).getTime();
      if (this.pmhPrice !== prevMonthCandle.high) {
        this.pmhPrice = prevMonthCandle.high;
        this.pmhTimestampMs = prevMonthMs;
        this.clearConsumedKeysForType("PMH");
      }
      if (this.pmlPrice !== prevMonthCandle.low) {
        this.pmlPrice = prevMonthCandle.low;
        this.pmlTimestampMs = prevMonthMs;
        this.clearConsumedKeysForType("PML");
      }
    }
  }

  // ─── SESSION HIGH / LOW EVALUATIONS ────────────────────────────────────────

  private evaluateSessions(candle: Candle): void {
    if (!this.inputs.showSessions) return;
    const d = new Date(candle.timestamp);
    const hour = d.getUTCHours();
    const candleMs = d.getTime();

    // Asia session: 00:00 - 08:59 UTC
    if (hour >= 0 && hour < 9) {
      if (this.currentAsiaHigh === null || this.currentAsiaLow === null) {
        this.currentAsiaHigh = candle.high;
        this.currentAsiaLow = candle.low;
      } else {
        this.currentAsiaHigh = Math.max(this.currentAsiaHigh, candle.high);
        this.currentAsiaLow = Math.min(this.currentAsiaLow, candle.low);
      }
    } else if (hour === 9 && this.currentAsiaHigh !== null) {
      this.asiaHPrice = this.currentAsiaHigh;
      this.asiaLPrice = this.currentAsiaLow;
      this.asiaHTimestampMs = candleMs;
      this.asiaLTimestampMs = candleMs;
      this.clearConsumedKeysForType("ASIA_H");
      this.clearConsumedKeysForType("ASIA_L");
      this.currentAsiaHigh = null;
      this.currentAsiaLow = null;
    }

    // London session: 07:00 - 15:59 UTC
    if (hour >= 7 && hour < 16) {
      if (this.currentLondonHigh === null || this.currentLondonLow === null) {
        this.currentLondonHigh = candle.high;
        this.currentLondonLow = candle.low;
      } else {
        this.currentLondonHigh = Math.max(this.currentLondonHigh, candle.high);
        this.currentLondonLow = Math.min(this.currentLondonLow, candle.low);
      }
    } else if (hour === 16 && this.currentLondonHigh !== null) {
      this.londonHPrice = this.currentLondonHigh;
      this.londonLPrice = this.currentLondonLow;
      this.londonHTimestampMs = candleMs;
      this.londonLTimestampMs = candleMs;
      this.clearConsumedKeysForType("LONDON_H");
      this.clearConsumedKeysForType("LONDON_L");
      this.currentLondonHigh = null;
      this.currentLondonLow = null;
    }

    // New York session: 13:00 - 20:59 UTC
    if (hour >= 13 && hour < 21) {
      if (this.currentNYHigh === null || this.currentNYLow === null) {
        this.currentNYHigh = candle.high;
        this.currentNYLow = candle.low;
      } else {
        this.currentNYHigh = Math.max(this.currentNYHigh, candle.high);
        this.currentNYLow = Math.min(this.currentNYLow, candle.low);
      }
    } else if (hour === 21 && this.currentNYHigh !== null) {
      this.nyHPrice = this.currentNYHigh;
      this.nyLPrice = this.currentNYLow;
      this.nyHTimestampMs = candleMs;
      this.nyLTimestampMs = candleMs;
      this.clearConsumedKeysForType("NY_H");
      this.clearConsumedKeysForType("NY_L");
      this.currentNYHigh = null;
      this.currentNYLow = null;
    }
  }

  // ─── MAJOR SWINGS ─────────────────────────────────────────────────────────

  private evaluateMajorSwings(candles: Candle[]): void {
    if (!this.inputs.showSwings) return;
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);

    const swPH = PineLiquidityEngine.f_pivotHigh(highs, this.inputs.swingPivotLen);
    const swPL = PineLiquidityEngine.f_pivotLow(lows, this.inputs.swingPivotLen);

    if (swPH !== null) {
      this.f_pushLevelUnique(
        this.swhPrices,
        this.swhTexts,
        [],
        this.inputs.maxSwingLevels,
        swPH,
        "15M+ Swing High",
        this.inputs.overlapTolPct
      );
    }

    if (swPL !== null) {
      this.f_pushLevelUnique(
        this.swlPrices,
        this.swlTexts,
        [],
        this.inputs.maxSwingLevels,
        swPL,
        "15M+ Swing Low",
        this.inputs.overlapTolPct
      );
    }
  }

  // ─── ACTIVE LEVELS SNAPSHOT (CONSUMPTION & DEDUP FILTERED) ─────────────────

  public getActiveLevels(instrument?: string): ActiveLevel[] {
    const rawLevels: ActiveLevel[] = [];

    // EQH / EQL
    if (this.inputs.showEQ_15 || this.inputs.showEQ_1H || this.inputs.showEQ_4H || this.inputs.showEQ_D) {
      this.eqhPrices.forEach((price, idx) => {
        rawLevels.push({
          id: `eqh-${price.toFixed(2)}`,
          type: "EQH",
          label: this.inputs.showPriceInLabel ? `${this.eqhTexts[idx]}  ${price.toFixed(2)}` : this.eqhTexts[idx],
          price,
          timeframe: this.eqhTexts[idx].split("(")[1]?.replace(")", "") || "HTF",
          color: this.inputs.colEQH,
          lineStyle: "solid",
          lineWidth: this.eqhTexts[idx].includes("4H") || this.eqhTexts[idx].includes("D") ? 3 : 2,
          createdAtBar: this.barIndex,
        });
      });

      this.eqlPrices.forEach((price, idx) => {
        rawLevels.push({
          id: `eql-${price.toFixed(2)}`,
          type: "EQL",
          label: this.inputs.showPriceInLabel ? `${this.eqlTexts[idx]}  ${price.toFixed(2)}` : this.eqlTexts[idx],
          price,
          timeframe: this.eqlTexts[idx].split("(")[1]?.replace(")", "") || "HTF",
          color: this.inputs.colEQL,
          lineStyle: "solid",
          lineWidth: this.eqlTexts[idx].includes("4H") || this.eqlTexts[idx].includes("D") ? 3 : 2,
          createdAtBar: this.barIndex,
        });
      });
    }

    // PWH / PWL
    if (this.inputs.showPW) {
      if (this.pwhPrice !== null) {
        rawLevels.push({
          id: `pwh-${this.pwhPrice.toFixed(2)}`,
          type: "PWH",
          label: this.inputs.showPriceInLabel ? `PWH  ${this.pwhPrice.toFixed(2)}` : "PWH",
          price: this.pwhPrice,
          timeframe: "1W",
          color: this.inputs.colPWH,
          lineStyle: "dashed",
          lineWidth: 2,
          createdAtBar: this.barIndex,
        });
      }
      if (this.pwlPrice !== null) {
        rawLevels.push({
          id: `pwl-${this.pwlPrice.toFixed(2)}`,
          type: "PWL",
          label: this.inputs.showPriceInLabel ? `PWL  ${this.pwlPrice.toFixed(2)}` : "PWL",
          price: this.pwlPrice,
          timeframe: "1W",
          color: this.inputs.colPWL,
          lineStyle: "dashed",
          lineWidth: 2,
          createdAtBar: this.barIndex,
        });
      }
    }

    // PDH / PDL
    if (this.inputs.showPD) {
      if (this.pdhPrice !== null) {
        rawLevels.push({
          id: `pdh-${this.pdhPrice.toFixed(2)}`,
          type: "PDH",
          label: this.inputs.showPriceInLabel ? `PDH  ${this.pdhPrice.toFixed(2)}` : "PDH",
          price: this.pdhPrice,
          timeframe: "1D",
          color: this.inputs.colPDH,
          lineStyle: "solid",
          lineWidth: 2,
          createdAtBar: this.barIndex,
        });
      }
      if (this.pdlPrice !== null) {
        rawLevels.push({
          id: `pdl-${this.pdlPrice.toFixed(2)}`,
          type: "PDL",
          label: this.inputs.showPriceInLabel ? `PDL  ${this.pdlPrice.toFixed(2)}` : "PDL",
          price: this.pdlPrice,
          timeframe: "1D",
          color: this.inputs.colPDL,
          lineStyle: "solid",
          lineWidth: 2,
          createdAtBar: this.barIndex,
        });
      }
    }

    // PMH / PML
    if (this.inputs.showPM) {
      if (this.pmhPrice !== null) {
        rawLevels.push({
          id: `pmh-${this.pmhPrice.toFixed(2)}`,
          type: "PMH",
          label: this.inputs.showPriceInLabel ? `PMH  ${this.pmhPrice.toFixed(2)}` : "PMH",
          price: this.pmhPrice,
          timeframe: "1M",
          color: this.inputs.colPMH,
          lineStyle: "solid",
          lineWidth: 3,
          createdAtBar: this.barIndex,
        });
      }
      if (this.pmlPrice !== null) {
        rawLevels.push({
          id: `pml-${this.pmlPrice.toFixed(2)}`,
          type: "PML",
          label: this.inputs.showPriceInLabel ? `PML  ${this.pmlPrice.toFixed(2)}` : "PML",
          price: this.pmlPrice,
          timeframe: "1M",
          color: this.inputs.colPML,
          lineStyle: "solid",
          lineWidth: 3,
          createdAtBar: this.barIndex,
        });
      }
    }

    // Sessions (Asia, London, New York)
    if (this.inputs.showSessions) {
      if (this.asiaHPrice !== null) {
        rawLevels.push({
          id: `asia_h-${this.asiaHPrice.toFixed(2)}`,
          type: "ASIA_H",
          label: this.inputs.showPriceInLabel ? `Asia High  ${this.asiaHPrice.toFixed(2)}` : "Asia High",
          price: this.asiaHPrice,
          timeframe: "Session",
          color: this.inputs.colAsiaH,
          lineStyle: "dashed",
          lineWidth: 1,
          createdAtBar: this.barIndex,
        });
      }
      if (this.asiaLPrice !== null) {
        rawLevels.push({
          id: `asia_l-${this.asiaLPrice.toFixed(2)}`,
          type: "ASIA_L",
          label: this.inputs.showPriceInLabel ? `Asia Low  ${this.asiaLPrice.toFixed(2)}` : "Asia Low",
          price: this.asiaLPrice,
          timeframe: "Session",
          color: this.inputs.colAsiaL,
          lineStyle: "dashed",
          lineWidth: 1,
          createdAtBar: this.barIndex,
        });
      }
      if (this.londonHPrice !== null) {
        rawLevels.push({
          id: `london_h-${this.londonHPrice.toFixed(2)}`,
          type: "LONDON_H",
          label: this.inputs.showPriceInLabel ? `London High  ${this.londonHPrice.toFixed(2)}` : "London High",
          price: this.londonHPrice,
          timeframe: "Session",
          color: this.inputs.colLondonH,
          lineStyle: "dashed",
          lineWidth: 1,
          createdAtBar: this.barIndex,
        });
      }
      if (this.londonLPrice !== null) {
        rawLevels.push({
          id: `london_l-${this.londonLPrice.toFixed(2)}`,
          type: "LONDON_L",
          label: this.inputs.showPriceInLabel ? `London Low  ${this.londonLPrice.toFixed(2)}` : "London Low",
          price: this.londonLPrice,
          timeframe: "Session",
          color: this.inputs.colLondonL,
          lineStyle: "dashed",
          lineWidth: 1,
          createdAtBar: this.barIndex,
        });
      }
      if (this.nyHPrice !== null) {
        rawLevels.push({
          id: `ny_h-${this.nyHPrice.toFixed(2)}`,
          type: "NY_H",
          label: this.inputs.showPriceInLabel ? `NY High  ${this.nyHPrice.toFixed(2)}` : "NY High",
          price: this.nyHPrice,
          timeframe: "Session",
          color: this.inputs.colNYH,
          lineStyle: "dashed",
          lineWidth: 1,
          createdAtBar: this.barIndex,
        });
      }
      if (this.nyLPrice !== null) {
        rawLevels.push({
          id: `ny_l-${this.nyLPrice.toFixed(2)}`,
          type: "NY_L",
          label: this.inputs.showPriceInLabel ? `NY Low  ${this.nyLPrice.toFixed(2)}` : "NY Low",
          price: this.nyLPrice,
          timeframe: "Session",
          color: this.inputs.colNYL,
          lineStyle: "dashed",
          lineWidth: 1,
          createdAtBar: this.barIndex,
        });
      }
    }

    // 15M+ Major Swings
    if (this.inputs.showSwings) {
      this.swhPrices.forEach((price, idx) => {
        rawLevels.push({
          id: `swh-${price.toFixed(2)}`,
          type: "SWH",
          label: this.inputs.showPriceInLabel ? `${this.swhTexts[idx]}  ${price.toFixed(2)}` : this.swhTexts[idx],
          price,
          timeframe: "15M+",
          color: this.inputs.colSWH,
          lineStyle: "dotted",
          lineWidth: 2,
          createdAtBar: this.barIndex,
        });
      });

      this.swlPrices.forEach((price, idx) => {
        rawLevels.push({
          id: `swl-${price.toFixed(2)}`,
          type: "SWL",
          label: this.inputs.showPriceInLabel ? `${this.swlTexts[idx]}  ${price.toFixed(2)}` : this.swlTexts[idx],
          price,
          timeframe: "15M+",
          color: this.inputs.colSWL,
          lineStyle: "dotted",
          lineWidth: 2,
          createdAtBar: this.barIndex,
        });
      });
    }

    // OVERLAP / DUPLICATE FILTERING (avoid visual duplicate lines at effectively same price)
    const filteredLevels: ActiveLevel[] = [];
    const tolPct = this.inputs.overlapTolPct;

    for (const lvl of rawLevels) {
      const isOverlap = filteredLevels.some((existing) => {
        const maxP = Math.max(lvl.price, existing.price);
        return maxP > 0 && (Math.abs(lvl.price - existing.price) / maxP) * 100 <= tolPct;
      });

      if (!isOverlap) {
        filteredLevels.push(lvl);
      }
    }

    return filteredLevels;
  }

  public getPDZoneState(): PremiumDiscountZoneState {
    return {
      active: false,
      top: null,
      bottom: null,
      equilibrium: null,
      lastPH: null,
      lastPL: null,
    };
  }
}
