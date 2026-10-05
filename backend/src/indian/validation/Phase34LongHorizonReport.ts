import { Phase34LongHorizonCohort } from "./Phase34CohortManager";
import { Phase34DailyObservationRecord } from "./Phase34DailyObservationStore";
import { Phase34DriftReport } from "./Phase34DriftDetectionEngine";
import { Phase34RiskBehaviorSummary } from "./Phase34RiskBehaviorEngine";
import { Phase34OperationalStabilitySummary } from "./Phase34OperationalStabilityEngine";

export type Phase34State =
  | "NOT_STARTED"
  | "ACCUMULATING"
  | "60_SESSION_GATE_REACHED"
  | "ANALYZING"
  | "DRIFT_ANALYSIS"
  | "OPERATIONAL_ANALYSIS"
  | "LONG_HORIZON_COMPLETE"
  | "VALIDATION_BLOCKED"
  | "INTEGRITY_FAILED"
  | "RECONCILIATION_FAILED"
  | "FINGERPRINT_MISMATCH";

export type Phase34Status =
  | "INSUFFICIENT_SESSIONS"
  | "GATE_REACHED"
  | "LONG_HORIZON_COMPLETE"
  | "VALIDATION_BLOCKED"
  | "INTEGRITY_FAILED"
  | "RECONCILIATION_FAILED"
  | "FINGERPRINT_MISMATCH";

export interface RollingWindowMetrics {
  windowLabel: string;
  sessionCount: number;
  tradeCount: number;
  winRate: number; // 0 - 100%
  expectancy: number;
  profitFactor: number | "NOT_AVAILABLE";
  netPnL: number;
  maxDrawdown: number;
  averagePnL: number;
  medianPnL: number;
  largestWin: number;
  largestLoss: number;
  status: "VALIDATED" | "NOT_AVAILABLE";
}

export interface Phase34ReconciliationReport {
  tradeLevelNetPnL: number;
  dailyLedgerNetPnL: number;
  cumulativeNetPnL: number;
  difference: number;
  tolerance: number; // 0.01
  status: "PASS" | "FAIL";
}

export interface Phase34LongHorizonReport {
  reportId: string;
  state: Phase34State;
  status: Phase34Status;
  cohort: Phase34LongHorizonCohort | null;
  masterStrategyFingerprint: string;
  fingerprintMatch: boolean;
  gateDetails: {
    genuineSessions: number;
    requiredSessions: 60;
    gatePassed: boolean;
    genuineTrades: number;
    activeSessions: number;
  };
  rollingSessionWindows: {
    w20: RollingWindowMetrics;
    w30: RollingWindowMetrics;
    w40: RollingWindowMetrics;
    w60: RollingWindowMetrics;
  };
  rollingTradeWindows: {
    t20: RollingWindowMetrics;
    t30: RollingWindowMetrics;
    t50: RollingWindowMetrics;
    t100: RollingWindowMetrics;
  };
  driftReport: Phase34DriftReport;
  riskBehavior: Phase34RiskBehaviorSummary;
  operationalStability: Phase34OperationalStabilitySummary;
  reconciliation: Phase34ReconciliationReport;
  safetyStatus: {
    paperTrading: boolean;
    liveTrading: boolean;
    brokerExecution: boolean;
    realDataOnly: boolean;
    realBrokerOrders: 0;
  };
  auditTrail: string[];
  generatedAt: string;
  disclaimer: "PHASE 34 LONG-HORIZON VALIDATION REPORTS REAL-MARKET PAPER OBSERVATIONS OVER EXTENDED DURATION. DOES NOT CONSTITUTE A FORECAST OR GUARANTEE OF FUTURE TRADING PERFORMANCE.";
}
