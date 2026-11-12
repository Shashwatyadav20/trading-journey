export interface ClosedTradeExitAuditData {
  tradeId: string;
  symbol: string;
  cleanSymbol?: string;
  companyName?: string;
  strategyUsed?: string;
  direction?: "LONG" | "SHORT";
  entryPrice: number;
  exitPrice?: number;
  currentSimulatedPrice?: number;
  currentMarketPrice?: number;
  quantity?: number;
  allocatedCapital?: number;
  pnlAmount: number;
  pnlPercent: number;
  status: string; // "NEWS_TRIGGER_EXIT" | "REVERSAL_EXIT" | "TARGET_HIT" | "TSL_HIT" | "MANUAL_EMERGENCY_EXIT" | "AUTO_SQUARE_OFF_315PM"
  auditTag?: string;
  exitReason?: string;
  executionTime?: string;
  exitTime?: string;
  // Specific news catalyst telemetry
  exitHeadline?: string;
  exitPublisher?: string;
  exitSentimentScore?: number; // -100 to +100
  exitSentimentCategory?: "POSITIVE" | "NEUTRAL" | "NEGATIVE_WARNING" | "CRITICAL_NEGATIVE";
  exitHeadlineUrl?: string;
  matchedKeywords?: string[];
  // Price action microstructure snapshot at moment of exit
  volumeSpikeMultiplier?: number;
  upperWickRejectionPct?: number;
  targetProgressPct?: number;
  pullbackFromPeakPct?: number;
  peakPrice?: number;
  targetPrice?: number;
  stopLossPrice?: number;
  lockedReferenceLevel?: number;
  lockedReferenceLabel?: string;
  auditTrail?: Array<{ timestamp: string; action: string; details: string }>;
}

export const DEFAULT_CLOSED_TRADE_AUDIT_SEEDS: ClosedTradeExitAuditData[] = [
  {
    tradeId: "AUDIT-POLYCAB-101",
    symbol: "POLYCAB.NS",
    cleanSymbol: "POLYCAB",
    companyName: "Polycab India",
    strategyUsed: "🟣 Purple Box Support Buy",
    direction: "LONG",
    entryPrice: 6520,
    exitPrice: 6710,
    targetPrice: 6980,
    stopLossPrice: 6380,
    currentMarketPrice: 6710,
    currentSimulatedPrice: 6710,
    quantity: 100,
    allocatedCapital: 652000,
    pnlAmount: 19000,
    pnlPercent: 2.91,
    status: "NEWS_TRIGGER_EXIT",
    auditTag: "NEWS_TRIGGER_EXIT",
    exitReason:
      "🚨 AI Sentiment Shield (-62 score): Breaking IT department search & tax probe notice reported on exchange regulatory wire; position closed immediately to protect accrued gains.",
    exitHeadline:
      "Polycab India shares tumble after IT department search & regulatory notice on tax assessment",
    exitPublisher: "Reuters / Economic Times",
    exitSentimentScore: -62,
    exitSentimentCategory: "CRITICAL_NEGATIVE",
    volumeSpikeMultiplier: 3.4,
    targetProgressPct: 62,
    upperWickRejectionPct: 52,
    lockedReferenceLevel: 6480,
    lockedReferenceLabel: "VAL_SUPPORT_FLOOR",
    executionTime: "09:22:15 IST",
    exitTime: "11:45:10 IST",
    auditTrail: [
      {
        timestamp: "09:22:15 IST",
        action: "ENTRY_LOCKED",
        details: "Purple Box Mode A Support Buy locked at Live LTP ₹6520 near VAL support floor ₹6480.",
      },
      {
        timestamp: "10:35:00 IST",
        action: "PROGRESS_UPDATE",
        details: "Price reached ₹6680 (+2.45%); orderbook bids expanding into mid-band POC.",
      },
      {
        timestamp: "11:44:50 IST",
        action: "CATALYST_DETECTED",
        details:
          "Scraped regulatory notice: 'IT department search & tax probe notice'. AI sentiment scored -62 (CRITICAL_NEGATIVE).",
      },
      {
        timestamp: "11:45:10 IST",
        action: "NEWS_TRIGGER_EXIT",
        details:
          "Automated capital protection exit executed at Live LTP ₹6710 (Realized +₹19,000 / +2.91%). Capital freed to backtest ledger.",
      },
    ],
  },
  {
    tradeId: "AUDIT-PGEL-102",
    symbol: "PGEL.NS",
    cleanSymbol: "PGEL",
    companyName: "PG Electroplast Ltd",
    strategyUsed: "🚀 Step-Up Box Breakout",
    direction: "LONG",
    entryPrice: 710,
    exitPrice: 755,
    targetPrice: 775,
    stopLossPrice: 680,
    currentMarketPrice: 755,
    currentSimulatedPrice: 755,
    quantity: 500,
    allocatedCapital: 355000,
    pnlAmount: 22500,
    pnlPercent: 6.34,
    status: "REVERSAL_EXIT",
    auditTag: "REVERSAL_EXIT",
    exitReason:
      "⚠️ Reversal Exhaustion Reader: PGEL reached 88% of target (Peak ₹768), then formed heavy 2.8x volume shooting star rejection wick (-1.69% pullback) into overhead ask-wall.",
    exitHeadline: "PGEL touches fresh 52-week high before profit-taking emergence near institutional ceiling",
    exitPublisher: "Moneycontrol.com / NSE Tape",
    exitSentimentScore: -28,
    exitSentimentCategory: "NEGATIVE_WARNING",
    volumeSpikeMultiplier: 2.8,
    targetProgressPct: 88,
    upperWickRejectionPct: 64,
    lockedReferenceLevel: 705,
    lockedReferenceLabel: "VAH_BOX_CEILING",
    executionTime: "09:35:10 IST",
    exitTime: "13:20:45 IST",
    auditTrail: [
      {
        timestamp: "09:35:10 IST",
        action: "ENTRY_LOCKED",
        details: "Step-Up Box Breakout Mode B triggered above VAH Ceiling ₹705 at ₹710 with 2.1x volume.",
      },
      {
        timestamp: "12:10:00 IST",
        action: "70PCT_TSL_ARMED",
        details:
          "Price crossed ₹750 (70%+ target distance reached). Trailing Stop-Loss automatically shifted to Cost (Breakeven ₹710).",
      },
      {
        timestamp: "13:18:30 IST",
        action: "REVERSAL_EXHAUSTION",
        details:
          "Rejection from Day High ₹768 with 64% upper wick depth and institutional ask-wall absorption.",
      },
      {
        timestamp: "13:20:45 IST",
        action: "REVERSAL_EXIT",
        details:
          "Profit-lock exit triggered at ₹755 (Realized +₹22,500 / +6.34%). Archived to Backtest History.",
      },
    ],
  },
  {
    tradeId: "AUDIT-SUNPHARMA-103",
    symbol: "SUNPHARMA.NS",
    cleanSymbol: "SUNPHARMA",
    companyName: "Sun Pharmaceutical Industries",
    strategyUsed: "🔥 VCP + Pocket Pivot",
    direction: "LONG",
    entryPrice: 1820,
    exitPrice: 1948,
    targetPrice: 1948,
    stopLossPrice: 1765,
    currentMarketPrice: 1948,
    currentSimulatedPrice: 1948,
    quantity: 200,
    allocatedCapital: 364000,
    pnlAmount: 25600,
    pnlPercent: 7.03,
    status: "TARGET_HIT",
    auditTag: "TARGET_HIT",
    exitReason:
      "✅ Target Fulfilled: Stock achieved 100% structural target at ₹1948 on heavy institutional demand zone expansion.",
    exitHeadline:
      "Sun Pharma receives US FDA approval for specialty dermatology formulation with 180-day exclusivity",
    exitPublisher: "Business Standard / Exchange Wire",
    exitSentimentScore: 48,
    exitSentimentCategory: "POSITIVE",
    volumeSpikeMultiplier: 1.8,
    targetProgressPct: 100,
    upperWickRejectionPct: 15,
    lockedReferenceLevel: 1810,
    lockedReferenceLabel: "20_EMA_DEMAND",
    executionTime: "09:18:00 IST",
    exitTime: "14:50:22 IST",
    auditTrail: [
      {
        timestamp: "09:18:00 IST",
        action: "ENTRY_LOCKED",
        details: "VCP Pocket Pivot breakout locked at ₹1820 above 20 EMA institutional demand zone.",
      },
      {
        timestamp: "11:30:00 IST",
        action: "BULLISH_CATALYST",
        details: "US FDA approval headline published. AI Sentiment scored +48 (POSITIVE).",
      },
      {
        timestamp: "14:50:22 IST",
        action: "TARGET_HIT",
        details: "100% Target reached at ₹1948. Realized +₹25,600 (+7.03%). Full reward captured.",
      },
    ],
  },
];
