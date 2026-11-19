export interface Strategy03ProposedRiskSpec {
  approvalRequired: true;
  appliedToProduction: false;
  maxCapitalAllocationPct: number;
  perPositionRiskPct: number;
  maxOpenPositions: number;
  maxPositionWeightPct: number;
  maxSectorConcentrationPct: number;
  minAvgDailyTurnoverCr: number;
  gapRiskHaircutPct: number;
  earningsBlackoutDaysBefore: number;
  maxDailyLossPct: number;
  maxPortfolioDrawdownPct: number;
  allowDuplicatePosition: false;
  allowAveragingDown: false;
  allowSizeIncreaseAfterLoss: false;
}

export const STRATEGY03_PROPOSED_RISK_SPEC: Strategy03ProposedRiskSpec = {
  approvalRequired: true,
  appliedToProduction: false,
  maxCapitalAllocationPct: 100,
  perPositionRiskPct: 1.0,
  maxOpenPositions: 10,
  maxPositionWeightPct: 12.5,
  maxSectorConcentrationPct: 25.0,
  minAvgDailyTurnoverCr: 5.0,
  gapRiskHaircutPct: 3.0,
  earningsBlackoutDaysBefore: 3,
  maxDailyLossPct: 2.0,
  maxPortfolioDrawdownPct: 12.0,
  allowDuplicatePosition: false,
  allowAveragingDown: false,
  allowSizeIncreaseAfterLoss: false,
};

export interface ForwardValidationAcceptanceCriteria {
  minLiveShadowCalendarDays: number;
  targetLiveShadowCalendarDays: number;
  minMatured60dSignals: number;
  minOutOfSampleSharpe: number;
  maxOutOfSampleDrawdownPct: number;
  minBootstrapLower95CagrPct: number;
  minFinancialVerificationPct: number;
  minOwnershipVerificationPct: number;
  requireBullBearSidewaysPositiveExpectancy: boolean;
  requireCostStress50BpsPositive: boolean;
}

export const FORWARD_VALIDATION_ACCEPTANCE_CRITERIA: ForwardValidationAcceptanceCriteria = {
  minLiveShadowCalendarDays: 90,
  targetLiveShadowCalendarDays: 120,
  minMatured60dSignals: 30,
  minOutOfSampleSharpe: 0.75,
  maxOutOfSampleDrawdownPct: 15.0,
  minBootstrapLower95CagrPct: 0.0,
  minFinancialVerificationPct: 80.0,
  minOwnershipVerificationPct: 80.0,
  requireBullBearSidewaysPositiveExpectancy: true,
  requireCostStress50BpsPositive: true,
};

export function validateStrategy03RiskProposal(
  spec: Strategy03ProposedRiskSpec,
  candidateOrder: {
    openPositionsCount: number;
    hasExistingOpenForSymbol: boolean;
    proposedPositionWeightPct: number;
    proposedSectorWeightPct: number;
    avgDailyTurnoverCr: number;
    daysToEarnings: number | null;
    dailyLossPct: number;
    portfolioDrawdownPct: number;
    isAveragingDown: boolean;
    isSizeIncreaseAfterLoss: boolean;
  }
): { allowed: boolean; violations: string[] } {
  const violations: string[] = [];
  if (candidateOrder.hasExistingOpenForSymbol && !spec.allowDuplicatePosition) {
    violations.push("DUPLICATE_POSITION_BLOCKED");
  }
  if (candidateOrder.isAveragingDown && !spec.allowAveragingDown) {
    violations.push("AVERAGING_DOWN_BLOCKED");
  }
  if (candidateOrder.isSizeIncreaseAfterLoss && !spec.allowSizeIncreaseAfterLoss) {
    violations.push("MARTINGALE_SIZE_INCREASE_BLOCKED");
  }
  if (candidateOrder.openPositionsCount >= spec.maxOpenPositions) {
    violations.push("MAX_OPEN_POSITIONS_REACHED");
  }
  if (candidateOrder.proposedPositionWeightPct > spec.maxPositionWeightPct) {
    violations.push("MAX_POSITION_WEIGHT_EXCEEDED");
  }
  if (candidateOrder.proposedSectorWeightPct > spec.maxSectorConcentrationPct) {
    violations.push("MAX_SECTOR_CONCENTRATION_EXCEEDED");
  }
  if (candidateOrder.avgDailyTurnoverCr < spec.minAvgDailyTurnoverCr) {
    violations.push("LIQUIDITY_BELOW_THRESHOLD");
  }
  if (
    candidateOrder.daysToEarnings !== null &&
    candidateOrder.daysToEarnings >= 0 &&
    candidateOrder.daysToEarnings <= spec.earningsBlackoutDaysBefore
  ) {
    violations.push("EARNINGS_BLACKOUT_WINDOW");
  }
  if (candidateOrder.dailyLossPct >= spec.maxDailyLossPct) {
    violations.push("MAX_DAILY_LOSS_BREACHED");
  }
  if (candidateOrder.portfolioDrawdownPct >= spec.maxPortfolioDrawdownPct) {
    violations.push("MAX_PORTFOLIO_DRAWDOWN_BREACHED");
  }
  return { allowed: violations.length === 0, violations };
}

export interface ProposedOpenPositionRisk {
  symbol: string;
  sector: string;
  notionalWeightPct: number;
  stopLossPct: number; // e.g. 8% stop -> 0.08 * notionalWeightPct = openRiskPct
  openRiskPct: number;
}

export function validateAggregateOpenRisk(params: {
  positions: ProposedOpenPositionRisk[];
  maxAggregateOpenRiskPct?: number; // default 10.0%
  maxSectorWeightPct?: number; // default 25.0%
}): {
  allowed: boolean;
  totalNotionalPct: number;
  totalAggregateOpenRiskPct: number;
  maxSectorObservedPct: number;
  violations: string[];
} {
  const maxRisk = params.maxAggregateOpenRiskPct ?? 10.0;
  const maxSec = params.maxSectorWeightPct ?? 25.0;
  const totalNotionalPct = Math.round(params.positions.reduce((a, p) => a + p.notionalWeightPct, 0) * 100) / 100;
  const totalAggregateOpenRiskPct = Math.round(params.positions.reduce((a, p) => a + p.openRiskPct, 0) * 100) / 100;

  const bySec = new Map<string, number>();
  for (const p of params.positions) {
    bySec.set(p.sector, (bySec.get(p.sector) ?? 0) + p.notionalWeightPct);
  }
  const maxSectorObservedPct = Math.round(Math.max(0, ...bySec.values()) * 100) / 100;

  const violations: string[] = [];
  if (totalAggregateOpenRiskPct > maxRisk) violations.push("AGGREGATE_OPEN_RISK_EXCEEDS_10_PCT");
  if (maxSectorObservedPct > maxSec) violations.push("SECTOR_CONCENTRATION_EXCEEDS_25_PCT");

  return {
    allowed: violations.length === 0,
    totalNotionalPct,
    totalAggregateOpenRiskPct,
    maxSectorObservedPct,
    violations,
  };
}

export function stressTestSimultaneousStopsAndGaps(params: {
  positions: ProposedOpenPositionRisk[];
  overnightGapPct: number; // e.g. 5% or 8% adverse gap
}): {
  simultaneousStopLossPct: number;
  overnightGapLossPct: number;
  breaches12PctPortfolioDrawdown: boolean;
} {
  const stopLoss = params.positions.reduce((a, p) => a + p.openRiskPct, 0);
  const gapLoss = params.positions.reduce(
    (a, p) => a + (p.notionalWeightPct * Math.max(p.stopLossPct, params.overnightGapPct)) / 100,
    0
  );
  const roundedStop = Math.round(stopLoss * 100) / 100;
  const roundedGap = Math.round(gapLoss * 100) / 100;
  return {
    simultaneousStopLossPct: roundedStop,
    overnightGapLossPct: roundedGap,
    breaches12PctPortfolioDrawdown: roundedGap >= 12.0 || roundedStop >= 12.0,
  };
}

export interface ExpandedGapStressRow {
  gapPct: number;
  deployedNotionalPct: number;
  stopRiskExposurePct: number;
  marketWideGapLossPct: number;
  correlatedSectorGapLossPct: number;
  singleStockIlliquidCircuitLossPct: number;
  breaches12PctHaltMarketWide: boolean;
}

export function runExpandedGapStressSuite(params: {
  positions: ProposedOpenPositionRisk[];
  gapScenariosPct?: number[];
  illiquidSlippageAddonPct?: number;
}): ExpandedGapStressRow[] {
  const scenarios = params.gapScenariosPct ?? [5, 10, 12, 15, 20];
  const addon = params.illiquidSlippageAddonPct ?? 3.0;
  const deployedNotionalPct = Math.round(params.positions.reduce((a, p) => a + p.notionalWeightPct, 0) * 100) / 100;
  const stopRiskExposurePct = Math.round(params.positions.reduce((a, p) => a + p.openRiskPct, 0) * 100) / 100;

  // Identify largest sector for correlated sector-wide gap
  const secTotals = new Map<string, number>();
  for (const p of params.positions) {
    secTotals.set(p.sector, (secTotals.get(p.sector) ?? 0) + p.notionalWeightPct);
  }
  const topSector = [...secTotals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  const maxPosNotional = Math.max(0, ...params.positions.map((p) => p.notionalWeightPct));

  return scenarios.map((gapPct) => {
    // Stop-losses do NOT fill at stop price during a gap; loss = max(stopLossPct, gapPct)
    const mktLoss = params.positions.reduce(
      (a, p) => a + (p.notionalWeightPct * Math.max(p.stopLossPct, gapPct)) / 100,
      0
    );
    const secLoss = params.positions.reduce((a, p) => {
      const effectiveGap = p.sector === topSector ? gapPct : gapPct * 0.5;
      return a + (p.notionalWeightPct * effectiveGap) / 100;
    }, 0);
    const singleIlliquid = (maxPosNotional * (gapPct + addon)) / 100;

    const rMkt = Math.round(mktLoss * 100) / 100;
    return {
      gapPct,
      deployedNotionalPct,
      stopRiskExposurePct,
      marketWideGapLossPct: rMkt,
      correlatedSectorGapLossPct: Math.round(secLoss * 100) / 100,
      singleStockIlliquidCircuitLossPct: Math.round(singleIlliquid * 100) / 100,
      breaches12PctHaltMarketWide: rMkt >= 12.0,
    };
  });
}

export const STRATEGY03_FAIL_CLOSED_GAP_CONTROLS = {
  approvalRequired: true as const,
  appliedToProduction: false as const,
  normalRegimeMaxDeployedNotionalPct: 75.0,
  highVolRegimeMaxDeployedNotionalPct: 60.0,
  minCashBufferPct: 25.0,
  maxPortfolioDrawdownHaltPct: 12.0,
  earningsBlackoutDaysBefore: 3,
  illiquidCircuitExitHaircutPct: 3.0,
};

