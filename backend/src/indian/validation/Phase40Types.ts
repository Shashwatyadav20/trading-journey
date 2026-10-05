import crypto from "crypto";

// ─── Final States ───────────────────────────────────────────────────────────
// LIVE_READY is intentionally ABSENT — broker execution is disabled by design.
export type Phase40FinalState =
  | "FINAL_AUDIT_IN_PROGRESS"
  | "FINAL_AUDIT_FAILED"
  | "PAPER_PRODUCTION_READY"
  | "NOT_READY_FOR_LIVE";

export type AuditVerdict = "PASS" | "FAIL" | "NOT_VERIFIABLE" | "NOT_TESTABLE";
export type EvidenceClassification = "PROVEN" | "DERIVED" | "UNAVAILABLE" | "NOT_TESTABLE";

// ─── Section Audit Results ───────────────────────────────────────────────────
export interface SafetyInvariantAudit {
  paperTrading: boolean;
  liveTrading: boolean;
  brokerExecution: boolean;
  realDataOnly: boolean;
  realDhanOrders: number;
  placeOrderBlocked: boolean;
  modifyOrderBlocked: boolean;
  cancelOrderBlocked: boolean;
  verdict: AuditVerdict;
  violations: string[];
}

export interface Phase39CohortAudit {
  cohortExists: boolean;
  cohortId: string;
  hashValid: boolean;
  evidenceHashReproducible: boolean;
  fingerprintValid: boolean;
  noPostFreezeModification: boolean;
  noDuplicateObservations: boolean;
  allObservationsHaveProvenance: boolean;
  allTimestampsValid: boolean;
  reconciliationValid: boolean;
  verdict: AuditVerdict;
  violations: string[];
}

export interface StrategyIntegrityAudit {
  fingerprintMatch: boolean;
  masterFingerprintHash: string;
  strategyVersion: string;
  componentsVerified: string[];
  verdict: AuditVerdict;
  violations: string[];
}

export interface GenuineDataAudit {
  realOptionChain: EvidenceClassification;
  realOptionPrices: EvidenceClassification;
  realSpot: EvidenceClassification;
  dataNotStale: EvidenceClassification;
  lotSizeVerified: EvidenceClassification;
  marketSessionValid: EvidenceClassification;
  safetyLocksValid: EvidenceClassification;
  syntheticDataDetected: boolean;
  verdict: AuditVerdict;
  notes: string[];
}

export interface StatisticalEvidenceAudit {
  winRateCI: EvidenceClassification;
  expectancy: EvidenceClassification;
  profitFactor: EvidenceClassification;
  drawdown: EvidenceClassification;
  bootstrapResults: EvidenceClassification;
  monteCarloLabel: string; // Must be OBSERVATIONAL_RESAMPLING
  oosStatus: EvidenceClassification;
  walkForwardStatus: EvidenceClassification;
  stressStatus: EvidenceClassification;
  driftStatus: EvidenceClassification;
  verdict: AuditVerdict;
  disclaimer: string;
}

export interface PnLReconciliationAudit {
  tradeLevelPnL: EvidenceClassification;
  sessionLevelPnL: EvidenceClassification;
  cumulativePnL: EvidenceClassification;
  maxDiscrepancy: number;
  tolerancePassed: boolean;
  verdict: AuditVerdict;
  violations: string[];
}

export interface RiskControlAudit {
  maxLossPerTrade: boolean;          // <= ₹1,000
  dailyProfitLock: boolean;          // ₹1,000
  dailyLossLock: boolean;            // -₹5,000
  maxTradesPerDay: boolean;          // 3
  maxConsecutiveLosses: boolean;     // 2
  hedgeFirstEnforced: boolean;
  noNakedShort: boolean;
  staleDataProtection: boolean;
  greekProtection: boolean;
  lotSizeVerification: boolean;
  expiryValidation: boolean;
  sessionValidation: boolean;
  duplicatePrevention: boolean;
  reconciliationCheck: boolean;
  killSwitch: boolean;
  verdict: AuditVerdict;
  violations: string[];
}

export interface ExecutionSafetyAudit {
  paperAdapterOnly: boolean;
  dhanReadOnly: boolean;
  placeOrderBlocked: boolean;
  modifyOrderBlocked: boolean;
  cancelOrderBlocked: boolean;
  failClosedBeforeNetwork: boolean;
  verdict: AuditVerdict;
  violations: string[];
}

export interface CrashRestartAudit {
  backendRestartRecovery: AuditVerdict;
  websocketReconnect: AuditVerdict;
  stateRecovery: AuditVerdict;
  paperPositionRecovery: AuditVerdict;
  dailyRiskRecovery: AuditVerdict;
  reconciliationRecovery: AuditVerdict;
  duplicatePrevention: AuditVerdict;
  frozenCohortRecovery: AuditVerdict;
  verdict: AuditVerdict;
  notes: string[];
}

export interface DataFailureAudit {
  dhanUnavailable: AuditVerdict;
  nseUnavailable: AuditVerdict;
  staleWebSocket: AuditVerdict;
  staleOptionChain: AuditVerdict;
  missingGreeks: AuditVerdict;
  missingOptionPrice: AuditVerdict;
  invalidExpiry: AuditVerdict;
  invalidLotSize: AuditVerdict;
  providerMismatch: AuditVerdict;
  malformedResponse: AuditVerdict;
  syntheticFallbackPrevented: boolean;
  verdict: AuditVerdict;
}

export interface SecurityAudit {
  secretsNotCommitted: AuditVerdict;
  tokensNotExposedInApi: AuditVerdict;
  credentialsNotLogged: AuditVerdict;
  authMiddlewareActive: AuditVerdict;
  protectedRoutesRejectUnauth: AuditVerdict;
  envVarsUsedForSecrets: AuditVerdict;
  clientSideHasNoBrokerCredentials: AuditVerdict;
  errorResponsesNoSecretLeak: AuditVerdict;
  verdict: AuditVerdict;
  notes: string[];
}

export interface DeploymentAudit {
  frontendBuildPass: boolean;
  backendTypescriptPass: boolean;
  backendStartupPass: AuditVerdict;
  healthEndpointReachable: AuditVerdict;
  indianApisConfigured: boolean;
  dhanConnectivity: AuditVerdict;
  websocketConnectivity: AuditVerdict;
  databasePersistence: AuditVerdict;
  environmentConfig: boolean;
  liveTrading_env: boolean;         // Must be false
  brokerExecution_env: boolean;     // Must be false
  paperTrading_env: boolean;        // Must be true
  realDataOnly_env: boolean;        // Must be true
  verdict: AuditVerdict;
  violations: string[];
}

export interface RegressionAudit {
  testFiles: number;
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  regressions: number;
  typescriptErrors: number;
  buildPass: boolean;
  verdict: AuditVerdict;
}

// ─── Final Report ─────────────────────────────────────────────────────────────
export interface Phase40FinalAuditReport {
  reportId: string;
  generatedAt: string;
  projectVersion: string;
  strategyFingerprint: string;
  phase39CohortId: string;
  phase39CohortHash: string;
  phase39EvidenceHash: string;

  // Section audits
  safetyInvariant: SafetyInvariantAudit;
  phase39Cohort: Phase39CohortAudit;
  strategyIntegrity: StrategyIntegrityAudit;
  genuineData: GenuineDataAudit;
  statisticalEvidence: StatisticalEvidenceAudit;
  pnlReconciliation: PnLReconciliationAudit;
  riskControl: RiskControlAudit;
  executionSafety: ExecutionSafetyAudit;
  crashRestart: CrashRestartAudit;
  dataFailure: DataFailureAudit;
  security: SecurityAudit;
  deployment: DeploymentAudit;
  regression: RegressionAudit;

  // Final decision
  finalState: Phase40FinalState;
  mandatoryAuditsFailed: string[];
  explicitLimitations: string[];

  // Immutable report hash (excludes wall-clock metadata)
  immutableHash: string;
}

export function computePhase40Hash(data: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex");
}
