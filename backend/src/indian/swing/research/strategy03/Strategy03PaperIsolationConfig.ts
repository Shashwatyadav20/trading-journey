export interface Strategy03PaperIsolationConfig {
  strategyId: "STRATEGY_03";
  enabled: false;
  requireHumanApproval: true;
  isolatedPartitionName: "strategy03_paper_trades_isolated";
  multiDaySwingSupported: true;
  allowIntradayAutoSquareOff: false;
  independentRiskController: true;
  independentAuditLog: true;
  brokerExecutionAllowed: false;
}

export const DEFAULT_STRATEGY03_PAPER_ISOLATION_CONFIG: Strategy03PaperIsolationConfig = {
  strategyId: "STRATEGY_03",
  enabled: false,
  requireHumanApproval: true,
  isolatedPartitionName: "strategy03_paper_trades_isolated",
  multiDaySwingSupported: true,
  allowIntradayAutoSquareOff: false,
  independentRiskController: true,
  independentAuditLog: true,
  brokerExecutionAllowed: false,
};

export function validateStrategy03IsolationGuard(
  cfg: Strategy03PaperIsolationConfig,
  flags: {
    STRATEGY_01: boolean;
    STRATEGY_02: boolean;
    STRATEGY_03: boolean;
    LIVE_TRADING: boolean;
    BROKER_EXECUTION_ENABLED: boolean;
  }
): { isolated: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (cfg.enabled !== false) reasons.push("STRATEGY_03_PAPER_MUST_DEFAULT_FALSE");
  if (cfg.brokerExecutionAllowed !== false) reasons.push("BROKER_EXECUTION_FORBIDDEN");
  if (cfg.allowIntradayAutoSquareOff !== false) reasons.push("INTRADAY_SQUAREOFF_MUST_BE_DISABLED_FOR_SWING");
  if (flags.STRATEGY_03 !== false) reasons.push("STRATEGY_03_GLOBAL_FLAG_MUST_BE_FALSE");
  if (flags.LIVE_TRADING !== false) reasons.push("LIVE_TRADING_MUST_BE_FALSE");
  if (flags.BROKER_EXECUTION_ENABLED !== false) reasons.push("BROKER_EXECUTION_ENABLED_MUST_BE_FALSE");
  return { isolated: reasons.length === 0, reasons };
}

