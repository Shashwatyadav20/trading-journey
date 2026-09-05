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
 * Our market data providers (Coinbase for BTC, XAUS for XAU) deliver UTC-timestamped candles with no
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

  // PWH / PWL state (set from completed weekly candle [high[1], low[1]])
  private pwhPrice: number | null = null;
  private pwlPrice: number | null = null;

  // Track previous pivots for equality checks per timeframe
  private prevPH15: number | null = null;
  private prevPL15: number | null = null;

  private prevPH1H: number | null = null;
  private prevPL1H: number | null = null;

  private prevPH4H: number | null = null;
  private prevPL4H: number | null = null;

  private prevPHD: number | null = null;
  private prevPLD: number | null = null;

  // Premium / Discount Zone state machine
  private pdLastPH: number | null = null;
  private pdLastPL: number | null = null;
  private pdZoneTop: number | null = null;
  private pdZoneBot: number | null = null;
  private pdZoneActive: boolean = false;

  // Bar history per timeframe
  private baseCandles: Candle[] = [];   // 1M base candles from provider
  private tf15Candles: Candle[] = [];
  private tf60Candles: Candle[] = [];
  private tf240Candles: Candle[] = [];
  private tfDailyCandles: Candle[] = [];
  private tfWeeklyCandles: Candle[] = [];
  /**
   * tfChartCandles — aggregated candles for the active chart timeframe.
   *
   * Pine logic for swing detection:
   *   useForced15 = chartTFinMinutes < 15
   *   tfToUse = useForced15 ? "15" : timeframe.period
   *
   * When chartTFinMinutes >= 15, swings must use the chart TF candle series,
   * NOT the raw 1M baseCandles.
   *
   * For the four well-known TFs (15, 60, 240, 1440) we reuse the existing
   * dedicated buffers. For any other TF >= 15 (e.g. 30M) we maintain this
   * separate buffer.
   */
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
      // Re-evaluate major swings for the new timeframe
      const swingCandles = this.getSwingCandles();
      if (swingCandles.length >= this.inputs.swingPivotLen * 2 + 1) {
        this.evaluateMajorSwings(swingCandles);
      }
    }
  }

  // ─── PINE HELPER FUNCTIONS (1:1 Port) ──────────────────────────────────────

  public static f_pivotHigh(highs: number[], len: number): number | null {
    const idx = highs.length - 1 - len;
    if (idx < len) return null;
    const targetPrice = highs[idx];

    // Must be > all len bars to the left
    for (let k = idx - len; k < idx; k++) {
      if (highs[k] >= targetPrice) return null;
    }
    // Must be > all len bars to the right
    for (let k = idx + 1; k <= highs.length - 1; k++) {
      if (highs[k] >= targetPrice) return null;
    }

    return targetPrice;
  }

  public static f_pivotLow(lows: number[], len: number): number | null {
    const idx = lows.length - 1 - len;
    if (idx < len) return null;
    const targetPrice = lows[idx];

    // Must be < all len bars to the left
    for (let k = idx - len; k < idx; k++) {
      if (lows[k] <= targetPrice) return null;
    }
    // Must be < all len bars to the right
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
    currentLow: number
  ): void {
    if (priceArr.length === 0) return;

    for (let i = priceArr.length - 1; i >= 0; i--) {
      const p = priceArr[i];
      const broken = isHighType ? currentHigh >= p : currentLow <= p;
      if (broken) {
        priceArr.splice(i, 1);
        textArr.splice(i, 1);
      }
    }
  }

  // ─── ATR CALCULATION ────────────────────────────────────────────────────────

  private calculateATR(candles: Candle[], length: number): number {
    if (candles.length < length + 1) return 0;
    const trs: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevClose = candles[i - 1].close;
      const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
      trs.push(tr);
    }
    const recentTrs = trs.slice(-length);
    const sum = recentTrs.reduce((a, b) => a + b, 0);
    return sum / length;
  }

  // ─── CANDLE PROCESSOR ───────────────────────────────────────────────────────

  public processCandle(candle: Candle): void {
    this.barIndex++;
    this.baseCandles.push(candle);

    // 1. Aggregations & Pivots on Timeframes
    this.aggregateTimeframes(candle);

    // 2. Wick-Based Invalidation (Evaluated EVERY candle, against EQH/EQL/SWH/SWL only)
    // NOTE: PWH/PWL are intentionally NOT passed through f_removeBroken —
    // they persist throughout the entire week matching Pine behavior.
    this.f_removeBroken(this.eqhPrices, this.eqhTexts, true, candle.high, candle.low);
    this.f_removeBroken(this.eqlPrices, this.eqlTexts, false, candle.high, candle.low);
    this.f_removeBroken(this.swhPrices, this.swhTexts, true, candle.high, candle.low);
    this.f_removeBroken(this.swlPrices, this.swlTexts, false, candle.high, candle.low);
  }

  // ─── TIMEFRAME AGGREGATION & HTF PROCESSING ────────────────────────────────

  private aggregateTimeframes(candle: Candle): void {
    // 15M Aggregation
    const isNew15M = this.updateTfBuffer(this.tf15Candles, candle, 15);
    if (isNew15M && this.tf15Candles.length >= this.inputs.eqPivotLen * 2 + 1) {
      this.evaluateEQH_EQL_15M();
      this.evaluatePDZone15M();
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

    // Daily Aggregation
    const isNewDaily = this.updateTfBuffer(this.tfDailyCandles, candle, 1440);
    if (isNewDaily && this.tfDailyCandles.length >= this.inputs.eqPivotLen * 2 + 1) {
      this.evaluateEQH_EQL_Daily();
    }

    // Weekly Aggregation (PWH / PWL)
    // See class-level comment for the known limitation on weekly boundary semantics.
    const isNewWeekly = this.updateWeeklyBuffer(candle);
    if (isNewWeekly && this.tfWeeklyCandles.length >= 2) {
      this.evaluatePreviousWeek();
    }

    // Chart TF Aggregation (for swing detection on non-standard TFs >= 15 and != 60, 240, 1440)
    if (this.chartTFinMinutes >= 15 &&
        this.chartTFinMinutes !== 15 &&
        this.chartTFinMinutes !== 60 &&
        this.chartTFinMinutes !== 240 &&
        this.chartTFinMinutes !== 1440) {
      this.updateTfBuffer(this.tfChartCandles, candle, this.chartTFinMinutes);
    }

    // 15M+ Major Swings — Pine logic: useForced15 ? "15" : timeframe.period
    const swingCandles = this.getSwingCandles();
    if (swingCandles.length >= this.inputs.swingPivotLen * 2 + 1) {
      this.evaluateMajorSwings(swingCandles);
    }
  }

  /**
   * Returns the candle series to use for swing pivot detection.
   *
   * Pine script:
   *   chartTFinMinutes = timeframe.in_seconds(timeframe.period) / 60
   *   useForced15 = chartTFinMinutes < 15
   *   tfToUse = useForced15 ? "15" : timeframe.period
   *
   * Rules:
   *   chart < 15  → 15M
   *   chart = 15  → 15M
   *   chart = 30  → tfChartCandles (30M buffer)
   *   chart = 60  → 1H buffer
   *   chart = 240 → 4H buffer
   *   chart = 1440 → Daily buffer
   */
  public getSwingCandles(): Candle[] {
    if (this.chartTFinMinutes < 15) {
      return this.tf15Candles;
    }
    if (this.chartTFinMinutes === 15) {
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
    // Any other TF >= 15 (e.g. 30M) uses dedicated tfChartCandles
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
      // Update existing candle in bucket
      const last = buffer[buffer.length - 1];
      last.high = Math.max(last.high, candle.high);
      last.low = Math.min(last.low, candle.low);
      last.close = candle.close;
      last.volume += candle.volume;
      return false;
    } else {
      // New bucket started → complete previous bucket, open new one
      buffer.push({ ...candle, timestamp: new Date(bucketStart).toISOString() });
      return true;
    }
  }

  /**
   * Aggregates weekly candles using Monday 00:00:00 UTC as the week boundary (ISO-8601 weeks).
   *
   * KNOWN LIMITATION: TradingView's "W" timeframe uses symbol/exchange session calendars:
   *   - BTC/USD: Sunday 00:00 UTC start (Coinbase, 24/7)
   *   - XAU/USD: Sunday ~21:00 UTC start (FX Sunday open, session-dependent)
   * This backend implementation uses Monday 00:00 UTC (closest reproducible approximation
   * from raw UTC OHLC data). See class-level documentation for full details.
   */
  private updateWeeklyBuffer(candle: Candle): boolean {
    const d = new Date(candle.timestamp);
    // ISO-8601: Monday = start of week
    const day = d.getUTCDay();            // 0=Sun, 1=Mon, ... 6=Sat
    const diffToMon = (day + 6) % 7;     // days since last Monday
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

  // ─── 1. HTF EQH / EQL EVALUATIONS ──────────────────────────────────────────

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
      this.prevPH15 = ph15; // Always update on every confirmed pivot
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

  // ─── 2. PREVIOUS WEEK HIGH / LOW ───────────────────────────────────────────

  private evaluatePreviousWeek(): void {
    if (!this.inputs.showPW) return;
    // Pine: [high[1], low[1]] on "W" series = last completed weekly candle
    const prevWeekCandle = this.tfWeeklyCandles[this.tfWeeklyCandles.length - 2];
    if (prevWeekCandle) {
      this.pwhPrice = prevWeekCandle.high;
      this.pwlPrice = prevWeekCandle.low;
    }
  }

  // ─── 3. 15M+ MAJOR SWINGS ─────────────────────────────────────────────────

  private evaluateMajorSwings(candles: Candle[]): void {
    if (!this.inputs.showSwings) return;
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);

    const swPH = PineLiquidityEngine.f_pivotHigh(highs, this.inputs.swingPivotLen);
    const swPL = PineLiquidityEngine.f_pivotLow(lows, this.inputs.swingPivotLen);

    if (swPH !== null) {
      // Swings pass empty array [] for crossArr (NEVER suppressed by EQH/EQL)
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

  // ─── 4. PREMIUM / DISCOUNT ZONE STATE MACHINE ───────────────────────────────

  private evaluatePDZone15M(): void {
    if (!this.inputs.showPDZone) return;
    const highs = this.tf15Candles.map((c) => c.high);
    const lows = this.tf15Candles.map((c) => c.low);

    const pdPH = PineLiquidityEngine.f_pivotHigh(highs, this.inputs.pdPivotLen);
    const pdPL = PineLiquidityEngine.f_pivotLow(lows, this.inputs.pdPivotLen);

    if (pdPH !== null) this.pdLastPH = pdPH;
    if (pdPL !== null) this.pdLastPL = pdPL;

    // Form zone once fresh swing high AND low are both available
    if (!this.pdZoneActive && this.pdLastPH !== null && this.pdLastPL !== null) {
      this.pdZoneTop = Math.max(this.pdLastPH, this.pdLastPL);
      this.pdZoneBot = Math.min(this.pdLastPH, this.pdLastPL);
      this.pdZoneActive = true;
    }

    // Breakout & Reset check on active zone (evaluated on candle close)
    if (this.pdZoneActive && this.pdZoneTop !== null && this.pdZoneBot !== null) {
      const atr = this.calculateATR(this.baseCandles, this.inputs.pdAtrLen);
      const pdAtrBuf = atr * this.inputs.pdAtrMult;

      const lastCandle = this.baseCandles[this.baseCandles.length - 1];
      if (lastCandle) {
        const brokenUp = lastCandle.close > this.pdZoneTop + pdAtrBuf;
        const brokenDown = lastCandle.close < this.pdZoneBot - pdAtrBuf;

        if (brokenUp || brokenDown) {
          // EXPLICIT RESET OF ALL STATE VARIABLES
          // A new zone cannot form until fresh PH AND PL confirmations occur.
          this.pdZoneActive = false;
          this.pdZoneTop = null;
          this.pdZoneBot = null;
          this.pdLastPH = null;
          this.pdLastPL = null;
        }
      }
    }
  }

  // ─── ACTIVE LEVELS SNAPSHOT ────────────────────────────────────────────────

  public getActiveLevels(): ActiveLevel[] {
    const levels: ActiveLevel[] = [];

    // EQH
    if (this.inputs.showEQ_15 || this.inputs.showEQ_1H || this.inputs.showEQ_4H || this.inputs.showEQ_D) {
      this.eqhPrices.forEach((price, idx) => {
        levels.push({
          id: `eqh-${idx}-${price}`,
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
        levels.push({
          id: `eql-${idx}-${price}`,
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
        levels.push({
          id: `pwh-${this.pwhPrice}`,
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
        levels.push({
          id: `pwl-${this.pwlPrice}`,
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

    // 15M+ Swings
    if (this.inputs.showSwings) {
      this.swhPrices.forEach((price, idx) => {
        levels.push({
          id: `swh-${idx}-${price}`,
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
        levels.push({
          id: `swl-${idx}-${price}`,
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

    // P/D Zone
    if (this.inputs.showPDZone && this.pdZoneActive && this.pdZoneTop !== null && this.pdZoneBot !== null) {
      const eq = (this.pdZoneTop + this.pdZoneBot) / 2;
      levels.push({
        id: `pd-premium-${this.pdZoneTop}`,
        type: "PREMIUM",
        label: this.inputs.showPriceInLabel ? `Premium  ${this.pdZoneTop.toFixed(2)}` : "Premium",
        price: this.pdZoneTop,
        timeframe: this.inputs.pdZoneTF,
        color: this.inputs.colPremium,
        lineStyle: "solid",
        lineWidth: 1,
        createdAtBar: this.barIndex,
      });

      levels.push({
        id: `pd-discount-${this.pdZoneBot}`,
        type: "DISCOUNT",
        label: this.inputs.showPriceInLabel ? `Discount  ${this.pdZoneBot.toFixed(2)}` : "Discount",
        price: this.pdZoneBot,
        timeframe: this.inputs.pdZoneTF,
        color: this.inputs.colDiscount,
        lineStyle: "solid",
        lineWidth: 1,
        createdAtBar: this.barIndex,
      });

      if (this.inputs.showEqLine) {
        levels.push({
          id: `pd-eq-${eq}`,
          type: "EQUILIBRIUM",
          label: this.inputs.showPriceInLabel ? `Equilibrium  ${eq.toFixed(2)}` : "Equilibrium",
          price: eq,
          timeframe: this.inputs.pdZoneTF,
          color: this.inputs.colEqLine,
          lineStyle: "dashed",
          lineWidth: 1,
          createdAtBar: this.barIndex,
        });
      }
    }

    return levels;
  }

  public getPDZoneState(): PremiumDiscountZoneState {
    return {
      active: this.pdZoneActive,
      top: this.pdZoneTop,
      bottom: this.pdZoneBot,
      equilibrium:
        this.pdZoneTop !== null && this.pdZoneBot !== null
          ? (this.pdZoneTop + this.pdZoneBot) / 2
          : null,
      lastPH: this.pdLastPH,
      lastPL: this.pdLastPL,
    };
  }
}
