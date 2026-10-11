import { NextResponse, NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const accountCapital = Math.max(1000, Number(body.accountCapital) || 500000);
    const riskPercent = Math.max(0.1, Number(body.riskPercent) || 1.0);
    const entryPrice = Math.max(0.05, Number(body.entryPrice) || 100);
    const stopLossPrice = Math.max(0.01, Number(body.stopLossPrice) || 90);
    const targetPrice = body.targetPrice
      ? Number(body.targetPrice)
      : entryPrice + (entryPrice - stopLossPrice) * 2;

    const riskPerShare = Math.abs(entryPrice - stopLossPrice);
    const potentialGainPerShare = Math.abs(targetPrice - entryPrice);

    const maxRiskAmount = Math.round(accountCapital * (riskPercent / 100) * 100) / 100;
    const recommendedQuantity = riskPerShare > 0 ? Math.floor(maxRiskAmount / riskPerShare) : 0;
    const totalCapitalRequired = Math.round(recommendedQuantity * entryPrice * 100) / 100;
    const capitalExposurePercent =
      accountCapital > 0 ? Math.round((totalCapitalRequired / accountCapital) * 10000) / 100 : 0;

    const potentialRewardAmount = Math.round(recommendedQuantity * potentialGainPerShare * 100) / 100;
    const rewardRiskRatio =
      riskPerShare > 0 ? Math.round((potentialGainPerShare / riskPerShare) * 100) / 100 : 0;

    const warnings: string[] = [];
    if (rewardRiskRatio < 2.0) {
      warnings.push(`Trade rejected by Rule 5: R:R is ${rewardRiskRatio}:1. Minimum required is 1:2.0.`);
    }

    return NextResponse.json({
      success: true,
      result: {
        maxRiskAmount,
        riskPerShare: Math.round(riskPerShare * 100) / 100,
        recommendedQuantity,
        totalCapitalRequired,
        portfolioCapitalExposurePercent: capitalExposurePercent,
        potentialRewardAmount,
        rewardRiskRatio,
        isRiskValid: rewardRiskRatio >= 2.0,
        validationWarnings: warnings,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 400 });
  }
}
