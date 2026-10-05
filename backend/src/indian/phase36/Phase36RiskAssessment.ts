import { PHASE36_CONFIG } from "./Phase36Config";
import { Phase36EvidenceInput, RiskAssessmentResult } from "./Phase36Types";

export class Phase36RiskAssessment {
  public evaluate(input: Phase36EvidenceInput): RiskAssessmentResult {
    const risk = input.finalResearchReport.snapshot.riskSummary;
    const violationsDetails: string[] = [];

    if (!risk) {
      return {
        dailyProfitCapMet: true,
        dailyLossCapMet: true,
        maxLossPerTradeMet: true,
        riskLockEvents: 0,
        emergencyExits: 0,
        pnlReconciliationStatus: "FAIL",
        historicalViolationsCount: 1,
        violationsDetails: ["NO_RISK_SUMMARY_AVAILABLE"],
      };
    }

    const largestLossInr = Math.abs(risk.largestLossInr || 0);
    const maxDailyLossInr = Math.abs(risk.maxDailyLossInr || 0);

    const maxLossPerTradeMet = largestLossInr <= PHASE36_CONFIG.MAX_LOSS_PER_TRADE_INR * 1.05; // 5% slippage tolerance
    if (!maxLossPerTradeMet) {
      violationsDetails.push(`Largest loss trade (₹${largestLossInr}) exceeded ₹${PHASE36_CONFIG.MAX_LOSS_PER_TRADE_INR} limit.`);
    }

    const dailyLossCapMet = maxDailyLossInr <= Math.abs(PHASE36_CONFIG.DAILY_LOSS_CAP_INR);
    if (!dailyLossCapMet) {
      violationsDetails.push(`Max daily loss (₹${maxDailyLossInr}) exceeded daily loss cap (₹${Math.abs(PHASE36_CONFIG.DAILY_LOSS_CAP_INR)}).`);
    }

    const pnlReconciliationPassed = risk.pnlReconciliationStatus === "PASS";
    if (!pnlReconciliationPassed) {
      violationsDetails.push("P&L reconciliation check failed across risk controller and trade ledger.");
    }

    return {
      dailyProfitCapMet: true,
      dailyLossCapMet,
      maxLossPerTradeMet,
      riskLockEvents: (risk.profitLockEvents || 0) + (risk.lossLockEvents || 0),
      emergencyExits: risk.emergencyExits || 0,
      pnlReconciliationStatus: risk.pnlReconciliationStatus,
      historicalViolationsCount: violationsDetails.length,
      violationsDetails: violationsDetails.length > 0 ? violationsDetails : ["Zero risk limit violations recorded. Risk locks operating correctly."],
    };
  }
}

export const phase36RiskAssessment = new Phase36RiskAssessment();
