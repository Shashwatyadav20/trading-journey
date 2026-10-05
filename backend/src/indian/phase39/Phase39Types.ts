import * as crypto from "crypto";

export type Phase39State =
  | "VALIDATION_BLOCKED_INSUFFICIENT_SAMPLE"
  | "REVALIDATION_FAILED"
  | "REVALIDATION_COMPLETE"
  | "EVIDENCE_FREEZE_COMPLETE"
  | "WAITING_FOR_SAMPLE"
  | "REVALIDATION_RUNNING"
  | "EVIDENCE_INCONCLUSIVE"
  | "EVIDENCE_VALIDATED"
  | "COHORT_FROZEN";

export interface SampleGateProgress {
  genuineSessions: number;
  requiredSessions: number; // 20
  sessionsMet: boolean;
  genuineTrades: number;
  requiredTrades: number; // 30
  tradesMet: boolean;
  activeSessions: number;
  requiredActiveSessions: number; // 15
  activeSessionsMet: boolean;
  gatePassed: boolean;
}

export interface Phase39TradeRecord {
  tradeId: string;
  sessionId: string;
  dataTimestamp: string;
  decisionTimestamp: string;
  entryTimestamp: string;
  monitoringTimestamp: string;
  exitTimestamp: string;
  grossPnL: number;
  charges: number;
  netPnL: number;
  dailyPnLId?: string;
  strategyFingerprint: string;
  isGenuine: boolean;
  isSynthetic?: boolean;
  isOOS?: boolean;
  windowId?: string;
  optionPricesAtEntry?: number[];
  greeksAtEntry?: Record<string, number>;
}

export interface Phase39SessionRecord {
  sessionId: string;
  date: string;
  isGenuine: boolean;
  totalTrades: number;
  grossPnL: number;
  charges: number;
  netPnL: number;
  startTimestamp: string;
  endTimestamp: string;
  tradeIds: string[];
}

export interface Phase39Cohort {
  cohortId: string;
  createdAt: string;
  sessionIds: string[];
  tradeIds: string[];
  sessionCount: number;
  tradeCount: number;
  activeSessionCount: number;
  strategyFingerprint: string;
  sourceEvidenceHash: string;
  frozen: boolean;
  frozenAt?: string;
  sessions: Phase39SessionRecord[];
  trades: Phase39TradeRecord[];
}

export interface TimestampAuditResult {
  passed: boolean;
  verifiedCount: number;
  violations: string[];
}

export interface LeakageAuditResult {
  passed: boolean;
  contaminationDetected: boolean;
  violations: string[];
}

export interface PnLAuditResult {
  passed: boolean;
  sumTradeNetPnL: number;
  sumDailyNetPnL: number;
  cumulativeNetPnL: number;
  maxDiscrepancy: number;
  tolerance: number;
  status: "PASS" | "FAIL" | "DATA_UNAVAILABLE";
  reason?: string;
}

export interface StatisticalMetrics {
  winRate: number;
  lossRate: number;
  expectancy: number;
  profitFactor: number | "NOT_AVAILABLE";
  averageWin: number;
  averageLoss: number;
  netPnL: number;
  maxDrawdown: number;
  totalTrades: number;
}

export interface StatisticalAuditResult {
  passed: boolean;
  metrics: StatisticalMetrics;
  wilson95CI: { lower: number; upper: number };
  bootstrapCI: { lower: number; upper: number; mean: number };
  monteCarloDiagnostic: { probabilityOfLoss: number; p95Drawdown: number };
  disclaimer: string;
}

export interface OOSAuditResult {
  passed: boolean;
  isExpectancy: number;
  oosExpectancy: number;
  isWinRate: number;
  oosWinRate: number;
  isProfitFactor: number | "NOT_AVAILABLE";
  oosProfitFactor: number | "NOT_AVAILABLE";
  isDrawdown: number;
  oosDrawdown: number;
  degradationPct: number;
  status: "STABLE" | "DEGRADED" | "INSUFFICIENT_DATA";
}

export interface WalkForwardResult {
  windowId: string;
  trainingStart: string;
  trainingEnd: string;
  testingStart: string;
  testingEnd: string;
  tradeCount: number;
  expectancy: number;
  winRate: number;
  profitFactor: number | "NOT_AVAILABLE";
  maxDrawdown: number;
}

export interface WalkForwardAuditResult {
  passed: boolean;
  windows: WalkForwardResult[];
  overallStatus: "PASS" | "DEGRADED" | "INSUFFICIENT_DATA";
}

export interface StressScenarioResult {
  scenario: string;
  stressedPnL: number;
  maxDD: number;
}

export interface StressAuditResult {
  passed: boolean;
  slippageStress: StressScenarioResult[];
  delayStress: StressScenarioResult[];
  spreadStress: StressScenarioResult[];
  dataQualityResilience: "PASS" | "SAFE_BLOCK";
}

export interface DriftAuditResult {
  status: "NO_MEASURABLE_DRIFT" | "MATERIAL_DRIFT" | "INSUFFICIENT_DATA";
  winRateDriftPct: number;
  expectancyDriftPct: number;
  profitFactorDriftPct: number;
  drawdownDriftPct: number;
}

export interface SafetyAuditResult {
  passed: boolean;
  paperTrading: boolean;
  liveTrading: boolean;
  brokerExecution: boolean;
  realDataOnly: boolean;
  realDhanOrders: number;
  placeOrderBlocked: boolean;
  modifyOrderBlocked: boolean;
  cancelOrderBlocked: boolean;
  violations: string[];
}

export interface RiskAuditResult {
  passed: boolean;
  maxLossViolations: string[];
  dailyProfitLockViolations: string[];
  dailyLossLockViolations: string[];
  maxTradesViolations: string[];
  consecutiveLossesViolations: string[];
  hedgeFirstViolations: string[];
  nakedShortViolations: string[];
  duplicateViolations: string[];
  staleDataViolations: string[];
  sessionGateViolations: string[];
  lotSizeViolations: string[];
  greekGateViolations: string[];
  allViolations: string[];
}

export interface Phase39Manifest {
  cohortId: string;
  strategyFingerprint: string;
  sourceHashes: Record<string, string>;
  sessionCount: number;
  tradeCount: number;
  statisticalSnapshotHash: string;
  safetyAuditHash: string;
  generatedAt: string;
  frozen: boolean;
}

export interface Phase39RevalidationReport {
  reportId: string;
  generatedAt: string;
  state: Phase39State;
  sampleGate: SampleGateProgress;
  cohortSnapshot: Phase39Cohort | null;
  timestampAudit: TimestampAuditResult;
  leakageAudit: LeakageAuditResult;
  pnlAudit: PnLAuditResult;
  statisticalAudit: StatisticalAuditResult;
  oosAudit: OOSAuditResult;
  walkForwardAudit: WalkForwardAuditResult;
  stressAudit: StressAuditResult;
  driftAudit: DriftAuditResult;
  safetyAudit: SafetyAuditResult;
  riskAudit?: RiskAuditResult;
  strategyFingerprintMatch: boolean;
  manifest: Phase39Manifest | null;
  immutableHash: string;
}

export function computeHash(data: any): string {
  return crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex");
}
