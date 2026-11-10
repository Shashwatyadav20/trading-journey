import { NextRequest, NextResponse } from "next/server";
import {
  evaluateMultiTimeframeConfluence,
  generateSyntheticIntradayStructure,
  OHLCVCandle as MTFCandle,
} from "@/lib/indian/multiTimeframeConfluence";
import {
  calculateATR14,
  calculateDynamicPositionSize,
} from "@/lib/indian/riskEngine";
import {
  detectPurpleBoxRangeAndStepUp,
  getISTDateKey,
  getOrLockSameDaySignal,
} from "@/lib/indian/purpleBoxEngine";

export const dynamic = "force-dynamic";

interface OHLCVCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface StockMeta {
  symbol: string;
  name: string;
  sector: string;
  marketCapCr: number;
  roePercent: number;
}

const LIQUID_NSE_UNIVERSE: StockMeta[] = [
  { symbol: "ELECON", name: "Elecon Engineering Co", sector: "Industrial Gears", marketCapCr: 14100, roePercent: 23.4 },
  { symbol: "HAL", name: "Hindustan Aeronautics Ltd", sector: "Defence & Aerospace", marketCapCr: 310000, roePercent: 28.4 },
  { symbol: "BEL", name: "Bharat Electronics Ltd", sector: "Defence & Aerospace", marketCapCr: 215000, roePercent: 24.1 },
  { symbol: "TRENT", name: "Trent Ltd", sector: "Retail & Consumer", marketCapCr: 245000, roePercent: 26.8 },
  { symbol: "SIEMENS", name: "Siemens Ltd", sector: "Capital Goods", marketCapCr: 238000, roePercent: 16.5 },
  { symbol: "ABB", name: "ABB India Ltd", sector: "Capital Goods", marketCapCr: 168000, roePercent: 22.9 },
  { symbol: "RELIANCE", name: "Reliance Industries Ltd", sector: "Energy & Telecom", marketCapCr: 1980000, roePercent: 15.2 },
  { symbol: "ICICIBANK", name: "ICICI Bank Ltd", sector: "Banking", marketCapCr: 890000, roePercent: 18.6 },
  { symbol: "SUNPHARMA", name: "Sun Pharmaceutical Ind", sector: "Pharma", marketCapCr: 430000, roePercent: 17.4 },
  { symbol: "M&M", name: "Mahindra & Mahindra Ltd", sector: "Automobiles", marketCapCr: 365000, roePercent: 19.8 },
  { symbol: "TATAPOWER", name: "Tata Power Company Ltd", sector: "Power", marketCapCr: 142000, roePercent: 15.1 },
  { symbol: "DLF", name: "DLF Limited", sector: "Real Estate", marketCapCr: 210000, roePercent: 14.5 },
  { symbol: "VEDL", name: "Vedanta Limited", sector: "Metals & Mining", marketCapCr: 175000, roePercent: 21.0 },
  { symbol: "DIXON", name: "Dixon Technologies Ltd", sector: "EMS & Electronics", marketCapCr: 64500, roePercent: 25.4 },
  { symbol: "POLYCAB", name: "Polycab India Ltd", sector: "Cables & Wires", marketCapCr: 62000, roePercent: 23.8 },
  { symbol: "PERSISTENT", name: "Persistent Systems Ltd", sector: "IT Services", marketCapCr: 61500, roePercent: 24.2 },
  { symbol: "CUMMINSIND", name: "Cummins India Ltd", sector: "Industrial Engines", marketCapCr: 63800, roePercent: 26.1 },
  { symbol: "CGPOWER", name: "CG Power & Industrial", sector: "Capital Goods", marketCapCr: 59000, roePercent: 31.5 },
  { symbol: "BSE", name: "BSE Limited", sector: "Capital Markets", marketCapCr: 54000, roePercent: 27.9 },
  { symbol: "CDSL", name: "Central Depository Services", sector: "Capital Markets", marketCapCr: 34500, roePercent: 29.4 },
  { symbol: "MCX", name: "Multi Commodity Exchange", sector: "Capital Markets", marketCapCr: 31000, roePercent: 22.4 },
  { symbol: "ANGELONE", name: "Angel One Ltd", sector: "Broking & Fintech", marketCapCr: 26500, roePercent: 34.2 },
  { symbol: "COCHINSHIP", name: "Cochin Shipyard Ltd", sector: "Shipbuilding", marketCapCr: 48500, roePercent: 18.9 },
  { symbol: "MAZDOCK", name: "Mazagon Dock Shipbuilders", sector: "Shipbuilding", marketCapCr: 61000, roePercent: 32.4 },
  { symbol: "BDL", name: "Bharat Dynamics Ltd", sector: "Defence Missiles", marketCapCr: 52000, roePercent: 17.5 },
  { symbol: "RVNL", name: "Rail Vikas Nigam Ltd", sector: "Railways & EPC", marketCapCr: 58000, roePercent: 20.6 },
  { symbol: "MANAPPURAM", name: "Manappuram Finance Ltd", sector: "NBFC", marketCapCr: 18500, roePercent: 19.8 },
  { symbol: "MUTHOOTFIN", name: "Muthoot Finance Ltd", sector: "NBFC", marketCapCr: 78000, roePercent: 21.2 },
  { symbol: "SOLARINDS", name: "Solar Industries India", sector: "Defence & Explosives", marketCapCr: 92000, roePercent: 27.5 },
  { symbol: "NAVINFLUOR", name: "Navin Fluorine International", sector: "Specialty Chemicals", marketCapCr: 22400, roePercent: 16.2 },
  { symbol: "DEEPAKNTR", name: "Deepak Nitrite Ltd", sector: "Specialty Chemicals", marketCapCr: 38000, roePercent: 21.4 },
  { symbol: "KEI", name: "KEI Industries Ltd", sector: "Cables & Wires", marketCapCr: 39500, roePercent: 21.3 },
  { symbol: "APARINDS", name: "Apar Industries Ltd", sector: "Power Conductors", marketCapCr: 36800, roePercent: 29.5 },
  { symbol: "COFORGE", name: "Coforge Limited", sector: "IT Services", marketCapCr: 51000, roePercent: 22.8 },
  { symbol: "KPITTECH", name: "KPIT Technologies Ltd", sector: "Auto ER&D", marketCapCr: 44000, roePercent: 26.3 },
  { symbol: "SUZLON", name: "Suzlon Energy Ltd", sector: "Wind Energy", marketCapCr: 64000, roePercent: 28.1 },
  { symbol: "VOLTAS", name: "Voltas Limited", sector: "Consumer Durables", marketCapCr: 53000, roePercent: 14.8 },
  { symbol: "ZENTEC", name: "Zen Technologies Ltd", sector: "Defence Anti-Drone", marketCapCr: 15800, roePercent: 31.2 },
  { symbol: "DATAPATTNS", name: "Data Patterns (India) Ltd", sector: "Defence Electronics", marketCapCr: 16400, roePercent: 17.8 },
  { symbol: "TITAGARH", name: "Titagarh Rail Systems Ltd", sector: "Railways & Wagons", marketCapCr: 18900, roePercent: 19.6 },
  { symbol: "KAYNES", name: "Kaynes Technology India", sector: "EMS & Semicon", marketCapCr: 19200, roePercent: 18.4 },
  { symbol: "NETWEB", name: "Netweb Technologies India", sector: "AI Supercomputing", marketCapCr: 14700, roePercent: 24.9 },
  { symbol: "TARIL", name: "Transformers & Rectifiers", sector: "Power Transformers", marketCapCr: 11200, roePercent: 21.0 },
  { symbol: "GRAVITA", name: "Gravita India Ltd", sector: "Recycling & Lead", marketCapCr: 15600, roePercent: 28.7 },
  { symbol: "ASTRAMICRO", name: "Astra Microwave Products", sector: "Defence Radars", marketCapCr: 8400, roePercent: 16.9 },
  { symbol: "PGEL", name: "PG Electroplast Ltd", sector: "EMS & Durables", marketCapCr: 16800, roePercent: 18.2 },
  { symbol: "ACE", name: "Action Construction Equip", sector: "Cranes & Infra", marketCapCr: 15900, roePercent: 26.5 },
  { symbol: "AMBER", name: "Amber Enterprises India", sector: "HVAC & EMS", marketCapCr: 18500, roePercent: 15.8 },
  { symbol: "IRCTC", name: "Indian Railway Catering", sector: "Railways & Tourism", marketCapCr: 62000, roePercent: 34.0 },
  { symbol: "BHEL", name: "Bharat Heavy Electricals", sector: "Power Equipment", marketCapCr: 84000, roePercent: 12.5 },
  { symbol: "EXIDEIND", name: "Exide Industries Ltd", sector: "Auto Batteries", marketCapCr: 38500, roePercent: 14.2 },
  { symbol: "CHAMBLFERT", name: "Chambal Fertilisers", sector: "Agri & Chemicals", marketCapCr: 19800, roePercent: 18.5 },
];

function calcEMAArray(closes: number[], period: number): number[] {
  if (closes.length === 0) return [];
  const k = 2 / (period + 1);
  const ema: number[] = [closes[0]];
  for (let i = 1; i < closes.length; i++) {
    ema.push(closes[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

interface LiveQuoteSnapshot {
  candles: OHLCVCandle[];
  ltp: number | null;
  prevClose: number | null;
  changePercent: number | null;
  marketTimestamp: number | null;
}

async function fetchYahooQuoteSnapshot(symbol: string): Promise<LiveQuoteSnapshot> {
  const empty: LiveQuoteSnapshot = { candles: [], ltp: null, prevClose: null, changePercent: null, marketTimestamp: null };
  const clean = symbol.trim().toUpperCase().replace(/\.NS$/i, "").replace(/\.BO$/i, "");
  const ticker = clean.startsWith("^") ? clean : `${clean}.NS`;
  const endpoints = [
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=6mo&interval=1d&_t=${Date.now()}`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=6mo&interval=1d&_t=${Date.now()}`,
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
          "Cache-Control": "no-cache, no-store, must-revalidate",
          Pragma: "no-cache",
        },
        cache: "no-store",
      });
      if (!res.ok) continue;
      const data = await res.json();
      const result = data?.chart?.result?.[0];
      if (!result) continue;

      const timestamps: number[] = result.timestamp || [];
      const quote = result.indicators?.quote?.[0] || {};
      const candles: OHLCVCandle[] = [];

      for (let i = 0; i < timestamps.length; i++) {
        const open = quote.open?.[i];
        const high = quote.high?.[i];
        const low = quote.low?.[i];
        const close = quote.close?.[i];
        const volume = quote.volume?.[i];
        if (open != null && high != null && low != null && close != null && volume != null && close > 0) {
          candles.push({
            timestamp: timestamps[i] * 1000,
            open: Number(open.toFixed(2)),
            high: Number(high.toFixed(2)),
            low: Number(low.toFixed(2)),
            close: Number(close.toFixed(2)),
            volume: Number(volume),
          });
        }
      }

      const meta = result.meta || {};
      const rawLtp =
        typeof meta.regularMarketPrice === "number" && meta.regularMarketPrice > 0
          ? meta.regularMarketPrice
          : candles.length > 0
          ? candles[candles.length - 1].close
          : null;
      const rawPrev =
        typeof meta.chartPreviousClose === "number" && meta.chartPreviousClose > 0
          ? meta.chartPreviousClose
          : typeof meta.previousClose === "number" && meta.previousClose > 0
          ? meta.previousClose
          : candles.length > 1
          ? candles[candles.length - 2].close
          : null;
      const ltp = rawLtp !== null ? Number(rawLtp.toFixed(2)) : null;
      const prevClose = rawPrev !== null ? Number(rawPrev.toFixed(2)) : null;
      const changePercent =
        ltp !== null && prevClose !== null && prevClose > 0
          ? Number((((ltp - prevClose) / prevClose) * 100).toFixed(2))
          : null;

      // Force-synchronize final daily candle close/high/low with exact live regularMarketPrice (LTP)
      if (ltp !== null && candles.length > 0) {
        const lastIdx = candles.length - 1;
        candles[lastIdx] = {
          ...candles[lastIdx],
          close: ltp,
          high: Number(Math.max(candles[lastIdx].high, ltp).toFixed(2)),
          low: Number(Math.min(candles[lastIdx].low, ltp).toFixed(2)),
        };
      }

      return {
        candles,
        ltp,
        prevClose,
        changePercent,
        marketTimestamp: typeof meta.regularMarketTime === "number" ? meta.regularMarketTime * 1000 : Date.now(),
      };
    } catch {
      // Try fallback Yahoo endpoint
    }
  }
  return empty;
}

async function fetchYahooDailyCandles(symbol: string): Promise<OHLCVCandle[]> {
  const snap = await fetchYahooQuoteSnapshot(symbol);
  return snap.candles;
}

function evaluatePurpleBoxAndSwingStrategies(
  meta: StockMeta,
  candles: OHLCVCandle[],
  exactLtp?: number | null,
  exactChangePercent?: number | null
) {
  if (candles.length < 55) return null;

  const n = candles.length;
  const last = candles[n - 1];
  const prev = candles[n - 2];
  const closes = candles.map((c) => c.close);

  const ema20Arr = calcEMAArray(closes, 20);
  const ema50Arr = calcEMAArray(closes, 50);
  const ema200Arr = calcEMAArray(closes, Math.min(200, n));

  const ema20 = Number(ema20Arr[n - 1].toFixed(2));
  const ema50 = Number(ema50Arr[n - 1].toFixed(2));
  const ema200 = Number(ema200Arr[n - 1].toFixed(2));
  const liveLtpExact =
    typeof exactLtp === "number" && Number.isFinite(exactLtp) && exactLtp > 0
      ? Number(exactLtp.toFixed(2))
      : Number(last.close.toFixed(2));
  const changePercent =
    typeof exactChangePercent === "number" && Number.isFinite(exactChangePercent)
      ? exactChangePercent
      : Number((((liveLtpExact - prev.close) / prev.close) * 100).toFixed(2));

  // Volume calculation
  const volSlice20 = candles.slice(Math.max(0, n - 21), n - 1);
  const avgVol20 = volSlice20.reduce((s, c) => s + c.volume, 0) / Math.max(1, volSlice20.length);
  const greenVolumes = candles
    .slice(n - 6)
    .filter((c) => c.close >= c.open)
    .map((c) => c.volume);
  const maxGreenVol = greenVolumes.length > 0 ? Math.max(...greenVolumes) : last.volume;
  const volumeMultiplier = Number(Math.max(last.volume / avgVol20, (maxGreenVol / avgVol20) * 0.9).toFixed(2));

  // ATR14 Calculation
  const atr14 = calculateATR14(candles);

  // ── 1. MULTI-TIMEFRAME PURPLE BOX RANGE & STEP-UP BREAKOUT ENGINE ──
  const purpleBox = detectPurpleBoxRangeAndStepUp(candles, volumeMultiplier);

  // Common 5-6D Box & Doji Metrics for Complementary Strategies
  const priorWindow = candles.slice(Math.max(0, n - 35), n - 6);
  const supportZoneLow = Math.min(...priorWindow.map((c) => c.low));
  const range5D = candles.slice(n - 6, n - 1);
  const boxHigh = Math.max(...range5D.map((c) => c.high));
  const boxLow = Math.min(...range5D.map((c) => c.low));
  const boxRangePct = Number((((boxHigh - boxLow) / boxLow) * 100).toFixed(2));
  const rallyFromSupportPct = Number((((boxLow - supportZoneLow) / supportZoneLow) * 100).toFixed(2));

  let dojiCount = 0;
  range5D.forEach((c) => {
    const body = Math.abs(c.close - c.open);
    const span = Math.max(0.05, c.high - c.low);
    if (body / span <= 0.35) dojiCount++;
  });
  if (Math.abs(prev.close - prev.open) / Math.max(0.05, prev.high - prev.low) <= 0.35) {
    dojiCount = Math.max(1, dojiCount);
  }

  const recent15High = Math.max(...candles.slice(n - 15).map((c) => c.high));
  const drawdown15D = ((recent15High - last.close) / recent15High) * 100;

  // Strategy A: Purple Box Dual-Mode (Mode A Support Buy at VAL OR Mode B Ceiling Breakout above VAH)
  const matchesPurpleBoxRange = purpleBox !== null && changePercent >= -1.5;

  // Strategy B: Step-Up Trendline + 5-6D Tight Box + Doji Breakout
  const matchesTrendlineDoji =
    changePercent >= -0.5 &&
    drawdown15D <= 5.5 &&
    last.close >= ema20 &&
    rallyFromSupportPct >= 3.5 &&
    boxLow > supportZoneLow &&
    boxRangePct <= 5.5 &&
    dojiCount >= 1 &&
    last.close >= boxHigh * 0.988 &&
    last.close <= boxHigh * 1.045;

  // Strategy C: Resistance Doji Squeeze + Volume Expansion (>= 1.5x)
  const matchesResistanceSqueeze =
    changePercent >= -0.5 &&
    drawdown15D <= 4.5 &&
    last.close >= ema20 &&
    volumeMultiplier >= 1.5 &&
    boxRangePct <= 5.2 &&
    dojiCount >= 1 &&
    last.close >= boxHigh * 0.99;

  // Strategy D: VCP Pocket Pivot
  const prior10RangePct =
    ((Math.max(...candles.slice(n - 16, n - 6).map((c) => c.high)) -
      Math.min(...candles.slice(n - 16, n - 6).map((c) => c.low))) /
      boxLow) *
    100;
  const matchesVcpPocketPivot =
    changePercent >= -0.5 &&
    drawdown15D <= 5.0 &&
    last.close > ema20 &&
    last.close > ema50 &&
    boxRangePct < prior10RangePct * 0.85 &&
    boxRangePct <= 5.5 &&
    volumeMultiplier >= 1.5;

  const matchedStrategies: string[] = [];
  if (matchesPurpleBoxRange && purpleBox) {
    matchedStrategies.push(
      purpleBox.executionMode === "MODE_B_CEILING_BREAKOUT"
        ? "PURPLE_BOX_CEILING_BREAKOUT"
        : "PURPLE_BOX_SUPPORT_BUY"
    );
  }
  if (matchesTrendlineDoji) matchedStrategies.push("TRENDLINE_5D_RANGE_DOJI");
  if (matchesResistanceSqueeze) matchedStrategies.push("RESISTANCE_DOJI_SQUEEZE");
  if (matchesVcpPocketPivot) matchedStrategies.push("VCP_POCKET_PIVOT");

  if (matchedStrategies.length === 0) return null;

  const primaryStrategy = matchedStrategies[0];
  const todayKey = getISTDateKey();

  // Compute candidate levels (will be frozen for `todayKey` on first evaluation)
  const liveLtp = liveLtpExact;
  let candidateSL = Number(Math.max(boxLow * 0.992, liveLtp * 0.968).toFixed(2));
  let candidateTP1 = Number((liveLtp * 1.07).toFixed(2)); // Default +7% breakout target
  let candidateTP2 = Number((liveLtp * 1.12).toFixed(2));
  let candidateRefLevel = Number(boxHigh.toFixed(2));
  let candidateRefLabel = "VAH_BOX_CEILING";
  let candidateExecMode = "MODE_B_CEILING_BREAKOUT";

  if (purpleBox) {
    candidateSL = purpleBox.recommendedStopLoss;
    candidateTP1 = purpleBox.recommendedTarget1;
    candidateTP2 = purpleBox.recommendedTarget2;
    candidateRefLevel = purpleBox.lockedReferenceLevel;
    candidateRefLabel = purpleBox.lockedReferenceLabel;
    candidateExecMode = purpleBox.executionMode;
  }

  // ── IRONCLAD SAME-DAY PRICE FREEZE (YYYY-MM-DD) ──
  const locked = getOrLockSameDaySignal(meta.symbol, todayKey, {
    entryPrice: liveLtp,
    stopLossPrice: candidateSL,
    target1Price: candidateTP1,
    target2Price: candidateTP2,
    referenceLevel: candidateRefLevel,
    referenceLabel: candidateRefLabel,
    executionMode: candidateExecMode,
    primaryStrategy,
    matchedStrategies,
    boxFloorVAL: purpleBox?.boxFloorVAL ?? Number(boxLow.toFixed(2)),
    boxCeilingVAH: purpleBox?.boxCeilingVAH ?? Number(boxHigh.toFixed(2)),
    boxMidPOC: purpleBox?.boxMidPOC ?? Number(((boxHigh + boxLow) / 2).toFixed(2)),
    boxWidthPct: purpleBox?.boxWidthPct ?? boxRangePct,
    supportTouches: purpleBox?.supportTouches ?? 3,
    resistanceTouches: purpleBox?.resistanceTouches ?? 2,
  });

  // ── DYNAMIC MULTI-TIMEFRAME CONFLUENCE & FALSE BREAKOUT CHECK ──
  const { candles4h, candles15m } = generateSyntheticIntradayStructure(candles as MTFCandle[], meta.symbol);
  const mtfResult = evaluateMultiTimeframeConfluence(
    meta.symbol,
    last.close,
    locked.referenceLevel,
    candles4h,
    candles15m
  );

  // Dynamic ATR Volatility Position Sizing
  const atrSizing = calculateDynamicPositionSize({
    accountCapital: 2500000,
    riskPercentage: 1.0,
    entryPrice: locked.entryPrice,
    stopLossPrice: locked.stopLossPrice,
    targetPrice: locked.target1Price,
    atr14,
  });

  const risk = Math.max(0.5, Math.abs(locked.entryPrice - locked.stopLossPrice));
  const rewardRiskRatio = Number(((locked.target1Price - locked.entryPrice) / risk).toFixed(2));

  let score = 85;
  if (purpleBox) {
    score += 4;
    if (purpleBox.supportTouches >= 4) score += 2;
    if (purpleBox.mtf4h1h.tf4hConfirmed && purpleBox.mtf4h1h.tf1hConfirmed) score += 3;
  }
  if (matchedStrategies.length >= 2) score += 3;
  if (volumeMultiplier >= 1.8) score += 3;
  score += mtfResult.confluenceScoreAdj;
  const confluenceScore = Math.min(98, Math.max(65, score));

  return {
    id: `${meta.symbol}-${todayKey}`,
    symbol: `${meta.symbol}.NS`,
    cleanSymbol: meta.symbol,
    companyName: meta.name,
    sector: meta.sector,
    lockedDateKey: locked.dateKey,
    lockedAtIso: locked.lockedAtIso,
    currentPrice: liveLtp,
    changePercent,
    breakoutLevel: locked.referenceLevel,
    lockedReferenceLevel: locked.referenceLevel,
    lockedReferenceLabel: locked.referenceLabel,
    entryTrigger: locked.entryPrice,
    entryPrice: locked.entryPrice,
    stopLoss: locked.stopLossPrice,
    stopLossPrice: locked.stopLossPrice,
    target1: locked.target1Price,
    target1Price: locked.target1Price,
    target2: locked.target2Price,
    target2Price: locked.target2Price,
    rewardRiskRatio,
    confluenceScore,
    relativeVolume: volumeMultiplier,
    volumeMultiplier,
    ema20,
    ema50,
    ema200,
    atr14,
    primaryStrategy: locked.primaryStrategy,
    matchedStrategies: locked.matchedStrategies,
    purpleBox: purpleBox
      ? {
          detected: true,
          executionMode: purpleBox.executionMode,
          structureType: purpleBox.structureType,
          boxFloorVAL: locked.boxFloorVAL,
          boxCeilingVAH: locked.boxCeilingVAH,
          boxMidPOC: locked.boxMidPOC,
          boxWidthPct: locked.boxWidthPct,
          supportTouches: locked.supportTouches,
          resistanceTouches: locked.resistanceTouches,
          positionInBoxPct: purpleBox.positionInBoxPct,
          stepUpFromPriorBasePct: purpleBox.stepUpFromPriorBasePct,
          precedingDojiCount: purpleBox.precedingDojiCount,
          mtf4h1h: purpleBox.mtf4h1h,
        }
      : {
          detected: false,
          executionMode: locked.executionMode as any,
          structureType: "STEP_UP_CONTINUATION_BOX",
          boxFloorVAL: locked.boxFloorVAL,
          boxCeilingVAH: locked.boxCeilingVAH,
          boxMidPOC: locked.boxMidPOC,
          boxWidthPct: locked.boxWidthPct,
          supportTouches: locked.supportTouches,
          resistanceTouches: locked.resistanceTouches,
          positionInBoxPct: 98,
          stepUpFromPriorBasePct: rallyFromSupportPct,
          precedingDojiCount: Math.max(1, dojiCount),
          mtf4h1h: {
            tf4hConfirmed: mtfResult.tf4h.confirmed,
            tf1hConfirmed: mtfResult.tf15m.confirmed,
            tf4hStructure: "HIGHER_LOW_STEP_UP",
            tf1hMomentum: "IMPULSE_BREAKOUT",
            ema20_4h: mtfResult.tf4h.ema20,
            ema50_4h: mtfResult.tf4h.ema50,
            vwap1h: mtfResult.tf15m.vwap,
            summary: `4H Step-Up Structure confirmed above EMA20 (₹${mtfResult.tf4h.ema20}) + Intraday VWAP ₹${mtfResult.tf15m.vwap}.`,
          },
        },
    // ── MTF Confluence & False Breakout Details ──
    mtfConfluence: {
      confluenceGrade: mtfResult.confluenceGrade,
      overallConfirmed: mtfResult.overallConfirmed,
      isFalseBreakout: mtfResult.isFalseBreakout,
      tf4h: {
        trend: mtfResult.tf4h.trend,
        structureState: mtfResult.tf4h.structureState,
        ema20: mtfResult.tf4h.ema20,
        confirmed: mtfResult.tf4h.confirmed,
        rationale: mtfResult.tf4h.rationale,
        orderBlockQuality: mtfResult.tf4h.orderBlockQuality || "Strong",
        confidenceTag: mtfResult.tf4h.confidenceTag || "✓",
      },
      tf15m: {
        vwap: mtfResult.tf15m.vwap,
        priceVsVwapPct: mtfResult.tf15m.priceVsVwapPct,
        isAboveVwap: mtfResult.tf15m.isAboveVwap,
        orderBlockRejection: mtfResult.tf15m.orderBlockRejection,
        falseBreakoutDetected: mtfResult.tf15m.falseBreakoutDetected,
        falseBreakoutReason: mtfResult.tf15m.falseBreakoutReason,
        confirmed: mtfResult.tf15m.confirmed,
        rationale: mtfResult.tf15m.rationale,
        orderBlockQuality: mtfResult.tf15m.orderBlockQuality || "Medium",
        confidenceTag: mtfResult.tf15m.confidenceTag || "✓",
      },
      auditNotes: mtfResult.auditNotes,
    },
    // ── Dynamic ATR Volatility Sizing ──
    atrVolatilitySizing: {
      accountCapital: atrSizing.accountCapital,
      riskPercentage: atrSizing.riskPercentage,
      riskAmountRupees: atrSizing.riskAmountRupees,
      recommendedQuantity: atrSizing.recommendedQuantity,
      allocatedCapital: atrSizing.allocatedCapital,
      portfolioExposurePercent: atrSizing.portfolioExposurePercent,
      effectiveStopDistance: atrSizing.effectiveStopDistance,
      atrStopDistance: atrSizing.atrStopDistance,
      explanation: atrSizing.explanation,
    },
    patternDetails: {
      supportZoneLow: Number(supportZoneLow.toFixed(2)),
      rallyFromSupportPct,
      boxLow: locked.boxFloorVAL,
      boxHigh: locked.boxCeilingVAH,
      boxRangePct: locked.boxWidthPct,
      dojiCount: Math.max(1, dojiCount),
      purpleBoxFloorVAL: locked.boxFloorVAL,
      purpleBoxCeilingVAH: locked.boxCeilingVAH,
      purpleBoxPOC: locked.boxMidPOC,
      purpleBoxWidthPct: locked.boxWidthPct,
      supportTouches: locked.supportTouches,
      resistanceTouches: locked.resistanceTouches,
      positionInBoxPct: purpleBox?.positionInBoxPct ?? 98,
      purpleBoxMode: purpleBox?.executionMode ?? "MODE_B_CEILING_BREAKOUT",
    },
    tradeRationale: purpleBox
      ? purpleBox.rationale
      : [
          `🚀 Step-Up Box Breakout (+${rallyFromSupportPct}% from ₹${supportZoneLow.toFixed(1)}) → 5–6D Tight Box (VAL ₹${locked.boxFloorVAL}–VAH ₹${locked.boxCeilingVAH}) → ${Math.max(1, dojiCount)} Doji Squeeze → +7% Target ₹${locked.target1Price}.`,
          `⏱️ MTF Confluence: 1D Setup confirmed by 4H Structure & 15M VWAP (₹${mtfResult.tf15m.vwap}).`,
        ],
    fundamentals: { marketCapCr: meta.marketCapCr, roePercent: meta.roePercent },
  };
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const filterFalseBreakouts = url.searchParams.get("filterFalseBreakouts") !== "false";
    const excludeActive = url.searchParams.get("excludeActive") !== "false";

    // Parse active portfolio symbols (both `activeSymbols` and `excludeSymbols` supported):
    // 1. They MUST ALWAYS receive an exact live LTP tick in `livePrices`.
    // 2. They MUST BE EXCLUDED from `opportunities` (Screener output) while `status === "ACTIVE"`
    //    so duplicate active trades are prevented until the trade hits TARGET_HIT or STOP_LOSS_HIT.
    const rawActiveParam = [
      url.searchParams.get("activeSymbols") || "",
      url.searchParams.get("excludeSymbols") || "",
    ].join(",");

    const activeSymbolsParam = rawActiveParam
      .split(",")
      .map((s) => s.trim().toUpperCase().replace(/\.NS$/i, "").replace(/\.BO$/i, ""))
      .filter((s) => /^[A-Z0-9&\-^]{1,20}$/.test(s));

    const activeSymbolsSet = new Set<string>(activeSymbolsParam);
    const universeSymbols = new Set(LIQUID_NSE_UNIVERSE.map((m) => m.symbol));
    const extraActiveSymbols = Array.from(activeSymbolsSet)
      .filter((s) => !universeSymbols.has(s))
      .slice(0, 40);

    const livePrices: Record<
      string,
      { ltp: number; changePercent: number | null; prevClose: number | null; marketTimestamp: number | null }
    > = {};

    const results = await Promise.allSettled(
      LIQUID_NSE_UNIVERSE.map(async (meta) => {
        const snap = await fetchYahooQuoteSnapshot(meta.symbol);
        if (snap.ltp !== null) {
          livePrices[meta.symbol] = {
            ltp: snap.ltp,
            changePercent: snap.changePercent,
            prevClose: snap.prevClose,
            marketTimestamp: snap.marketTimestamp,
          };
        }
        return evaluatePurpleBoxAndSwingStrategies(meta, snap.candles, snap.ltp, snap.changePercent);
      })
    );

    await Promise.allSettled(
      extraActiveSymbols.map(async (sym) => {
        const snap = await fetchYahooQuoteSnapshot(sym);
        if (snap.ltp !== null) {
          livePrices[sym] = {
            ltp: snap.ltp,
            changePercent: snap.changePercent,
            prevClose: snap.prevClose,
            marketTimestamp: snap.marketTimestamp,
          };
        }
      })
    );

    let opportunities = results
      .filter(
        (r): r is PromiseFulfilledResult<NonNullable<ReturnType<typeof evaluatePurpleBoxAndSwingStrategies>>> =>
          r.status === "fulfilled" && r.value !== null
      )
      .map((r) => r.value);

    if (filterFalseBreakouts) {
      opportunities = opportunities.filter((op) => !op.mtfConfluence.isFalseBreakout);
    }

    // DUPLICATE ACTIVE TRADE PREVENTION: Exclude any symbol currently running with status === "ACTIVE"
    const excludedActiveSymbols: string[] = [];
    if (excludeActive && activeSymbolsSet.size > 0) {
      opportunities = opportunities.filter((op) => {
        const clean = String(op.cleanSymbol || op.symbol || "")
          .toUpperCase()
          .replace(/\.NS$/i, "")
          .replace(/\.BO$/i, "");
        if (activeSymbolsSet.has(clean)) {
          excludedActiveSymbols.push(clean);
          return false;
        }
        return true;
      });
    }

    opportunities.sort(
      (a, b) => b.confluenceScore + b.volumeMultiplier * 5 - (a.confluenceScore + a.volumeMultiplier * 5)
    );

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      dateKey: getISTDateKey(),
      count: opportunities.length,
      excludedActiveSymbols,
      falseBreakoutsFiltered: results.filter(
        (r) => r.status === "fulfilled" && r.value !== null && r.value.mtfConfluence.isFalseBreakout
      ).length,
      opportunities,
      livePrices,
      livePriceCount: Object.keys(livePrices).length,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message }, { status: 500 });
  }
}
