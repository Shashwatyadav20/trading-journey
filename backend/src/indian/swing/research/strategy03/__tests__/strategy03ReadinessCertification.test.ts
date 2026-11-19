import { describe, expect, it } from "vitest";
import {
  FORWARD_VALIDATION_ACCEPTANCE_CRITERIA,
  STRATEGY03_PROPOSED_RISK_SPEC,
  validateStrategy03RiskProposal,
} from "../Strategy03ReadinessCertifier.js";

describe("Strategy 03 Phase 6.10 — Paper Trading Readiness & Safety Certification", () => {
  it("keeps proposed risk specification unapplied and enforces duplicate/averaging-down/drawdown limits", () => {
    expect(STRATEGY03_PROPOSED_RISK_SPEC.approvalRequired).toBe(true);
    expect(STRATEGY03_PROPOSED_RISK_SPEC.appliedToProduction).toBe(false);
    expect(FORWARD_VALIDATION_ACCEPTANCE_CRITERIA.minLiveShadowCalendarDays).toBe(90);

    const ok = validateStrategy03RiskProposal(STRATEGY03_PROPOSED_RISK_SPEC, {
      openPositionsCount: 2,
      hasExistingOpenForSymbol: false,
      proposedPositionWeightPct: 10,
      proposedSectorWeightPct: 20,
      avgDailyTurnoverCr: 15,
      daysToEarnings: 10,
      dailyLossPct: 0.5,
      portfolioDrawdownPct: 3.0,
      isAveragingDown: false,
      isSizeIncreaseAfterLoss: false,
    });
    expect(ok.allowed).toBe(true);

    const blocked = validateStrategy03RiskProposal(STRATEGY03_PROPOSED_RISK_SPEC, {
      openPositionsCount: 10,
      hasExistingOpenForSymbol: true,
      proposedPositionWeightPct: 15,
      proposedSectorWeightPct: 30,
      avgDailyTurnoverCr: 2,
      daysToEarnings: 1,
      dailyLossPct: 2.5,
      portfolioDrawdownPct: 13,
      isAveragingDown: true,
      isSizeIncreaseAfterLoss: true,
    });
    expect(blocked.allowed).toBe(false);
    expect(blocked.violations).toContain("DUPLICATE_POSITION_BLOCKED");
    expect(blocked.violations).toContain("AVERAGING_DOWN_BLOCKED");
    expect(blocked.violations).toContain("MARTINGALE_SIZE_INCREASE_BLOCKED");
    expect(blocked.violations).toContain("EARNINGS_BLACKOUT_WINDOW");
    expect(blocked.violations).toContain("MAX_PORTFOLIO_DRAWDOWN_BREACHED");
  });
});

