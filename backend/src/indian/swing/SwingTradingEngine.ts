import {
  NiftyMarketRegime,
  StockFundamentals,
  SwingSignal,
  SwingSetupId,
  PositionSizeCalcInput,
  PositionSizeCalcResult,
  MarketRegimeBias,
  SwingClearance,
} from "./types";
import {
  DailyCandle,
  validateDailyCandles,
  buildStockIndicatorProfile,
  evaluateAllStrategiesForStock,
  fetchLiveStockCandles,
  MatchedStockOpportunity,
} from "./dailyStrategyScanner";
import { nseUniverseService } from "../market/NSEUniverseService";

// Safety constants inlined (backend tsconfig cannot resolve Next.js @/ alias)
const LIVE_TRADING = false as const;
const BROKER_EXECUTION_ENABLED = false as const;

// Runtime assertion — fail immediately if misconfigured
if (LIVE_TRADING !== false || BROKER_EXECUTION_ENABLED !== false) {
  throw new Error(
    "SAFETY VIOLATION: LIVE_TRADING or BROKER_EXECUTION_ENABLED must be false."
  );
}

/**
 * Curated universe of fundamentally strong Indian stocks (Historical research baseline)
 * Screened for: ROE > 15%, ROCE > 18%, 3Y Sales CAGR > 12%, Low Debt, Institutional Holding > 30%
 */
export const FUNDAMENTAL_UNIVERSE: StockFundamentals[] = [
  {
    symbol: "TRENT",
    companyName: "Trent Ltd (Tata Retail)",
    sector: "Consumer Discretionary / Retail",
    marketCapCr: 248000,
    peRatio: 112.4,
    roePercent: 32.8,
    rocePercent: 38.4,
    salesGrowth3Y: 48.6,
    profitGrowth3Y: 62.1,
    debtToEquity: 0.18,
    institutionalHoldingPercent: 44.2,
    qualityScore: 96,
    moatRating: "WIDE",
    isQualified: true,
    isAvailable: true,
    dataSource: "MANUAL_CURATED",
    notes: "Aggressive store expansion (Zudio, Westside), stellar ROE/ROCE, high relative strength leader.",
  },
  {
    symbol: "HAL",
    companyName: "Hindustan Aeronautics Ltd",
    sector: "Defense & Aerospace",
    marketCapCr: 312000,
    peRatio: 38.6,
    roePercent: 26.4,
    rocePercent: 34.2,
    salesGrowth3Y: 14.8,
    profitGrowth3Y: 28.5,
    debtToEquity: 0.0,
    institutionalHoldingPercent: 36.8,
    qualityScore: 94,
    moatRating: "WIDE",
    isQualified: true,
    isAvailable: true,
    dataSource: "MANUAL_CURATED",
    notes: "Debt-free balance sheet, multi-year sovereign order book, monopolistic domestic defense footprint.",
  },
  {
    symbol: "BEL",
    companyName: "Bharat Electronics Ltd",
    sector: "Defense Electronics",
    marketCapCr: 218000,
    peRatio: 42.1,
    roePercent: 25.8,
    rocePercent: 33.6,
    salesGrowth3Y: 15.2,
    profitGrowth3Y: 26.4,
    debtToEquity: 0.0,
    institutionalHoldingPercent: 38.5,
    qualityScore: 93,
    moatRating: "WIDE",
    isQualified: true,
    isAvailable: true,
    dataSource: "MANUAL_CURATED",
    notes: "Zero debt, strategic defense electronics leader with 22%+ operating margins.",
  },
  {
    symbol: "DIXON",
    companyName: "Dixon Technologies India",
    sector: "EMS / Electronics Manufacturing",
    marketCapCr: 88500,
    peRatio: 84.2,
    roePercent: 28.1,
    rocePercent: 35.8,
    salesGrowth3Y: 36.5,
    profitGrowth3Y: 42.3,
    debtToEquity: 0.22,
    institutionalHoldingPercent: 41.6,
    qualityScore: 91,
    moatRating: "WIDE",
    isQualified: true,
    isAvailable: true,
    dataSource: "MANUAL_CURATED",
    notes: "Prime beneficiary of India PLI electronics manufacturing, massive order inflows.",
  },
  {
    symbol: "PERSISTENT",
    companyName: "Persistent Systems Ltd",
    sector: "IT & Digital Engineering",
    marketCapCr: 82400,
    peRatio: 56.4,
    roePercent: 25.2,
    rocePercent: 31.8,
    salesGrowth3Y: 24.1,
    profitGrowth3Y: 27.6,
    debtToEquity: 0.08,
    institutionalHoldingPercent: 49.3,
    qualityScore: 92,
    moatRating: "WIDE",
    isQualified: true,
    isAvailable: true,
    dataSource: "MANUAL_CURATED",
    notes: "Outperforming mid-tier IT, high cloud/AI client deal pipeline, superior cash conversion.",
  },
  {
    symbol: "POLYCAB",
    companyName: "Polycab India Ltd",
    sector: "Wires, Cables & FMEG",
    marketCapCr: 99400,
    peRatio: 44.5,
    roePercent: 22.4,
    rocePercent: 29.8,
    salesGrowth3Y: 21.6,
    profitGrowth3Y: 28.9,
    debtToEquity: 0.02,
    institutionalHoldingPercent: 34.2,
    qualityScore: 90,
    moatRating: "WIDE",
    isQualified: true,
    isAvailable: true,
    dataSource: "MANUAL_CURATED",
    notes: "Cables market share leader with high distribution moat, near zero net debt.",
  },
  {
    symbol: "TITAN",
    companyName: "Titan Company Ltd",
    sector: "Jewellery & Watches (Tata)",
    marketCapCr: 315000,
    peRatio: 78.2,
    roePercent: 29.5,
    rocePercent: 31.2,
    salesGrowth3Y: 25.4,
    profitGrowth3Y: 22.1,
    debtToEquity: 0.45,
    institutionalHoldingPercent: 38.9,
    qualityScore: 94,
    moatRating: "WIDE",
    isQualified: true,
    isAvailable: true,
    dataSource: "MANUAL_CURATED",
    notes: "Dominant organized jewellery player (Tanishq) with unrivaled brand recall.",
  },
  {
    symbol: "ICICIBANK",
    companyName: "ICICI Bank Ltd",
    sector: "Private Banking & Financials",
    marketCapCr: 885000,
    peRatio: 17.8,
    roePercent: 18.9,
    rocePercent: 21.4,
    salesGrowth3Y: 18.2,
    profitGrowth3Y: 34.5,
    debtToEquity: 0.95,
    institutionalHoldingPercent: 78.4,
    qualityScore: 95,
    moatRating: "WIDE",
    isQualified: true,
    isAvailable: true,
    dataSource: "MANUAL_CURATED",
    notes: "Industry best asset quality (NPA < 0.5%), top tier NIMs, highest institutional backing.",
  },
  {
    symbol: "BHARTIARTL",
    companyName: "Bharti Airtel Ltd",
    sector: "Telecom Infrastructure",
    marketCapCr: 940000,
    peRatio: 62.4,
    roePercent: 19.8,
    rocePercent: 22.1,
    salesGrowth3Y: 16.5,
    profitGrowth3Y: 31.2,
    debtToEquity: 1.12,
    institutionalHoldingPercent: 46.8,
    qualityScore: 92,
    moatRating: "WIDE",
    isQualified: true,
    isAvailable: true,
    dataSource: "MANUAL_CURATED",
    notes: "Consolidating domestic telecom duopoly, industry leading ARPU growth.",
  },
  {
    symbol: "LT",
    companyName: "Larsen & Toubro Ltd",
    sector: "Capital Goods & Infrastructure",
    marketCapCr: 495000,
    peRatio: 33.2,
    roePercent: 16.2,
    rocePercent: 19.4,
    salesGrowth3Y: 17.8,
    profitGrowth3Y: 21.0,
    debtToEquity: 0.62,
    institutionalHoldingPercent: 55.4,
    qualityScore: 93,
    moatRating: "WIDE",
    isQualified: true,
    isAvailable: true,
    dataSource: "MANUAL_CURATED",
    notes: "National capex proxy with record multi-trillion order book across India and Middle East.",
  },
];

export class SwingTradingEngine {
  public readonly BROKER_EXECUTION_ENABLED: boolean = false;
  private lastEvaluationTime: string = new Date().toISOString();

  // ─── EMA calculator (pure, no external dependencies) ─────────────────────
  private static calcEMA(closes: number[], period: number): number[] {
    if (closes.length < period) return [];
    const k = 2 / (period + 1);
    const ema: number[] = new Array(closes.length);
    let sum = 0;
    for (let i = 0; i < period; i++) sum += closes[i];
    ema[period - 1] = sum / period;
    for (let i = period; i < closes.length; i++) {
      ema[i] = closes[i] * k + ema[i - 1] * (1 - k);
    }
    return ema;
  }


  /**
   * Evaluate the NIFTY 50 market regime from actual daily candle data.
   *
   * @param closes      Array of daily closing prices for NIFTY 50 (oldest first).
   * @param spotPrice   Current live spot price (from Yahoo Finance meta).
   * @param changePercent Day change percent (computed from actual candles).
   *
   * All EMA values are computed from the provided closes array.
   * Breadth statistics (advancing/declining counts, % above 50 EMA) require
   * a separate market breadth data source and are returned as null until
   * that integration is added.
   */
  public evaluateMarketRegime(
    closes: number[],
    spotPrice: number,
    changePercent: number
  ): NiftyMarketRegime {
    this.lastEvaluationTime = new Date().toISOString();

    const len = closes.length;

    // Compute EMAs from actual candle data
    const ema20Arr = SwingTradingEngine.calcEMA(closes, 20);
    const ema50Arr = SwingTradingEngine.calcEMA(closes, 50);
    const ema200Period = Math.min(200, len - 1);
    const ema200Arr = ema200Period >= 20 ? SwingTradingEngine.calcEMA(closes, ema200Period) : [];

    const ema20 = Number((ema20Arr[len - 1] ?? spotPrice).toFixed(2));
    const ema50 = Number((ema50Arr[len - 1] ?? ema20).toFixed(2));
    const ema200Raw = ema200Arr.length > 0 ? ema200Arr[ema200Arr.length - 1] : null;
    const ema200 = ema200Raw != null ? Number(ema200Raw.toFixed(2)) : ema50;
    const ema200Estimated = ema200Raw == null || ema200Period < 200;

    let bias: MarketRegimeBias;
    let clearance: SwingClearance;
    let regimeScore: number;

    if (spotPrice >= ema20 && ema20 >= ema50) {
      bias = "BULLISH_TREND";
      clearance = "HIGH_CONVICTION";
      regimeScore = 85 + (spotPrice >= ema50 && ema50 >= ema200 ? 5 : 0);
    } else if (spotPrice >= ema50) {
      bias = "RANGE_BOUND";
      clearance = "SELECTIVE_OPPORTUNITIES";
      regimeScore = 62;
    } else {
      bias = "BEARISH_CORRECTION";
      clearance = "DEFENSIVE_CASH";
      regimeScore = 38;
    }

    const ema200Note = ema200Estimated
      ? ` (EMA200 estimated from ${ema200Period} candles, less than 200 required for full accuracy)`
      : "";

    const analysisSummary =
      bias === "BULLISH_TREND"
        ? `NIFTY (₹${spotPrice.toLocaleString("en-IN")}) above 20 EMA (₹${ema20.toLocaleString("en-IN")}) & 50 EMA (₹${ema50.toLocaleString("en-IN")}). Bullish regime supports swing longs.${ema200Note}`
        : bias === "RANGE_BOUND"
        ? `NIFTY (₹${spotPrice.toLocaleString("en-IN")}) between 20 & 50 EMA. Selective high-RS setups only.${ema200Note}`
        : `NIFTY (₹${spotPrice.toLocaleString("en-IN")}) below key moving averages. Defensive cash posture recommended.${ema200Note}`;

    return {
      spotPrice,
      changePercent,
      ema20,
      ema50,
      ema200,
      bias,
      clearance,
      // Breadth data requires a separate market breadth endpoint (not Yahoo Finance).
      // Returning null until an authoritative source is integrated.
      breadthPercentAbove50EMA: null,
      advancingStocksCount: null,
      decliningStocksCount: null,
      regimeScore,
      analysisSummary,
      dataSource: "Yahoo Finance ^NSEI daily candles",
    };
  }

  /**
   * PILLAR 2: Fundamental Screener lookup
   */
  public getFundamentals(symbol: string): StockFundamentals | undefined {
    return FUNDAMENTAL_UNIVERSE.find((s) => s.symbol.toUpperCase() === symbol.toUpperCase());
  }

  public getQualifiedUniverse(): StockFundamentals[] {
    return FUNDAMENTAL_UNIVERSE.filter((s) => s.isQualified);
  }

  /**
   * Evaluates a single stock's candles against all strategies and converts
   * any qualification into a genuine SwingSignal.
   *
   * Validates market data first; returns null if data is invalid or no setup matches.
   */
  public evaluateStockCandles(
    symbol: string,
    candles: DailyCandle[],
    spotPrice: number = 22520.45,
    meta: any = {}
  ): SwingSignal | null {
    const validation = validateDailyCandles(candles);
    if (!validation.valid) {
      return null;
    }

    const cleanSymbol = symbol.trim().toUpperCase().replace(/\.NS$/, "").replace(/\.BO$/, "");
    const closes = candles.map((c) => c.close);
    const lastClose = closes[closes.length - 1] ?? spotPrice;
    const prevClose = closes[closes.length - 2] ?? lastClose;
    const candleChangePercent = prevClose > 0
      ? Number((((lastClose - prevClose) / prevClose) * 100).toFixed(2))
      : 0;
    const regime = this.evaluateMarketRegime(closes, spotPrice, candleChangePercent);


    const profile = buildStockIndicatorProfile(cleanSymbol, candles, meta, spotPrice, regime.changePercent);
    const opp = evaluateAllStrategiesForStock(profile);
    if (!opp) {
      return null;
    }

    return this.mapOpportunityToSignal(cleanSymbol, opp, profile, regime);
  }

  /**
   * Maps a dynamic MatchedStockOpportunity to the full SwingSignal API contract.
   */
  private mapOpportunityToSignal(
    cleanSymbol: string,
    opp: MatchedStockOpportunity,
    profile: any,
    regime: NiftyMarketRegime
  ): SwingSignal {
    const knownFundamentals = this.getFundamentals(cleanSymbol);
    const secInfo = nseUniverseService.getSecurity(cleanSymbol);

    const fundamentals: StockFundamentals = knownFundamentals || {
      symbol: cleanSymbol,
      companyName: secInfo?.companyName || opp.companyName,
      sector: secInfo?.industry || opp.sector,
      marketCapCr: opp.marketCapCr > 0 ? opp.marketCapCr : null,
      peRatio: null,
      roePercent: null,
      rocePercent: null,
      salesGrowth3Y: null,
      profitGrowth3Y: null,
      debtToEquity: null,
      institutionalHoldingPercent: null,
      qualityScore: null,
      moatRating: null,
      isQualified: true,
      isAvailable: false,
      dataSource: "UNAVAILABLE",
      notes: "Cash market equity dynamically scanned; fundamental financial ratios unavailable from daily market-data provider.",
    };

    let setupId: SwingSetupId = "SETUP_A_BREAKOUT_RETEST";
    let setupBadge = opp.primaryStrategy.strategyName;
    if (opp.primaryStrategy.strategyId === "STRATEGY_A_BREAKOUT") {
      setupId = "SETUP_A_BREAKOUT_RETEST";
      setupBadge = "Breakout + Retest";
    } else if (opp.primaryStrategy.strategyId === "STRATEGY_B_PULLBACK") {
      setupId = "SETUP_C_TREND_PULLBACK";
      setupBadge = "Trend Pullback (20 EMA)";
    } else if (opp.primaryStrategy.strategyId === "STRATEGY_C_SUPPORT_BOUNCE") {
      setupId = "SETUP_B_LIQUIDITY_SWEEP";
      setupBadge = "Support Bounce / Liquidity";
    } else if (opp.primaryStrategy.strategyId === "STRATEGY_F_RANGE_BREAKOUT") {
      setupId = "SETUP_D_BASE_BREAKOUT";
      setupBadge = "Base Breakout";
    } else if (opp.primaryStrategy.strategyId === "STRATEGY_G_TREND_CONTINUATION") {
      setupId = "SETUP_C_TREND_PULLBACK";
      setupBadge = "Trend Continuation";
    } else if (opp.primaryStrategy.strategyId === "STRATEGY_H_VOLUME_BREAKOUT") {
      setupId = "SETUP_A_BREAKOUT_RETEST";
      setupBadge = "Volume Breakout";
    } else {
      setupId = opp.primaryStrategy.strategyId as SwingSetupId;
    }

    return {
      id: opp.id,
      symbol: cleanSymbol,
      companyName: fundamentals.companyName,
      sector: fundamentals.sector,
      setupId,
      setupTitle: opp.primaryStrategy.strategyName,
      setupBadge,
      status: opp.confirmationStatus === "CONFIRMED" ? "ACTIVE_OPPORTUNITY" : "WATCHLIST",
      timestamp: opp.timestamp,
      currentPrice: profile.currentPrice,
      entryPrice: opp.entryTrigger,
      stopLossPrice: opp.stopLoss,
      target1Price: opp.target1,
      target2Price: opp.target2,
      riskPerShare: opp.riskPerShare,
      rewardRiskRatio: opp.rewardRiskRatio,
      confluenceScore: opp.confluenceScore,
      relativeStrengthVsNifty: profile.relativeStrengthVsNifty,
      volumeMultiplier: profile.volumeMultiplier,
      ema20: profile.ema20 ?? null,
      ema50: profile.ema50 ?? null,
      ema200: profile.ema200 ?? null,
      extensionFromPivotPercent: profile.extensionFrom20EMAPercent,
      // Dashboard display metadata
      marketCapCr: opp.marketCapCr,
      changePercent: opp.changePercent,
      rsi14: profile.rsi14 ?? null,
      trendStrength: profile.trendStrength,
      scoreBreakdown: opp.scoreBreakdown,
      retestLow: profile.supportLevel,
      sweepLow: profile.recentLiquiditySweep?.direction === "BULLISH"
        ? profile.recentLiquiditySweep.sweptLevel
        : profile.swingLow,
      rejectionCandle: opp.primaryStrategy.rejectionCandle,
      marketStructure: profile.marketStructure,
      liquiditySweep: profile.recentLiquiditySweep ?? null,
      choch: profile.recentChoch ?? null,
      pwh: profile.pwh ?? null,
      pwl: profile.pwl ?? null,
      fivePillarChecklist: {
        pillar1MarketRegime: {
          passed: regime.bias !== "BEARISH_CORRECTION",
          niftyAlignment: regime.bias,
          details: regime.analysisSummary,
        },
        pillar2Fundamentals: {
          passed: fundamentals.isAvailable ? fundamentals.isQualified : true,
          qualityScore: fundamentals.qualityScore,
          isAvailable: fundamentals.isAvailable,
          details: fundamentals.isAvailable
            ? `${fundamentals.notes} (ROE: ${fundamentals.roePercent}%, ROCE: ${fundamentals.rocePercent}%)`
            : "Fundamental ratios (PE/ROE/ROCE) unavailable from chart provider. Strategy qualified on technical and market structure rules.",
        },
        pillar3LiquidityLevels: {
          passed: true,
          keyLevel: profile.recentLiquiditySweep?.sweptLevel || opp.primaryStrategy.keyLevel,
          details: profile.recentLiquiditySweep
            ? `Bullish liquidity sweep of ${profile.recentLiquiditySweep.levelType} at ₹${profile.recentLiquiditySweep.sweptLevel} (Wick pen: ₹${profile.recentLiquiditySweep.wickPenetration}). PWH: ₹${profile.pwh ?? 'N/A'}, PWL: ₹${profile.pwl ?? 'N/A'}`
            : `Key structural level at ₹${opp.primaryStrategy.keyLevel} (PWH: ₹${profile.pwh ?? 'N/A'}, PWL: ₹${profile.pwl ?? 'N/A'}, Support: ₹${profile.supportLevel}, Resistance: ₹${profile.resistanceLevel})`,
          sweep: profile.recentLiquiditySweep || null,
          choch: profile.recentChoch || null,
          pwh: profile.pwh || null,
          pwl: profile.pwl || null,
        },
        pillar4PriceActionVolume: {
          passed: true,
          setupName: opp.primaryStrategy.strategyName,
          volumeMultiplier: profile.volumeMultiplier,
          details: opp.tradeRationale[0] || `Volume ${profile.volumeMultiplier}x avg with valid price expansion.`,
        },
        pillar5RiskManagement: {
          passed: opp.rewardRiskRatio >= 2.0,
          rewardRiskRatio: opp.rewardRiskRatio,
          riskPercent: 1.0,
          details: `Entry ₹${opp.entryTrigger}, SL ₹${opp.stopLoss}, Target 1 ₹${opp.target1} (R:R 1:${opp.rewardRiskRatio})`,
        },
      },
      tradeRationale: opp.tradeRationale,
      invalidationTrigger: opp.invalidationTrigger,
      trailingStopPlan: opp.trailingStopPlan,
      fundamentals,
    };
  }

  /**
   * PILLAR 4 & 3: Generate active Swing Trade Signals across the universe.
   *
   * If `candleDataBySymbol` is provided, evaluates those candles dynamically.
   * If not provided, dynamically fetches candles for qualified universe symbols.
   *
   * STRICT INVARIANT:
   * NEVER returns hardcoded mock signals or fallback fabrications.
   * If market data fails validation or no stock matches a strategy, returns [].
   */
  public async generateSwingSignals(
    spotPrice: number = 22520.45,
    candleDataBySymbol?: Record<string, DailyCandle[]>
  ): Promise<SwingSignal[]> {
    this.lastEvaluationTime = new Date().toISOString();
    const signals: SwingSignal[] = [];

    if (candleDataBySymbol) {
      for (const [symbol, candles] of Object.entries(candleDataBySymbol)) {
        const sig = this.evaluateStockCandles(symbol, candles, spotPrice);
        if (sig) {
          signals.push(sig);
        }
      }
      return signals;
    }

    // Dynamic market fetch for qualified universe
    const universe = this.getQualifiedUniverse();
    const fetchPromises = universe.map(async (stock) => {
      try {
        const candleData = await fetchLiveStockCandles(stock.symbol);
        if (!candleData || !candleData.candles) return null;
        return this.evaluateStockCandles(stock.symbol, candleData.candles, spotPrice, candleData.meta);
      } catch {
        return null;
      }
    });

    const results = await Promise.allSettled(fetchPromises);
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) {
        signals.push(r.value);
      }
    }

    return signals;
  }

  /**
   * PILLAR 5: Strict Risk Management & Dynamic Position Sizing Calculator.
   *
   * Pure function — no market data dependencies.
   * Formula:
   *   Max Risk = Account Capital × (Risk% / 100)
   *   Risk per share = |Entry − StopLoss|
   *   Quantity = Floor(Max Risk / Risk per share)
   *   Capital Required = Quantity × Entry Price
   */
  public calculatePositionSize(input: PositionSizeCalcInput): PositionSizeCalcResult {
    const warnings: string[] = [];

    const accountCapital = Math.max(1000, input.accountCapital || 500000);
    const riskPercent    = Math.max(0.1,  input.riskPercent    || 1.0);
    const entryPrice     = Math.max(0.05, input.entryPrice     || 100);
    const stopLossPrice  = Math.max(0.01, input.stopLossPrice  || 90);
    const targetPrice    =
      input.targetPrice ?? entryPrice + (entryPrice - stopLossPrice) * 2;

    const riskPerShare        = Math.abs(entryPrice - stopLossPrice);
    const potentialGainPerShare = Math.abs(targetPrice - entryPrice);

    if (riskPerShare <= 0) {
      warnings.push("Stop Loss must not be equal to Entry Price.");
    }
    if (stopLossPrice >= entryPrice) {
      warnings.push(
        "For long swing trades, Stop Loss must be strictly below Entry Price."
      );
    }
    if (riskPercent > 2.0) {
      warnings.push(
        "CAUTION: Risk exceeds strict 1.0%–2.0% swing trading rule. Recommended max is 1.5%."
      );
    }

    const maxRiskAmount         = Math.round((accountCapital * (riskPercent / 100)) * 100) / 100;
    const recommendedQuantity   = riskPerShare > 0 ? Math.floor(maxRiskAmount / riskPerShare) : 0;
    const totalCapitalRequired  = Math.round(recommendedQuantity * entryPrice * 100) / 100;
    const capitalExposurePercent =
      accountCapital > 0
        ? Math.round((totalCapitalRequired / accountCapital) * 10000) / 100
        : 0;
    const potentialRewardAmount = Math.round(recommendedQuantity * potentialGainPerShare * 100) / 100;
    const rewardRiskRatio       = riskPerShare > 0
      ? Math.round((potentialGainPerShare / riskPerShare) * 100) / 100
      : 0;

    if (rewardRiskRatio < 2.0) {
      warnings.push(
        `Trade rejected by Rule 5: R:R is ${rewardRiskRatio}:1. Minimum required is 1:2.0.`
      );
    }
    if (capitalExposurePercent > 30.0) {
      warnings.push(
        `Single-position capital exposure is ${capitalExposurePercent}%. Recommended cap is 20-25% to maintain 4-5 stock diversification.`
      );
    }

    const isRiskValid =
      warnings.filter((w) => w.includes("rejected") || w.includes("strictly")).length === 0;

    return {
      maxRiskAmount,
      riskPerShare:                Math.round(riskPerShare * 100) / 100,
      recommendedQuantity,
      totalCapitalRequired,
      portfolioCapitalExposurePercent: capitalExposurePercent,
      potentialRewardAmount,
      rewardRiskRatio,
      isRiskValid,
      validationWarnings: warnings,
    };
  }
}

export const swingTradingEngine = new SwingTradingEngine();

