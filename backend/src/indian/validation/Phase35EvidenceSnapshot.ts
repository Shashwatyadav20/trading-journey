export interface FinalStatisticsSnapshot {
  sampleSize: number;
  winRate: number;
  profitFactor: number | "NOT_AVAILABLE";
  expectancy: number;
  averagePnL: number;
  medianPnL: number;
  maxDrawdown: number;
  largestWin: number;
  largestLoss: number;
  maxConsecutiveLosses: number;
  winRateConfidence95: { lowerBoundPct: number; upperBoundPct: number };
  bootstrapExpectancy95: { lower: number; upper: number };
}

export interface OOSEvidenceSnapshot {
  inSampleWinRate: number;
  oosWinRate: number;
  winRateDiff: number;
  inSampleExpectancy: number;
  oosExpectancy: number;
  expectancyDiff: number;
  inSampleDrawdown: number;
  oosDrawdown: number;
  drawdownDiff: number;
}

export interface StressEvidenceSnapshot {
  slippageStress: Array<{ name: string; stressedNetPnL: number; netPnLDiff: number }>;
  delayStress: Array<{ name: string; stressedNetPnL: number; netPnLDiff: number }>;
  spreadStress: Array<{ name: string; stressedNetPnL: number; netPnLDiff: number }>;
  worstSequenceDrawdown: number;
  tailLoss2xDrawdown: number;
  dataQualityResilience: "PASS" | "FAIL";
  monteCarloP95Drawdown: number;
}

export interface LongHorizonEvidenceSnapshot {
  genuineSessionsCount: number;
  genuineTradesCount: number;
  gatePassed: boolean;
  driftStatus: string;
  w60Status: string;
}

export interface RiskSummarySnapshot {
  maxDrawdownInr: number;
  maxDailyLossInr: number;
  maxDailyGainInr: number;
  largestLossInr: number;
  largestWinInr: number;
  maxConsecutiveLosses: number;
  profitLockEvents: number;
  lossLockEvents: number;
  emergencyExits: number;
  pnlReconciliationStatus: "PASS" | "FAIL";
}

export interface OperationalStabilitySnapshot {
  dhanConnectionFailures: number;
  webSocketFailures: number;
  webSocketRecoveries: number;
  optionChainFailures: number;
  staleDataEvents: number;
  priceMismatchEvents: number;
  backendRestartEvents: number;
  duplicateSuppressionEvents: number;
  unresolvedIncidents: number;
  overallStatus: "ALL_RECOVERED" | "UNRESOLVED_INCIDENTS";
}

export interface SafetyAuditSnapshot {
  paperTrading: boolean;
  liveTrading: boolean;
  brokerExecution: boolean;
  realDataOnly: boolean;
  realBrokerOrders: 0;
  placeOrderBlocked: boolean;
  modifyOrderBlocked: boolean;
  cancelOrderBlocked: boolean;
  overallStatus: "PASS" | "FAIL";
}

export interface Phase35EvidenceSnapshot {
  snapshotId: string;
  strategyFingerprint: string;
  finalStatistics: FinalStatisticsSnapshot;
  oosEvidence: OOSEvidenceSnapshot;
  stressEvidence: StressEvidenceSnapshot;
  longHorizonEvidence: LongHorizonEvidenceSnapshot;
  riskSummary: RiskSummarySnapshot;
  operationalStability: OperationalStabilitySnapshot;
  safetyAudit: SafetyAuditSnapshot;
  generatedAt: string;
}
