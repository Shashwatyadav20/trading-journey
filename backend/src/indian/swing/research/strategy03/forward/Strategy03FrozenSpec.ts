import crypto from "node:crypto";

export const STRATEGY03_FROZEN_SPEC_V61018 = {
  phase: "6.10.18",
  phaseStartTimestamp: "2026-11-17T14:53:56+05:30",
  targetValidNseSessions: 90,
  fundamentalWeights: {
    revenueCagr: 20,
    profitGrowth: 20,
    roeRoce: 15,
    debtToEquity: 15,
    institutionalAccumulation: 10,
    promoterHoldingStability: 10,
    cashFlowQuality: 10,
  },
  entryRules: {
    institutionalDecision: "ENTER_CANDIDATE",
    momentumClassification: "MOMENTUM_WATCHLIST",
    consolidationWindowCandles: 5,
    requireDojiInConsolidation: true,
    intradayEventDriven1H: true,
    firstBreakoutOnlyPerDay: true,
    executionPrice: "NEXT_EXECUTABLE_1H_OPEN",
  },
  exitCandidatesFrozen: {
    candidate1: "TRAIL_1.2R_AFTER_PLUS_1R",
    candidate2: "TIME_EXIT_20BARS_IF_BELOW_0.5R",
  },
  safetyLocks: {
    STRATEGY_01: false,
    STRATEGY_02: false,
    STRATEGY_03: false,
    LIVE_TRADING: false,
    BROKER_EXECUTION_ENABLED: false,
    Strategy03PaperIsolationConfig_enabled: false,
  },
} as const;

export function getFrozenSpecChecksum(): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(STRATEGY03_FROZEN_SPEC_V61018))
    .digest("hex");
}

