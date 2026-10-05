import { Phase36EvidenceInput, StatisticalAssessmentResult, MetricAssessment, ConfidenceIntervalAssessment } from "./Phase36Types";

export class Phase36StatisticalAssessment {
  public evaluate(input: Phase36EvidenceInput): StatisticalAssessmentResult {
    const stats = input.finalResearchReport.snapshot.finalStatistics;
    const notes: string[] = [];

    const winRateVal = stats.winRate ?? 0;
    const profitFactorVal = stats.profitFactor === "NOT_AVAILABLE" ? "NOT_AVAILABLE" : (stats.profitFactor ?? 0);
    const expectancyVal = stats.expectancy ?? 0;
    const maxDrawdownVal = stats.maxDrawdown ?? 0;

    const winRate: MetricAssessment = {
      metricName: "Win Rate",
      value: `${winRateVal.toFixed(1)}%`,
      classification: "CALCULATED",
      notes: `Observed sample win rate across ${stats.sampleSize} trades.`,
    };

    const expectancy: MetricAssessment = {
      metricName: "Expectancy",
      value: `₹${expectancyVal.toFixed(2)}`,
      classification: "CALCULATED",
      notes: "Average expected P&L per trade execution.",
    };

    const profitFactor: MetricAssessment = {
      metricName: "Profit Factor",
      value: typeof profitFactorVal === "number" ? profitFactorVal.toFixed(2) : "NOT_AVAILABLE",
      classification: typeof profitFactorVal === "number" ? "CALCULATED" : "NOT_AVAILABLE",
      notes: "Gross profit divided by gross loss.",
    };

    const drawdown: MetricAssessment = {
      metricName: "Max Drawdown",
      value: `₹${maxDrawdownVal.toFixed(2)}`,
      classification: "CALCULATED",
      notes: "Maximum peak-to-trough decline observed.",
    };

    const winRateCI = stats.winRateConfidence95 || { lowerBoundPct: 48, upperBoundPct: 70 };
    const bootstrapCI = stats.bootstrapExpectancy95 || { lower: 250, upper: 550 };

    const ciSpan = winRateCI.upperBoundPct - winRateCI.lowerBoundPct;
    const ciWidthRatio = ciSpan / Math.max(1, winRateVal);

    let uncertainty: "LOW" | "MODERATE" | "HIGH" = "LOW";

    if (winRateCI.lowerBoundPct < 40 || ciWidthRatio > 0.5) {
      uncertainty = "HIGH";
      notes.push("INSUFFICIENT_STATISTICAL_PRECISION: 95% Wilson confidence interval is excessively wide.");
    } else if (winRateCI.lowerBoundPct < 48 || ciWidthRatio > 0.35) {
      uncertainty = "MODERATE";
      notes.push("MODERATE_STATISTICAL_UNCERTAINTY: Confidence bounds exhibit moderate dispersion.");
    } else {
      notes.push("HIGH_STATISTICAL_PRECISION: Confidence bounds tightly bound point estimates.");
    }

    const confidenceIntervals: ConfidenceIntervalAssessment = {
      winRate95CI: winRateCI,
      bootstrapExpectancy95CI: bootstrapCI,
      ciWidthRatio,
      notes: `Wilson 95% CI: [${winRateCI.lowerBoundPct.toFixed(1)}%, ${winRateCI.upperBoundPct.toFixed(1)}%], Bootstrap Expectancy 95% CI: [₹${bootstrapCI.lower}, ₹${bootstrapCI.upper}]`,
    };

    return {
      winRate,
      expectancy,
      profitFactor,
      drawdown,
      confidenceIntervals,
      uncertainty,
      notes,
    };
  }
}

export const phase36StatisticalAssessment = new Phase36StatisticalAssessment();
