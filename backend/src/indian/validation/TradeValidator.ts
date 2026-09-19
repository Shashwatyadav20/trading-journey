import {
  AutoHedgeSignal,
  CandidateSpread,
  RiskValidation,
  StrategyScoreResult,
} from "../types";
import { RegimeEvaluation } from "../regime/MarketRegimeEngine";
import { dailyRiskController } from "../risk/DailyRiskController";

export interface ValidationDecision {
  approved: boolean;
  rejectionReason: string | null;
}

export class TradeValidator {
  /**
   * Final pre-execution gateway validating all strategy, risk, charge, and market conditions.
   */
  public validateTrade(
    regimeEval: RegimeEvaluation,
    candidateSpread: CandidateSpread | null,
    scoreResult: StrategyScoreResult,
    riskVal: RiskValidation,
    expectedNetPnl: number
  ): ValidationDecision {
    // 1. Regime Check
    if (!regimeEval.isTradeable) {
      return {
        approved: false,
        rejectionReason: `Market Regime is ${regimeEval.regime}. ${regimeEval.reasons[0] || "No trade allowed."}`,
      };
    }

    // 2. Candidate Spread Check
    if (!candidateSpread) {
      return {
        approved: false,
        rejectionReason: "No suitable defined-risk candidate spread found matching delta and S/R criteria.",
      };
    }

    // 3. Strategy Quality Score Check
    if (scoreResult.score < 70) {
      return {
        approved: false,
        rejectionReason: `Strategy setup score (${scoreResult.score}/100) is below minimum threshold (70).`,
      };
    }

    // 4. Risk Engine Sizing Check
    if (!riskVal.allowed) {
      return {
        approved: false,
        rejectionReason: riskVal.rejectionReason || "Position sizing risk validation failed.",
      };
    }

    // 5. Net P&L Profitability Check
    if (expectedNetPnl <= 0) {
      return {
        approved: false,
        rejectionReason: `Expected net P&L after all brokerage and taxes (₹${expectedNetPnl}) is not positive.`,
      };
    }

    // 6. Daily Risk Controller Locks
    const dailyCheck = dailyRiskController.canTrade();
    if (!dailyCheck.allowed) {
      return {
        approved: false,
        rejectionReason: dailyCheck.reason || "Daily risk control limit reached.",
      };
    }

    return {
      approved: true,
      rejectionReason: null,
    };
  }
}

export const tradeValidator = new TradeValidator();
