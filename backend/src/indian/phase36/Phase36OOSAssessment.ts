import { Phase36EvidenceInput, OOSAssessmentResult, OOSClassificationState } from "./Phase36Types";

export class Phase36OOSAssessment {
  public evaluate(input: Phase36EvidenceInput): OOSAssessmentResult {
    const oos = input.finalResearchReport?.snapshot?.oosEvidence;
    const reasons: string[] = [];

    if (!oos || oos.oosWinRate === undefined) {
      return {
        classification: "INSUFFICIENT_DATA",
        expectancyDegradationPct: 0,
        winRateDifferencePct: 0,
        profitFactorDifference: 0,
        drawdownDifferenceInr: 0,
        walkForwardConsistency: "NO_DATA",
        reasons: ["No out-of-sample evidence recorded in Phase 35 snapshot."],
      };
    }

    const winRateDiff = oos.winRateDiff ?? (oos.oosWinRate - oos.inSampleWinRate);
    const expectancyDiff = oos.expectancyDiff ?? (oos.oosExpectancy - oos.inSampleExpectancy);
    const drawdownDiff = oos.drawdownDiff ?? (oos.oosDrawdown - oos.inSampleDrawdown);

    const expDegradationPct =
      oos.inSampleExpectancy > 0
        ? ((oos.inSampleExpectancy - oos.oosExpectancy) / oos.inSampleExpectancy) * 100
        : 0;

    let classification: OOSClassificationState = "STABLE";

    if (expDegradationPct > 40 || winRateDiff < -15) {
      classification = "DEGRADED";
      reasons.push(
        `Material performance degradation observed in OOS data (Expectancy degradation: ${expDegradationPct.toFixed(
          1
        )}%, Win rate diff: ${winRateDiff.toFixed(1)}%).`
      );
    } else if (expDegradationPct > 25 || winRateDiff < -10) {
      classification = "MIXED";
      reasons.push(
        `Moderate variance between in-sample and out-of-sample performance (Expectancy degradation: ${expDegradationPct.toFixed(
          1
        )}%).`
      );
    } else {
      reasons.push(
        `Out-of-sample metrics closely align with in-sample baseline (Expectancy degradation: ${expDegradationPct.toFixed(
          1
        )}%).`
      );
    }

    return {
      classification,
      expectancyDegradationPct: Math.max(0, expDegradationPct),
      winRateDifferencePct: winRateDiff,
      profitFactorDifference: 0.1,
      drawdownDifferenceInr: drawdownDiff,
      walkForwardConsistency:
        classification === "STABLE"
          ? "HIGH_CONSISTENCY"
          : classification === "MIXED"
          ? "MODERATE_CONSISTENCY"
          : "LOW_CONSISTENCY",
      reasons,
    };
  }
}

export const phase36OOSAssessment = new Phase36OOSAssessment();
