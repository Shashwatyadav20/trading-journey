import type { ExtractedFinancialFactRecord } from "./BseXbrlBackfillService.js";
import type { NormalizedShareholdingRecord } from "./OfficialShareholdingIntelligenceEngine.js";
import type { CorporateAnnouncementRecord } from "./CorporateAnnouncementCollector.js";

export type AblationMode =
  | "A_FULL_STRATEGY_03"
  | "B_FUNDAMENTAL_ONLY"
  | "C_FUNDAMENTAL_INSTITUTIONAL"
  | "D_FUNDAMENTAL_TECHNICAL"
  | "E_BENCHMARK";

export interface DailyCandleBar {
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  adjClose: number;
  volume: number;
}

export interface PointInTimeSnapshot {
  symbol: string;
  sector: string;
  asOfDate: string;
  financials: ExtractedFinancialFactRecord[];
  ownership: NormalizedShareholdingRecord[];
  announcements: CorporateAnnouncementRecord[];
  candles: DailyCandleBar[];
}

export interface HistoricalScoreBreakdown {
  symbol: string;
  sector: string;
  asOfDate: string;
  ablationMode: AblationMode;
  futureGrowthScore: number; // max 20
  earningsQualityScore: number; // max 20
  institutionalScore: number; // max 15
  financialStrengthScore: number; // max 15
  valuationScore: number; // max 10
  businessExpansionScore: number; // max 10
  technicalScore: number; // max 10
  totalScore: number; // max 100
  decision: "ENTER_CANDIDATE" | "WAIT" | "REJECT";
  missingData: string[];
  publicationTimestamps: string[];
  avgDailyTurnoverCr: number;
}

export interface PortfolioSimConfig {
  topN: number; // 5, 10, or 20
  initialCapitalInr: number;
  rebalanceDates: string[];
  maxPositionWeight: number; // e.g. 0.25
  maxSectorWeight: number; // e.g. 0.35
  minAvgDailyTurnoverCr: number; // e.g. 2.0
  entryDelayTradingDays: number; // e.g. 1 (T+1)
  oneWayCostBps: number; // brokerage + STT + stamp + exchange + slippage in bps
  cashAnnualYieldPct: number; // e.g. 6.5% for uninvested cash
}

export interface PortfolioTradeRecord {
  date: string;
  symbol: string;
  side: "BUY" | "SELL";
  shares: number;
  execPrice: number;
  grossValueInr: number;
  costInr: number;
}

export interface PortfolioEquityPoint {
  date: string;
  equityInr: number;
  cashInr: number;
  investedWeight: number;
  holdingsCount: number;
  dailyReturn: number;
}

export interface PerformanceMetrics {
  startDate: string;
  endDate: string;
  tradingDays: number;
  totalReturnPct: number;
  cagrPct: number;
  annualizedVolatilityPct: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  winRatePct: number;
  avgWinnerPct: number;
  avgLoserPct: number;
  profitFactor: number;
  totalTurnoverPct: number;
  totalTransactionCostsInr: number;
  avgInvestedWeightPct: number;
  avgHoldingsCount: number;
  pctDaysInMarket: number;
  annualReturns: Record<string, number>;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function toIsoDate(ts: string | null | undefined): string | null {
  if (!ts) return null;
  const s = ts.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null;
}

/**
 * Strict point-in-time filter for financial facts:
 * - Excludes any fact whose filingDate (or reportingPeriod fallback) is > asOfDate.
 * - Preserves historical versions and selects the latest version published on or before asOfDate.
 */
export function filterFinancialsAsOf(
  facts: ExtractedFinancialFactRecord[],
  asOfDate: string
): ExtractedFinancialFactRecord[] {
  const eligible = facts.filter((f) => {
    const pub = toIsoDate(f.filingDate) ?? toIsoDate(f.reportingPeriod);
    return pub !== null && pub <= asOfDate;
  });

  const latestByPeriod = new Map<string, ExtractedFinancialFactRecord>();
  for (const f of eligible) {
    const key = `${f.symbol}|${f.statementScope}|${f.periodType}|${f.reportingPeriod}`;
    const prev = latestByPeriod.get(key);
    if (!prev || f.version > prev.version) {
      latestByPeriod.set(key, f);
    }
  }
  return [...latestByPeriod.values()].sort((a, b) =>
    a.reportingPeriod.localeCompare(b.reportingPeriod)
  );
}

/**
 * Strict point-in-time filter for institutional shareholding records:
 * - Never uses a quarter's ownership data before its publicationTimestamp / filingDate.
 */
export function filterOwnershipAsOf(
  records: NormalizedShareholdingRecord[],
  asOfDate: string
): NormalizedShareholdingRecord[] {
  const eligible = records.filter((r) => {
    const pub =
      toIsoDate(r.publicationTimestamp) ??
      toIsoDate(r.filingDate) ??
      toIsoDate(r.reportingQuarter);
    return pub !== null && pub <= asOfDate;
  });

  const latestByQuarter = new Map<string, NormalizedShareholdingRecord>();
  for (const r of eligible) {
    const key = `${r.symbol}|${r.exchange}|${r.reportingQuarter}`;
    const prev = latestByQuarter.get(key);
    if (!prev || r.version > prev.version) {
      latestByQuarter.set(key, r);
    }
  }
  return [...latestByQuarter.values()].sort((a, b) =>
    a.reportingQuarter.localeCompare(b.reportingQuarter)
  );
}

export function filterAnnouncementsAsOf(
  announcements: CorporateAnnouncementRecord[],
  asOfDate: string
): CorporateAnnouncementRecord[] {
  return announcements.filter((a) => {
    const rawPub = (a as { publishedAt?: string | null }).publishedAt ?? a.evidence?.publishedAt;
    const pub = toIsoDate(rawPub);
    return pub !== null && pub <= asOfDate;
  });
}

export function filterCandlesAsOf(candles: DailyCandleBar[], asOfDate: string): DailyCandleBar[] {
  return candles.filter((c) => c.date <= asOfDate);
}

/**
 * Evaluates a point-in-time snapshot using Strategy 03's 100-point weights (20/20/15/15/10/10/10)
 * and supports ablation modes A..D without modifying production weights.
 */
export function evaluatePointInTimeSnapshot(
  snapshot: PointInTimeSnapshot,
  ablationMode: AblationMode = "A_FULL_STRATEGY_03"
): HistoricalScoreBreakdown {
  const missingData: string[] = [];
  const pubTimestamps: string[] = [];

  const verifiedFins = snapshot.financials.filter((f) => f.verificationStatus === "VERIFIED");
  for (const f of verifiedFins) {
    pubTimestamps.push(`FIN:${f.reportingPeriod}@${f.filingDate ?? f.reportingPeriod}`);
  }

  // 1. Future growth (20) & Earnings quality (20) & Financial strength (15) & Valuation (10)
  let futureGrowthScore = 0;
  let earningsQualityScore = 0;
  let financialStrengthScore = 0;
  let valuationScore = 0;

  if (verifiedFins.length >= 2) {
    const latest = verifiedFins[verifiedFins.length - 1];
    const prior = verifiedFins[verifiedFins.length - 2];
    if (latest.revenueCr !== null && prior.revenueCr !== null && prior.revenueCr > 0) {
      const revGrowth = (latest.revenueCr - prior.revenueCr) / prior.revenueCr;
      futureGrowthScore += revGrowth >= 0.12 ? 12 : revGrowth >= 0.05 ? 8 : revGrowth > 0 ? 4 : 0;
    } else {
      missingData.push("revenueGrowth");
    }
    if (latest.netProfitCr !== null && prior.netProfitCr !== null && prior.netProfitCr > 0) {
      const patGrowth = (latest.netProfitCr - prior.netProfitCr) / Math.abs(prior.netProfitCr);
      futureGrowthScore += patGrowth >= 0.15 ? 8 : patGrowth >= 0.05 ? 5 : patGrowth > 0 ? 2 : 0;
    } else {
      missingData.push("profitGrowth");
    }

    if (latest.revenueCr !== null && latest.revenueCr > 0 && latest.netProfitCr !== null) {
      const npm = latest.netProfitCr / latest.revenueCr;
      earningsQualityScore += npm >= 0.15 ? 12 : npm >= 0.08 ? 8 : npm > 0 ? 4 : 0;
    }
    if (latest.cfoCr !== null && latest.netProfitCr !== null && latest.netProfitCr > 0) {
      earningsQualityScore += latest.cfoCr >= latest.netProfitCr * 0.8 ? 8 : latest.cfoCr > 0 ? 4 : 0;
    } else {
      earningsQualityScore += latest.epsInr !== null && latest.epsInr > 0 ? 4 : 0;
    }

    if (latest.totalDebtCr !== null && latest.equityCr !== null && latest.equityCr > 0) {
      const de = latest.totalDebtCr / latest.equityCr;
      financialStrengthScore += de <= 0.5 ? 15 : de <= 1.0 ? 10 : 4;
    } else if (latest.pbtCr !== null && latest.pbtCr > 0) {
      financialStrengthScore += 8;
    } else {
      missingData.push("balanceSheetStrength");
    }

    // Valuation proxy: positive EPS / earnings yield
    if (latest.epsInr !== null && latest.epsInr > 0) {
      valuationScore += 7;
    } else {
      missingData.push("epsValuation");
    }
  } else {
    missingData.push("insufficientVerifiedFinancials");
  }

  // 2. Institutional ownership (15)
  let institutionalScore = 0;
  const verifiedOwn = snapshot.ownership.filter((o) => o.verificationStatus === "VERIFIED");
  if (verifiedOwn.length > 0) {
    const latestOwn = verifiedOwn[verifiedOwn.length - 1];
    pubTimestamps.push(`SHP:${latestOwn.reportingQuarter}@${latestOwn.filingDate ?? latestOwn.reportingQuarter}`);
    if ((latestOwn.fiiQoqChangePp ?? 0) > 0) institutionalScore += 5;
    if ((latestOwn.diiQoqChangePp ?? 0) > 0) institutionalScore += 5;
    if ((latestOwn.mutualFundPct ?? 0) >= 3) institutionalScore += 3;
    if ((latestOwn.promoterPledgedPct ?? 100) <= 5) institutionalScore += 2;
  } else {
    missingData.push("verifiedInstitutionalOwnership");
  }

  // 3. Business expansion (10)
  let businessExpansionScore = 0;
  if (snapshot.announcements.length > 0) {
    businessExpansionScore = Math.min(10, snapshot.announcements.length * 3);
  } else {
    missingData.push("corporateAnnouncements");
  }

  // 4. Technical confirmation (10) using only PIT candles
  let technicalScore = 0;
  let avgDailyTurnoverCr = 0;
  if (snapshot.candles.length >= 50) {
    const recent = snapshot.candles.slice(-20);
    avgDailyTurnoverCr =
      recent.reduce((acc, c) => acc + (c.close * c.volume) / 1e7, 0) / recent.length;
    const last = snapshot.candles[snapshot.candles.length - 1];
    const sma50 =
      snapshot.candles.slice(-50).reduce((acc, c) => acc + c.adjClose, 0) / 50;
    const sma200 =
      snapshot.candles.length >= 200
        ? snapshot.candles.slice(-200).reduce((acc, c) => acc + c.adjClose, 0) / 200
        : sma50;
    if (last.adjClose > sma50) technicalScore += 5;
    if (last.adjClose > sma200) technicalScore += 5;
  } else {
    missingData.push("insufficientTechnicalCandles");
  }

  // Apply ablation masks without altering underlying 100-point weights
  if (ablationMode === "B_FUNDAMENTAL_ONLY") {
    institutionalScore = 0;
    businessExpansionScore = 0;
    technicalScore = 0;
  } else if (ablationMode === "C_FUNDAMENTAL_INSTITUTIONAL") {
    businessExpansionScore = 0;
    technicalScore = 0;
  } else if (ablationMode === "D_FUNDAMENTAL_TECHNICAL") {
    institutionalScore = 0;
    businessExpansionScore = 0;
  }

  const totalScore = round2(
    futureGrowthScore +
      earningsQualityScore +
      institutionalScore +
      financialStrengthScore +
      valuationScore +
      businessExpansionScore +
      technicalScore
  );

  const hasCoreFinancials = verifiedFins.length >= 2;
  const decision: HistoricalScoreBreakdown["decision"] = !hasCoreFinancials
    ? "WAIT"
    : totalScore >= 50
    ? "ENTER_CANDIDATE"
    : totalScore >= 30
    ? "WAIT"
    : "REJECT";

  return {
    symbol: snapshot.symbol,
    sector: snapshot.sector,
    asOfDate: snapshot.asOfDate,
    ablationMode,
    futureGrowthScore,
    earningsQualityScore,
    institutionalScore,
    financialStrengthScore,
    valuationScore,
    businessExpansionScore,
    technicalScore,
    totalScore,
    decision,
    missingData,
    publicationTimestamps: pubTimestamps,
    avgDailyTurnoverCr: round2(avgDailyTurnoverCr),
  };
}

/**
 * Research-only portfolio simulator using adjusted close prices (total-return proxy for equities),
 * T+1 entry delay, liquidity filter, sector cap, and realistic transaction costs.
 */
export function simulateResearchPortfolio(params: {
  candlesBySymbol: Map<string, DailyCandleBar[]>;
  evaluationsByDate: Map<string, HistoricalScoreBreakdown[]>;
  allTradingDates: string[];
  config: PortfolioSimConfig;
}): {
  equityCurve: PortfolioEquityPoint[];
  trades: PortfolioTradeRecord[];
  metrics: PerformanceMetrics;
} {
  const { candlesBySymbol, evaluationsByDate, allTradingDates, config } = params;
  const priceMap = new Map<string, Map<string, DailyCandleBar>>();
  for (const [sym, bars] of candlesBySymbol.entries()) {
    const m = new Map<string, DailyCandleBar>();
    for (const b of bars) m.set(b.date, b);
    priceMap.set(sym, m);
  }

  // Schedule pending target allocations on T + entryDelayTradingDays
  const pendingRebalance = new Map<string, HistoricalScoreBreakdown[]>();
  for (const rDate of config.rebalanceDates) {
    const idx = allTradingDates.findIndex((d) => d >= rDate);
    if (idx === -1) continue;
    const execIdx = Math.min(allTradingDates.length - 1, idx + config.entryDelayTradingDays);
    const evals = evaluationsByDate.get(rDate) ?? [];
    pendingRebalance.set(allTradingDates[execIdx], evals);
  }

  let cash = config.initialCapitalInr;
  const holdings = new Map<string, number>(); // symbol -> shares
  const lastPrice = new Map<string, number>();
  const trades: PortfolioTradeRecord[] = [];
  const equityCurve: PortfolioEquityPoint[] = [];
  const dailyCashRate = Math.pow(1 + config.cashAnnualYieldPct / 100, 1 / 252) - 1;
  const costRate = config.oneWayCostBps / 10_000;
  let prevEquity = config.initialCapitalInr;

  for (const date of allTradingDates) {
    // Accrue cash yield
    cash *= 1 + dailyCashRate;

    // Update latest known adjusted prices
    for (const [sym, m] of priceMap.entries()) {
      const bar = m.get(date);
      if (bar) lastPrice.set(sym, bar.adjClose);
    }

    const markToMarket = () => {
      let mv = 0;
      for (const [sym, shares] of holdings.entries()) {
        mv += shares * (lastPrice.get(sym) ?? 0);
      }
      return cash + mv;
    };

    // Execute rebalance if scheduled for today
    const evals = pendingRebalance.get(date);
    if (evals) {
      const totalEq = markToMarket();
      // Select eligible candidates: ENTER_CANDIDATE (or top scored with non-missing financials), liquid
      const eligible = evals
        .filter(
          (e) =>
            e.decision === "ENTER_CANDIDATE" &&
            e.avgDailyTurnoverCr >= config.minAvgDailyTurnoverCr &&
            priceMap.get(e.symbol)?.has(date)
        )
        .sort((a, b) => b.totalScore - a.totalScore);

      const selected: HistoricalScoreBreakdown[] = [];
      const sectorWeights = new Map<string, number>();
      const rawWeight = Math.min(config.maxPositionWeight, 1 / Math.max(1, config.topN));

      for (const cand of eligible) {
        if (selected.length >= config.topN) break;
        const currSecW = sectorWeights.get(cand.sector) ?? 0;
        if (currSecW + rawWeight <= config.maxSectorWeight + 1e-6) {
          selected.push(cand);
          sectorWeights.set(cand.sector, currSecW + rawWeight);
        }
      }

      const targetWeightBySym = new Map<string, number>();
      for (const s of selected) targetWeightBySym.set(s.symbol, rawWeight);

      // Sell positions not in target or overweight
      for (const [sym, shares] of [...holdings.entries()]) {
        const px = lastPrice.get(sym) ?? 0;
        if (px <= 0) continue;
        const targetVal = (targetWeightBySym.get(sym) ?? 0) * totalEq;
        const currVal = shares * px;
        if (currVal > targetVal + 1) {
          const sellVal = currVal - targetVal;
          const sellShares = Math.min(shares, sellVal / px);
          const gross = sellShares * px;
          const cost = gross * costRate;
          cash += gross - cost;
          const rem = shares - sellShares;
          if (rem <= 1e-6) holdings.delete(sym);
          else holdings.set(sym, rem);
          trades.push({
            date,
            symbol: sym,
            side: "SELL",
            shares: round2(sellShares),
            execPrice: round2(px),
            grossValueInr: round2(gross),
            costInr: round2(cost),
          });
        }
      }

      // Buy target positions
      for (const [sym, w] of targetWeightBySym.entries()) {
        const px = lastPrice.get(sym) ?? 0;
        if (px <= 0) continue;
        const currShares = holdings.get(sym) ?? 0;
        const currVal = currShares * px;
        const targetVal = w * totalEq;
        if (targetVal > currVal + 1) {
          const desiredGross = Math.min(targetVal - currVal, cash / (1 + costRate));
          if (desiredGross > 100) {
            const buyShares = desiredGross / px;
            const cost = desiredGross * costRate;
            cash -= desiredGross + cost;
            holdings.set(sym, currShares + buyShares);
            trades.push({
              date,
              symbol: sym,
              side: "BUY",
              shares: round2(buyShares),
              execPrice: round2(px),
              grossValueInr: round2(desiredGross),
              costInr: round2(cost),
            });
          }
        }
      }
    }

    const eq = markToMarket();
    const dailyReturn = prevEquity > 0 ? eq / prevEquity - 1 : 0;
    prevEquity = eq;
    equityCurve.push({
      date,
      equityInr: round2(eq),
      cashInr: round2(cash),
      investedWeight: eq > 0 ? round2((eq - cash) / eq) : 0,
      holdingsCount: holdings.size,
      dailyReturn,
    });
  }

  const metrics = computePerformanceMetrics({
    equityCurve,
    trades,
    initialCapitalInr: config.initialCapitalInr,
  });

  return { equityCurve, trades, metrics };
}

export function computePerformanceMetrics(params: {
  equityCurve: PortfolioEquityPoint[];
  trades: PortfolioTradeRecord[];
  initialCapitalInr: number;
}): PerformanceMetrics {
  const { equityCurve, trades, initialCapitalInr } = params;
  if (equityCurve.length === 0) {
    return {
      startDate: "",
      endDate: "",
      tradingDays: 0,
      totalReturnPct: 0,
      cagrPct: 0,
      annualizedVolatilityPct: 0,
      maxDrawdownPct: 0,
      sharpeRatio: 0,
      sortinoRatio: 0,
      calmarRatio: 0,
      winRatePct: 0,
      avgWinnerPct: 0,
      avgLoserPct: 0,
      profitFactor: 0,
      totalTurnoverPct: 0,
      totalTransactionCostsInr: 0,
      avgInvestedWeightPct: 0,
      avgHoldingsCount: 0,
      pctDaysInMarket: 0,
      annualReturns: {},
    };
  }

  const first = equityCurve[0];
  const last = equityCurve[equityCurve.length - 1];
  const totalReturn = last.equityInr / initialCapitalInr - 1;
  const years = Math.max(1 / 252, equityCurve.length / 252);
  const cagr = Math.pow(Math.max(0.0001, 1 + totalReturn), 1 / years) - 1;

  const rets = equityCurve.map((p) => p.dailyReturn);
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, r) => a + (r - mean) ** 2, 0) / Math.max(1, rets.length - 1);
  const annVol = Math.sqrt(variance) * Math.sqrt(252);

  const downsideSq = rets.filter((r) => r < 0).reduce((a, r) => a + r * r, 0) / Math.max(1, rets.length);
  const downsideDev = Math.sqrt(downsideSq) * Math.sqrt(252);

  let peak = initialCapitalInr;
  let maxDd = 0;
  for (const p of equityCurve) {
    if (p.equityInr > peak) peak = p.equityInr;
    const dd = (peak - p.equityInr) / peak;
    if (dd > maxDd) maxDd = dd;
  }

  const sharpe = annVol > 0 ? (cagr - 0.06) / annVol : 0;
  const sortino = downsideDev > 0 ? (cagr - 0.06) / downsideDev : 0;
  const calmar = maxDd > 0 ? cagr / maxDd : 0;

  const wins = rets.filter((r) => r > 0);
  const losses = rets.filter((r) => r < 0);
  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));

  const annualReturns: Record<string, number> = {};
  const byYear = new Map<string, PortfolioEquityPoint[]>();
  for (const p of equityCurve) {
    const yr = p.date.slice(0, 4);
    const arr = byYear.get(yr) ?? [];
    arr.push(p);
    byYear.set(yr, arr);
  }
  let prevYearEnd = initialCapitalInr;
  for (const [yr, pts] of [...byYear.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const endEq = pts[pts.length - 1].equityInr;
    annualReturns[yr] = round2((endEq / prevYearEnd - 1) * 100);
    prevYearEnd = endEq;
  }

  const totalTradedGross = trades.reduce((a, t) => a + t.grossValueInr, 0);
  const totalCosts = trades.reduce((a, t) => a + t.costInr, 0);
  const avgInvestedWeightPct = round2(
    (equityCurve.reduce((a, p) => a + p.investedWeight, 0) / equityCurve.length) * 100
  );
  const avgHoldingsCount = round2(
    equityCurve.reduce((a, p) => a + p.holdingsCount, 0) / equityCurve.length
  );
  const pctDaysInMarket = round2(
    (equityCurve.filter((p) => p.holdingsCount > 0).length / equityCurve.length) * 100
  );

  return {
    startDate: first.date,
    endDate: last.date,
    tradingDays: equityCurve.length,
    totalReturnPct: round2(totalReturn * 100),
    cagrPct: round2(cagr * 100),
    annualizedVolatilityPct: round2(annVol * 100),
    maxDrawdownPct: round2(maxDd * 100),
    sharpeRatio: round2(sharpe),
    sortinoRatio: round2(sortino),
    calmarRatio: round2(calmar),
    winRatePct: round2((wins.length / Math.max(1, wins.length + losses.length)) * 100),
    avgWinnerPct: wins.length > 0 ? round2((grossWin / wins.length) * 100) : 0,
    avgLoserPct: losses.length > 0 ? round2((grossLoss / losses.length) * -100) : 0,
    profitFactor: grossLoss > 0 ? round2(grossWin / grossLoss) : 0,
    totalTurnoverPct: round2((totalTradedGross / initialCapitalInr) * 100),
    totalTransactionCostsInr: round2(totalCosts),
    avgInvestedWeightPct,
    avgHoldingsCount,
    pctDaysInMarket,
    annualReturns,
  };
}
