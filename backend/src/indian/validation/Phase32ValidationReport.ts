import { Phase32ValidationCohort } from "./Phase32DatasetManager";
import { Phase32LeakageReport } from "./Phase32LeakageDetector";
import { WalkForwardWindow, WalkForwardStabilityDistribution } from "./Phase32WalkForwardEngine";
import { Phase32ComparisonReport, Phase32PerformanceDegradation } from "./Phase32ComparisonEngine";

export type Phase32ValidationState =
  | "NOT_STARTED"
  | "DATA_LOADING"
  | "DATA_VALIDATING"
  | "VALIDATION_RUNNING"
  | "INSUFFICIENT_OOS_SAMPLE"
  | "VALIDATION_COMPLETE"
  | "VALIDATION_INVALID"
  | "VALIDATION_BLOCKED";

export type Phase32ValidationStatus =
  | "NOT_STARTED"
  | "INSUFFICIENT_OOS_SAMPLE"
  | "VALIDATION_COMPLETE"
  | "VALIDATION_INVALID"
  | "VALIDATION_BLOCKED";

export interface Phase32OOSCoreStatistics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  breakevenTrades: number;
  winRate: number; // 0 - 100%
  lossRate: number;
  grossPnL: number;
  charges: number;
  slippage: number;
  netPnL: number;
  averageNetPnL: number;
  medianNetPnL: number;
  profitFactor: number | "NOT_AVAILABLE";
  expectancy: number;
  averageWinner: number;
  averageLoser: number;
  winLossRatio: number | "NOT_AVAILABLE";
  largestWin: number;
  largestLoss: number;
  maxDrawdown: number;
  maxConsecutiveLosses: number;
}

export interface Phase32WilsonConfidenceInterval {
  observedWinRatePct: number;
  sampleSize: number;
  confidenceLevel: 95;
  lowerBoundPct: number;
  upperBoundPct: number;
}

export interface Phase32BootstrapExpectancyResult {
  observedExpectancy: number;
  bootstrapMean: number;
  confidenceInterval95: {
    lower: number;
    upper: number;
  };
  iterations: number;
}

export interface Phase32RegimeOOSAnalysis {
  regime: "BULLISH" | "BEARISH" | "RANGE" | "NO_TRADE";
  tradeCount: number;
  winRate: number;
  netPnL: number;
  expectancy: number;
  profitFactor: number | "NOT_AVAILABLE";
  maxDrawdown: number;
  status: "NORMAL" | "LOW_SAMPLE";
  lowSampleWarning: boolean;
}

export interface Phase32StrategyOOSAnalysis {
  strategy: "BULL_PUT_SPREAD" | "BEAR_CALL_SPREAD" | "IRON_CONDOR";
  tradeCount: number;
  winRate: number;
  netPnL: number;
  expectancy: number;
  profitFactor: number | "NOT_AVAILABLE";
  maxDrawdown: number;
}

export interface Phase32ValidationReport {
  reportId: string;
  state: Phase32ValidationState;
  status: Phase32ValidationStatus;
  masterStrategyFingerprint: string;
  fingerprintLocked: boolean;
  fingerprintMatch: boolean;
  cohort: Phase32ValidationCohort | null;
  datasetFingerprint: string;
  safetyStatus: {
    paperTrading: boolean;
    liveTrading: boolean;
    brokerExecution: boolean;
    realDataOnly: boolean;
    realBrokerOrders: 0;
  };
  oosCoreStatistics: Phase32OOSCoreStatistics;
  winRateConfidence: Phase32WilsonConfidenceInterval;
  bootstrapExpectancy: Phase32BootstrapExpectancyResult;
  comparison: Phase32ComparisonReport;
  degradation: Phase32PerformanceDegradation;
  walkForwardWindows: WalkForwardWindow[];
  walkForwardStability: WalkForwardStabilityDistribution;
  regimeOOSBreakdown: Phase32RegimeOOSAnalysis[];
  strategyOOSBreakdown: Phase32StrategyOOSAnalysis[];
  leakageReport: Phase32LeakageReport;
  auditTrail: string[];
  generatedAt: string;
  disclaimer: "PHASE 32 OUT-OF-SAMPLE VALIDATION REPORTS STATISTICAL EVIDENCE ON UNSEEN DATA. DOES NOT CONSTITUTE A GUARANTEE OF FUTURE PROFITABILITY OR LIVE TRADING READINESS.";
}
