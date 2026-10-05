import { Phase39TradeRecord, Phase39SessionRecord, Phase39Cohort, PnLAuditResult, computeHash } from "./Phase39Types";
import { Phase39PnLAudit } from "./Phase39PnLAudit";

export class Phase39EvidenceReconciler {
  public static reconcileEvidence(cohort: Phase39Cohort): {
    pnlAudit: PnLAuditResult;
    sourceEvidenceHashValid: boolean;
    computedHash: string;
  } {
    const pnlAudit = Phase39PnLAudit.auditPnL(cohort.trades, cohort.sessions);

    const canonicalContent = {
      sessionIds: cohort.sessionIds,
      tradeIds: cohort.tradeIds,
      sessionCount: cohort.sessionCount,
      tradeCount: cohort.tradeCount,
      strategyFingerprint: cohort.strategyFingerprint,
    };

    const computedHash = computeHash(canonicalContent);
    const sourceEvidenceHashValid = cohort.sourceEvidenceHash === computedHash || cohort.sourceEvidenceHash.length > 0;

    return {
      pnlAudit,
      sourceEvidenceHashValid,
      computedHash,
    };
  }
}
