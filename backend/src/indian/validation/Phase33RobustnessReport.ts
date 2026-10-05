import { ExecutionStressResult } from "./Phase33ExecutionStressEngine";
import { SequenceStressResult, SequencePermutationDistribution } from "./Phase33SequenceStressEngine";
import { TailLossStressResult } from "./Phase33MarketStressEngine";
import { DataQualityStressResult } from "./Phase33DataQualityStressEngine";
import { MonteCarloStressDiagnostic } from "./Phase33MonteCarloEngine";
import { StressScenarioMatrix } from "./Phase33StressScenarioManager";

export type Phase33RobustnessState = "NOT_STARTED" | "RUNNING" | "COMPLETED" | "BLOCKED" | "FAILED";

export type Phase33RobustnessStatus =
  | "NOT_STARTED"
  | "ROBUSTNESS_PASSED"
  | "HIGH_SENSITIVITY_WARNING"
  | "ROBUSTNESS_BLOCKED";

export interface Phase33RobustnessScorecard {
  slippageSensitivity: "LOW" | "MODERATE" | "HIGH";
  delaySensitivity: "LOW" | "MODERATE" | "HIGH";
  sequenceSensitivity: "LOW" | "MODERATE" | "HIGH";
  tailLossSensitivity: "LOW" | "MODERATE" | "HIGH";
  dataQualityResilience: "PASS" | "FAIL";
  overallRobustnessGrade: "ROBUST" | "MODERATE" | "SENSITIVE";
}

export interface Phase33RobustnessReport {
  reportId: string;
  state: Phase33RobustnessState;
  status: Phase33RobustnessStatus;
  masterStrategyFingerprint: string;
  fingerprintLocked: boolean;
  fingerprintMatch: boolean;
  scenarioMatrix: StressScenarioMatrix;
  slippageStress: ExecutionStressResult[];
  delayStress: ExecutionStressResult[];
  spreadStress: ExecutionStressResult[];
  sequenceStress: SequenceStressResult[];
  sequencePermutations: SequencePermutationDistribution;
  tailLossStress: TailLossStressResult[];
  dataQualityStress: DataQualityStressResult[];
  monteCarloDiagnostic: MonteCarloStressDiagnostic;
  scorecard: Phase33RobustnessScorecard;
  safetyStatus: {
    paperTrading: boolean;
    liveTrading: boolean;
    brokerExecution: boolean;
    realDataOnly: boolean;
    realBrokerOrders: 0;
  };
  auditTrail: string[];
  generatedAt: string;
  disclaimer: "PHASE 33 ROBUSTNESS & STRESS TESTING EVALUATES STRATEGY BEHAVIOR UNDER ADVERSE HYPOTHETICAL CONDITIONS. IT DOES NOT CONSTITUTE A FORECAST OR GUARANTEE OF FUTURE TRADING PERFORMANCE.";
}
