import { describe, expect, it } from "vitest";
import {
  evaluatePointInTimeSnapshot,
  filterAnnouncementsAsOf,
  filterCandlesAsOf,
  filterFinancialsAsOf,
  filterOwnershipAsOf,
  simulateResearchPortfolio,
  type DailyCandleBar,
} from "../HistoricalValidationEngine.js";
import type { ExtractedFinancialFactRecord } from "../BseXbrlBackfillService.js";
import type { NormalizedShareholdingRecord } from "../OfficialShareholdingIntelligenceEngine.js";
import type { CorporateAnnouncementRecord } from "../CorporateAnnouncementCollector.js";

function makeFin(period: string, filingDate: string, rev: number, pat: number, version = 1): ExtractedFinancialFactRecord {
  return {
    idempotencyKey: `INFY|CONSOLIDATED|Q1|${period}|v${version}`,
    symbol: "INFY",
    bseCode: "500209",
    statementScope: "CONSOLIDATED",
    periodType: "Q1",
    financialYear: "2024-2025",
    reportingPeriod: period,
    filingDate,
    version,
    isRestated: version > 1,
    isDerivedQuarterly: false,
    revenueCr: rev,
    ebitdaCr: pat * 1.4,
    operatingProfitCr: pat * 1.2,
    pbtCr: pat * 1.25,
    netProfitCr: pat,
    epsInr: 15,
    interestExpenseCr: 10,
    depreciationCr: 50,
    totalDebtCr: 0,
    cashAndEquivalentsCr: 1000,
    equityCr: 50000,
    cfoCr: pat * 1.1,
    capexCr: 100,
    fcfCr: pat * 1.1 - 100,
    sourceName: "NSE_BSE_INDAS_XBRL",
    sourceFilingId: "1",
    sourceUrl: "https://nsearchives.nseindia.in/corporate/xbrl/test.xml",
    extractedFileName: "test.xml",
    extractionMethod: "XBRL_XML",
    verificationStatus: "VERIFIED",
    hasSourceConflict: false,
    conflictNotes: [],
    confidence: 0.96,
    rawContextSummary: {},
    retrievedAt: "2025-01-20T00:00:00Z",
  };
}

function makeOwn(qtr: string, pubDate: string, fiiQoq: number): NormalizedShareholdingRecord {
  return {
    idempotencyKey: `INFY|NSE|${qtr}|v1`,
    symbol: "INFY",
    isin: "INE009A01021",
    exchange: "NSE",
    reportingQuarter: qtr,
    filingDate: pubDate,
    publicationTimestamp: `${pubDate}T12:00:00Z`,
    retrievedAt: "2025-01-20T00:00:00Z",
    filingId: "1",
    sourceName: "NSE_BSE_SHP_XBRL",
    sourceUrl: "https://nsearchives.nseindia.in/corporate/xbrl/shp.xml",
    extractionVersion: "1.0.0",
    version: 1,
    isRestated: false,
    promoterPct: 14,
    promoterPledgedPct: 0,
    fiiPct: 33,
    fpiCat1Pct: 30,
    fpiCat2Pct: 3,
    diiPct: 35,
    mutualFundPct: 18,
    insurancePct: 10,
    banksFiPct: 1,
    governmentPct: 0,
    publicPct: 86,
    otherInstitutionalPct: 0,
    totalReportedPct: 100,
    isTotalReconciled: true,
    fiiQoqChangePp: fiiQoq,
    diiQoqChangePp: 0.5,
    mfQoqChangePp: 0.3,
    promoterQoqChangePp: 0,
    pledgeQoqChangePp: 0,
    fiiYoyChangePp: 1.5,
    diiYoyChangePp: 1.0,
    mfYoyChangePp: 0.5,
    consecutiveFiiAccumQtrs: 2,
    consecutiveFiiReduceQtrs: 0,
    consecutiveDiiAccumQtrs: 2,
    consecutiveDiiReduceQtrs: 0,
    rawClassifications: {},
    validationNotes: [],
    verificationStatus: "VERIFIED",
    hasSourceConflict: false,
    confidence: 0.96,
  };
}

describe("Strategy 03 Phase 6.5 — Point-in-Time Historical Validation Engine", () => {
  it("prevents future financial, shareholding, announcement, and candle leakage", () => {
    const fins = [
      makeFin("2024-06-30", "2024-07-18", 10000, 1500, 1),
      makeFin("2024-06-30", "2024-11-01", 10200, 1550, 2), // Restated later
      makeFin("2024-09-30", "2024-10-17", 11500, 1800, 1),
    ];
    const pitAug = filterFinancialsAsOf(fins, "2024-08-01");
    expect(pitAug).toHaveLength(1);
    expect(pitAug[0].version).toBe(1);
    expect(pitAug[0].revenueCr).toBe(10000);

    const pitNov = filterFinancialsAsOf(fins, "2024-11-15");
    expect(pitNov).toHaveLength(2);
    expect(pitNov[0].version).toBe(2); // Picks restated v2 only after 2024-11-01

    const owns = [
      makeOwn("2024-06-30", "2024-07-20", 0.5),
      makeOwn("2024-09-30", "2024-10-20", 1.2),
    ];
    expect(filterOwnershipAsOf(owns, "2024-10-01")).toHaveLength(1);
    expect(filterOwnershipAsOf(owns, "2024-10-25")).toHaveLength(2);

    const anns = [
      { evidence: { publishedAt: "2024-08-05T10:00:00Z" } } as CorporateAnnouncementRecord,
      { evidence: { publishedAt: "2024-12-01T10:00:00Z" } } as CorporateAnnouncementRecord,
    ];
    expect(filterAnnouncementsAsOf(anns, "2024-10-01")).toHaveLength(1);

    const candles: DailyCandleBar[] = [
      { date: "2024-09-30", open: 100, high: 102, low: 99, close: 101, adjClose: 101, volume: 100000 },
      { date: "2024-10-05", open: 105, high: 106, low: 104, close: 105, adjClose: 105, volume: 100000 },
    ];
    expect(filterCandlesAsOf(candles, "2024-10-01")).toHaveLength(1);
  });

  it("enforces missing-data WAIT behavior and reproducible ablation scoring", () => {
    const missingScore = evaluatePointInTimeSnapshot({
      symbol: "MISSINGCO",
      sector: "IT",
      asOfDate: "2024-10-01",
      financials: [],
      ownership: [],
      announcements: [],
      candles: [],
    });
    expect(missingScore.decision).toBe("WAIT");
    expect(missingScore.missingData).toContain("insufficientVerifiedFinancials");

    const candles: DailyCandleBar[] = Array.from({ length: 60 }, (_, i) => ({
      date: `2024-08-${String((i % 28) + 1).padStart(2, "0")}`,
      open: 100 + i,
      high: 102 + i,
      low: 99 + i,
      close: 101 + i,
      adjClose: 101 + i,
      volume: 1_000_000,
    }));

    const full = evaluatePointInTimeSnapshot(
      {
        symbol: "INFY",
        sector: "IT",
        asOfDate: "2024-11-01",
        financials: [
          makeFin("2024-06-30", "2024-07-18", 10000, 1500),
          makeFin("2024-09-30", "2024-10-17", 11500, 1800),
        ],
        ownership: [makeOwn("2024-09-30", "2024-10-20", 1.2)],
        announcements: [],
        candles,
      },
      "A_FULL_STRATEGY_03"
    );
    const fundOnly = evaluatePointInTimeSnapshot(
      {
        symbol: "INFY",
        sector: "IT",
        asOfDate: "2024-11-01",
        financials: [
          makeFin("2024-06-30", "2024-07-18", 10000, 1500),
          makeFin("2024-09-30", "2024-10-17", 11500, 1800),
        ],
        ownership: [makeOwn("2024-09-30", "2024-10-20", 1.2)],
        announcements: [],
        candles,
      },
      "B_FUNDAMENTAL_ONLY"
    );
    expect(full.totalScore).toBeGreaterThan(fundOnly.totalScore);
    expect(fundOnly.institutionalScore).toBe(0);
    expect(fundOnly.technicalScore).toBe(0);
  });

  it("simulates T+1 rebalancing, transaction costs, and adjusted total returns", () => {
    const dates = ["2024-10-01", "2024-10-02", "2024-10-03", "2024-10-04"];
    const bars: DailyCandleBar[] = [
      { date: "2024-10-01", open: 100, high: 100, low: 100, close: 100, adjClose: 100, volume: 1_000_000 },
      { date: "2024-10-02", open: 100, high: 100, low: 100, close: 100, adjClose: 100, volume: 1_000_000 },
      { date: "2024-10-03", open: 100, high: 110, low: 100, close: 110, adjClose: 110, volume: 1_000_000 },
      { date: "2024-10-04", open: 110, high: 110, low: 110, close: 110, adjClose: 110, volume: 1_000_000 },
    ];
    const evalsByDate = new Map([
      [
        "2024-10-01",
        [
          {
            symbol: "INFY",
            sector: "IT",
            asOfDate: "2024-10-01",
            ablationMode: "A_FULL_STRATEGY_03" as const,
            futureGrowthScore: 20,
            earningsQualityScore: 20,
            institutionalScore: 15,
            financialStrengthScore: 15,
            valuationScore: 7,
            businessExpansionScore: 0,
            technicalScore: 10,
            totalScore: 87,
            decision: "ENTER_CANDIDATE" as const,
            missingData: [],
            publicationTimestamps: [],
            avgDailyTurnoverCr: 10,
          },
        ],
      ],
    ]);

    const sim = simulateResearchPortfolio({
      candlesBySymbol: new Map([["INFY", bars]]),
      evaluationsByDate: evalsByDate,
      allTradingDates: dates,
      config: {
        topN: 5,
        initialCapitalInr: 100_000,
        rebalanceDates: ["2024-10-01"],
        maxPositionWeight: 0.25,
        maxSectorWeight: 0.35,
        minAvgDailyTurnoverCr: 2.0,
        entryDelayTradingDays: 1,
        oneWayCostBps: 25,
        cashAnnualYieldPct: 0,
      },
    });
    expect(sim.trades).toHaveLength(1);
    expect(sim.trades[0].date).toBe("2024-10-02"); // T+1 execution
    expect(sim.metrics.totalTransactionCostsInr).toBeGreaterThan(0);
    expect(sim.metrics.totalReturnPct).toBeGreaterThan(1.9); // 20% position gained 10% minus 25 bps cost = 1.95%
    expect(sim.metrics.pctDaysInMarket).toBeGreaterThan(0);
  });

  it("compounds 6.5% effective annual cash yield to exact 6.50% CAGR over 252 trading days", () => {
    const dates = Array.from({ length: 252 }, (_, i) => `2025-01-${String((i % 28) + 1).padStart(2, "0")}`);
    const cashSim = simulateResearchPortfolio({
      candlesBySymbol: new Map(),
      evaluationsByDate: new Map(),
      allTradingDates: dates,
      config: {
        topN: 10,
        initialCapitalInr: 1_000_000,
        rebalanceDates: [],
        maxPositionWeight: 0.25,
        maxSectorWeight: 0.35,
        minAvgDailyTurnoverCr: 2.0,
        entryDelayTradingDays: 1,
        oneWayCostBps: 25,
        cashAnnualYieldPct: 6.5,
      },
    });
    expect(cashSim.metrics.cagrPct).toBe(6.5);
    expect(cashSim.metrics.avgInvestedWeightPct).toBe(0);
    expect(cashSim.metrics.avgHoldingsCount).toBe(0);
  });
});
