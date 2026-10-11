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

/**
 * Curated universe of fundamentally strong Indian stocks
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
    notes: "National capex proxy with record multi-trillion order book across India and Middle East.",
  },
];

export class SwingTradingEngine {
  private lastEvaluationTime: string = new Date().toISOString();

  /**
   * PILLAR 1: Evaluate Market Regime (NIFTY 50 trend & breadth)
   */
  public evaluateMarketRegime(spotPrice: number = 24700.45): NiftyMarketRegime {
    const ema20 = 24580.0;
    const ema50 = 24320.0;
    const ema200 = 23150.0;
    const changePercent = +0.52;

    let bias: MarketRegimeBias = "BULLISH_TREND";
    let clearance: SwingClearance = "HIGH_CONVICTION";
    let regimeScore = 88;

    if (spotPrice > ema20 && ema20 > ema50 && ema50 > ema200) {
      bias = "BULLISH_TREND";
      clearance = "HIGH_CONVICTION";
      regimeScore = 88;
    } else if (spotPrice >= ema50 && spotPrice <= ema20) {
      bias = "RANGE_BOUND";
      clearance = "SELECTIVE_OPPORTUNITIES";
      regimeScore = 65;
    } else {
      bias = "BEARISH_CORRECTION";
      clearance = "DEFENSIVE_CASH";
      regimeScore = 40;
    }

    return {
      spotPrice,
      changePercent,
      ema20,
      ema50,
      ema200,
      bias,
      clearance,
      breadthPercentAbove50EMA: 74.5,
      advancingStocksCount: 36,
      decliningStocksCount: 14,
      regimeScore,
      analysisSummary:
        bias === "BULLISH_TREND"
          ? "NIFTY trading cleanly above 20 EMA & 50 EMA. Broad market breadth is strong (74% > 50 EMA). Swing long setups have full clearance."
          : bias === "RANGE_BOUND"
          ? "NIFTY in multi-week consolidation between 24,200 and 24,800. Only selective high-relative-strength setups recommended."
          : "NIFTY below critical moving averages. Preserve capital, swing trading clearance is defensive.",
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
   * PILLAR 4 & 3: Generate active Swing Trade Signals across the 4 setups
   */
  public generateSwingSignals(spotPrice: number = 24700.45): SwingSignal[] {
    const regime = this.evaluateMarketRegime(spotPrice);
    const nowIso = new Date().toISOString();

    const signals: SwingSignal[] = [
      // ────────────────────────────────────────────────────────────────────────
      // SETUP A: Breakout + Retest (e.g. TRENT)
      // ────────────────────────────────────────────────────────────────────────
      {
        id: "SWING-SIG-001",
        symbol: "TRENT",
        companyName: "Trent Ltd",
        sector: "Retail",
        setupId: "SETUP_A_BREAKOUT_RETEST",
        setupTitle: "Setup A — Breakout + Retest",
        setupBadge: "Breakout + Retest",
        status: "ACTIVE_OPPORTUNITY",
        timestamp: nowIso,
        currentPrice: 7120.0,
        entryPrice: 7145.0, // Above confirmation candle high
        stopLossPrice: 6980.0, // Below retest swing low
        target1Price: 7475.0, // 1:2 R:R (165 risk * 2 = 330 gain)
        target2Price: 7640.0, // 1:3 R:R
        riskPerShare: 165.0,
        rewardRiskRatio: 2.0,
        confluenceScore: 94,
        relativeStrengthVsNifty: 92,
        volumeMultiplier: 1.85,
        ema20: 6950.0,
        ema50: 6680.0,
        ema200: 5540.0,
        retestLow: 6985.0,
        rejectionCandle: "Bullish Hammer / Pin Bar rejection at 7,000 flip",
        fivePillarChecklist: {
          pillar1MarketRegime: {
            passed: true,
            niftyAlignment: "BULLISH_TREND",
            details: "NIFTY > 20 EMA, market regime score 88/100 supporting fresh swing longs.",
          },
          pillar2Fundamentals: {
            passed: true,
            qualityScore: 96,
            details: "ROE 32.8%, ROCE 38.4%, 3Y Sales CAGR 48.6%, Debt/Eq 0.18.",
          },
          pillar3LiquidityLevels: {
            passed: true,
            keyLevel: 7000.0,
            details: "Previous multi-week consolidation resistance at 7,000 successfully broken & flipped to support.",
          },
          pillar4PriceActionVolume: {
            passed: true,
            setupName: "Breakout + Retest",
            volumeMultiplier: 1.85,
            details: "Breakout volume 1.85x 20-day average, followed by low-volume retest and hammer confirmation candle.",
          },
          pillar5RiskManagement: {
            passed: true,
            rewardRiskRatio: 2.0,
            riskPercent: 1.0,
            details: "Defined risk: Entry ₹7,145, SL ₹6,980 (₹165 risk/sh). Target ₹7,475 guarantees 1:2.0 R:R.",
          },
        },
        tradeRationale: [
          "Stock is in an aggressive uptrend above 20 & 50 EMA with Higher Highs structure.",
          "Consolidation resistance at ₹7,000 broken on 1.85x volume surge.",
          "Controlled 3-day pullback retested the ₹7,000 flip level with drying volume.",
          "Strong bullish hammer rejection printed on retest level; confirmation close above ₹7,145.",
        ],
        invalidationTrigger: "Daily candle close below ₹6,980 invalidates the breakout structure.",
        trailingStopPlan: "Move SL to Breakeven (₹7,145) once price touches 1R (₹7,310). Trail remainder below 20 EMA.",
        fundamentals: this.getFundamentals("TRENT")!,
      },

      // ────────────────────────────────────────────────────────────────────────
      // SETUP B: Liquidity Sweep + Reversal (e.g. HAL)
      // ────────────────────────────────────────────────────────────────────────
      {
        id: "SWING-SIG-002",
        symbol: "HAL",
        companyName: "Hindustan Aeronautics Ltd",
        sector: "Defense & Aerospace",
        setupId: "SETUP_B_LIQUIDITY_SWEEP",
        setupTitle: "Setup B — Liquidity Sweep + Reversal",
        setupBadge: "Liquidity Sweep + CHoCH",
        status: "ACTIVE_OPPORTUNITY",
        timestamp: nowIso,
        currentPrice: 4725.0,
        entryPrice: 4740.0, // Confirmed reclaim close
        stopLossPrice: 4615.0, // Below sweep low wick
        target1Price: 4990.0, // 2R target (125 risk * 2 = 250 gain)
        target2Price: 5115.0, // 3R target
        riskPerShare: 125.0,
        rewardRiskRatio: 2.0,
        confluenceScore: 92,
        relativeStrengthVsNifty: 88,
        volumeMultiplier: 1.95,
        ema20: 4710.0,
        ema50: 4580.0,
        ema200: 4120.0,
        sweepLow: 4620.0,
        rejectionCandle: "Bullish Engulfing Reclaim with Volume Spike",
        fivePillarChecklist: {
          pillar1MarketRegime: {
            passed: true,
            niftyAlignment: "BULLISH_TREND",
            details: "NIFTY trend supports defense sector momentum.",
          },
          pillar2Fundamentals: {
            passed: true,
            qualityScore: 94,
            details: "Zero debt, ROE 26.4%, ROCE 34.2%, Sovereign order book.",
          },
          pillar3LiquidityLevels: {
            passed: true,
            keyLevel: 4650.0,
            details: "Major daily demand zone at ₹4,650. Previous swing low at ₹4,640 swept to trigger retail stop-losses.",
          },
          pillar4PriceActionVolume: {
            passed: true,
            setupName: "Liquidity Sweep + Reversal",
            volumeMultiplier: 1.95,
            details: "Stop hunt wick dipped to ₹4,620 and immediately reclaimed ₹4,680+ with 1.95x volume expansion & Bullish CHoCH.",
          },
          pillar5RiskManagement: {
            passed: true,
            rewardRiskRatio: 2.0,
            riskPercent: 1.0,
            details: "Entry ₹4,740, Stop Loss ₹4,615 (below wick), Target 1 ₹4,990 (2.0 R:R).",
          },
        },
        tradeRationale: [
          "Price probed below critical swing low of ₹4,640 into institutional liquidity pool.",
          "Smart money trapped aggressive breakdown shorts; rapid reclaim above ₹4,650 support within 1 session.",
          "Volume expanded to 1.95x on the reversal bar confirming genuine institutional absorption.",
          "Bullish Change of Character (CHoCH) completed with clean break above minor swing high.",
        ],
        invalidationTrigger: "Any break and daily close below sweep low wick ₹4,615 completely invalidates setup.",
        trailingStopPlan: "Lock 50% profits at next resistance ₹4,990 (2R). Trail stop loss for remaining 50% under 20 EMA.",
        fundamentals: this.getFundamentals("HAL")!,
      },

      // ────────────────────────────────────────────────────────────────────────
      // SETUP C: Pullback in Strong Trend (e.g. PERSISTENT)
      // ────────────────────────────────────────────────────────────────────────
      {
        id: "SWING-SIG-003",
        symbol: "PERSISTENT",
        companyName: "Persistent Systems Ltd",
        sector: "IT & Digital Engineering",
        setupId: "SETUP_C_TREND_PULLBACK",
        setupTitle: "Setup C — Pullback in Strong Trend",
        setupBadge: "Trend Pullback (20 EMA)",
        status: "ACTIVE_OPPORTUNITY",
        timestamp: nowIso,
        currentPrice: 5460.0,
        entryPrice: 5485.0, // Above reversal candle high
        stopLossPrice: 5355.0, // Below swing low / 20 EMA
        target1Price: 5745.0, // 2R target (130 risk * 2 = 260 gain)
        target2Price: 5875.0, // 3R target
        riskPerShare: 130.0,
        rewardRiskRatio: 2.0,
        confluenceScore: 90,
        relativeStrengthVsNifty: 85,
        volumeMultiplier: 1.6,
        ema20: 5380.0,
        ema50: 5120.0,
        ema200: 4420.0,
        rejectionCandle: "Bullish Piercing Line at 20 EMA",
        fivePillarChecklist: {
          pillar1MarketRegime: {
            passed: true,
            niftyAlignment: "BULLISH_TREND",
            details: "Benchmark index supportive of high-beta IT outperformance.",
          },
          pillar2Fundamentals: {
            passed: true,
            qualityScore: 92,
            details: "3Y Sales CAGR 24.1%, ROE 25.2%, ROCE 31.8%, FII/DII 49.3%.",
          },
          pillar3LiquidityLevels: {
            passed: true,
            keyLevel: 5380.0,
            details: "Dynamic 20-day EMA support aligned with prior weekly breakout crest.",
          },
          pillar4PriceActionVolume: {
            passed: true,
            setupName: "Pullback in Strong Trend",
            volumeMultiplier: 1.6,
            details: "Volume dried up to 0.55x during 4-day pullback; buying volume surged to 1.6x on reversal bar.",
          },
          pillar5RiskManagement: {
            passed: true,
            rewardRiskRatio: 2.0,
            riskPercent: 1.0,
            details: "Risk per share ₹130. Initial target ₹5,745 (previous high zone) yields 2.0 R:R.",
          },
        },
        tradeRationale: [
          "Textbook Higher High + Higher Low sequence sustained over 6 months.",
          "Stock pulled back gracefully into rising 20 EMA dynamic confluence zone.",
          "Selling volume completely dried up on down-days showing lack of institutional selling pressure.",
          "Buyers stepped in at 20 EMA with expanding green volume bar.",
        ],
        invalidationTrigger: "Violation and close below recent swing low ₹5,355.",
        trailingStopPlan: "Move to Breakeven at ₹5,615 (1R). Target 1 at ₹5,745 (2R). Runner target ₹5,875.",
        fundamentals: this.getFundamentals("PERSISTENT")!,
      },

      // ────────────────────────────────────────────────────────────────────────
      // SETUP D: Base Breakout (e.g. DIXON)
      // ────────────────────────────────────────────────────────────────────────
      {
        id: "SWING-SIG-004",
        symbol: "DIXON",
        companyName: "Dixon Technologies India",
        sector: "EMS",
        setupId: "SETUP_D_BASE_BREAKOUT",
        setupTitle: "Setup D — Base Breakout (VCP)",
        setupBadge: "Base Breakout (8 Weeks)",
        status: "ACTIVE_OPPORTUNITY",
        timestamp: nowIso,
        currentPrice: 14850.0,
        entryPrice: 14920.0, // Pivot breakout trigger
        stopLossPrice: 14350.0, // Below base handle low
        target1Price: 16060.0, // 2.0 R:R (570 risk * 2 = 1140 gain)
        target2Price: 16630.0, // 3.0 R:R
        riskPerShare: 570.0,
        rewardRiskRatio: 2.0,
        confluenceScore: 95,
        relativeStrengthVsNifty: 94,
        volumeMultiplier: 2.4, // Massive breakout volume
        ema20: 14200.0,
        ema50: 13650.0,
        ema200: 11200.0,
        extensionFromPivotPercent: 1.2, // Only 1.2% extended! Well within < 5-7% limit!
        baseLengthWeeks: 8,
        rejectionCandle: "High Volume Marubozu Breakout Candle",
        fivePillarChecklist: {
          pillar1MarketRegime: {
            passed: true,
            niftyAlignment: "BULLISH_TREND",
            details: "NIFTY regime clearance HIGH. Ideal environment for multi-week base breakouts.",
          },
          pillar2Fundamentals: {
            passed: true,
            qualityScore: 91,
            details: "Sales CAGR 36.5%, Profit CAGR 42.3%, ROE 28.1%, PLI leader.",
          },
          pillar3LiquidityLevels: {
            passed: true,
            keyLevel: 14800.0,
            details: "Multi-week horizontal resistance tested 4 times over 8 weeks, absorbing overhead supply.",
          },
          pillar4PriceActionVolume: {
            passed: true,
            setupName: "Base Breakout",
            volumeMultiplier: 2.4,
            details: "8-week tight volatility contraction base. Breakout bar backed by 2.4x average volume. Extension is only 1.2% (under 5% rule).",
          },
          pillar5RiskManagement: {
            passed: true,
            rewardRiskRatio: 2.0,
            riskPercent: 1.0,
            details: "Entry ₹14,920, SL ₹14,350 (3.8% risk). Target 1 ₹16,060 provides strict 2.0 R:R.",
          },
        },
        tradeRationale: [
          "Constructive 8-week flat base / Volatility Contraction Pattern (VCP).",
          "Volatility contracted progressively from 12% to 6% to 2.8% on final contraction.",
          "Overhead resistance at ₹14,800 tested 4 times, thoroughly drying up weak-hand supply.",
          "Breakout volume exploded to 2.4x 20-day average.",
          "Current price is only 1.2% from pivot — safely inside the < 5–7% extension threshold (no chasing penalty).",
        ],
        invalidationTrigger: "Failure back inside the consolidation base below ₹14,350.",
        trailingStopPlan: "Move SL to cost (₹14,920) upon reaching ₹15,490 (1R). Trail remainder below 20 EMA.",
        fundamentals: this.getFundamentals("DIXON")!,
      },

      // ────────────────────────────────────────────────────────────────────────
      // SETUP D (Approaching / Watchlist): POLYCAB
      // ────────────────────────────────────────────────────────────────────────
      {
        id: "SWING-SIG-005",
        symbol: "POLYCAB",
        companyName: "Polycab India Ltd",
        sector: "Cables & FMEG",
        setupId: "SETUP_D_BASE_BREAKOUT",
        setupTitle: "Setup D — Base Breakout (Watching Pivot)",
        setupBadge: "Base Breakout (6 Weeks)",
        status: "APPROACHING_TRIGGER",
        timestamp: nowIso,
        currentPrice: 6840.0,
        entryPrice: 6920.0, // Pivot trigger
        stopLossPrice: 6620.0,
        target1Price: 7520.0, // 2R target (300 risk * 2 = 600 gain)
        target2Price: 7820.0, // 3R target
        riskPerShare: 300.0,
        rewardRiskRatio: 2.0,
        confluenceScore: 89,
        relativeStrengthVsNifty: 82,
        volumeMultiplier: 1.35,
        ema20: 6680.0,
        ema50: 6450.0,
        ema200: 5820.0,
        extensionFromPivotPercent: 0.0, // At pivot
        baseLengthWeeks: 6,
        rejectionCandle: "Inside Bar building pre-breakout tension",
        fivePillarChecklist: {
          pillar1MarketRegime: {
            passed: true,
            niftyAlignment: "BULLISH_TREND",
            details: "Market trend confirmed bullish.",
          },
          pillar2Fundamentals: {
            passed: true,
            qualityScore: 90,
            details: "ROE 22.4%, ROCE 29.8%, Near zero net debt, industry leader.",
          },
          pillar3LiquidityLevels: {
            passed: true,
            keyLevel: 6900.0,
            details: "All-time-high supply line at ₹6,900 being compressed.",
          },
          pillar4PriceActionVolume: {
            passed: true,
            setupName: "Base Breakout",
            volumeMultiplier: 1.35,
            details: "6-week tight cup-handle consolidation. Awaiting volume expansion above ₹6,920.",
          },
          pillar5RiskManagement: {
            passed: true,
            rewardRiskRatio: 2.0,
            riskPercent: 1.0,
            details: "Entry ₹6,920, SL ₹6,620. Target 1 ₹7,520 (2.0 R:R).",
          },
        },
        tradeRationale: [
          "6-week consolidation right below all-time-high resistance of ₹6,900.",
          "Higher lows forming into horizontal resistance (Ascending Triangle structure).",
          "Awaiting trigger above ₹6,920 with expected volume expansion.",
        ],
        invalidationTrigger: "Drop below handle support at ₹6,620.",
        trailingStopPlan: "Trail below 20 EMA once 1R is attained.",
        fundamentals: this.getFundamentals("POLYCAB")!,
      },
    ];

    return signals;
  }

  /**
   * PILLAR 5: Strict Risk Management & Dynamic Position Sizing Calculator
   * Formula:
   * Max Risk = Account Capital * (Risk % / 100)
   * Risk per share = Entry Price - Stop Loss Price
   * Quantity = Floor(Max Risk / Risk per share)
   * Capital Required = Quantity * Entry Price
   */
  public calculatePositionSize(input: PositionSizeCalcInput): PositionSizeCalcResult {
    const warnings: string[] = [];

    const accountCapital = Math.max(1000, input.accountCapital || 500000);
    const riskPercent = Math.max(0.1, input.riskPercent || 1.0);
    const entryPrice = Math.max(0.05, input.entryPrice || 100);
    const stopLossPrice = Math.max(0.01, input.stopLossPrice || 90);
    const targetPrice = input.targetPrice || entryPrice + (entryPrice - stopLossPrice) * 2;

    const riskPerShare = Math.abs(entryPrice - stopLossPrice);
    const potentialGainPerShare = Math.abs(targetPrice - entryPrice);

    if (riskPerShare <= 0) {
      warnings.push("Stop Loss must not be equal to Entry Price.");
    }

    if (stopLossPrice >= entryPrice) {
      warnings.push("For long swing trades, Stop Loss must be strictly below Entry Price.");
    }

    if (riskPercent > 2.0) {
      warnings.push("CAUTION: Risk exceeds strict 1.0%–2.0% swing trading rule. Recommended max is 1.5%.");
    }

    const maxRiskAmount = Math.round((accountCapital * (riskPercent / 100)) * 100) / 100;
    const recommendedQuantity = riskPerShare > 0 ? Math.floor(maxRiskAmount / riskPerShare) : 0;
    const totalCapitalRequired = Math.round(recommendedQuantity * entryPrice * 100) / 100;
    const capitalExposurePercent =
      accountCapital > 0 ? Math.round((totalCapitalRequired / accountCapital) * 10000) / 100 : 0;

    const potentialRewardAmount = Math.round(recommendedQuantity * potentialGainPerShare * 100) / 100;
    const rewardRiskRatio = riskPerShare > 0 ? Math.round((potentialGainPerShare / riskPerShare) * 100) / 100 : 0;

    if (rewardRiskRatio < 2.0) {
      warnings.push(`Trade rejected by Rule 5: R:R is ${rewardRiskRatio}:1. Minimum required is 1:2.0.`);
    }

    if (capitalExposurePercent > 30.0) {
      warnings.push(`Single-position capital exposure is ${capitalExposurePercent}%. Recommended cap is 20-25% to maintain 4-5 stock diversification.`);
    }

    const isRiskValid = warnings.filter((w) => w.includes("rejected") || w.includes("strictly")).length === 0;

    return {
      maxRiskAmount,
      riskPerShare: Math.round(riskPerShare * 100) / 100,
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
