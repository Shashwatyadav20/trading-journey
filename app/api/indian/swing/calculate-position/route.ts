import { NextResponse, NextRequest } from "next/server";
import { calculateDynamicPositionSize } from "@/lib/indian/riskEngine";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const accountCapital = Math.max(1000, Number(body.accountCapital) || 2500000);
    const riskPercent = Math.max(0.1, Number(body.riskPercent) || 1.0);
    const entryPrice = Math.max(0.05, Number(body.entryPrice) || 100);
    const stopLossPrice = Math.max(0.01, Number(body.stopLossPrice) || 90);
    const targetPrice = body.targetPrice
      ? Number(body.targetPrice)
      : entryPrice + (entryPrice - stopLossPrice) * 2.5;
    const atr14 = body.atr14 ? Number(body.atr14) : undefined;

    const dynamicSizing = calculateDynamicPositionSize({
      accountCapital,
      riskPercentage: riskPercent,
      entryPrice,
      stopLossPrice,
      targetPrice,
      atr14,
      maxPortfolioAllocationPct: Number(body.maxAllocationPct) || 20,
    });

    const riskPerShare = Math.abs(entryPrice - stopLossPrice);
    const potentialGainPerShare = Math.abs(targetPrice - entryPrice);
    const maxRiskAmount = Math.round(accountCapital * (riskPercent / 100) * 100) / 100;
    const recommendedQuantity = dynamicSizing.recommendedQuantity;
    const totalCapitalRequired = dynamicSizing.allocatedCapital;
    const capitalExposurePercent = dynamicSizing.portfolioExposurePercent;
    const potentialRewardAmount = dynamicSizing.maxRewardPotential;
    const rewardRiskRatio = dynamicSizing.rewardRiskRatio;

    const warnings: string[] = [];
    if (rewardRiskRatio < 2.0) {
      warnings.push(`Trade caution: R:R is ${rewardRiskRatio}:1. Institutional standard targets >= 1:2.0.`);
    }
    if (dynamicSizing.cappedByAllocationLimit) {
      warnings.push(`Position size capped by 20% portfolio concentration risk threshold.`);
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
        // Institutional ATR volatility parity breakdown
        atrVolatilitySizing: dynamicSizing,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message }, { status: 400 });
  }
}
